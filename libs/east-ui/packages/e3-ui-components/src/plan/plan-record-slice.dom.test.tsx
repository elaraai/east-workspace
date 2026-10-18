/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, StringType, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-records";
import * as records from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { clearPagedApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
import { countWholeReads, recordPaging } from "../platform/record-paging.test-utils.js";
import { act, builderHarness, mount, settle, slot, width } from "../shared/builder-harness.test-utils.js";
import "./index.js";

const WORKSPACE = "plan-indexed-record";
const h = builderHarness(WORKSPACE, [records.indexedWorkOrders], "data-plan-body");
afterEach(() => clearPagedApi());

test("indexed Plan preserves order and hidden operation drafts through Undo, Redo, remount and primary-key Save", async () => {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const reads = countWholeReads(h.cache); initializeRecordApi(reads.serve(h.memory), h.cache, WORKSPACE);
    const record = records.indexedWorkOrders;
    const indexes = [records.indexedWorkByStatusDue, records.indexedWorkByDue, records.indexedWorkByJob, records.indexedWorkByQuantity, records.indexedWorkByUrgent, records.indexedWorkByTag];
    const paging = recordPaging(h.cache, reads.raw, [{ path: record.path, type: record.type, indexes: indexes.map(index => {
        const fn = East.compile(index.keyFn as never, []) as (key: unknown, row: unknown) => unknown;
        return { name: index.name, keyType: index.keyType, keys: (key: unknown, row: unknown) => index.multi ? fn(key, row) as Iterable<unknown> : [fn(key, row)] };
    }) }]);
    initializePagedApi(paging.api, WORKSPACE);
    let ui = mount(ex.planRecordIndexes);
    const bar = () => ui.container.querySelector<HTMLElement>('[data-run="JOB-10000-run"]');
    await waitFor(() => expect(bar()).not.toBeNull()); await settle();
    const first = [...ui.container.querySelectorAll('[data-plan-row] [role="rowheader"]')].map(el => el.textContent);
    expect(first[0]).toContain("JOB-10000");
    expect(first[1]).toContain("JOB-10090");
    bar()!.focus();
    for (const key of [" ", "ArrowRight", " "]) {
        await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key }); });
        await settle();
    }
    await waitFor(() => expect(ui.container.querySelector('[data-plan-row][data-draft]')).not.toBeNull());
    const drafted = bar()!.getAttribute("aria-label");
    const sliceKey = "ex.planRecordIndexes.rows";
    const state = decodeBeast2For(RecordSliceStateType)(store.read(sliceKey)!);
    const hidden = { ...state, preset: none, where: new Map(state.where).set("status", variant("values", [printFor(StringType)("Done")])) };
    await act(async () => { store.write(sliceKey, encodeBeast2For(RecordSliceStateType)(hidden)); });
    await waitFor(() => expect(bar()).toBeNull());
    const action = async (name: string) => {
        await act(async () => { fireEvent.click(within(slot(ui.container, "toolbar")).getByRole("button", { name })); });
        await settle();
    };
    await action("Undo"); await action("Redo");
    await act(async () => { store.write(sliceKey, encodeBeast2For(RecordSliceStateType)(state)); });
    await waitFor(() => expect(bar()?.getAttribute("aria-label")).toBe(drafted));
    await act(async () => { store.write(sliceKey, encodeBeast2For(RecordSliceStateType)(hidden)); });
    await waitFor(() => expect(bar()).toBeNull());
    ui.unmount(); ui = mount(ex.planRecordIndexes); await settle(); await width(390);
    expect(within(slot(ui.container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
    await action("Save");
    await waitFor(() => expect(within(slot(ui.container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true));
    const committed = decodeBeast2For(record.type)(reads.raw(WORKSPACE, record.path)!);
    expect(committed.get("JOB-10000")!.operations[0]!.start).toEqual(new Date("2026-10-02T06:00:00Z"));
    expect(reads.paths).toEqual([]);
    expect(paging.requests.some(request => request.includes('seek "JOB-10000"'))).toBe(true);
    expect(ui.container.querySelector('[data-record-save-notice]')).toBeNull();
});
