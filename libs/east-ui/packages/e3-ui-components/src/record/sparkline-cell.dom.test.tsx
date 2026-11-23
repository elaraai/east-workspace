/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Record's sparkline cells (east-workspace#1729), over the machines' example
 * on e3 itself: each row's series drawn with east-ui's Sparkline; the scrap on
 * one vertical scale for every row, the output each row over its own, a single
 * week flat across the cell (S3); each cell's hover its last value and its
 * range (S4); none or an empty series the column's words (S5); read only — a
 * clear and a paste pass it by, saying so (S1); and Details drawing each
 * sparkline's field with the same Sparkline, read only (S7).
 */

import { describe, expect, test } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/record/record-display";
import { settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
import { recordMessages as m } from "./messages.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record-display": ex }, frame: 2000 });

/** A machine's cell, by its key and the column's. */
const cell = (c: HTMLElement, id: string, key: string) =>
    c.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** The display parts an element holds, each around a Sparkline. */
const parts = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-slot="display"][data-kind="sparkline"]')];
/** A Sparkline's line: each point's x and y, in its 100 × 100 box. */
function line(el: HTMLElement): [number, number][] {
    const d = el.querySelector("svg path[fill='none']")?.getAttribute("d") ?? "";
    return d.replace(/^M /, "").split(" L ").map((point) => point.split(" ").map(Number) as [number, number]);
}
/** The words a cell shows for no series. */
const absent = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-slot="absent"]')?.textContent;
/** The grid: what takes the keys. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** The status line's words. */
const status = (c: HTMLElement) => slot(c, "toolbar")!.querySelector('[data-slot="status"]')?.textContent;
/** The Record's Details for a row, in the inspector's open tab. */
const details = (c: HTMLElement) => slot(c, "end")!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [data-record-details="row"]')!;

/** A press on an element, the primary button, and what it leads to settled. */
async function press(el: Element) {
    await act(async () => { fireEvent.mouseDown(el, { button: 0 }); });
    await act(async () => { fireEvent.mouseUp(el, { button: 0 }); fireEvent.click(el); });
    await settle();
}

describe("a Record's sparkline cells (east-workspace#1729)", () => {
    test("on the scrap's domain the same week's scrap stands at the same height on every row, and scrap past 50 at the top; the output runs each row over its own range, one week flat across (S3)", async () => {
        const { container } = await h.mount(ex.recordSparkline, { storageKey: "record-sparkline-domain" });
        const scrap = (id: string) => line(cell(container, id, "scrap"));
        // 24 pieces: Lathe 2's fourth week and Drill 1's second.
        expect(scrap("M-02")[3]![1]).toBeCloseTo(scrap("M-09")[1]![1], 6);
        // Mill 1's 60, past the domain's 50, at the top of the box, as its 50 is.
        expect([scrap("M-03")[5]![1], scrap("M-03")[8]![1]]).toEqual([2, 2]);
        // On its own range, each machine's busiest week stands at the top, whatever it made.
        const output = (id: string) => line(cell(container, id, "output")).map(([, y]) => y);
        expect([Math.min(...output("M-01")), Math.min(...output("M-02"))]).toEqual([2, 2]);
        // An area, under its line; one week's output a flat line across the cell.
        expect(cell(container, "M-01", "output").querySelector("svg path[fill-opacity]")).not.toBeNull();
        expect(line(cell(container, "M-05", "output"))).toEqual([[2, 50], [98, 50]]);
    });

    test("each cell's hover names its series: its last value and its range, in the viewer's language (S4)", async () => {
        const { container } = await h.mount(ex.recordSparkline, { storageKey: "record-sparkline-hover" });
        expect(cell(container, "M-10", "scrap").title).toBe("last 31 · 18 to 42");
        expect(cell(container, "M-01", "output").title).toBe("last 340 · 340 to 500");
        expect(cell(container, "M-05", "output").title).toBe("last 260 · 260 to 260");
    });

    test("none or an empty series shows the column's words, else the Record's dash (S5)", async () => {
        const { container } = await h.mount(ex.recordSparkline, { storageKey: "record-sparkline-absent" });
        for (const key of ["output", "scrap", "weeks"]) {
            const saw = cell(container, "M-07", key);
            expect([parts(saw).length, absent(saw)], key).toEqual([0, m.absent()]);
        }
        // Every other machine draws each: one line apiece.
        expect(["M-01", "M-02", "M-03", "M-04", "M-05", "M-06", "M-08", "M-09", "M-10"].map((id) => parts(cell(container, id, "scrap")).length))
            .toEqual(Array.from({ length: 9 }, () => 1));
    });

    test("read only: a clear and a paste pass a sparkline by, the status line saying so (S1)", async () => {
        const { container } = await h.mount(ex.recordSparkline, { storageKey: "record-sparkline-read-only" });
        const output = () => cell(container, "M-01", "output");
        const before = line(output());
        await press(output());
        await act(async () => { fireEvent.keyDown(grid(container), { key: "Backspace" }); });
        await settle();
        expect(status(container)).toBe("Nothing cleared — Output is read only");
        await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => "1, 2, 3" } }); });
        await settle();
        expect(status(container)).toBe("Nothing pasted — Output is read only");
        expect(line(output())).toEqual(before);
    });

    test("Details draws each sparkline's field with the same Sparkline, read only, in its column's place (S7)", async () => {
        const { container } = await h.mount(ex.recordSparkline, { storageKey: "record-sparkline-details" });
        await press(cell(container, "M-02", "scrap"));
        expect(details(container).getAttribute("data-record-entry")).toBe("M-02");
        // The fields in the columns' order, the load and last year hidden; each sparkline the host's own control.
        expect([...details(container).querySelectorAll("[data-field]")].map((f) => [f.getAttribute("data-field"), f.getAttribute("data-editor")]))
            .toEqual([["name", "text"], ["output", "custom"], ["scrap", "custom"], ["weeks", "custom"]]);
        const scrap = details(container).querySelector<HTMLElement>('[data-field="scrap"]')!;
        expect(parts(scrap).map((p) => p.getAttribute("data-place"))).toEqual(["details"]);
        expect(line(scrap)).toEqual(line(cell(container, "M-02", "scrap")));
        expect(scrap.querySelector("input")).toBeNull();
    });
});
