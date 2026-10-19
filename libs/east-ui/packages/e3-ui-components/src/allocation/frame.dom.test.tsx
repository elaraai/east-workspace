/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board in its frame (#1325): the toolbar's items, the day's status and
 * its banners, the day stepping and the picker's marks, Publish, the footer's
 * legend and the loading cover — over the kiln yard's records.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { DateTimeType, none, printFor, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { issueSummary } from "./toolbar.js";
import type { Issue } from "./model.js";
import { act, allocationHarness, mount, settle, slot, THU, TUE, TUE_4 } from "./harness.test-utils.js";

const h = allocationHarness();
const day = printFor(DateTimeType);
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const status = (c: HTMLElement) => c.querySelector("[data-allocation-status]")?.textContent;
const shownDay = (c: HTMLElement) => Number(c.querySelector("[data-allocation-main]")!.getAttribute("data-allocation-day"));

describe("the board's frame", () => {
    test("A1 — one toolbar: the date, the layout (Table, then Timeline), the day's status, the history and Publish", async () => {
        const { container } = mount(ex.allocationKilnYard); await settle();
        const bar = toolbar(container);
        expect(bar.getByRole("button", { name: "Choose plan day" })).toBeTruthy();
        expect(bar.getAllByRole("radio").map(r => r.textContent)).toEqual(["Table", "Timeline"]);
        expect(status(container)).toBe("Draft");
        expect(bar.getByRole("button", { name: editingMessages.apply() })).toBeTruthy();
        expect(bar.getByRole("button", { name: "Publish" })).toBeTruthy();
    });

    test("A2 — [ and ] step one day; the arrows step a day", async () => {
        const { container } = mount(ex.allocationKilnYard); await settle();
        expect(shownDay(container)).toBe(TUE.getTime());
        await key(container, "]");
        expect(shownDay(container)).toBe(TUE.getTime() + 86_400_000);
        await key(container, "["); await key(container, "[");
        expect(shownDay(container)).toBe(TUE.getTime() - 86_400_000);
        await press(toolbar(container).getByRole("button", { name: "Next day" }));
        expect(shownDay(container)).toBe(TUE.getTime());
    });

    test("A2 — the picker marks each day of its open month Published · Draft · Not started", async () => {
        const { container } = mount(ex.allocationKilnYard); await settle();
        await press(toolbar(container).getByRole("button", { name: "Choose plan day" }));
        const picker = within(document.body).getByRole("dialog");
        const mark = (date: Date) => picker.querySelector(`[data-time-day="${date.getTime()}"] [data-state]`)?.getAttribute("data-state");
        expect(mark(TUE_4)).toBe("published");
        expect(mark(TUE)).toBe("draft");
        expect(mark(THU)).toBe("empty");
        expect(picker.textContent).toContain("Published · Draft · Not started");
    });

    test("A2 — read a day at a time, the picker marks each day of the month it browses to, the month read as one run of keys", async () => {
        const { container } = mount(ex.allocationWindowed); await settle();
        await press(toolbar(container).getByRole("button", { name: "Choose plan day" }));
        const picker = within(document.body).getByRole("dialog");
        const marks = () => [...picker.querySelectorAll("[data-time-day]")].map(d => d.querySelector("[data-state]")?.getAttribute("data-state"));
        // May's weeks, Mon 26 Apr to Sun 6 Jun: published to Mon 10, the draft on Tue 11, not started from Wed 12.
        expect(marks()).toEqual([...Array(15).fill("published"), "draft", ...Array(26).fill("empty")]);
        // April's, Mon 29 Mar to Sun 2 May, every day published: 35 days, more than the runtime keeps windows of, read a window a day.
        const before = h.paging.requests.length;
        const history = () => h.paging.requests.slice(before).filter(r => r.startsWith("records.kiln_plan_history "));
        fireEvent.click(within(picker).getByRole("button", { name: "Previous month" }));
        // Counted before anything waits on a timer: reads that evict each other never stop asking, and their landings starve every timer.
        for (let i = 0; i < 100; i++) await Promise.resolve();
        expect(history().length).toBeLessThanOrEqual(2);
        await settle();
        expect(marks()).toEqual(Array(35).fill("published"));
        // One search for the month's run of keys, and one page of it.
        expect(history().filter(r => r.includes(" seek ")).length).toBe(1);
        expect(history().filter(r => r.includes(" page "))).toEqual([expect.stringMatching(/ page \d+\+35$/)]);
    });

    test("A3 — a day with no entry is Not started, under the banner `Day not started`", async () => {
        const { container } = mount(ex.allocationKilnYard); await settle();
        expect(container.textContent).not.toContain("Day not started");
        await key(container, "]"); await key(container, "]");
        expect(shownDay(container)).toBe(THU.getTime());
        expect(status(container)).toBe("Not started");
        expect(container.textContent).toContain("Day not started");
    });

    test("A4 — Publish records the day published, in one patch; a published day is read-only under its banner", async () => {
        const { container } = mount(ex.allocationKilnYard); await settle();
        await press(toolbar(container).getByRole("button", { name: "Publish" }));
        const saved = h.read(ex.kilnPlans).get(TUE)!;
        expect(saved.status.type).toBe("published");
        expect(saved.bins.size).toBe(26);
        expect(status(container)).toBe("Published");
        expect(container.textContent).toContain("Published day");
        expect(container.textContent).toContain("Read-only view of the published plan.");
        expect(container.querySelector("[data-allocation-readonly]")).not.toBeNull();
        expect(toolbar(container).queryByRole("button", { name: "Publish" })).toBeNull();
        expect(toolbar(container).queryByRole("button", { name: editingMessages.apply() })).toBeNull();
    });

    test("A4 — the published example's day, Tue 4, opens read-only", async () => {
        const { container } = mount(ex.allocationPublished); await settle();
        expect(shownDay(container)).toBe(TUE_4.getTime());
        expect(status(container)).toBe("Published");
        expect(container.querySelector("[data-allocation-readonly]")).not.toBeNull();
    });

    test("`publish={false}`: no status chip and no Publish", async () => {
        const { container } = mount(ex.allocationNoPublish); await settle();
        expect(container.querySelector("[data-allocation-status]")).toBeNull();
        expect(toolbar(container).queryByRole("button", { name: "Publish" })).toBeNull();
        expect(toolbar(container).getByRole("button", { name: editingMessages.apply() })).toBeTruthy();
    });

    test("A79 — the footer is the layout's legend only", async () => {
        const { container } = mount(ex.allocationKilnYard); await settle();
        const items = () => [...slot(container, "footer").querySelectorAll("[data-allocation-legend]")].map(i => i.textContent);
        expect(items()).toEqual(["Bin", "Draft", "Today's load", "Prior job", "Next job", "Overlap", "Link", "Draft link"]);
        await press(toolbar(container).getByRole("radio", { name: "Table" }));
        expect(items()).toEqual(["Event or resource", "Draft", "Empty · drop here", "Reserved", "Free"]);
    });

    test("A80 — the frame is covered until the active day resolves, a day at a time through the window", async () => {
        const { container } = mount(ex.allocationWindowed); await settle();
        expect(container.querySelector("[data-allocation-main]")!.getAttribute("aria-busy")).toBe("false");
        expect(shownDay(container)).toBe(TUE.getTime());
        expect(day(TUE)).toContain("2027-05-11");
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
