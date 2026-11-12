/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet beside a row another session removes, changes or adds, on e3
 * itself (#1599): the checks every builder runs
 * (`shared/remote-rows.test-utils.ts`), over a record read a window at a time —
 * the sheet's own pages held at the harness's fetch and let go one at a time,
 * what the grid draws of the row read at every change of the page.
 *
 * - A job removed here and by another session: nothing to choose, nothing to
 *   save, and the row never drawn again.
 * - A job changed here that another session removes: a conflict to choose, the
 *   job standing as drafted meanwhile; kept, the next Save puts it back;
 *   let go, the row leaves.
 * - A job removed here that another session changed: a conflict to choose,
 *   the job staying off the grid meanwhile; kept, the next Save removes it;
 *   let go, the row is back as the other session left it.
 * - A job added here under the key another session's new job then takes: the
 *   one added here goes on under the next key, both drawn, nothing to choose,
 *   and Save keeps both.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { East, IntegerType, parseFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { Data, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/sheet/sheet-keys";
import type { E3Request } from "../e3-web.test-utils.js";
import { addedOnBothSides, putBackAfterSave, removedHere, removedOnBothSides, removedThere } from "../shared/remote-rows.test-utils.js";
import { act, settle, sheetHarness } from "./frame/harness.test-utils.js";

const h = sheetHarness({ modules: { "sheet/sheet-keys.fixtures": fx }, frame: 2000 });

/** The jobs' record, as its dataset's requests name it. */
const JOBS = `records.${fx.numberedJobs.name}`;
type Job = ValueTypeOf<typeof fx.NumberedJob>;
const keyText = printFor(IntegerType);
const keyOf = parseFor(IntegerType);

/** The jobs a window at a time: `Data.bindPaged` over the record. */
const windowedJobs = East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(fx.numberedJobs, ["patch"]));
    const page = $.let(Data.bindPaged(fx.numberedJobs));
    return Sheet.Payload({
        record: jobs, window: page, name: "remoteJobs",
        columns: { task: Sheet.column.text(fx.NumberedJob, { header: "Task" }), qty: Sheet.column.integer(fx.NumberedJob, { header: "Qty" }) },
    });
});

/** The sheet's rows, the blank one left out. */
const rowEls = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')];
/** A row by its key; `undefined` where the grid draws none. */
const rowOf = (c: HTMLElement, id: string) => rowEls(c).find((row) => row.getAttribute("data-row-id") === id);
/** The jobs the grid draws, by their keys. */
const ids = (c: HTMLElement) => rowEls(c).map((row) => row.getAttribute("data-row-id"));
/** What a row's cells say. */
const cells = (row: HTMLElement | undefined) => row === undefined ? undefined : [...row.querySelectorAll<HTMLElement>("[data-key]")].map((cell) => cell.textContent);
const card = (c: HTMLElement) => c.querySelector("[data-sheet-card]")!;

/** The jobs mounted, as e3 holds them to begin with. */
async function mounted(storageKey: string): Promise<HTMLElement> {
    const { container: c } = await h.mountPayload(windowedJobs, { storageKey });
    await waitFor(() => expect(ids(c)).toEqual(["9", "10"]));
    return c;
}

/** Another session's write: the jobs as it leaves them, from the jobs as e3 holds them now. */
async function theirs(change: (jobs: Map<bigint, Job>) => void): Promise<void> {
    const jobs = new Map(await h.read(fx.numberedJobs));
    change(jobs);
    await h.patch(fx.numberedJobs, jobs);
    await settle();
}

/** A job's quantity pasted over, as a person pastes it: a draft. Its task, which names it, stays. */
async function requantify(c: HTMLElement, id: string, qty: string): Promise<void> {
    fireEvent.mouseDown(rowOf(c, id)!.querySelector<HTMLElement>('[data-key="qty"]')!, { button: 0 });
    await act(async () => { fireEvent.paste(card(c), { clipboardData: { getData: () => qty } }); });
    await settle();
}

/** A job removed here, as a person does it: picked by its number, then deleted. */
async function remove(c: HTMLElement, id: string): Promise<void> {
    fireEvent.mouseDown(rowOf(c, id)!.querySelector<HTMLElement>('[data-slot="gutter"]')!, { button: 0 });
    await act(async () => { fireEvent.keyDown(card(c), { key: "Backspace" }); });
    await settle();
}

/** What the shared checks take of the Sheet, over job 9. */
const job = (c: HTMLElement) => ({
    e3: h.e3, container: c,
    // The sheet's own reads of the jobs: its window's pages, never the reads a session makes by key.
    reads: (request: E3Request) => request.dataset === JOBS && request.kind === "page",
    drawn: () => rowOf(c, "9") !== undefined,
    theirRemoval: () => theirs((jobs) => { jobs.delete(9n); }),
    held: async () => (await h.read(fx.numberedJobs)).has(9n),
    name: "Assembly",
});

test("a job removed here and by another session is nothing to choose and nothing to save, and the grid never draws it again — nor while its window, standing from before the other session's write, is read again", async () => {
    const c = await mounted("sheet-remote-removed-both");
    await removedOnBothSides({ ...job(c), remove: () => remove(c, "9") });
    expect(ids(c)).toEqual(["10"]);
});

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the row leaves and nothing is left to save", "source"]] as const)(
    "a job changed here that another session removes stands as drafted while the sheet's window is read again, a conflict to choose: %s", async (_ends, choice) => {
        const c = await mounted(`sheet-remote-removed-there-${choice}`);
        await removedThere({ ...job(c), change: () => requantify(c, "9", "7"), look: () => cells(rowOf(c, "9")) }, choice);
    });

test.each([["kept, the next Save removes it", "draft"], ["let go, the row is back as the other session left it", "source"]] as const)(
    "a job removed here that another session changed stays off the grid while the sheet's window is read again, a conflict to choose: %s", async (_ends, choice) => {
        const c = await mounted(`sheet-remote-removed-here-${choice}`);
        await removedHere({
            ...job(c), remove: () => remove(c, "9"),
            theirChange: () => theirs((jobs) => { jobs.set(9n, { ...jobs.get(9n)!, qty: 7n }); }),
        }, choice);
        if (choice === "source") expect(cells(rowOf(c, "9"))).toEqual(["Assembly", "7"]);
    });

test("a job added here under the key another session's new job then takes goes on under the next key: both drawn, nothing to choose, and Save keeps both", async () => {
    const c = await mounted("sheet-remote-added-both");
    await addedOnBothSides({
        e3: h.e3, container: c,
        // No read is held here. Over a record read a window at a time the session learns that its new row's key is
        // taken from the very page its grid reads the row's place in: held, nothing could tell it, and the row
        // rightly stands under the key it has. The removals above hold the pages.
        reads: () => false,
        // A job pasted in the blank row: the next key the sheet's session makes.
        add: [
            () => { fireEvent.mouseDown(c.querySelector<HTMLElement>('[data-slot="row"][data-blank] [data-key="task"]')!, { button: 0 }); },
            () => { fireEvent.paste(card(c), { clipboardData: { getData: () => "Sanding\t6" } }); },
        ],
        // The rows the drafts add: drawn as drafts, none of them a job the record held as the sheet opened.
        added: () => rowEls(c).filter((row) => row.hasAttribute("data-draft")).map((row) => row.getAttribute("data-row-id")!).filter((id) => id !== "9" && id !== "10"),
        drawn: (key) => rowOf(c, key) !== undefined,
        // Their own job under that key.
        theirAddition: (key) => theirs((jobs) => {
            const read = keyOf(key);
            if (!read.success) throw new Error(`The sheet made a key that is no Integer: ${key}`);
            jobs.set(read.value, { task: "Edge banding", qty: 3n });
        }),
        heldKeys: async () => [...(await h.read(fx.numberedJobs)).keys()].map((key) => keyText(key)),
    });
});

/** What the shared check takes of the Sheet: what the grid draws of the jobs, what e3 holds, and a Save followed by a write that puts the jobs back. */
async function putBack(c: HTMLElement) {
    const before = await h.read(fx.numberedJobs);
    return {
        container: c,
        // The jobs the record holds or the drafts add, each by its key and what its cells say: never the blank row.
        look: () => rowEls(c).map((row) => [row.getAttribute("data-row-id"), cells(row)]),
        held: async () => [...(await h.read(fx.numberedJobs))],
        savedThenPutBack: (save: () => void) => h.followed(fx.numberedJobs, save, () => before),
    };
}

test("a quantity pasted here and saved, put back by another session before the sheet reads its window again, is read back with the quantity as it was: the Save never left saving, nothing asked, nothing left to save", async () => {
    const c = await mounted("sheet-remote-put-back-changed");
    await putBackAfterSave({ ...await putBack(c), change: () => requantify(c, "9", "7") });
});

test("a job removed here and saved, added back by another session exactly as it was before the sheet reads its window again, stands on the grid as e3 holds it: the Save never left saving, and the job never removed again", async () => {
    const c = await mounted("sheet-remote-put-back-removed");
    await putBackAfterSave({ ...await putBack(c), change: () => remove(c, "9") });
    expect(ids(c)).toEqual(["9", "10"]);
});

test("a job added here and saved, removed again by another session before the sheet reads its window again, is gone as e3 holds the jobs: the Save never left saving, and the job never added again", async () => {
    const c = await mounted("sheet-remote-put-back-added");
    await putBackAfterSave({
        ...await putBack(c),
        // A job pasted in the blank row.
        change: [
            () => { fireEvent.mouseDown(c.querySelector<HTMLElement>('[data-slot="row"][data-blank] [data-key="task"]')!, { button: 0 }); },
            () => { fireEvent.paste(card(c), { clipboardData: { getData: () => "Sanding\t6" } }); },
        ],
    });
    expect(ids(c)).toEqual(["9", "10"]);
});
