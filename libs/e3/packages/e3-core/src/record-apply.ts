/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Applying a mutation delta — the write path that costs what a write touched.
 *
 * A delta is one sorted collection of every target's changes addressed by key:
 * the record's own collection under `primary`, and one arm per secondary index.
 * Applying it never rebuilds a target, and never holds one whole. For each arm
 * the touched keys bisect against that target's segment fences, group by
 * segment, and rewrite only the segments they fall in — the rest of the
 * manifest names the objects it already named, which a content-addressed store
 * stores once.
 *
 * The segments that come out are the segments a rebuild would write, byte for
 * byte. That is a property of the boundary rule rather than of this code:
 * segmentation is a pure function of the value, so re-cutting an edited run
 * reproduces the rebuild's boundaries as soon as the two agree on where the run
 * BEGINS and where it ENDS — the two conditions this module grows a run until
 * it meets.
 *
 * @packageDocumentation
 */

import {
  ConflictError,
  SortedMap,
  SortedSet,
  applyFor,
  carveBeast2,
  compareFor,
  decodeBeast2For,
  encodeBeast2FenceFor,
  encodeBeast2PagedFor,
  openBeast2PagesFor,
  readBeast2Extents,
  readBeast2SegmentLogicalBytes,
  segmentKeyTypeOf,
  segmentRuleFor,
  startsSegmentAfter,
  variant,
  type Beast2Extents,
  type EastTypeValue,
} from '@elaraai/east';
import {
  COLLECTION_MANIFEST_KIND,
  encodeCollectionManifest,
  type CollectionManifest,
  type CollectionManifestEntry,
} from '@elaraai/e3-types';
import { DatasetSegments, cutDatasetIntoStore } from './dataset-open.js';
import type { StorageBackend } from './storage/interfaces.js';

/** One arm of a delta: the target it addresses and its ops in key order. */
interface DeltaArm {
  /** `primary`, or an index name. */
  target: string;
  /** `[key, op]` pairs in the target's own key order. */
  ops: Array<[unknown, unknown]>;
}

/** A delta could not be applied to the state it was handed: the key it
 *  disagreed on is in the message. */
export class DeltaConflictError extends Error {
  constructor(target: string, message: string) {
    super(`${target}: ${message}`);
    this.name = 'DeltaConflictError';
  }
}

/**
 * Apply a mutation delta to a record's targets.
 *
 * @remarks
 * Streams the delta arm by arm — its canonical order puts each target's ops in
 * one contiguous run — so nothing bigger than one target's ops and one of its
 * segments is ever held. A target the delta does not name keeps the manifest
 * hash it had.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param targets - target name -> the manifest hash it currently holds
 * @param deltaHash - the delta object's content hash
 * @returns target name -> its new manifest hash, for the targets that changed
 * @throws {DeltaConflictError} When an op disagrees with the state it lands on
 *   — the stale-write signal, never a silent clobber.
 * @throws {Error} When the delta names a target the record does not have.
 */
export async function applyDelta(
  storage: StorageBackend,
  repo: string,
  targets: Map<string, string>,
  deltaHash: string,
): Promise<Map<string, string>> {
  const written = new Map<string, string>();
  for await (const arm of readDeltaArms(storage, repo, deltaHash)) {
    const hash = targets.get(arm.target);
    if (hash === undefined) {
      throw new Error(
        `the mutation delta names target '${arm.target}', which this record does not hold` +
        ` — it has ${[...targets.keys()].join(', ')}`);
    }
    written.set(arm.target, await applyArm(storage, repo, hash, arm));
  }
  return written;
}

/**
 * Reads a delta arm by arm.
 *
 * @remarks
 * A delta's key is `variant(target, key)` and variant values order by case
 * NAME, so every target's ops are one contiguous ascending run — which is why
 * an arm can be yielded as soon as the target changes, and why the ops inside
 * one arrive in the order the target's own segments are laid out.
 */
async function* readDeltaArms(
  storage: StorageBackend,
  repo: string,
  deltaHash: string,
): AsyncIterable<DeltaArm> {
  const delta = await DatasetSegments.open(storage, repo, deltaHash);
  const decode = decodeBeast2For(delta.typeValue) as (bytes: Uint8Array) => SortedMap<unknown, unknown>;
  let open: DeltaArm | null = null;
  for (let i = 0; i < delta.segmentCount; i++) {
    for (const [key, op] of decode(await delta.segment(i))) {
      const { type: target, value: targetKey } = key as { type: string; value: unknown };
      if (open !== null && open.target !== target) {
        yield open;
        open = null;
      }
      open ??= { target, ops: [] };
      open.ops.push([targetKey, (op as { value: unknown }).value]);
    }
  }
  if (open !== null) yield open;
}

/** What one target's arm of a delta did, by op. */
export interface DeltaArmSummary {
  /** `primary`, or an index name. */
  target: string;
  insert: number;
  update: number;
  delete: number;
}

/**
 * What a delta changed, per target — what `e3 history --delta` prints.
 *
 * @remarks
 * Reads the delta the way the apply does, so it costs one pass over an object
 * that is O(what the mutation touched) rather than a diff of two states.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param deltaHash - the delta object's content hash
 * @returns one summary per target the delta names, in canonical order
 */
export async function summarizeDelta(
  storage: StorageBackend,
  repo: string,
  deltaHash: string,
): Promise<DeltaArmSummary[]> {
  const summaries: DeltaArmSummary[] = [];
  for await (const arm of readDeltaArms(storage, repo, deltaHash)) {
    const summary: DeltaArmSummary = { target: arm.target, insert: 0, update: 0, delete: 0 };
    for (const [, op] of arm.ops) {
      const tag = (op as { type: string }).type;
      if (tag === 'insert' || tag === 'update' || tag === 'delete') summary[tag]++;
    }
    summaries.push(summary);
  }
  return summaries;
}

/**
 * Rewrite one target's touched segments and write its new manifest.
 *
 * @returns the new manifest object's hash
 */
async function applyArm(
  storage: StorageBackend,
  repo: string,
  hash: string,
  arm: DeltaArm,
): Promise<string> {
  const segments = await DatasetSegments.open(storage, repo, hash);
  const typeValue = segments.typeValue;
  const keyType = segmentKeyTypeOf(typeValue);
  if (keyType === null) {
    throw new Error(`a mutation delta addresses Set and Dict targets by key; '${arm.target}' holds Array`);
  }
  const fenceOf = encodeBeast2FenceFor(keyType);
  const keyCompare = compareFor(keyType as never) as (a: unknown, b: unknown) => number;
  const apply = applyFor(typeValue);
  const decodeRun = decodeBeast2For(typeValue) as (bytes: Uint8Array) => unknown;
  const encodeRun = encodeBeast2PagedFor(typeValue) as (value: unknown) => Uint8Array;
  const sink = (bytes: Uint8Array): Promise<string> => storage.objects.write(repo, bytes);

  if (segments.manifest?.rule !== segmentRuleFor(typeValue)) {
    // Cut under another rule — an earlier version of this one, or a legacy
    // blob's own geometry. A re-cut run lines up with the segments around it
    // only when both were cut by the same rule, so the first write lays the
    // whole value out under the current one, once; the writes after it are
    // incremental again.
    const ops = new SortedMap<unknown, unknown>(undefined, keyCompare);
    for (const [key, op] of arm.ops) ops.set(key, op);
    const before = segments.segmentCount === 0
      ? emptyOf(typeValue, keyCompare)
      : decodeRun(await segments.span(0, segments.segmentCount));
    return cutDatasetIntoStore(storage, repo, encodeRun(applyOps(apply, arm.target, before, ops)));
  }

  // Which segment each touched key falls in. A key before every fence lands in
  // segment 0 and one past them all in the last, so an insert always has a
  // segment to join — that is what makes a growing collection re-cut rather
  // than accumulate a segment per write.
  const bySegment = new Map<number, Array<[unknown, unknown]>>();
  for (const [key, op] of arm.ops) {
    const i = segments.segmentCount === 0 ? 0 : await segments.segmentFor(key);
    const held = bySegment.get(i);
    if (held === undefined) bySegment.set(i, [[key, op]]);
    else held.push([key, op]);
  }

  // A run may only BEGIN at a fence the delta leaves standing. A re-cut run is
  // encoded from a fresh cutter, so its first element opens a segment; a
  // rebuild opens one there only because the segment before it said so, and
  // deleting that fence takes the reason away. So a deleted fence glues its
  // segment to the one before: that segment joins the run, which therefore
  // begins at a fence still standing, and the run may not END at the deleted
  // one either. Walked descending, so a chain of deleted fences is followed
  // all the way left. A fence is its segment's smallest key and a delta holds
  // one op per key, so its delete is the first op that segment has.
  const glued = new Set<number>();
  for (const i of [...bySegment.keys()].sort((a, b) => b - a)) {
    if (i === 0) continue;
    const [key, op] = bySegment.get(i)![0]!;
    if ((op as { type: string }).type !== 'delete') continue;
    if (keyCompare(key, await segments.fence(i)) !== 0) continue;
    glued.add(i);
    if (!bySegment.has(i - 1)) bySegment.set(i - 1, []);
  }
  const touched = [...bySegment.keys()].sort((a, b) => a - b);

  const entries: CollectionManifestEntry[] = [];
  let header: Uint8Array | null = null;
  let at = 0;   // the first segment not yet carried over or rewritten
  let next = 0; // index into `touched`

  while (next < touched.length) {
    const lo = touched[next]!;
    for (let i = at; i < lo; i++) entries.push(await carryOver(segments, i, fenceOf, sink));
    at = lo;

    // Extend the run to the right past every segment whose fence is going
    // away, and then until the re-cut agrees with the old cut about where the
    // run ENDS. It always terminates: the collection's last segment holds
    // whatever is left, so a run reaching the end is clean.
    let hi = lo + 1;
    let last = next;
    for (;;) {
      while (last + 1 < touched.length && touched[last + 1]! < hi) last++;
      const ops = new SortedMap<unknown, unknown>(undefined, keyCompare);
      for (let i = lo; i < hi; i++) {
        for (const [key, op] of bySegment.get(i) ?? []) ops.set(key, op);
      }
      const before = segments.segmentCount === 0
        ? emptyOf(typeValue, keyCompare)
        : decodeRun(await segments.span(lo, Math.min(hi, segments.segmentCount)));
      const blob = encodeRun(applyOps(apply, arm.target, before, ops));
      const extents = readBeast2Extents(blob);
      const counts = [...extents.counts];
      const empty = counts.length === 0 || counts.every((c) => c === 0);
      if (hi < segments.segmentCount
        && (glued.has(hi) || !endsClean(blob, extents, empty, await fenceBytes(segments, hi, fenceOf)))) {
        hi++;
        continue;
      }
      header ??= blob.subarray(0, extents.prefixEnd);
      if (!empty) {
        const pages = openBeast2PagesFor(typeValue)(blob);
        for (let i = 0; i < counts.length; i++) {
          const segment = carveBeast2(blob, i, i + 1, extents);
          entries.push({
            hash: await sink(segment),
            fence: fenceOf(pages.fence(i)),
            count: BigInt(counts[i]!),
            bytes: BigInt(segment.byteLength),
          });
        }
      }
      at = Math.min(hi, segments.segmentCount);
      next = last + 1;
      break;
    }
  }
  for (let i = at; i < segments.segmentCount; i++) entries.push(await carryOver(segments, i, fenceOf, sink));

  if (entries.length === 0) {
    // Everything was deleted. What a rebuild writes for an empty collection is
    // whatever the encoder door writes for one, so ask it rather than guess.
    const blob = encodeRun(emptyOf(typeValue, keyCompare));
    const extents = readBeast2Extents(blob);
    header = blob.subarray(0, extents.prefixEnd);
    for (let i = 0; i < extents.counts.length; i++) {
      const segment = carveBeast2(blob, i, i + 1, extents);
      entries.push({
        hash: await sink(segment),
        fence: new Uint8Array(0),
        count: BigInt(extents.counts[i]!),
        bytes: BigInt(segment.byteLength),
      });
    }
  }

  const manifest: CollectionManifest = {
    kind: COLLECTION_MANIFEST_KIND,
    level: 0n,
    type: typeValue,
    rule: segmentRuleFor(typeValue),
    header: segments.manifest !== null
      ? segments.manifest.header
      : await sink(header ?? await segments.head()),
    entries,
  };
  return sink(encodeCollectionManifest(manifest));
}

/** A run with the arm's ops applied; an op that disagrees with the run is the
 *  stale-write conflict, reported against the target. */
function applyOps(
  apply: (value: unknown, patch: unknown) => unknown,
  target: string,
  before: unknown,
  ops: SortedMap<unknown, unknown>,
): unknown {
  try {
    return apply(before, variant('patch', ops));
  } catch (err) {
    if (err instanceof ConflictError) throw new DeltaConflictError(target, err.message);
    throw err;
  }
}

/** Whether a re-cut run leaves the cutter where the old cut left it — so that
 *  the element after the run starts a segment there too, and every segment
 *  past the run is unchanged. */
function endsClean(blob: Uint8Array, extents: Beast2Extents, empty: boolean, nextFence: Uint8Array): boolean {
  // Emptying a run deletes the fence it began at, which glued it to the
  // segment before — so a run that empties is one that begins the value, and
  // whatever follows it becomes the value's first element and opens its first
  // segment.
  if (empty) return true;
  const last = extents.counts.length - 1;
  return startsSegmentAfter(extents.counts[last]!, readBeast2SegmentLogicalBytes(blob, extents)[last]!, nextFence);
}

/** Segment `i`'s fence in canonical bare bytes — free from a manifest, which
 *  stores them in exactly that form. */
async function fenceBytes(
  segments: DatasetSegments,
  i: number,
  fenceOf: (value: unknown) => Uint8Array,
): Promise<Uint8Array> {
  return segments.manifest?.entries[i]?.fence ?? fenceOf(await segments.fence(i));
}

/** A manifest entry for a segment nothing touched: the object it already
 *  names, re-announced to the sink so a store that needs the write sees it and
 *  a content-addressed one does nothing. */
async function carryOver(
  segments: DatasetSegments,
  i: number,
  fenceOf: (value: unknown) => Uint8Array,
  sink: (bytes: Uint8Array) => Promise<string>,
): Promise<CollectionManifestEntry> {
  const entry = segments.manifest?.entries[i];
  if (entry !== undefined) return entry;
  const bytes = await segments.segment(i);
  return {
    hash: await sink(bytes),
    fence: fenceOf(await segments.fence(i)),
    count: BigInt(segments.counts[i]!),
    bytes: BigInt(bytes.byteLength),
  };
}

/** An empty value of a target's collection type, in its own key order. */
function emptyOf(typeValue: EastTypeValue, keyCompare: (a: unknown, b: unknown) => number): unknown {
  return typeValue.type === 'Set'
    ? new SortedSet<unknown>(undefined, keyCompare)
    : new SortedMap<unknown, unknown>(undefined, keyCompare);
}
