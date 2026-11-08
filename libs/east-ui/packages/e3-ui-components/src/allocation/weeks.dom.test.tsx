/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board publishing a week at a time (#1550): its periods the yard's
 * weeks, each row keyed by its week's first day. Publish writes the week
 * holding the day in view; every day of a published week is read-only under
 * its banner, and the next week takes edits. The picker marks each day with
 * its week's status, and each week too. A week starting on Sunday holds the
 * day from the Sunday before.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, kilnYard, settle, slot, TUE, TUE_4, WED } from "./harness.test-utils.js";

const h = allocationHarness();
const DAY = 86_400_000;
/** The plan day's week, from Mon 10 May 2027; the issued one, from Mon 3 May; and the plan day's week from Sun 9 May. */
const MON = new Date("2027-05-10T00:00:00Z"), MON_3 = new Date("2027-05-03T00:00:00Z"), SUN = new Date("2027-05-09T00:00:00Z");
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
async function steps(c: HTMLElement, k: string, n: number) { for (let i = 0; i < n; i++) await key(c, k); }
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const status = (c: HTMLElement) => c.querySelector("[data-allocation-status]")?.textContent;
const shownDay = (c: HTMLElement) => Number(c.querySelector("[data-allocation-main]")!.getAttribute("data-allocation-day"));
const readOnly = (c: HTMLElement) => c.querySelector("[data-allocation-readonly]") !== null;
const publishOff = (c: HTMLElement) => toolbar(c).getByRole("button", { name: "Publish" }).hasAttribute("disabled");

describe("the board publishing a week at a time (#1550)", () => {
    test("Publish writes the week's row, keyed by its Monday, issued; every day of the week is read-only under its banner, and the next week takes edits", async () => {
        const { container } = await h.mount(ex.allocationWeekly);
        expect(shownDay(container)).toBe(TUE.getTime());
        expect(status(container)).toBe("Draft");
        expect(readOnly(container)).toBe(false);
        await press(toolbar(container).getByRole("button", { name: "Publish" }));
        // No draft to save: the week's row alone, one patch of the weeks, keyed by the Monday of the day in view's week.
        expect(h.requests("mutate").map(r => r.record)).toEqual([ex.yardWeeks.name]);
        const weeks = await h.read(ex.yardWeeks);
        expect(weeks.get(MON)!.state.type).toBe("issued");
        expect(weeks.has(TUE)).toBe(false);
        expect(status(container)).toBe("Published");
        expect(container.textContent).toContain("Published week");
        expect(readOnly(container)).toBe(true);
        expect(publishOff(container)).toBe(true);
        expect(toolbar(container).queryByRole("button", { name: editingMessages.apply() })).toBeNull();
        // Every day of the week reads its row: Wed 12, Sun 16 its last, and back to Mon 10 its first.
        await key(container, "]");
        expect(shownDay(container)).toBe(WED.getTime());
        expect([status(container), readOnly(container)]).toEqual(["Published", true]);
        await steps(container, "]", 4);
        expect(shownDay(container)).toBe(MON.getTime() + 6 * DAY);
        expect([status(container), readOnly(container)]).toEqual(["Published", true]);
        expect(container.textContent).toContain("Published week");
        // The next week, from Mon 17 May, has no row: Not started, and it takes edits — Publish on.
        await key(container, "]");
        expect(shownDay(container)).toBe(MON.getTime() + 7 * DAY);
        expect([status(container), readOnly(container), publishOff(container)]).toEqual(["Not started", false, false]);
        await steps(container, "[", 7);
        expect(shownDay(container)).toBe(MON.getTime());
        expect([status(container), readOnly(container)]).toEqual(["Published", true]);
    });

    test("the issued week, from Mon 3 May: each of its days is read-only under `Published week`", async () => {
        const { container } = await h.mount(ex.allocationWeekly);
        await steps(container, "[", 7);
        expect(shownDay(container)).toBe(TUE_4.getTime());
        expect([status(container), readOnly(container), publishOff(container)]).toEqual(["Published", true, true]);
        expect(container.textContent).toContain("Published week");
        expect(container.textContent).toContain("Read-only view of the published plan.");
        await key(container, "[");
        expect(shownDay(container)).toBe(MON_3.getTime());
        expect([status(container), readOnly(container)]).toEqual(["Published", true]);
        // Sun 2 May is the week before's: no row, so Not started.
        await key(container, "[");
        expect([status(container), readOnly(container)]).toEqual(["Not started", false]);
    });

    test("the picker marks each day with its week's status, and the Weeks panel each week", async () => {
        const { container } = await h.mount(ex.allocationWeekly);
        await press(toolbar(container).getByRole("button", { name: "Choose plan day" }));
        const picker = within(document.body).getByRole("dialog");
        const mark = (date: Date) => picker.querySelector(`[data-time-day="${date.getTime()}"] [data-state]`)?.getAttribute("data-state");
        // The week of Mon 3 May published, of Mon 10 a draft, of Mon 17 not started — every day of each.
        const week = (from: Date) => Array.from({ length: 7 }, (_, i) => mark(new Date(from.getTime() + i * DAY)));
        expect(week(MON_3)).toEqual(Array(7).fill("published"));
        expect(week(MON)).toEqual(Array(7).fill("draft"));
        expect(week(new Date(MON.getTime() + 7 * DAY))).toEqual(Array(7).fill("empty"));
        await press(within(picker).getByRole("radio", { name: "Weeks" }));
        const weekMark = (from: Date) => picker.querySelector(`[data-time-week="${from.getTime()}"] [data-state]`)?.getAttribute("data-state");
        expect([weekMark(MON_3), weekMark(MON), weekMark(new Date(MON.getTime() + 7 * DAY))]).toEqual(["published", "draft", "empty"]);
    });

    test("a week starting on Sunday holds the day from the Sunday before: Publish writes the row of Sun 9 May, and Sun 16 starts the next", async () => {
        const { container } = await h.mount(kilnYard({ weeks: "sunday" }));
        // The yard's weeks are keyed by their Mondays: the week from Sun 9 May has no row.
        expect(status(container)).toBe("Not started");
        await press(toolbar(container).getByRole("button", { name: "Publish" }));
        const weeks = await h.read(ex.yardWeeks);
        expect(weeks.get(SUN)!.state.type).toBe("issued");
        expect(weeks.get(MON)!.state.type).toBe("draft");
        expect([status(container), readOnly(container)]).toEqual(["Published", true]);
        // Sat 15 May is its last day; Sun 16 the next week's first, with no row.
        await steps(container, "]", 4);
        expect(shownDay(container)).toBe(SUN.getTime() + 6 * DAY);
        expect([status(container), readOnly(container)]).toEqual(["Published", true]);
        await key(container, "]");
        expect([status(container), readOnly(container)]).toEqual(["Not started", false]);
        // The picker's weeks start on Sunday, as the board's do.
        await press(toolbar(container).getByRole("button", { name: "Choose plan day" }));
        const first = within(document.body).getByRole("dialog").querySelector("[data-time-day]")!.getAttribute("data-time-day");
        expect(new Date(Number(first)).getUTCDay()).toBe(0);
    });
});
