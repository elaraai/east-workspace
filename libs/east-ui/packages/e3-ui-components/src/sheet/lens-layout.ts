/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lens over a record (#1349, B§8): a filtered spreadsheet — only the rows
 * a narrowing keeps, one after another in the record's order, each at its row
 * number — laid out by where e3 places them. Pure: no React, no reads.
 *
 * e3 places a narrowing's rows segment by segment ({@link LensSegment}): how
 * many of them each record segment holds, read from the index alone. A segment
 * that holds none draws nothing and is never read. A segment that holds some
 * is read — its rows by position, and which of them the narrowing holds, asked
 * of e3 in one read — and draws the rows the narrowing holds. Until it is read
 * it is one band of as many rows as it holds matches, its placeholders at the
 * rows' own pitch: its rows land where they stood, and nothing around them
 * moves. So the layout is as tall as the narrowing's rows, e3's count of them,
 * however much of it is read.
 *
 * While the placement is incomplete, the matches not placed yet are spread,
 * by the narrowing's density, over where they can still lie — the stretches no
 * segment is listed for yet and the segments not read — so the bands and the
 * rows add up to the narrowing's every row then too.
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

import type { LensBodyInput, SheetBand, SheetWindowFailure } from "./model.js";
import type { SheetRowValue } from "./values.js";

/** The most rows the lens reads in one page: a record Slice's page holds no more. */
export const LENS_PIECE_ROWS = 2048;

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

/** One row the lens has read: the row, and whether the narrowing holds it, once asked. */
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
    /** A row read, by its position in the record. */
    rowAt: (position: number) => LensRow | undefined;
}

/** How the lens draws what it has not read: the height of one of the narrowing's records drawn — a row, or on a grouped sheet a group's band and a line. */
export interface LensGeometry {
    entryPx: number;
}

/** One item of the lens, in the record's order. */
export type LensItem =
    /** A row the narrowing holds, at its position in the record. */
    | { kind: "row"; position: number; row: SheetRowValue }
    /** Rows the lens has still to read, or to place: one band of their height, where they will be drawn. */
    | { kind: "pending"; band: SheetBand }
    /** A segment whose read failed, or whose rows disagree with where e3 placed the narrowing's: one band, with a Retry. */
    | { kind: "failed"; failure: SheetWindowFailure };

/** The lens laid out: its items, and how many of the narrowing's rows it draws. */
export interface LensLayout {
    items: LensItem[];
    /** The matches drawn. */
    hits: number;
}

/** One stretch of the record, in its order: a segment of matches, or — while the placement is incomplete — a stretch not placed yet. */
export interface LensRegion {
    kind: "matched" | "unplaced";
    /** Its first row. */
    from: number;
    /** One past its last row. */
    to: number;
    /** A segment of matches': its matches, as placed so far. */
    matches: number;
}

/**
 * The record's stretches that can hold the narrowing's rows, in its order:
 * each segment of matches, and, while the placement is incomplete, the
 * stretches between them that are not placed yet. Once it is complete, a
 * stretch between the segments holds none: it is no stretch of the lens's.
 *
 * @param placement - Where the narrowing's rows sit
 * @returns The stretches
 */
export function lensRegions(placement: LensPlacement): LensRegion[] {
    const out: LensRegion[] = [];
    let at = 0;
    for (const segment of placement.segments) {
        if (!placement.complete && segment.offset > at) out.push({ kind: "unplaced", from: at, to: segment.offset, matches: 0 });
        out.push({ kind: "matched", from: segment.offset, to: segment.offset + segment.count, matches: segment.matches });
        at = segment.offset + segment.count;
    }
    if (!placement.complete && placement.records > at) out.push({ kind: "unplaced", from: at, to: placement.records, matches: 0 });
    return out;
}

/** One read the lens makes: a segment of matches' rows by position, and which of them the narrowing holds. */
export interface LensPiece {
    /** Its key: its first row and how many. */
    key: string;
    /** Its first row. */
    from: number;
    /** How many rows. */
    count: number;
    /** The segment of matches it reads, by its first row. */
    segment: number;
}

/**
 * The reads the lens's stretches take: each segment of matches whole, in pages
 * of at most {@link LENS_PIECE_ROWS}. A stretch not placed yet takes none.
 *
 * @param regions - The record's stretches
 * @returns The reads, in the record's order
 */
export function lensPieces(regions: readonly LensRegion[]): LensPiece[] {
    const out: LensPiece[] = [];
    for (const region of regions) {
        if (region.kind !== "matched") continue;
        for (let at = region.from; at < region.to; at += LENS_PIECE_ROWS) {
            const count = Math.min(LENS_PIECE_ROWS, region.to - at);
            out.push({ key: `${at}+${count}`, from: at, count, segment: region.from });
        }
    }
    return out;
}

/**
 * The reads a view of the record's rows `[from, to]` wants, in the order they
 * are read: every segment that view meets, in the record's order, then the
 * nearest segments beyond it, after it and then before it, `beyond` of them
 * on each side. Each segment's pages are one group, read together, so a
 * segment is read whole or not at all. What has landed of them is kept while
 * they are wanted, however many there are: {@link lensReadInTurns} reads the
 * rest a turn at a time.
 *
 * @param pieces - Every read the lens takes, in the record's order
 * @param from - The view's first row
 * @param to - The view's last row
 * @param beyond - How many segments past the view on each side
 * @returns The groups wanted, in the order they are read
 */
export function lensDemand(pieces: readonly LensPiece[], from: number, to: number, beyond: number): LensPiece[][] {
    // Consecutive pieces of one segment read together.
    const groups: LensPiece[][] = [];
    for (const p of pieces) {
        const last = groups[groups.length - 1];
        if (last !== undefined && last[0]!.segment === p.segment) last.push(p);
        else groups.push([p]);
    }
    if (groups.length === 0) return [];
    const end = (g: LensPiece[]) => g[g.length - 1]!.from + g[g.length - 1]!.count;
    // The first group ending past the view's first row, and the last starting at or before its last.
    let first = groups.findIndex((g) => end(g) > from);
    if (first < 0) first = groups.length - 1;
    let last = first;
    while (last + 1 < groups.length && groups[last + 1]![0]!.from <= to) last++;
    const out = groups.slice(first, last + 1);
    for (let d = 1; d <= beyond; d++) {
        const after = groups[last + d];
        if (after !== undefined) out.push(after);
        const before = groups[first - d];
        if (before !== undefined) out.push(before);
    }
    return out;
}

/**
 * Asks for the wanted reads that have not landed, in their order, with at
 * most `budget` pieces in flight at once, so the record Slice's and the paging
 * runtime's bounded caches hold every page in flight: a group that would pass
 * the budget waits whole for a later turn, as one landing frees room for it.
 * A piece that lands as it is asked — its pages already held — takes no room,
 * so a view whose reads are held is read whole in one turn.
 *
 * @param groups - The groups wanted, in the order they are read ({@link lensDemand})
 * @param landed - Whether a piece has landed whole, or failed: either way, not asked again
 * @param request - Asks for a piece, returning whether it has landed whole
 * @param budget - The most pieces in flight at once
 */
export function lensReadInTurns(
    groups: readonly (readonly LensPiece[])[],
    landed: (piece: LensPiece) => boolean,
    request: (piece: LensPiece) => boolean,
    budget: number,
): void {
    let inFlight = 0;
    for (const group of groups) {
        const unread = group.filter((p) => !landed(p));
        if (unread.length === 0 || inFlight + unread.length > budget) continue;
        for (const p of unread) if (!request(p)) inFlight++;
    }
}

/** Words the layout puts in a failed band: why a segment's rows cannot be drawn. */
export interface LensWords {
    /** A segment whose rows disagree with where e3 placed the narrowing's rows: the record changed between the two reads. */
    changed: string;
}

/**
 * Lays the lens out: the narrowing's rows, one after another in the record's
 * order, each at its row number; a band for each stretch of them not read or
 * not placed yet, as tall as the rows it stands for; a failed band for each
 * segment whose read failed or whose matches disagree with its placement. Its
 * work is the segments read, never the record's size.
 *
 * @param facts - What the lens knows of the record
 * @param geometry - How tall what is not read yet is drawn
 * @param words - The failed band's words
 * @returns The items, in the record's order, and how many of the narrowing's rows it draws
 */
export function layoutLens(facts: LensFacts, geometry: LensGeometry, words: LensWords): LensLayout {
    const { placement } = facts;
    const regions = lensRegions(placement);
    // A segment read: the rows it holds that the narrowing holds, which — once every row is placed — must be as many
    // as e3 placed there.
    const held = regions.map((region) => {
        if (region.kind !== "matched" || facts.segmentState(region.from).kind !== "read") return 0;
        let n = 0;
        for (let p = region.from; p < region.to; p++) if (facts.rowAt(p)?.hit === true) n++;
        return n;
    });
    const states = regions.map((region, i): LensSegmentState => {
        if (region.kind !== "matched") return { kind: "unread" };
        const state = facts.segmentState(region.from);
        if (state.kind !== "read" || !placement.complete) return state;
        return held[i] === region.matches ? state : { kind: "failed", error: words.changed };
    });
    const read = (i: number) => regions[i]!.kind === "matched" && states[i]!.kind === "read";
    // What the stretches draw for sure — a read segment its matches, any other segment the matches placed in it — and
    // the rows still able to hold a match not placed yet: a stretch not placed, and a segment's rows not read.
    let sure = 0;
    let room = 0;
    regions.forEach((region, i) => {
        if (read(i)) { sure += held[i]!; return; }
        sure += region.matches;
        room += region.to - region.from - region.matches;
    });
    // The matches not placed yet, spread over that room by the narrowing's density there, each stretch's share rounded
    // so the shares add up to them exactly.
    const rest = placement.complete ? 0 : Math.max(0, placement.matches - sure);
    let reached = 0;
    let given = 0;
    const extra = regions.map((region, i) => {
        if (rest === 0 || room === 0 || read(i)) return 0;
        reached += region.to - region.from - region.matches;
        const upTo = Math.round((rest * reached) / room);
        const share = upTo - given;
        given = upTo;
        return share;
    });
    const items: LensItem[] = [];
    let hits = 0;
    regions.forEach((region, i) => {
        if (read(i)) {
            for (let p = region.from; p < region.to; p++) {
                const row = facts.rowAt(p);
                if (row?.hit !== true) continue;
                items.push({ kind: "row", position: p, row: row.row });
                hits++;
            }
            return;
        }
        const elements = region.matches + extra[i]!;
        if (elements === 0) return;
        const px = elements * geometry.entryPx;
        const state = states[i]!;
        if (state.kind === "failed") {
            items.push({ kind: "failed", failure: { w: region.from, from: region.from, to: region.to - 1, elements, px, error: state.error } });
        } else {
            items.push({ kind: "pending", band: { at: "reading", from: region.from, to: region.to - 1, elements, px } });
        }
    });
    return { items, hits };
}

/**
 * The lens's layout over the rows the local layer leaves (#1349): each row
 * the layout draws as the layer has it — a drafted row in its place, a removed
 * one gone, the bands around it kept — and a row the planner added in its turn
 * among them, after the row before it.
 *
 * @param layout - The lens laid out over the record
 * @param rows - The rows drawn with the local layer applied, in order
 * @param positions - Each of those rows' positions in the record
 * @returns What the lens's body draws, in order
 */
export function lensBodyItems(layout: LensLayout, rows: readonly SheetRowValue[], positions: readonly number[]): LensBodyInput[] {
    const placed = new Map<string, number>();
    layout.items.forEach((item, index) => { if (item.kind === "row") placed.set(item.row.id, index); });
    const out: LensBodyInput[] = [];
    let next = 0;
    /** The layout's items before `to` that are not its rows: the rows come from `rows`. */
    const flush = (to: number) => {
        for (; next < to; next++) {
            const item = layout.items[next]!;
            if (item.kind === "pending") out.push({ kind: "band", band: item.band });
            else if (item.kind === "failed") out.push({ kind: "failed", failure: item.failure });
        }
    };
    rows.forEach((row, i) => {
        const at = placed.get(row.id);
        if (at !== undefined && at >= next) {
            flush(at);
            next = at + 1;
        }
        // A row the layout drew is one the narrowing holds; a row the planner added is not, until the record says so.
        out.push({ kind: "row", position: positions[i]!, row, hit: at !== undefined });
    });
    flush(layout.items.length);
    return out;
}
