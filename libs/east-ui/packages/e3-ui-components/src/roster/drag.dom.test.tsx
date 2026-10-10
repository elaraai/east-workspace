/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, assignment, mount, rosterHarness, settle, slot, START } from "./harness.test-utils.js";
const h = rosterHarness();
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
const action = (c: HTMLElement, name: string) => press(within(slot(c, "toolbar")).getByRole("button", { name }));
const cell = (c: HTMLElement, group: string, shift: string) => [...slot(c, "main").querySelectorAll<HTMLElement>("[data-roster-slot]")].find(el => el.dataset.rosterSlot?.includes("day=4,") && el.dataset.rosterSlot?.includes(`group="${group}"`) && el.dataset.rosterSlot?.includes(`shift="${shift}"`))!;
const libraryCard = (c: HTMLElement, name: string) => [...slot(c, "start").querySelectorAll<HTMLElement>("[data-library-item]")].find(el => el.textContent?.includes(name))!;
async function hover(from: Element, into: Element) {
    expect(from).toBeDefined(); expect(into).toBeDefined();
    await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
    await settle();
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
}
async function release() { await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); }); await settle(); }
async function drop(from: Element, into: Element) { await hover(from, into); await release(); }

describe("Roster shared drag layer", () => {
    test("a chip refuses its own slot; a cross-group move clears activity and is one undoable checked patch", async () => {
        const { container: c } = mount(ex.rosterWarehouse); await settle();
        await hover(assignment(c, "s37"), cell(c, "inbound", "early"));
        expect(cell(c, "inbound", "early").hasAttribute("data-drop-invalid")).toBe(true); await release();
        expect(assignment(c, "s37").hasAttribute("data-drafted")).toBe(false);
        await hover(assignment(c, "s37"), cell(c, "inbound", "night"));
        expect(cell(c, "inbound", "night").dataset.rosterLandingTone).toBe("warning");
        expect(cell(c, "inbound", "night").querySelector("[data-roster-landing]")?.textContent).toContain("rest");
        await act(async () => { fireEvent.keyDown(document, { key: "Escape", code: "Escape" }); }); await settle();
        await drop(assignment(c, "s37"), cell(c, "picking", "late"));
        expect(cell(c, "picking", "late").contains(assignment(c, "s37"))).toBe(true);
        await action(c, "Undo"); expect(cell(c, "inbound", "early").contains(assignment(c, "s37"))).toBe(true);
        await action(c, "Redo"); await action(c, "Save");
        const saved = h.read(ex.rosterWeeks).get(START)!.assignments.get("s37")!;
        expect(saved.slot).toEqual({ day: 4n, group: "picking", shift: "late" }); expect(saved.activity.type).toBe("none");
    });
    test("a person's library card accepts their proposal, moves their assignment and restores their original identity", async () => {
        const { container: c } = mount(ex.rosterWarehouse); await settle();
        await drop(libraryCard(c, "N. Ochre"), cell(c, "inbound", "night"));
        expect(slot(c, "main").querySelector('[data-roster-proposal="s317"]')).toBeNull();
        await action(c, "Undo"); expect(slot(c, "main").querySelector('[data-roster-proposal="s317"]')).not.toBeNull();
        await drop(libraryCard(c, "C. Clover"), cell(c, "inbound", "late"));
        expect(cell(c, "inbound", "late").contains(assignment(c, "s37"))).toBe(true);
        await action(c, "Undo");
        await press(within(assignment(c, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await drop(libraryCard(c, "C. Clover"), cell(c, "inbound", "early"));
        expect(assignment(c, "s37").hasAttribute("data-removed")).toBe(false);
        expect(assignment(c, "s37").hasAttribute("data-drafted")).toBe(false);
    });
    test("Week view accepts a person into the original day key as one gesture", async () => {
        const { container: c } = mount(ex.rosterWeek); await settle();
        expect(slot(c, "main").querySelectorAll("[data-roster-slot]")).toHaveLength(63);
        await drop(libraryCard(c, "N. Ochre"), cell(c, "inbound", "night"));
        await action(c, "Undo"); await action(c, "Redo"); await action(c, "Save");
        const saved = h.read(ex.rosterWeeks).get(START)!;
        expect(saved.dismissed.has("s317")).toBe(true);
        expect([...saved.assignments.values()].filter(a => a.who.type === "person" && a.who.value === "nochre" && a.slot.day === 4n)).toHaveLength(1);
    });
    test("an agency request fills a slot but refuses an activity", async () => {
        const { container: c } = mount(ex.rosterWarehouse); await settle();
        const original = h.read(ex.rosterWeeks).get(START)!.assignments;
        await drop(libraryCard(c, "Northside Staffing"), cell(c, "inbound", "night"));
        const request = slot(c, "main").querySelector<HTMLElement>('[data-roster-assignment][data-request][data-drafted]')!;
        expect(request).not.toBeNull();
        await press(within(slot(c, "start")).getByRole("tab", { name: "Activities 17" }));
        await hover(libraryCard(c, "Unloading"), request);
        expect(request.hasAttribute("data-drop-invalid")).toBe(true); await release();
        await action(c, "Save");
        const added = [...h.read(ex.rosterWeeks).get(START)!.assignments].filter(([key]) => !original.has(key)).map(([, value]) => value);
        expect(added).toHaveLength(1); expect(added[0]!.activity.type).toBe("none");
        expect(added[0]!.position).toBe([...h.read(ex.rosterConfiguration).positions.values()].find(p => !p.lead)!.key);
    });
    test("activity and author cards apply to a named chip, refuse cells, and use the same Save", async () => {
        const { container: c } = mount(ex.rosterWarehouse); await settle();
        await press(within(slot(c, "start")).getByRole("tab", { name: "Activities 17" }));
        await hover(libraryCard(c, "Unloading"), cell(c, "inbound", "early"));
        expect(cell(c, "inbound", "early").hasAttribute("data-drop-invalid")).toBe(true); await release();
        await hover(libraryCard(c, "Unloading"), assignment(c, "s226"));
        expect(assignment(c, "s226").hasAttribute("data-drop-invalid")).toBe(true); await release();
        await drop(libraryCard(c, "Unloading"), assignment(c, "s37"));
        await press(within(slot(c, "start")).getByRole("tab", { name: "Positions 4" }));
        await hover(libraryCard(c, "Supervisor"), cell(c, "inbound", "early"));
        expect(cell(c, "inbound", "early").hasAttribute("data-drop-invalid")).toBe(true); await release();
        await drop(libraryCard(c, "Supervisor"), assignment(c, "s37"));
        await action(c, "Save");
        const saved = h.read(ex.rosterWeeks).get(START)!.assignments.get("s37")!;
        expect(saved.activity.type === "some" && saved.activity.value).toBe("unload"); expect(saved.position).toBe("lead");
    });
});
