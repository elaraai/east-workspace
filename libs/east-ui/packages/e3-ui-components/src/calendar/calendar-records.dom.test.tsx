/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeType, OptionType, decodeBeast2For, encodeBeast2For, none, printFor, some, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar-records";
import { act, e3Harness, settle, slot, width } from "../e3-web-mount.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";

const h = e3Harness({ "calendar/calendar-records": ex }, { main: "data-calendar-main" });
/** The record, as its dataset's requests name it. */
const EVENTS = "records.indexed_calendar_events";
// The job kind's source of the rail's one Slice.bindRecords (#1343).
const scope = "ex.calendarRecordIndexes.job";
const event = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind: "job", key }))}]`);
const card = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-calendar-card=${JSON.stringify(eventKey({ kind: "job", key }))}]`);

test("indexed Calendar preserves overlaps, replaces windows atomically, and saves a hidden draft by its original key on mobile", async () => {
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const { container } = await h.mount(ex.calendarRecordIndexes, { storageKey: "calendar-record-test" });
    await waitFor(() => expect(event(container, "job")).not.toBeNull());
    await settle();
    expect(event(container, "carry")).not.toBeNull();
    expect(event(container, "long")).not.toBeNull();
    expect(event(container, "done")).toBeNull();
    expect(container.querySelectorAll('[data-calendar-event]')).toHaveLength(3);
    // The 12,000 events are read through their indexes' key searches and pages, never whole.
    expect(h.requests("read", EVENTS)).toEqual([]);
    expect(h.requests("find", EVENTS).length).toBeGreaterThan(0);
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
    // The next narrowing's key searches held in flight: the window it replaces stays, busy.
    const searches = h.e3.hold(request => request.kind === "find" && request.dataset === EVENTS);
    const heldJob = event(container, "job");
    const state = read();
    const where = new Map(state.where);
    where.delete("status"); where.set("machine", variant("values", ['"press-b"']));
    await act(async () => { store.write(scope, encodeBeast2For(RecordSliceStateType)({ ...state, where, preset: none })); });
    await searches.holding;
    await settle();
    expect(event(container, "job")).toBe(heldJob);
    expect(container.querySelector('[data-calendar-main]')?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[data-calendar-main]')?.hasAttribute("inert")).toBe(true);
    await act(async () => { searches.release(); });
    await waitFor(() => expect(event(container, "job")).toBeNull());
    expect(event(container, "long")).not.toBeNull();
    await width(390);
    expect(card(container, "long")).not.toBeNull();
    expect(card(container, "job")).toBeNull();
    const save = within(slot(container, "toolbar")).getByRole("button", { name: "Save" });
    expect(save).toHaveProperty("disabled", false);
    // Save is disabled while its patch is in flight: what e3 holds is read once the patch and the confirming reads are done.
    await act(async () => { fireEvent.click(save); });
    await settle();
    expect(h.requests("mutate", "indexed_calendar_events").map(request => request.name)).toEqual(["patch"]);
    expect(slot(container, "toolbar").textContent).not.toContain("Saving");
    expect(within(slot(container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    const committed = await h.read(ex.indexedCalendarEvents);
    expect(committed.get("job")?.status).toBe("Done");
    expect(committed.size).toBe(12000);
    // The hidden draft was found by its original key.
    expect(h.requests("find", EVENTS).some(request => request.query.get("key") === '"job"')).toBe(true);
    expect(container.querySelector('[data-record-save-notice]')).toBeNull();
    await act(async () => { store.write(scope, encodeBeast2For(RecordSliceStateType)(state)); });
    await settle();
    expect(card(container, "job")).toBeNull();
    expect(card(container, "carry")).not.toBeNull();
    expect(card(container, "long")).not.toBeNull();
    expect(h.requests("read", EVENTS)).toEqual([]);
});
