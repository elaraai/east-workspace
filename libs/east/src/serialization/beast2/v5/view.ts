/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A key range of a paged Set or Dict (#1616, D4): a view of its pager.
 *
 * A range of a lazily opened collection holds the pager it reads through and
 * its two bounds, and reads nothing to be made. Its rows are found at the
 * first read that needs them — each end by the fences and the one segment that
 * can hold it, through the pager's cache ({@link Beast2Pages.rowWindow}) — and
 * from then it answers as a pager of its own rows does: its size, its
 * segments, a keyed read, its first key. So a lazy value reads a range by the
 * code it reads a whole collection by.
 *
 * - **One cache.** Every read goes through the source's pager, so an input
 *   keeps its one cache however many ranges are taken of it, and a view's
 *   reads are counted there.
 * - **Its first and last segments are read through the cache**, their rows
 *   whole: many short ranges of one segment decode it once. One the range
 *   cuts is copied down to the range's rows. The segments between them are a
 *   scan's: decoded fresh, to a loop's projection when it has one, and never
 *   kept.
 * - **A range of a range** is placed among the rows of the range it narrows,
 *   so it reads no segment outside that one's. Once placed, a view holds its
 *   rows by its first key and the first key past it, and nothing of the range
 *   it narrows: a body may narrow a range thousands of times, and a range of a
 *   range of a range is placed by a loop, never a recursion, and costs no more
 *   to read than the first.
 *
 * This is east-c's view (`stream.c`, "A key range of a paged collection"),
 * rule for rule, so the two decode the same segments for the same reads.
 */

import { LazyReadError } from "../../../error.js";
import type { KeyTest } from "../../../containers/range.js";
import type { SortedMap } from "../../../containers/sortedmap.js";
import type { SortedSet } from "../../../containers/sortedset.js";
import type { Beast2Pages, SegmentDecoder } from "./stream.js";

/**
 * What a lazy Set or Dict reads through: a blob's pager, or a range of one.
 *
 * @internal
 */
export interface KeyedPages {
  /** The elements (pairs, for a Dict) it holds. */
  readonly elementCount: number;
  /** The segments they are read in. */
  readonly segmentCount: number;
  /** One segment, for a walk in canonical order. */
  segment(i: number): unknown;
  /** One segment, checked against the next as a paged loop reads one. */
  segmentDisjoint(i: number): unknown;
  /** One segment decoded to a loop's projection; throws where it cannot be. */
  segmentProjected(i: number, projection: SegmentDecoder): unknown;
  /** Whether {@link segmentProjected} can decode segment `i`, which a loop asks first. */
  projects(i: number): boolean;
  /** A segment's first key. */
  fence(i: number): unknown;
  /** The value at a key (the stored element, for a Set), or `undefined`. */
  get(key: never): unknown;
  /** The segment a walk from `key` starts in. */
  segmentFor(key: never): number;
  /** Lets go what a value that has read itself whole no longer reads. */
  clearCache(): void;
}

/** A view's rows, once its ends are placed. */
interface Placed {
  /** Its rows of the source: `[lo, hi)`. */
  readonly lo: number;
  readonly hi: number;
  /** The source's segment the view's first one is. */
  readonly first: number;
  /** The rows of each segment it spans that the range holds. */
  readonly counts: readonly number[];
  /** The key at row `lo`, the view's first; `undefined` where `lo` is the
   *  collection's first row, or the view holds nothing. */
  readonly loKey: unknown;
  /** The key at row `hi`, the first past the view; `undefined` where `hi` is
   *  the collection's end, or the view holds nothing. */
  readonly hiKey: unknown;
}

/**
 * A range of a paged Set or Dict, read through its source's pager.
 *
 * @internal Made by a lazy value's `range`; see `lazy.ts`.
 */
export class Beast2PagesView implements KeyedPages {
  /** The pager every read goes through, and where its reads are counted. */
  readonly source: Beast2Pages;
  /** The range this one narrows while this one is not placed: placing it
   *  needs that one's rows. `null` once placed, and for a range of the source. */
  private parent: Beast2PagesView | null;
  private readonly from: KeyTest<unknown> | undefined;
  private readonly to: KeyTest<unknown> | undefined;
  private placed: Placed | null = null;

  /**
   * @param of - the pager, or the range, this is a range of
   * @param from - the test the range's first key is the first to pass; `undefined` for the first key
   * @param to - the test the range stops before the first key to pass; `undefined` for the end
   */
  constructor(of: Beast2Pages | Beast2PagesView, from: KeyTest<unknown> | undefined, to: KeyTest<unknown> | undefined) {
    if (of instanceof Beast2PagesView) {
      this.source = of.source;
      // Held until this one is placed. A placed range holds nothing of the one
      // it narrows, so what this holds of the ranges above it ends there.
      this.parent = of;
    } else {
      this.source = of;
      this.parent = null;
    }
    this.from = from;
    this.to = to;
  }

  /** Whether a key is within `view`. Until it is placed, by its bounds and
   *  those of every range it narrows, up to the first that is placed; a placed
   *  view by its rows' first key and the first key past them, which reads
   *  nothing either: a key between the bounds and outside the rows is no key
   *  the source holds there. A loop up the ranges, never a recursion. */
  private static holds(view: Beast2PagesView, key: unknown): boolean {
    for (let at: Beast2PagesView | null = view; at !== null; at = at.parent) {
      const placed = at.placed;
      if (placed !== null) {
        return placed.hi > placed.lo
          && (placed.loKey === undefined || at.source.keyCompare(key, placed.loKey) >= 0)
          && (placed.hiKey === undefined || at.source.keyCompare(key, placed.hiKey) < 0);
      }
      if (at.from !== undefined && !at.from(key)) return false;
      if (at.to !== undefined && at.to(key)) return false;
    }
    return true;
  }

  /** `view` and the ranges it narrows that are not yet placed, nearest first:
   *  what placing it places, outermost first. */
  private static unplaced(view: Beast2PagesView): Beast2PagesView[] {
    const chain: Beast2PagesView[] = [];
    for (let at: Beast2PagesView | null = view; at !== null && at.placed === null; at = at.parent) chain.push(at);
    return chain;
  }

  /** Places the view: its rows of the source, within those of the range it
   *  narrows, and the segments they span. Once; a view that cannot be placed
   *  — a corrupt blob's — fails the same way at its next read. The ranges it
   *  narrows that are not yet placed are placed first, outermost first, by a
   *  loop. */
  private place(): Placed {
    if (this.placed !== null) return this.placed;
    try {
      const chain = Beast2PagesView.unplaced(this);
      for (let i = chain.length - 1; i >= 0; i--) chain[i]!.placeWithin();
      return this.placed!;
    } catch (err) {
      if (err instanceof LazyReadError) throw err;
      throw new LazyReadError((err as Error)?.message ?? String(err), { cause: err });
    }
  }

  /** Places this view among the rows of the range it narrows, which is
   *  placed, or of the whole collection; then lets that range go. */
  private placeWithin(): void {
    const source = this.source;
    const within = this.parent?.placed ?? { lo: 0, hi: source.elementCount, loKey: undefined, hiKey: undefined };
    const { lo, hi, loKey, hiKey } = source.rowWindow(this.from, this.to, within.lo, within.hi);
    const counts: number[] = [];
    let first = 0;
    if (hi > lo) {
      first = source.segmentOfRow(lo);
      const last = source.segmentOfRow(hi - 1);
      for (let s = first; s <= last; s++) {
        const base = source.rowsBefore(s);
        counts.push(Math.min(hi, base + source.counts[s]!) - Math.max(lo, base));
      }
    }
    // An end the window's own is the window's key there.
    this.placed = hi > lo
      ? { lo, hi, first, counts, loKey: lo === within.lo ? within.loKey : loKey, hiKey: hi === within.hi ? within.hiKey : hiKey }
      : { lo, hi, first, counts, loKey: undefined, hiKey: undefined };
    this.parent = null;
  }

  get elementCount(): number {
    const { lo, hi } = this.place();
    return hi - lo;
  }

  get segmentCount(): number {
    return this.place().counts.length;
  }

  /** Whether segment `k` of the view is one the range's ends do not lie in:
   *  those are read whole, through the cache, and every other as the source
   *  reads it. */
  private between(k: number): boolean {
    const { counts } = this.place();
    return k > 0 && k + 1 < counts.length;
  }

  /** Segment `k` of the view: the source's segment, held to the range's rows.
   *
   *  The view's first and last segments are read through the cache, where
   *  placing the ends left them and the next range of the same segment finds
   *  them, their rows whole — a cached segment has one shape for the pager's
   *  life, so `projection` is refused there, and {@link projects} says so
   *  before a loop asks. One the range cuts is copied down to the range's
   *  rows of it. The segments between the ends are a scan's: decoded fresh, by
   *  `projection` when one is given. */
  private read(k: number, projection: SegmentDecoder | null): unknown {
    const { first, counts, loKey, hiKey } = this.place();
    if (k < 0 || k >= counts.length) {
      throw new Error(`beast2 v5: segment ${k} out of range (${counts.length} segments)`);
    }
    const s = first + k;
    if (this.between(k)) {
      return projection !== null ? this.source.segmentProjected(s, projection) : this.source.segmentDisjoint(s);
    }
    if (projection !== null) {
      throw new Error(`beast2 v5: a range's end segment is read whole, through the cache`);
    }
    const segment = this.source.segmentKept(s) as SortedMap<unknown, unknown> | SortedSet<unknown>;
    if (counts[k] === this.source.counts[s]) return segment;  // the range holds all of it
    const source = this.source;
    return segment.range(
      loKey === undefined ? undefined : (key) => source.keyCompare(key, loKey) >= 0,
      hiKey === undefined ? undefined : (key) => source.keyCompare(key, hiKey) >= 0,
    );
  }

  segment(k: number): unknown {
    return this.read(k, null);
  }

  segmentDisjoint(k: number): unknown {
    return this.read(k, null);
  }

  segmentProjected(k: number, projection: SegmentDecoder): unknown {
    return this.read(k, projection);
  }

  /** Whether segment `k` decodes to a loop's projection: one between the
   *  range's ends, as the source would decode it; never an end segment. */
  projects(k: number): boolean {
    return this.between(k) && this.source.projects(this.place().first + k);
  }

  /** The first key of the view's segment `k`: the source's fence where the
   *  range holds the segment from its start, and the range's first key of it
   *  otherwise. */
  fence(k: number): unknown {
    const { lo, first, counts } = this.place();
    if (k < 0 || k >= counts.length) {
      throw new Error(`beast2 v5: segment ${k} out of range (${counts.length} segments)`);
    }
    const s = first + k;
    if (lo <= this.source.rowsBefore(s)) return this.source.fence(s);
    for (const key of (this.read(k, null) as SortedMap<unknown, unknown> | SortedSet<unknown>).keys()) return key;
    return undefined;
  }

  /** A keyed read: a key outside the range is absent, which reads nothing;
   *  one inside it is the source's keyed read. */
  get(key: never): unknown {
    if (!Beast2PagesView.holds(this, key)) return undefined;
    return this.source.get(key);
  }

  /** The view's segment a walk from `key` starts in: the source's, held to
   *  the segments the range spans. */
  segmentFor(key: never): number {
    const { first, counts } = this.place();
    if (counts.length === 0) return 0;
    return Math.min(Math.max(this.source.segmentFor(key) - first, 0), counts.length - 1);
  }

  /** Nothing: the cache is the source's, and a range that has read its own
   *  rows leaves its source as it was. */
  clearCache(): void {}
}
