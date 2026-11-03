/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A phone's builder frame (`Mobile Builder Frame Spec.md`, ruled 3 Nov 2026),
 * measured in the page over every builder's phone-sized example — each in a
 * 390px box — and again in a 294px parent, in both themes, a test a builder
 * (each area starts a workspace of its own, #1397):
 *
 * - FR1: the frame stacks — the toolbar, its second row, main the frame's
 *   whole width, the pane strip — and no pane takes width at a side;
 * - FR6: the second row is 56px under the first (the designer's
 *   `WorkOrdersPhone` session bar, less its safe area), padded 0 12 0 16, the
 *   history there and not in the first row: Issues, Undo, Redo, Discard and
 *   Save each 44 × 44 on a 6px radius, centred on the row and taking the
 *   pointer at its centre; one that does not act drawn in `--rule` and
 *   `--ink-5`, never faded;
 * - FR4: the pane strip is 44px on the frame's bottom edge, one equal tab a
 *   pane, each the strip's height, in `--ink-3` until it is open;
 * - FR5 (as the Filters view opens, ruled 3 Nov 2026): a tab opens its pane
 *   as a view over the whole frame, edge to edge; Esc closes it, the focus
 *   back on its tab; one at a time.
 *
 * And the Flowchart's lane pager (`narrow.lanes`, ruled 3 Nov 2026): its window
 * shows the lanes the example asks, each half of main's width, and ‹ › step it
 * a lane, the readout following.
 *
 * Run: `pnpm exec playwright test builder-frame-phone`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROOT = "[data-builder-frame]";

/** Every builder's phone-sized example, by its showcase route. */
const PHONES: readonly (readonly [name: string, route: string])[] = [
    ["Sheet", "e3/sheet/sheet-actions/sheetActionsPhone"],
    ["Plan", "e3/plan/plan-records/planRecordIndexesMobile"],
    ["Roster", "e3/roster/roster/rosterMobile"],
    ["Calendar", "e3/calendar/calendar/calendarMobile"],
    ["Allocation", "e3/allocation/allocation/allocationMobile"],
    ["Schematic", "e3/schematic/schematic-records/schematicRecordIndexesMobile"],
    ["Flowchart", "e3/flowchart/flowchart/flowchartFlowsMobile"],
    ["Studio", "e3/studio/studio/studioBuilderMobile"],
    ["Query", "e3/query/query/queryBuilderMobile"],
];

/** What is wrong with a phone's frame, as the page lays it out: each fault, in words. */
function phoneFaults(entry: Locator): Promise<string[]> {
    return entry.locator(ROOT).first().evaluate((frame) => {
        const faults: string[] = [];
        const round = (n: number) => Math.round(n * 10) / 10;
        if (!frame.hasAttribute("data-phone")) return ["not a phone's frame"];
        const f = frame.getBoundingClientRect();
        const regions = [...frame.children].map((el) => el.getAttribute("data-frame-slot")).filter((slot) => slot !== null);
        const want = ["toolbar", "sessionRow", "body", "paneStrip"];
        // In this order, each there — the banners, while a session has one, between the rows and the body.
        const at = want.map((slot) => regions.indexOf(slot));
        if (at.some((i, k) => i < 0 || (k > 0 && i < at[k - 1]!))) faults.push(`regions ${regions.join(", ")}`);
        const slot = (name: string) => frame.querySelector<HTMLElement>(`:scope > [data-frame-slot='${name}']`);
        // FR1: main the whole width, no pane at a side.
        const body = slot("body")!;
        const main = body.querySelector<HTMLElement>(":scope > [data-frame-slot='main']")!.getBoundingClientRect();
        if (Math.abs(main.width - f.width) > 0.5) faults.push(`main ${round(main.width)}px of a ${round(f.width)}px frame`);
        if (body.querySelector(":scope > [data-pane-mode]") !== null) faults.push("a pane at a side");
        // FR6: the second row, the history there.
        const second = slot("sessionRow")!;
        const s = second.getBoundingClientRect();
        if (Math.abs(s.height - 56) > 0.5) faults.push(`second row ${round(s.height)}px`);
        const rowStyle = getComputedStyle(second);
        if (rowStyle.paddingLeft !== "16px" || rowStyle.paddingRight !== "12px") faults.push(`second row padded ${rowStyle.padding}`);
        /** A token's colour as the page resolves it. */
        const token = (name: string) => {
            const probe = document.createElement("span");
            probe.style.color = `var(--chakra-colors-${name})`;
            frame.appendChild(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
        };
        if (frame.querySelector("[data-frame-slot='toolbar'] [data-toolbar-item='history']") !== null) faults.push("the history in the first row");
        const history = second.querySelector("[data-slot='history'][data-history-form='phone']");
        if (history === null) faults.push("no history in the second row");
        for (const button of history?.querySelectorAll<HTMLElement>("button") ?? []) {
            const b = button.getBoundingClientRect();
            const name = button.getAttribute("aria-label") ?? "?";
            if (b.width === 0) continue;
            if (Math.abs(b.width - 44) > 0.5 || Math.abs(b.height - 44) > 0.5) faults.push(`${name} ${round(b.width)} × ${round(b.height)}`);
            const look = getComputedStyle(button);
            if (look.borderTopLeftRadius !== "6px") faults.push(`${name} radius ${look.borderTopLeftRadius}`);
            const off = button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true";
            if (off && (look.borderTopColor !== token("border-subtle") || look.color !== token("fg-faint") || look.opacity !== "1")) {
                faults.push(`${name}, off, drawn ${look.borderTopColor} / ${look.color} at ${look.opacity}`);
            }
            if (Math.abs(b.top + b.height / 2 - (s.top + s.height / 2)) > 0.5) faults.push(`${name} off the row's centre`);
            if (b.left < s.left - 0.5 || b.right > s.right + 0.5) faults.push(`${name} past the row`);
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            if (hit === null || !button.contains(hit)) faults.push(`${name} does not take the pointer`);
        }
        // FR4: the strip on the bottom edge, its tabs equal.
        const strip = slot("paneStrip");
        if (strip === null) return [...faults, "no pane strip"];
        const p = strip.getBoundingClientRect();
        if (Math.abs(p.height - 44) > 0.5) faults.push(`strip ${round(p.height)}px`);
        if (Math.abs(p.bottom - f.bottom) > 0.5) faults.push("the strip off the frame's bottom edge");
        const tabs = [...strip.querySelectorAll<HTMLElement>("[data-pane-tab]")].map((tab) => tab.getBoundingClientRect());
        if (tabs.some((t) => Math.abs(t.width - tabs[0]!.width) > 1 || Math.abs(t.height - p.height) > 2.5)) faults.push(`tabs ${tabs.map((t) => `${round(t.width)} × ${round(t.height)}`).join(", ")}`);
        for (const tab of strip.querySelectorAll<HTMLElement>("[data-pane-tab][aria-selected='false']")) {
            if (getComputedStyle(tab).color !== token("fg-muted")) faults.push(`${tab.textContent} tab in ${getComputedStyle(tab).color}`);
        }
        return faults;
    });
}

/** A pane's view as the page lays it out, against the frame. */
function drawerAt(entry: Locator, side: string) {
    return entry.locator(ROOT).first().evaluate((frame, at) => {
        const drawer = frame.querySelector<HTMLElement>(`[data-frame-drawer][data-frame-slot='${at}']`)!;
        const d = drawer.getBoundingClientRect(), f = frame.getBoundingClientRect();
        return {
            open: drawer.hasAttribute("data-open"),
            height: Math.abs(d.top - f.top) <= 0.5 && Math.abs(d.bottom - f.bottom) <= 0.5,
            width: Math.abs(d.left - f.left) <= 0.5 && Math.abs(d.right - f.right) <= 0.5,
        };
    }, side);
}

for (const theme of ["light", "dark"] as const) {
    for (const [name, route] of PHONES) {
        test(`${name}: a phone's frame stacks its regions, the history the second row's 44px buttons, the panes a strip of views over the whole frame — in its 390px box and a 294px parent (${theme})`, async ({ page }) => {
            const faults: Record<string, string[]> = {};
            await test.step(route, async () => {
                await page.setViewportSize({ width: 1440, height: 900 });
                const entry = await visitBuilder(page, route, ROOT, theme);
                const found = await phoneFaults(entry);
                if (found.length > 0) faults[`${route} in its box`] = found;
                const frame = entry.locator(ROOT).first();
                const tabs = frame.locator("[data-pane-tab]");
                const sides = await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-pane-tab")!));
                for (const side of sides) {
                    const tab = frame.locator(`[data-pane-tab='${side}']`);
                    await tab.click();
                    await settled(page);
                    expect(await drawerAt(entry, side), `${route}: ${side}'s drawer open`).toEqual({ open: true, height: true, width: true });
                    await expect(tab).toHaveAttribute("aria-selected", "true");
                    // One at a time.
                    expect(await frame.locator("[data-frame-drawer][data-open]").count(), route).toBe(1);
                    await page.keyboard.press("Escape");
                    await settled(page);
                    expect((await drawerAt(entry, side)).open, `${route}: Esc closed ${side}'s drawer`).toBe(false);
                    await expect(tab).toBeFocused();
                }
                await sizeBuilder(page, entry, ROOT, 294);
                const narrow = await phoneFaults(entry);
                if (narrow.length > 0) faults[`${route} in a 294px parent`] = narrow;
                await entry.locator(ROOT).first().locator("xpath=..").evaluate((box) => { (box as HTMLElement).style.width = ""; });
                await settled(page);
            });
            expect(faults).toEqual({});
        });
    }
}

test("Flowchart: a phone shows two lanes across main, and the pager's steps move the window a lane, 44px each, off at each end", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, "e3/flowchart/flowchart/flowchartFlowsMobile", ROOT, "light");
    const frame = entry.locator(ROOT).first();
    const pager = frame.locator("[data-flowchart-lane-pager]");
    const readout = pager.locator("[data-slot='pagerReadout']");
    const previous = pager.locator("[data-slot='pagerPrevious']");
    const next = pager.locator("[data-slot='pagerNext']");
    await expect(readout).toHaveText("Lanes 1–2 of 3");
    await expect(previous).toHaveAttribute("aria-disabled", "true");
    for (const step of [previous, next]) {
        const box = await step.boundingBox();
        expect([box?.width, box?.height]).toEqual([44, 44]);
    }
    const scroll = frame.locator("[data-flowchart-scroll]");
    const width = await scroll.evaluate((el) => el.clientWidth);
    await next.click();
    await expect(readout).toHaveText("Lanes 2–3 of 3");
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(Math.floor(width / 2));
    await previous.click();
    await expect(readout).toHaveText("Lanes 1–2 of 3");
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(0);
});
