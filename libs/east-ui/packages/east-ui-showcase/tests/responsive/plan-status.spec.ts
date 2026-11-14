/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What an item draws of its status (#1541, U8), measured in a real browser on
 * `planStatuses`: a press whose jobs, deliveries, shifts and checks each stand
 * one way a week — nothing to say, then late, blocked, done, noted, parked and
 * tentative — every item's status built by `Plan.status(words, tone, { ring })`
 * in its series' map.
 *
 * - A bar, a tile and a chip wear ONE ring, 1.5px in the tone's colour just
 *   outside the box, whatever their lifecycle look; a confirmed one keeps its
 *   inset brand ring inside it; one with no status wears no such ring.
 * - A tentative one draws open: no fill, no border of its lifecycle's, its
 *   words in the ink and the ring just inside its edge.
 * - A mark's dot is the tone's colour, a tentative one an open dot.
 * - The rings that ride over a status take its place by their order: an
 *   overlap's warn ring, but not a danger status's; a conflict's ring; and an
 *   open item keeps its own ring inside either. A context strip still hides
 *   an open item's words.
 *
 * Every colour is read through the theme: a probe draws each token, and what
 * an item draws is compared with it as the browser computes both. Nothing
 * here compares pixels.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-status --project desktop`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { openExample, rowSel } from "./plan-page";

/** How each week's item stands: its tone, and whether it draws open; the first week's has no status. */
const SHOWN = [
    undefined,
    { tone: "warning", ring: false },
    { tone: "danger", ring: false },
    { tone: "success", ring: false },
    { tone: "info", ring: false },
    { tone: "neutral", ring: false },
    { tone: "warning", ring: true },
] as const;

/** Each tone's theme token. */
const TOKENS = { success: "status-pos", warning: "status-warn", danger: "status-neg", info: "status-info", neutral: "fg-subtle" } as const;

/** The example's boxes: the row each is on, the attribute its items are keyed by, the letter their ids start with, and
 *  the width of a confirmed one's inset brand ring. */
const BOXES = [
    { name: "a run's bar", series: "jobs", attribute: "data-run", id: "j", confirmed: 1.5 },
    { name: "a tile", series: "drops", attribute: "data-event", id: "d", confirmed: 1 },
    { name: "a chip", series: "shifts", attribute: "data-chip", id: "s", confirmed: 1 },
] as const;

/** One shadow of an element, as the browser computes it. */
interface Shadow { color: string; inset: boolean; blur: number; spread: number }

/** What an item draws, as the browser computes it. */
interface Drawn {
    state: string | null;
    shadows: Shadow[];
    background: string;
    color: string;
    borders: number[];
}

/**
 * What the items of a row draw, and each token's colour as the browser computes it, with the attributes given set on
 * the items first — as their renderer sets them — and taken off again after.
 */
async function drawn(entry: Locator, row: string, selector: string, tokens: readonly string[], set: readonly string[] = []) {
    return entry.evaluate((root, at) => {
        const items = [...root.querySelectorAll<HTMLElement>(`${at.row} ${at.selector}`)];
        for (const item of items) for (const name of at.set) item.setAttribute(name, "");
        const probe = document.createElement("span");
        root.appendChild(probe);
        const tokens = Object.fromEntries(at.tokens.map((token) => {
            probe.style.color = `var(--chakra-colors-${token})`;
            return [token, getComputedStyle(probe).color];
        }));
        probe.remove();
        /** A computed `box-shadow`, shadow by shadow: its colour, then `x y blur spread`, then `inset`. */
        const shadowsOf = (text: string) => (text === "none" ? [] : text.split(/,(?![^(]*\))/).map((part) => {
            const shadow = part.trim();
            const px = [...shadow.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
            return { color: shadow.slice(0, shadow.search(/\s-?[\d.]+px/)).trim(), inset: shadow.endsWith("inset"), blur: px[2] ?? 0, spread: px[3] ?? 0 };
        }));
        const out = items.map((item) => {
            const style = getComputedStyle(item);
            return {
                key: at.selector.startsWith("[role") ? item.getAttribute("data-mark") : item.getAttribute(at.selector.slice(1, -1)),
                state: item.getAttribute("data-state"),
                shadows: shadowsOf(style.boxShadow),
                background: style.backgroundColor,
                color: style.color,
                borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(Number.parseFloat),
            };
        });
        for (const item of items) for (const name of at.set) item.removeAttribute(name);
        return { tokens, items: Object.fromEntries(out.map(({ key, ...rest }) => [key!, rest])) };
    }, { row, selector, tokens, set });
}

/** The theme's tokens the checks read: each tone's, the brand's edge, the ink and the warn. */
const READ = [...Object.values(TOKENS), "brand-solid", "fg"] as const;

/** A fully transparent colour, as the browser computes one. */
const CLEAR = "rgba(0, 0, 0, 0)";

/** The shadows that are rings: no blur, at a width. */
const rings = (item: Drawn, inset: boolean) => item.shadows.filter((shadow) => shadow.inset === inset && shadow.blur === 0);

test.describe("An item's status on the Plan (#1541)", () => {
    // A phone draws the Plan's rows as cards, with no item on them: the looks are the canvas's.
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read at the desktop width, where the canvas draws its rows");

    for (const theme of ["light", "dark"] as const) {
        for (const box of BOXES) {
            test(`planStatuses (${theme}): ${box.name} wears its tone's ring outside it, a confirmed one its brand ring inside, and a tentative one draws open`, async ({ page }) => {
                const entry = await openExample(page, "planStatuses", undefined, theme);
                const { tokens, items } = await drawn(entry, rowSel(box.series, "P03"), `[${box.attribute}]`, READ);
                const bad: string[] = [];
                SHOWN.forEach((shown, i) => {
                    const key = `${box.id}${i + 1}`;
                    const item = items[key] as Drawn | undefined;
                    if (item === undefined) { bad.push(`${key}: not drawn`); return; }
                    const outside = rings(item, false);
                    const inside = rings(item, true);
                    if (shown === undefined) {
                        // No status: no ring outside it.
                        if (outside.length > 0) bad.push(`${key}: no status, but a ring outside it — ${JSON.stringify(outside)}`);
                        return;
                    }
                    const tone = tokens[TOKENS[shown.tone]]!;
                    if (shown.ring) {
                        // Open: no fill, no border, its words in the ink, one ring just inside its edge.
                        if (item.background !== CLEAR) bad.push(`${key}: an open item filled ${item.background}`);
                        if (item.borders.some((width) => width !== 0)) bad.push(`${key}: an open item with borders ${item.borders.join(" ")}`);
                        if (item.color !== tokens.fg) bad.push(`${key}: an open item's words ${item.color}, not the ink ${tokens.fg}`);
                        if (outside.length > 0 || inside.length !== 1 || inside[0]!.spread !== 1.5 || inside[0]!.color !== tone) {
                            bad.push(`${key}: an open item's ring is one 1.5px ${tone} inside it — outside ${JSON.stringify(outside)}, inside ${JSON.stringify(inside)}`);
                        }
                        return;
                    }
                    // One ring outside it, 1.5px in its tone's colour.
                    if (outside.length !== 1 || outside[0]!.spread !== 1.5 || outside[0]!.color !== tone) {
                        bad.push(`${key}: its ${shown.tone} ring is one 1.5px ${tone} outside it — ${JSON.stringify(outside)}`);
                    }
                    // A confirmed one keeps its inset brand ring inside it; any other state draws none.
                    const kept = item.state === "appr" ? [{ color: tokens["brand-solid"]!, inset: true, blur: 0, spread: box.confirmed }] : [];
                    if (JSON.stringify(inside) !== JSON.stringify(kept)) bad.push(`${key} (${item.state}): inside it ${JSON.stringify(inside)}, expected ${JSON.stringify(kept)}`);
                });
                expect(bad).toEqual([]);
            });

            test(`planStatuses (${theme}): on ${box.name} an overlap's ring and a conflict's take its status's place, a danger keeps its own, and an open one keeps its ring inside each`, async ({ page }) => {
                const entry = await openExample(page, "planStatuses", undefined, theme);
                const row = rowSel(box.series, "P03");
                const key = (i: number) => `${box.id}${i + 1}`;
                const bad: string[] = [];

                // In an overlap pair: the warn ring outside every item but the danger one, which keeps its own.
                const overlap = await drawn(entry, row, `[${box.attribute}]`, READ, ["data-overlap"]);
                const warn = overlap.tokens["status-warn"]!;
                SHOWN.forEach((shown, i) => {
                    const item = overlap.items[key(i)] as Drawn;
                    const outside = rings(item, false);
                    const inside = rings(item, true);
                    if (shown?.ring === true) {
                        if (outside.length !== 1 || outside[0]!.color !== warn || inside.length !== 1 || inside[0]!.color !== overlap.tokens[TOKENS[shown.tone]]) {
                            bad.push(`${key(i)} overlapping, open: its own ring inside and the warn outside — ${JSON.stringify(item.shadows)}`);
                        }
                        return;
                    }
                    const want = shown?.tone === "danger" ? overlap.tokens["status-neg"]! : warn;
                    if (outside.length !== 1 || outside[0]!.spread !== 1.5 || outside[0]!.color !== want) {
                        bad.push(`${key(i)} overlapping: one 1.5px ${want} ring outside it — ${JSON.stringify(outside)}`);
                    }
                });

                // Holding a conflict: the conflict's ring and its glow, and no status ring outside; an open one keeps its ring inside.
                const conflict = await drawn(entry, row, `[${box.attribute}]`, READ, ["data-conflict"]);
                SHOWN.forEach((shown, i) => {
                    const item = conflict.items[key(i)] as Drawn;
                    const outside = item.shadows.filter((shadow) => !shadow.inset);
                    const ring = outside.filter((shadow) => shadow.blur === 0);
                    const glow = outside.filter((shadow) => shadow.blur > 0);
                    if (ring.length !== 1 || ring[0]!.spread !== 1 || ring[0]!.color !== conflict.tokens["status-warn"] || glow.length !== 1) {
                        bad.push(`${key(i)} conflicted: the conflict's 1px warn ring and its glow — ${JSON.stringify(outside)}`);
                    }
                    const inside = rings(item, true);
                    if (shown?.ring === true && (inside.length !== 1 || inside[0]!.color !== conflict.tokens[TOKENS[shown.tone]])) {
                        bad.push(`${key(i)} conflicted, open: its own ring inside — ${JSON.stringify(inside)}`);
                    }
                });

                // In a context strip the item's words are hidden, an open one's too.
                const strip = await drawn(entry, row, `[${box.attribute}]`, READ, ["data-ctx"]);
                SHOWN.forEach((_shown, i) => {
                    const item = strip.items[key(i)] as Drawn;
                    if (item.color !== CLEAR) bad.push(`${key(i)} in a context strip: its words ${item.color}, not hidden`);
                });
                expect(bad).toEqual([]);
            });
        }

        test(`planStatuses (${theme}): a mark's dot is its tone's colour, the brand with no status, and a tentative one an open dot`, async ({ page }) => {
            const entry = await openExample(page, "planStatuses", undefined, theme);
            const { tokens, items } = await drawn(entry, rowSel("checks", "P03"), '[role="button"][data-mark]', READ);
            const bad: string[] = [];
            SHOWN.forEach((shown, i) => {
                const key = `c${i + 1}`;
                const item = items[key] as Drawn | undefined;
                if (item === undefined) { bad.push(`${key}: not drawn`); return; }
                const inside = rings(item, true);
                if (shown === undefined) {
                    if (item.background !== tokens["brand-solid"]) bad.push(`${key}: no status, its dot ${item.background}, not the brand ${tokens["brand-solid"]}`);
                } else if (shown.ring) {
                    const tone = tokens[TOKENS[shown.tone]]!;
                    if (item.background !== CLEAR || inside.length !== 1 || inside[0]!.spread !== 1.5 || inside[0]!.color !== tone) {
                        bad.push(`${key}: an open dot is clear with one 1.5px ${tone} ring inside it — ${item.background}, ${JSON.stringify(item.shadows)}`);
                    }
                } else if (item.background !== tokens[TOKENS[shown.tone]] || item.shadows.length > 0) {
                    bad.push(`${key}: its ${shown.tone} dot ${item.background}, not ${tokens[TOKENS[shown.tone]]}, with ${JSON.stringify(item.shadows)}`);
                }
            });
            expect(bad).toEqual([]);
        });
    }
});
