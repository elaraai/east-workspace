/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { StringType, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-records";
import * as records from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { act, e3Harness, settle, slot, width } from "../e3-web-mount.test-utils.js";
import "./index.js";

const h = e3Harness({ "plan/plan-records": ex, "sheet/sheet-records": records }, { main: "data-plan-body" });
/** The work orders' record, as its dataset's requests name it. */
const ORDERS = `records.${records.indexedWorkOrders.name}`;

test("indexed Plan preserves order and hidden operation drafts through Undo, Redo, remount and primary-key Save", async () => {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const record = records.indexedWorkOrders;
    let ui = await h.mount(ex.planRecordIndexes);
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
    ui.unmount(); ui = await h.mount(ex.planRecordIndexes); await width(390);
    expect(within(slot(ui.container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
    // Save is disabled while its patch is in flight: what e3 holds is read once the patch and the confirming reads are done.
    await action("Save");
    expect(h.requests("mutate", record.name).map(request => request.name)).toEqual(["patch"]);
    expect(within(slot(ui.container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    const committed = await h.read(record);
    expect(committed.get("JOB-10000")!.operations[0]!.start).toEqual(new Date("2026-10-02T06:00:00Z"));
    // Read through its indexes' searches and pages and by its keys: nothing is read whole.
    expect(h.requests("read")).toEqual([]);
    expect(h.requests("find", ORDERS).some(request => request.query.get("key") === '"JOB-10000"')).toBe(true);
    expect(ui.container.querySelector('[data-record-save-notice]')).toBeNull();
});
