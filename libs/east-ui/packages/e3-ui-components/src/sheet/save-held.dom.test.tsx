/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet through a Save whose reads come back late — the checks every
 * builder runs (`shared/save-held.test-utils.ts`): over a record read a window
 * at a time, a row a paste added stays in the grid, as typed, from the press of
 * Save until its window is read again, never gone while the window's pages are
 * on their way; and a Save never stops the editing — another row's cell pasted
 * over while the pages are read again is taken at once, from the row the grid
 * shows, and is the next Save's to send. The same with the sheet's payload
 * built again at every step, as its page evaluated again builds it: no row
 * leaves the grid for it.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { East } from "@elaraai/east";
import { Data, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/sheet/sheet-keys";
import { editedThroughReload, redrawnThroughReload, savedThroughReload } from "../shared/save-held.test-utils.js";
import { evaluatesAgain } from "../e3-web-mount.test-utils.js";
import { act, settle, sheetHarness } from "./frame/harness.test-utils.js";

const h = sheetHarness({ modules: { "sheet/sheet-keys.fixtures": fx }, frame: 2000 });
evaluatesAgain();

/** The jobs' record, as its dataset's requests name it. */
const JOBS = `records.${fx.numberedJobs.name}`;

/** The jobs a window at a time: `Data.bindPaged` over the record. */
const windowedJobs = East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(fx.numberedJobs, ["patch"]));
    const page = $.let(Data.bindPaged(fx.numberedJobs));
    return Sheet.Payload({
        record: jobs, window: page, name: "heldJobs",
        columns: { task: Sheet.column.text(fx.NumberedJob, { header: "Task" }), qty: Sheet.column.integer(fx.NumberedJob, { header: "Qty" }) },
    });
});

/** The sheet's rows: each one's id and what its cells say, in order. */
const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')]
    .map((row) => [row.getAttribute("data-row-id"), [...row.querySelectorAll<HTMLElement>("[data-key]")].map((cell) => cell.textContent)]);

test("a row Save added stays in the grid, as typed, while its window is read again, and once it is", async () => {
    const { container: c } = await h.mountPayload(windowedJobs, { storageKey: "sheet-save-held" });
    await waitFor(() => expect(rows(c).map(([id]) => id)).toEqual(["9", "10"]));
    // A row pasted in the blank row: job 11, a draft.
    const blank = c.querySelector<HTMLElement>('[data-slot="row"][data-blank] [data-key="task"]')!;
    fireEvent.mouseDown(blank, { button: 0 });
    await act(async () => { fireEvent.paste(c.querySelector("[data-sheet-card]")!, { clipboardData: { getData: () => "Sanding\t6" } }); });
    await settle();
    expect(rows(c).map(([id]) => id)).toEqual(["9", "10", "11"]);
    await savedThroughReload({
        e3: h.e3,
        container: c,
        // The window's pages, which the Save's own confirmation, by key, is none of.
        reads: (request) => request.dataset === JOBS && request.kind === "page",
        look: () => rows(c),
    });
    // Saved: the record holds job 11.
    expect((await h.read(fx.numberedJobs)).get(11n)).toEqual({ task: "Sanding", qty: 6n });
});

test.each([
    ["a Save never stops the editing: another row's task pasted over while the window is read again after a Save is taken at once — from the row the grid shows — stays as typed as the pages land, and the next Save writes it", editedThroughReload, "sheet-save-again"],
    ["the sheet built again while its window is read again after a Save takes no row off the grid: another row's task pasted over meanwhile is taken at once, stays as typed as the sheet is built again and the pages land, and the next Save writes it", redrawnThroughReload, "sheet-save-redrawn"],
])("%s", async (_name, through, storageKey) => {
    const { container: c } = await h.mountPayload(windowedJobs, { storageKey });
    await waitFor(() => expect(rows(c).map(([id]) => id)).toEqual(["9", "10"]));
    const card = () => c.querySelector("[data-sheet-card]")!;
    const blank = c.querySelector<HTMLElement>('[data-slot="row"][data-blank] [data-key="task"]')!;
    fireEvent.mouseDown(blank, { button: 0 });
    await act(async () => { fireEvent.paste(card(), { clipboardData: { getData: () => "Sanding\t6" } }); });
    await settle();
    expect(rows(c).map(([id]) => id)).toEqual(["9", "10", "11"]);
    await through({
        e3: h.e3,
        container: c,
        reads: (request) => request.dataset === JOBS && request.kind === "page",
        look: () => rows(c),
        // Job 9, which the Save did not hold: its original is the grid's own row of it. Its task picked, then pasted over.
        again: [
            () => { fireEvent.mouseDown(c.querySelector<HTMLElement>('[data-slot="row"][data-row-id="9"] [data-key="task"]')!, { button: 0 }); },
            () => { fireEvent.paste(card(), { clipboardData: { getData: () => "Varnishing" } }); },
        ],
    });
    const jobs = await h.read(fx.numberedJobs);
    expect([jobs.get(11n), jobs.get(9n)!.task]).toEqual([{ task: "Sanding", qty: 6n }, "Varnishing"]);
});
