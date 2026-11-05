/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The app's own words for what the board holds (#1516), on e3: with every entry of `labels` given, the board's own words
 * show nowhere, in its text or its tooltips, and a renamed Library group keeps its place and its look.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, settle, slot } from "./harness.test-utils.js";

const h = allocationHarness();
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
/** The default words `labels` replaces, none of which may show once the app gives its own. */
const DEFAULTS = /\b[Bb]ins?\b|\b[Rr]eservations?\b|\b[Rr]eserved\b|Prior job|Next job|\b[Oo]verdue\b|Ready around now|Removed from plan|\bAllocated\b|Free today|Loading today|Busy today|\bHold\b/u;
/** Everything the board says of its own: its text, its tooltips and what it tells a screen reader. */
function said(root: HTMLElement): string {
    const named = [...root.querySelectorAll("[title], [aria-label]")].flatMap(el => [el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? ""]);
    return [root.textContent ?? "", ...named].join("\n");
}
/** The default words in what the board says, each with what is around it. */
const found = (root: HTMLElement) => said(root).split("\n").filter(line => DEFAULTS.test(line));

describe("an Allocation's words", () => {
    test("the Timeline, its footer and its Library say the app's words, the groups in their own order", async () => {
        const { container: c } = await h.mount(ex.allocationWording);
        expect(c.querySelector("[data-allocation-legend=bin]")!.textContent).toBe("Charge");
        expect(c.querySelector("[data-allocation-legend=prior]")!.textContent).toBe("Last firing");
        expect(c.querySelector("[data-allocation-legend=next]")!.textContent).toBe("Next firing");
        const heads = [...c.querySelectorAll('[data-allocation-library="arrivals"] [data-library-head]')].map(el => el.textContent ?? "");
        const order = ["Late", "Due soon", "Taken off", "Charged"];
        const ranks = heads.map(head => order.findIndex(word => head.startsWith(word)));
        expect(ranks.length).toBeGreaterThan(0);
        expect(ranks).not.toContain(-1);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        expect(found(c)).toEqual([]);
    });
    test("a kiln's Details and the summary say them too", async () => {
        const { container: c } = await h.mount(ex.allocationWording);
        const stat = c.querySelector('[data-allocation-stat="Bins"]');
        expect(stat!.textContent).toContain("Charges");
        await press(c.querySelector('[data-allocation-resource="K-105"]'));
        await waitFor(() => expect(slot(c, "end").querySelector("[data-allocation-facts]")).toBeTruthy());
        expect(slot(c, "end").querySelector("[data-allocation-facts]")!.textContent).toContain("Dwell");
        expect(found(slot(c, "end"))).toEqual([]);
    });
    test("the Search box and the Late mark keep their look under the app's word", async () => {
        const { container: c } = await h.mount(ex.allocationWording);
        expect(slot(c, "toolbar").querySelector('input[placeholder="Search charges by key"], [aria-label="Search charges by key"]')).toBeTruthy();
        expect(c.querySelector('[data-allocation-library="arrivals"] [data-library-head] svg')).toBeTruthy();
    });
});
