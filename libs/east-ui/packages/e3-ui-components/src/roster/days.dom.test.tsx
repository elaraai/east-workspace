/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster publishing a day at a time (#1550, `rosterDaily`): its periods
 * the rota's days, each row keyed by its UTC day. In Shifts' Day, Publish
 * writes the day in view's row; a published day is read-only in every layout
 * and period, under its banner, and refuses a drop the next day takes; in
 * Week, Publish writes each day of the week that takes edits, as one request.
 * A proposal rejected is kept on its own day's row, and the picker marks each
 * day with its own status, a week published only once its seven days are.
 */
import { describe, expect, test } from "vitest";
import { waitFor, within } from "@testing-library/react";
import { DateTimeType, compareFor, equalFor } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { at, cell, drop, history, hover, libraryCard, press, release, rosterHarness, slot } from "./harness.test-utils.js";
import { DAY } from "./model.js";

const h = rosterHarness();
/** The week before, issued; this week, from Sunday; Wednesday, its last day issued; Thursday, open; Friday and Saturday, with no row; and the week after. */
const SUN_27 = at("2028-02-27T00:00:00"), SUN = at("2028-03-05T00:00:00"), THU = at("2028-03-09T00:00:00");
const FRI = at("2028-03-10T00:00:00"), SAT = at("2028-03-11T00:00:00"), NEXT = at("2028-03-12T00:00:00");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const status = (c: HTMLElement) => c.querySelector("[data-roster-status]")?.textContent;
/** Whether the board offers a gesture on a duty it draws: a grip, or a chip's own action. */
const gestures = (c: HTMLElement) => slot(c, "main").querySelector("[data-roster-grip], [data-roster-chip-action]") !== null;
const publishOff = (c: HTMLElement) => history(c, "Publish").hasAttribute("disabled");
/** The caption under the ghost, as the shared drag layer says it: a refusal's words, marked refused. */
const refusal = () => { const caption = document.querySelector<HTMLElement>("[data-drag-caption]"); return [caption?.textContent, caption?.hasAttribute("data-refused")]; };
/** A step of the day in view, by the toolbar's own control: the keys `[` and `]` step a week. */
const stepDay = (c: HTMLElement, by: "Previous day" | "Next day") => press(toolbar(c).getByRole("button", { name: by }));
/** A record's commits, newest first, by the mutation that made each. */
const commits = async (record: { readonly name: string }) => (await h.history(record)).commits.map(c => c.mutation);
const sameDay = equalFor(ex.WarehouseDay);
const byDate = compareFor(DateTimeType);
/** So many days from a first, each a UTC midnight. */
const daysFrom = (from: Date, n: number) => Array.from({ length: n }, (_, i) => new Date(from.getTime() + i * DAY));

describe("the Roster publishing a day at a time (#1550)", () => {
    test("in Shifts' Day, Publish writes the day in view's row alone; the day is then read-only under its banner, and the next day takes edits", async () => {
        const { container: c } = await h.mount(ex.rosterDaily);
        expect([status(c), gestures(c), publishOff(c)]).toEqual(["Draft", true, false]);
        const deployed = await commits(ex.rosterDays);
        await press(history(c, "Publish"));
        // No draft to save: the day's row alone, one patch of the days.
        expect(h.requests("mutate").map(r => r.record)).toEqual([ex.rosterDays.name]);
        expect(await commits(ex.rosterDays)).toEqual(["patch", ...deployed]);
        const days = await h.read(ex.rosterDays);
        expect(days.get(THU)!.state.type).toBe("issued");
        expect([days.has(FRI), days.has(SAT)]).toEqual([false, false]);
        expect(daysFrom(SUN, 4).every(day => sameDay(days.get(day)!, ex.rosterDayRows.get(day)!))).toBe(true);
        expect([status(c), gestures(c), publishOff(c)]).toEqual(["Published", false, true]);
        expect(c.textContent).toContain("Published day");
        expect(c.textContent).toContain("Read-only view of the published roster.");
        // Friday has no row: not started, and it takes edits — Publish on.
        await stepDay(c, "Next day");
        expect([status(c), gestures(c), publishOff(c)]).toEqual(["Not started", true, false]);
        expect(c.textContent).not.toContain("Published day");
    });

    test("a published day refuses a drop that the next day takes: issued Wednesday says why, and Thursday places the person", async () => {
        const { container: c } = await h.mount(ex.rosterDaily);
        await stepDay(c, "Previous day");
        expect([status(c), gestures(c), publishOff(c)]).toEqual(["Published", false, true]);
        expect(c.textContent).toContain("Published day");
        await hover(await libraryCard(c, "N. Ochre"), cell(c, 3, "inbound", "late"));
        expect(cell(c, 3, "inbound", "late").hasAttribute("data-drop-invalid")).toBe(true);
        expect(refusal()).toEqual(["This day is not available to edit.", true]);
        await release();
        expect(slot(c, "main").querySelector("[data-roster-assignment][data-drafted]")).toBeNull();
        await stepDay(c, "Next day");
        await drop(await libraryCard(c, "N. Ochre"), cell(c, 4, "inbound", "late"));
        expect(cell(c, 4, "inbound", "late").querySelector("[data-roster-assignment][data-drafted]")).not.toBeNull();
        await press(history(c, editingMessages.apply()));
        const thursday = [...(await h.read(ex.rosterDuties)).values()].filter(duty => duty.who.type === "staff" && duty.who.value === "nochre"
            && byDate(duty.start, THU) >= 0 && byDate(duty.start, FRI) < 0);
        expect(thursday.map(duty => [duty.team, duty.shift])).toEqual([["inbound", "late"]]);
    });

    test("in Week, Publish writes each day of the week that takes edits — Thursday's row, and new ones for Friday and Saturday — as one request; the chip and the banner count the days", async () => {
        const { container: c } = await h.mount(ex.rosterDaily);
        await press(toolbar(c).getByRole("radio", { name: "Week" }));
        expect(status(c)).toBe("4 of 7 published");
        expect(c.textContent).toContain("4 of 7 days published");
        expect(c.textContent).toContain("Sun, Mon, Tue, Wed are read-only.");
        expect(c.querySelector("[data-roster-readonly]")).toBeNull();
        // Wednesday refuses a drop, and Thursday takes one, side by side.
        await hover(await libraryCard(c, "N. Ochre"), cell(c, 3, "inbound", "late"));
        expect(cell(c, 3, "inbound", "late").hasAttribute("data-drop-invalid")).toBe(true);
        expect(refusal()).toEqual(["This day is not available to edit.", true]);
        await release();
        await hover(await libraryCard(c, "N. Ochre"), cell(c, 4, "inbound", "late"));
        expect(cell(c, 4, "inbound", "late").hasAttribute("data-drop-invalid")).toBe(false);
        expect(refusal()[1]).toBe(false);
        await release();
        await press(history(c, editingMessages.discard()));
        const deployed = await commits(ex.rosterDays);
        await press(history(c, "Publish"));
        expect(h.requests("mutate").map(r => r.record)).toEqual([ex.rosterDays.name]);
        expect(await commits(ex.rosterDays)).toEqual(["patch", ...deployed]);
        const days = await h.read(ex.rosterDays);
        expect([THU, FRI, SAT].map(day => days.get(day)?.state.type)).toEqual(["issued", "issued", "issued"]);
        // Friday's and Saturday's rows are new, dismissing nothing; Sunday to Wednesday stand as they were issued.
        expect([days.get(FRI)!.dismissed.size, days.get(SAT)!.dismissed.size]).toEqual([0, 0]);
        expect(daysFrom(SUN, 4).every(day => sameDay(days.get(day)!, ex.rosterDayRows.get(day)!))).toBe(true);
        expect(days.has(NEXT)).toBe(false);
        expect([status(c), publishOff(c)]).toEqual(["Published", true]);
        expect(c.textContent).toContain("Published week");
        expect(c.querySelector("[data-roster-readonly]")).not.toBeNull();
    });

    test("in People, a published day takes no gesture: an off day says Off where it is issued, and offers `+ Assign` where it takes edits", async () => {
        const { container: c } = await h.mount(ex.rosterDaily);
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        await waitFor(() => expect(slot(c, "main").querySelector("[data-roster-assign]")).not.toBeNull());
        const cells = [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-person-day]")];
        const dayOf = (el: HTMLElement) => Number(el.getAttribute("data-roster-person-day")!.split(".").pop());
        const assigns = (el: HTMLElement) => el.querySelector("[data-roster-assign]") !== null;
        const says = (el: HTMLElement) => el.textContent === "Off";
        // Sunday to Wednesday, issued: an off day says Off, and none offers `+ Assign`.
        expect([cells.some(el => dayOf(el) < 4 && says(el)), cells.some(el => dayOf(el) < 4 && assigns(el))]).toEqual([true, false]);
        // Thursday to Saturday take edits: an off day offers `+ Assign`, and none says Off.
        expect([cells.some(el => dayOf(el) >= 4 && assigns(el)), cells.some(el => dayOf(el) >= 4 && says(el))]).toEqual([true, false]);
    });

    test("a proposal rejected is kept on its own day's row: Save writes Thursday's dismissals, and no week's", async () => {
        const { container: c } = await h.mount(ex.rosterDaily);
        const proposal = () => c.querySelector<HTMLElement>('[data-roster-proposal="s317"]');
        await press(within(proposal()!).getByRole("button", { name: "Reject proposal for N. Ochre" }));
        expect(proposal()).toBeNull();
        await press(history(c, editingMessages.apply()));
        expect(h.requests("mutate").map(r => r.record)).toEqual([ex.rosterDays.name]);
        const thursday = (await h.read(ex.rosterDays)).get(THU)!;
        expect([thursday.state.type, [...thursday.dismissed]]).toEqual(["open", ["s317"]]);
    });

    test("the picker marks each day with its own status, and a week as published only once its seven days are", async () => {
        const { container: c } = await h.mount(ex.rosterDaily);
        await press(toolbar(c).getByRole("button", { name: "Choose roster day" }));
        const picker = within(document.body).getByRole("dialog");
        const mark = (date: Date) => picker.querySelector(`[data-time-day="${date.getTime()}"] [data-state]`)?.getAttribute("data-state");
        // Every day of the week before issued, and this week's Sunday to Wednesday; Thursday open; Friday and Saturday not started.
        expect(daysFrom(SUN_27, 14).map(mark)).toEqual([...Array<string>(11).fill("published"), "draft", "empty", "empty"]);
        await press(within(picker).getByRole("radio", { name: "Weeks" }));
        const weekMark = (from: Date) => picker.querySelector(`[data-time-week="${from.getTime()}"] [data-state]`)?.getAttribute("data-state");
        expect([SUN_27, SUN, NEXT].map(weekMark)).toEqual(["published", "draft", "empty"]);
    });
});
