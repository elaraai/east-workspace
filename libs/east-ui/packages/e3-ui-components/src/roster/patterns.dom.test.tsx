/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Week patterns and the month (#1406) on e3 itself: the Patterns tab, titled
 * and marked by the app's declaration; a pattern dropped on a person's week
 * — its row in Week, its cell in Month — as one step of the history, its
 * preview and caption, and each refusal; the month's columns, marks, letters
 * and column click; the person-week the inspector reads; the phone's
 * `Apply pattern…` and Week alone; and #1398's rules on a month's read.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, IntegerType, compareFor } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, assignment, at, cell, drop, history, hover, press, release, rosterHarness, settle, slot, START, weekDuties, width } from "./harness.test-utils.js";
import { rosterSpan, weekKey, weekNumber } from "./model.js";
const h = rosterHarness();
const byDate = compareFor(DateTimeType);
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
/** The Period segment's choices, as the toolbar offers them. */
const periods = (c: HTMLElement) => within(toolbar(c).getByRole("radiogroup", { name: "Period" })).getAllByRole("radio").map(r => r.textContent);
/** Opens the Patterns tab, and finds a pattern's card by its key — in its own pane, never a person's card that mentions a day off. */
async function pattern(c: HTMLElement, key: string): Promise<HTMLElement> {
    const tab = within(slot(c, "start")).getByRole("tab", { name: /^Patterns/ });
    if (tab.getAttribute("aria-selected") !== "true") await press(tab);
    const card = slot(c, "start").querySelector<HTMLElement>(`[data-roster-library="patterns"] [data-library-item="${key}"]`);
    if (card === null) throw new Error(`the Patterns tab shows no card ${key}`);
    return card;
}
const day = (c: HTMLElement, person: string, d: number) => slot(c, "main").querySelector<HTMLElement>(`[data-roster-person-day="${person}.${d}"]`)!;
const tile = (c: HTMLElement, id: string) => slot(c, "main").querySelector<HTMLElement>(`[data-roster-tile][data-roster-assignment="${id}"]`)!;
const monthCell = (c: HTMLElement, person: string, week: Date) => slot(c, "main").querySelector<HTMLElement>(`[data-roster-person-week="${person}.${weekKey(week)}"]`)!;
/** The first person whose row the grid has mounted, and their name. */
const firstPerson = (c: HTMLElement) => slot(c, "main").querySelector("[data-roster-person-head]")!.getAttribute("data-roster-person-head")!;
const nameOf = (c: HTMLElement, key: string) => slot(c, "main").querySelector(`[data-roster-person-head="${key}"]`)!.textContent!;
/** The caption under the ghost, as the shared drag layer says it. */
const caption = () => document.querySelector<HTMLElement>("[data-drag-caption]");
/** A person's duties of a week, as the record holds them, earliest first. */
async function personWeek(person: string, week: Date) {
    return [...weekDuties(await h.read(ex.rosterDuties), week).values()].filter(duty => duty.who.type === "staff" && duty.who.value === person).sort((a, b) => byDate(a.start, b.start));
}
/** A day of a week at an hour, by East's own arithmetic. */
const dayAt = East.compile(East.function([DateTimeType, IntegerType, IntegerType], DateTimeType, (_$, week, d, hour) => week.addDays(d).addHours(hour)), []);
const step = async (c: HTMLElement, key: "[" | "]") => { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key }); }); await settle(); };
/** Each day's live tile label in a person's row: the shift, or null for a day off. */
const rowOf = (c: HTMLElement, person: string) => [0, 1, 2, 3, 4, 5, 6].map(d => day(c, person, d).querySelector("[data-roster-tile]:not([data-removed]) [data-roster-assignment-name]")?.textContent ?? null);
/** The month's March 2028: five weeks, Feb 27 to Mar 26, from the Sunday the warehouse starts its weeks on. */
const MARCH = rosterSpan(at("2028-03-09T00:00:00").getTime(), "month", true);

describe("the Patterns tab (#1406, D3, P20, P23)", () => {
    test("the tab is titled by the declaration's name and counts the patterns; its cards stand in their order, each its name, `N shifts · H h` and a strip of seven marks; its search matches the label; its hint says what a drop does", async () => {
        const { container: c } = await h.mount(ex.rosterPeople);
        expect([...slot(c, "start").querySelectorAll('[role="tab"]')].map(t => t.textContent)).toContain("Patterns 13");
        await press(within(slot(c, "start")).getByRole("tab", { name: "Patterns 13" }));
        const pane = slot(c, "start").querySelector<HTMLElement>('[data-roster-library="patterns"]')!;
        expect(pane).not.toBeNull();
        const cards = () => [...pane.querySelectorAll<HTMLElement>("[data-library-item]")];
        expect(cards().map(card => card.getAttribute("data-library-item"))).toEqual(["e5s", "e5m", "l5s", "l5m", "n4s", "n4w", "fwd", "e2l", "wke", "wkn", "pte", "ptl", "off"]);
        const first = cards()[0]!;
        expect(first.textContent).toContain("Early · Sun–Thu");
        expect(first.textContent).toContain("5 shifts · 40 h");
        expect(first.querySelector("[data-roster-pattern-strip]")!.children).toHaveLength(7);
        expect([...first.querySelector("[data-roster-pattern-strip]")!.children].map(mark => mark.textContent)).toEqual(["E", "E", "E", "E", "E", "", ""]);
        // No row of day initials over the cards (ruled 26 Oct 2026): a strip reads Sunday to Saturday as the card's name does.
        expect(pane.querySelector("[data-roster-pattern-days]")).toBeNull();
        expect(cards().at(-1)!.textContent).toContain("Off");
        expect(cards().at(-1)!.textContent).toContain("0 shifts · 0 h");
        expect(pane.textContent).toContain("Drag one onto a person's week. It replaces all seven days.");
        await act(async () => { fireEvent.change(within(pane).getByRole("textbox", { name: "Search library" }), { target: { value: "Night" } }); }); await settle();
        expect(cards().map(card => card.getAttribute("data-library-item"))).toEqual(["n4s", "n4w", "wkn"]);
    });
});

describe("a pattern on a person's week (#1406, D4, P17–P19, P21, P11)", () => {
    test("dropped on a person's row in Week it replaces the seven days as one `Apply pattern` step — one Undo restores every day, Redo and Save write them all — and selects the person-week", async () => {
        const { container: c } = await h.mount(ex.rosterPeople);
        const person = firstPerson(c);
        const before = rowOf(c, person);
        await drop(await pattern(c, "fwd"), day(c, person, 2));
        // Early Sun and Mon, Late Tue and Wed, Night Thu, the weekend off.
        expect(rowOf(c, person)).toEqual(["Early", "Early", "Late", "Late", "Night", null, null]);
        expect(slot(c, "main").querySelector(`[data-roster-person-row="${person}"] [data-roster-person-name]`)!.hasAttribute("data-selected")).toBe(true);
        expect(slot(c, "end").querySelector("[data-inspector-title]")!.textContent).toBe(nameOf(c, person));
        await press(history(c, editingMessages.undo()));
        expect(rowOf(c, person)).toEqual(before);
        expect(slot(c, "main").querySelectorAll(`[data-roster-person-row="${person}"] [data-roster-tile][data-drafted]`)).toHaveLength(0);
        expect(weekDuties(await h.read(ex.rosterDuties), START).size).toBe(316);
        await press(history(c, editingMessages.redo()));
        expect(rowOf(c, person)).toEqual(["Early", "Early", "Late", "Late", "Night", null, null]);
        await press(history(c, editingMessages.apply()));
        const after = await personWeek(person, START);
        expect(after.map(duty => [duty.shift, duty.start, duty.end])).toEqual([
            ["early", dayAt(START, 0n, 6n), dayAt(START, 0n, 14n)], ["early", dayAt(START, 1n, 6n), dayAt(START, 1n, 14n)],
            ["late", dayAt(START, 2n, 14n), dayAt(START, 2n, 22n)], ["late", dayAt(START, 3n, 14n), dayAt(START, 3n, 22n)],
            ["night", dayAt(START, 4n, 22n), dayAt(START, 5n, 6n)],
        ]);
        const team = (await h.read(ex.rosterStaff)).get(person)!.team;
        expect(after.every(duty => duty.team === team)).toBe(true);
    });
    test("while a pattern hovers a row the caption names the pattern and the person and the row previews its days; applied, the same pattern `Already matches`; the Agency requests row, a tile and a Shifts cell refuse a pattern, and another person's row a tile, each in words", async () => {
        const { container: c } = await h.mount(ex.rosterPeople);
        const person = firstPerson(c);
        await hover(await pattern(c, "fwd"), day(c, person, 2));
        expect(caption()?.textContent).toBe(`Forward rotation → ${nameOf(c, person)}`);
        expect(caption()?.hasAttribute("data-refused")).toBe(false);
        const row = [0, 1, 2, 3, 4, 5, 6].map(d => day(c, person, d));
        expect(row.every(cell => cell.hasAttribute("data-pattern-hover"))).toBe(true);
        expect(row.filter(cell => cell.hasAttribute("data-pattern-changes")).length).toBeGreaterThan(0);
        expect(slot(c, "main").querySelectorAll(`[data-roster-person-row="${person}"] [data-roster-preview]`).length).toBeGreaterThan(0);
        await release();
        expect(rowOf(c, person)).toEqual(["Early", "Early", "Late", "Late", "Night", null, null]);
        expect(slot(c, "main").querySelector("[data-pattern-hover]")).toBeNull();
        // Applied, the same pattern has nothing left to change (P18).
        await hover(await pattern(c, "fwd"), day(c, person, 4));
        expect(caption()?.textContent).toBe("Already matches Forward rotation");
        await release();
        await press(history(c, editingMessages.undo()));
        // The Agency requests row is no person's week (P19): the first group's, below its people, scrolled into view.
        const scroller = slot(c, "main").querySelector<HTMLElement>("[data-virtual-rows]")!;
        for (let i = 1; i <= 40 && day(c, "requests:inbound", 2) === null; i++) {
            await act(async () => { scroller.scrollTop = i * 3 * 36; fireEvent.scroll(scroller); });
            await settle();
        }
        expect(day(c, "requests:inbound", 2)).not.toBeNull();
        await hover(await pattern(c, "fwd"), day(c, "requests:inbound", 2));
        expect(day(c, "requests:inbound", 2).hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()?.textContent).toBe("Drop a pattern on a person's week.");
        expect(caption()?.hasAttribute("data-refused")).toBe(true);
        await release();
        // Nor is a tile (P21).
        await act(async () => { scroller.scrollTop = 0; fireEvent.scroll(scroller); });
        await settle();
        await press(toolbar(c).getByRole("radio", { name: "Shifts" }));
        await press(assignment(c, "s37"));
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        await waitFor(() => expect(tile(c, "s37")).not.toBeNull());
        await hover(await pattern(c, "fwd"), tile(c, "s37"));
        expect(tile(c, "s37").hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()?.textContent).toBe("Drop a pattern on a person's week.");
        await release();
        // A tile moves along its own row (P11): another person's day refuses it.
        const other = [...slot(c, "main").querySelectorAll("[data-roster-person-head]")].map(el => el.getAttribute("data-roster-person-head")!).find(key => key !== "cclover")!;
        await hover(tile(c, "s37"), day(c, other, 4));
        expect(day(c, other, 4).hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()?.textContent).toBe("A duty moves along its own row.");
        await release();
        expect(tile(c, "s37").hasAttribute("data-drafted")).toBe(false);
        // Nor is a Shifts cell a week (P21).
        await press(toolbar(c).getByRole("radio", { name: "Shifts" }));
        await hover(await pattern(c, "fwd"), cell(c, 4, "inbound", "early"));
        expect(cell(c, 4, "inbound", "early").hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()?.textContent).toBe("Drop a pattern on a person's week.");
        await release();
    });
});

describe("the People month (#1406, D2, D10, P12–P16, P2)", () => {
    test("a column per week touching the month, four to six, headed by its number; a cell seven marks lettered by the shift, no hours in the name cell; a column's header opens its week in Week, the period kept per layout; `]` steps a month", async () => {
        const { container: c } = await h.mount(ex.rosterPeopleMonth);
        expect(slot(c, "main").querySelector('[data-roster-grid="people-month"]')).not.toBeNull();
        expect(periods(c)).toEqual(["Week", "Month"]);
        expect(toolbar(c).getByRole("radio", { name: "Month" }).getAttribute("aria-checked")).toBe("true");
        const columns = () => [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-week-column]")];
        expect(columns().map(col => col.getAttribute("data-roster-week-column"))).toEqual(MARCH.weeks.map(week => weekKey(week)));
        expect(columns()).toHaveLength(5);
        expect(columns()[1]!.textContent).toContain(`W${weekNumber(START)}`);
        const person = firstPerson(c);
        const marks = [...monthCell(c, person, START).querySelectorAll<HTMLElement>("[data-roster-mark]")];
        expect(marks).toHaveLength(7);
        expect(marks.every(mark => /^[ELN]?$/.test(mark.textContent ?? ""))).toBe(true);
        expect([...slot(c, "main").querySelectorAll("[data-roster-mark][data-shift]")].some(mark => mark.textContent !== "")).toBe(true);
        expect(slot(c, "main").querySelector("[data-roster-week-hours], [data-roster-tile], [data-roster-assign]")).toBeNull();
        // The column's header opens its week.
        await press(columns()[1]!);
        expect(slot(c, "main").querySelector('[data-roster-grid="people"]')).not.toBeNull();
        expect(toolbar(c).getByRole("radio", { name: "Week" }).getAttribute("aria-checked")).toBe("true");
        expect(slot(c, "main").querySelector("[data-roster-column-header]")!.textContent).toMatch(/^Sun\s*5$/);
        // Back to Month: the month holding the week (P3).
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        expect(columns().map(col => col.getAttribute("data-roster-week-column"))).toEqual(MARCH.weeks.map(week => weekKey(week)));
        // `]` steps a month: April's six weeks, the first the one March ended on.
        await step(c, "]");
        expect(columns()).toHaveLength(6);
        expect(columns()[0]!.getAttribute("data-roster-week-column")).toBe(weekKey(MARCH.weeks[4]!));
        await step(c, "[");
        expect(columns()).toHaveLength(5);
    });
    test("Month → Week returns to the week Month was opened from while the month holds it; a month stepped to opens on its first week (P3)", async () => {
        const { container: c } = await h.mount(ex.rosterPeople);
        const header = () => slot(c, "main").querySelector("[data-roster-column-header]")!.textContent;
        expect(header()).toMatch(/^Sun\s*5$/);
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        expect(slot(c, "main").querySelector('[data-roster-grid="people-month"]')).not.toBeNull();
        await press(toolbar(c).getByRole("radio", { name: "Week" }));
        expect(header()).toMatch(/^Sun\s*5$/);
        // Stepped to April, Week opens April's first week: the month's first whose fourth day falls in it.
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        await step(c, "]");
        await press(toolbar(c).getByRole("radio", { name: "Week" }));
        expect(header()).toMatch(/^Sun\s*2$/);
    });
    test("a cell's click selects the person-week — the inspector's Details over that week, a day pressed opening it in Week with its duty selected (P14, P24)", async () => {
        const { container: c } = await h.mount(ex.rosterPeopleMonth);
        const person = firstPerson(c);
        await press(monthCell(c, person, START));
        expect(monthCell(c, person, START).hasAttribute("data-selected")).toBe(true);
        const end = slot(c, "end");
        expect(end.querySelector("[data-inspector-title]")!.textContent).toBe(nameOf(c, person));
        expect(end.textContent).toContain(`W${weekNumber(START)}`);
        const worked = within(end).getAllByRole("button", { name: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) · (?!Off)/ })[0]!;
        await press(worked);
        expect(slot(c, "main").querySelector('[data-roster-grid="people"]')).not.toBeNull();
        expect(slot(c, "main").querySelector("[data-roster-column-header]")!.textContent).toMatch(/^Sun\s*5$/);
        await waitFor(() => expect(slot(c, "main").querySelector(`[data-roster-person-row="${person}"] [data-roster-tile][data-selected]`)).not.toBeNull());
    });
    test("a pattern dropped on a cell applies to that week as one step, the cell previewing its marks while the pattern hovers (P15, P17)", async () => {
        const { container: c } = await h.mount(ex.rosterPeopleMonth);
        const person = firstPerson(c);
        const live = () => monthCell(c, person, START).querySelectorAll("[data-roster-mark][data-shift]:not([data-removed])").length;
        const before = live();
        expect(before).toBeGreaterThan(0);
        // Nothing of the month is drafted yet: a week's marks are drafted against that week as held, not the month's first (D13).
        expect(slot(c, "main").querySelector("[data-roster-person-week][data-drafted], [data-roster-mark][data-drafted]")).toBeNull();
        await hover(await pattern(c, "off"), monthCell(c, person, START));
        expect(monthCell(c, person, START).hasAttribute("data-pattern-hover")).toBe(true);
        expect(monthCell(c, person, START).querySelectorAll("[data-roster-mark][data-preview]")).toHaveLength(7);
        expect(caption()?.textContent).toBe(`Off → ${nameOf(c, person)}`);
        await release();
        expect(live()).toBe(0);
        expect(monthCell(c, person, START).hasAttribute("data-drafted")).toBe(true);
        expect(monthCell(c, person, START).hasAttribute("data-selected")).toBe(true);
        // The neighbouring weeks stand.
        expect(monthCell(c, person, MARCH.weeks[2]!).hasAttribute("data-drafted")).toBe(false);
        await press(history(c, editingMessages.undo()));
        expect(live()).toBe(before);
        expect(monthCell(c, person, START).hasAttribute("data-drafted")).toBe(false);
        await press(history(c, editingMessages.redo()));
        await press(history(c, editingMessages.apply()));
        expect(await personWeek(person, START)).toEqual([]);
        expect(weekDuties(await h.read(ex.rosterDuties), MARCH.weeks[2]!).size).toBe(weekDuties(await h.read(ex.rosterDuties), MARCH.weeks[2]!).size);
    });
});

describe("a phone's People (#1406, D12, P22, P31)", () => {
    test("below 480px People is the week's cards alone — a persisted month opening on its first week — and each card's `Apply pattern…` applies a pattern through a Chooser as one step", async () => {
        // A persisted month opens on its first week: February's last, which the warehouse has published, so nothing there edits.
        const month = await h.mount(ex.rosterPeopleMonth);
        await width(390);
        expect(slot(month.container, "main").querySelector('[data-roster-agenda="people"]')).not.toBeNull();
        expect(slot(month.container, "main").querySelector("[data-roster-grid]")).toBeNull();
        expect(slot(month.container, "main").querySelector("[data-drag-cell], [aria-roledescription='draggable']")).toBeNull();
        const row = toolbar(month.container).queryByRole("radiogroup", { name: "Period" });
        if (row !== null) expect(within(row).getAllByRole("radio").map(r => r.textContent)).toEqual(["Week"]);
        // Its cards take no action: the published week edits nothing.
        expect(within(slot(month.container, "main").querySelector<HTMLElement>("[data-roster-person-card]")!).queryByRole("button", { name: "Apply pattern…" })).toBeNull();
        month.unmount();
        // The draft week's cards each offer Apply pattern…
        const { container: c } = await h.mount(ex.rosterPeople);
        await width(390);
        expect(slot(c, "main").querySelector('[data-roster-agenda="people"]')).not.toBeNull();
        expect(slot(c, "main").querySelector("[data-drag-cell], [aria-roledescription='draggable']")).toBeNull();
        const card = slot(c, "main").querySelector<HTMLElement>("[data-roster-person-card]")!;
        const person = card.getAttribute("data-roster-person-card")!;
        await press(within(card).getByRole("button", { name: "Apply pattern…" }));
        const chooser = await waitFor(() => { const el = document.querySelector<HTMLElement>("[data-chooser]"); expect(el).not.toBeNull(); return el!; });
        expect(within(chooser).getAllByRole("option")).toHaveLength(13);
        await press(within(chooser).getByRole("option", { name: /^Off/ }));
        // Applied as one step: every duty of the card's week struck through, restorable until Save.
        const personCard = () => slot(c, "main").querySelector<HTMLElement>(`[data-roster-person-card="${person}"]`)!;
        await waitFor(() => expect(within(personCard()).getAllByRole("button", { name: "Restore" }).length).toBeGreaterThan(0));
        expect(within(personCard()).queryByRole("button", { name: "Remove" })).toBeNull();
        expect(within(personCard()).queryByRole("button", { name: "Move" })).toBeNull();
        await press(history(c, editingMessages.undo()));
        expect(slot(c, "main").querySelector(`[data-roster-person-card="${person}"] [data-drafted]`)).toBeNull();
    });
});

describe("a month's read (#1398 on #1406, P26–P28)", () => {
    const WEEKS = "records.roster_rota_weeks", DUTIES = "records.roster_duties";
    const READS = new Set(["page", "find", "runs", "rows"]);
    const weekRead = (request: E3Request) => READS.has(request.kind) && (request.dataset === WEEKS || request.dataset === DUTIES);
    const range = (span: { readonly weeks: readonly Date[] }) => `W${weekNumber(span.weeks[0]!)}–W${weekNumber(span.weeks.at(-1)!)}`;
    test("a month not read draws its header, bands and names at once with a placeholder strip in each cell and no `Off`; the footer's line names its weeks; the months either side are read ahead, so a step shows the next at once", async () => {
        const held = h.e3.hold(weekRead);
        const { container: c } = await h.mount(ex.rosterPeopleMonth);
        const line = () => slot(c, "footer").querySelector<HTMLElement>("[data-footer-line]")!;
        expect(c.querySelector("[data-builder-loading]")).not.toBeNull();
        expect(line().textContent).toContain(range(MARCH));
        await act(async () => { held.release(); }); await settle();
        await waitFor(() => expect(c.querySelector("[data-builder-loading]")).toBeNull());
        expect(slot(c, "main").querySelectorAll("[data-roster-week-column]")).toHaveLength(5);
        expect(line().hasAttribute("data-idle")).toBe(true);
        // Landed, its neighbours are read ahead: a step to April shows it whole with every read held.
        const again = h.e3.hold(weekRead);
        await step(c, "]");
        expect(slot(c, "main").querySelectorAll("[data-roster-week-column]")).toHaveLength(6);
        expect(slot(c, "main").querySelector("[data-roster-unread]")).toBeNull();
        expect(slot(c, "main").getAttribute("aria-busy")).toBe("false");
        // Two months on, not read: the geometry first — the names real, a placeholder a mark, no Off — and the line says which weeks.
        await step(c, "]");
        const may = rosterSpan(at("2028-05-09T00:00:00").getTime(), "month", true);
        expect(slot(c, "main").querySelectorAll("[data-roster-week-column]").length).toBe(may.weeks.length);
        expect(slot(c, "main").querySelector("[data-roster-person-row][data-roster-unread]")).not.toBeNull();
        expect(slot(c, "main").querySelector("[data-roster-person-head]")).not.toBeNull();
        expect(slot(c, "main").querySelector("[data-roster-mark][data-shift], [data-roster-mark][data-off]")).toBeNull();
        expect(slot(c, "main").textContent).not.toMatch(/\bOff\b|\+ Assign/);
        expect(slot(c, "main").getAttribute("aria-busy")).toBe("true");
        // Past the reveal's delay, the line names the weeks and the placeholders fill.
        await waitFor(() => expect(line().textContent).toContain(range(may)));
        await waitFor(() => expect(slot(c, "main").querySelector("[data-roster-mark][data-pending]")).not.toBeNull());
        await act(async () => { again.release(); }); await settle();
        await waitFor(() => expect(slot(c, "main").querySelector("[data-roster-unread]")).toBeNull());
        // Landed, the month's cells say Off where the warehouse rosters no one — only after the read (CL13).
        expect(slot(c, "main").querySelectorAll("[data-roster-mark][data-off]").length).toBeGreaterThan(0);
        expect(slot(c, "main").querySelector("[data-roster-mark][data-pending]")).toBeNull();
    });
    test("a month whose read fails once the Roster has shown keeps its people and says so once — across the first person's cells in view, with Retry — and on the footer's line (CL11)", async () => {
        const { container: c } = await h.mount(ex.rosterPeopleMonth);
        await settle();
        const stop = h.e3.fail(weekRead, { status: 500, type: "internal", message: "the store is down" });
        await step(c, "]");
        await step(c, "]");
        const said = () => [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-read-line]")];
        await waitFor(() => expect(said()).toHaveLength(1), { timeout: 15_000 });
        expect(said()[0]!.closest("[data-roster-person-row]")).not.toBeNull();
        expect(said()[0]!.textContent).toMatch(/^Couldn't read .+Retry$/);
        expect([...slot(c, "main").querySelectorAll("[data-roster-person-week]")].every(cell => cell.textContent === "")).toBe(true);
        expect(slot(c, "footer").querySelector("[data-footer-line]")!.hasAttribute("data-failed")).toBe(true);
        stop();
        await act(async () => { fireEvent.click(within(said()[0]!).getByRole("button", { name: "Retry" })); });
        await settle();
        await waitFor(() => expect(said()).toHaveLength(0), { timeout: 15_000 });
        await waitFor(() => expect(slot(c, "main").querySelector("[data-roster-unread]")).toBeNull());
    });
});
