/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The app's own words for what the flowchart draws (#1516), on e3: with every entry of `vocabulary` given, the flowchart's
 * own words show nowhere in its panes, its legend or what they tell a screen reader; and its table says them.
 */
import { describe, expect, test } from "vitest";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { e3Harness, slot } from "../e3-web-mount.test-utils.js";
import { flowchartMessages, flowchartMessagesOf } from "./messages.js";
import "./index.js";

const h = e3Harness({ "flowchart/flowchart": ex }, { measure: false });
const DEFAULTS = /\b[Ff]lows?\b|\b[Ll]anes?\b|\b[Ss]tates?\b|\b[Tt]ransitions?\b|\b[Dd]ecisions?\b|\bPlanned\b|\bplanned\b|\bObserved\b|\bobserved\b/u;
/** The default words in all a region says: its text, its tooltips and what it tells a screen reader, each with what is around it. */
function found(root: Element): string[] {
    const named = [...root.querySelectorAll("[title], [aria-label], [placeholder]")].flatMap(el => [el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? ""]);
    return [root.textContent ?? "", ...named].filter(line => DEFAULTS.test(line)).map(line => { const at = line.search(DEFAULTS); return line.slice(Math.max(0, at - 30), at + 30); });
}

describe("a Flowchart's words", () => {
    test("its panes and its toolbar say the app's words", async () => {
        const { container: c } = await h.mount(ex.flowchartWording);
        const tabs = [...slot(c, "start").querySelectorAll('[role="tab"]')].map(tab => tab.textContent ?? "");
        expect(tabs.some(tab => tab.startsWith("Routes"))).toBe(true);
        expect(found(slot(c, "start"))).toEqual([]);
        expect(found(slot(c, "toolbar"))).toEqual([]);
        expect(found(slot(c, "end"))).toEqual([]);
        expect(found(slot(c, "footer"))).toEqual([]);
    });
    test("the table holds to its words in everything else it says, the defaults word for word", () => {
        const noun = (one: string) => ({ one, other: `${one}s` });
        const m = flowchartMessagesOf({ flow: noun("Route"), lane: noun("Stage"), state: noun("Stop"), transition: noun("Hop"), decision: noun("Choice"), planned: "Designed", observed: "Seen" });
        expect(m.flowCounts({ lanes: { n: 2, count: "2" }, states: { n: 1, count: "1" }, transitions: { n: 3, count: "3" } })).toBe("2 stages · 1 stop · 3 hops");
        expect(m.dropRefused({ why: "onto", lands: "transition" })).toBe("Drop onto a hop");
        expect(m.kindLabel({ kind: "observed" })).toBe("Seen");
        expect(m.inspectorSplit({ planned: "1", observed: "2", unresolved: "3" })).toBe("1 designed · 2 seen · 3 unresolved");
        expect(m.editLabel({ edit: "moveState" })).toBe("Move stop");
        expect(m.inspectorRefused({ why: "emptyKey", what: "state" })).toBe("A stop needs a key");
        expect(m.legendInPlace()).toBe("In-place hop");
        expect(m.inspectorChip({ state: "noRow" })).toBe("No stop row");
        expect(flowchartMessages.flowCounts({ lanes: { n: 2, count: "2" }, states: { n: 1, count: "1" }, transitions: { n: 3, count: "3" } })).toBe("2 lanes · 1 state · 3 transitions");
        expect(flowchartMessages.inspectorRefused({ why: "emptyKey", what: "state" })).toBe("A state needs a key");
        expect(flowchartMessages.inspectorChip({ state: "noRow" })).toBe("No state row");
        expect(flowchartMessages.findNoMatches()).toBe("No matching states. Search by state key or label.");
    });
});
