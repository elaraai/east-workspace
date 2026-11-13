/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet's range drag by mouse, on e3 itself: a press on a cell, then the
 * pointer moving with its button held, extends the range to the cell it
 * enters. The drag is over as the button lifts — and as much when its lift is
 * never heard, let go off the window or under another app: the mouse's next
 * move, no button held, ends it, and so does the window losing the page. A
 * range left dragging would follow a pointer that holds nothing, every cell it
 * passed over taken into it (the rule every gesture is held to,
 * east-ui-components' `src/pointer/`).
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { East } from "@elaraai/east";
import { Data, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/sheet/sheet-keys";
import { sheetHarness } from "./frame/harness.test-utils.js";

const h = sheetHarness({ modules: { "sheet/sheet-keys.fixtures": fx }, frame: 2000 });

/** The jobs a window at a time: `Data.bindPaged` over the record. */
const rangedJobs = East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(fx.numberedJobs, ["patch"]));
    const page = $.let(Data.bindPaged(fx.numberedJobs));
    return Sheet.Payload({
        record: jobs, window: page, name: "rangedJobs",
        columns: { task: Sheet.column.text(fx.NumberedJob, { header: "Task" }), qty: Sheet.column.integer(fx.NumberedJob, { header: "Qty" }) },
    });
});

/** The sheet's rows, the blank one left out. */
const rowEls = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')];
/** The jobs the grid draws, by their keys. */
const ids = (c: HTMLElement) => rowEls(c).map((row) => row.getAttribute("data-row-id"));
/** A job's cell, by its key and its column. */
const cell = (c: HTMLElement, id: string, key: string) => rowEls(c).find((row) => row.getAttribute("data-row-id") === id)!.querySelector<HTMLElement>(`[data-key="${key}"]`)!;
/** The cells a range washes. */
const washed = (c: HTMLElement) => c.querySelectorAll('[data-slot="rangeWash"]').length;

test("a range drag whose button's lift is never heard is over as the mouse next moves with no button held, and as the window loses the page: a cell entered after is a hover, taken into no range", async () => {
    const { container: c } = await h.mountPayload(rangedJobs, { storageKey: "sheet-range-drag" });
    await waitFor(() => expect(ids(c)).toEqual(["9", "10"]));
    for (const [how, lose] of [
        ["no button held", () => { fireEvent.mouseMove(window, { buttons: 0 }); }],
        ["the window lost", () => { fireEvent.blur(window); }],
    ] as const) {
        // A press on job 9's task, dragged down to job 10's: the two cells.
        fireEvent.mouseDown(cell(c, "9", "task"), { button: 0 });
        fireEvent.mouseMove(window, { buttons: 1 });
        fireEvent.mouseEnter(cell(c, "10", "task"));
        expect(washed(c), how).toBe(2);
        // The button lifts where the window cannot hear it: no mouseup arrives.
        lose();
        // The pointer comes back over the grid, moving: a hover, extending nothing.
        fireEvent.mouseEnter(cell(c, "10", "qty"));
        expect(washed(c), how).toBe(2);
        // A press begins a range of its own: one cell again.
        fireEvent.mouseDown(cell(c, "9", "task"), { button: 0 });
        fireEvent.mouseUp(window);
        expect(washed(c), how).toBe(0);
    }
});

test("a range drag still follows the pointer while its button is held, another button pressed beside it or not, and ends at its lift", async () => {
    const { container: c } = await h.mountPayload(rangedJobs, { storageKey: "sheet-range-held" });
    await waitFor(() => expect(ids(c)).toEqual(["9", "10"]));
    fireEvent.mouseDown(cell(c, "9", "task"), { button: 0 });
    fireEvent.mouseMove(window, { buttons: 1 });
    fireEvent.mouseEnter(cell(c, "10", "task"));
    expect(washed(c)).toBe(2);
    // The secondary button pressed beside the primary: the primary is held still.
    fireEvent.mouseMove(window, { buttons: 1 | 2 });
    fireEvent.mouseEnter(cell(c, "10", "qty"));
    expect(washed(c)).toBe(4);
    fireEvent.mouseUp(window);
    fireEvent.mouseEnter(cell(c, "9", "task"));
    expect(washed(c)).toBe(4);
});
