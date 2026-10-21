/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A decoded function's content key (#1353): what its IR is, whatever its place
 * in the stream, so that every function over one body runs one compiled body
 * (`finishDecodedFunction`, `CompiledBodies`).
 *
 * The key is not the IR's bytes. An IR's containers are mutable containers on
 * the wire, so an IR written twice in one stream is written in full the first
 * time and as back-references after (`REF` + a relative delta): the same body
 * has other bytes at each place it sits, and other bytes again once anything
 * before it changes. So the key folds the bytes between an IR's containers,
 * and each container — defined there or back-referenced — as the key of its
 * own content. A container's key is computed as it is read, kept by its
 * definition index, and folded wherever a later IR refers to it. The bytes
 * are folded from the buffer the decoder reads, between the points it
 * reports, so nothing is decoded twice and nothing walks the decoded IR.
 *
 * A function's key also holds the stream's source map as read so far, since a
 * compiled body resolves its location ids against the map it compiled under.
 *
 * The hash is 128 bits in four 32-bit lanes, each a rotate-multiply over the
 * bytes with its own multiplier and rotation, finished by murmur3's mix.
 *
 * @packageDocumentation
 */

/** Each lane's starting value. */
const SEED0 = 0x811c9dc5;
const SEED1 = 0x9e3779b9;
const SEED2 = 0x7f4a7c15;
const SEED3 = 0x3c6ef372;

/** Each lane's multiplier: odd, so every step is a bijection of the lane. */
const P0 = 0x01000193;
const P1 = 0x5bd1e995;
const P2 = 0x85ebca6b;
const P3 = 0xc2b2ae35;

/** Folded before a container's key: wider than a byte, so a key never folds as bytes do. */
const CONTAINER = 0x100;

/** Folds `x` into the four lanes at `at`. */
function step(lanes: Uint32Array, at: number, x: number): void {
  let v = lanes[at]! ^ x;
  lanes[at] = Math.imul((v << 13) | (v >>> 19), P0);
  v = lanes[at + 1]! ^ x;
  lanes[at + 1] = Math.imul((v << 15) | (v >>> 17), P1);
  v = lanes[at + 2]! ^ x;
  lanes[at + 2] = Math.imul((v << 17) | (v >>> 15), P2);
  v = lanes[at + 3]! ^ x;
  lanes[at + 3] = Math.imul((v << 19) | (v >>> 13), P3);
}

/** Folds `bytes[from, to)` into the four lanes at `at`. */
function foldBytes(lanes: Uint32Array, at: number, bytes: Uint8Array, from: number, to: number): void {
  let a = lanes[at]!, b = lanes[at + 1]!, c = lanes[at + 2]!, d = lanes[at + 3]!;
  for (let i = from; i < to; i++) {
    const x = bytes[i]!;
    let v = a ^ x;
    a = Math.imul((v << 13) | (v >>> 19), P0);
    v = b ^ x;
    b = Math.imul((v << 15) | (v >>> 17), P1);
    v = c ^ x;
    c = Math.imul((v << 17) | (v >>> 15), P2);
    v = d ^ x;
    d = Math.imul((v << 19) | (v >>> 13), P3);
  }
  lanes[at] = a;
  lanes[at + 1] = b;
  lanes[at + 2] = c;
  lanes[at + 3] = d;
}

/** Sets the four lanes at `at` to their seeds. */
function seed(lanes: Uint32Array, at: number): void {
  lanes[at] = SEED0;
  lanes[at + 1] = SEED1;
  lanes[at + 2] = SEED2;
  lanes[at + 3] = SEED3;
}

/** Murmur3's finishing mix of one lane. */
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Finishes the four lanes at `at` in place. */
function finish(lanes: Uint32Array, at: number): void {
  lanes[at] = mix(lanes[at]!);
  lanes[at + 1] = mix(lanes[at + 1]!);
  lanes[at + 2] = mix(lanes[at + 2]!);
  lanes[at + 3] = mix(lanes[at + 3]!);
}

/** The four lanes at `at`, finished, as 32 hex digits. */
function text(lanes: Uint32Array, at: number): string {
  let out = "";
  for (let i = at; i < at + 4; i++) out += mix(lanes[i]!).toString(16).padStart(8, "0");
  return out;
}

/** The content key of each container a decode's function IRs defined, by its definition index. */
export class ContainerKeys {
  /** Four lanes per definition index. */
  private lanes = new Uint32Array(1024);
  /** Whether a definition index has a key: only the containers an IR defined do. */
  private known = new Uint8Array(256);

  /**
   * Keeps the key of the container of definition index `def`.
   *
   * @param def - the container's definition index
   * @param from - the lanes holding its finished key
   * @param at - where in `from` its four lanes start
   */
  keep(def: number, from: Uint32Array, at: number): void {
    if (def >= this.known.length) this.grow(def);
    const o = def * 4;
    this.lanes[o] = from[at]!;
    this.lanes[o + 1] = from[at + 1]!;
    this.lanes[o + 2] = from[at + 2]!;
    this.lanes[o + 3] = from[at + 3]!;
    this.known[def] = 1;
  }

  /**
   * Folds the key of the container of definition index `def` into four lanes.
   *
   * @param def - the container's definition index
   * @param into - the lanes to fold it into
   * @param at - where in `into` the four lanes start
   * @returns whether the container has a key: one no function IR defined has none
   */
  fold(def: number, into: Uint32Array, at: number): boolean {
    if (def >= this.known.length || this.known[def] === 0) return false;
    const o = def * 4;
    step(into, at, CONTAINER);
    step(into, at, this.lanes[o]!);
    step(into, at, this.lanes[o + 1]!);
    step(into, at, this.lanes[o + 2]!);
    step(into, at, this.lanes[o + 3]!);
    return true;
  }

  /** Grows the table to hold definition index `def`. */
  private grow(def: number): void {
    let n = this.known.length;
    while (n <= def) n *= 2;
    const known = new Uint8Array(n);
    known.set(this.known);
    this.known = known;
    const lanes = new Uint32Array(n * 4);
    lanes.set(this.lanes);
    this.lanes = lanes;
  }
}

/**
 * One function IR's key, folded as the decoder reads the IR: the decoder tells
 * it where each container is defined, back-referenced and closed, and the
 * bytes between are folded at those points.
 *
 * @remarks
 * One per decode, used again for each IR: an IR holds no function value, so
 * no other IR is read while one is.
 */
export class IrKey {
  /** Four lanes per depth: the IR's own at depth 0, then each container open in it. */
  private lanes = new Uint32Array(64);
  /** The definition index of the container open at each depth from 1. */
  private readonly defs: number[] = [];
  private depth = 0;
  /** The bytes the IR is read from. */
  private bytes: Uint8Array = new Uint8Array(0);
  /** The offset of `bytes` folded so far. */
  private folded = 0;
  /** Whether the IR back-references a container no function IR defined: such an IR has no key. */
  private keyless = false;

  /** @param containers - the keys of the containers the decode's IRs defined */
  constructor(private readonly containers: ContainerKeys) {}

  /**
   * Starts the key of an IR read from `bytes` at `start`.
   *
   * @param bytes - the logical bytes the IR is read from
   * @param start - the IR's first byte
   */
  begin(bytes: Uint8Array, start: number): void {
    this.bytes = bytes;
    this.folded = start;
    this.depth = 0;
    this.defs.length = 0;
    this.keyless = false;
    seed(this.lanes, 0);
  }

  /**
   * A container defined at `at`: its tag is that one byte, its content follows.
   *
   * @param at - the offset of its tag
   * @param def - its definition index
   */
  open(at: number, def: number): void {
    this.foldTo(at);
    this.folded = at + 1;
    this.depth++;
    const o = this.depth * 4;
    if (o + 4 > this.lanes.length) {
      const lanes = new Uint32Array(this.lanes.length * 2);
      lanes.set(this.lanes);
      this.lanes = lanes;
    }
    seed(this.lanes, o);
    this.defs.push(def);
  }

  /**
   * A back-reference, read from `at` to `end`, to an earlier container.
   *
   * @param at - the offset of its tag
   * @param end - the offset after its delta
   * @param def - the definition index it resolves to
   */
  ref(at: number, end: number, def: number): void {
    this.foldTo(at);
    this.folded = end;
    if (!this.containers.fold(def, this.lanes, this.depth * 4)) this.keyless = true;
  }

  /**
   * The innermost open container's content ends at `end`: its key is kept by
   * its definition index and folded into the container around it.
   *
   * @param end - the offset after its content
   */
  close(end: number): void {
    this.foldTo(end);
    const o = this.depth * 4;
    finish(this.lanes, o);
    this.containers.keep(this.defs.pop()!, this.lanes, o);
    this.depth--;
    const p = this.depth * 4;
    step(this.lanes, p, CONTAINER);
    step(this.lanes, p, this.lanes[o]!);
    step(this.lanes, p, this.lanes[o + 1]!);
    step(this.lanes, p, this.lanes[o + 2]!);
    step(this.lanes, p, this.lanes[o + 3]!);
  }

  /**
   * The IR's key, once it is read to `end`.
   *
   * @param end - the offset after the IR
   * @returns its 32 hex digits, or `undefined` when it back-references a container no function IR defined
   */
  end(end: number): string | undefined {
    this.foldTo(end);
    return this.keyless || this.depth !== 0 ? undefined : text(this.lanes, 0);
  }

  /** Folds the bytes read since the last point up to `to`. */
  private foldTo(to: number): void {
    foldBytes(this.lanes, this.depth * 4, this.bytes, this.folded, to);
    this.folded = to;
  }
}

/**
 * What one decode keys its functions by (#1353): the keys of the containers
 * its function IRs defined, the key of the IR being read, and the stream's
 * source map as read so far.
 *
 * @remarks
 * The map is folded as its stacks' own bytes — those after the header
 * section's length and count, and after each inline delta's count — so a map
 * keys alike however a writer split it between the header and the stream.
 *
 * Every whole-value decode has one, and most decode no function: what it
 * keeps is made when it meets its first, so a decode of data pays nothing.
 */
export class BodyKeys {
  /** The keys of the containers the decode's IRs defined, once it meets a function. */
  private containers: ContainerKeys | undefined;
  /** The function IR being read, begun again for each; made with `containers`. */
  private irKey: IrKey | undefined;
  /** The source map's lanes as read so far, once it meets a function. */
  private map: Uint32Array | undefined;
  /** The source map's key as read so far, as 32 hex digits; `undefined` until asked for, and after it grows. */
  private mapKey: string | undefined;

  /**
   * @param bytes - the blob, holding the header's source map section
   * @param section - the offset of the section, at its length
   * @param end - the offset after the section
   */
  constructor(private readonly bytes: Uint8Array, private readonly section: number, private readonly end: number) {}

  /** The key of the function IR being read; begun again for each. */
  get ir(): IrKey {
    if (this.irKey === undefined) {
      this.containers = new ContainerKeys();
      this.irKey = new IrKey(this.containers);
    }
    return this.irKey;
  }

  /**
   * Folds the stacks the stream's source map gained mid-stream (a function's
   * inline delta).
   *
   * @param bytes - the logical bytes the delta was read from
   * @param from - the offset of its first stack
   * @param to - the offset after its last
   */
  addStacks(bytes: Uint8Array, from: number, to: number): void {
    foldBytes(this.mapLanes(), 0, bytes, from, to);
    this.mapKey = undefined;
  }

  /**
   * A function's key: its IR's, read to `end`, and the source map's so far.
   *
   * @param end - the offset after the function's IR
   * @returns the key, or `undefined` when its IR back-references a container no function IR defined
   */
  keyOf(end: number): string | undefined {
    const ir = this.ir.end(end);
    if (ir === undefined) return undefined;
    this.mapKey ??= text(this.mapLanes(), 0);
    return ir + this.mapKey;
  }

  /** The source map's lanes, the header's stacks folded in the first time they are asked for. */
  private mapLanes(): Uint32Array {
    if (this.map === undefined) {
      this.map = new Uint32Array(4);
      seed(this.map, 0);
      // The stacks follow the section's length and its count, two varints.
      let at = this.section;
      while ((this.bytes[at++]! & 0x80) !== 0) { /* the length's next byte */ }
      while ((this.bytes[at++]! & 0x80) !== 0) { /* the count's next byte */ }
      foldBytes(this.map, 0, this.bytes, at, this.end);
    }
    return this.map;
  }
}
