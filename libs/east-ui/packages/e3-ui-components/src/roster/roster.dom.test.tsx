/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, assignment, card, narrow, open, rosterHarness, settle, slot, START, width, type Choice } from "./harness.test-utils.js";
const h = rosterHarness();
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole("button", { name });
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
/** The weeks' commits, newest first, by the mutation that made each. */
const commits = async () => (await h.history(ex.rosterWeeks)).commits.map(c => c.mutation);

describe("Roster in the shared record-backed frame", () => {
    test("the warehouse has the mock's staff, shift columns, coverage, proposals and library tabs", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        expect(container.querySelectorAll("[data-builder-frame]")).toHaveLength(1);
        expect(assignment(container, "s37").textContent).toContain("C. Clover");
        expect(slot(container, "main").querySelectorAll("[data-roster-proposal]")).toHaveLength(2);
        expect([...slot(container, "start").querySelectorAll('[role="tab"]')].map(t => t.textContent)).toEqual(["People 69", "Activities 17", "Positions 4"]);
        expect(slot(container, "main").textContent).toContain("Inbound");
        expect(slot(container, "main").textContent).toContain("Early");
        expect((await h.read(ex.rosterWeeks)).get(START)!.assignments.size).toBe(316);
        expect(container.querySelectorAll("[data-roster-legend]")).toHaveLength(6);
        const footer = container.querySelector("[data-roster-footer]")!;
        expect([...footer.children].every(item => item.hasAttribute("data-roster-legend"))).toBe(true);
        expect(slot(container, "end").textContent).toContain("budget");
        await press(within(slot(container, "main")).getByRole("button", { name: "N. Ochre" }));
        expect(slot(container, "end").textContent).toContain((await h.read(ex.rosterProposals)).find(p => p.key === "s317")!.reason);
        expect(within(slot(container, "end")).getByRole("button", { name: "Accept proposal" })).not.toBeNull();
    });
    test("Remove, Undo, Redo and Save patch the week atomically through the shared Session", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        const deployed = await commits();
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect((await h.read(ex.rosterWeeks)).get(START)!.assignments.has("s37")).toBe(true);
        await press(history(container, editingMessages.undo()));
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(false);
        await press(history(container, editingMessages.redo()));
        await press(history(container, editingMessages.apply()));
        expect((await h.read(ex.rosterWeeks)).get(START)!.assignments.has("s37")).toBe(false);
        expect(assignment(container, "s37")).toBeNull();
        expect(await commits()).toEqual(["patch", ...deployed]);
    });
    test("mobile uses explicit actions, preserves selection and drafts across resize, and registers no drag affordances", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
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
        expect((await h.read(ex.rosterWeeks)).get(START)!.assignments.has("s37")).toBe(true);
    });
    test("the people source narrows visible staff by their original keys while coverage and issues remain complete", async () => {
        const { container, store } = await open(ex.rosterWarehouse);
        const before = [...container.querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute("aria-label"));
        await narrow(store, "rosterWarehouse", "people", new Map<string, Choice>([["name", variant("prefix", "C. Clo")]]));
        const people = [...container.querySelectorAll('[data-roster-assignment]:not([data-request])')];
        expect(people).toHaveLength(1); expect(people[0]!.getAttribute("data-roster-assignment")).toBe("s37");
        expect([...container.querySelectorAll('[role="img"][aria-label]')].map(e => e.getAttribute("aria-label"))).toEqual(before);
        expect(container.querySelectorAll("[data-roster-legend]")).toHaveLength(6);
        expect((await h.read(ex.rosterWeeks)).get(START)!.assignments.size).toBe(316);
    });
    test("People hides the fixed period and returning to Shifts restores its chosen period", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        const toolbar = within(slot(container, "toolbar"));
        for (const name of ["Day", "Week"]) {
            await press(toolbar.getByRole("radio", { name }));
            await press(toolbar.getByRole("radio", { name: "People" }));
            expect(toolbar.queryByRole("radiogroup", { name: "Period" })).toBeNull();
            expect(container.querySelector('[data-roster-grid="people"]')).not.toBeNull();
            await press(toolbar.getByRole("radio", { name: "Shifts" }));
            expect(toolbar.getByRole("radio", { name }).getAttribute("aria-checked")).toBe("true");
            expect(container.querySelectorAll("[data-roster-slot]")).toHaveLength(name === "Day" ? 9 : 63);
        }
    });
    test("published weeks retain navigation and inspection with no editing or drag sources", async () => {
        const { container } = await h.mount(ex.rosterPublished);
        expect(container.querySelector("[data-roster-readonly]")).not.toBeNull();
        expect(container.querySelector("[data-roster-grip], [data-roster-chip-action]")).toBeNull();
        expect(within(slot(container, "toolbar")).queryByRole("button", { name: editingMessages.apply() })).toBeNull();
        expect(slot(container, "main").textContent).toContain("D. Bracken");
    });
});
