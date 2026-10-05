/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * What a drop does where it rests (#1187, `Sheet Builder Spec.md` §10; SB39,
 * SB40, SB44, SB45, SB61), decided from the rows as they stand — the body the
 * sheet builds, its row space and the seams' own anchors — before anything is
 * drawn or written: where a template inserts, where a group or a loose row
 * snaps to the seam between entries, which cells a card sets and where it is
 * refused, where a row, a line or a group moves to and when it stays, and
 * what ⏎ on a card does. The DOM test (`builder/sheet-builder-dnd`) carries
 * them through the drag layer; here every rule is held on its own, the
 * refusals a builder never offers among them.
 */

import { describe, expect, test } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { TITLE_KEY, buildBody, isRowSpace, type SheetBodyItem, type SheetColumnMeta } from "./model.js";
import { anchorAt } from "./insertion-gesture.js";
import { dropCaption, dropName, planBelow, planDrop, type SheetDropContext, type SheetDropPlan, type SheetDropRow, type SheetDropSource } from "./drop.js";
import { SHEET_WORDS } from "./words.js";
import type { SheetCellValue, SheetLineValue, SheetNounValue, SheetRowValue } from "./values.js";

// ── The rows ──────────────────────────────────────────────────────────────

const text = (value: string): SheetCellValue => variant("String", value);
const line = (key: string, task: string): SheetLineValue => ({ key, cells: new Map([["task", text(task)]]), subRows: [] });
const group = (id: string, title: string, ...lines: SheetLineValue[]): SheetRowValue => ({
    id, owned: false, cells: new Map([[TITLE_KEY, text(title)]]), lines, band: some({ sub: "", folded: false }), subRows: [],
});
const row = (id: string, task: string): SheetRowValue => ({ id, owned: false, cells: new Map([["task", text(task)]]), lines: [], band: none, subRows: [] });

/** A flat sheet: three rows, then its blank tail — row space 0–2, the tail at 3. */
const FLAT = [row("a", "Cut"), row("b", "Band"), row("c", "Route")];
/**
 * The day's batches — row space: g1's band 0, its lines 1–3, its blank line
 * 4; g2's band 5, its lines 6–7, its blank line 8; g3's band 9, its line 10,
 * its blank line 11.
 */
const DAY = [
    group("g1", "Doors, oak", line("0", "Cut doors"), line("1", "Band doors"), line("2", "Spray doors")),
    group("g2", "Carcasses, birch", line("0", "Cut carcasses"), line("1", "Drill carcasses")),
    group("g3", "Shelves, ash", line("0", "Cut shelves")),
];
/** Loose rows between the groups (#846) — row space: l1 0; g1's band 1, its lines 2–3, its blank line 4; l2 5. */
const LOOSE = [row("l1", "Sweep"), group("g1", "Doors, oak", line("0", "Cut doors"), line("1", "Band doors")), row("l2", "Pack")];

/** The columns a card's cells land under — on a band, its band cells. */
type ColumnFacts = Pick<SheetColumnMeta, "editable" | "kind" | "header">;
const COLUMNS = new Map<string, ColumnFacts>([
    ["task", { editable: true, kind: "text", header: "Step" }],
    ["machine", { editable: false, kind: "text", header: "Machine" }],
    ["signed", { editable: true, kind: "stamped", header: "Signed" }],
]);
const BAND_CELLS = new Map<string, ColumnFacts>([
    [TITLE_KEY, { editable: true, kind: "text", header: "Batch" }],
    ["status", { editable: true, kind: "enum", header: "Status" }],
]);

interface Options {
    grouped?: boolean;
    loose?: boolean;
    keyed?: boolean;
    writable?: boolean;
    folded?: ReadonlySet<string>;
    can?: Partial<SheetDropContext["can"]>;
}

/** The sheet as it stands, as the sheet's core hands it to a drop: its body, its row space, and the seams' own anchors. */
function contextOf(rows: SheetRowValue[], o: Options = {}): SheetDropContext {
    const grouped = o.grouped ?? false;
    const body = buildBody({
        rows, rowsOffset: 0, blanks: grouped ? 1 : 2, exhausted: true, total: undefined, head: undefined, tail: undefined,
        grouped: grouped ? { foldedOf: (g) => o.folded?.has(g.id) === true } : undefined,
    });
    const space = body.filter(isRowSpace);
    const find = (hit: (it: SheetBodyItem) => boolean): number | undefined => { const r = space.findIndex(hit); return r < 0 ? undefined : r; };
    return {
        rows,
        rowAt: (r) => space[r],
        rowOf: (id) => find((it) => (it.kind === "real" || it.kind === "group") && it.row.id === id),
        blankLineRowOf: (id) => find((it) => it.kind === "blank" && it.group?.row.id === id),
        tailRow: find((it) => it.kind === "blank" && it.group === undefined),
        rowCount: space.length,
        grouped,
        loose: o.loose ?? false,
        keyed: o.keyed ?? false,
        writable: o.writable ?? true,
        can: { insertRows: true, insertGroups: grouped, moveRows: grouped ? "between" : "within", moveGroups: grouped && o.keyed !== true, ...o.can },
        columnAt: (band, key) => (band ? BAND_CELLS : COLUMNS).get(key),
        anchorFor: (r, side) => anchorAt(space[r], side),
    };
}

// ── What is dragged, and where it rests ───────────────────────────────────

const template = (kind: "row" | "group"): SheetDropSource => ({ kind: "template", template: { name: kind === "row" ? "Sand" : "Finishing batch", kind, seeds: {} } });
const card = (lands: "row" | "group", sets: ReadonlyArray<readonly [string, string]>): SheetDropSource => ({
    kind: "card", lands, card: { label: "Card", sets: new Map(sets.map(([key, value]) => [key, text(value)])) },
});
const move = (from: SheetDropRow): SheetDropSource => ({ kind: "move", row: from });
const flat = (id: string): SheetDropRow => variant("row", id);
const lineOf = (g: string, key: string): SheetDropRow => variant("line", { group: g, key });
const band = (g: string): SheetDropRow => variant("band", g);
const groupEnd = (g: string): SheetDropRow => variant("groupEnd", g);
const END: SheetDropRow = variant("end", null);

const NOUN: SheetNounValue = { singular: "batch", plural: "batches" };
/** What the ghost says of a plan. */
const says = (plan: SheetDropPlan, ctx: SheetDropContext) => dropCaption(plan, ctx, SHEET_WORDS, NOUN);

// ── Templates (SB39, SB40) ────────────────────────────────────────────────

describe("a template inserts where the seam's own chips would (SB39, SB40)", () => {
    test("on a flat sheet: beside the row by the pointer's half, at the end on the blank tail — on a keyed source where its key sorts", () => {
        const ctx = contextOf(FLAT);
        const after = planDrop(template("row"), flat("b"), "after", ctx);
        expect(after).toEqual({
            kind: "insert", template: { name: "Sand", kind: "row", seeds: {} }, request: { kind: "row", anchor: { entry: "b", side: "after" } },
            place: { at: "seam", r: 1, side: "after" }, mark: { r: 1, edge: "bottom" },
        });
        expect(says(after, ctx)).toBe("after row 2");
        expect(dropName(after, 1, ctx, SHEET_WORDS, NOUN)).toBe("the gap after row 2");
        const tail = planDrop(template("row"), END, "before", ctx);
        expect(tail).toMatchObject({ kind: "insert", request: { anchor: { entry: undefined } }, place: { at: "sheetEnd" }, mark: { r: 3, edge: "top" } });
        expect(says(tail, ctx)).toBe("at the end");
        const keyed = contextOf(FLAT, { keyed: true });
        const sorted = planDrop(template("row"), flat("b"), "before", keyed);
        expect(sorted).toMatchObject({ kind: "insert", place: { at: "keyOrder", group: false }, mark: undefined });
        expect(says(sorted, keyed)).toBe("a new row · in key order");
    });

    test("on a grouped sheet a row lands as a line: beside a line, at a band's group's start whatever the half, at a group's end on its blank line", () => {
        const ctx = contextOf(DAY, { grouped: true });
        const beside = planDrop(template("row"), lineOf("g1", "1"), "before", ctx);
        expect(beside).toMatchObject({ request: { kind: "row", anchor: { entry: "g1", child: "1", side: "before" } }, place: { at: "seam", r: 2, side: "before" }, mark: { r: 2, edge: "top" } });
        expect(says(beside, ctx)).toBe("before line 2 of Doors, oak");
        for (const half of ["before", "after"]) {
            const start = planDrop(template("row"), band("g2"), half, ctx);
            expect(start).toMatchObject({ request: { anchor: { entry: "g2", side: "after" } }, place: { at: "groupStart", r: 5 }, mark: { r: 5, edge: "bottom" } });
            expect(says(start, ctx)).toBe("at the start of batch 2");
        }
        const end = planDrop(template("row"), groupEnd("g3"), "after", ctx);
        expect(end).toMatchObject({ request: { anchor: { entry: "g3", tail: true } }, place: { at: "groupEnd", r: 11 }, mark: { r: 11, edge: "top" } });
        expect(says(end, ctx)).toBe("at the end of batch 3");
    });

    test("beside loose rows a band's top half is a loose row before its group, and a loose row's seam a loose row — on a keyed source, in key order", () => {
        const ctx = contextOf(LOOSE, { grouped: true, loose: true });
        expect(planDrop(template("row"), band("g1"), "before", ctx)).toMatchObject({ request: { anchor: { entry: "g1", side: "before" } }, place: { at: "seam", r: 1, side: "before" } });
        expect(planDrop(template("row"), band("g1"), "after", ctx)).toMatchObject({ place: { at: "groupStart", r: 1 } });
        expect(planDrop(template("row"), flat("l2"), "after", ctx)).toMatchObject({ request: { anchor: { entry: "l2", side: "after" } }, place: { at: "seam", r: 5 } });
        // A line is no entry: it lands where it is dropped, keyed or not.
        const keyed = contextOf(LOOSE, { grouped: true, loose: true, keyed: true });
        expect(planDrop(template("row"), flat("l2"), "after", keyed)).toMatchObject({ place: { at: "keyOrder", group: false } });
        expect(planDrop(template("row"), lineOf("g1", "0"), "after", keyed)).toMatchObject({ place: { at: "seam", r: 2, side: "after" } });
    });

    test("a group template snaps to the nearer seam between the groups: a band's top half before it; a line, its group's nearer end; the blank line after it", () => {
        const ctx = contextOf(DAY, { grouped: true });
        const before = planDrop(template("group"), band("g2"), "before", ctx);
        expect(before).toMatchObject({ request: { kind: "group", anchor: { entry: "g2", side: "before" } }, place: { at: "seam", r: 5, side: "before" }, mark: { r: 5, edge: "top" } });
        expect(says(before, ctx)).toBe("before batch 2");
        // An open group's band, either half: before it — its lines lie between the band and the seam below.
        expect(planDrop(template("group"), band("g2"), "after", ctx)).toMatchObject({ request: { anchor: { side: "before" } } });
        // The first line's half of g1, and its last's: the seam above the band, and the one under the blank line.
        expect(planDrop(template("group"), lineOf("g1", "0"), "before", ctx)).toMatchObject({ request: { anchor: { entry: "g1", side: "before" } }, mark: { r: 0, edge: "top" } });
        const after = planDrop(template("group"), lineOf("g1", "2"), "after", ctx);
        expect(after).toMatchObject({ request: { anchor: { entry: "g1", side: "after" } }, place: { at: "seam", r: 0, side: "after" }, mark: { r: 5, edge: "top" } });
        expect(says(after, ctx)).toBe("after batch 1");
        expect(planDrop(template("group"), groupEnd("g3"), "before", ctx)).toMatchObject({ request: { anchor: { entry: "g3", side: "after" } }, mark: { r: 11, edge: "bottom" } });
        // A folded group's band shows no lines: its bottom half is the seam below it.
        const folded = contextOf(DAY, { grouped: true, folded: new Set(["g2"]) });
        expect(planDrop(template("group"), band("g2"), "after", folded)).toMatchObject({ request: { anchor: { entry: "g2", side: "after" } }, mark: { r: 6, edge: "top" } });
        const keyed = contextOf(DAY, { grouped: true, keyed: true });
        const sorted = planDrop(template("group"), band("g2"), "before", keyed);
        expect(sorted).toMatchObject({ kind: "insert", place: { at: "keyOrder", group: true }, mark: undefined });
        expect(says(sorted, keyed)).toBe("a new batch · in key order");
    });

    test("refused, the ghost says why: no new rows or groups here, a flat sheet takes no group, a read-only sheet nothing — a row gone, nothing at all", () => {
        const noRows = contextOf(DAY, { grouped: true, can: { insertRows: false } });
        const lines = planDrop(template("row"), lineOf("g1", "0"), "after", noRows);
        expect(lines).toEqual({ kind: "refused", why: { why: "insert", line: true } });
        expect(says(lines, noRows)).toBe("No new lines here");
        expect(says(planDrop(template("row"), flat("a"), "after", contextOf(FLAT, { can: { insertRows: false } })), contextOf(FLAT))).toBe("No new rows here");
        const noGroups = contextOf(DAY, { grouped: true, can: { insertGroups: false } });
        expect(says(planDrop(template("group"), band("g1"), "before", noGroups), noGroups)).toBe("No new batches here");
        expect(planDrop(template("group"), flat("a"), "before", contextOf(FLAT))).toEqual({ kind: "refused", why: { why: "insertGroup" } });
        const readOnly = contextOf(FLAT, { writable: false });
        expect(says(planDrop(template("row"), flat("a"), "after", readOnly), readOnly)).toBe("The sheet is read only");
        const gone = planDrop(template("row"), flat("zz"), "after", contextOf(FLAT));
        expect(gone).toEqual({ kind: "refused", why: { why: "gone" } });
        expect(says(gone, contextOf(FLAT))).toBeUndefined();
    });
});

// ── An author's cards (SB61) ──────────────────────────────────────────────

describe("an author's card sets its cells on the row it lands on (SB61)", () => {
    test("a row's card on a row or a line; a group's on a band — anywhere else refused", () => {
        const ctx = contextOf(DAY, { grouped: true });
        const onLine = planDrop(card("row", [["task", "Sand"]]), lineOf("g1", "0"), "", ctx);
        expect(onLine).toMatchObject({ kind: "set", r: 1 });
        expect(says(onLine, ctx)).toBe("→ line 1 of Doors, oak");
        expect(dropName(onLine, 1, ctx, SHEET_WORDS, NOUN)).toBe("line 1 of Doors, oak");
        expect(says(planDrop(card("row", [["task", "Sand"]]), band("g1"), "", ctx), ctx)).toBe("Drop onto a line");
        expect(says(planDrop(card("row", [["task", "Sand"]]), groupEnd("g1"), "", ctx), ctx)).toBe("Drop onto a line");
        const onBand = planDrop(card("group", [["status", "RELEASED"]]), band("g2"), "", ctx);
        expect(onBand).toMatchObject({ kind: "set", r: 5 });
        expect(says(onBand, ctx)).toBe("→ batch 2");
        expect(says(planDrop(card("group", [["status", "RELEASED"]]), lineOf("g2", "0"), "", ctx), ctx)).toBe("Drop onto a band");
        const flatCtx = contextOf(FLAT);
        expect(planDrop(card("row", [["task", "Sand"]]), flat("c"), "", flatCtx)).toMatchObject({ kind: "set", r: 2 });
        expect(says(planDrop(card("row", [["task", "Sand"]]), END, "", flatCtx), flatCtx)).toBe("Drop onto a row");
    });

    test("a cell the sheet does not write refuses the card — a read-only column, a stamped one, one the sheet has not — though a builder's card never names one", () => {
        const ctx = contextOf(FLAT);
        const locked = planDrop(card("row", [["task", "Sand"], ["machine", "CNC router"]]), flat("a"), "", ctx);
        expect(locked).toEqual({ kind: "refused", why: { why: "column", header: "Machine" } });
        expect(says(locked, ctx)).toBe("Machine is read only here");
        expect(planDrop(card("row", [["signed", "QA"]]), flat("a"), "", ctx)).toEqual({ kind: "refused", why: { why: "column", header: "Signed" } });
        expect(planDrop(card("row", [["colour", "Oak"]]), flat("a"), "", ctx)).toEqual({ kind: "refused", why: { why: "column", header: "colour" } });
        // On a band, the band's own cells.
        const grouped = contextOf(DAY, { grouped: true });
        expect(planDrop(card("group", [["task", "Sand"]]), band("g1"), "", grouped)).toEqual({ kind: "refused", why: { why: "column", header: "task" } });
    });
});

// ── Moves (SB44) ──────────────────────────────────────────────────────────

describe("a grip moves its row, its line or its group to another seam (SB44)", () => {
    test("a flat row: beside another by the pointer's half, or the end — and where it already stands, it stays", () => {
        const ctx = contextOf(FLAT);
        expect(planDrop(move(flat("b")), flat("c"), "after", ctx)).toEqual({
            kind: "moveEntry", id: "b", to: { side: "after", anchor: "c" }, place: { at: "seam", r: 2, side: "after" }, mark: { r: 2, edge: "bottom" },
        });
        const first = planDrop(move(flat("c")), flat("a"), "before", ctx);
        expect(first).toMatchObject({ kind: "moveEntry", to: { side: "before", anchor: "a" } });
        expect(says(first, ctx)).toBe("before row 1");
        // Its own seams: before or after itself, after the row above it, before the row below it.
        for (const [onto, side] of [["b", "before"], ["b", "after"], ["a", "after"], ["c", "before"]] as const) {
            expect(planDrop(move(flat("b")), flat(onto), side, ctx).kind, `${onto} ${side}`).toBe("stay");
        }
        expect(planDrop(move(flat("a")), END, "before", ctx)).toMatchObject({ kind: "moveEntry", to: "end", place: { at: "sheetEnd" }, mark: { r: 3, edge: "top" } });
        expect(planDrop(move(flat("c")), END, "before", ctx).kind).toBe("stay");
    });

    test("a row keeps its place where the sheet's edits move none, or its source keeps key order", () => {
        const none_ = contextOf(FLAT, { can: { moveRows: "none" } });
        expect(says(planDrop(move(flat("a")), flat("c"), "after", none_), none_)).toBe("Rows keep their place here");
        const keyed = contextOf(FLAT, { keyed: true });
        const sorted = planDrop(move(flat("a")), flat("c"), "after", keyed);
        expect(sorted).toEqual({ kind: "refused", why: { why: "keyOrder", group: false } });
        expect(says(sorted, keyed)).toBe("Key order places the rows");
    });

    test("a line: beside another, at a group's start on its band, at its end on its blank line — into another group, unless the edits keep it in its own; never out of the groups", () => {
        const ctx = contextOf(DAY, { grouped: true });
        // Its own slot, or the one after it: it stays.
        expect(planDrop(move(lineOf("g1", "0")), lineOf("g1", "1"), "before", ctx).kind).toBe("stay");
        expect(planDrop(move(lineOf("g1", "0")), lineOf("g1", "0"), "after", ctx).kind).toBe("stay");
        expect(planDrop(move(lineOf("g1", "0")), lineOf("g1", "2"), "after", ctx)).toEqual({
            kind: "moveLine", from: { group: "g1", key: "0" }, to: { group: "g1", index: 3 }, place: { at: "seam", r: 3, side: "after" }, mark: { r: 3, edge: "bottom" },
        });
        expect(planDrop(move(lineOf("g1", "2")), band("g2"), "before", ctx)).toMatchObject({ kind: "moveLine", to: { group: "g2", index: 0 }, place: { at: "groupStart", r: 5 } });
        expect(planDrop(move(lineOf("g1", "2")), groupEnd("g3"), "after", ctx)).toMatchObject({ kind: "moveLine", to: { group: "g3", index: 1 }, place: { at: "groupEnd", r: 11 } });
        const within = contextOf(DAY, { grouped: true, can: { moveRows: "within" } });
        const out = planDrop(move(lineOf("g1", "0")), lineOf("g2", "0"), "after", within);
        expect(out).toEqual({ kind: "refused", why: { why: "within", r: 0 } });
        expect(says(out, within)).toBe("Lines move only within batch 1");
        expect(planDrop(move(lineOf("g1", "0")), lineOf("g1", "2"), "after", within).kind).toBe("moveLine");
        const none_ = contextOf(DAY, { grouped: true, can: { moveRows: "none" } });
        expect(says(planDrop(move(lineOf("g1", "0")), lineOf("g1", "2"), "after", none_), none_)).toBe("Lines keep their place here");
        const loose = contextOf(LOOSE, { grouped: true, loose: true });
        expect(says(planDrop(move(lineOf("g1", "0")), flat("l2"), "after", loose), loose)).toBe("A line stays in a batch");
    });

    test("a group snaps to the nearer seam between the groups, and stays where it is already; it keeps its place where the edits or key order say", () => {
        const ctx = contextOf(DAY, { grouped: true });
        const first = planDrop(move(band("g3")), band("g1"), "before", ctx);
        expect(first).toEqual({ kind: "moveEntry", id: "g3", to: { side: "before", anchor: "g1" }, place: { at: "seam", r: 0, side: "before" }, mark: { r: 0, edge: "top" } });
        expect(says(first, ctx)).toBe("before batch 1");
        // g1's last line's lower half: after g1 — where g2 already stands.
        expect(planDrop(move(band("g2")), lineOf("g1", "2"), "after", ctx).kind).toBe("stay");
        expect(planDrop(move(band("g1")), lineOf("g3", "0"), "after", ctx)).toMatchObject({ kind: "moveEntry", to: { side: "after", anchor: "g3" }, mark: { r: 11, edge: "bottom" } });
        const keyed = contextOf(DAY, { grouped: true, keyed: true });
        expect(says(planDrop(move(band("g3")), band("g1"), "before", keyed), keyed)).toBe("Key order places the batches");
        const fixed = contextOf(DAY, { grouped: true, can: { moveGroups: false } });
        expect(says(planDrop(move(band("g3")), band("g1"), "before", fixed), fixed)).toBe("The batches keep their place here");
    });

    test("a loose row stays between the groups: dropped on a line, it takes its group's nearer seam", () => {
        const ctx = contextOf(LOOSE, { grouped: true, loose: true });
        expect(planDrop(move(flat("l2")), lineOf("g1", "0"), "before", ctx)).toMatchObject({ kind: "moveEntry", id: "l2", to: { side: "before", anchor: "g1" }, mark: { r: 1, edge: "top" } });
        expect(planDrop(move(flat("l1")), lineOf("g1", "1"), "after", ctx)).toMatchObject({ kind: "moveEntry", id: "l1", to: { side: "after", anchor: "g1" }, mark: { r: 5, edge: "top" } });
        expect(planDrop(move(flat("l1")), flat("l2"), "before", ctx)).toMatchObject({ kind: "moveEntry", to: { side: "before", anchor: "l2" } });
    });
});

// ── ⏎ on a card (SB45) ────────────────────────────────────────────────────

describe("⏎ on a card is a drop below the ring's row (SB45)", () => {
    test("a row template after it, a group template after its group, a card on it — refused where the drop would be", () => {
        const ctx = contextOf(DAY, { grouped: true });
        const group_ = planBelow(template("group"), lineOf("g1", "1"), ctx);
        expect(group_).toMatchObject({ kind: "insert", request: { kind: "group", anchor: { entry: "g1", side: "after" } }, place: { at: "seam", r: 0, side: "after" }, mark: { r: 5, edge: "top" } });
        expect(says(group_, ctx)).toBe("after batch 1");
        expect(planBelow(template("group"), lineOf("g1", "1"), contextOf(DAY, { grouped: true, keyed: true }))).toMatchObject({ place: { at: "keyOrder", group: true } });
        expect(planBelow(template("row"), lineOf("g1", "1"), ctx)).toMatchObject({ request: { anchor: { entry: "g1", child: "1", side: "after" } } });
        expect(planBelow(card("row", [["task", "Sand"]]), lineOf("g1", "1"), ctx)).toMatchObject({ kind: "set", r: 2 });
        expect(planBelow(card("group", [["status", "RELEASED"]]), lineOf("g1", "1"), ctx)).toEqual({ kind: "refused", why: { why: "ontoBand" } });
        // Beside loose rows the ring's loose row is an entry of its own.
        const loose = contextOf(LOOSE, { grouped: true, loose: true });
        expect(planBelow(template("group"), flat("l1"), loose)).toMatchObject({ request: { anchor: { entry: "l1", side: "after" } }, mark: { r: 0, edge: "bottom" } });
        expect(planBelow(template("group"), flat("a"), contextOf(FLAT))).toEqual({ kind: "refused", why: { why: "insertGroup" } });
        expect(planBelow(template("row"), flat("a"), contextOf(FLAT, { writable: false }))).toEqual({ kind: "refused", why: { why: "readOnly" } });
    });
});
