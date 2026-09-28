/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The shape of a merge fan-in: which sorted partials overlap, the key ranges
 * each group of them merges over, and the tree of merge units that assembles
 * each range.
 *
 * A Set or Dict assembled from sorted partials merges only the partials whose
 * key ranges overlap; the rest are already in key order and splice. The
 * overlapping ones form components; a component merges over key ranges
 * ({@link planMergeRanges}), and each range through a tree of units, each
 * taking up to {@link MERGE_TREE_FANIN} entries. Nothing here decodes a
 * partial whole: a partial's range is its first fence and its last key, read
 * from its manifest and one segment, and a merge range's bounds are fences. A
 * split task's set or dict output and a record's index build merge their
 * partials this way.
 */

import {
  OptionType,
  StructType,
  compareFor,
  encodeBeast2For,
  fromEastTypeValue,
  none,
  segmentKeyTypeOf,
  some,
  type EastTypeValue,
} from '@elaraai/east';
import type { StorageBackend } from '../storage/interfaces.js';
import { DatasetSegments } from '../dataset-open.js';

/** The most partials one merge unit merges. */
export const MERGE_TREE_FANIN = 32;

/** Partials whose key ranges overlap, directly or through each other. */
export interface MergeComponent {
  /** The component's smallest key. */
  first: unknown;
  /** The component's partials, as partition indices in ascending order. */
  partitions: number[];
}

/**
 * Groups partials into components by key range.
 *
 * Each partial is opened in turn for its first fence and its last key and
 * dropped. The non-empty partials, ordered by first key and then partition
 * index, are walked once: a partial joins the current component when its first
 * key is at most the greatest last key the component has seen, and starts a
 * new component otherwise. Empty partials belong to no component.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param partials - The partials' hashes, in partition order; at least one
 * @returns The partials' collection type (the first partial's) and the
 *   components ordered by first key — none when every partial is empty
 * @throws {Error} When `partials` is empty or a partial is not a Dict or Set.
 */
export async function mergeComponents(
  storage: StorageBackend,
  repo: string,
  partials: readonly string[],
): Promise<{ typeValue: EastTypeValue; components: MergeComponent[] }> {
  if (partials.length === 0) {
    throw new Error('mergeComponents: no partials');
  }
  let typeValue: EastTypeValue | null = null;
  const ranges: { partition: number; first: unknown; last: unknown }[] = [];
  for (let p = 0; p < partials.length; p++) {
    const segments = await DatasetSegments.open(storage, repo, partials[p]!);
    if (segments.typeValue.type !== 'Dict' && segments.typeValue.type !== 'Set') {
      throw new Error(`partition merge applies to Dict and Set outputs, got ${segments.typeValue.type}`);
    }
    typeValue ??= segments.typeValue;
    if (segments.segmentCount === 0) continue;
    ranges.push({ partition: p, first: await segments.fence(0), last: await segments.lastKey(segments.segmentCount - 1) });
  }
  const collection = typeValue!;
  const cmp = compareFor(segmentKeyTypeOf(collection)!) as (a: unknown, b: unknown) => number;

  ranges.sort((a, b) => cmp(a.first, b.first) || a.partition - b.partition);
  const components: MergeComponent[] = [];
  let greatestLast: unknown;
  for (const range of ranges) {
    const current = components[components.length - 1];
    if (current !== undefined && cmp(range.first, greatestLast) <= 0) {
      current.partitions.push(range.partition);
      if (cmp(range.last, greatestLast) > 0) greatestLast = range.last;
    } else {
      components.push({ first: range.first, partitions: [range.partition] });
      greatestLast = range.last;
    }
  }
  for (const component of components) {
    component.partitions.sort((a, b) => a - b);
  }
  return { typeValue: collection, components };
}

/**
 * Plans the ranged fan-in of one merged component: the key ranges its merge
 * units run over, written to the object store as the range objects the units
 * take beside the parts. Deterministic — a pure function of the partials'
 * manifests and the byte target — and bounded: the sizes and the boundary keys
 * are read from the manifests, and no segment is read.
 *
 * The number of ranges is the component's stored bytes over `targetBytes`,
 * capped by the segments of its largest partial (the pilot), whose fences
 * supply the boundary keys: the pilot's segments pack greedily into runs of
 * about equal bytes, and each run after the first starts a range at its first
 * fence. A component of one range — any component smaller than the target —
 * merges its partials whole, over the open range. Each merge unit's runner
 * then seeks every partial to the segment owning its range's lower bound and
 * stops at the first key at or past its upper bound, so a unit reads its
 * range's share of every partial, plus at most one segment.
 *
 * A range is `[from, to)` as `Struct{from: Option<K>, to: Option<K>}` over the
 * partials' key type, a bound `none` when open: what a `merge` unit's `range`
 * file holds (`UnitWorkType` in `@elaraai/east`).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param partials - The component's partial hashes, in partition order; at least one
 * @param targetBytes - The stored bytes one merge unit's ranged inputs aim for
 * @returns The range objects' hashes, in key order; at least one
 * @throws {Error} When a partial is not a Set or Dict, or a read fails.
 */
export async function planMergeRanges(
  storage: StorageBackend,
  repo: string,
  partials: readonly string[],
  targetBytes: number,
): Promise<string[]> {
  if (partials.length === 0) throw new Error('planMergeRanges: no partials');

  let totalBytes = 0;
  let pilot: DatasetSegments | null = null;
  let pilotBytes = -1;
  for (const hash of partials) {
    const segments = await DatasetSegments.open(storage, repo, hash);
    if (segments.typeValue.type !== 'Dict' && segments.typeValue.type !== 'Set') {
      throw new Error(`partition merge applies to Dict and Set outputs, got ${segments.typeValue.type}`);
    }
    let bytes = 0;
    for (let i = 0; i < segments.segmentCount; i++) bytes += segments.segmentBytes(i);
    totalBytes += bytes;
    if (bytes > pilotBytes) {
      pilot = segments;
      pilotBytes = bytes;
    }
  }
  const lead = pilot!;
  const ranges = Math.max(1, Math.min(Math.ceil(totalBytes / Math.max(1, targetBytes)), lead.segmentCount));

  // The boundary keys: the pilot's fences where its segments, packed greedily
  // into `ranges` runs of about equal bytes, start a new run.
  const bounds: unknown[] = [];
  if (ranges > 1) {
    const runBytes = pilotBytes / ranges;
    let acc = 0;
    for (let i = 0; i < lead.segmentCount && bounds.length < ranges - 1; i++) {
      const size = lead.segmentBytes(i);
      if (acc > 0 && acc + size > runBytes) {
        bounds.push(await lead.fence(i));
        acc = 0;
      }
      acc += size;
    }
  }

  // The range objects: `[from, to)` per range, the first open below and the
  // last open above — the one open range when there is no boundary.
  const key = fromEastTypeValue(segmentKeyTypeOf(lead.typeValue)!);
  const encode = encodeBeast2For(StructType({ from: OptionType(key), to: OptionType(key) }));
  const hashes: string[] = [];
  for (let r = 0; r <= bounds.length; r++) {
    const from = r === 0 ? none : some(bounds[r - 1]);
    const to = r === bounds.length ? none : some(bounds[r]);
    hashes.push(await storage.objects.write(repo, encode({ from, to })));
  }
  return hashes;
}

/**
 * Splits one level of a group's entries into the runs the level reduces:
 * `fanIn` consecutive entries each, the last run holding the rest. A run of
 * one passes through to the next level.
 *
 * @param entries - The group's entries at this level, in order
 * @param fanIn - The most entries one unit takes
 * @returns The runs, in order
 */
export function mergeTreeGroups<T>(entries: readonly T[], fanIn = MERGE_TREE_FANIN): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < entries.length; i += fanIn) {
    groups.push(entries.slice(i, i + fanIn));
  }
  return groups;
}

/**
 * The number of levels a reduce tree over groups of the given sizes runs:
 * the most grouping rounds any group takes to reach one entry.
 *
 * @param sizes - Each group's number of entries
 * @param fanIn - The most entries one unit takes
 * @returns The number of levels; `0` when no group has two entries
 */
export function mergeTreeLevels(sizes: readonly number[], fanIn = MERGE_TREE_FANIN): number {
  let levels = 0;
  for (const size of sizes) {
    let entries = size;
    let depth = 0;
    while (entries > 1) {
      entries = Math.ceil(entries / fanIn);
      depth++;
    }
    levels = Math.max(levels, depth);
  }
  return levels;
}
