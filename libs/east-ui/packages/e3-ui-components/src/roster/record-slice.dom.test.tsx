/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, decodeBeast2For, encodeBeast2For, none, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster-records";
import * as records from "@elaraai/e3-ui/examples/roster/roster";
import { clearPagedApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
import { countWholeReads, recordPaging } from "../platform/record-paging.test-utils.js";
import { act, assignment, mount, rosterHarness, settle, slot, START, width, WORKSPACE } from "./harness.test-utils.js";

const h = rosterHarness();
afterEach(() => clearPagedApi());
test("indexed staff visibility replaces atomically without narrowing coverage, and hidden edits Save the original week on mobile", async () => {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const reads = countWholeReads(h.cache); initializeRecordApi(reads.serve(h.memory), h.cache, WORKSPACE);
    const service = recordPaging(h.cache, reads.raw, [
        { path: records.rosterWeeks.path, type: records.rosterWeeks.type },
        { path: records.rosterStaff.path, type: records.rosterStaff.type,
            indexes: [ex.rosterStaffByName, ex.rosterStaffByTeam, ex.rosterStaffByTrainer, ex.rosterStaffBySkill].map(index => {
                const fn = East.compile(index.keyFn as never, []) as (key: unknown, row: unknown) => unknown;
                return { name: index.name, keyType: index.keyType, keys: (key: unknown, row: unknown) => index.multi ? fn(key, row) as Iterable<unknown> : [fn(key, row)] };
            }),
        },
    ]);
    let delay: Promise<void> | undefined;
    initializePagedApi({ ...service.api, async findKey(...args) { if (delay !== undefined) await delay; return service.api.findKey(...args); } }, WORKSPACE);
    const first = mount(ex.rosterRecordIndexes);
    const { container } = first;
    await waitFor(() => expect(assignment(container, "s37")).not.toBeNull());
    await settle();
    expect(service.requests.some(request => request.includes("index staff_by_team_name"))).toBe(true);
    const marks = () => [...slot(container, "main").querySelectorAll('[role="img"][aria-label]')].map(el => el.getAttribute("aria-label"));
    await act(async () => { fireEvent.click(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" })); });
    await settle();
    const coverage = marks();
    const drafted = assignment(container, "s37");
    expect(drafted.hasAttribute("data-removed")).toBe(true);
    const key = "ex.rosterRecordIndexes.scope";
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    let release = () => {};
    delay = new Promise<void>(resolve => { release = resolve; });
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, where: new Map([["name", variant("prefix", "Z. Nobody")]]), preset: none })); });
    await settle();
    expect(assignment(container, "s37")).toBe(drafted);
    expect(slot(container, "main").querySelector("[data-roster-main]")?.hasAttribute("inert") ?? slot(container, "main").hasAttribute("inert")).toBe(true);
    await act(async () => { delay = undefined; release(); });
    await waitFor(() => expect(assignment(container, "s37")).toBeNull());
    expect(marks()).toEqual(coverage);
    first.unmount();
    const again = mount(ex.rosterRecordIndexes); await settle(); await width(390);
    const save = within(slot(again.container, "toolbar")).getByRole("button", { name: "Save" });
    expect(save).toHaveProperty("disabled", false);
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(within(slot(again.container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true));
    const committed = decodeBeast2For(records.rosterWeeks.type)(reads.raw(WORKSPACE, records.rosterWeeks.path)!);
    expect(committed.get(START)!.assignments.has("s37")).toBe(false);
    expect(committed.get(START)!.assignments.size).toBe(315);
    expect(reads.paths.filter(path => path === "records.roster_weeks")).toEqual([]);
}, 30_000);
