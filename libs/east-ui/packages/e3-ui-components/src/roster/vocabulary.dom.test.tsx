/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The app's own words for who is on the Roster (#1516), on e3: each `vocabulary` entry given replaces its default word
 * wherever the Roster draws it, and the People tab keeps its groups' order whatever they are called.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, open, rosterHarness, settle, slot } from "./harness.test-utils.js";

rosterHarness();
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
/** The words the Roster draws of its own, none of which may show once the app gives its own. */
const DEFAULTS = /\bPermanent\b|Agency staff|agency staff|\bAssociates\b|\bLeads\b|\bTrainers\b|· available|\bperm\b/u;

describe("a Roster's vocabulary", () => {
    test("the legend, the coverage detail, the inspector and the People tab's groups say the app's words, in the groups' own order", async () => {
        const { container: c } = await open(ex.rosterVocabulary);
        expect(c.querySelector('[data-roster-legend="permanent"]')!.textContent).toBe("Employees");
        expect(c.querySelector('[data-roster-legend="agency"]')!.textContent).toBe("Contractors");
        expect(slot(c, "main").textContent).toMatch(/\bempl\b/u);
        await press(slot(c, "main").querySelector("[data-roster-requirement]"));
        await waitFor(() => expect(slot(c, "end").textContent).toContain("Employees · Contractors · Requested"));
        const people = c.querySelector<HTMLElement>('[data-roster-library="people"]')!;
        const groups = [...people.querySelectorAll("[data-library-head]")].map(el => el.textContent ?? "");
        const ranks = groups.map(group => group.startsWith("Not rostered") ? 0 : group.startsWith("Supervisors") ? 1 : group.startsWith("Colleagues") ? 2 : group.startsWith("Contractors") ? 3 : -1);
        expect(ranks.length).toBeGreaterThan(0);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        expect(ranks).not.toContain(-1);
        expect(c.textContent).not.toMatch(DEFAULTS);
    });
    test("a Find's need says the app's word", async () => {
        const { container: c } = await open(ex.rosterVocabulary);
        await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
        await press(within(slot(c, "end")).getAllByRole("button", { name: "Find a lead" })[0]);
        await waitFor(() => expect(c.querySelector("[data-roster-find]")!.textContent).toContain("Find · Supervisors"));
    });
});
