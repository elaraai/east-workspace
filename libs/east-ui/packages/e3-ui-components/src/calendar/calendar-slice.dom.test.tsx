/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

/** Author-bound Slice changes reach record rows and index reads, not a renderer-owned copy. */
import { afterEach, describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeType, East, NullType, SetType, StringType, some, variant, type EastIR } from "@elaraai/east";
import { SliceBindPrimitives } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { clearPagedApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
import { countWholeReads, recordPaging } from "../platform/record-paging.test-utils.js";
import { act, calendarHarness, card, event, mount, settle, slot, width, WORKSPACE } from "./harness.test-utils.js";

const h = calendarHarness();
const platforms = getRegisteredPlatformImplementations();
// The very primitives each bound handle calls: another control writes the
// same author-owned Slice without touching Calendar's component state.
const search = East.compile(East.function([StringType], NullType, ($, text) => {
    $(SliceBindPrimitives.setSearch("ex.calendarOperations.scope", some(text)));
}), platforms);
const peopleOnly = East.compile(East.function([], NullType, $ => {
    $(SliceBindPrimitives.addFilter("ex.calendarOperations.scope", variant("string", { fieldId: "resourceKind", op: variant("eq", "People") })));
}), platforms);
const range = East.compile(East.function([DateTimeType, DateTimeType], NullType, ($, from, to) => {
    $(SliceBindPrimitives.setRange("ex.calendarWindowed.days", some(variant("datetime", { from, to }))));
}), platforms);
const readRange = East.compile(East.function([], DateTimeType, _$ =>
    SliceBindPrimitives.read("ex.calendarWindowed.days").range.unwrap("some").unwrap("datetime").from), platforms);
afterEach(() => clearPagedApi());

describe("Calendar's author-bound Slice", () => {
    test("external Slice writes and toolbar search share typed filtering; a hidden draft still saves to its original key", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        await act(async () => { search("Mounting"); }); await settle();
        expect(within(slot(container, "toolbar")).getByPlaceholderText("Search…")).toHaveProperty("value", "Mounting");
        expect(container.querySelectorAll('[data-calendar-event]')).toHaveLength(2);
        await act(async () => { fireEvent.click(event(container, "job", "job1")); }); await settle();
        const user = userEvent.setup();
        const title = slot(container, "end").querySelector<HTMLInputElement>('[data-field="title"] input')!;
        await user.clear(title); await user.type(title, "Revised brackets{Enter}"); await settle();
        expect(event(container, "job", "job1")).toBeNull();
        expect(h.read(ex.calendarJobs).get("job1")!.title).toBe("Mounting brackets · batch 42");
        await width(390);
        expect(container.querySelectorAll('[data-calendar-card]')).toHaveLength(1);
        await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Save" })); }); await settle();
        expect(h.read(ex.calendarJobs).get("job1")!.title).toBe("Revised brackets");
        const input = within(slot(container, "toolbar")).getByPlaceholderText("Search…");
        await user.clear(input); await settle();
        expect(card(container, "job", "job1")?.textContent).toContain("Revised brackets");
        expect(h.read(ex.calendarJobs).size).toBe(10);
    });

    test("the author's Slice scopes resource columns and event kinds together, with the original resource keys", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        await act(async () => { peopleOnly(); }); await settle();
        expect(event(container, "job", "job1")).toBeNull();
        expect(event(container, "service", "service1")).toBeNull();
        expect(event(container, "shift", "shift1")).not.toBeNull();
        await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name: "Resources" })); }); await settle();
        const labels = [...container.querySelectorAll('[data-calendar-resource-title]')].map(node => node.textContent?.trim());
        expect(labels).toContain(h.read(ex.calendarPeople).get("ash")!.name);
        expect(labels).not.toContain(h.read(ex.calendarMachines).get("press1")!.name);
        await width(390);
        expect(card(container, "shift", "shift1")).not.toBeNull();
        expect(card(container, "job", "job1")).toBeNull();
    });

    test("Slice range and navigation seek day-index keys; selection and Save read by key without downloading the record", async () => {
        const reads = countWholeReads(h.cache);
        initializeRecordApi(reads.serve(h.memory), h.cache, WORKSPACE);
        const days = (ex.calendarJobsByDay.keyFn.toIR() as EastIR<[StringType, typeof ex.CalendarJob], SetType<DateTimeType>>).compile(platforms);
        const backlog = (ex.calendarJobsUnscheduled.keyFn.toIR() as EastIR<[StringType, typeof ex.CalendarJob], SetType<typeof ex.calendarJobsUnscheduled.keyType>>).compile(platforms);
        const service = recordPaging(h.cache, reads.raw, [{
            path: [variant("field", "records"), variant("field", ex.calendarJobs.name)], type: ex.calendarJobs.type,
            indexes: [
                { name: ex.calendarJobsByDay.name, keyType: DateTimeType, keys: (key, row) => days(key as Parameters<typeof days>[0], row as Parameters<typeof days>[1]) },
                { name: ex.calendarJobsUnscheduled.name, keyType: ex.calendarJobsUnscheduled.keyType, keys: (key, row) => backlog(key as Parameters<typeof backlog>[0], row as Parameters<typeof backlog>[1]) },
            ],
        }]);
        initializePagedApi(service.api, WORKSPACE);
        const { container } = mount(ex.calendarWindowed); await settle();
        expect(event(container, "job", "job1")).not.toBeNull();
        expect(service.requests.some(request => request.includes("index calendar_jobs_by_day seek 2026-10-01"))).toBe(true);
        await act(async () => { range(new Date("2026-10-02T00:00:00Z"), new Date("2026-10-02T23:59:59.999Z")); }); await settle();
        expect(service.requests.some(request => request.includes("index calendar_jobs_by_day seek 2026-10-02"))).toBe(true);
        expect(event(container, "job", "job1")).toBeNull(); expect(event(container, "job", "job4")).not.toBeNull();
        await width(390); expect(card(container, "job", "job4")).not.toBeNull();
        await width(900);
        await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Previous period" })); }); await settle();
        expect(readRange()).toEqual(new Date("2026-10-01T00:00:00Z"));
        await act(async () => { fireEvent.click(event(container, "job", "job1")); }); await settle();
        const input = slot(container, "end").querySelector<HTMLInputElement>('[data-field="customer"] input')!;
        const user = userEvent.setup(); await user.clear(input); await user.type(input, "Scoped customer{Enter}"); await settle();
        await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: "Save" })); }); await settle();
        expect(service.requests.some(request => request.includes('seek "job1"'))).toBe(true);
        expect(service.requests.some(request => /page \d+\+1$/.test(request))).toBe(true);
        expect(reads.paths.filter(path => path === "records.calendar_jobs")).toEqual([]);
        expect(slot(container, "end").querySelector<HTMLInputElement>('[data-field="customer"] input')!.value).toBe("Scoped customer");
    });
});
