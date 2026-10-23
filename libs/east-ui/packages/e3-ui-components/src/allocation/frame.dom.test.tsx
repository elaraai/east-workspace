/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board in its frame (#1325, #1372): the toolbar's items, the day's
 * status and its banners, the day stepping and the picker's marks, Publish,
 * the footer's legend, the loading cover and the days either side read ahead
 * (#1398) — over the kiln yard's own records: its bins, and its days, whose
 * row says a day's status.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { DateTimeType, equalFor, none, printFor, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import type { E3Request } from "../e3-web.test-utils.js";
import { issueSummary } from "./toolbar.js";
import type { Issue } from "./model.js";
import { act, allocationHarness, settle, slot, THU, TUE, TUE_4, WED } from "./harness.test-utils.js";

const h = allocationHarness();
/** The bins and the days the windowed board reads a day at a time, as the request log names their datasets. */
const BINS = `records.${ex.kilnBinHistory.name}`, DAYS = `records.${ex.yardDayHistory.name}`;
/** A read of the bins or of the days — a page, a key search, a read of runs or of rows by key (#1351). */
const READS = new Set(["page", "find", "runs", "rows"]);
const dayRead = (request: E3Request) => READS.has(request.kind) && (request.dataset === BINS || request.dataset === DAYS);
const day = printFor(DateTimeType);
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const status = (c: HTMLElement) => c.querySelector("[data-allocation-status]")?.textContent;
const shownDay = (c: HTMLElement) => Number(c.querySelector("[data-allocation-main]")!.getAttribute("data-allocation-day"));

describe("the board's frame", () => {
    test("A1 — one toolbar: the date, the layout (Table, then Timeline), the day's status, the history and Publish", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        const bar = toolbar(container);
        expect(bar.getByRole("button", { name: "Choose plan day" })).toBeTruthy();
        expect(bar.getAllByRole("radio").map(r => r.textContent)).toEqual(["Table", "Timeline"]);
        expect(status(container)).toBe("Draft");
        expect(bar.getByRole("button", { name: editingMessages.apply() })).toBeTruthy();
        expect(bar.getByRole("button", { name: "Publish" })).toBeTruthy();
    });

    test("A2 — [ and ] step one day; the arrows step a day", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        expect(shownDay(container)).toBe(TUE.getTime());
        await key(container, "]");
        expect(shownDay(container)).toBe(TUE.getTime() + 86_400_000);
        await key(container, "["); await key(container, "[");
        expect(shownDay(container)).toBe(TUE.getTime() - 86_400_000);
        await press(toolbar(container).getByRole("button", { name: "Next day" }));
        expect(shownDay(container)).toBe(TUE.getTime());
    });

    test("A2 — the picker marks each day of its open month Published · Draft · Not started", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        await press(toolbar(container).getByRole("button", { name: "Choose plan day" }));
        const picker = within(document.body).getByRole("dialog");
        const mark = (date: Date) => picker.querySelector(`[data-time-day="${date.getTime()}"] [data-state]`)?.getAttribute("data-state");
        expect(mark(TUE_4)).toBe("published");
        expect(mark(TUE)).toBe("draft");
        expect(mark(THU)).toBe("empty");
        expect(picker.textContent).toContain("Published · Draft · Not started");
    });

    test("A2 — read a day at a time, the picker marks each day of the month it browses to, the month read as one run of keys", async () => {
        const { container } = await h.mount(ex.allocationWindowed);
        await press(toolbar(container).getByRole("button", { name: "Choose plan day" }));
        const picker = within(document.body).getByRole("dialog");
        const marks = () => [...picker.querySelectorAll("[data-time-day]")].map(d => d.querySelector("[data-state]")?.getAttribute("data-state"));
        // May's weeks, Mon 26 Apr to Sun 6 Jun: published to Mon 10, the draft on Tue 11, not started from Wed 12.
        expect(marks()).toEqual([...Array(15).fill("published"), "draft", ...Array(26).fill("empty")]);
        // April's, Mon 29 Mar to Sun 2 May, every day published: 35 days, more than the runtime keeps windows of, read a window a day.
        const before = h.requests().length;
        const history = () => h.requests().slice(before).filter(r => r.dataset === "records.yard_day_history");
        fireEvent.click(within(picker).getByRole("button", { name: "Previous month" }));
        // Counted before anything waits on a timer: reads that evict each other never stop asking, and their landings starve every timer.
        for (let i = 0; i < 100; i++) await Promise.resolve();
        expect(history().length).toBeLessThanOrEqual(2);
        await settle();
        expect(marks()).toEqual(Array(35).fill("published"));
        // One search for the month's run of keys, and one page of it.
        expect(history().filter(r => r.kind === "find").length).toBe(1);
        expect(history().filter(r => r.kind === "page").map(r => r.query.get("limit"))).toEqual(["35"]);
    });

    test("A3 — a day with no row and no bins is Not started, under the banner `Day not started`", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        expect(container.textContent).not.toContain("Day not started");
        await key(container, "]"); await key(container, "]");
        expect(shownDay(container)).toBe(THU.getTime());
        expect(status(container)).toBe("Not started");
        expect(container.textContent).toContain("Day not started");
    });

    test("A4 — Publish writes the day's row issued, its bins as they were; a published day is read-only under its banner", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        const bins = await h.read(ex.kilnBins);
        await press(toolbar(container).getByRole("button", { name: "Publish" }));
        // No draft to save: the day's row alone, issued, one patch of the days.
        expect(h.requests("mutate").map(r => r.record)).toEqual([ex.yardDays.name]);
        expect((await h.read(ex.yardDays)).get(TUE)!.state.type).toBe("issued");
        expect(equalFor(ex.kilnBins.type)(await h.read(ex.kilnBins), bins)).toBe(true);
        expect(status(container)).toBe("Published");
        expect(container.textContent).toContain("Published day");
        expect(container.textContent).toContain("Read-only view of the published plan.");
        expect(container.querySelector("[data-allocation-readonly]")).not.toBeNull();
        expect(toolbar(container).queryByRole("button", { name: "Publish" })).toBeNull();
        expect(toolbar(container).queryByRole("button", { name: editingMessages.apply() })).toBeNull();
    });

    test("A4 — the published example's day, Tue 4, opens read-only", async () => {
        const { container } = await h.mount(ex.allocationPublished);
        expect(shownDay(container)).toBe(TUE_4.getTime());
        expect(status(container)).toBe("Published");
        expect(container.querySelector("[data-allocation-readonly]")).not.toBeNull();
    });

    test("without `periods`: no status chip and no Publish", async () => {
        const { container } = await h.mount(ex.allocationNoPublish);
        expect(container.querySelector("[data-allocation-status]")).toBeNull();
        expect(toolbar(container).queryByRole("button", { name: "Publish" })).toBeNull();
        expect(toolbar(container).getByRole("button", { name: editingMessages.apply() })).toBeTruthy();
    });

    test("A79 — the footer is the layout's legend only", async () => {
        const { container } = await h.mount(ex.allocationKilnYard);
        const items = () => [...slot(container, "footer").querySelectorAll("[data-allocation-legend]")].map(i => i.textContent);
        expect(items()).toEqual(["Bin", "Draft", "Today's load", "Prior job", "Next job", "Overlap", "Link", "Draft link"]);
        await press(toolbar(container).getByRole("radio", { name: "Table" }));
        expect(items()).toEqual(["Arrival or resource", "Draft", "Empty · drop here", "Reserved", "Free"]);
    });

    test("A80 — the frame is covered until the active day resolves, a day at a time through the window", async () => {
        const { container } = await h.mount(ex.allocationWindowed);
        // The day resolved: the frame's main is not busy, and the footer's loading line says nothing (#1398).
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
        expect(slot(container, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true);
        expect(shownDay(container)).toBe(TUE.getTime());
        expect(day(TUE)).toContain("2027-05-11");
    });

    test("#1398, CL6, CL7 — once its day has landed, the board reads the days either side ahead: a step to the next shows it at once with every read held, and asks for the day after it; a step back drops that read, each of its requests aborted on its way to e3", async () => {
        const { container } = await h.mount(ex.allocationWindowed);
        // From now on every read of the bins and the days is held on its way to e3.
        const held = h.e3.hold(dayRead);
        const before = h.requests().length;
        await key(container, "]");
        // The day stepped to was read before the step: nothing covers the frame, its main is not busy, and the footer's line says nothing.
        expect(shownDay(container)).toBe(WED.getTime());
        expect(container.querySelector("[data-builder-loading]")).toBeNull();
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
        expect(slot(container, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true);
        // What it asks now is the day after it, read ahead in turn: on its way, none given up.
        const ahead = h.requests().slice(before).filter(dayRead);
        expect(ahead.length).toBeGreaterThan(0);
        expect(ahead.some(request => request.signal.aborted)).toBe(false);
        // Back at the day it opened on, its neighbours read already: nothing reads the day after the next any more, and every request for it is aborted.
        await key(container, "[");
        expect(shownDay(container)).toBe(TUE.getTime());
        expect(ahead.every(request => request.signal.aborted)).toBe(true);
        expect(container.querySelector("[data-builder-loading]")).toBeNull();
        expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
        await act(async () => { held.release(); });
        await settle();
    });

    test("A81 — the issues chip's words: its count of warnings and dangers, its breakdown and `show them`", () => {
        const issue = (kind: "overlap" | "over" | "under", tone: "warning" | "danger" | "neutral") => ({
            kind: variant(kind, null), tone: variant(tone, null), title: "", detail: "", bin: none, resource: none, flag: none, fix: none,
        }) as Issue;
        const custom = { ...issue("over", "neutral"), kind: variant("custom", "Spec mismatch") } as Issue;
        expect(issueSummary([issue("overlap", "warning"), issue("overlap", "warning"), issue("over", "danger"), custom])).toEqual({
            count: 3, label: "3 issues", tip: "2 overlaps · 1 over max · show them", aria: "3 issues, show them",
        });
        expect(issueSummary([issue("under", "warning")]).tip).toBe("1 under min · warnings only, Save still works · show them");
    });
});
