/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, calendarHarness, card, event, settle, slot, width } from "./harness.test-utils.js";
import * as views from "./views.js";
const h = calendarHarness();
/** A read of the jobs' record — a page, a key search, a read of runs or of rows by key (#1351) — through any of its indexes. */
const READS = new Set(["page", "find", "runs", "rows"]);
const jobRead = (request: E3Request) => READS.has(request.kind) && request.dataset === "records.calendar_jobs";
for (const mainWidth of [900, 390]) test(`Calendar waits for scheduled and backlog pages before revealing its frame at ${mainWidth}px`, async () => {
    const renderView = vi.spyOn(views, "CalendarViews");
    // The day index's rows and the backlog index's — a page of them, or a read of several runs (#1351) — each held on its way to e3
    // until the test lets it land.
    const rowsOf = (index: string) => (request: { kind: string; query: URLSearchParams }) =>
        (request.kind === "page" || request.kind === "runs") && request.query.get("index") === index;
    const days = h.e3.hold(rowsOf(ex.calendarJobsByDay.name));
    const backlog = h.e3.hold(rowsOf(ex.calendarJobsUnscheduled.name));
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

test("a period whose read fails once the window has shown says so in the footer's loading line, in the read's own words — no `Error:` before them — with Retry; Retry, the fault gone, asks e3 again and the period lands (#1398, CL3)", async () => {
    const { container } = await h.mount(ex.calendarWindowed);
    await settle();
    const line = () => slot(container, "footer").querySelector<HTMLElement>("[data-footer-line]")!;
    // Every read of the jobs fails from now on, as e3 fails one, for a reason a retry can fix.
    const stop = h.e3.fail(jobRead, { status: 500, type: "internal", message: "the store is down" });
    // Past the period read ahead, to one not read: its read fails.
    const next = () => within(slot(container, "toolbar")).getByRole("button", { name: /^Next (day|week|month)$/ });
    await act(async () => { fireEvent.click(next()); }); await settle();
    await act(async () => { fireEvent.click(next()); }); await settle();
    await waitFor(() => expect(line().hasAttribute("data-failed")).toBe(true), { timeout: 15_000 });
    expect(line().getAttribute("title")).toContain("the store is down");
    expect(line().getAttribute("title")).not.toMatch(/^Error: /);
    stop();
    const before = h.requests().filter(jobRead).length;
    await act(async () => { fireEvent.click(line().querySelector("[data-line-retry]")!); });
    await settle();
    await waitFor(() => expect(line().hasAttribute("data-idle")).toBe(true), { timeout: 15_000 });
    expect(h.requests().filter(jobRead).length).toBeGreaterThan(before);
});
