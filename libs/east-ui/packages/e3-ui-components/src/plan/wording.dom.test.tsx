/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The app's own words for what the Plan draws (#1516), on e3: with `vocabulary` given, the Plan's own words show nowhere
 * in its panes or what they tell a screen reader; a word left out stays the table's, and so a host's translation.
 */
import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { none, some } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { planMessages, planMessagesIn, type PlanVocabulary } from "./messages.js";
import "./index.js";

const h = e3Harness({ "plan/plan-events": ex }, { measure: false });
const DEFAULTS = /\b[Bb]acklog\b|\bSeries\b|\bUnassigned\b|Due this week|Due next week|\bLater\b|\bNo date\b/u;
/** The default words in all a region says: its text, its tooltips and what it tells a screen reader, each with what is around it. */
function found(root: Element): string[] {
    const named = [...root.querySelectorAll("[title], [aria-label], [placeholder]")].flatMap(el => [el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? ""]);
    return [root.textContent ?? "", ...named].filter(line => DEFAULTS.test(line)).map(line => { const at = line.search(DEFAULTS); return line.slice(Math.max(0, at - 30), at + 30); });
}
const noWords: PlanVocabulary = {
    unassigned: none, events: none, backlog: none, series: none, groups: none, rows: none, measures: none,
    dueThisWeek: none, dueNextWeek: none, later: none, noDate: none,
    estimated: none, proposed: none, recommended: none, removal: none, confirmed: none, inProgress: none, actual: none, rejected: none,
};

describe("a Plan's words", () => {
    test("its library says the app's words, its groups in their order", async () => {
        const { container: c } = await h.mount(ex.planWording);
        const start = slot(c, "start");
        const tabs = [...start.querySelectorAll('[role="tab"]')].map(tab => tab.textContent ?? "");
        expect(tabs.some(tab => tab.startsWith("Waiting"))).toBe(true);
        expect(found(start)).toEqual([]);
        expect(found(slot(c, "footer"))).toEqual([]);
        // The Layers tab's search asks for layers, in the app's word for its series (review of #1481, finding 6).
        const layers = [...start.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => (tab.textContent ?? "").startsWith("Layers"))!;
        await act(async () => { fireEvent.click(layers); });
        await settle();
        const search = start.querySelector<HTMLInputElement>("[data-slot='pickSearch'] input")!;
        expect([search.placeholder, search.getAttribute("aria-label")]).toEqual(["Search layers", "Search layers"]);
        expect(found(start)).toEqual([]);
    });
    test("the table holds to them, and a word left out stands as the table has it", () => {
        const m = planMessagesIn(planMessages, {
            ...noWords, unassigned: some("Unplaced"), backlog: some("Waiting"), series: some("Layers"), events: some("Job cards"),
            groups: some({ one: "Hall", other: "Halls" }), rows: some({ one: "Press", other: "Presses" }), measures: some({ one: "Figure", other: "Figures" }),
            dueThisWeek: some("This week's jobs"), noDate: some("Undated"), confirmed: some("locked"), proposed: some("suggested"), inProgress: some("on press"),
        });
        expect(m.inspectorUnassigned()).toBe("Unplaced");
        expect([m.inspectorFact({ fact: "resource" }), m.inspectorFact({ fact: "group" }), m.inspectorFact({ fact: "start" })]).toEqual(["Press", "Hall", "Start"]);
        expect(m.backlogLine({ duration: "6 h", resource: undefined, due: undefined })).toBe("6 h · Unplaced");
        expect(m.libraryTab({ tab: "events" })).toBe("Job cards");
        expect(m.libraryEmpty({ tab: "backlog", name: "" })).toBe("Waiting clear");
        expect(m.footerBacklog({ n: 9, count: "9" })).toBe("9 in waiting");
        expect(m.libraryNarrowed({ tab: "backlog", name: "" })).toBe("No waiting events match the filters");
        expect(m.dueGroup({ due: "thisWeek" })).toBe("This week's jobs");
        expect(m.dueGroup({ due: "none" })).toBe("Undated");
        expect(m.dueGroup({ due: "later" })).toBe("Later");
        expect(m.state({ state: "confirmed" })).toBe("locked");
        expect(m.state({ state: "added" })).toBe("suggested");
        expect(m.state({ state: "in-progress" })).toBe("on press");
        expect(m.state({ state: "actual" })).toBe("actual");
        expect([m.tabGroups(), m.tabRows(), m.tabMeasures()]).toEqual(["Halls", "Presses", "Figures"]);
        expect(m.moreRows({ n: 1, count: "1" })).toBe("1 more press");
        expect(m.groupMeta({ n: 8, count: "8" })).toBe("8 presses");
        expect(m.allRows()).toBe("← All presses");
        expect(m.hiddenRows({ n: 2, count: "2", what: "group" })).toBe("2 hidden halls");
        // None given: the table above says everything, a host's translation included.
        const held = planMessagesIn({ ...planMessages, tabRows: () => "Zeilen" }, noWords);
        expect(held.tabRows()).toBe("Zeilen");
        expect(held.inspectorUnassigned()).toBe("Unassigned");
        expect(held.state({ state: "added" })).toBe("proposed");
        expect(held.libraryNarrowed({ tab: "backlog", name: "" })).toBe("No backlog events match the filters");
    });
});
