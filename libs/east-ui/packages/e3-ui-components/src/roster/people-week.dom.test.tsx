/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The People layout by week (#1406) on e3 itself: a tile a duty, its words
 * under both `tileTimes`; `+1` for a second duty the same day; the week's
 * hours in the name cell; `+ Assign` on an off day and its menu, one gesture;
 * a name selecting the person-week, which the inspector reads.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, assignment, at, cell, drop, history, press, rosterHarness, settle, slot } from "./harness.test-utils.js";
const h = rosterHarness();
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
/** A person's day cell in the week grid. */
const day = (c: HTMLElement, person: string, d: number) => slot(c, "main").querySelector<HTMLElement>(`[data-roster-person-day="${person}.${d}"]`)!;
/** A duty's tile in the week grid. */
const tile = (c: HTMLElement, id: string) => slot(c, "main").querySelector<HTMLElement>(`[data-roster-tile][data-roster-assignment="${id}"]`)!;
/**
 * Brings C. Clover's row into view in People: his Thursday duty picked on the Shifts board, which the People grid scrolls
 * to as it mounts, as a pick does (#1398).
 */
async function showClover(c: HTMLElement): Promise<void> {
    await press(toolbar(c).getByRole("radio", { name: "Shifts" }));
    await press(assignment(c, "s37"));
    await press(toolbar(c).getByRole("radio", { name: "People" }));
    await waitFor(() => expect(tile(c, "s37")).not.toBeNull());
}

describe("the People week grid (#1406)", () => {
    test("a tile is the shift's label and, with tileTimes always, the shift's hours; with different, nothing more until a duty's own times differ — then those, in their own voice (D5, P6)", async () => {
        // rosterWarehouse leaves tileTimes at its default, always.
        const first = await h.mount(ex.rosterWarehouse);
        await showClover(first.container);
        const always = tile(first.container, "s37");
        expect(always.querySelector("[data-roster-assignment-name]")!.textContent).toBe("Early");
        expect(always.textContent).toBe("Early06–14");
        expect(always.querySelector("[data-roster-times]")).toBeNull();
        first.unmount();
        // rosterPeople asks for the hours only where they differ.
        const { container: c } = await h.mount(ex.rosterPeople);
        await showClover(c);
        expect(tile(c, "s37").textContent).toBe("Early");
        // Another session starts C. Clover an hour early: the tile says his own times.
        const newer = await h.read(ex.rosterDuties);
        newer.set("s37", { ...newer.get("s37")!, start: at("2028-03-09T05:00:00") });
        await h.patch(ex.rosterDuties, newer);
        await waitFor(() => expect(tile(c, "s37").querySelector("[data-roster-times]")?.textContent).toBe("05–14"));
        expect(tile(c, "s37").textContent).toBe("Early05–14");
    });
    test("a duty in another group than the person's names the group on its tile, uppercase, in place of the hours (D5)", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await drop(assignment(c, "s37"), cell(c, 4, "picking", "late"));
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        await waitFor(() => expect(tile(c, "s37")).not.toBeNull());
        const moved = tile(c, "s37");
        expect(moved.hasAttribute("data-moved")).toBe(true);
        expect(moved.hasAttribute("data-drafted")).toBe(true);
        expect(moved.querySelector("[data-group]")!.textContent).toBe("PICKING");
        expect(moved.textContent).toBe("LatePICKING");
    });
    test("two duties on one day show the first tile and `+1`, and the row stays one line (D5, P6)", async () => {
        const { container: c } = await h.mount(ex.rosterPeople);
        await showClover(c);
        // Another session gives C. Clover a Late as well as his Early on Thursday.
        const newer = await h.read(ex.rosterDuties);
        newer.set("s37-late", { ...newer.get("s37")!, shift: "late", start: at("2028-03-09T14:00:00"), end: at("2028-03-09T22:00:00") });
        await h.patch(ex.rosterDuties, newer);
        await waitFor(() => expect(day(c, "cclover", 4).querySelector("[data-roster-more]")).not.toBeNull());
        const thursday = day(c, "cclover", 4);
        expect(thursday.querySelectorAll("[data-roster-tile]")).toHaveLength(1);
        expect(thursday.querySelector("[data-roster-tile] [data-roster-assignment-name]")!.textContent).toBe("Early");
        expect(thursday.querySelector("[data-roster-more]")!.textContent).toBe("+1");
        expect(thursday.querySelector("[data-roster-more]")!.getAttribute("data-roster-more")).toBe("1");
    });
    test("the name cell carries the week's hours against the contract — the cost beside them with pay — over a meter; the row is the name cell and seven days, no trailing hours column (D8, P5)", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await showClover(c);
        const row = slot(c, "main").querySelector<HTMLElement>('[data-roster-person-row="cclover"]')!;
        const hours = row.querySelector<HTMLElement>("[data-roster-week-hours]")!;
        // The cost in the Roster's currency, compact where it heads the row (`A$1.8K`).
        expect(hours.textContent).toMatch(/^[\d,.]+ \/ [\d,.]+ h · A\$[\d,.]+[KM]?$/);
        expect(row.querySelector("[data-roster-meter]")).not.toBeNull();
        expect(row.querySelector("[data-roster-person-name]")!.contains(hours)).toBe(true);
        expect(row.querySelectorAll("[data-roster-person-day]")).toHaveLength(7);
        expect(row.children).toHaveLength(8);
        // Without pay, the hours alone.
        const { container: plain } = await h.mount(ex.rosterPeople);
        await showClover(plain);
        expect(plain.querySelector('[data-roster-person-row="cclover"] [data-roster-week-hours]')!.textContent).toMatch(/^[\d,.]+ \/ [\d,.]+ h$/);
    });
    test("`+ Assign` on an off day opens a menu of the shifts — each its label, swatch and times, then Elsewhere… — and a choice places the person on it in their home group as one undoable gesture (D9, P8)", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        await waitFor(() => expect(slot(c, "main").querySelector("[data-roster-assign]")).not.toBeNull());
        const trigger = slot(c, "main").querySelector<HTMLElement>("[data-roster-assign]")!;
        const [person, d] = trigger.getAttribute("data-roster-assign")!.split(".") as [string, string];
        expect(trigger.textContent).toBe("+ Assign");
        expect(trigger.hasAttribute("data-roster-off")).toBe(true);
        // The menu opens on the trigger's click, in a portal: a shift an item, each its swatch, label and times, then Elsewhere….
        await press(trigger);
        await waitFor(() => expect(screen.queryAllByRole("menuitem").length).toBeGreaterThan(0));
        const items = screen.getAllByRole("menuitem");
        expect(items.map(item => item.getAttribute("data-roster-assign-shift"))).toEqual(["early", "late", "night", null]);
        expect(items.slice(0, 3).map(item => item.querySelector("[data-roster-shift-times]")!.textContent)).toEqual(["06–14", "14–22", "22–06"]);
        expect(items.slice(0, 3).every(item => item.querySelector("[data-roster-shift-times]")!.previousElementSibling!.textContent !== "")).toBe(true);
        expect(items[3]!.textContent).toBe("Elsewhere…");
        // Picked as a pointer does: pressed on the item, then its click.
        const late = items[1]!;
        await act(async () => { fireEvent.pointerDown(late); });
        await act(async () => { fireEvent.click(late); });
        await settle();
        const placed = await waitFor(() => { const el = day(c, person, Number(d)).querySelector<HTMLElement>("[data-roster-tile][data-added]"); expect(el).not.toBeNull(); return el!; });
        expect(placed.querySelector("[data-roster-assignment-name]")!.textContent).toBe("Late");
        expect(placed.querySelector("[data-group]")).toBeNull();
        expect(day(c, person, Number(d)).querySelector("[data-roster-assign]")).toBeNull();
        // One gesture: one Undo puts the day off again.
        await press(history(c, editingMessages.undo()));
        expect(day(c, person, Number(d)).querySelector("[data-roster-tile]")).toBeNull();
        expect(day(c, person, Number(d)).querySelector("[data-roster-assign]")).not.toBeNull();
    });
    test("a click on a name selects the person-week: the row's cells outlined, the inspector's Details over that week; Esc clears it (D11, P5, P10)", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await showClover(c);
        await press(slot(c, "main").querySelector('[data-roster-person-head="cclover"]'));
        const cells = [...slot(c, "main").querySelectorAll('[data-roster-person-row="cclover"] [data-roster-person-day]')];
        expect(cells).toHaveLength(7);
        expect(cells.every(cell => cell.hasAttribute("data-week-selected"))).toBe(true);
        expect(slot(c, "main").querySelector('[data-roster-person-row="cclover"] [data-roster-person-name]')!.hasAttribute("data-selected")).toBe(true);
        const end = slot(c, "end");
        expect(end.querySelector("[data-inspector-title]")!.textContent).toBe("C. Clover");
        expect(end.textContent).toContain("W10");
        await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "Escape" }); }); await settle();
        expect(slot(c, "main").querySelector("[data-week-selected]")).toBeNull();
    });
});
