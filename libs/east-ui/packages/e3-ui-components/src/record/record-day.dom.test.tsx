/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The page's day (`<Record day>`, east-workspace#1746), over a crew's planned
 * hours on e3 itself (`recordPlannedHours`), each test a workspace of its own:
 * a column for each machine under its line, read and written at the day the
 * page keeps in its own state. The cells read the page's day, the days since a
 * briefing count to it, and an edit's `write` is handed it. A new day read in
 * its place reads every row's cells again with no remount, the drafts kept: a
 * drafted field shows as read at the new day, and Undo takes each edit back
 * whatever day it was made at. Without `day`, the Record reads at the
 * viewer's own day, as before.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, encodeBeast2For, equalFor, printFor } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages } from "@elaraai/east-ui-components";
import { Data, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record-day";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record-day": ex }, frame: 2000 });
const plannedEqual = equalFor(ex.Crew.fields.planned);
const printPlanned = printFor(ex.Crew.fields.planned);
const encodeDay = encodeBeast2For(DateTimeType);

/** The Monday the example's page opens on, at UTC midnight. */
const MONDAY = new Date("2026-11-30T00:00:00Z");
/** The day after it. */
const TUESDAY = new Date("2026-12-01T00:00:00Z");

afterEach(() => { vi.useRealTimers(); });

/** The crew's hours on their machines, read at the viewer's own day: the example's Record, given no `day`. */
const plannedToday = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const crew = $.let(Record.bind(ex.recordDayCrew));
    const machineRows = $.let(Data.bind(ex.recordDayMachines));
    return Record({
        record: crew,
        title: "Planned hours",
        edits: { insertRows: false },
        registers: { machines: Record.register.members(machineRows.read(), { kind: "machine", key: (_m, code) => code, label: (m) => m.name }) },
        columns: {
            name: Record.column.title(ex.Crew, { header: "Name" }),
            planned: Record.column.quantity(ex.Crew, { each: "machines", unit: "hrs", read: ex.hoursOn, write: ex.withHours }),
            since_briefing: Record.column.age(ex.Crew, { header: "Since briefing", since: (c) => c.briefed, stale: 28n }),
        },
        name: "plannedToday",
    });
})));

/** A crew member's cell, by their key and the column's. */
const cell = (c: HTMLElement, id: string, key: string) =>
    c.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** The hours each named machine's cell holds on a crew member's row, as its figure reads — its unit drawn beside it; `""` for none. */
const hours = (c: HTMLElement, id: string, machines: readonly string[]) =>
    machines.map((machine) => cell(c, id, `planned:${machine}`).querySelector("[data-num]")?.textContent ?? "");
/** A crew member's days since their briefing, and whether they are stale. */
const sinceBriefing = (c: HTMLElement, id: string) => {
    const age = cell(c, id, "since_briefing").querySelector<HTMLElement>('[data-slot="age"]');
    return [age?.textContent, age?.hasAttribute("data-stale")];
};
/** The grid: what takes the keys, and the element a remount would replace. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** Whether a crew member's row holds a draft. */
const drafted = (c: HTMLElement, id: string) => c.querySelector(`[data-record] [data-slot="row"][data-row-id="${id}"]`)!.hasAttribute("data-draft");
/** A button of the history bar, by its name. */
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")!).getByRole<HTMLButtonElement>("button", { name });

/** The day the example's page keeps, written as its field writes it, and what that leads to settled. */
async function planFor(day: Date) {
    await act(async () => { StateRuntime.getStore().write("record_day_plan_day", encodeDay(day)); });
    await settle();
}

/** A crew member's hours on a machine, typed into its cell — the ring on it first — and committed with ⇥. */
async function typeHours(c: HTMLElement, id: string, machine: string, text: string) {
    const at = cell(c, id, `planned:${machine}`);
    fireEvent.mouseDown(at, { button: 0 });
    fireEvent.click(at);
    await settle();
    fireEvent.keyDown(grid(c), { key: text[0]! });
    await settle();
    const input = await waitFor(() => {
        const open = cell(c, id, `planned:${machine}`).querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(open).not.toBeNull();
        return open!;
    });
    fireEvent.input(input, { target: { value: text } });
    await settle();
    fireEvent.keyDown(input, { key: "Tab" });
    await settle();
}

describe("the page's day (#1746)", () => {
    test("the cells read at the page's day and the days since a briefing count to it; a new day in its place reads every row again, with no remount", async () => {
        const { container } = await h.mount(ex.recordPlannedHours, { storageKey: "record-day-reads" });
        const drawn = grid(container);
        expect([hours(container, "C-001", ["M-10", "M-11"]), hours(container, "C-002", ["M-20"]), hours(container, "C-003", ["M-21"])])
            .toEqual([["6", "2"], ["7.5"], [""]]);
        expect([sinceBriefing(container, "C-001"), sinceBriefing(container, "C-002"), sinceBriefing(container, "C-003")])
            .toEqual([["28", true], ["10", false], ["60", true]]);
        await planFor(TUESDAY);
        expect([hours(container, "C-001", ["M-10", "M-11"]), hours(container, "C-002", ["M-20"]), hours(container, "C-003", ["M-21"])])
            .toEqual([["8", ""], [""], ["4"]]);
        expect([sinceBriefing(container, "C-001"), sinceBriefing(container, "C-002"), sinceBriefing(container, "C-003")])
            .toEqual([["29", true], ["11", false], ["61", true]]);
        // The same grid, never mounted again.
        expect([grid(container) === drawn, drawn.isConnected]).toEqual([true, true]);
    });

    test("an edit's write is handed the page's day: Save writes that day's entry, the other days' as they were, and the Record mounted again reads it", async () => {
        const first = await h.mount(ex.recordPlannedHours, { storageKey: "record-day-writes" });
        await planFor(TUESDAY);
        await typeHours(first.container, "C-002", "M-21", "3");
        expect(hours(first.container, "C-002", ["M-20", "M-21"])).toEqual(["", "3"]);
        fireEvent.click(history(first.container, editingMessages.apply()));
        await waitFor(async () => expect(drafted(first.container, "C-002")).toBe(false));
        const saved = (await h.read(ex.recordDayCrew)).get("C-002")!.planned;
        expect(plannedEqual(saved, [
            { day: MONDAY, machine: "M-20", hours: 7.5 },
            { day: TUESDAY, machine: "M-21", hours: 3.0 },
        ]), printPlanned(saved)).toBe(true);
        // Mounted again: Tuesday's entry read back from e3, at the day the page still keeps; Monday's as it was.
        first.unmount();
        const { container } = await h.mount(ex.recordPlannedHours, { storageKey: "record-day-writes" });
        expect(hours(container, "C-002", ["M-20", "M-21"])).toEqual(["", "3"]);
        await planFor(MONDAY);
        expect(hours(container, "C-002", ["M-20", "M-21"])).toEqual(["7.5", ""]);
    });

    test("a new day in its place keeps the drafts: a drafted field shows as read at the new day, and Undo takes each edit back whatever day it was made at", async () => {
        const { container } = await h.mount(ex.recordPlannedHours, { storageKey: "record-day-drafts" });
        await typeHours(container, "C-001", "M-10", "9");
        expect([hours(container, "C-001", ["M-10", "M-11"]), drafted(container, "C-001")]).toEqual([["9", "2"], true]);
        // Tuesday: the draft is the row's field, so the row shows Tuesday's entries as it holds them — its draft kept.
        await planFor(TUESDAY);
        expect([hours(container, "C-001", ["M-10", "M-11"]), drafted(container, "C-001")]).toEqual([["8", ""], true]);
        await typeHours(container, "C-001", "M-11", "1");
        expect(hours(container, "C-001", ["M-10", "M-11"])).toEqual(["8", "1"]);
        await planFor(MONDAY);
        expect(hours(container, "C-001", ["M-10", "M-11"])).toEqual(["9", "2"]);
        // Undo takes back Tuesday's edit, made at another day than the one shown…
        await act(async () => { fireEvent.click(history(container, editingMessages.undo())); });
        await settle();
        await planFor(TUESDAY);
        expect([hours(container, "C-001", ["M-10", "M-11"]), drafted(container, "C-001")]).toEqual([["8", ""], true]);
        // …and then Monday's: nothing is left drafted.
        await act(async () => { fireEvent.click(history(container, editingMessages.undo())); });
        await settle();
        await planFor(MONDAY);
        expect([hours(container, "C-001", ["M-10", "M-11"]), drafted(container, "C-001")]).toEqual([["6", "2"], false]);
    });

    test("without `day`, the Record reads at the viewer's own day: its cells and its ages the clock's date's, as before", async () => {
        // Ten in the morning of the Tuesday where the viewer is.
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date(2026, 11, 1, 10, 0));
        const { container } = await h.mount({ fn: plannedToday }, { storageKey: "record-day-clock" });
        expect([hours(container, "C-001", ["M-10", "M-11"]), hours(container, "C-003", ["M-21"])]).toEqual([["8", ""], ["4"]]);
        expect([sinceBriefing(container, "C-001"), sinceBriefing(container, "C-002")]).toEqual([["29", true], ["11", false]]);
    });
});
