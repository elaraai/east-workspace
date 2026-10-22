/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lens over a record (#1349, B§8): a narrowing laid out over the record's
 * own rows, in the record's order, by where e3 places its rows. Pure: no
 * React, no reads.
 *
 * e3 places a narrowing's rows segment by segment ({@link LensSegment}): how
 * many of them each record segment holds, read from the index alone. A segment
 * that holds none is a stretch of the record with no match, drawn as a band of
 * its exact size without being read. A segment that holds some is read — its
 * rows by position, and which of them the narrowing holds, asked of e3 in one
 * read — and drawn as the lens draws any rows: each match at its row number,
 * `context` rows either side of it, the runs the planner opened, and a band
 * over each run of the rest, across the segments' edges too. Until it is read
 * it is one band sized by its matches. While the placement is incomplete, a
 * stretch no segment has been listed for may hold matches still: it is a band
 * sized by the narrowing's density.
 *
 * A segment read whole is checked against its placement: the matches its rows
 * hold must be the matches e3 placed there. When they differ the record changed
 * between the two reads, and the segment is a failed band that says so, with a
 * Retry, rather than rows that would show a match the index does not hold.
 *
 * What it lays out is drawn over the record's rows the local layer leaves
 * ({@link lensBodyItems}): a drafted row in its place, a removed one gone, a
 * new one after the row before it.
 *
 * @packageDocumentation
 */

import { BAND_MIN_PX, type LensBodyInput, type SheetBand, type SheetWindowFailure } from "./model.js";
import { inRuns, runAtOrAfter, type LensGap, type LensRun } from "./lens.js";
import type { LensContext } from "./sheet-types.js";
import type { SheetRowValue } from "./values.js";

/** The most rows the lens reads in one page: a record Slice's page holds no more. */
export const LENS_PIECE_ROWS = 2048;

/** The rows a read segment of matches also reads beside it in an empty stretch: the widest context. */
export const LENS_EDGE_ROWS = 3;

/** The runs the planner opened in an empty stretch are read in windows of this many rows, aligned to the record. */
export const LENS_REVEAL_ROWS = 200;

/** A record segment some of the narrowing's rows fall in: where it is, its rows, and how many of them match. */
export interface LensSegment {
    /** Its first row, in the record's order. */
    offset: number;
    /** How many rows it holds. */
    count: number;
    /** How many of the narrowing's rows it holds, as placed so far. */
    matches: number;
}

/** Where the narrowing's rows sit in the record, as far as e3 has placed them. */
export interface LensPlacement {
    /** The record's rows. */
    records: number;
    /** The segments holding the narrowing's rows, in the record's order. */
    segments: readonly LensSegment[];
    /** How many rows the narrowing holds. */
    matches: number;
    /** How many of them are placed. */
    placed: number;
    /** Whether every one is: until then a stretch no segment is listed for may hold some. */
    complete: boolean;
}

/** One row the lens has read: the row, and — in a segment of matches — whether the narrowing holds it, once asked. */
export interface LensRow {
    row: SheetRowValue;
    hit: boolean | undefined;
}

/** What a segment of matches is, read or not. */
export type LensSegmentState =
    /** Its rows, and which the narrowing holds, are read: `rowAt` answers for each. */
    | { kind: "read" }
    /** Not read yet, or still being read. */
    | { kind: "unread" }
    /** Its read failed, and why. */
    | { kind: "failed"; error: string };

/** What the lens knows of the record now. */
export interface LensFacts {
    /** Where the narrowing's rows sit. */
    placement: LensPlacement;
    /** A segment of matches' state, by its first row. */
    segmentState: (offset: number) => LensSegmentState;
    /** A row read, by its position — a segment's, or one beside it, or one the planner opened. */
    rowAt: (position: number) => LensRow | undefined;
    /** The positions of every row read, ascending. */
    read: readonly number[];
    /** The runs the planner opened whose read failed, ascending and disjoint, and why. */
    failed: readonly (LensRun & { error: string })[];
}

/** How the lens draws what it has not read: the height of a row, and of one record drawn — a group's band and a line, on a grouped sheet. */
export interface LensGeometry {
    rowPx: number;
    entryPx: number;
}

/** One item of the lens, in the record's order. */
export type LensItem =
    /** A row drawn: a match, a row beside one, or one the planner opened. */
    | { kind: "row"; position: number; row: SheetRowValue; hit: boolean }
    /** A run of rows the lens hides, with its controls. */
    | { kind: "gap"; gap: LensGap }
    /** Rows the lens has still to read, or to place: one band where they will be drawn. */
    | { kind: "pending"; band: SheetBand }
    /** A segment whose read failed, or whose rows disagree with where e3 placed the narrowing's: one band, with a Retry. */
    | { kind: "failed"; failure: SheetWindowFailure };

/** The lens laid out: its items, and what the count line counts. */
export interface LensLayout {
    items: LensItem[];
    /** The matches drawn. */
    hits: number;
    /** The rows drawn: the matches, the rows beside them and the rows the planner opened. */
    shown: number;
}

/** One stretch of the record, in its order: a segment of matches, a stretch with none, or one not placed yet. */
export interface LensRegion {
    kind: "matched" | "empty" | "unplaced";
    /** Its first row. */
    from: number;
    /** One past its last row. */
    to: number;
    /** A segment of matches': its matches, as placed so far. */
    matches: number;
}

/**
 * The record's stretches, in its order: each segment of matches, and between
 * them the stretches with none — or, while the placement is incomplete, not
 * placed yet.
 *
 * @param placement - Where the narrowing's rows sit
 * @returns The stretches, covering the record
 */
export function lensRegions(placement: LensPlacement): LensRegion[] {
    const out: LensRegion[] = [];
    const between: LensRegion["kind"] = placement.complete ? "empty" : "unplaced";
    let at = 0;
    for (const segment of placement.segments) {
        if (segment.offset > at) out.push({ kind: between, from: at, to: segment.offset, matches: 0 });
        out.push({ kind: "matched", from: segment.offset, to: segment.offset + segment.count, matches: segment.matches });
        at = segment.offset + segment.count;
    }
    if (placement.records > at) out.push({ kind: between, from: at, to: placement.records, matches: 0 });
    return out;
}

/** One read the lens makes: rows by position, and — over a segment of matches — which of them the narrowing holds. */
export interface LensPiece {
    /** Its key: its first row and how many. */
    key: string;
    /** Its first row. */
    from: number;
    /** How many rows. */
    count: number;
    /** The segment of matches it reads, by its first row; `undefined` for rows the planner opened in an empty stretch. */
    segment: number | undefined;
}

/** A piece over `[from, from + count)`. */
function piece(from: number, count: number, segment: number | undefined): LensPiece {
    return { key: `${from}+${count}`, from, count, segment };
}

/**
 * The reads the lens's stretches take: each segment of matches whole — with
 * the {@link LENS_EDGE_ROWS} beside it in an empty stretch either side, so
 * every context row it can show is read with it — in pages of at most
 * {@link LENS_PIECE_ROWS}; and the runs the planner opened in an empty
 * stretch, in windows of {@link LENS_REVEAL_ROWS} aligned to the record.
 *
 * @param regions - The record's stretches
 * @param reveals - The runs the planner opened, sorted and disjoint
 * @returns The reads, in the record's order
 */
export function lensPieces(regions: readonly LensRegion[], reveals: readonly LensRun[]): LensPiece[] {
    const out: LensPiece[] = [];
    regions.forEach((region, i) => {
        const before = regions[i - 1];
        const after = regions[i + 1];
        if (region.kind === "matched") {
            const from = before?.kind === "empty" ? Math.max(before.from, region.from - LENS_EDGE_ROWS) : region.from;
            const to = after?.kind === "empty" ? Math.min(after.to, region.to + LENS_EDGE_ROWS) : region.to;
            for (let at = from; at < to; at += LENS_PIECE_ROWS) out.push(piece(at, Math.min(LENS_PIECE_ROWS, to - at), region.from));
            return;
        }
        if (region.kind !== "empty") return;
        // The planner's runs in an empty stretch, a window each — but not the edges a segment's read reads.
        const lo = before?.kind === "matched" ? Math.min(region.to, region.from + LENS_EDGE_ROWS) : region.from;
        const hi = after?.kind === "matched" ? Math.max(lo, region.to - LENS_EDGE_ROWS) : region.to;
        let window = -1;
        for (let r = runAtOrAfter(reveals, lo); r < reveals.length && reveals[r]!.from < hi; r++) {
            const a = Math.max(lo, reveals[r]!.from);
            const b = Math.min(hi - 1, reveals[r]!.to);
            for (let w = Math.max(window + 1, Math.floor(a / LENS_REVEAL_ROWS)); w <= Math.floor(b / LENS_REVEAL_ROWS); w++) {
                window = w;
                const from = Math.max(lo, w * LENS_REVEAL_ROWS);
                out.push(piece(from, Math.min(hi, (w + 1) * LENS_REVEAL_ROWS) - from, undefined));
            }
        }
    });
    return out;
}

/**
 * The reads to make for a view of the record's rows `[from, to]`: every
 * segment that view meets, and the nearest segments beyond it either side, as
 * far as `budget` reads allow — each segment's pages together, so a segment is
 * read whole or not at all; a run the planner opened counts as a segment of
 * its own.
 *
 * @param pieces - Every read the lens takes, in the record's order
 * @param from - The view's first row
 * @param to - The view's last row
 * @param beyond - How many segments past the view on each side
 * @param budget - The most reads at once
 * @returns The reads, by key
 */
export function lensDemand(pieces: readonly LensPiece[], from: number, to: number, beyond: number, budget: number): Set<string> {
    const out = new Set<string>();
    // Consecutive pieces of one segment read together.
    const groups: LensPiece[][] = [];
    for (const p of pieces) {
        const last = groups[groups.length - 1];
        if (last !== undefined && p.segment !== undefined && last[0]!.segment === p.segment) last.push(p);
        else groups.push([p]);
    }
    if (groups.length === 0) return out;
    const end = (g: LensPiece[]) => g[g.length - 1]!.from + g[g.length - 1]!.count;
    // The first group ending past the view's first row, and the last starting at or before its last.
    let first = groups.findIndex((g) => end(g) > from);
    if (first < 0) first = groups.length - 1;
    let last = first;
    while (last + 1 < groups.length && groups[last + 1]![0]!.from <= to) last++;
    const add = (g: LensPiece[] | undefined): void => {
        if (g === undefined || out.size + g.length > budget) return;
        for (const p of g) out.add(p.key);
    };
    for (let i = first; i <= last; i++) add(groups[i]);
    for (let d = 1; d <= beyond; d++) {
        add(groups[last + d]);
        add(groups[first - d]);
    }
    return out;
}

/** The estimate of a segment of `count` rows holding `matches`, drawn under `context`: its matches and their context rows, and a band between each. */
function estimatePx(count: number, matches: number, context: LensContext, g: LensGeometry): number {
    const shown = Math.min(count, matches * (2 * context + 1));
    const bands = shown >= count ? 0 : Math.min(matches + 1, count - shown);
    return Math.max(BAND_MIN_PX, shown * g.entryPx + bands * BAND_MIN_PX);
}

/** Words the layout puts in a failed band: why a segment's rows cannot be drawn. */
export interface LensWords {
    /** A segment whose rows disagree with where e3 placed the narrowing's rows: the record changed between the two reads. */
    changed: string;
}

/** The first position in `read` at or past `p`. */
function readAtOrAfter(read: readonly number[], p: number): number {
    let lo = 0;
    let hi = read.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (read[mid]! < p) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Lays the lens out: the record's rows in its order, each match at its row
 * number with `context` rows either side, the runs the planner opened, and a
 * band over each run of the rest; a band for each stretch not read or not
 * placed yet; a failed band for each segment whose read failed or whose
 * matches disagree with its placement. Its work is the segments read and the
 * rows shown, never the record's size: a run of a million rows the planner
 * opened and has not read is one band.
 *
 * @param facts - What the lens knows of the record
 * @param context - The rows shown either side of each match
 * @param reveals - The runs the planner opened, sorted and disjoint
 * @param geometry - How tall what is not read yet is drawn
 * @param words - The failed band's words
 * @returns The items, in the record's order, and what the count line counts
 */
export function layoutLens(facts: LensFacts, context: LensContext, reveals: readonly LensRun[], geometry: LensGeometry, words: LensWords): LensLayout {
    const { placement, read, failed } = facts;
    const regions = lensRegions(placement);
    const items: LensItem[] = [];
    let hits = 0;
    let shown = 0;
    // The density the placement leaves the stretches not placed yet.
    let unplacedRows = 0;
    for (const region of regions) if (region.kind === "unplaced") unplacedRows += region.to - region.from;
    const density = unplacedRows > 0 ? Math.max(0, placement.matches - placement.placed) / unplacedRows : 0;
    // Whether each segment's read is drawn: read, and — once every row is placed — holding the matches placed there.
    const drawn = regions.map((region): LensSegmentState => {
        if (region.kind !== "matched") return { kind: "unread" };
        const state = facts.segmentState(region.from);
        if (state.kind !== "read" || !placement.complete) return state;
        let held = 0;
        for (let p = region.from; p < region.to; p++) if (facts.rowAt(p)?.hit === true) held++;
        return held === region.matches ? state : { kind: "failed", error: words.changed };
    });
    /** The region a position falls in, from a guess at its index. */
    const regionOf = (p: number, guess: number): number => {
        let at = Math.max(0, Math.min(regions.length - 1, guess));
        while (at > 0 && regions[at]!.from > p) at--;
        while (at < regions.length - 1 && regions[at]!.to <= p) at++;
        return at;
    };
    /** Whether the narrowing holds a row, where the lens knows: a drawn segment's rows, and none anywhere else. */
    const hitAt = (p: number, guess: number): boolean => {
        if (p < 0 || p >= placement.records) return false;
        const at = regionOf(p, guess);
        const region = regions[at];
        if (region === undefined || region.kind !== "matched" || drawn[at]!.kind !== "read") return false;
        return facts.rowAt(p)?.hit === true;
    };
    /** Whether a segment's row shows: a match within `context` of it, or opened by the planner. */
    const visibleAt = (p: number, at: number): boolean => {
        if (inRuns(reveals, p)) return true;
        for (let d = -context; d <= context; d++) if (hitAt(p + d, at)) return true;
        return false;
    };
    // The run of hidden rows being gathered, and the anchors either side of each gap: a match, or a band.
    let gapFrom: number | undefined;
    let gapTo = -1;
    let anchor = "s";
    const gaps: { at: number; before: string }[] = [];
    const closeGap = () => {
        if (gapFrom === undefined) return;
        gaps.push({ at: items.length, before: anchor });
        items.push({ kind: "gap", gap: { key: "", from: gapFrom, to: gapTo, hidden: gapTo - gapFrom + 1, first: gapFrom === 0, last: gapTo === placement.records - 1 } });
        gapFrom = undefined;
    };
    // Rows to show that are not read yet, gathered into one band.
    let waitingFrom: number | undefined;
    let waitingTo = -1;
    const closeWaiting = () => {
        if (waitingFrom === undefined) return;
        const n = waitingTo - waitingFrom + 1;
        items.push({ kind: "pending", band: { at: "reading", from: waitingFrom, to: waitingTo, px: Math.max(BAND_MIN_PX, n * geometry.entryPx) } });
        anchor = `u${waitingFrom}`;
        waitingFrom = undefined;
    };
    /** Rows `[from, to]` hidden: the gap being gathered runs on over them. */
    const hide = (from: number, to: number) => {
        closeWaiting();
        if (gapFrom === undefined) gapFrom = from;
        gapTo = to;
    };
    /** Rows `[from, to]` to show, not read yet: the band waiting for them runs on over them. */
    const wait = (from: number, to: number) => {
        closeGap();
        if (waitingFrom === undefined) waitingFrom = from;
        waitingTo = to;
    };
    /** A row read, shown. */
    const show = (p: number, row: LensRow, hit: boolean) => {
        closeWaiting();
        closeGap();
        items.push({ kind: "row", position: p, row: row.row, hit });
        shown++;
        if (hit) { hits++; anchor = `h${p}`; }
    };
    /** Rows `[from, to]` to show whose read failed: a failed band where they would be. */
    const fail = (from: number, to: number, error: string) => {
        closeWaiting();
        closeGap();
        items.push({ kind: "failed", failure: { w: from, from, to, px: Math.max(BAND_MIN_PX, (to - from + 1) * geometry.entryPx), error } });
        anchor = `u${from}`;
    };
    /** Rows `[a, b]` of an empty stretch to show: those read, a failed band over those whose read failed, and a band over the rest. */
    const showRun = (a: number, b: number) => {
        let p = a;
        let k = readAtOrAfter(read, a);
        let f = runAtOrAfter(failed, a);
        while (p <= b) {
            const failure = failed[f];
            if (failure !== undefined && failure.from <= p) {
                const end = Math.min(b, failure.to);
                fail(p, end, failure.error);
                p = end + 1;
                f++;
                while (k < read.length && read[k]! < p) k++;
                continue;
            }
            const q = read[k];
            if (q === p) {
                show(p, facts.rowAt(p)!, false);
                p++;
                k++;
                continue;
            }
            const end = Math.min(b, (q ?? Infinity) - 1, (failure?.from ?? Infinity) - 1);
            wait(p, end);
            p = end + 1;
        }
    };
    regions.forEach((region, at) => {
        const state = drawn[at]!;
        if (region.kind === "unplaced" || (region.kind === "matched" && state.kind !== "read")) {
            closeWaiting();
            closeGap();
            const count = region.to - region.from;
            if (state.kind === "failed") {
                items.push({ kind: "failed", failure: { w: region.from, from: region.from, to: region.to - 1, px: estimatePx(count, region.matches, context, geometry), error: state.error } });
            } else {
                const matches = region.kind === "matched" ? region.matches : Math.round(density * count);
                items.push({ kind: "pending", band: { at: "reading", from: region.from, to: region.to - 1, px: estimatePx(count, matches, context, geometry) } });
            }
            anchor = `u${region.from}`;
            return;
        }
        if (region.kind === "matched") {
            for (let p = region.from; p < region.to; p++) {
                const row = facts.rowAt(p);
                if (row !== undefined && visibleAt(p, at)) show(p, row, hitAt(p, at));
                else hide(p, p);
            }
            return;
        }
        // An empty stretch: hidden but for the context of a match beside it, and the runs the planner opened.
        const near: LensRun[] = [];
        for (let d = 1; d <= context; d++) {
            if (hitAt(region.from - d, at - 1)) near.push({ from: region.from, to: Math.min(region.to - 1, region.from + context - d) });
            if (hitAt(region.to - 1 + d, at + 1)) near.push({ from: Math.max(region.from, region.to - 1 - (context - d)), to: region.to - 1 });
        }
        for (let r = runAtOrAfter(reveals, region.from); r < reveals.length && reveals[r]!.from < region.to; r++) {
            near.push({ from: Math.max(region.from, reveals[r]!.from), to: Math.min(region.to - 1, reveals[r]!.to) });
        }
        near.sort((x, y) => x.from - y.from);
        let p = region.from;
        for (const run of near) {
            if (run.to < p) continue;
            const a = Math.max(p, run.from);
            if (a > p) hide(p, a - 1);
            showRun(a, run.to);
            p = run.to + 1;
        }
        if (p < region.to) hide(p, region.to - 1);
    });
    closeWaiting();
    closeGap();
    // Each gap's key: the anchors either side of it — a match or a band — so it keeps its key as rows open inside it;
    // a run the planner opened between the same two splits their gap, and the gaps after the first count on.
    let after = "e";
    for (let i = items.length - 1, g = gaps.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.kind === "row" && item.hit) after = `h${item.position}`;
        else if (item.kind === "pending" || item.kind === "failed") after = `u${item.kind === "pending" ? item.band.from : item.failure.from}`;
        else if (item.kind === "gap" && g >= 0 && gaps[g]!.at === i) {
            item.gap.key = `${gaps[g]!.before}_${after}`;
            g--;
        }
    }
    const seen = new Map<string, number>();
    for (const item of items) {
        if (item.kind !== "gap") continue;
        const n = seen.get(item.gap.key) ?? 0;
        seen.set(item.gap.key, n + 1);
        if (n > 0) item.gap.key = `${item.gap.key}#${n}`;
    }
    return { items, hits, shown };
}

/**
 * The lens's layout over the rows the local layer leaves (#1349): each row
 * the layout draws as the layer has it — a drafted row in its place, a removed
 * one gone, the gaps and bands around it kept — and a row the planner added
 * in its turn among them, after the row before it.
 *
 * @param layout - The lens laid out over the record
 * @param rows - The rows drawn with the local layer applied, in order
 * @param positions - Each of those rows' positions in the record
 * @returns What the lens's body draws, in order
 */
export function lensBodyItems(layout: LensLayout, rows: readonly SheetRowValue[], positions: readonly number[]): LensBodyInput[] {
    const placed = new Map<string, { index: number; hit: boolean }>();
    layout.items.forEach((item, index) => { if (item.kind === "row") placed.set(item.row.id, { index, hit: item.hit }); });
    const out: LensBodyInput[] = [];
    let next = 0;
    /** The layout's items before `to` that are not its rows: the rows come from `rows`. */
    const flush = (to: number) => {
        for (; next < to; next++) {
            const item = layout.items[next]!;
            if (item.kind === "gap") out.push({ kind: "gap", gap: item.gap });
            else if (item.kind === "pending") out.push({ kind: "band", band: item.band });
            else if (item.kind === "failed") out.push({ kind: "failed", failure: item.failure });
        }
    };
    rows.forEach((row, i) => {
        const at = placed.get(row.id);
        if (at !== undefined && at.index >= next) {
            flush(at.index);
            next = at.index + 1;
        }
        out.push({ kind: "row", position: positions[i]!, row, hit: at?.hit ?? false });
    });
    flush(layout.items.length);
    return out;
}
