/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, PatchType, applyFor, decodeBeast2For, type EastIR } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, defaultPagedRuntime, initializePagedApi, initializeReactiveDatasetCache, initializeRecordApi, type DatasetApi } from "../platform/index.js";
import { countWholeReads, recordPaging } from "../platform/record-paging.test-utils.js";
import { boundFrame, frameScrolls } from "./frame.test-utils.js";
import "./frame/index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
});
let restore = () => {};
afterEach(() => { cleanup(); restore(); defaultPagedRuntime.clear(); localStorage.clear(); });

async function settle() {
    await act(async () => { for (let i = 0; i < 6; i++) await new Promise<void>(resolve => setTimeout(resolve, 0)); });
}

function setup() {
    const ws = "sheet-indexed-record";
    StateRuntime.initializeStore(new UIStore());
    const restoreFrame = boundFrame(2000);
    const restoreScroll = frameScrolls();
    restore = () => { restoreScroll(); restoreFrame(); };
    const values = new Map<string, Uint8Array>();
    const api: DatasetApi = {
        async get(workspace, path) { const data = values.get(datasetCacheKey(workspace, path)); if (!data) throw new Error("missing dataset"); return { data, hash: null }; },
        async set(workspace, path, value) { values.set(datasetCacheKey(workspace, path), value); },
        async launchDataflow() {}, async listRoot() { return []; }, async listAt() { return []; }, async workspaceStatus() { return { datasets: [] }; },
    };
    const cache = new ReactiveDatasetCache({ workspace: ws }, api);
    cache.setScheduler(notify => queueMicrotask(notify));
    initializeReactiveDatasetCache(cache);
    const record = ex.indexedWorkOrders;
    const patch = applyFor(record.type);
    const memory = createInMemoryRecordApi(cache, ws, [{ name: record.name, stateType: record.type, initial: record.default!,
        mutations: [{ name: "patch", argTypes: [PatchType(record.type)], reduce: (before, diff) => patch(before as never, diff as never) }] }]);
    const reads = countWholeReads(cache);
    initializeRecordApi(reads.serve(memory), cache, ws);
    const indexes = [ex.indexedWorkByStatusDue, ex.indexedWorkByDue, ex.indexedWorkByJob, ex.indexedWorkByQuantity, ex.indexedWorkByUrgent, ex.indexedWorkByTag];
    const paging = recordPaging(cache, reads.raw, [{ path: record.path, type: record.type, indexes: indexes.map(index => {
        const keys = East.compile(index.keyFn as never, []) as (key: unknown, row: unknown) => unknown;
        return { name: index.name, keyType: index.keyType, keys: (key: unknown, row: unknown) => index.multi ? keys(key, row) as Iterable<unknown> : [keys(key, row)] };
    }) }]);
    initializePagedApi(paging.api, ws);
    const program = (ex.sheetRecordIndexes.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
    const ui = render(<ChakraProvider value={system}><EastChakraComponent value={program()} storageKey="indexed-sheet-test" /></ChakraProvider>);
    const rows = () => [...ui.container.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')];
    const row = (id: string) => ui.container.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`);
    const tab = (id: string) => ui.container.querySelector<HTMLElement>(`[data-slot="tab"][data-tab="${id}"]`)!;
    return { ...ui, ws, record, memory, reads, paging, rows, row, tab };
}

test("indexed Sheet keeps source order, restores saved narrowing and saves hidden drafts by original primary key", async () => {
    const ui = setup();
    await waitFor(() => expect(ui.row("JOB-10000")).not.toBeNull());
    await settle();
    const ids = () => ui.rows().map(row => row.dataset.rowId);
    const initialIds = ids();
    expect(initialIds.slice(0, 3)).toEqual(["JOB-10000", "JOB-10090", "JOB-10180"]);
    expect(ui.tab("all").textContent).toContain("50,000");
    expect(ui.container.querySelector('[data-slot="contextOption"]')).toBeNull();
    expect(ui.reads.paths).toEqual([]);

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
    const stored = decodeBeast2For(ui.record.type)(ui.reads.raw(ui.ws, ui.record.path)!);
    expect(stored.get("JOB-10000")?.status).toBe("Scheduled");
    expect((await ui.memory.history(ui.ws, ui.record.name, undefined)).commits.map(commit => commit.mutation)).toEqual(["patch", "$init"]);
    expect(ui.reads.paths, "neither narrowing nor confirmation reads the record whole").toEqual([]);
    expect(ui.paging.requests.some(request => request.includes('seek "JOB-10000"'))).toBe(true);
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
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ui.container.querySelector('[data-record-save-notice]')?.textContent).toBe("1 row left this view"));
    expect(ui.row(leavingId)).toBeNull();
    expect(decodeBeast2For(ui.record.type)(ui.reads.raw(ui.ws, ui.record.path)!).get(leavingId)?.status).toBe("Scheduled");
    expect(ui.tab("view-1").querySelector('[data-slot="tabCount"]')?.textContent).toBe("16,665");
    expect(ui.reads.paths).toEqual([]);
    fireEvent.mouseDown(ui.tab("all"), { button: 0 });
    await settle();
    expect(ui.container.querySelector('[data-record-save-notice]')).toBeNull();
});
