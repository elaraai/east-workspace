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
 * leaves the grid for it. And the app's check of a row edited meanwhile reads
 * the rows around it as the grid shows them: the one the Save wrote as the
 * Save left it, never as its page held it before (#1599).
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Data, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/sheet/sheet-keys";
import { editedThroughReload, redrawnThroughReload, savedThroughReload } from "../shared/save-held.test-utils.js";
import { evaluatesAgain } from "../e3-web-mount.test-utils.js";
import { act, settle, sheetHarness, slot } from "./frame/harness.test-utils.js";

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

/**
 * The same jobs, their tasks alone in the grid: a quantity has no column, so it reaches the app's check only through its
 * row's entry. The check holds the jobs to a batch of three pieces between them — which the two jobs make, one and two.
 */
const batchedJobs = East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(fx.numberedJobs, ["patch"]));
    const page = $.let(Data.bindPaged(fx.numberedJobs));
    const Ready = Sheet.Types.Readiness;
    const threePieces = $.const(East.function([Sheet.Types.Draft(fx.NumberedJob), Sheet.Types.DraftContext(fx.NumberedJob)], Ready, ($2, _row, ctx) => {
        const ready = $2.const(variant("ready", null), Ready);
        const short = $2.const(variant("incomplete", [{ field: "task", message: "The batch needs three pieces" }]), Ready);
        const pieces = $2.const(ctx.rows.map((_$3, other) => other.qty.match({ value: (_$4, qty) => qty }, () => 0n)).reduce((_$3, sum, qty) => sum.add(qty), 0n));
        return pieces.less(3n).ifElse(() => short, () => ready);
    }));
    return Sheet.Payload({
        record: jobs, window: page, name: "batchedJobs", ready: { row: threePieces }, edits: { insertRows: false },
        columns: { task: Sheet.column.text(fx.NumberedJob, { header: "Task" }) },
    });
});

test("the app's check of a row edited while its window is read again — another session's write on its way in — reads the rows around it as the grid shows them, each over the entry its window carried: a field no column shows is there, and the check finds nothing wrong", async () => {
    const { container: c } = await h.mountPayload(batchedJobs, { storageKey: "sheet-save-check" });
    await waitFor(() => expect(rows(c)).toEqual([["9", ["Assembly"]], ["10", ["Spray finish"]]]));
    const card = () => c.querySelector("[data-sheet-card]")!;
    const toolbar = () => within(slot(c, "toolbar")!);
    /** What the toolbar's issues button says: how many there are. */
    const issues = () => toolbar().getByRole("button", { name: /^\d+ issues?$/ }).getAttribute("aria-label");
    const held = h.e3.hold((request) => request.dataset === JOBS && request.kind === "page");
    try {
        // Another session renames job 9's task: the sheet hears of it and reads its window again, its pages on their way.
        const jobs = await h.read(fx.numberedJobs);
        await h.patch(fx.numberedJobs, new Map([...jobs].map(([key, job]) => [key, key === 9n ? { ...job, task: "Sanding" } : job] as const)));
        await waitFor(() => expect(held.held, "the sheet reads its window again").toBeGreaterThan(0), { timeout: 5_000 });
        await settle();
        // The rows stand as they were read. Job 10's task pasted over is the session's first edit, so its check reads the
        // rows around it now: job 9's quantity from the entry job 9's row was read with — one piece, with job 10's two —
        // never a row with no quantity, whose batch is one short.
        fireEvent.mouseDown(c.querySelector<HTMLElement>('[data-slot="row"][data-row-id="10"] [data-key="task"]')!, { button: 0 });
        await act(async () => { fireEvent.paste(card(), { clipboardData: { getData: () => "Varnishing" } }); });
        await settle();
        expect(rows(c)).toEqual([["9", ["Assembly"]], ["10", ["Varnishing"]]]);
        expect(issues()).toBe("0 issues");
        expect(toolbar().getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() }).disabled).toBe(false);
    } finally {
        await act(async () => { held.release(); });
    }
    await settle();
    // The pages land: the other session's task for job 9 beside the one typed for job 10, and the same answer.
    await waitFor(() => expect(rows(c)).toEqual([["9", ["Sanding"]], ["10", ["Varnishing"]]]));
    expect(issues()).toBe("0 issues");
});
