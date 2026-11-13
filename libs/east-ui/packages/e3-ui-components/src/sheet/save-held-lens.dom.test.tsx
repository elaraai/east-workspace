/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet's lens through a Save whose reads come back late — the checks
 * every builder runs (`shared/save-held.test-utils.ts`, #1599), over the
 * example's 50,000 work orders on e3 itself: the rail's `rows` source narrowed
 * to the orders Ready, drawn one after another as the lens draws them, each
 * read from the record's segments near the view. A quantity a Save wrote reads
 * as typed from the press of Save until its segments are read again; another
 * order's quantity typed meanwhile is taken at once — from the row the lens
 * shows, whose entry its segment carried — stays as typed as the pages land,
 * and is the next Save's to send; and the page evaluated again at every step
 * takes no order off the sheet.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-records";
import type { E3Request } from "../e3-web.test-utils.js";
import { evaluatesAgain } from "../e3-web-mount.test-utils.js";
import { editedThroughReload, redrawnThroughReload, savedThroughReload } from "../shared/save-held.test-utils.js";
import { frameScrolls } from "./frame.test-utils.js";
import { act, settle, sheetHarness } from "./frame/harness.test-utils.js";

const h = sheetHarness({ modules: { "sheet/sheet-records": ex }, frame: 2000 });
evaluatesAgain();
/** The work orders' record, as its dataset's requests name it. */
const ORDERS = `records.${ex.indexedWorkOrders.name}`;
let restoreScroll = () => {};
beforeEach(() => { restoreScroll = frameScrolls(); });
afterEach(() => { restoreScroll(); });

/** The orders' pages — the segments the lens draws its rows from — all but a one-row page, a Save's own read of a row by its key. */
const pages = (request: E3Request) => request.kind === "page" && request.dataset === ORDERS && request.query.get("limit") !== "1";

/** The sheet over the orders Ready, its first rows drawn. */
async function setup() {
    const ui = await h.mount(ex.sheetRecordIndexes, { storageKey: "sheet-lens-save-held" });
    const c = ui.container;
    const row = (id: string) => c.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`);
    await waitFor(() => expect(row("JOB-10006")).not.toBeNull());
    await settle();
    expect(c.querySelector("[data-sheet]")!.hasAttribute("data-lens"), "the lens draws the rows").toBe(true);
    /** The first orders the lens draws, and each one's quantity as its cell says it. */
    const look = () => ["JOB-10000", "JOB-10003", "JOB-10006"].map((id) => [id, row(id)?.querySelector<HTMLElement>('[data-slot="cell"][data-key="quantity"]')?.textContent ?? null]);
    const editor = () => c.querySelector<HTMLInputElement>('[data-slot="editorInput"]')!;
    /** A quantity typed into an order, as a person types it: the cell opened, the number typed, Enter — each an act of its own. */
    const typing = (id: string, to: string): (() => void)[] => [
        () => { fireEvent.doubleClick(row(id)!.querySelector('[data-key="quantity"]')!); },
        () => { fireEvent.input(editor(), { target: { value: to } }); },
        () => { fireEvent.keyDown(editor(), { key: "Enter" }); },
    ];
    const type = async (id: string, to: string): Promise<void> => {
        for (const step of typing(id, to)) {
            await act(async () => { step(); });
            await settle();
        }
    };
    return { c, look, typing, type };
}

test("a quantity a Save wrote reads as typed under the lens, at every change of the page, from the press of Save until its segments are read again", async () => {
    const { c, look, type } = await setup();
    await type("JOB-10000", "7");
    expect(look()[0]).toEqual(["JOB-10000", "7"]);
    await savedThroughReload({ e3: h.e3, container: c, reads: pages, look });
    expect((await h.read(ex.indexedWorkOrders)).get("JOB-10000")?.quantity).toBe(7n);
});

test.each([
    ["a Save never stops the editing under the lens: another order's quantity typed while the segments are read again after a Save is taken at once — from the row the lens shows — stays as typed as the pages land, and the next Save writes it", editedThroughReload, "sheet-lens-save-again"],
    ["the page evaluated again while the lens's segments are read again after a Save takes no order off the sheet: another order's quantity typed meanwhile is taken at once, stays as typed as the page is evaluated again and the pages land, and the next Save writes it", redrawnThroughReload, "sheet-lens-save-redrawn"],
])("%s", async (_name, through) => {
    const { c, look, typing, type } = await setup();
    await type("JOB-10000", "7");
    expect(look()[0]).toEqual(["JOB-10000", "7"]);
    // JOB-10003, which the Save did not hold: its original is the lens's own row of it.
    await through({ e3: h.e3, container: c, reads: pages, look, again: typing("JOB-10003", "9") });
    const orders = await h.read(ex.indexedWorkOrders);
    expect([orders.get("JOB-10000")?.quantity, orders.get("JOB-10003")?.quantity]).toEqual([7n, 9n]);
});
