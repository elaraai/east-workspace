/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The pieces of a task whose work is split over its inputs.
 *
 * A stream task marks each input its work may be split over with
 * `e3.partition`, and the first one marked is the primary. A piece is a run of
 * whole segments of the primary, closed by a rule over the primary's manifest
 * ({@link pieceBoundaries}) that looks only at the segments around a boundary,
 * so an insertion moves only the pieces around it. A boundary moves forward to
 * the end of the `by` group it falls in, so rows whose `by` fields are equal
 * stay in one piece: a group usually ends inside a segment, and the boundary
 * splits that segment there. Every other partitioned input is split at the
 * same keys, and the unmarked inputs reach every piece whole.
 *
 * Each piece of an input is stored through the door as the manifest the Writer
 * writes for its rows. Its whole segments are named as they stand, and a
 * segment a boundary splits is re-cut. So a piece copies no more than the
 * segments at its ends, and a piece whose rows did not change has the hash it
 * had, which is what a piece's unit is cached by.
 *
 * @packageDocumentation
 */

import {
  compareFor,
  decodeBeast2ElementsFor,
  fromEastTypeValue,
  isTypeValueEqual,
  printType,
  segmentKeyTypeOf,
  type EastTypeValue,
} from '@elaraai/east';
import type { TaskInput } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import { DatasetSegments } from '../dataset-open.js';
import { storeCollection, type CollectionSource } from '../store-collection.js';

/**
 * The sizes the piece rule closes pieces at, in stored bytes: a piece closes
 * only once it holds `min`, weighs its segments against `max` until it holds
 * `target` and against `min` after, and always closes once it holds `max`.
 */
export interface PieceSizes {
  /** The least a piece holds, unless the input ends first. */
  readonly min: number;
  /** Where a piece starts closing readily: the pieces' middle size, which a
   *  merge range aims for too. */
  readonly target: number;
  /** The most a piece holds, but for the rest of a `by` group. */
  readonly max: number;
}

/** The platform's piece sizes: 16, 64 and 256 MiB. */
export const PIECE_SIZES: PieceSizes = { min: 16 * 2 ** 20, target: 64 * 2 ** 20, max: 256 * 2 ** 20 };

/**
 * The piece sizes this process plans with: the platform's, or, when a test
 * sets `E3_TEST_PIECE_BYTES=n`, `n/4`, `n` and `4n` bytes, so a small input has
 * many pieces.
 *
 * @returns The sizes
 * @throws {Error} When `E3_TEST_PIECE_BYTES` is set to anything but a whole
 *   number of bytes, at least 4.
 */
export function pieceSizes(): PieceSizes {
  const test = process.env.E3_TEST_PIECE_BYTES;
  if (test === undefined || test === '') return PIECE_SIZES;
  const n = Number(test);
  if (!Number.isSafeInteger(n) || n < 4) {
    throw new Error(`E3_TEST_PIECE_BYTES is '${test}': it is a whole number of bytes, at least 4`);
  }
  return { min: Math.floor(n / 4), target: n, max: 4 * n };
}

/** A row of an input, as a segment and a row within it (`offset` 0 is the
 *  segment's first row): where a piece starts. */
export interface SplitPoint {
  readonly seg: number;
  readonly offset: number;
}

/**
 * The piece rule: where the pieces of a manifest's segments start.
 *
 * @remarks
 * The segments are walked in order, with `b` the stored bytes of the open
 * piece, the segment in hand included. A segment closes the piece after it
 * when `b` reaches `max`, or when `b` is at least `min` and the first 32 bits
 * of the segment's SHA-256, the hash the store names it by, fall under
 * `2^32 × s / D`, where `s` is the segment's stored bytes and `D` is `max`
 * until the piece holds `target` and `min` after. With the platform's sizes
 * most pieces hold 64 to 100 MiB. Whether a segment closes a piece depends on
 * that segment and on `b` alone, so two walks over inputs that share a run of
 * segments close the same pieces in it from the first boundary they share.
 *
 * A piece closed before a segment ends where `groupEnd` says: at that segment,
 * or past the rest of the `by` group running into it. The walk goes on from
 * the segment the next piece starts in.
 *
 * @param entries - The primary's manifest entries, in order
 * @param sizes - The piece sizes
 * @param groupEnd - Where a piece closed before segment `seg` ends: its first
 *   row, for an input with no `by`; otherwise the first row past the `by`
 *   group of the row before it, or `null` when that group runs to the end
 * @returns The first row of each piece, in order, from segment 0's
 */
export async function pieceBoundaries(
  entries: readonly { readonly hash: string; readonly bytes: bigint }[],
  sizes: PieceSizes,
  groupEnd: (seg: number) => SplitPoint | null | Promise<SplitPoint | null> = (seg) => ({ seg, offset: 0 }),
): Promise<SplitPoint[]> {
  const starts: SplitPoint[] = [{ seg: 0, offset: 0 }];
  let held = 0;
  for (let i = 0; i + 1 < entries.length; i++) {
    const entry = entries[i]!;
    const bytes = Number(entry.bytes);
    held += bytes;
    const weight = held < sizes.target ? sizes.max : sizes.min;
    if (held < sizes.max && (held < sizes.min || parseInt(entry.hash.slice(0, 8), 16) >= 2 ** 32 * bytes / weight)) continue;
    const start = await groupEnd(i + 1);
    if (start === null) break;
    starts.push(start);
    held = 0;
    i = start.seg - 1;
  }
  return starts;
}

/** A partitioned input's keys as the tuple its pieces are cut by: its `by`
 *  fields, or the key itself, alone, when `by` is empty. */
interface Cut {
  /** The tuple's types. */
  readonly types: readonly EastTypeValue[];
  /** A key's tuple. */
  readonly project: (key: unknown) => unknown[];
}

/**
 * How a partitioned Set or Dict is cut: the fields its `by` names, read by
 * path. An entry is a leading key field, or, as the last entry, a path through
 * first fields such as `at.day`; the SDK checks as much when the task is
 * defined, so the tuples ascend with the keys.
 *
 * @param keyType - The input's key type
 * @param by - The fields, as `e3.partition` names them
 * @param where - The input, for an error
 * @returns The cut
 * @throws {Error} When `by` names a field the key does not have.
 */
function cutOf(keyType: EastTypeValue, by: readonly string[], where: string): Cut {
  if (by.length === 0) return { types: [keyType], project: (key) => [key] };
  const paths = by.map((entry) => entry.split('.'));
  const types = paths.map((path) => path.reduce((level: EastTypeValue, name) => {
    const field = level.type === 'Struct' ? level.value.find((f) => f.name === name) : undefined;
    if (field === undefined) throw new Error(`${where}: \`by\` names '${path.join('.')}', and its key has no such field`);
    return field.type as EastTypeValue;
  }, keyType));
  return {
    types,
    project: (key) => paths.map((path) => path.reduce((level, name) => (level as Record<string, unknown>)[name], key)),
  };
}

/**
 * Plans the pieces of a task whose work is split over its inputs, and stores
 * each piece's inputs.
 *
 * @remarks
 * The primary's pieces are runs of the segments its manifest names. Nothing is
 * decoded but a segment where a `by` group or another input's split has to be
 * found.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param inputs - The task's inputs, as its task object lists them
 * @param inputHashes - The input hashes, in the same order
 * @param sizes - The piece sizes
 * @returns Each piece's input hashes, in piece order: an unmarked input as it
 *   is, and each partitioned input's piece of it. A single piece's are
 *   `inputHashes` themselves.
 * @throws {Error} When no input is partitioned, a partitioned input is not a
 *   stored collection, co-partitioned inputs are not all Sets or Dicts cut by
 *   fields of the same types, or a read fails.
 */
export async function planPieces(
  storage: StorageBackend,
  repo: string,
  inputs: readonly TaskInput[],
  inputHashes: readonly string[],
  sizes: PieceSizes,
): Promise<string[][]> {
  if (inputs.length !== inputHashes.length) {
    throw new Error(`the task reads ${inputs.length} inputs, and ${inputHashes.length} were given`);
  }
  const marked = inputs.flatMap((input, index) => input.partition.type === 'some' ? [{ index, by: input.partition.value.by }] : []);
  if (marked.length === 0) throw new Error('no input is partitioned');

  const open = async (index: number): Promise<DatasetSegments> => {
    try {
      return await DatasetSegments.open(storage, repo, inputHashes[index]!);
    } catch (err) {
      throw new Error(`partitioned input ${index + 1} is not a stored collection: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const first = marked[0]!;
  const segments = await open(first.index);
  const typeValue = segments.typeValue;
  const primary = segments.hash;
  const count = segments.segmentCount;
  const keyType = segmentKeyTypeOf(typeValue);
  if (keyType === null && (first.by.length > 0 || marked.length > 1)) {
    throw new Error(`partitioned input ${first.index + 1} is an Array, cut by position: it has no key for \`by\` to name or for other inputs to be cut at`);
  }
  const cut = keyType === null ? null : cutOf(keyType, first.by, `partitioned input ${first.index + 1}`);
  const compares = cut?.types.map((type) => compareFor(type) as (a: unknown, b: unknown) => number) ?? [];
  const compare = (a: unknown[], b: unknown[]): number => {
    for (let i = 0; i < compares.length; i++) {
      const c = compares[i]!(a[i], b[i]);
      if (c !== 0) return c;
    }
    return 0;
  };

  // Where a piece closed before segment `seg` ends, under a `by`: past the
  // group of the row before `seg`. Equal fences settle a segment without a
  // read, since every row between them is in their group.
  const groupEnd = cut === null || first.by.length === 0 ? undefined : async (seg: number): Promise<SplitPoint | null> => {
    const at = cut.project(await segments.fence(seg));
    const group = compare(cut.project(await segments.fence(seg - 1)), at) === 0 ? at : cut.project(await segments.lastKey(seg - 1));
    if (compare(group, at) !== 0) return { seg, offset: 0 };
    let s = seg;
    while (s + 1 < count && compare(cut.project(await segments.fence(s + 1)), group) === 0) s++;
    let offset = 0;
    for await (const row of decodeBeast2ElementsFor(typeValue)([await segments.segment(s)])) {
      if (compare(cut.project(typeValue.type === 'Dict' ? (row as [unknown, unknown])[0] : row), group) !== 0) return { seg: s, offset };
      offset++;
    }
    return s + 1 < count ? { seg: s + 1, offset: 0 } : null;
  };
  const starts = await pieceBoundaries(segments.manifest.entries, sizes, groupEnd);
  if (starts.length === 1) return [[...inputHashes]];
  const end: SplitPoint = { seg: count, offset: 0 };

  // Every other partitioned input splits where the primary's pieces start: at
  // its first row whose tuple reaches that of the piece's first row.
  const others: { index: number; input: DatasetSegments; starts: SplitPoint[] }[] = [];
  if (marked.length > 1) {
    const bounds: unknown[][] = [];
    for (const start of starts.slice(1)) {
      let key: unknown = await segments.fence(start.seg);
      if (start.offset > 0) {
        let row = 0;
        for await (const element of decodeBeast2ElementsFor(typeValue)([await segments.segment(start.seg)])) {
          if (row++ === start.offset) {
            key = typeValue.type === 'Dict' ? (element as [unknown, unknown])[0] : element;
            break;
          }
        }
      }
      bounds.push(cut!.project(key));
    }
    for (const { index, by } of marked.slice(1)) {
      const input = await open(index);
      const inputKey = segmentKeyTypeOf(input.typeValue);
      if (inputKey === null) {
        throw new Error(`partitioned input ${index + 1} is an Array, cut by position, and inputs partitioned together are cut at the same keys`);
      }
      const inputCut = cutOf(inputKey, by, `partitioned input ${index + 1}`);
      if (inputCut.types.length !== cut!.types.length || inputCut.types.some((type, i) => !isTypeValueEqual(type, cut!.types[i]!))) {
        throw new Error(
          `partitioned input ${index + 1} is cut by (${inputCut.types.map((type) => printType(fromEastTypeValue(type))).join(', ')}) and partitioned input ${first.index + 1} by ` +
          `(${cut!.types.map((type) => printType(fromEastTypeValue(type))).join(', ')}): inputs partitioned together are cut by fields of the same types`
        );
      }
      const inputCount = input.segmentCount;
      const inputStarts: SplitPoint[] = [{ seg: 0, offset: 0 }];
      // The bounds ascend, so the search walks the input's fences once, and
      // reads a segment only when a bound falls inside it.
      let seg = 0;
      for (const bound of bounds) {
        if (inputCount === 0) {
          inputStarts.push({ seg: 0, offset: 0 });
          continue;
        }
        while (seg + 1 < inputCount && compare(inputCut.project(await input.fence(seg + 1)), bound) < 0) seg++;
        if (compare(inputCut.project(await input.fence(seg)), bound) >= 0) {
          inputStarts.push({ seg, offset: 0 });
          continue;
        }
        let offset = 0;
        let found = false;
        for await (const row of decodeBeast2ElementsFor(input.typeValue)([await input.segment(seg)])) {
          if (compare(inputCut.project(input.typeValue.type === 'Dict' ? (row as [unknown, unknown])[0] : row), bound) >= 0) {
            found = true;
            break;
          }
          offset++;
        }
        if (found) {
          inputStarts.push({ seg, offset });
        } else {
          inputStarts.push({ seg: seg + 1, offset: 0 });
          if (seg + 1 < inputCount) seg++;
        }
      }
      others.push({ index, input, starts: inputStarts });
    }
  }

  /** Rows `[start, end)` of segment `seg` of an input. */
  async function* rows(input: DatasetSegments, seg: number, start: number, stop: number): AsyncGenerator<unknown> {
    let row = 0;
    for await (const element of decodeBeast2ElementsFor(input.typeValue)([await input.segment(seg)])) {
      if (row >= stop) return;
      if (row >= start) yield element;
      row++;
    }
  }
  /** The rows of an input from `from` up to `to`: its whole segments by
   *  reference, and the rows of a segment either end splits. */
  const sources = (input: DatasetSegments, hash: string, from: SplitPoint, to: SplitPoint): CollectionSource[] => {
    const list: CollectionSource[] = [];
    if (from.seg === to.seg) {
      if (from.offset < to.offset) list.push({ elements: rows(input, from.seg, from.offset, to.offset) });
      return list;
    }
    let whole = from.seg;
    if (from.offset > 0) {
      list.push({ elements: rows(input, from.seg, from.offset, Infinity) });
      whole++;
    }
    if (to.seg > whole) list.push({ stored: hash, from: whole, to: to.seg });
    if (to.offset > 0) list.push({ elements: rows(input, to.seg, 0, to.offset) });
    return list;
  };

  const pieces: string[][] = [];
  for (let p = 0; p < starts.length; p++) {
    const piece = [...inputHashes];
    piece[first.index] = await storeCollection(storage, repo, typeValue, sources(segments, primary, starts[p]!, starts[p + 1] ?? end));
    for (const other of others) {
      const to = other.starts[p + 1] ?? { seg: other.input.segmentCount, offset: 0 };
      piece[other.index] = await storeCollection(storage, repo, other.input.typeValue, sources(other.input, inputHashes[other.index]!, other.starts[p]!, to));
    }
    pieces.push(piece);
  }
  return pieces;
}
