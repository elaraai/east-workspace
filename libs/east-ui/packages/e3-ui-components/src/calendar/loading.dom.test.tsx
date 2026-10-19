/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, expect, test, vi } from "vitest";
import { DateTimeType, SetType, StringType, variant, type EastIR } from "@elaraai/east";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { clearPagedApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
import { countWholeReads, recordPaging } from "../platform/record-paging.test-utils.js";
import { act, calendarHarness, card, event, mount, settle, slot, width, WORKSPACE } from "./harness.test-utils.js";
import * as views from "./views.js";
const h = calendarHarness();
const platforms = getRegisteredPlatformImplementations();
afterEach(() => clearPagedApi());
for (const mainWidth of [900, 390]) test(`Calendar waits for scheduled and backlog pages before revealing its frame at ${mainWidth}px`, async () => {
    const renderView = vi.spyOn(views, "CalendarViews");
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
    let releaseDays!: () => void, releaseBacklog!: () => void;
    const daysReady = new Promise<void>(resolve => { releaseDays = resolve; });
    const backlogReady = new Promise<void>(resolve => { releaseBacklog = resolve; });
    initializePagedApi({ ...service.api, getPage: async (...args) => {
        await (args[2].index === ex.calendarJobsUnscheduled.name ? backlogReady : daysReady);
        return service.api.getPage(...args);
    } }, WORKSPACE);
    const { container } = mount(ex.calendarWindowed); await settle(); await width(mainWidth);
    const frame = container.querySelector('[data-builder-frame]')!;
    const canvas = slot(container, "main").firstElementChild!.firstElementChild;
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[data-builder-loading]')).not.toBeNull();
    expect(slot(container, "body").hasAttribute("inert")).toBe(true);
    expect(slot(container, "body").getAttribute("aria-hidden")).toBe("true");
    const pendingRenders = renderView.mock.calls.length;
    await act(async () => { releaseDays(); }); await settle();
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(slot(container, "body").getAttribute("aria-hidden")).toBe("true");
    expect(renderView).toHaveBeenCalledTimes(pendingRenders);
    await act(async () => { releaseBacklog(); }); await settle();
    expect(container.querySelector('[data-builder-frame]')).toBe(frame);
    expect(frame.getAttribute("aria-busy")).toBe("false");
    expect(slot(container, "main").firstElementChild!.firstElementChild).toBe(canvas);
    expect(container.querySelector('[data-builder-loading]')).toBeNull();
    expect(renderView.mock.calls.length).toBeGreaterThan(pendingRenders);
    expect((mainWidth < 480 ? card : event)(container, "job", "job1")).not.toBeNull();
    expect(reads.paths.filter(p => p === "records.calendar_jobs")).toEqual([]);
});
