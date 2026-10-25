/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { frameScrolls } from "./frame.test-utils.js";
import { act, settle, sheetHarness } from "./frame/harness.test-utils.js";

const h = sheetHarness({ modules: { "sheet/sheet-records": ex }, frame: 2000 });
/** The work orders' record, as its dataset's requests name it. */
const ORDERS = `records.${ex.indexedWorkOrders.name}`;
let restoreScroll = () => {};
beforeEach(() => { restoreScroll = frameScrolls(); });
afterEach(() => { restoreScroll(); });

/** The work orders' commits, newest first, by the mutation that made each. */
const commits = async () => (await h.history(ex.indexedWorkOrders)).commits.map((commit) => commit.mutation);

async function setup() {
    const record = ex.indexedWorkOrders;
    const deployed = await commits();
    const ui = await h.mount(ex.sheetRecordIndexes, { storageKey: "indexed-sheet-test" });
    const rows = () => [...ui.container.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')];
    const row = (id: string) => ui.container.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`);
    const tab = (id: string) => ui.container.querySelector<HTMLElement>(`[data-slot="tab"][data-tab="${id}"]`)!;
    return { ...ui, record, deployed, rows, row, tab };
}

test("indexed Sheet keeps the record's order under its lens, restores saved narrowing and saves hidden drafts by original primary key", async () => {
    const ui = await setup();
    await waitFor(() => expect(ui.row("JOB-10000")).not.toBeNull());
    await settle();
    const ids = () => ui.rows().map(row => row.dataset.rowId);
    const initialIds = ids();
    // The rail opens on Ready, every third order: the lens draws them one after another, each at its number in the record (#1349).
    expect(initialIds.slice(0, 3)).toEqual(["JOB-10000", "JOB-10003", "JOB-10006"]);
    expect(ui.rows().slice(0, 3).map((row) => row.querySelector('[data-slot="gutterNumber"]')!.textContent)).toEqual(["1", "4", "7"]);
    expect(ui.tab("all").textContent).toContain("50,000");
    expect(ui.container.querySelector('[data-slot="toolbarCount"]')?.textContent).toBe("16,667 matches");
    expect(h.requests("read", ORDERS)).toEqual([]);

    fireEvent.mouseDown(ui.container.querySelector('[data-slot="tabAdd"]')!, { button: 0 });
    await settle();
    expect(ui.tab("view-1").querySelector('[data-slot="tabCount"]')?.textContent).toBe("16,667");
    fireEvent.doubleClick(ui.row("JOB-10000")!.querySelector('[data-key="status"]')!);
    const editor = await waitFor(() => {
        const input = ui.container.querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(input).not.toBeNull(); return input!;
    });
    fireEvent.input(editor, { target: { value: "Scheduled" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await settle();
    expect(ui.row("JOB-10000")?.hasAttribute("data-draft")).toBe(true);
    expect(ids(), "editing must not re-sort by primary key").toEqual(initialIds);

    fireEvent.mouseDown(ui.tab("all"), { button: 0 });
    await settle();
    fireEvent.click(ui.container.querySelector('[data-record-slice-field="status"]')!);
    const choices = await waitFor(() => {
        const panel = document.querySelector<HTMLElement>('[data-record-slice-editor="status"]');
        expect(panel).not.toBeNull(); return panel!;
    });
    fireEvent.click(within(choices).getByRole("button", { name: /^Done/ }));
    await waitFor(() => expect(ui.row("JOB-10000")).toBeNull());
    await settle();
    expect(ui.rows().length).toBeGreaterThan(0);
    expect(ui.rows().every(row => row.querySelector('[data-key="status"]')?.textContent === "Done")).toBe(true);
    const save = ui.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.mouseDown(save, { button: 0 });
    fireEvent.click(save);
    await waitFor(() => expect((ui.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true));
    await settle();
    expect((await h.read(ui.record)).get("JOB-10000")?.status).toBe("Scheduled");
    expect(await commits()).toEqual(["patch", ...ui.deployed]);
    expect(h.requests("read", ORDERS), "neither narrowing nor confirmation reads the record whole").toEqual([]);
    expect(h.requests("find", ORDERS).some(request => request.query.get("key") === '"JOB-10000"')).toBe(true);
    expect(ui.container.querySelector('[data-record-save-notice]')).toBeNull();

    fireEvent.mouseDown(ui.tab("view-1"), { button: 0 });
    await settle();
    expect(ui.row("JOB-10000")).toBeNull();
    expect(ui.rows().every(row => row.querySelector('[data-key="status"]')?.textContent === "Ready")).toBe(true);
    expect(ui.tab("view-1").querySelector('[data-slot="tabCount"]')?.textContent).toBe("16,666");
    expect(ui.tab("view-1").hasAttribute("data-dirty")).toBe(false);
    expect(ui.queryByRole("alert")).toBeNull();

    // A saved row that leaves the current query has a different outcome from
    // the already-hidden edit above. The count is confirmed by primary key.
    const leaving = ui.rows()[0]!;
    const leavingId = leaving.dataset.rowId!;
    fireEvent.doubleClick(leaving.querySelector('[data-key="status"]')!);
    const nextEditor = await waitFor(() => {
        const input = ui.container.querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(input).not.toBeNull(); return input!;
    });
    fireEvent.input(nextEditor, { target: { value: "Scheduled" } });
    fireEvent.keyDown(nextEditor, { key: "Enter" });
    await settle();
    expect(ui.row(leavingId)).not.toBeNull();
    expect(ui.container.querySelector('[data-record-save-notice]')).toBeNull();
    // Save goes: its patch commits, and the saved row is read back by its key at the revision it committed.
    await act(async () => { fireEvent.click(ui.getByRole("button", { name: "Save" })); });
    await settle();
    expect(ui.container.querySelector('[data-record-save-notice]')?.textContent).toBe("1 row left this view");
    expect(ui.row(leavingId)).toBeNull();
    expect((await h.read(ui.record)).get(leavingId)?.status).toBe("Scheduled");
    expect(ui.tab("view-1").querySelector('[data-slot="tabCount"]')?.textContent).toBe("16,665");
    expect(h.requests("read", ORDERS)).toEqual([]);
    fireEvent.mouseDown(ui.tab("all"), { button: 0 });
    await settle();
    expect(ui.container.querySelector('[data-record-save-notice]')).toBeNull();
});

test("a scroll far from the rows, every page it shows on its way, is never covered again: the run drawn where the view is, main busy, and the rows land there (#1398, CL5)", async () => {
    const ui = await setup();
    await waitFor(() => expect(ui.row("JOB-10000")).not.toBeNull());
    await settle();
    // The whole sheet: every order, a page at a time.
    fireEvent.mouseDown(ui.tab("all"), { button: 0 });
    await settle();
    await waitFor(() => expect(ui.row("JOB-10001")).not.toBeNull());
    const main = () => ui.container.querySelector<HTMLElement>('[data-frame-slot="main"]')!;
    const covered = () => ui.container.querySelector("[data-builder-loading]");
    expect(covered()).toBeNull();
    // Every page of the orders held on its way to e3 from now until let land; the view goes to the record's middle.
    const pages = h.e3.hold((request) => request.kind === "page" && request.dataset === ORDERS);
    const frame = main().querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
    await act(async () => {
        frame.scrollTop = Math.round(frame.scrollHeight / 2);
        frame.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => expect(pages.held).toBeGreaterThan(0), { timeout: 10_000 });
    await settle();
    // Nothing the view shows is read yet, and nothing covers the frame: the run stands where the view is, its region busy.
    expect(covered()).toBeNull();
    expect(ui.row("JOB-10000")).toBeNull();
    expect(main().querySelector("[data-unloaded-run]")).not.toBeNull();
    expect(main().getAttribute("aria-busy")).toBe("true");
    await act(async () => { pages.release(); });
    // The pages land where the view is, each row at its number, and the region is no longer busy.
    await waitFor(() => expect(main().getAttribute("aria-busy")).toBe("false"), { timeout: 10_000 });
    const numbers = ui.rows().map((row) => Number(row.querySelector('[data-slot="gutterNumber"]')!.textContent));
    expect(numbers.length).toBeGreaterThan(0);
    expect(Math.min(...numbers)).toBeGreaterThan(20_000);
    expect(covered()).toBeNull();
});
