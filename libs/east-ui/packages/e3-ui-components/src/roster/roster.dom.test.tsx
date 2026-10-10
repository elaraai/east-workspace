/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, builderHarness, mount, settle, slot, width } from "../shared/builder-harness.test-utils.js";
import "./index.js";
const WORKSPACE = "roster-test";
const h = builderHarness(WORKSPACE, [ex.rosterWeeks, ex.rosterStaff, ex.rosterConfiguration, ex.rosterForecast, ex.rosterProposals], "data-roster-main");
const START = new Date("2028-03-05T00:00:00Z");
const assignment = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-roster-assignment="${id}"]`)!;
const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-roster-card="${id}"]`)!;
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole("button", { name });
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }

describe("Roster in the shared record-backed frame", () => {
    test("the warehouse has the mock's staff, shift columns, coverage, proposals and library tabs", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        expect(container.querySelectorAll("[data-builder-frame]")).toHaveLength(1);
        expect(assignment(container, "s37").textContent).toContain("C. Clover");
        expect(slot(container, "main").querySelectorAll("[data-roster-proposal]")).toHaveLength(2);
        expect([...slot(container, "start").querySelectorAll('[role="tab"]')].map(t => t.textContent)).toEqual(["People 70", "Activities 17", "Positions 4"]);
        expect(slot(container, "main").textContent).toContain("Inbound");
        expect(slot(container, "main").textContent).toContain("Early");
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.size).toBe(316);
        expect(container.querySelectorAll("[data-roster-legend]")).toHaveLength(6);
        expect(container.querySelector("[data-roster-hours]")?.textContent).toContain("Day");
        expect(container.querySelector("[data-roster-cost]")?.textContent).toContain("budget");
        await press(within(slot(container, "main")).getByRole("button", { name: "N. Ochre" }));
        expect(slot(container, "end").textContent).toContain(h.read(ex.rosterProposals).find(p => p.key === "s317")!.reason);
        expect(within(slot(container, "end")).getByRole("button", { name: "Accept proposal" })).not.toBeNull();
    });
    test("Remove, Undo, Redo and Save patch the week atomically through the shared Session", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.has("s37")).toBe(true);
        await press(history(container, editingMessages.undo()));
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(false);
        await press(history(container, editingMessages.redo()));
        await press(history(container, editingMessages.apply()));
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.has("s37")).toBe(false);
        expect(assignment(container, "s37")).toBeNull();
        expect((await h.memory.history(WORKSPACE, ex.rosterWeeks.name, undefined)).commits.map(c => c.mutation)).toEqual(["patch", "$init"]);
    });
    test("mobile uses explicit actions, preserves selection and drafts across resize, and registers no drag affordances", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        await press(assignment(container, "s37")); await width(479);
        expect(container.querySelector("[data-roster-agenda]")).not.toBeNull();
        expect(container.querySelector("[data-roster-slot], [data-roster-grip], [data-roster-assignment][data-draggable]")).toBeNull();
        expect(card(container, "s37").hasAttribute("data-selected")).toBe(true);
        await press(within(card(container, "s37")).getByRole("button", { name: "Remove" }));
        expect(within(card(container, "s37")).getByRole("button", { name: "Restore" })).not.toBeNull();
        await width(480);
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        await press(history(container, editingMessages.undo()));
        await width(360);
        expect(within(card(container, "s37")).getByRole("button", { name: "Move" })).not.toBeNull();
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.has("s37")).toBe(true);
    });
    test("Slice narrows visible staff by their original keys while coverage and issues remain complete", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        const before = [...container.querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute("aria-label"));
        const user = userEvent.setup();
        await user.type(within(slot(container, "toolbar")).getByPlaceholderText("Search…"), "Clover"); await settle();
        const people = [...container.querySelectorAll('[data-roster-assignment]:not([data-request])')];
        expect(people).toHaveLength(1); expect(people[0]!.getAttribute("data-roster-assignment")).toBe("s37");
        expect([...container.querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute("aria-label"))).toEqual(before);
        expect(container.querySelector("[data-roster-footer]")?.textContent).toContain("1 of 69 people visible");
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.size).toBe(316);
    });
    test("published weeks retain navigation and inspection with no editing or drag sources", async () => {
        const { container } = mount(ex.rosterPublished); await settle();
        expect(container.querySelector("[data-roster-readonly]")).not.toBeNull();
        expect(container.querySelector("[data-roster-grip], [data-roster-chip-action]")).toBeNull();
        expect(within(slot(container, "toolbar")).queryByRole("button", { name: editingMessages.apply() })).toBeNull();
        expect(slot(container, "main").textContent).toContain("D. Bracken");
    });
});
