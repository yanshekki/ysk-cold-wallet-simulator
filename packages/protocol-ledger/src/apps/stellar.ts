import { catalogVersion } from '@cws/contracts';
import { encodeResponse, SW_OK, type Apdu } from '../apdu';
import {
  handleFamilyApdu,
  previewStellarEnvelope,
  versionTriple,
  type FamilyContext,
  type FamilySession,
  type FamilySpec,
} from './generic';

export type StellarSession = FamilySession;

/**
 * CLA/INS/chunking from @ledgerhq/hw-app-str `Str.ts` (Ledger Live develop):
 * P1_FIRST=0x00 P1_MORE=0x80; P2_LAST=0x00 P2_MORE=0x80.
 *
 * `get_configuration.rs` appends `MAX_RAW_DATA_LEN` as a big-endian u16.
 * `context.rs`: Nano X is `1024 * 4`; every other target is `1024 * 8`.
 */
function spec(modelId: string): FamilySpec {
  return {
    name: 'Stellar',
    clas: [0xe0],
    versionIns: [0x06],
    pubkeyIns: [0x02],
    signIns: [0x04, 0x08, 0x0a, 0x0c],
    curve: 'ed25519',
    versionBytes: () => {
      const version = versionTriple(catalogVersion('stellar', '6.1.0'));
      const maxDataSize = modelId === 'nano-x' ? 4096 : 8192;
      return Uint8Array.of(
        0x00,
        version[0]!,
        version[1]!,
        version[2]!,
        (maxDataSize >> 8) & 0xff,
        maxDataSize & 0xff,
      );
    },
    encodePubkey: (publicKey) => publicKey,
    preview: previewStellarEnvelope,
    chunkMode: 'p1-stellar',
  };
}

export function handleStellarApdu(
  apdu: Apdu,
  ctx: FamilyContext,
  session: StellarSession,
  modelId = 'nano-x',
) {
  const app = spec(modelId);
  // Confirm flag is P2 on the real Stellar app. HOT lists accounts without a slide.
  if (app.pubkeyIns.includes(apdu.ins)) {
    return handleFamilyApdu({ ...apdu, p1: 0x00 }, app, ctx, session);
  }
  if (app.versionIns.includes(apdu.ins) && apdu.data.length === 0) {
    return encodeResponse(app.versionBytes(), SW_OK);
  }
  return handleFamilyApdu(apdu, app, ctx, session);
}
