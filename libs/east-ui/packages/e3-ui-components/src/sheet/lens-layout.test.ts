/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * The lens laid out over a record (#1349, B§8), a filtered spreadsheet: the
 * record's stretches from where e3 placed a narrowing's rows, the reads they
 * take and which of them a view demands, and the layout — only the rows the
 * narrowing keeps, one after another, each at its row number; a band as tall
 * as the rows it stands for over what is not read or placed yet; a failed
 * band, the same size, for a read that failed or a segment whose rows
 * disagree with its placement — and that layout over the rows the local layer
 * leaves.
 */

import { describe, test, expect } from "vitest";
import { none } from "@elaraai/east";
import {
    LENS_PIECE_ROWS, layoutLens, lensBodyItems, lensDemand, lensPieces, lensReadInTurns, lensRegions,
    type LensFacts, type LensGeometry, type LensItem, type LensLayout, type LensPiece, type LensPlacement, type LensRow, type LensSegmentState,
} from "./lens-layout.js";
import type { SheetRowValue } from "./values.js";

const row = (id: string): SheetRowValue => ({ id, owned: false, cells: new Map(), lines: [], band: none, subRows: [] });
const G: LensGeometry = { entryPx: 30 };
const WORDS = { changed: "the record changed while they were read" };

/**
 * What the lens has read: each run's rows, `r{position}`, the narrowing holding
 * those in `hits` where it was asked; each segment read unless `states` says
 * otherwise.
 */
function factsOf(placement: LensPlacement, read: { from: number; to: number; hits?: number[] }[], states: Record<number, LensSegmentState> = {}): LensFacts {
    const rows = new Map<number, LensRow>();
    for (const r of read) for (let p = r.from; p <= r.to; p++) rows.set(p, { row: row(`r${p}`), hit: r.hits === undefined ? undefined : r.hits.includes(p) });
    return {
        placement,
        segmentState: (offset) => states[offset] ?? { kind: "read" },
        rowAt: (p) => rows.get(p),
    };
}

/** Each item in short: a row by its position, a band and a failed band by their rows and how many of the narrowing's rows they stand for. */
function shape(layout: LensLayout): string[] {
    return layout.items.map((it: LensItem) => {
        switch (it.kind) {
            case "row": return `${it.position}`;
            case "pending": return `band ${it.band.from}-${it.band.to} ×${it.band.elements}`;
            case "failed": return `failed ${it.failure.from}-${it.failure.to} ×${it.failure.elements}`;
        }
    });
}

/** How tall the layout draws, px: its rows at the pitch, and every band and failed band as tall as it is. */
function heightOf(layout: LensLayout, geometry: LensGeometry): number {
    return layout.items.reduce((px, it) => px + (it.kind === "row" ? geometry.entryPx : it.kind === "pending" ? it.band.px : it.failure.px), 0);
}

/** A record of 100 rows whose one segment, rows 40–59, holds the narrowing's matches; while the placement goes on, ten matches in all. */
const ONE_SEGMENT = (matches: number, complete = true): LensPlacement => ({
    records: 100, segments: [{ offset: 40, count: 20, matches }], matches: complete ? matches : 10, placed: matches, complete,
});
/** The segment read whole. */
const SEGMENT_READ = (hits: number[]) => [{ from: 40, to: 59, hits }];

describe("the record's stretches and their reads", () => {
    test("each segment of matches — and, while the placement goes on, the stretches not placed yet; once it is complete a stretch between them holds none and is none of the lens's", () => {
        expect(lensRegions(ONE_SEGMENT(2))).toEqual([{ kind: "matched", from: 40, to: 60, matches: 2 }]);
        expect(lensRegions(ONE_SEGMENT(2, false)).map((r) => `${r.kind} ${r.from}-${r.to}`)).toEqual(["unplaced 0-40", "matched 40-60", "unplaced 60-100"]);
        // Two segments side by side, the record ending with the second.
        expect(lensRegions({ records: 30, segments: [{ offset: 0, count: 10, matches: 1 }, { offset: 10, count: 20, matches: 1 }], matches: 2, placed: 2, complete: true })
            .map((r) => `${r.kind} ${r.from}-${r.to}`)).toEqual(["matched 0-10", "matched 10-30"]);
    });

    test("a segment of matches is read whole, in pages of a record Slice's page; a stretch with none, or not placed yet, takes no read", () => {
        const placement: LensPlacement = { records: 10_000, segments: [{ offset: 1000, count: 4100, matches: 5 }], matches: 5, placed: 5, complete: true };
        expect(lensPieces(lensRegions(placement))).toEqual([
            { key: `1000+${LENS_PIECE_ROWS}`, from: 1000, count: LENS_PIECE_ROWS, segment: 1000 },
            { key: `${1000 + LENS_PIECE_ROWS}+${LENS_PIECE_ROWS}`, from: 1000 + LENS_PIECE_ROWS, count: LENS_PIECE_ROWS, segment: 1000 },
            { key: "5096+4", from: 5096, count: 4, segment: 1000 },
        ]);
        // The stretches not placed yet read nothing: only the segment does.
        expect(lensPieces(lensRegions({ ...placement, complete: false })).map((p) => p.segment)).toEqual([1000, 1000, 1000]);
        // Two segments side by side read their own rows each, and nothing beside them.
        const pair: LensPlacement = { records: 30, segments: [{ offset: 0, count: 10, matches: 1 }, { offset: 10, count: 20, matches: 1 }], matches: 2, placed: 2, complete: true };
        expect(lensPieces(lensRegions(pair)).map((p) => [p.from, p.count])).toEqual([[0, 10], [10, 20]]);
    });

    test("a view wants the segments it meets, in the record's order, then the nearest beyond them, after and then before — a segment's pages together", () => {
        const pieces = [
            { key: "a1", from: 0, count: 2048, segment: 0 }, { key: "a2", from: 2048, count: 2048, segment: 0 },
            { key: "b", from: 6000, count: 1000, segment: 6000 },
            { key: "c", from: 8000, count: 1000, segment: 8000 },
        ];
        const keys = (groups: LensPiece[][]) => groups.map((g) => g.map((p) => p.key).join("+"));
        expect(keys(lensDemand(pieces, 100, 200, 1))).toEqual(["a1+a2", "b"]);
        expect(keys(lensDemand(pieces, 6500, 6600, 1))).toEqual(["b", "c", "a1+a2"]);
        expect(keys(lensDemand(pieces, 6500, 6600, 2))).toEqual(["b", "c", "a1+a2"]);
        expect(keys(lensDemand(pieces, 3000, 8500, 0))).toEqual(["a1+a2", "b", "c"]);
        // A view past the end wants the last segment.
        expect(keys(lensDemand(pieces, 20_000, 20_100, 0))).toEqual(["c"]);
        expect(lensDemand([], 0, 10, 2)).toEqual([]);
    });

    test("the wanted reads are asked in turns, at most the budget in flight: a segment past it waits whole, a landing frees room, and what lands as it is asked takes none", () => {
        // A tall view over sparse matches: twenty segments of one page each, and one of three pages.
        const groups: LensPiece[][] = [
            ...Array.from({ length: 20 }, (_x, i) => [{ key: `s${i}`, from: i * 1000, count: 1000, segment: i * 1000 }]),
            [0, 1, 2].map((j) => ({ key: `t${j}`, from: 20_000 + j * 2048, count: 2048, segment: 20_000 })),
        ];
        const held = new Set<string>();
        const now = new Set<string>();
        /** One turn: what it asks, each answered at once when `now` holds it, else in flight. */
        const turn = (budget: number): string[] => {
            const asked: string[] = [];
            lensReadInTurns(groups, (p) => held.has(p.key), (p) => {
                asked.push(p.key);
                if (!now.has(p.key)) return false;
                held.add(p.key);
                return true;
            }, budget);
            return asked;
        };
        // The first turn asks the first sixteen; the rest wait — none is dropped.
        expect(turn(16)).toEqual(Array.from({ length: 16 }, (_x, i) => `s${i}`));
        // Twelve land: kept, and asked no more. The four still in flight count against the budget: twelve more fit,
        // the four remaining one-page segments and — a whole segment of three — the last.
        for (let i = 0; i < 12; i++) held.add(`s${i}`);
        expect(turn(16)).toEqual([...Array.from({ length: 8 }, (_x, i) => `s${12 + i}`), "t0", "t1", "t2"]);
        // A segment that would pass the budget waits whole: with room for two, the three pages of `t` are not asked.
        expect(turn(10)).toEqual(Array.from({ length: 8 }, (_x, i) => `s${12 + i}`));
        // Pages already held land as they are asked and take no room: with room for one segment of three pages, every
        // wanted read is had in one turn.
        held.clear();
        for (const g of groups) for (const p of g) now.add(p.key);
        expect(turn(3)).toEqual([...Array.from({ length: 20 }, (_x, i) => `s${i}`), "t0", "t1", "t2"]);
        expect(held.size).toBe(23);
    });
});

describe("the layout", () => {
    test("only the rows the narrowing keeps, one after another in the record's order, each at its row number, and nothing between them", () => {
        const layout = layoutLens(factsOf(ONE_SEGMENT(2), SEGMENT_READ([45, 50])), G, WORDS);
        expect(shape(layout)).toEqual(["45", "50"]);
        expect(layout.items).toEqual([
            { kind: "row", position: 45, row: row("r45") },
            { kind: "row", position: 50, row: row("r50") },
        ]);
        expect(layout.hits).toBe(2);
        // A row whose answer is not in yet is not drawn: only what the narrowing holds is.
        const asked = layoutLens(factsOf(ONE_SEGMENT(2, false), [{ from: 40, to: 59 }]), G, WORDS);
        expect(asked.hits).toBe(0);
    });

    test("a segment not read yet is one band where its rows will be drawn, standing for its matches at the rows' pitch; a read that failed is a failed band the same size", () => {
        const unread = layoutLens(factsOf(ONE_SEGMENT(2), [], { 40: { kind: "unread" } }), G, WORDS);
        expect(unread.items).toEqual([{ kind: "pending", band: { at: "reading", from: 40, to: 59, elements: 2, px: 60 } }]);
        const failed = layoutLens(factsOf(ONE_SEGMENT(2), [], { 40: { kind: "failed", error: "gateway timeout" } }), G, WORDS);
        expect(failed.items).toEqual([{ kind: "failed", failure: { w: 40, from: 40, to: 59, elements: 2, px: 60, error: "gateway timeout" } }]);
        expect(failed.hits).toBe(0);
        // On a grouped sheet each of the narrowing's records draws a band and a line: the band is that tall a record.
        const grouped = layoutLens(factsOf(ONE_SEGMENT(2), [], { 40: { kind: "unread" } }), { entryPx: 78 }, WORDS);
        expect(grouped.items).toEqual([{ kind: "pending", band: { at: "reading", from: 40, to: 59, elements: 2, px: 156 } }]);
    });

    test("a segment whose rows hold other matches than e3 placed there is a failed band that says the record changed — never rows that would show a match the index does not hold", () => {
        const layout = layoutLens(factsOf(ONE_SEGMENT(2), SEGMENT_READ([45])), G, WORDS);
        expect(layout.items).toEqual([{ kind: "failed", failure: { w: 40, from: 40, to: 59, elements: 2, px: 60, error: WORDS.changed } }]);
        // While the placement goes on, a segment's count is not the whole of it: nothing is checked, and its rows draw.
        expect(shape(layoutLens(factsOf(ONE_SEGMENT(2, false), SEGMENT_READ([45, 50, 55])), G, WORDS))).toEqual(["band 0-39 ×4", "45", "50", "55", "band 60-99 ×3"]);
    });

    test("a stretch not placed yet is a band of the matches not placed yet, spread by the narrowing's density, so the bands and the rows add up to its every match", () => {
        // 10 matches, 2 placed and read in the segment: the other 8 over the 80 rows not placed — four in each stretch.
        const read = layoutLens(factsOf(ONE_SEGMENT(2, false), SEGMENT_READ([45, 50])), G, WORDS);
        expect(shape(read)).toEqual(["band 0-39 ×4", "45", "50", "band 60-99 ×4"]);
        expect(read.items[0]).toEqual({ kind: "pending", band: { at: "reading", from: 0, to: 39, elements: 4, px: 120 } });
        // The segment not read yet: its rows not placed as matches are room for the rest too, each share rounded so they add up.
        const unread = layoutLens(factsOf(ONE_SEGMENT(2, false), [], { 40: { kind: "unread" } }), G, WORDS);
        expect(shape(unread)).toEqual(["band 0-39 ×3", "band 40-59 ×4", "band 60-99 ×3"]);
        expect(heightOf(read, G)).toBe(10 * G.entryPx);
        expect(heightOf(unread, G)).toBe(10 * G.entryPx);
    });

    test("the layout is as tall as the narrowing's rows at their pitch, however much of it is read — rows, bands and failed bands alike", () => {
        const placement: LensPlacement = {
            records: 1000, segments: [{ offset: 0, count: 100, matches: 3 }, { offset: 200, count: 100, matches: 5 }, { offset: 500, count: 100, matches: 2 }],
            matches: 10, placed: 10, complete: true,
        };
        const layout = layoutLens(factsOf(placement, [{ from: 0, to: 99, hits: [5, 50, 99] }], { 200: { kind: "unread" }, 500: { kind: "failed", error: "gone" } }), G, WORDS);
        expect(shape(layout)).toEqual(["5", "50", "99", "band 200-299 ×5", "failed 500-599 ×2"]);
        expect(heightOf(layout, G)).toBe(placement.matches * G.entryPx);
        // As each segment lands, the height holds: its band becomes its rows.
        const landed = layoutLens(factsOf(placement, [{ from: 0, to: 99, hits: [5, 50, 99] }, { from: 200, to: 299, hits: [201, 210, 220, 230, 299] }],
            { 500: { kind: "failed", error: "gone" } }), G, WORDS);
        expect(shape(landed)).toEqual(["5", "50", "99", "201", "210", "220", "230", "299", "failed 500-599 ×2"]);
        expect(heightOf(landed, G)).toBe(placement.matches * G.entryPx);
    });

    test("its work is the segments it reads, never the record's size: a million rows' segment not read is one band", () => {
        const placement: LensPlacement = {
            records: 1_000_000, segments: [{ offset: 0, count: 1000, matches: 1 }, { offset: 500_000, count: 1000, matches: 4 }], matches: 5, placed: 5, complete: true,
        };
        const facts = factsOf(placement, [{ from: 0, to: 999, hits: [0] }], { 500_000: { kind: "unread" } });
        // What it asks of the rows it knows, counted: a few looks at each of the read segment's thousand, none past them.
        let looks = 0;
        const counted: LensFacts = { ...facts, rowAt: (p) => { looks++; return facts.rowAt(p); } };
        const layout = layoutLens(counted, G, WORDS);
        expect(looks).toBeLessThan(3 * 1000);
        expect(shape(layout)).toEqual(["0", "band 500000-500999 ×4"]);
    });
});

describe("the layout over the rows the local layer leaves", () => {
    test("a drafted row in its place, a removed one gone, a new one after the row before it, and the bands as they were laid out", () => {
        const placement: LensPlacement = { records: 100, segments: [{ offset: 10, count: 10, matches: 1 }, { offset: 40, count: 20, matches: 2 }], matches: 3, placed: 3, complete: true };
        const layout = layoutLens(factsOf(placement, SEGMENT_READ([45, 50]), { 10: { kind: "unread" } }), G, WORDS);
        expect(shape(layout)).toEqual(["band 10-19 ×1", "45", "50"]);
        const drafted = { ...row("r45") };
        const added = row("new");
        // Row 50 removed, a new row after 45.
        const out = lensBodyItems(layout, [drafted, added], [45, 46]);
        expect(out.map((it) => (it.kind === "row" ? `${it.row.id}@${it.position}${it.hit ? "*" : ""}` : it.kind))).toEqual(["band", "r45@45*", "new@46"]);
        expect(out[1]).toMatchObject({ kind: "row", row: drafted, hit: true });
        expect(out[2]).toMatchObject({ kind: "row", row: added, hit: false });
        // Nothing drawn yet: the bands alone.
        const unread = layoutLens(factsOf(ONE_SEGMENT(2), [], { 40: { kind: "unread" } }), G, WORDS);
        expect(lensBodyItems(unread, [], []).map((it) => it.kind)).toEqual(["band"]);
    });
});
