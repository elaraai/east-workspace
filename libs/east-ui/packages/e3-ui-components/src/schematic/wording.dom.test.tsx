/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The app's own words for what the Schematic draws (#1516), on e3: with every entry of `vocabulary` given, the Schematic's
 * own words show nowhere in its library, its inspector or what they tell a screen reader; and its table says them.
 */
import { describe, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { schematicMessages, schematicMessagesOf } from "./messages.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });
const DEFAULTS = /\bTemplates?\b|\btemplates?\b|\bBacklog\b|\bbacklog\b|\bIndex\b|\bLayers?\b|\blayers?\b|\bZones?\b|\bNets?\b|\bLinks?\b|\bSources?\b|\bDestinations?\b/u;
/** The default words in all a region says: its text, its tooltips and what it tells a screen reader, each with what is around it. */
function found(root: Element): string[] {
    const named = [...root.querySelectorAll("[title], [aria-label], [placeholder]")].flatMap(el => [el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? ""]);
    return [root.textContent ?? "", ...named].filter(line => DEFAULTS.test(line)).map(line => { const at = line.search(DEFAULTS); return line.slice(Math.max(0, at - 30), at + 30); });
}
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }

describe("a Schematic's words", () => {
    test("its library's tabs, its inspector and its toolbar say the app's words", async () => {
        const { container: c } = await h.mount(ex.schematicWording);
        const tabs = [...slot(c, "start").querySelectorAll('[role="tab"]')].map(tab => tab.textContent ?? "");
        expect(tabs.some(tab => tab.startsWith("Patterns"))).toBe(true);
        expect(tabs.some(tab => tab.startsWith("Unplaced"))).toBe(true);
        expect(tabs.some(tab => tab.startsWith("Map"))).toBe(true);
        expect(tabs.some(tab => tab.startsWith("Planes"))).toBe(true);
        expect(found(slot(c, "start"))).toEqual([]);
        expect(found(slot(c, "toolbar"))).toEqual([]);
        await waitFor(() => expect(slot(c, "end").textContent).toContain("Runs"));
        expect(slot(c, "end").textContent).toContain("Areas");
        expect(found(slot(c, "end"))).toEqual([]);
        await press(within(slot(c, "start")).getByRole("tab", { name: /^Map/ }));
        expect(found(slot(c, "start"))).toEqual([]);
        await press(within(slot(c, "start")).getByRole("tab", { name: /^Planes/ }));
        expect(found(slot(c, "start"))).toEqual([]);
    });
    test("the table holds to its words in everything else it says, the defaults word for word", () => {
        const noun = (one: string) => ({ one, other: `${one}s` });
        const m = schematicMessagesOf({ templates: noun("Pattern"), backlog: "Unplaced", index: "Map", layer: noun("Plane"), zone: noun("Area"), net: noun("Bus"), link: noun("Run"), source: noun("Feed"), destination: noun("Tap") });
        const one = { n: 1, count: "1" }, two = { n: 2, count: "2" };
        expect(m.inspectorSides({ sources: two, destinations: one })).toBe("2 feeds → 1 tap");
        expect(m.inspectorLeg({ end: "source" })).toBe("Feed leg");
        expect(m.inspectorField({ field: "kind" })).toBe("Run kind");
        expect(m.toolHint({ tool: "connect" })).toBe("Connect — drag from an item to another to record a run");
        expect(m.inspectorSideEmpty({ side: "destinations" })).toBe("A bus keeps one tap at least: Delete takes the bus");
        expect(m.foundOff({ item: "A04", mark: "unplaced" })).toBe("A04 has no position: it is in the Unplaced");
        expect(m.issueWhere({ kind: undefined, name: "Power" })).toBe("Plane · Power");
        expect(schematicMessages.inspectorSides({ sources: two, destinations: one })).toBe("2 sources → 1 destination");
        expect(schematicMessages.inspectorSideEmpty({ side: "sources" })).toBe("A net keeps one source at least: Delete takes the net");
        expect(schematicMessages.toolHint({ tool: "connect" })).toBe("Connect — drag from an item to another to record a link");
    });
});
