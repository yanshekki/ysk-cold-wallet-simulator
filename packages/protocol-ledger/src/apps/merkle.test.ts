import { describe, expect, it } from 'vitest';
import { MerkleTree, elementHash, merklizedMapCommitment, parseMapCommitment, verifyLeafProof } from './merkle';

describe('Ledger merkle trees', () => {
  it('verifies leaf proofs for a 3-element list', () => {
    const elements = [Uint8Array.of(1), Uint8Array.of(2, 2), Uint8Array.of(3, 3, 3)];
    const tree = new MerkleTree(elements.map(elementHash));
    for (let index = 0; index < elements.length; index += 1) {
      const proof = tree.proveLeaf(index);
      expect(verifyLeafProof(tree.get(index), index, tree.length, proof, tree.root)).toBe(true);
    }
  });

  it('serializes a merklized map commitment', () => {
    const map: Array<[Uint8Array, Uint8Array]> = [
      [Uint8Array.of(0x00), Uint8Array.of(1, 2, 3)],
      [Uint8Array.of(0x01), Uint8Array.of(4, 5)],
    ];
    const commitment = merklizedMapCommitment(map);
    const parsed = parseMapCommitment(commitment);
    expect(parsed.size).toBe(2);
    expect(parsed.keysRoot.length).toBe(32);
    expect(parsed.valuesRoot.length).toBe(32);
  });
});
