/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The app's own words for who is on the Roster (#1516), on e3: each `vocabulary` entry given replaces its default word
 * wherever the Roster draws it, and the People tab keeps its groups' order whatever they are called. The People layout's
 * badge beside an agency person's name and each group's row of agency requests take theirs too (#1566), by week, by
 * month and on a phone; so does a Shifts chip's badge on an agency person's duty or a request, and a request's People
 * tile names its shift alone, its row saying it is a request.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, open, reveal, rosterHarness, settle, slot, width } from "./harness.test-utils.js";

const h = rosterHarness();
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
/** The words the Roster draws of its own, none of which may show once the app gives its own. */
const DEFAULTS = /\bPermanent\b|Agency staff|agency staff|\bAssociates\b|\bLeads\b|\bTrainers\b|· available|\bperm\b|Agency requests/u;
/** The People layout's words of its own for agency staff and their requests, none of which may show under the app's (#1566). */
const PEOPLE_DEFAULTS = /Agency requests|\bAgency\b/u;
/** A read of the weeks or of the duties, as the request log names their datasets. */
const weekRead = (request: E3Request) => ["page", "find", "runs", "rows"].includes(request.kind)
    && (request.dataset === "records.roster_rota_weeks" || request.dataset === "records.roster_duties");
/** The agency badges main has mounted, by their words. */
const badges = (c: HTMLElement) => [...slot(c, "main").querySelectorAll("[data-roster-agency-badge]")].map(el => el.textContent);
/** The example's shifts, by their labels: all a request's People tile may say. */
const SHIFT_LABELS = new Set(["Early", "Late", "Night"]);

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
    test("the People layout's badge beside an agency person's name is the app's short form, and each group's requests row its word — by week and by month (#1566)", async () => {
        const { container: c } = await open(ex.rosterVocabulary);
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        // By week: a group's agency staff rank last, right above its requests row.
        const row = await reveal(c, '[data-roster-person-row="requests:inbound"]');
        expect(row.querySelector("[data-roster-person-name] button")!.textContent).toBe("Contractor requests");
        expect(badges(c).length).toBeGreaterThan(0);
        expect(new Set(badges(c))).toEqual(new Set(["contr"]));
        expect(slot(c, "main").textContent).not.toMatch(PEOPLE_DEFAULTS);
        // By month: the requests row's name and each of its week cells' names, the badge the same.
        await press(toolbar(c).getByRole("radio", { name: "Month" }));
        const cell = await reveal(c, '[data-roster-person-week^="requests:inbound."]');
        expect(cell.getAttribute("aria-label")).toMatch(/^Contractor requests · W\d+$/u);
        expect(cell.closest("[data-roster-person-row]")!.querySelector("[data-roster-person-name] button")!.textContent).toBe("Contractor requests");
        expect(badges(c).length).toBeGreaterThan(0);
        expect(new Set(badges(c))).toEqual(new Set(["contr"]));
        expect(slot(c, "main").textContent).not.toMatch(PEOPLE_DEFAULTS);
    });
    test("a Shifts chip's badge on an agency person's duty or a request is the app's short form, and a request's People tile names its shift alone (#1566)", async () => {
        const { container: c } = await open(ex.rosterVocabulary);
        const chips = [...slot(c, "main").querySelectorAll("[data-roster-assignment]")];
        const agency = chips.filter(chip => chip.hasAttribute("data-agency") || chip.hasAttribute("data-request"));
        expect(agency.length).toBeGreaterThan(0);
        expect(agency.map(chip => chip.querySelector("[data-roster-agency-badge]")?.textContent)).toEqual(agency.map(() => "contr"));
        expect(chips.filter(chip => !agency.includes(chip) && chip.querySelector("[data-roster-agency-badge]") !== null)).toEqual([]);
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        // The example's agency requests are the picking group's.
        const row = await reveal(c, '[data-roster-person-row="requests:picking"]');
        const names = [...row.querySelectorAll("[data-roster-tile] [data-roster-assignment-name]")].map(el => el.textContent ?? "");
        expect(names.length).toBeGreaterThan(0);
        expect(names.filter(name => !SHIFT_LABELS.has(name))).toEqual([]);
    });
    test("a phone's People cards title each group's requests the app's word, read and while a week is read (#1566)", async () => {
        const { container: c } = await open(ex.rosterVocabulary);
        await press(toolbar(c).getByRole("radio", { name: "People" }));
        await width(390);
        expect(slot(c, "main").querySelector('[data-roster-agenda="people"]')).not.toBeNull();
        const card = await reveal(c, '[data-roster-person-card="requests:inbound"]', 360);
        expect(card.hasAttribute("data-roster-unread")).toBe(false);
        expect(card.textContent).toContain("Contractor requests");
        expect(slot(c, "main").textContent).not.toMatch(PEOPLE_DEFAULTS);
        // Two weeks on, past the week read ahead, every read held: the cards' heads while the week is not read.
        const held = h.e3.hold(weekRead);
        for (let step = 0; step < 2; step++) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "]" }); }); await settle(); }
        const unread = await reveal(c, '[data-roster-person-card="requests:inbound"][data-roster-unread]', 360);
        expect(unread.textContent).toContain("Contractor requests");
        expect(slot(c, "main").textContent).not.toMatch(PEOPLE_DEFAULTS);
        await act(async () => { held.release(); }); await settle();
    });
});
