/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The design system's foundations, measured in the page (#1092 › Tokens and
 * dark mode). The token guard (`east-ui-components/src/theme/
 * design-system.test.ts`) holds the theme's token values to the download in
 * `libs/east-ui/app_design_system/`; these specs read what the browser renders
 * from them, in both themes:
 *
 *  - F1 every design-system colour renders as the design system declares it —
 *    the page's resolved token against the design system's own expression;
 *  - F2 readable ink (`--ink` … `--ink-4`) holds 4.5:1 on every paper and on
 *    `--brand-tint`;
 *  - F3 a valence set as text — its text step — holds 4.5:1 on every paper, on
 *    `--brand-tint`, and on its own 6% wash over each;
 *  - F4 a heat cell's value ink holds 4.5:1 on its step;
 *  - F5 the page is `--paper-2` and a Frame `--paper` on it.
 *
 * A colour is read the way it is painted: resolved by the page, then drawn on
 * a one-pixel canvas and read back as sRGB, so a mix in oklch compares as the
 * colour it renders. No image is kept or compared.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test foundations --project desktop`.
 */

import { test, expect, type Page } from "playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { settled } from "./settle";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** The download's colour tokens. */
const COLORS_CSS = join(HERE, "..", "..", "..", "..", "app_design_system", "tokens", "colors.css");

type Mode = "light" | "dark";
const MODES = ["light", "dark"] as const satisfies readonly Mode[];

/** `tokens/colors.css`'s custom properties: its `:root` block, and its dark block. */
function colourTokens(): { light: Map<string, string>; dark: Map<string, string> } {
    const css = readFileSync(COLORS_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    const out = { light: new Map<string, string>(), dark: new Map<string, string>() };
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
        const selector = block[1]!.trim().replace(/\s+/gu, " ");
        const into = selector === ":root" ? out.light : selector === '[data-theme="dark"], .dark' ? out.dark : undefined;
        if (into === undefined) throw new Error(`tokens/colors.css: a block under "${selector}" the spec does not read`);
        for (const decl of block[2]!.split(";")) {
            const colon = decl.indexOf(":");
            if (colon > 0) into.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
        }
    }
    return out;
}

const DS = colourTokens();

/** A design-system colour in a mode, as a CSS expression of literals only. */
function dsColour(name: string, mode: Mode): string {
    const value = (mode === "dark" ? DS.dark.get(name) : undefined) ?? DS.light.get(name);
    if (value === undefined) throw new Error(`the design system declares no ${name}`);
    return value.replace(/var\(\s*(--[\w-]+)\s*\)/gu, (_m, ref: string) => dsColour(ref, mode));
}

/** The CSS variable the theme writes for each design-system colour's one token. */
const THEME_VAR: Readonly<Record<string, string>> = {
    "--ink": "--chakra-colors-fg",
    "--ink-2": "--chakra-colors-fg-strong",
    "--ink-3": "--chakra-colors-fg-muted",
    "--ink-4": "--chakra-colors-fg-subtle",
    "--ink-5": "--chakra-colors-fg-faint",
    "--paper": "--chakra-colors-bg-surface",
    "--paper-2": "--chakra-colors-bg-canvas",
    "--paper-3": "--chakra-colors-bg-subtle",
    "--rule": "--chakra-colors-border-subtle",
    "--rule-strong": "--chakra-colors-border-strong",
    "--brand": "--chakra-colors-brand-mark",
    "--brand-d": "--chakra-colors-brand-solid",
    "--brand-dd": "--chakra-colors-brand-pressed",
    "--brand-tint": "--chakra-colors-brand-tint",
    "--pos": "--chakra-colors-status-pos",
    "--neg": "--chakra-colors-status-neg",
    "--warn": "--chakra-colors-status-warn",
    "--info": "--chakra-colors-status-info",
    "--pos-text": "--chakra-colors-fg-success",
    "--neg-text": "--chakra-colors-fg-danger",
    "--warn-text": "--chakra-colors-fg-warning",
    "--info-text": "--chakra-colors-fg-info",
    "--heat-1": "--chakra-colors-heat-1",
    "--heat-2": "--chakra-colors-heat-2",
    "--heat-3": "--chakra-colors-heat-3",
    "--heat-4": "--chakra-colors-heat-4",
    "--heat-5": "--chakra-colors-heat-5",
    "--bg-inverse": "--chakra-colors-bg-inverse",
    "--fg-inverse": "--chakra-colors-fg-inverse",
};

/** Each valence's base, text step and 6% wash, as the theme writes them. */
const VALENCES = [
    { name: "pos", text: "--chakra-colors-fg-success", wash: "--chakra-colors-status-pos-subtle" },
    { name: "neg", text: "--chakra-colors-fg-danger", wash: "--chakra-colors-status-neg-subtle" },
    { name: "warn", text: "--chakra-colors-fg-warning", wash: "--chakra-colors-status-warn-subtle" },
    { name: "info", text: "--chakra-colors-fg-info", wash: "--chakra-colors-status-info-subtle" },
] as const;

/** The surfaces readable text must hold on: the three papers and the tint. */
const GROUNDS = ["--paper", "--paper-2", "--paper-3", "--brand-tint"] as const;

/** Open a showcase page in a theme, at rest. */
async function open(page: Page, mode: Mode, hash = "container/card/cardBasic"): Promise<void> {
    await page.goto(`/?theme=${mode}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await expect(page.locator(`a[href="#${hash}"]`).first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), `the page is in ${mode}`).toBe(mode === "dark");
}

/** Installs the page's colour reader: any CSS colour (a token, a mix, a
 *  literal), resolved by the page, drawn over a ground and read back as sRGB. */
async function installReader(page: Page): Promise<void> {
    await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.setAttribute("data-colour-probe", "");
        document.body.append(probe);
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const resolve = (css: string): string => {
            probe.style.color = "";
            probe.style.color = css;
            return getComputedStyle(probe).color;
        };
        const rgb = (css: string, under?: string): [number, number, number, number] => {
            ctx.clearRect(0, 0, 1, 1);
            if (under !== undefined) {
                ctx.fillStyle = resolve(under);
                ctx.fillRect(0, 0, 1, 1);
            }
            ctx.fillStyle = resolve(css);
            ctx.fillRect(0, 0, 1, 1);
            const d = ctx.getImageData(0, 0, 1, 1).data;
            return [d[0]!, d[1]!, d[2]!, d[3]!];
        };
        const lum = ([r, g, b]: number[]): number => {
            const lin = (x: number) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
        };
        /** The WCAG contrast of a text colour on a ground (the text drawn over it). */
        const contrast = (text: string, ground: string): number => {
            const g = rgb(ground, "#808080");
            const t = rgb(text, ground);
            const [a, b] = [lum(t), lum(g)];
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        (window as unknown as { __colour: unknown }).__colour = { resolve, rgb, contrast };
    });
}

interface ColourReader {
    resolve: (css: string) => string;
    rgb: (css: string, under?: string) => [number, number, number, number];
    contrast: (text: string, ground: string) => number;
}

test.describe("Foundations — colour", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    for (const mode of MODES) {
        test(`F1 (${mode}): every design-system colour renders as the design system declares it`, async ({ page }) => {
            await open(page, mode);
            await installReader(page);
            const pairs = Object.entries(THEME_VAR).map(([ds, cssVar]) => ({ ds, theme: `var(${cssVar})`, want: dsColour(ds, mode) }));
            const bad = await page.evaluate((rows) => {
                const c = (window as unknown as { __colour: ColourReader }).__colour;
                return rows.flatMap(({ ds, theme, want }) => {
                    const got = c.rgb(theme);
                    const exp = c.rgb(want);
                    const off = got.some((v, i) => Math.abs(v - exp[i]!) > 1);
                    return off ? [`${ds}: rendered rgba(${got.join(", ")}), the design system's rgba(${exp.join(", ")}) (${want})`] : [];
                });
            }, pairs);
            expect(bad).toEqual([]);
        });

        test(`F2 (${mode}): readable ink holds 4.5:1 on every paper and on --brand-tint`, async ({ page }) => {
            await open(page, mode);
            await installReader(page);
            const inks = ["--ink", "--ink-2", "--ink-3", "--ink-4"];
            const bad = await page.evaluate(({ inks, grounds, vars }) => {
                const c = (window as unknown as { __colour: ColourReader }).__colour;
                return inks.flatMap((ink) => grounds.flatMap((ground) => {
                    const k = c.contrast(`var(${vars[ink]})`, `var(${vars[ground]})`);
                    return k < 4.5 ? [`${ink} on ${ground}: ${k.toFixed(2)}:1`] : [];
                }));
            }, { inks, grounds: [...GROUNDS], vars: THEME_VAR });
            expect(bad).toEqual([]);
        });

        test(`F3 (${mode}): a valence set as text holds 4.5:1 on every paper, on --brand-tint and on its own wash over each`, async ({ page }) => {
            await open(page, mode);
            await installReader(page);
            const bad = await page.evaluate(({ valences, grounds, vars }) => {
                const c = (window as unknown as { __colour: ColourReader }).__colour;
                return valences.flatMap((v) => grounds.flatMap((ground) => {
                    const paper = `var(${vars[ground]})`;
                    const plain = c.contrast(`var(${v.text})`, paper);
                    // The wash over this ground: drawn, read back, and the text read on it.
                    const [r, g, b] = c.rgb(`var(${v.wash})`, paper);
                    const washed = c.contrast(`var(${v.text})`, `rgb(${r}, ${g}, ${b})`);
                    return [
                        ...(plain < 4.5 ? [`${v.name} text on ${ground}: ${plain.toFixed(2)}:1`] : []),
                        ...(washed < 4.5 ? [`${v.name} text on its wash over ${ground}: ${washed.toFixed(2)}:1`] : []),
                    ];
                }));
            }, { valences: [...VALENCES], grounds: [...GROUNDS], vars: THEME_VAR });
            expect(bad).toEqual([]);
        });

        test(`F4 (${mode}): a heat value holds 4.5:1 on its step — --ink on 1–3, --paper on 4–5`, async ({ page }) => {
            await open(page, mode);
            await installReader(page);
            const bad = await page.evaluate((vars) => {
                const c = (window as unknown as { __colour: ColourReader }).__colour;
                return [1, 2, 3, 4, 5].flatMap((step) => {
                    const ink = step <= 3 ? vars["--ink"] : vars["--paper"];
                    const k = c.contrast(`var(${ink})`, `var(${vars[`--heat-${step}`]})`);
                    return k < 4.5 ? [`heat ${step}: ${k.toFixed(2)}:1`] : [];
                });
            }, THEME_VAR);
            expect(bad).toEqual([]);
        });

        test(`F5 (${mode}): the page is --paper-2, and a Frame --paper on it`, async ({ page }) => {
            await open(page, mode);
            await installReader(page);
            const read = await page.evaluate((vars) => {
                const c = (window as unknown as { __colour: ColourReader }).__colour;
                const card = document.querySelector(".chakra-card__root");
                const same = (el: Element | null, token: string) => {
                    if (el === null) return "absent";
                    const got = c.rgb(getComputedStyle(el).backgroundColor);
                    const want = c.rgb(`var(${vars[token]})`);
                    return got.every((v, i) => Math.abs(v - want[i]!) <= 1) ? "ok" : `rgba(${got.join(", ")}), want ${token}`;
                };
                return { page: same(document.body, "--paper-2"), frame: same(card, "--paper") };
            }, THEME_VAR);
            expect(read).toEqual({ page: "ok", frame: "ok" });
        });
    }
});
