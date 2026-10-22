/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test, vi } from "vitest";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { act, calendarHarness, card, event, settle, slot, width } from "./harness.test-utils.js";
import * as views from "./views.js";
const h = calendarHarness();
for (const mainWidth of [900, 390]) test(`Calendar waits for scheduled and backlog pages before revealing its frame at ${mainWidth}px`, async () => {
    const renderView = vi.spyOn(views, "CalendarViews");
    // The day index's pages and the backlog index's, each held on its way to e3 until the test lets it land.
    const days = h.e3.hold(request => request.kind === "page" && request.query.get("index") === ex.calendarJobsByDay.name);
    const backlog = h.e3.hold(request => request.kind === "page" && request.query.get("index") === ex.calendarJobsUnscheduled.name);
    const { container } = await h.mount(ex.calendarWindowed); await width(mainWidth);
    const frame = container.querySelector('[data-builder-frame]')!;
    const canvas = slot(container, "main").firstElementChild!.firstElementChild;
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[data-builder-loading]')).not.toBeNull();
    expect(slot(container, "body").hasAttribute("inert")).toBe(true);
    expect(slot(container, "body").getAttribute("aria-hidden")).toBe("true");
    const pendingRenders = renderView.mock.calls.length;
    await act(async () => { days.release(); }); await settle();
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(slot(container, "body").getAttribute("aria-hidden")).toBe("true");
    expect(renderView).toHaveBeenCalledTimes(pendingRenders);
    await act(async () => { backlog.release(); }); await settle();
    expect(container.querySelector('[data-builder-frame]')).toBe(frame);
    expect(frame.getAttribute("aria-busy")).toBe("false");
    expect(slot(container, "main").firstElementChild!.firstElementChild).toBe(canvas);
    expect(container.querySelector('[data-builder-loading]')).toBeNull();
    expect(renderView.mock.calls.length).toBeGreaterThan(pendingRenders);
    expect((mainWidth < 480 ? card : event)(container, "job", "job1")).not.toBeNull();
    expect(h.requests("read", "records.calendar_jobs")).toEqual([]);
});
