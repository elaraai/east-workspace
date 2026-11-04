/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The app's own words for what the flowchart draws (#1516), on e3: with each kind named by its own `name` and both of
 * `vocabulary`'s words given, the flowchart's own words show nowhere in its panes, its legend or what they tell a screen
 * reader; and its table, made from those nouns, says them.
 */
import { describe, expect, test } from "vitest";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { e3Harness, slot } from "../e3-web-mount.test-utils.js";
import { DEFAULT_FLOWCHART_NOUNS, flowchartMessages, flowchartMessagesOf } from "./messages.js";
import "./index.js";

const h = e3Harness({ "flowchart/flowchart": ex }, { measure: false });
const DEFAULTS = /\b[Ll]anes?\b|\b[Ss]tates?\b|\b[Tt]ransitions?\b|\b[Dd]ecisions?\b|\bPlanned\b|\bplanned\b|\bObserved\b|\bobserved\b/u;
/** The default words in all a region says: its text, its tooltips and what it tells a screen reader, each with what is around it. */
function found(root: Element): string[] {
    const named = [...root.querySelectorAll("[title], [aria-label], [placeholder]")].flatMap(el => [el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? ""]);
    return [root.textContent ?? "", ...named].filter(line => DEFAULTS.test(line)).map(line => { const at = line.search(DEFAULTS); return line.slice(Math.max(0, at - 30), at + 30); });
}

describe("a Flowchart's words", () => {
    test("its panes, its canvas and its toolbar say the app's words", async () => {
        const { container: c } = await h.mount(ex.flowchartWording);
        // The Steps tab keeps its name; the Hops and Stages tabs are named by their kinds.
        const tabs = [...slot(c, "start").querySelectorAll('[role="tab"]')].map(tab => (tab.textContent ?? "").match(/^\p{L}+/u)?.[0]);
        expect(tabs).toEqual(["Steps", "Hops", "Stages"]);
        expect(found(slot(c, "start"))).toEqual([]);
        expect(found(slot(c, "toolbar"))).toEqual([]);
        expect(found(slot(c, "main"))).toEqual([]);
        expect(found(slot(c, "end"))).toEqual([]);
        expect(found(slot(c, "footer"))).toEqual([]);
    });
    test("the table holds to its nouns in everything else it says, the defaults word for word", () => {
        const m = flowchartMessagesOf({ state: "Stop", transition: "Hop", lane: "Stage", decision: "Choice", planned: "Designed", observed: "Seen" });
        expect([m.kindNoun({ sort: "lanes", n: 2 }), m.kindNoun({ sort: "states", n: 1 }), m.footerLinks({ n: 3 })]).toEqual(["stages", "stop", "hops"]);
        expect(m.dropRefused({ why: "onto", lands: "transition" })).toBe("Drop onto a hop");
        expect(m.kindLabel({ kind: "observed" })).toBe("Seen");
        expect(m.inspectorSplit({ planned: "1", observed: "2", unresolved: "3" })).toBe("1 designed · 2 seen · 3 unresolved");
        expect(m.editLabel({ gesture: "moveStates" })).toBe("Move stops");
        expect(m.keyHeld({ sort: "states", key: "A" })).toBe("A stop is keyed \"A\" already");
        expect(m.legendInPlace()).toBe("In-place hop");
        expect(m.inspectorChip({ state: "noRow" })).toBe("No stop row");
        expect([m.findLabel(), m.addLane(), m.noLaneBand(), m.libraryTab({ tab: "transitions" }), m.libraryTab({ tab: "states" })])
            .toEqual(["Find stop", "Add stage", "No stage", "Hops", "Steps"]);
        // An article as English gives one, by the noun's sound.
        expect(flowchartMessagesOf({ ...DEFAULT_FLOWCHART_NOUNS, state: "Order" }).keyHeld({ sort: "states", key: "A" })).toBe("An order is keyed \"A\" already");
        expect([flowchartMessages.kindNoun({ sort: "lanes", n: 2 }), flowchartMessages.kindNoun({ sort: "states", n: 1 }), flowchartMessages.footerLinks({ n: 3 })])
            .toEqual(["lanes", "state", "transitions"]);
        expect(flowchartMessages.keyHeld({ sort: "states", key: "A" })).toBe("A state is keyed \"A\" already");
        expect(flowchartMessages.inspectorChip({ state: "noRow" })).toBe("No state row");
        expect([flowchartMessages.findLabel(), flowchartMessages.libraryTab({ tab: "transitions" }), flowchartMessages.legendInPlace()])
            .toEqual(["Find state", "Transitions", "In-place transition"]);
    });
});
