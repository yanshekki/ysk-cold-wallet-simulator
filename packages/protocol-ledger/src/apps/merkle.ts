import { sha256 } from '@noble/hashes/sha2';
import { concatBytes } from '../bytes';

export const SW_INTERRUPTED = 0xe000;
export const CLA_FRAMEWORK = 0xf8;
export const INS_CONTINUE = 0x01;

export const ClientCommand = {
  YIELD: 0x10,
  GET_PREIMAGE: 0x40,
  GET_MERKLE_LEAF_PROOF: 0x41,
  GET_MERKLE_LEAF_INDEX: 0x42,
  GET_MORE_ELEMENTS: 0xa0,
} as const;

const NIL = new Uint8Array(32);

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index]! ^ b[index]!;
  }
  return diff === 0;
}

export function writeVarint(value: number): Uint8Array {
  if (value < 0xfd) {
    return Uint8Array.of(value);
  }
  if (value <= 0xffff) {
    return Uint8Array.of(0xfd, value & 0xff, value >> 8);
  }
  return Uint8Array.of(0xfe, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
}

export function readVarint(bytes: Uint8Array, offset = 0): { value: number; next: number } {
  const first = bytes[offset];
  if (first === undefined) {
    throw new Error('truncated varint');
  }
  if (first < 0xfd) {
    return { value: first, next: offset + 1 };
  }
  if (first === 0xfd) {
    return { value: bytes[offset + 1]! | (bytes[offset + 2]! << 8), next: offset + 3 };
  }
  if (first === 0xfe) {
    return {
      value:
        bytes[offset + 1]! |
        (bytes[offset + 2]! << 8) |
        (bytes[offset + 3]! << 16) |
        (bytes[offset + 4]! << 24),
      next: offset + 5,
    };
  }
  throw new Error('varint too large');
}

export function elementHash(preimage: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(0x00), preimage));
}

export function combineHashes(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(0x01), left, right));
}

function largestPowerOf2LessThan(n: number): number {
  let p = 1;
  while (p * 2 < n) {
    p *= 2;
  }
  return p;
}

type MerkleNode = {
  left: MerkleNode | null;
  right: MerkleNode | null;
  parent: MerkleNode | null;
  value: Uint8Array;
};

function makeTree(leaves: MerkleNode[], begin: number, size: number): MerkleNode {
  if (size === 1) {
    return leaves[begin]!;
  }
  const leftSize = largestPowerOf2LessThan(size);
  const left = makeTree(leaves, begin, leftSize);
  const right = makeTree(leaves, begin + leftSize, size - leftSize);
  const root: MerkleNode = {
    left,
    right,
    parent: null,
    value: combineHashes(left.value, right.value),
  };
  left.parent = root;
  right.parent = root;
  return root;
}

export class MerkleTree {
  readonly leaves: MerkleNode[];
  readonly rootNode: MerkleNode | null;

  constructor(elements: Iterable<Uint8Array>) {
    this.leaves = Array.from(elements, (value) => ({ left: null, right: null, parent: null, value }));
    this.rootNode = this.leaves.length ? makeTree(this.leaves, 0, this.leaves.length) : null;
  }

  get length(): number {
    return this.leaves.length;
  }

  get root(): Uint8Array {
    return this.rootNode ? this.rootNode.value : NIL;
  }

  get(index: number): Uint8Array {
    return this.leaves[index]!.value;
  }

  leafIndex(hash: Uint8Array): number {
    const index = this.leaves.findIndex((leaf) => bytesEqual(leaf.value, hash));
    if (index < 0) {
      throw new Error('leaf not found');
    }
    return index;
  }

  proveLeaf(index: number): Uint8Array[] {
    const proof: Uint8Array[] = [];
    let node: MerkleNode | null = this.leaves[index] ?? null;
    while (node?.parent) {
      const sibling = node.parent.left === node ? node.parent.right : node.parent.left;
      if (sibling) {
        proof.push(sibling.value);
      }
      node = node.parent;
    }
    return proof;
  }
}

function pathFromLeaf(index: number, size: number): Array<'L' | 'R'> {
  const path: Array<'L' | 'R'> = [];
  const walk = (cursor: number, remaining: number) => {
    if (remaining <= 1) {
      return;
    }
    const leftSize = largestPowerOf2LessThan(remaining);
    if (cursor < leftSize) {
      walk(cursor, leftSize);
      path.push('L');
    } else {
      walk(cursor - leftSize, remaining - leftSize);
      path.push('R');
    }
  };
  walk(index, size);
  return path;
}

export function verifyLeafProof(leaf: Uint8Array, index: number, size: number, proof: Uint8Array[], root: Uint8Array): boolean {
  if (size <= 0 || index >= size) {
    return false;
  }
  const path = pathFromLeaf(index, size);
  if (path.length !== proof.length) {
    return false;
  }
  let hash = leaf;
  for (let offset = 0; offset < path.length; offset += 1) {
    const sibling = proof[offset];
    if (!sibling) {
      return false;
    }
    hash = path[offset] === 'L' ? combineHashes(hash, sibling) : combineHashes(sibling, hash);
  }
  return bytesEqual(hash, root);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) {
      return a[index]! - b[index]!;
    }
  }
  return a.length - b.length;
}

export function sortedMapEntries(map: Map<Uint8Array, Uint8Array> | Array<[Uint8Array, Uint8Array]>): Array<[Uint8Array, Uint8Array]> {
  const entries = Array.isArray(map) ? [...map] : Array.from(map.entries());
  entries.sort((left, right) => compareBytes(left[0], right[0]));
  return entries;
}

export function merklizedMapCommitment(map: Map<Uint8Array, Uint8Array> | Array<[Uint8Array, Uint8Array]>): Uint8Array {
  const entries = sortedMapEntries(map);
  const keys = new MerkleTree(entries.map(([key]) => elementHash(key)));
  const values = new MerkleTree(entries.map(([, value]) => elementHash(value)));
  return concatBytes(writeVarint(entries.length), keys.root, values.root);
}

export function parseMapCommitment(bytes: Uint8Array, offset = 0): {
  size: number;
  keysRoot: Uint8Array;
  valuesRoot: Uint8Array;
  next: number;
} {
  const size = readVarint(bytes, offset);
  const keysRoot = bytes.subarray(size.next, size.next + 32);
  const valuesRoot = bytes.subarray(size.next + 32, size.next + 64);
  if (keysRoot.length !== 32 || valuesRoot.length !== 32) {
    throw new Error('truncated map commitment');
  }
  return { size: size.value, keysRoot, valuesRoot, next: size.next + 64 };
}

export type ByteMap = Array<[Uint8Array, Uint8Array]>;

export class ClientCommandInterpreter {
  readonly knownPreimages = new Map<string, Uint8Array>();
  readonly knownTrees = new Map<string, MerkleTree>();
  readonly yielded: Uint8Array[] = [];
  private queue: Uint8Array[] = [];

  addKnownPreimage(element: Uint8Array): void {
    this.knownPreimages.set(hexOf(sha256(element)), element);
  }

  addKnownList(elements: Uint8Array[]): void {
    for (const element of elements) {
      this.addKnownPreimage(concatBytes(Uint8Array.of(0x00), element));
    }
    const tree = new MerkleTree(elements.map(elementHash));
    this.knownTrees.set(hexOf(tree.root), tree);
  }

  addKnownMapping(map: Map<Uint8Array, Uint8Array> | ByteMap): void {
    const entries = sortedMapEntries(map);
    this.addKnownList(entries.map(([key]) => key));
    this.addKnownList(entries.map(([, value]) => value));
  }

  execute(request: Uint8Array): Uint8Array {
    const code = request[0];
    if (code === ClientCommand.YIELD) {
      this.yielded.push(request.subarray(1));
      return new Uint8Array();
    }
    if (code === ClientCommand.GET_PREIMAGE) {
      return this.getPreimage(request);
    }
    if (code === ClientCommand.GET_MERKLE_LEAF_PROOF) {
      return this.getLeafProof(request);
    }
    if (code === ClientCommand.GET_MERKLE_LEAF_INDEX) {
      return this.getLeafIndex(request);
    }
    if (code === ClientCommand.GET_MORE_ELEMENTS) {
      return this.getMore();
    }
    throw new Error(`unknown client command 0x${code?.toString(16)}`);
  }

  private getPreimage(request: Uint8Array): Uint8Array {
    if (request[1] !== 0) {
      throw new Error('unsupported preimage request');
    }
    const hash = request.subarray(2, 34);
    const preimage = this.knownPreimages.get(hexOf(hash));
    if (!preimage) {
      throw new Error(`unknown preimage ${hexOf(hash)}`);
    }
    const length = writeVarint(preimage.length);
    const maxPayload = 255 - length.length - 1;
    const payloadSize = Math.min(maxPayload, preimage.length);
    if (payloadSize < preimage.length) {
      this.queue = Array.from(preimage.subarray(payloadSize), (byte) => Uint8Array.of(byte));
    }
    return concatBytes(length, Uint8Array.of(payloadSize), preimage.subarray(0, payloadSize));
  }

  private getLeafProof(request: Uint8Array): Uint8Array {
    let offset = 1;
    const root = request.subarray(offset, offset + 32);
    offset += 32;
    const size = readVarint(request, offset);
    const index = readVarint(request, size.next);
    const tree = this.knownTrees.get(hexOf(root));
    if (!tree || index.value >= size.value || tree.length !== size.value) {
      throw new Error('unknown merkle leaf');
    }
    const proof = tree.proveLeaf(index.value);
    const nResponse = Math.min(Math.floor((255 - 32 - 1 - 1) / 32), proof.length);
    if (nResponse < proof.length) {
      this.queue = proof.slice(nResponse);
    }
    return concatBytes(
      tree.get(index.value),
      Uint8Array.of(proof.length, nResponse),
      ...proof.slice(0, nResponse),
    );
  }

  private getLeafIndex(request: Uint8Array): Uint8Array {
    const root = request.subarray(1, 33);
    const leaf = request.subarray(33, 65);
    const tree = this.knownTrees.get(hexOf(root));
    if (!tree) {
      throw new Error('unknown merkle root');
    }
    try {
      const index = tree.leafIndex(leaf);
      return concatBytes(Uint8Array.of(1), writeVarint(index));
    } catch {
      return concatBytes(Uint8Array.of(0), writeVarint(0));
    }
  }

  private getMore(): Uint8Array {
    if (!this.queue.length) {
      throw new Error('empty queue');
    }
    const elementLen = this.queue[0]!.length;
    const response: Uint8Array[] = [];
    let added = 0;
    let total = 0;
    while (this.queue.length && total + elementLen <= 253) {
      const next = this.queue.shift()!;
      response.push(next);
      total += next.length;
      added += 1;
    }
    return concatBytes(Uint8Array.of(added, elementLen), ...response);
  }
}

export function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function psbtMapsToByteMaps(maps: Array<Map<string, Uint8Array>>): ByteMap[] {
  return maps.map((map) => Array.from(map.entries(), ([key, value]) => [fromHex(key), value] as [Uint8Array, Uint8Array]));
}

export function encodeSignPsbtCommand(
  global: ByteMap,
  inputs: ByteMap[],
  outputs: ByteMap[],
  walletId: Uint8Array,
  walletHmac = new Uint8Array(32),
): Uint8Array {
  const inputCommitments = inputs.map(merklizedMapCommitment);
  const outputCommitments = outputs.map(merklizedMapCommitment);
  return concatBytes(
    merklizedMapCommitment(global),
    writeVarint(inputs.length),
    new MerkleTree(inputCommitments.map(elementHash)).root,
    writeVarint(outputs.length),
    new MerkleTree(outputCommitments.map(elementHash)).root,
    walletId,
    walletHmac,
  );
}

export function prepareSignPsbtInterpreter(
  interpreter: ClientCommandInterpreter,
  global: ByteMap,
  inputs: ByteMap[],
  outputs: ByteMap[],
  walletSerialize: Uint8Array,
  descriptorTemplate: string,
  keysInfo: string[],
): void {
  interpreter.addKnownPreimage(walletSerialize);
  interpreter.addKnownPreimage(new TextEncoder().encode(descriptorTemplate));
  interpreter.addKnownList(keysInfo.map((info) => new TextEncoder().encode(info)));
  interpreter.addKnownMapping(global);
  for (const map of inputs) {
    interpreter.addKnownMapping(map);
  }
  for (const map of outputs) {
    interpreter.addKnownMapping(map);
  }
  interpreter.addKnownList(inputs.map(merklizedMapCommitment));
  interpreter.addKnownList(outputs.map(merklizedMapCommitment));
}
