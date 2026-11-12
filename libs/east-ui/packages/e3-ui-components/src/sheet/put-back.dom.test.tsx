/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet over jobs read whole, through a Save whose every part another
 * session puts back exactly before the sheet reads the jobs again (#1599), on
 * e3 itself: the check every builder runs (`shared/remote-rows.test-utils.ts`'
 * `putBackAfterSave`), over the conflicts example's jobs.
 *
 * The record then holds the bytes it held before the Save, so nothing it holds
 * tells when it was read: the Save is read back at what the page holds of the
 * record once it has read it since e3 answered (`record-runtime.ts`'
 * `settledOf`). Left to what the jobs show, the Save waited for good.
 *
 * - A quantity typed here and saved, typed back by another session.
 * - A job removed here and saved, added back by another session as it was.
 */

import { test } from "vitest";
import { fireEvent } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { putBackAfterSave } from "../shared/remote-rows.test-utils.js";
import { act, settle, sheetHarness, slot } from "./frame/harness.test-utils.js";

const h = sheetHarness();

/** The sheet's rows, the blank one left out. */
const rowEls = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]:not([data-blank])')];
/** A row by its key; `undefined` where the grid draws none. */
const rowOf = (c: HTMLElement, id: string) => rowEls(c).find((row) => row.getAttribute("data-row-id") === id);
/** What the grid draws of each job: its key, and what its cells say. */
const look = (c: HTMLElement) => rowEls(c).map((row) => [row.getAttribute("data-row-id"), [...row.querySelectorAll<HTMLElement>("[data-key]")].map((cell) => cell.textContent)]);
const card = (c: HTMLElement) => slot(c, "main")!.querySelector<HTMLElement>("[data-sheet-card]")!;

/** What the shared check takes of the Sheet: what the grid draws of the jobs, what e3 holds, and a Save followed by a write that puts the jobs back. */
async function putBack(c: HTMLElement) {
    const before = await h.read(ex.sheetConflictJobs);
    return {
        container: c,
        look: () => look(c),
        held: async () => [...(await h.read(ex.sheetConflictJobs))],
        savedThenPutBack: (save: () => void) => h.followed(ex.sheetConflictJobs, save, () => before),
    };
}

test("sheetConflicts: a quantity typed here and saved, typed back by another session before the sheet reads the jobs again, is read back with the quantity as it was — the Save never left saving, nothing asked, nothing left to save", async () => {
    const { container: c } = await h.mount(ex.sheetConflicts, { storageKey: "sheet-put-back-changed" });
    await putBackAfterSave({
        ...await putBack(c),
        // The first job's quantity typed in its editor, committed with ⏎.
        change: async () => {
            fireEvent.doubleClick(rowOf(c, "J-0001")!.querySelector<HTMLElement>('[data-key="qty"]')!);
            await settle();
            const input = document.querySelector('[data-slot="editorInput"]')!;
            fireEvent.input(input, { target: { value: "50" } });
            await settle();
            fireEvent.keyDown(input, { key: "Enter" });
            await settle();
        },
    });
});

test("sheetConflicts: a job removed here and saved, added back by another session exactly as it was before the sheet reads the jobs again, stands on the grid as e3 holds it — the Save never left saving, and the job never removed again", async () => {
    const { container: c } = await h.mount(ex.sheetConflicts, { storageKey: "sheet-put-back-removed" });
    await putBackAfterSave({
        ...await putBack(c),
        // Picked by its number, then deleted.
        change: async () => {
            fireEvent.mouseDown(rowOf(c, "J-0002")!.querySelector<HTMLElement>('[data-slot="gutter"]')!, { button: 0 });
            await act(async () => { fireEvent.keyDown(card(c), { key: "Backspace" }); });
            await settle();
        },
    });
});
