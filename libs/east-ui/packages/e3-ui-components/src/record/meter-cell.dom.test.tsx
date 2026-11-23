/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Record's meter cells (east-workspace#1730), over the machines' example on
 * e3 itself: each row's value against its max drawn with east-ui-components'
 * own Meter, its percent beside its bar as Meter draws it, held to 100% past
 * the max (M2); a max of 0 an empty bar, its hover saying why (M3); each
 * cell's hover its value, the row's max and the share (M5); none the column's
 * words (M6); read only — a clear and a paste pass it by, saying so (M1);
 * Details drawing each meter's field with the same Meter (M8); and a machine's
 * capacity edited in Details redrawing its booked bar before it is saved (M9).
 */

import { describe, expect, test } from "vitest";
import { act, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as ex from "@elaraai/e3-ui/examples/record/record-display";
import { settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
import { recordMessages as m } from "./messages.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record-display": ex }, frame: 2000 });

/** A machine's cell, by its key and the column's. */
const cell = (c: HTMLElement, id: string, key: string) =>
    c.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** The meters an element holds: each the display part around a Meter. */
const meters = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-slot="display"][data-kind="meter"]')];
/** A Meter's percent, as it draws it beside its bar — its one span. */
const percent = (el: HTMLElement) => meters(el)[0]?.querySelector("span")?.textContent;
/** The words a cell shows for no value. */
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

describe("a Record's meter cells (east-workspace#1730)", () => {
    test("each row's value is Meter's bar against the row's max, its percent beside it, held to 100% past the max (M2); a max of 0 draws an empty bar, saying why on hover (M3)", async () => {
        const { container } = await h.mount(ex.recordMeter, { storageKey: "record-meter-share" });
        // Lathe 2: 31.5 of the 40 hours it can run; 64% of its time; 401 good of 420 made.
        expect(["booked", "used", "good"].map((key) => percent(cell(container, "M-02", key)))).toEqual(["79%", "64%", "95%"]);
        // Mill 1, booked past its capacity and running past its time: the bar full, its percent 100%.
        expect(["booked", "used"].map((key) => percent(cell(container, "M-03", key)))).toEqual(["100%", "100%"]);
        // Press 1, down this week — no hours it can run: an empty bar, and why on hover.
        const down = cell(container, "M-05", "booked");
        expect([percent(down), down.title]).toEqual(["0%", "20 of 0 · no share: its max is 0 or below"]);
        // Every machine with a value draws one Meter in each meter column — the yield all but Saw 1's, which made nothing.
        const ids = ["M-01", "M-02", "M-03", "M-04", "M-05", "M-06", "M-07", "M-08", "M-09", "M-10"];
        expect(ids.map((id) => ["booked", "used", "good"].map((key) => meters(cell(container, id, key)).length).join("")))
            .toEqual(["111", "111", "111", "111", "111", "111", "110", "111", "111", "111"]);
    });

    test("each cell's hover says its value, the row's max and the share, the share past the max as it is (M5)", async () => {
        const { container } = await h.mount(ex.recordMeter, { storageKey: "record-meter-hover" });
        expect(cell(container, "M-02", "booked").title).toBe("31.5 of 40 · 79%");
        expect(cell(container, "M-03", "booked").title).toBe("44 of 40 · 110%");
        // One max for every row: the default 100, and the yield's 1.
        expect(cell(container, "M-01", "used").title).toBe("92 of 100 · 92%");
        expect(cell(container, "M-10", "good").title).toBe("0.957 of 1 · 96%");
    });

    test("none shows the column's words, said on hover too (M6)", async () => {
        const { container } = await h.mount(ex.recordMeter, { storageKey: "record-meter-absent" });
        const yieldOf = cell(container, "M-07", "good");
        expect([meters(yieldOf).length, absent(yieldOf), yieldOf.title]).toEqual([0, "nothing made", "nothing made"]);
        // The Record's dash where a column gives no words: none of the others is none.
        expect(absent(cell(container, "M-07", "booked"))).toBeUndefined();
        expect(m.absent()).toBe("—");
    });

    test("read only: a clear and a paste pass a meter by, the status line saying so (M1)", async () => {
        const { container } = await h.mount(ex.recordMeter, { storageKey: "record-meter-read-only" });
        const booked = () => cell(container, "M-02", "booked");
        await press(booked());
        await act(async () => { fireEvent.keyDown(grid(container), { key: "Backspace" }); });
        await settle();
        expect(status(container)).toBe("Nothing cleared — Booked is read only");
        await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => "12" } }); });
        await settle();
        expect(status(container)).toBe("Nothing pasted — Booked is read only");
        expect([percent(booked()), booked().title]).toEqual(["79%", "31.5 of 40 · 79%"]);
    });

    test("Details draws each meter's field with the same Meter, read only, in its column's place (M8)", async () => {
        const { container } = await h.mount(ex.recordMeter, { storageKey: "record-meter-details" });
        await press(cell(container, "M-02", "name"));
        expect(details(container).getAttribute("data-record-entry")).toBe("M-02");
        // The fields in the columns' order, the series hidden; each meter the host's own control; then capacity and made.
        expect([...details(container).querySelectorAll("[data-field]")].map((f) => [f.getAttribute("data-field"), f.getAttribute("data-editor")]))
            .toEqual([["name", "text"], ["booked", "custom"], ["used", "custom"], ["good", "custom"], ["capacity", "number"], ["made", "number"]]);
        const booked = field(container, "booked");
        expect([meters(booked).map((p) => p.getAttribute("data-place")), percent(booked)]).toEqual([["details"], "79%"]);
        expect(booked.querySelector("input")).toBeNull();
    });

    test("a machine's capacity edited in Details redraws its booked bar before it is saved: its max and its tone follow the draft (M9)", async () => {
        const { container } = await h.mount(ex.recordMeter, { storageKey: "record-meter-draft" });
        await press(cell(container, "M-02", "name"));
        const capacity = () => within(field(container, "capacity")).getByRole<HTMLInputElement>("spinbutton");
        expect(capacity().value).toBe("40");
        const user = userEvent.setup();
        await user.clear(capacity());
        await user.type(capacity(), "30{Enter}");
        await settle();
        // Lathe 2 now booked past the 30 hours it can run: its bar full, its hover the new share.
        const booked = cell(container, "M-02", "booked");
        expect([percent(booked), booked.title]).toEqual(["100%", "31.5 of 30 · 105%"]);
        expect(percent(field(container, "booked"))).toBe("100%");
        // A draft of the row, not yet saved.
        expect(cell(container, "M-02", "booked").closest("[data-slot='row']")?.hasAttribute("data-draft")).toBe(true);
    });
});
