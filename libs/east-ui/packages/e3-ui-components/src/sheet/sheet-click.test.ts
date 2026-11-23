/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * A click on a row (east-workspace#1727), as the state machine decides it: a
 * press that does nothing but place the ring is held until its release, which
 * reports a click (`emit.rowClick`) when it lands inside what it pressed — its
 * row, and its column or none for the row's number. A press that steps a cell,
 * ⇧, a double click's second press, a drag of the range into another cell, a
 * pick of the row's box, a release elsewhere and every key report none.
 */

import { describe, test, expect } from "vitest";
import { initialSheetState, type SheetEffect, type SheetEvent } from "./sheet-state.js";
import { cell, ctxOf, key, run } from "./sheet-state.test-utils.js";

/** The clicks a run of events reported. */
const clicks = (effects: SheetEffect[]) => effects.filter((e) => e.t === "emit.rowClick");

/** A click of a row's cell, or of its number (`c` `null`), as its effect says it. */
const clicked = (r: number, c: number | null): SheetEffect => ({ t: "emit.rowClick", r, c });

/** A press on a cell — by default the button's first press, which may be a click. */
const down = (r: number, c: number, over: { shift?: boolean; click?: boolean } = {}): SheetEvent =>
    ({ t: "cell.down", r, c, shift: over.shift ?? false, click: over.click ?? true });

/** A press on a row's number — by default one that may be a click. */
const pick = (r: number, over: { shift?: boolean; click?: boolean } = {}): SheetEvent =>
    ({ t: "row.pick", r, shift: over.shift ?? false, click: over.click ?? true });

/** The press's release: inside what it pressed, or elsewhere. */
const up = (inside = true): SheetEvent => ({ t: "cell.up", inside });

describe("a click on a row (east-workspace#1727)", () => {
    test("a press and its release inside the cell it pressed report one click, its row and its column, and the press is let go (RC1)", () => {
        const t = run(initialSheetState(), [down(1, 0), up()]);
        expect(clicks(t.effects)).toEqual([clicked(1, 0)]);
        expect(t.state.press).toBeNull();
        // A release with no press in hand reports nothing more.
        expect(clicks(run(t.state, [up()]).effects)).toEqual([]);
    });

    test("a press on the cell the ring is on already clicks again (RC2)", () => {
        const t = run(initialSheetState({ r: 1, c: 0 }), [down(1, 0), up(), down(1, 0), up()]);
        expect(clicks(t.effects)).toEqual([clicked(1, 0), clicked(1, 0)]);
    });

    test("a press on the row's number clicks its row with no column, again as its rows are un-picked (RC3); a band's, its band (RC4)", () => {
        expect(clicks(run(initialSheetState(), [pick(2), up(), pick(2), up()]).effects)).toEqual([clicked(2, null), clicked(2, null)]);
        const grouped = ctxOf({
            rowKindAt: (r) => (r === 0 ? "group" : "row"),
            groupAt: (r) => (r === 0 ? { id: "P0", folded: false, lines: { r0: 1, r1: 2 } } : undefined),
        });
        expect(clicks(run(initialSheetState(), [pick(0), up()], grouped).effects)).toEqual([clicked(0, null)]);
    });

    test("a release elsewhere than what was pressed clicks nothing", () => {
        expect(clicks(run(initialSheetState(), [down(1, 0), up(false)]).effects)).toEqual([]);
        expect(clicks(run(initialSheetState(), [pick(1), up(false)]).effects)).toEqual([]);
    });

    test("a double click clicks once: its second press is none (RC5)", () => {
        const t = run(initialSheetState(), [down(1, 1), up(), down(1, 1, { click: false }), up(), { t: "cell.dbl", r: 1, c: 1 }]);
        expect(clicks(t.effects)).toEqual([clicked(1, 1)]);
    });

    test("⇧ clicks nothing, on a cell or on a row's number, nor does a drag of the range into another cell — one that has not left its cell does (RC6)", () => {
        expect(clicks(run(initialSheetState(), [down(1, 0, { shift: true }), up()]).effects)).toEqual([]);
        expect(clicks(run(initialSheetState(), [pick(1, { shift: true }), up()]).effects)).toEqual([]);
        expect(clicks(run(initialSheetState(), [down(1, 0), { t: "cell.enter", r: 2, c: 0, dragging: true }, up()]).effects)).toEqual([]);
        expect(clicks(run(initialSheetState(), [down(1, 0), { t: "cell.enter", r: 1, c: 0, dragging: true }, up()]).effects)).toEqual([clicked(1, 0)]);
    });

    test("a pick of a row's box is no press: it ticks the row, and clicks nothing", () => {
        expect(clicks(run(initialSheetState(), [pick(1, { click: false }), up()]).effects)).toEqual([]);
    });

    test("a press that steps a cell in place clicks nothing; one on a cell the step does not reach clicks, placing the ring (RC8, RC15)", () => {
        const steps = { stepAt: (_r: number, c: number) => (c === 0 ? cell("Boolean", true) : undefined), stepsAt: (_r: number, c: number) => c === 0 };
        expect(clicks(run(initialSheetState(), [down(1, 0), up()], ctxOf(steps)).effects)).toEqual([]);
        expect(clicks(run(initialSheetState(), [down(1, 0), up()], ctxOf({ ...steps, editableAt: () => false })).effects)).toEqual([clicked(1, 0)]);
    });

    test("a press on a cell that edits out of place opens it where the host edits it, and clicks its row (RC13)", () => {
        const t = run(initialSheetState(), [down(1, 0), up()], ctxOf({ opensAt: (_r, c) => c === 0 }));
        expect(t.effects).toContainEqual({ t: "open", r: 1, c: 0 });
        expect(clicks(t.effects)).toEqual([clicked(1, 0)]);
    });

    test("no key clicks a row — a move, ⏎, Space, F2 or esc (RC11)", () => {
        const t = run(initialSheetState(), [key("ArrowDown"), key("Enter"), key("Escape"), key(" "), key("F2"), key("Escape"), key("Tab")]);
        expect(clicks(t.effects)).toEqual([]);
    });

    test("the press in hand follows its row as the rows move under it, and is let go of with a row that leaves", () => {
        expect(clicks(run(initialSheetState(), [down(1, 0), { t: "rows.changed", moved: (r) => r + 2 }, up()]).effects)).toEqual([clicked(3, 0)]);
        expect(clicks(run(initialSheetState(), [down(1, 0), { t: "rows.changed", moved: () => null }, up()]).effects)).toEqual([]);
    });

    test("the press in hand follows its column as the columns move, is let go of with a column no longer drawn, and on a row's number stands", () => {
        expect(clicks(run(initialSheetState(), [down(1, 0), { t: "columns.changed", moved: (c) => c + 1 }, up()]).effects)).toEqual([clicked(1, 1)]);
        expect(clicks(run(initialSheetState(), [down(1, 0), { t: "columns.changed", moved: () => null }, up()]).effects)).toEqual([]);
        expect(clicks(run(initialSheetState(), [pick(1), { t: "columns.changed", moved: () => null }, up()]).effects)).toEqual([clicked(1, null)]);
    });
});
