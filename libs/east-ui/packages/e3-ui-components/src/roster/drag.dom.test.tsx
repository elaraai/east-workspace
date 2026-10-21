/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { DateTimeType, IntegerType, SortedMap, StringType, compareFor, equalFor, none, toEastTypeValue } from "@elaraai/east";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, assignment, at, cell, drop, hover, libraryCard, press, release, rosterHarness, settle, slot, START, warehouseRoster } from "./harness.test-utils.js";
import { rosterDomain } from "./model.js";
const h = rosterHarness();
const action = (c: HTMLElement, name: string) => press(within(slot(c, "toolbar")).getByRole("button", { name }));
const byDate = compareFor(DateTimeType);
const byInteger = compareFor(IntegerType);

describe("Roster shared drag layer", () => {
    test("a chip refuses its own slot; a cross-group move clears activity, keeps its times against the shift's, and is one undoable checked patch", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await hover(assignment(c, "s37"), cell(c, 4, "inbound", "early"));
        expect(cell(c, 4, "inbound", "early").hasAttribute("data-drop-invalid")).toBe(true); await release();
        expect(assignment(c, "s37").hasAttribute("data-drafted")).toBe(false);
        await hover(assignment(c, "s37"), cell(c, 4, "inbound", "night"));
        expect(cell(c, 4, "inbound", "night").dataset.rosterLandingTone).toBe("warning");
        expect(cell(c, 4, "inbound", "night").querySelector("[data-roster-landing]")?.textContent).toContain("rest");
        await act(async () => { fireEvent.keyDown(document, { key: "Escape", code: "Escape" }); }); await settle();
        await drop(assignment(c, "s37"), cell(c, 4, "picking", "late"));
        expect(cell(c, 4, "picking", "late").contains(assignment(c, "s37"))).toBe(true);
        await action(c, "Undo"); expect(cell(c, 4, "inbound", "early").contains(assignment(c, "s37"))).toBe(true);
        await action(c, "Redo"); await action(c, "Save");
        const saved = (await h.read(ex.rosterDuties)).get("s37")!;
        expect([saved.team, saved.shift, saved.task]).toEqual(["picking", "late", none]);
        expect([saved.start, saved.end]).toEqual([at("2028-03-09T14:00:00"), at("2028-03-09T22:00:00")]);
    });
    test("hover checks a destination once, agrees with the full week, and checks again once the duties change", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        const domain = rosterDomain(toEastTypeValue(ex.WarehouseDuty));
        const check = domain.check;
        const calls = vi.spyOn(domain, "check");
        const original = await h.read(ex.rosterDuties);
        await hover(assignment(c, "s37"), cell(c, 4, "inbound", "night"));
        expect(calls).toHaveBeenCalledTimes(1);
        const [scoped, context] = calls.mock.calls[0]!;
        // The full week, as the Roster reads the warehouse's: the candidate in its place.
        const full = { ...ex.warehouseWeek, assignments: new SortedMap(ex.warehouseWeek.assignments, compareFor(StringType)) };
        full.assignments.set("s37", scoped.assignments.get("s37")!);
        const issue = check(full, context).find(i => i.kind.type === "breach" && i.assignment.type === "some" && i.assignment.value === "s37")!;
        expect(cell(c, 4, "inbound", "night").querySelector("[data-roster-landing]")?.textContent).toContain(issue.title);
        for (let x = 13; x < 18; x++) {
            await act(async () => { pointAt(cell(c, 4, "inbound", "night")); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: x, clientY: 12 }); });
            await settle();
        }
        expect(calls).toHaveBeenCalledTimes(1);
        expect(equalFor(ex.rosterDuties.type)(await h.read(ex.rosterDuties), original)).toBe(true);
        // Another session takes C. Clover's Friday off: a night shift on Thursday leaves him his rest.
        const newer = await h.read(ex.rosterDuties); newer.delete("s41");
        await h.patch(ex.rosterDuties, newer);
        await act(async () => { pointAt(cell(c, 4, "inbound", "night")); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 18, clientY: 12 }); });
        await settle();
        expect(cell(c, 4, "inbound", "night").querySelector("[data-roster-landing]")?.textContent).not.toContain("rest");
        await act(async () => { fireEvent.keyDown(document, { key: "Escape", code: "Escape" }); }); await settle();
        expect(equalFor(ex.rosterDuties.type)(await h.read(ex.rosterDuties), newer)).toBe(true);
    });
    test("a drop keeps the inspector collapsed while an explicit inspection click opens it", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await press(within(c).getByRole("button", { name: "Collapse Inspector" }));
        await drop(assignment(c, "s37"), cell(c, 4, "inbound", "late"));
        expect(assignment(c, "s37").hasAttribute("data-selected")).toBe(true);
        expect(within(c).getByRole("button", { name: "Expand Inspector" })).not.toBeNull();
        await press(assignment(c, "s37"));
        expect(within(c).getByRole("button", { name: "Collapse Inspector" })).not.toBeNull();
        expect(slot(c, "end").textContent).toContain("C. Clover");
    });
    test("a person's library card accepts their proposal, moves their duty and restores their original identity", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await drop(await libraryCard(c, "N. Ochre"), cell(c, 4, "inbound", "night"));
        expect(slot(c, "main").querySelector('[data-roster-proposal="s317"]')).toBeNull();
        await action(c, "Undo"); expect(slot(c, "main").querySelector('[data-roster-proposal="s317"]')).not.toBeNull();
        await drop(await libraryCard(c, "C. Clover"), cell(c, 4, "inbound", "late"));
        expect(cell(c, 4, "inbound", "late").contains(assignment(c, "s37"))).toBe(true);
        await action(c, "Undo");
        await press(within(assignment(c, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await drop(await libraryCard(c, "C. Clover"), cell(c, 4, "inbound", "early"));
        expect(assignment(c, "s37").hasAttribute("data-removed")).toBe(false);
        expect(assignment(c, "s37").hasAttribute("data-drafted")).toBe(false);
    });
    test("Week view accepts a person into the original day key as one gesture", async () => {
        const { container: c } = await h.mount(ex.rosterWeek);
        expect(slot(c, "main").querySelectorAll("[data-roster-slot]")).toHaveLength(63);
        await drop(await libraryCard(c, "N. Ochre"), cell(c, 4, "inbound", "night"));
        await action(c, "Undo"); await action(c, "Redo"); await action(c, "Save");
        expect((await h.read(ex.rosterWeeks)).get(START)!.dismissed.has("s317")).toBe(true);
        const thursday = at("2028-03-09T00:00:00"), friday = at("2028-03-10T00:00:00");
        expect([...(await h.read(ex.rosterDuties)).values()].filter(duty => duty.who.type === "staff" && duty.who.value === "nochre"
            && byDate(duty.start, thursday) >= 0 && byDate(duty.start, friday) < 0)).toHaveLength(1);
    });
    test("an agency request fills a slot but refuses an activity", async () => {
        // The warehouse's roster with no check of its own on a draft: a request saves with no cost centre given.
        const { container: c } = await h.mount(warehouseRoster());
        const original = await h.read(ex.rosterDuties);
        await drop(await libraryCard(c, "Northside Staffing"), cell(c, 4, "inbound", "night"));
        const request = slot(c, "main").querySelector<HTMLElement>('[data-roster-assignment][data-request][data-drafted]')!;
        expect(request).not.toBeNull();
        await press(within(slot(c, "start")).getByRole("tab", { name: "Activities 17" }));
        await hover(await libraryCard(c, "Unloading"), request);
        expect(request.hasAttribute("data-drop-invalid")).toBe(true); await release();
        await action(c, "Save");
        const added = [...(await h.read(ex.rosterDuties))].filter(([key]) => !original.has(key)).map(([, value]) => value);
        expect(added).toHaveLength(1); expect(added[0]!.task.type).toBe("none");
        // A request holds the first position that leads no one, in the positions' order.
        const positions = [...(await h.read(ex.rosterPositions))].sort(([, a], [, b]) => byInteger(a.order, b.order));
        expect(added[0]!.role).toBe(positions.find(([, position]) => !position.lead)![0]);
    });
    test("activity and author cards apply to a named chip, refuse cells, and use the same Save", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await press(within(slot(c, "start")).getByRole("tab", { name: "Activities 17" }));
        await hover(await libraryCard(c, "Unloading"), cell(c, 4, "inbound", "early"));
        expect(cell(c, 4, "inbound", "early").hasAttribute("data-drop-invalid")).toBe(true); await release();
        await hover(await libraryCard(c, "Unloading"), assignment(c, "s226"));
        expect(assignment(c, "s226").hasAttribute("data-drop-invalid")).toBe(true); await release();
        await drop(await libraryCard(c, "Unloading"), assignment(c, "s37"));
        await press(within(slot(c, "start")).getByRole("tab", { name: "Positions 4" }));
        await hover(await libraryCard(c, "Supervisor"), cell(c, 4, "inbound", "early"));
        expect(cell(c, 4, "inbound", "early").hasAttribute("data-drop-invalid")).toBe(true); await release();
        await drop(await libraryCard(c, "Supervisor"), assignment(c, "s37"));
        await action(c, "Save");
        const saved = (await h.read(ex.rosterDuties)).get("s37")!;
        expect(saved.task.type === "some" && saved.task.value).toBe("unload"); expect(saved.role).toBe("lead");
    });
});
