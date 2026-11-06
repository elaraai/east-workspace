/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The app's own words for what the Calendar draws (#1516), on e3: with every entry of `vocabulary` given, the Calendar's
 * own words show nowhere, in its text or its tooltips, and the Backlog's groups keep their order under their new names.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { act, calendarHarness, settle, slot } from "./harness.test-utils.js";

const h = calendarHarness();
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
/** The default words `vocabulary` replaces, none of which may show once the app gives its own. */
const DEFAULTS = /\b[Bb]acklog\b|\b[Tt]emplates?\b|Due this week|Due next week|\bLater\b|No date|Unscheduled|Unassigned|\b[Rr]esources?\b/u;
/** The default words in all the Calendar says of its own: its text, its tooltips and what it tells a screen reader. */
function found(root: HTMLElement): string[] {
    const named = [...root.querySelectorAll("[title], [aria-label]")].flatMap(el => [el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? ""]);
    return [root.textContent ?? "", ...named].filter(line => DEFAULTS.test(line)).map(line => { const at = line.search(DEFAULTS); return line.slice(Math.max(0, at - 30), at + 30); });
}
const tab = (c: HTMLElement, name: RegExp) => within(slot(c, "start")).getByRole("tab", { name });

describe("a Calendar's words", () => {
    test("its tabs, the layouts and the Backlog's groups say the app's words, the groups in their own order", async () => {
        const { container: c } = await h.mount(ex.calendarWording);
        expect(tab(c, /^Recipes/)).toBeTruthy();
        expect(slot(c, "toolbar").textContent).toContain("Stations");
        await press(tab(c, /^Unplanned/));
        const heads = [...slot(c, "start").querySelectorAll('[role="tabpanel"]:not([hidden]) [data-library-head]')].map(el => el.textContent ?? "");
        const order = ["This week", "Next week", "Afterwards", "Undated"];
        const ranks = heads.map(head => order.findIndex(word => head.startsWith(word)));
        expect(ranks.length).toBeGreaterThan(0);
        expect(ranks).not.toContain(-1);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        expect(found(c)).toEqual([]);
    });
    test("the timeline and the Resources view say them too", async () => {
        const { container: c } = await h.mount(ex.calendarWording);
        await press(within(slot(c, "toolbar")).getByRole("radio", { name: "Timeline" }));
        await waitFor(() => expect(c.querySelector("[data-calendar-header-caption]")?.textContent).toBe("Stations"));
        expect(found(c)).toEqual([]);
        await press(within(slot(c, "toolbar")).getByRole("radio", { name: "Stations" }));
        await waitFor(() => expect(c.querySelector('[data-calendar-time-grid] [data-resources]')).toBeTruthy());
        expect(c.textContent).toContain("Nobody");
        expect(found(c)).toEqual([]);
    });
    test("a selected event's placement names its resource in the app's word for one (review of #1481, finding 5)", async () => {
        const { container: c } = await h.mount(ex.calendarWording);
        await press(c.querySelector("[data-calendar-event]"));
        const field = await waitFor(() => {
            const at = slot(c, "end").querySelector<HTMLElement>('[data-calendar-inspector] [data-field="resource"]');
            expect(at).not.toBeNull();
            return at!;
        });
        expect(field.querySelector("label")?.textContent).toContain("Station");
        expect(found(slot(c, "end"))).toEqual([]);
    });
});
