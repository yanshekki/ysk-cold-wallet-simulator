import { secp256k1 } from '@noble/curves/secp256k1';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha2';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import { encodeEthHdkeyUr, masterFingerprint } from './hdkey';
import {
  bip143Sighash,
  buildP2pkhPsbt,
  buildP2shP2wpkhPsbt,
  buildP2trPsbt,
  buildP2wpkhPsbt,
  decodeCryptoPsbt,
  encodeCryptoPsbtCbor,
  encodeCryptoPsbtUr,
  encodePsbt,
  p2wpkhScriptCode,
  parsePsbt,
  previewCryptoPsbt,
  scriptToAddress,
  signCryptoPsbt,
  signPsbtBytes,
} from './psbt';
import { FountainUrDecoder } from './ur';

const FOUNDATION = 'test test test test test test test test test test test junk';
const OTHER = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PATH = "m/84'/0'/0'/0/0";
const PATH_INDEXES = [0x80000054, 0x80000000, 0x80000000, 0, 0];

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

function p2wpkhScript(pub: Uint8Array): Uint8Array {
  return Uint8Array.of(0x00, 0x14, ...hash160(pub));
}

function foundationKey() {
  const seed = mnemonicToSeedSync(FOUNDATION);
  const master = HDKey.fromMasterSeed(seed);
  const node = master.derive(PATH);
  return {
    seed,
    pub: node.publicKey!,
    privateKey: node.privateKey!,
    fingerprint: masterFingerprint(master.publicKey!),
  };
}

function unsignedPsbt(fingerprint = foundationKey().fingerprint, pubkey = foundationKey().pub) {
  const pay = foundationKey();
  return buildP2wpkhPsbt({
    amount: 100_000n,
    pubkey,
    fingerprint,
    pathIndexes: PATH_INDEXES,
    outputScript: p2wpkhScript(pay.pub),
    outputAmount: 99_000n,
  });
}

function derToCompact(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30 || der[2] !== 0x02) {
    throw new Error('der');
  }
  const rLen = der[3]!;
  let r = der.subarray(4, 4 + rLen);
  const sStart = 4 + rLen;
  const sLen = der[sStart + 1]!;
  let s = der.subarray(sStart + 2, sStart + 2 + sLen);
  if (r[0] === 0) {
    r = r.subarray(1);
  }
  if (s[0] === 0) {
    s = s.subarray(1);
  }
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

describe('crypto-psbt', () => {
  it('signs a native SegWit PSBT from the foundation seed', () => {
    const { seed, pub } = foundationKey();
    const psbt = unsignedPsbt();
    const cbor = encodeCryptoPsbtCbor(psbt);
    const preview = previewCryptoPsbt(seed, cbor);
    expect(preview.path).toBe(PATH);
    expect(preview.outputs).toHaveLength(1);
    expect(preview.outputs[0]?.amountSats).toBe(99_000n);
    expect(preview.feeSats).toBe(1_000n);
    expect(preview.outputs[0]?.address.startsWith('bc1q')).toBe(true);

    const signed = signCryptoPsbt(seed, cbor);
    expect(signed.urKind).toBe('crypto-psbt');
    expect(signed.ur.startsWith('ur:crypto-psbt/')).toBe(true);

    const decoder = new FountainUrDecoder();
    let progress = decoder.receive('not-a-ur');
    for (const part of signed.parts ?? [signed.ur]) {
      progress = decoder.receive(part);
      if (progress.complete) {
        break;
      }
    }
    if (!progress.success) {
      progress = decoder.receive(signed.ur);
    }
    expect(progress.success).toBe(true);
    const signedParsed = parsePsbt(decodeCryptoPsbt(progress.cbor!));
    const partial = [...signedParsed.inputMaps[0]!.entries()].find(([key]) => key.startsWith('02'));
    expect(partial).toBeTruthy();
    const der = partial![1].subarray(0, partial![1].length - 1);
    const hash = bip143Sighash(parsePsbt(psbt), 0, p2wpkhScriptCode(hash160(pub)), 100_000n);
    expect(secp256k1.verify(derToCompact(der), hash, pub)).toBe(true);
  });

  it('reassembles animated crypto-psbt parts and rejects a mismatched seed', () => {
    const { seed } = foundationKey();
    const psbt = unsignedPsbt();
    const cbor = encodeCryptoPsbtCbor(psbt);
    const encoder = new UREncoder(new UR(Buffer.from(cbor), 'crypto-psbt'), 40);
    const decoder = new FountainUrDecoder();
    let progress = decoder.receive('not-a-ur');
    for (let index = 0; index < 40; index += 1) {
      progress = decoder.receive(encoder.nextPart());
      if (progress.complete) {
        break;
      }
    }
    expect(progress.complete).toBe(true);
    expect(progress.type).toBe('crypto-psbt');
    expect(signCryptoPsbt(seed, progress.cbor!).urKind).toBe('crypto-psbt');
    expect(() => previewCryptoPsbt(mnemonicToSeedSync(OTHER), cbor)).toThrow('errors.qrXfp');
  });

  it('does not treat an Ethereum account UR as a PSBT', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const encoded = encodeEthHdkeyUr(seed, 'CWS');
    const decoder = new FountainUrDecoder();
    const progress = decoder.receive(encoded.ur);
    expect(progress.success).toBe(true);
    expect(progress.type).toBe('crypto-hdkey');
    expect(() => decodeCryptoPsbt(progress.cbor!)).toThrow('errors.qrBadUr');
  });

  it('matches a P2WPKH input without derivation data', () => {
    const { seed, pub, fingerprint } = foundationKey();
    const parsed = parsePsbt(unsignedPsbt(fingerprint, pub));
    for (const key of [...parsed.inputMaps[0]!.keys()]) {
      if (key.startsWith('06')) {
        parsed.inputMaps[0]!.delete(key);
      }
    }
    const preview = previewCryptoPsbt(seed, encodeCryptoPsbtCbor(encodePsbt(parsed)));
    expect(preview.path).toBe(PATH);
    expect(scriptToAddress(p2wpkhScript(pub)).startsWith('bc1q')).toBe(true);
  });

  it('encodes a single-frame UR for a small unsigned PSBT', () => {
    const encoded = encodeCryptoPsbtUr(unsignedPsbt(), 400);
    expect(encoded.parts).toHaveLength(1);
    expect(encoded.ur.startsWith('ur:crypto-psbt/')).toBe(true);
  });

  it('signs every matching native SegWit input', () => {
    const { seed, pub, fingerprint } = foundationKey();
    const change = HDKey.fromMasterSeed(seed).derive("m/84'/0'/0'/1/0");
    const psbt = buildP2wpkhPsbt({
      amount: 80_000n,
      pubkey: pub,
      fingerprint,
      pathIndexes: PATH_INDEXES,
      outputScript: p2wpkhScript(pub),
      outputAmount: 150_000n,
      extraInputs: [
        {
          prevout: Uint8Array.of(...new Uint8Array(32).fill(7), 0, 0, 0, 1),
          amount: 80_000n,
          pubkey: change.publicKey!,
          pathIndexes: [0x80000054, 0x80000000, 0x80000000, 1, 0],
        },
      ],
    });
    const signed = parsePsbt(signPsbtBytes(seed, psbt).psbt);
    expect([...signed.inputMaps[0]!.keys()].some((key) => key.startsWith('02'))).toBe(true);
    expect([...signed.inputMaps[1]!.keys()].some((key) => key.startsWith('02'))).toBe(true);
  });

  it('signs nested SegWit, legacy, and taproot key-path inputs', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const master = HDKey.fromMasterSeed(seed);
    const fingerprint = masterFingerprint(master.publicKey!);
    const nested = master.derive("m/49'/0'/0'/0/0");
    const legacy = master.derive("m/44'/0'/0'/0/0");
    const tap = master.derive("m/86'/0'/0'/0/0");
    const pay = p2wpkhScript(foundationKey().pub);
    const nestedSigned = signPsbtBytes(
      seed,
      buildP2shP2wpkhPsbt({
        amount: 50_000n,
        pubkey: nested.publicKey!,
        fingerprint,
        pathIndexes: [0x80000031, 0x80000000, 0x80000000, 0, 0],
        outputScript: pay,
        outputAmount: 49_000n,
      }),
    );
    expect(nestedSigned.preview.path).toBe("m/49'/0'/0'/0/0");
    const legacySigned = signPsbtBytes(
      seed,
      buildP2pkhPsbt({
        amount: 50_000n,
        pubkey: legacy.publicKey!,
        fingerprint,
        pathIndexes: [0x8000002c, 0x80000000, 0x80000000, 0, 0],
        outputScript: pay,
        outputAmount: 49_000n,
      }),
    );
    expect(legacySigned.preview.path).toBe("m/44'/0'/0'/0/0");
    const tapSigned = signPsbtBytes(
      seed,
      buildP2trPsbt({
        amount: 50_000n,
        privateKey: tap.privateKey!,
        pubkey: tap.publicKey!,
        fingerprint,
        pathIndexes: [0x80000056, 0x80000000, 0x80000000, 0, 0],
        outputScript: pay,
        outputAmount: 49_000n,
      }),
    );
    expect(tapSigned.preview.path).toBe("m/86'/0'/0'/0/0");
    expect(parsePsbt(tapSigned.psbt).inputMaps[0]!.has('13')).toBe(true);
  });
});
