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
 * segment, and only the segments they fall in are decoded and edited — the
 * rest of the manifest names the objects it already named, which a
 * content-addressed store stores once.
 *
 * The segments that come out are the segments a rebuild would write, byte for
 * byte. That is a property of the boundary rule rather than of this code:
 * segmentation is a pure function of the value, so the re-cut carries every
 * untouched segment over wherever the edited value still starts a segment at
 * it, and re-cuts only between the edits and the first such segment on each
 * side.
 *
 * @packageDocumentation
 */

import {
  ConflictError,
  SortedMap,
  SortedSet,
  applyFor,
  compareFor,
  decodeBeast2For,
  segmentKeyTypeOf,
  variant,
  type EastTypeValue,
} from '@elaraai/east';
import { DatasetSegments } from './dataset-open.js';
import { storeCollection, type CollectionSource } from './store-collection.js';
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
 * Edit one target's touched segments, re-cut them into the segments around
 * them, and write its new manifest.
 *
 * @remarks
 * The target goes through the store's door as the runs of segments no op
 * touches, as they are stored, and each touched segment's elements with the
 * ops applied. A run cut by the current rule is carried over wherever the
 * edited value still starts a segment at it; one cut under another rule — an
 * earlier version of this one, or a legacy blob's own geometry — is read and
 * written again, so a target's first write lays it out under the current rule
 * and the writes after it are incremental.
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
  const keyCompare = compareFor(keyType as never) as (a: unknown, b: unknown) => number;
  const apply = applyFor(typeValue);
  const decodeSegment = decodeBeast2For(typeValue) as (bytes: Uint8Array) => unknown;

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
  const edited = [...bySegment.keys()].sort((a, b) => a - b);

  /** Segment `i` with its ops applied, as elements. */
  async function* editedElements(i: number): AsyncGenerator<unknown> {
    const before = i < segments.segmentCount
      ? decodeSegment(await segments.segment(i))
      : emptyOf(typeValue, keyCompare);
    const after = applyOps(apply, arm.target, before, new SortedMap<unknown, unknown>(bySegment.get(i)!, keyCompare));
    yield* typeValue.type === 'Set'
      ? after as SortedSet<unknown>
      : (after as SortedMap<unknown, unknown>).entries();
  }

  function* sources(): Generator<CollectionSource> {
    let at = 0;
    for (const i of edited) {
      if (at < i) yield { stored: hash, from: at, to: i };
      yield { elements: editedElements(i) };
      at = i + 1;
    }
    if (at < segments.segmentCount) yield { stored: hash, from: at, to: segments.segmentCount };
  }

  return storeCollection(storage, repo, typeValue, sources());
}

/** A value with the arm's ops applied; an op that disagrees with it is the
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

/** An empty value of a target's collection type, in its own key order. */
function emptyOf(typeValue: EastTypeValue, keyCompare: (a: unknown, b: unknown) => number): unknown {
  return typeValue.type === 'Set'
    ? new SortedSet<unknown>(undefined, keyCompare)
    : new SortedMap<unknown, unknown>(undefined, keyCompare);
}
