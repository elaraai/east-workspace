/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeType, East, OptionType, decodeBeast2For, encodeBeast2For, none, printFor, some, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar-records";
import { clearPagedApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
import { countWholeReads, recordPaging } from "../platform/record-paging.test-utils.js";
import { act, builderHarness, mount, settle, slot, width } from "../shared/builder-harness.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";

const WORKSPACE = "calendar-record-slice";
const h = builderHarness(WORKSPACE, [ex.indexedCalendarEvents, ex.indexedCalendarMachines], "data-calendar-main");
afterEach(() => clearPagedApi());
const scope = "ex.calendarRecordIndexes.scope";
const event = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind: "job", key }))}]`);
const card = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-calendar-card=${JSON.stringify(eventKey({ kind: "job", key }))}]`);

test("indexed Calendar preserves overlaps, replaces windows atomically, and saves a hidden draft by its original key on mobile", async () => {
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const reads = countWholeReads(h.cache);
    initializeRecordApi(reads.serve(h.memory), h.cache, WORKSPACE);
    const indexes = [ex.indexedCalendarByTime, ex.indexedCalendarByStatus, ex.indexedCalendarByMachine];
    const service = recordPaging(h.cache, reads.raw, [{ path: ex.indexedCalendarEvents.path, type: ex.indexedCalendarEvents.type,
        indexes: indexes.map(index => {
            const keys = East.compile(index.keyFn as never, []) as (key: unknown, row: unknown) => Iterable<unknown>;
            return { name: index.name, keyType: index.keyType, keys };
        }),
    }]);
    let delay: Promise<void> | undefined;
    initializePagedApi({ ...service.api, async findKey(...args) { if (delay !== undefined) await delay; return service.api.findKey(...args); } }, WORKSPACE);
    const { container } = mount(ex.calendarRecordIndexes, "calendar-record-test");
    await waitFor(() => expect(event(container, "job")).not.toBeNull());
    await settle();
    expect(event(container, "carry")).not.toBeNull();
    expect(event(container, "long")).not.toBeNull();
    expect(event(container, "done")).toBeNull();
    expect(container.querySelectorAll('[data-calendar-event]')).toHaveLength(3);
    expect(reads.paths.filter(path => path === "records.indexed_calendar_events")).toEqual([]);
    const read = () => decodeBeast2For(RecordSliceStateType)(store.read(scope)!);
    // Navigation writes exactly the same half-open range that the field editor reads.
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Next day" })); });
    await waitFor(() => expect(event(container, "next")).not.toBeNull());
    expect(event(container, "carry")).toBeNull();
    expect(event(container, "long")).not.toBeNull();
    const time = printFor(OptionType(DateTimeType));
    expect(read().where.get("start")).toEqual(variant("range", { from: time(some(new Date("2026-10-03T00:00:00Z"))), to: time(some(new Date("2026-10-04T00:00:00Z"))) }));
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Previous day" })); });
    await waitFor(() => expect(event(container, "job")).not.toBeNull());
    await act(async () => { fireEvent.click(event(container, "job")!); });
    await settle();
    const user = userEvent.setup();
    const status = slot(container, "end").querySelector<HTMLInputElement>('[data-field="status"] input')!;
    expect(status).not.toBeNull();
    await user.clear(status); await user.type(status, "Done{Enter}"); await settle();
    expect(event(container, "job")).not.toBeNull();
    let release = () => {};
    delay = new Promise<void>(resolve => { release = resolve; });
    const heldJob = event(container, "job");
    const state = read();
    const where = new Map(state.where);
    where.delete("status"); where.set("machine", variant("values", ['"press-b"']));
    await act(async () => { store.write(scope, encodeBeast2For(RecordSliceStateType)({ ...state, where, preset: none })); });
    await settle();
    expect(event(container, "job")).toBe(heldJob);
    expect(container.querySelector('[data-calendar-main]')?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[data-calendar-main]')?.hasAttribute("inert")).toBe(true);
    await act(async () => { delay = undefined; release(); });
    await waitFor(() => expect(event(container, "job")).toBeNull());
    expect(event(container, "long")).not.toBeNull();
    await width(390);
    expect(card(container, "long")).not.toBeNull();
    expect(card(container, "job")).toBeNull();
    const save = within(slot(container, "toolbar")).getByRole("button", { name: "Save" });
    expect(save).toHaveProperty("disabled", false);
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(within(slot(container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true));
    const committed = decodeBeast2For(ex.indexedCalendarEvents.type)(reads.raw(WORKSPACE, ex.indexedCalendarEvents.path)!);
    expect(committed.get("job")?.status).toBe("Done");
    expect(committed.size).toBe(6);
    expect(service.requests.some(request => request.includes('seek "job"'))).toBe(true);
    expect(container.querySelector('[data-record-save-notice]')).toBeNull();
    await act(async () => { store.write(scope, encodeBeast2For(RecordSliceStateType)(state)); });
    await settle();
    expect(card(container, "job")).toBeNull();
    expect(card(container, "carry")).not.toBeNull();
    expect(card(container, "long")).not.toBeNull();
    expect(reads.paths.filter(path => path === "records.indexed_calendar_events")).toEqual([]);
}, 30_000);
