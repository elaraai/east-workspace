/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * The lens laid out over a record (#1349, B§8): the record's stretches from
 * where e3 placed a narrowing's rows, the reads they take and which of them a
 * view demands, and the layout — each match at its row number, its context,
 * the runs the planner opened, a band over each run of the rest, a band for
 * what is not read or placed yet, a failed band for a read that failed or a
 * segment whose rows disagree with its placement — and that layout over the
 * rows the local layer leaves.
 */

import { describe, test, expect } from "vitest";
import { none } from "@elaraai/east";
import {
    LENS_EDGE_ROWS, LENS_PIECE_ROWS, LENS_REVEAL_ROWS, layoutLens, lensBodyItems, lensDemand, lensPieces, lensReadInTurns, lensRegions,
    type LensFacts, type LensGeometry, type LensItem, type LensLayout, type LensPiece, type LensPlacement, type LensRow, type LensSegmentState,
} from "./lens-layout.js";
import type { LensRun } from "./lens.js";
import type { SheetRowValue } from "./values.js";

const row = (id: string): SheetRowValue => ({ id, owned: false, cells: new Map(), lines: [], band: none, subRows: [] });
const G: LensGeometry = { rowPx: 30, entryPx: 30 };
const WORDS = { changed: "the record changed while they were read" };

/**
 * What the lens has read: each run's rows, `r{position}`, the narrowing holding
 * those in `hits` where it was asked; each segment read unless `states` says
 * otherwise; and the planner's runs whose read failed.
 */
function factsOf(placement: LensPlacement, read: { from: number; to: number; hits?: number[] }[], states: Record<number, LensSegmentState> = {},
    failed: (LensRun & { error: string })[] = []): LensFacts {
    const rows = new Map<number, LensRow>();
    for (const r of read) for (let p = r.from; p <= r.to; p++) rows.set(p, { row: row(`r${p}`), hit: r.hits === undefined ? undefined : r.hits.includes(p) });
    return {
        placement,
        segmentState: (offset) => states[offset] ?? { kind: "read" },
        rowAt: (p) => rows.get(p),
        read: [...rows.keys()].sort((a, b) => a - b),
        failed,
    };
}

/** Each item in short: a row by its position (`*` a match), a gap, a band, a failed band, by their rows. */
function shape(layout: LensLayout): string[] {
    return layout.items.map((it: LensItem) => {
        switch (it.kind) {
            case "row": return `${it.position}${it.hit ? "*" : ""}`;
            case "gap": return `gap ${it.gap.from}-${it.gap.to}`;
            case "pending": return `band ${it.band.from}-${it.band.to}`;
            case "failed": return `failed ${it.failure.from}-${it.failure.to}`;
        }
    });
}

/** A record of 100 rows whose one segment, rows 40–59, holds the narrowing's matches. */
const ONE_SEGMENT = (matches: number, complete = true): LensPlacement => ({
    records: 100, segments: [{ offset: 40, count: 20, matches }], matches: complete ? matches : 10, placed: matches, complete,
});
/** The segment read, with the edges either side of it. */
const SEGMENT_READ = (hits: number[]) => [{ from: 40 - LENS_EDGE_ROWS, to: 59 + LENS_EDGE_ROWS, hits }];

describe("the record's stretches and their reads", () => {
    test("each segment of matches, and between them the stretches with none — or, while the placement goes on, not placed yet", () => {
        expect(lensRegions(ONE_SEGMENT(2))).toEqual([
            { kind: "empty", from: 0, to: 40, matches: 0 }, { kind: "matched", from: 40, to: 60, matches: 2 }, { kind: "empty", from: 60, to: 100, matches: 0 },
        ]);
        expect(lensRegions(ONE_SEGMENT(2, false)).map((r) => r.kind)).toEqual(["unplaced", "matched", "unplaced"]);
        // Two segments side by side, the record ending with the second.
        expect(lensRegions({ records: 30, segments: [{ offset: 0, count: 10, matches: 1 }, { offset: 10, count: 20, matches: 1 }], matches: 2, placed: 2, complete: true })
            .map((r) => `${r.kind} ${r.from}-${r.to}`)).toEqual(["matched 0-10", "matched 10-30"]);
    });

    test("a segment is read whole, with the rows beside it in an empty stretch, in pages; a run the planner opened in an empty stretch, a window at a time", () => {
        const placement: LensPlacement = { records: 10_000, segments: [{ offset: 1000, count: 4096, matches: 5 }], matches: 5, placed: 5, complete: true };
        const segment = lensPieces(lensRegions(placement), []);
        expect(segment).toEqual([
            { key: `997+${LENS_PIECE_ROWS}`, from: 997, count: LENS_PIECE_ROWS, segment: 1000 },
            { key: `${997 + LENS_PIECE_ROWS}+${LENS_PIECE_ROWS}`, from: 997 + LENS_PIECE_ROWS, count: LENS_PIECE_ROWS, segment: 1000 },
            { key: "5093+6", from: 5093, count: 6, segment: 1000 },
        ]);
        // The runs opened after it: their windows, aligned to the record, never the edge the segment reads.
        const opened = lensPieces(lensRegions(placement), [{ from: 5100, to: 5100 }, { from: 5150, to: 5420 }]).filter((p) => p.segment === undefined);
        expect(LENS_REVEAL_ROWS).toBe(200);
        expect(opened.map((p) => [p.from, p.count])).toEqual([[5099, 101], [5200, 200], [5400, 200]]);
        // A stretch not placed yet takes no read: its runs wait for it.
        expect(lensPieces(lensRegions({ ...placement, complete: false }), [{ from: 5100, to: 5100 }]).filter((p) => p.segment === undefined)).toEqual([]);
        // A segment beside another reads no edge on that side.
        const pair: LensPlacement = { records: 30, segments: [{ offset: 0, count: 10, matches: 1 }, { offset: 10, count: 20, matches: 1 }], matches: 2, placed: 2, complete: true };
        expect(lensPieces(lensRegions(pair), []).map((p) => [p.from, p.count])).toEqual([[0, 10], [10, 20]]);
    });

    test("a view wants the segments it meets, in the record's order, then the nearest beyond them, after and then before — a segment's pages together", () => {
        const pieces = [
            { key: "a1", from: 0, count: 2048, segment: 0 }, { key: "a2", from: 2048, count: 2048, segment: 0 },
            { key: "r", from: 5000, count: 200, segment: undefined },
            { key: "b", from: 6000, count: 1000, segment: 6000 },
            { key: "c", from: 8000, count: 1000, segment: 8000 },
        ];
        const keys = (groups: LensPiece[][]) => groups.map((g) => g.map((p) => p.key).join("+"));
        expect(keys(lensDemand(pieces, 100, 200, 1))).toEqual(["a1+a2", "r"]);
        expect(keys(lensDemand(pieces, 6500, 6600, 1))).toEqual(["b", "c", "r"]);
        expect(keys(lensDemand(pieces, 6500, 6600, 2))).toEqual(["b", "c", "r", "a1+a2"]);
        expect(keys(lensDemand(pieces, 3000, 8500, 0))).toEqual(["a1+a2", "r", "b", "c"]);
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
    test("each match at its row number, a gap over each run of the rest, across the segment's edges; keyed by what bounds each gap", () => {
        const layout = layoutLens(factsOf(ONE_SEGMENT(2), SEGMENT_READ([45, 50])), 0, [], G, WORDS);
        expect(shape(layout)).toEqual(["gap 0-44", "45*", "gap 46-49", "50*", "gap 51-99"]);
        expect(layout.items.flatMap((it) => (it.kind === "gap" ? [[it.gap.key, it.gap.hidden, it.gap.first, it.gap.last]] : []))).toEqual([
            ["s_h45", 45, true, false], ["h45_h50", 4, false, false], ["h50_e", 49, false, true],
        ]);
        expect([layout.hits, layout.shown]).toEqual([2, 2]);
    });

    test("context shows the rows either side of each match — into the empty stretch beside the segment, whose edge rows are read with it", () => {
        const one = layoutLens(factsOf(ONE_SEGMENT(2), SEGMENT_READ([45, 50])), 1, [], G, WORDS);
        expect(shape(one)).toEqual(["gap 0-43", "44", "45*", "46", "gap 47-48", "49", "50*", "51", "gap 52-99"]);
        expect([one.hits, one.shown]).toEqual([2, 6]);
        // A match on the segment's last row: its context runs on into the next stretch.
        const edge = layoutLens(factsOf(ONE_SEGMENT(2), SEGMENT_READ([45, 59])), 3, [], G, WORDS);
        expect(shape(edge)).toEqual([
            "gap 0-41", "42", "43", "44", "45*", "46", "47", "48", "gap 49-55", "56", "57", "58", "59*", "60", "61", "62", "gap 63-99",
        ]);
        // The gap's key holds as rows open inside it: still bounded by the same two matches.
        const opened = layoutLens(factsOf(ONE_SEGMENT(2), SEGMENT_READ([45, 59])), 3, [{ from: 49, to: 49 }], G, WORDS);
        expect(opened.items.flatMap((it) => (it.kind === "gap" ? [it.gap.key] : []))).toEqual(["s_h45", "h45_h59", "h59_e"]);
    });

    test("a segment not read yet is one band where it will be drawn, sized by its matches; a read that failed is a failed band", () => {
        const unread = layoutLens(factsOf(ONE_SEGMENT(2), [], { 40: { kind: "unread" } }), 0, [], G, WORDS);
        expect(shape(unread)).toEqual(["gap 0-39", "band 40-59", "gap 60-99"]);
        // Its two matches, and a band each side of each: 2 × 30 + 3 × 22.
        expect(unread.items[1]).toEqual({ kind: "pending", band: { at: "reading", from: 40, to: 59, px: 126 } });
        expect(unread.items.flatMap((it) => (it.kind === "gap" ? [it.gap.key] : []))).toEqual(["s_u40", "u40_e"]);
        const failed = layoutLens(factsOf(ONE_SEGMENT(2), [], { 40: { kind: "failed", error: "gateway timeout" } }), 0, [], G, WORDS);
        expect(failed.items[1]).toEqual({ kind: "failed", failure: { w: 40, from: 40, to: 59, px: 126, error: "gateway timeout" } });
        expect([failed.hits, failed.shown]).toEqual([0, 0]);
    });

    test("a segment whose rows hold other matches than e3 placed there is drawn as a failed band that says the record changed — never rows that would show a match the index does not hold", () => {
        const layout = layoutLens(factsOf(ONE_SEGMENT(2), SEGMENT_READ([45])), 0, [], G, WORDS);
        expect(shape(layout)).toEqual(["gap 0-39", "failed 40-59", "gap 60-99"]);
        expect(layout.items[1]).toMatchObject({ kind: "failed", failure: { w: 40, error: WORDS.changed } });
        // While the placement goes on, its segments' counts are not the whole of it: nothing is checked.
        expect(shape(layoutLens(factsOf(ONE_SEGMENT(2, false), SEGMENT_READ([45])), 0, [], G, WORDS))).toEqual(["band 0-39", "gap 40-44", "45*", "gap 46-59", "band 60-99"]);
    });

    test("a stretch not placed yet is one band sized by the narrowing's density there", () => {
        // 10 matches, 2 placed in the segment: 8 over the 80 rows not placed — a tenth of each stretch's rows.
        const layout = layoutLens(factsOf(ONE_SEGMENT(2, false), SEGMENT_READ([45, 50])), 0, [], G, WORDS);
        expect(shape(layout)).toEqual(["band 0-39", "gap 40-44", "45*", "gap 46-49", "50*", "gap 51-59", "band 60-99"]);
        // 4 matches over 40 rows: 4 × 30 + 5 × 22.
        expect(layout.items[0]).toEqual({ kind: "pending", band: { at: "reading", from: 0, to: 39, px: 230 } });
        expect(layout.items.flatMap((it) => (it.kind === "gap" ? [[it.gap.key, it.gap.first, it.gap.last]] : []))).toEqual([
            ["u0_h45", false, false], ["h45_h50", false, false], ["h50_u60", false, false],
        ]);
    });

    test("the runs the planner opened in an empty stretch: their rows read are drawn, the rest a band where they will be, a failed read a failed band; two gaps between the same two anchors count on", () => {
        const opened = [{ from: 10, to: 10 }, { from: 80, to: 82 }];
        const facts = factsOf(ONE_SEGMENT(1), [{ from: 0, to: 36 }, ...SEGMENT_READ([45])]);
        const layout = layoutLens(facts, 0, opened, G, WORDS);
        expect(shape(layout)).toEqual(["gap 0-9", "10", "gap 11-44", "45*", "gap 46-79", "band 80-82", "gap 83-99"]);
        expect(layout.items[5]).toEqual({ kind: "pending", band: { at: "reading", from: 80, to: 82, px: 90 } });
        expect(layout.items.flatMap((it) => (it.kind === "gap" ? [it.gap.key] : []))).toEqual(["s_h45", "s_h45#1", "h45_u80", "u80_e"]);
        expect([layout.hits, layout.shown]).toEqual([1, 2]);
        const failed = layoutLens({ ...facts, failed: [{ from: 63, to: 99, error: "gone" }] }, 0, opened, G, WORDS);
        expect(shape(failed)).toEqual(["gap 0-9", "10", "gap 11-44", "45*", "gap 46-79", "failed 80-82", "gap 83-99"]);
        expect(failed.items[5]).toMatchObject({ kind: "failed", failure: { w: 80, from: 80, to: 82, error: "gone" } });
    });

    test("its work is what it reads and shows, never the record's size: a million rows opened and not read are one band", () => {
        const placement: LensPlacement = { records: 1_000_000, segments: [{ offset: 0, count: 1000, matches: 1 }], matches: 1, placed: 1, complete: true };
        const facts = factsOf(placement, [{ from: 0, to: 1002, hits: [0] }]);
        // What it asks of the rows it knows, counted: a few looks at each of the segment's thousand, none past them.
        let looks = 0;
        const counted: LensFacts = { ...facts, rowAt: (p) => { looks++; return facts.rowAt(p); } };
        const layout = layoutLens(counted, 0, [{ from: 2000, to: 999_999 }], G, WORDS);
        expect(looks).toBeLessThan(5 * 1003);
        expect(shape(layout)).toEqual(["0*", "gap 1-1999", "band 2000-999999"]);
    });
});

describe("the layout over the rows the local layer leaves", () => {
    test("a drafted row in its place, a removed one gone with its gaps kept, a new one after the row before it", () => {
        const layout = layoutLens(factsOf(ONE_SEGMENT(2), SEGMENT_READ([45, 50])), 0, [], G, WORDS);
        const r45 = layout.items[1]!.kind === "row" ? layout.items[1]!.row : row("r45");
        const drafted = { ...r45 };
        const added = row("new");
        const out = lensBodyItems(layout, [drafted, added], [45, 46]);
        expect(out.map((it) => (it.kind === "row" ? `${it.row.id}@${it.position}${it.hit ? "*" : ""}` : it.kind === "gap" ? `gap ${it.gap.from}-${it.gap.to}` : it.kind)))
            .toEqual(["gap 0-44", "r45@45*", "new@46", "gap 46-49", "gap 51-99"]);
        expect(out[1]).toMatchObject({ kind: "row", row: drafted });
        // The bands and failed bands come through as they were laid out.
        const unread = layoutLens(factsOf(ONE_SEGMENT(2), [], { 40: { kind: "unread" } }), 0, [], G, WORDS);
        expect(lensBodyItems(unread, [], []).map((it) => it.kind)).toEqual(["gap", "band", "gap"]);
    });
});
