/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Record's trace cells (east-workspace#1728), over the machines' example on
 * e3 itself — ten machines, each with a different series: each row's series
 * drawn with east-ui's Trace, one unnamed track across its cell (T2); each step
 * saying its week, its hours and whether it was worked or forecast (T4); the
 * load on one scale for every row, last year each row over its own (T5); none
 * or an empty series the column's words (T6); read only — a clear, typing and a
 * paste pass it by, saying so, and a phone's bottom editor opens nothing (T1);
 * its copy the series' numbers (T7); and Details drawing each trace's field
 * with the same Trace, read only (T8).
 */

import { describe, expect, test } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/record/record-display";
import { settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
import { touchFrame } from "../sheet/frame.test-utils.js";
import { recordMessages as m } from "./messages.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record-display": ex }, frame: 2000 });

/** A machine's cell, by its key and the column's. */
const cell = (c: HTMLElement, id: string, key: string) =>
    c.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** The traces an element holds: each the display part around a Trace. */
const traces = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-slot="display"]')];
/** A Trace's steps, in order. */
const steps = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-level]")];
/** A Trace's step grid: the element its steps are laid out in. */
const gridOf = (el: HTMLElement) => el.querySelector<HTMLElement>('[style*="grid-template-columns"]')!;
/** Each step's level and, diverging, its side of the midpoint. */
const looks = (el: HTMLElement) => steps(el).map((s) => [s.getAttribute("data-level"), s.getAttribute("data-side")]);
/** The words a cell shows for no series. */
const absent = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-slot="absent"]')?.textContent;
/** The grid: what takes the keys. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** The status line's words. */
const status = (c: HTMLElement) => slot(c, "toolbar")!.querySelector('[data-slot="status"]')?.textContent;
/** The Record's Details for a row, in the inspector's open tab. */
const details = (c: HTMLElement) => slot(c, "end")!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [data-record-details="row"]')!;
/** Details' field, by its key. */
const field = (c: HTMLElement, key: string) => details(c).querySelector<HTMLElement>(`[data-field="${key}"]`)!;

/** A press on an element, the primary button, and what it leads to settled. */
async function press(el: Element) {
    await act(async () => { fireEvent.mouseDown(el, { button: 0 }); });
    await act(async () => { fireEvent.mouseUp(el, { button: 0 }); fireEvent.click(el); });
    await settle();
}

/** The ten machines, in the record's order. */
const MACHINES = ["M-01", "M-02", "M-03", "M-04", "M-05", "M-06", "M-07", "M-08", "M-09", "M-10"];

describe("a Record's trace cells (east-workspace#1728)", () => {
    test("each row's load is one unnamed track across its cell, at Trace's compact steps, each saying its week, its hours and whether it was worked or forecast (T2, T4)", async () => {
        const { container } = await h.mount(ex.recordTrace, { storageKey: "record-trace-cells" });
        const load = cell(container, "M-01", "load");
        expect(traces(load).map((t) => t.getAttribute("data-density"))).toEqual(["compact"]);
        // Across the cell: Trace's plot-gutter mode, both gutters none — the steps share the width between them.
        expect(gridOf(load).style.gridTemplateColumns).toBe("0px repeat(12, minmax(0, 1fr)) 0px");
        // One track, and no name before it: the header names it.
        expect(gridOf(load).children[0]!.textContent).toBe("");
        expect(steps(load).map((s) => s.title)).toEqual([
            "W41 · 32 · measured", "W42 · 34 · measured", "W43 · 36 · measured", "W44 · 38 · measured",
            "W45 · 40 · measured", "W46 · 38 · measured", "W47 · 36 · measured", "W48 · 34 · measured",
            "W49 · 30 · predicted", "W50 · 28 · predicted", "W51 · 26 · predicted", "W52 · 24 · predicted",
        ]);
        // The predicted steps, from the now-line on.
        expect(steps(load).map((s) => s.hasAttribute("data-predicted"))).toEqual([...Array<boolean>(8).fill(false), ...Array<boolean>(4).fill(true)]);
        // Every machine with a load draws one, its own; Last year's 52 weeks, for one with a year.
        expect(MACHINES.map((id) => steps(cell(container, id, "load")).length)).toEqual([12, 12, 12, 12, 12, 12, 0, 12, 12, 12]);
        expect(steps(cell(container, "M-01", "history")).length).toBe(52);
        // Hours, derived through `value` from the planner's weeks, a step a week: no axis, so each says its hours alone.
        expect(steps(cell(container, "M-02", "weeks")).map((s) => s.title)).toEqual(
            ["9", "11", "10", "12", "13.5", "15", "16.5", "18", "19.5", "21", "22.5", "24"].map((hours) => `${hours} · measured`));
    });

    test("on the load's domain the same hours take the same colour on every row, and hours past 40 the top's; last year runs each row over its own range (T5)", async () => {
        const { container } = await h.mount(ex.recordTrace, { storageKey: "record-trace-domain" });
        const at = (id: string, key: string, i: number) => looks(cell(container, id, key))[i]!;
        // 36 hours: Lathe 1's third week, Mill 1's sixth and Press 2's fourth.
        expect([at("M-01", "load", 2), at("M-03", "load", 5), at("M-06", "load", 3)]).toEqual([["3", "above"], ["3", "above"], ["3", "above"]]);
        // 20 hours, the domain's middle: Lathe 2's sixth week and every week of Press 1's flat load.
        expect([at("M-02", "load", 5), ...looks(cell(container, "M-05", "load"))]).toEqual(Array.from({ length: 13 }, () => ["0", "above"]));
        // Mill 1's 44, past the domain's top, takes the top's colour, as Lathe 1's 40 does.
        expect([at("M-03", "load", 2), at("M-01", "load", 4)]).toEqual([["3", "above"], ["3", "above"]]);
        // Mill 2's light load stands under the middle all the way: on its own range it would straddle it.
        expect(new Set(looks(cell(container, "M-04", "load")).map(([, side]) => side))).toEqual(new Set(["below"]));
        // Last year, with no domain: each row's lowest week the ramp's first step and its highest its last, whatever their hours.
        for (const id of ["M-01", "M-02", "M-03", "M-06", "M-08", "M-10"]) {
            const levels = new Set(looks(cell(container, id, "history")).map(([level]) => level));
            expect([levels.has("0"), levels.has("4")], id).toEqual([true, true]);
        }
    });

    test("none or an empty series shows the column's words in the absent look, said on hover too (T6)", async () => {
        const { container } = await h.mount(ex.recordTrace, { storageKey: "record-trace-absent" });
        // Saw 1 has no load booked: the Record's dash.
        expect([traces(cell(container, "M-07", "load")).length, absent(cell(container, "M-07", "load"))]).toEqual([0, m.absent()]);
        // Mill 2 has no year (none), Saw 1 a year of no weeks: the column's words, on hover too.
        for (const id of ["M-04", "M-07"]) {
            const history = cell(container, id, "history");
            expect([traces(history).length, absent(history), history.title], id).toEqual([0, "no history", "no history"]);
        }
    });

    test("read only: a clear, typing and a paste pass a trace by, the status line saying so — its steps as they were (T1)", async () => {
        const { container } = await h.mount(ex.recordTrace, { storageKey: "record-trace-read-only" });
        const load = () => cell(container, "M-01", "load");
        const before = steps(load()).map((s) => s.title);
        await press(load());
        expect(load().hasAttribute("data-active")).toBe(true);
        await act(async () => { fireEvent.keyDown(grid(container), { key: "Delete" }); });
        await settle();
        expect(status(container)).toBe("Nothing cleared — Load is read only");
        await act(async () => { fireEvent.keyDown(grid(container), { key: "5" }); });
        await settle();
        expect(load().querySelector('[data-slot="editor"]')).toBeNull();
        await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => "1, 2, 3" } }); });
        await settle();
        expect(status(container)).toBe("Nothing pasted — Load is read only");
        expect(steps(load()).map((s) => s.title)).toEqual(before);
    });

    test("copy puts a trace's numbers, bare, comma-separated — a row of them, a column each (T7)", async () => {
        const { container } = await h.mount(ex.recordTrace, { storageKey: "record-trace-copy" });
        await press(cell(container, "M-02", "load"));
        const copied = new Map<string, string>();
        await act(async () => {
            fireEvent.copy(grid(container), { clipboardData: { setData: (kind: string, text: string) => copied.set(kind, text), getData: () => "" } });
        });
        expect(copied.get("text/plain")).toBe("12, 14.5, 13, 16, 18, 20, 22, 24, 26, 28, 30, 32");
    });

    test("Details draws each trace's field with the same Trace, read only, in its column's place — or the column's words (T8)", async () => {
        const { container } = await h.mount(ex.recordTrace, { storageKey: "record-trace-details" });
        await press(cell(container, "M-01", "load"));
        expect(details(container).getAttribute("data-record-entry")).toBe("M-01");
        // The fields in the columns' order, each trace's the host's own control; then the fields no column shows, this week's figures.
        expect([...details(container).querySelectorAll("[data-field]")].map((f) => [f.getAttribute("data-field"), f.getAttribute("data-editor")]))
            .toEqual([["name", "text"], ["load", "custom"], ["weeks", "custom"], ["history", "custom"], ["booked", "number"], ["capacity", "number"], ["used", "number"], ["good", "number"], ["made", "number"]]);
        // The load as its cell draws it: twelve steps, each saying its week, at Trace's compact steps.
        const load = field(container, "load");
        expect(traces(load).map((t) => t.getAttribute("data-density"))).toEqual(["compact"]);
        expect(steps(load).map((s) => s.title)).toEqual(steps(cell(container, "M-01", "load")).map((s) => s.title));
        expect(looks(load)).toEqual(looks(cell(container, "M-01", "load")));
        // No input to type in: read only.
        expect(load.querySelector("input")).toBeNull();
        // Mill 2's year is none: the column's words.
        await press(cell(container, "M-04", "name"));
        await press(cell(container, "M-04", "load"));
        expect(details(container).getAttribute("data-record-entry")).toBe("M-04");
        expect([traces(field(container, "history")).length, absent(field(container, "history"))]).toEqual([0, "no history"]);
    });

    test("on a phone a press on a trace opens no bottom editor: it is read only (T1)", async () => {
        const restore = touchFrame(390);
        try {
            const { container } = await h.mount(ex.recordTrace, { storageKey: "record-trace-phone" });
            // The phone's grid: its title pinned, the columns a window — where a press on a Sheet kind's cell edits it below.
            expect(grid(container).getAttribute("data-phone")).toBe("");
            const editor = () => container.querySelector<HTMLElement>("[data-record] [data-sheet-cell-editor]");
            const load = cell(container, "M-02", "load");
            expect(traces(load).length).toBe(1);
            await press(load);
            expect(editor()).toBeNull();
        } finally {
            restore();
        }
    });
});
