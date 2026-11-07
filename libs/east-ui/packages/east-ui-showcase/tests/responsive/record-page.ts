/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Record's examples on the showcase's page, for the specs that measure its
 * grid and its inspector (`Record - DX Proposal.md` §4): an example opened at a
 * width it draws a desktop's frame at, on the day the proposal walks; the
 * theme's values its parts are held to, as the page computes them; and a
 * part's look as the page draws it.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { settled } from "./settle";
import { computed, token } from "./tokens";

/** What a Record's example is, in its entry. */
export const RECORD_ROOT = "[data-builder-frame]";

/** A colour that paints nothing. */
export const CLEAR = "rgba(0, 0, 0, 0)";

/** The themes a Record's colours are measured in. */
export const RECORD_THEMES = ["light", "dark"] as const;

/**
 * Opens an example of the Record's at a width it draws a desktop's frame at,
 * the page's clock held at the day the proposal walks, so each age is one
 * count whenever the suite runs.
 *
 * @param page - The page: Playwright's own, which holds the clock
 * @param name - The example
 * @param theme - The theme
 * @param width - The viewport's width, in px
 * @returns The example's entry
 */
export async function openRecord(page: Page, name: string, theme: "light" | "dark", width: number): Promise<Locator> {
    await page.clock.setFixedTime(new Date("2026-11-06T12:00:00Z"));
    await page.setViewportSize({ width, height: 1200 });
    const entry = await visitBuilder(page, `e3/record/record/${name}`, RECORD_ROOT, theme);
    await expect(entry.locator('[data-record] [data-slot="row"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(entry.locator(RECORD_ROOT).first(), "a desktop's frame").not.toHaveAttribute("data-phone", "");
    await settled(page);
    return entry;
}

/** A row of a Record's, by its key. */
export const rowOf = (entry: Locator, id: string): Locator => entry.locator(`[data-record] [data-slot="row"][data-row-id="${id}"]`);

/** A cell of a Record's, by its row's key and its column's. */
export const cellOf = (entry: Locator, id: string, key: string): Locator => rowOf(entry, id).locator(`[data-slot="cell"][data-key="${key}"]`);

/** The colour tokens a Record's parts are held to. */
const COLOURS = [
    "bg-surface", "bg-canvas", "bg-subtle", "fg", "fg-subtle", "fg-muted", "fg-strong", "fg-warning", "border-subtle", "border-strong",
    "brand-solid", "brand-tint", "heat-2", "heat-4", "status-pos", "status-pos-subtle", "fg-success", "status-neg", "status-neg-subtle", "fg-danger",
] as const;

/** The type sizes a Record's parts are set at. */
const SIZES = ["label-xs", "label-sm", "label-md", "label-lg", "body-sm", "body", "title-md"] as const;

/** The theme's values a Record's parts are held to, as the page computes them. */
export interface RecordTheme {
    /** Each colour, by its token's name. */
    readonly c: Readonly<Record<(typeof COLOURS)[number], string>>;
    /** Each type size, by its token's name. */
    readonly size: Readonly<Record<(typeof SIZES)[number], string>>;
    readonly mono: string;
    readonly body: string;
    readonly heading: string;
    /** The ring inside a cell (ST5). */
    readonly focusInset: string;
    /** A draft row's wash (ST7). */
    readonly draftWash: string;
    /** A new row's empty required cell's wash (ST8), and a field an issue names in the inspector (IN3). */
    readonly requiredWash: string;
}

/**
 * The theme's values a Record's parts are held to: each colour, size and
 * family, and what its recipes make of them — the ring inside a cell, and the
 * warn washes a draft row and an empty required cell wear.
 *
 * @param page - The page
 * @returns The values
 */
export async function recordTheme(page: Page): Promise<RecordTheme> {
    const c = Object.fromEntries(await Promise.all(COLOURS.map(async (name) => [name, await token(page, name)] as const))) as RecordTheme["c"];
    const size = Object.fromEntries(await Promise.all(SIZES.map(async (name) =>
        [name, await computed(page, "fontSize", `var(--chakra-font-sizes-${name})`)] as const))) as RecordTheme["size"];
    return {
        c, size,
        mono: await computed(page, "fontFamily", "var(--chakra-fonts-mono)"),
        body: await computed(page, "fontFamily", "var(--chakra-fonts-body)"),
        heading: await computed(page, "fontFamily", "var(--chakra-fonts-heading)"),
        focusInset: await computed(page, "boxShadow", "var(--chakra-shadows-focus-inset)"),
        draftWash: await computed(page, "backgroundColor", "color-mix(in oklch, var(--chakra-colors-status-warn) 8%, var(--chakra-colors-bg-surface))"),
        requiredWash: await computed(page, "backgroundColor", "color-mix(in srgb, var(--chakra-colors-status-warn) 17%, var(--chakra-colors-bg-surface))"),
    };
}

/** A part as the page draws it: its words, its box, its type and its colours. */
export interface PartLook {
    readonly text: string;
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly width: number;
    readonly height: number;
    readonly mid: number;
    readonly family: string;
    readonly size: string;
    readonly weight: string;
    /** Its letter spacing in ems, to the hundredth. */
    readonly spacing: number;
    readonly caps: string;
    readonly line: string;
    readonly ink: string;
    readonly bg: string;
    readonly edge: string;
    readonly radius: string;
    readonly shadow: string;
    /** The rule under it: its width and its colour. */
    readonly under: string;
    readonly gap: string;
    readonly tnum: boolean;
    /** Whether its words are wider than its box: cut. */
    readonly cut: boolean;
}

/**
 * Each part a selector names inside an element, as the page draws it: its box
 * to the half pixel, its type and its colours — `null` for a part not there.
 *
 * @param target - The element the parts are in
 * @param parts - Each part's selector, by its name; `""` is the element itself
 * @returns Each part's look, by its name
 */
export function looks<K extends string>(target: Locator, parts: Readonly<Record<K, string>>): Promise<Record<K, PartLook | null>> {
    return target.evaluate((root, selectors) => {
        const half = (n: number) => Math.round(n * 2) / 2;
        const look = (el: Element) => {
            const s = getComputedStyle(el);
            const b = el.getBoundingClientRect();
            const size = parseFloat(s.fontSize);
            return {
                text: el.textContent ?? "", left: half(b.left), right: half(b.right), top: half(b.top), bottom: half(b.bottom),
                width: half(b.width), height: half(b.height), mid: half(b.left + b.width / 2),
                family: s.fontFamily, size: s.fontSize, weight: s.fontWeight,
                spacing: s.letterSpacing === "normal" ? 0 : Math.round(parseFloat(s.letterSpacing) / size * 100) / 100,
                caps: s.textTransform, line: s.lineHeight, ink: s.color, bg: s.backgroundColor, edge: s.borderTopColor, radius: s.borderTopLeftRadius,
                shadow: s.boxShadow, under: `${s.borderBottomWidth} ${s.borderBottomColor}`, gap: s.columnGap,
                tnum: s.fontFeatureSettings.includes("tnum"), cut: el.scrollWidth > el.clientWidth,
            };
        };
        return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
            const el = selector === "" ? root : root.querySelector(selector);
            return [name, el === null ? null : look(el)];
        }));
    }, parts as Readonly<Record<string, string>>) as Promise<Record<K, PartLook | null>>;
}

/**
 * Waits out every transition an element and what it holds are running: what it
 * shows once a change of the pointer's has played.
 *
 * @param target - The element
 */
export async function played(target: Locator): Promise<void> {
    await target.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.then(() => undefined, () => undefined))));
}
