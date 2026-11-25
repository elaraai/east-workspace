/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Record's trace cells (east-workspace#1728), measured in the page: the
 * machines' example (`recordTrace`) at each of its three densities, stepped
 * through its own control, and in a phone's frame at 390 and in a 294px
 * parent. Each trace stands inside its cell between its paddings, its steps a
 * whole number of pixels under the row's edge and as tall as the row fits —
 * Trace's compact 22 in a 36 or 32 row, its condensed 15 in a 28 — clear of
 * the row's rules, the now-line too; each step inside its track, none over the
 * next; and no step's value spills past its step: where one has no room on its
 * step none is drawn. The widest real content is among them: a planner's
 * twelve weeks in a 160px column, last year's 52 in 240px — and in a phone's
 * slot, those 52 in some 40px.
 *
 * Run: `pnpm exec playwright test record-trace`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROUTE = "e3/record/record-display/recordTrace";
const ROOT = "[data-builder-frame]";

/**
 * Each density, as its control names it: its rows' height, and its traces' steps' — and how far under the row's top
 * edge they start: the row's room over its rule, less a pixel of padding, the steps centred in it (an odd 15 a pixel
 * higher, as every odd part stands).
 */
const DENSITIES = [
    { name: "COMFORTABLE", row: 36, step: 22, top: 7 },
    { name: "COMPACT", row: 32, step: 22, top: 5 },
    { name: "CONDENSED", row: 28, step: 15, top: 6 },
] as const;

/** One trace as the page draws it, in its cell and its row. */
interface TraceBox {
    /** Its row and its column, for a failure to name. */
    at: string;
    /** Its part's box, and the cell's room between its paddings. */
    part: { left: number; right: number };
    room: { left: number; right: number };
    /** Its row's top edge, and the top of the row's rule. */
    rowTop: number;
    rule: number;
    /** Each step: its box, and its value's — `undefined` for a value not drawn. */
    steps: { top: number; bottom: number; left: number; right: number; value: { left: number; right: number; top: number; bottom: number } | undefined }[];
    /** The now-line's top and bottom, where it has one. */
    now: { top: number; bottom: number } | undefined;
}

/**
 * Every trace the grid draws, measured: each cell's display part, its room, its steps and their values, and the
 * now-line — a value counted drawn while it stands on its step, never while it is wrapped under its step's edge, out
 * of sight, or set not to display.
 *
 * @param entry - The example's entry
 * @returns The traces
 */
function measure(entry: Locator): Promise<TraceBox[]> {
    return entry.locator("[data-record]").evaluate((root) => {
        const box = (el: Element) => el.getBoundingClientRect();
        const out: TraceBox[] = [];
        for (const row of root.querySelectorAll<HTMLElement>('[data-slot="row"]')) {
            const r = box(row);
            const rule = r.bottom - parseFloat(getComputedStyle(row).borderBottomWidth);
            for (const part of row.querySelectorAll<HTMLElement>('[data-slot="display"]')) {
                const cell = part.closest<HTMLElement>('[data-slot="cell"]')!;
                const c = box(cell);
                const s = getComputedStyle(cell);
                const p = box(part);
                const grid = part.querySelector<HTMLElement>('[style*="grid-template-columns"]')!;
                const steps = [...grid.querySelectorAll<HTMLElement>("[data-level]")].map((step) => {
                    const b = box(step);
                    const value = step.firstElementChild as HTMLElement | null;
                    const v = value === null ? undefined : box(value);
                    // Drawn: displayed, and standing on its step rather than wrapped under its edge.
                    const drawn = value !== null && getComputedStyle(value).display !== "none" && v !== undefined && v.top < b.bottom - parseFloat(getComputedStyle(step).borderBottomWidth) - 0.5;
                    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, value: drawn ? { left: v!.left, right: v!.right, top: v!.top, bottom: v!.bottom } : undefined };
                });
                const nowLine = [...grid.children].find((child) => (child as HTMLElement).style.left !== "");
                const n = nowLine === undefined ? undefined : box(nowLine);
                out.push({
                    at: `${row.getAttribute("data-row-id")}/${cell.getAttribute("data-key")}`,
                    part: { left: p.left, right: p.right },
                    room: { left: c.left + parseFloat(s.paddingLeft), right: c.right - parseFloat(s.paddingRight) },
                    rowTop: r.top, rule,
                    steps,
                    now: n === undefined ? undefined : { top: n.top, bottom: n.bottom },
                });
            }
        }
        return out;
    });
}

/** A length to the 64th of a pixel the page lays out in. */
const px = (n: number) => Math.round(n * 64) / 64;

/**
 * Holds each trace to its cell and its row: inside the cell's paddings, each step the density's height a whole number
 * of pixels under the row's top edge and 2px or more clear of its rule — the now-line inside the row — and each value
 * drawn on its step, or none of the trace's.
 *
 * @param traces - The traces measured
 * @param step - The steps' height, px
 * @param top - How far under the row's top edge they start, px; `undefined` to hold them to a whole pixel alone
 * @param where - What a failure names
 */
function holds(traces: TraceBox[], step: number, top: number | undefined, where: string): void {
    expect(traces.length, `traces drawn, ${where}`).toBeGreaterThan(0);
    for (const t of traces) {
        const at = `${t.at}, ${where}`;
        expect(t.part.left >= t.room.left - 0.5 && t.part.right <= t.room.right + 0.5, `${at}: inside its cell's paddings ${JSON.stringify([t.part, t.room])}`).toBe(true);
        for (const s of t.steps) {
            expect(px(s.bottom - s.top), `${at}: a step's height`).toBe(step);
            const under = px(s.top - t.rowTop);
            expect(Number.isInteger(under), `${at}: a step ${under}px under the row's edge, a whole pixel`).toBe(true);
            if (top !== undefined) expect(under, `${at}: a step's place in its row`).toBe(top);
            expect(t.rule - s.bottom >= 2, `${at}: a step ${px(t.rule - s.bottom)}px over the row's rule`).toBe(true);
            expect(s.left >= t.part.left - 0.5 && s.right <= t.part.right + 0.5, `${at}: a step inside its part ${JSON.stringify([{ left: s.left, right: s.right }, t.part])}`).toBe(true);
            if (s.value !== undefined) {
                expect(s.value.left >= s.left - 0.5 && s.value.right <= s.right + 0.5 && s.value.top >= s.top - 0.5 && s.value.bottom <= s.bottom + 0.5,
                    `${at}: a value on its step ${JSON.stringify([s.value, { left: s.left, right: s.right }])}`).toBe(true);
            }
        }
        // Each step clear of the next: however many share the lane, none stands wider than its track.
        t.steps.slice(1).forEach((s, i) => expect(t.steps[i]!.right <= s.left + 0.25, `${at}: step ${i} over step ${i + 1} ${JSON.stringify([t.steps[i]!.right, s.left])}`).toBe(true));
        // Every value of the trace drawn, or none: each stands as wide as the longest.
        const drawn = t.steps.filter((s) => s.value !== undefined).length;
        expect(drawn === 0 || drawn === t.steps.length, `${at}: ${drawn} of ${t.steps.length} values drawn`).toBe(true);
        if (t.now !== undefined) expect(t.now.top >= t.rowTop - 0.5 && t.now.bottom <= t.rule + 0.5, `${at}: the now-line inside its row`).toBe(true);
    }
}

test("each trace at each density: inside its cell, its steps as tall as the row fits a whole number of pixels under its edge and clear of its rules, and no value past its step — 12 steps in 160px and 52 in 240px among them @desktop", async ({ page }) => {
    // Wide enough for the example's frame to draw the grid whole, every column at its own width.
    await page.setViewportSize({ width: 2160, height: 1200 });
    const entry = await visitBuilder(page, ROUTE, ROOT, "light");
    await expect(entry.locator('[data-record] [role="grid"]').first()).not.toHaveAttribute("data-phone");
    for (const density of DENSITIES) {
        // The segment's own words, as a person presses it: its radio is the hidden input under them.
        await entry.getByText(density.name, { exact: true }).click();
        await expect(entry.getByRole("radio", { name: density.name, exact: true })).toBeChecked();
        await expect(entry.locator('[data-record] [data-slot="row"]').first()).toHaveCSS("height", `${density.row}px`);
        await settled(page);
        const traces = await measure(entry);
        holds(traces, density.step, density.top, density.name.toLowerCase());
        // The widest real content: last year's 52 weeks in 240px, and the planner's twelve in 160px — no value has room.
        const history = traces.find((t) => t.at === "M-01/history")!;
        expect(history.steps.length).toBe(52);
        expect(history.steps.every((s) => s.value === undefined), `M-01/history's values, ${density.name}`).toBe(true);
        expect(traces.find((t) => t.at === "M-02/weeks")!.steps.length).toBe(12);
    }
});

test("each trace in a phone's frame, at 390 and in a 294px parent: inside its cell, its steps a whole number of pixels under the row's edge and clear of its rules, and no value past its step @mobile", async ({ page }) => {
    const entry = await visitBuilder(page, ROUTE, ROOT, "light");
    await expect(entry.locator('[data-record] [role="grid"]').first()).toHaveAttribute("data-phone", "");
    holds(await measure(entry), 22, undefined, "390");
    await sizeBuilder(page, entry, ROOT, 294);
    holds(await measure(entry), 22, undefined, "294");
});
