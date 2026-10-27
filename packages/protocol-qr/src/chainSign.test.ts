import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it } from 'vitest';
import { BbqrDecoder, encodeBbqr } from './bbqr';
import { encodeBtcSignRequestUr, decodeBtcSignRequest, signBtcMessage } from './btcMessage';
import { encodeCosmosSignRequestUr, decodeCosmosSignRequest, signCosmosRequest } from './cosmosSign';
import { FountainUrDecoder } from './ur';
import { encodeSolSignRequestUr, decodeSolSignRequest, signSolRequest } from './solSign';

const FOUNDATION = 'test test test test test test test test test test test junk';
const REQUEST_ID = Uint8Array.from(
  '9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d'.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
);

describe('chain QR signing', () => {
  it('round-trips Solana, Cosmos, and Bitcoin message requests', () => {
    const seed = mnemonicToSeedSync(FOUNDATION);
    const solUr = encodeSolSignRequestUr({
      requestId: REQUEST_ID,
      signData: new Uint8Array(32).fill(7),
      path: "m/44'/501'/0'/0'",
    });
    const solDec = new FountainUrDecoder().receive(solUr);
    expect(solDec.type).toBe('sol-sign-request');
    const sol = signSolRequest(seed, decodeSolSignRequest(solDec.cbor!));
    expect(sol.urKind).toBe('sol-signature');

    const atomUr = encodeCosmosSignRequestUr({
      requestId: REQUEST_ID,
      signData: new TextEncoder().encode('{"account_number":"1"}'),
      path: "m/44'/118'/0'/0/0",
    });
    const atomDec = new FountainUrDecoder().receive(atomUr);
    const atom = signCosmosRequest(seed, decodeCosmosSignRequest(atomDec.cbor!));
    expect(atom.urKind).toBe('cosmos-signature');

    const btcUr = encodeBtcSignRequestUr({
      requestId: REQUEST_ID,
      signData: new TextEncoder().encode('hello'),
      dataType: 2,
      path: "m/84'/0'/0'/0/0",
    });
    const btcDec = new FountainUrDecoder().receive(btcUr);
    const btc = signBtcMessage(seed, decodeBtcSignRequest(btcDec.cbor!));
    expect(btc.urKind).toBe('btc-signature');
  });

  it('reassembles BBQR frames', () => {
    const payload = new TextEncoder().encode('[{ "xpub": "xpub-test" }]');
    const frames = encodeBbqr('U', payload, 20).frames;
    expect(frames.length).toBeGreaterThan(1);
    const decoder = new BbqrDecoder();
    let progress = decoder.receive('nope');
    for (const frame of frames) {
      progress = decoder.receive(frame);
    }
    expect(progress.success).toBe(true);
    expect(new TextDecoder().decode(progress.payload)).toBe('[{ "xpub": "xpub-test" }]');
  });

  it('round-trips zlib BBQR encoding Z', () => {
    const payload = new TextEncoder().encode('coldcard zlib payload '.repeat(12));
    const single = encodeBbqr('P', payload, { encoding: 'Z' }).frames;
    expect(single[0]?.startsWith('B$ZP')).toBe(true);
    const one = new BbqrDecoder();
    const oneDone = single.reduce((_, frame) => one.receive(frame), one.receive(''));
    expect(oneDone.success).toBe(true);
    expect(new TextDecoder().decode(oneDone.payload)).toBe(new TextDecoder().decode(payload));

    const many = encodeBbqr('P', payload, { encoding: 'Z', maxPiece: 24 }).frames;
    expect(many.length).toBeGreaterThan(1);
    const decoder = new BbqrDecoder();
    let progress = decoder.receive(many[0]!);
    for (const frame of many.slice(1)) {
      progress = decoder.receive(frame);
    }
    expect(progress.success).toBe(true);
    expect(new TextDecoder().decode(progress.payload)).toBe(new TextDecoder().decode(payload));
  });

  it('rejects unknown BBQR encodings', () => {
    const decoder = new BbqrDecoder();
    const progress = decoder.receive('B$1P0001AA');
    expect(progress.complete).toBe(true);
    expect(progress.success).toBe(false);
    expect(progress.error).toBe('errors.qrUnsupported');
  });
});
