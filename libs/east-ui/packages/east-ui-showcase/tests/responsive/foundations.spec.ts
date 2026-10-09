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

/** The download. */
const DS_DIR = join(HERE, "..", "..", "..", "..", "app_design_system");
/** The download's colour tokens. */
const COLORS_CSS = join(DS_DIR, "tokens", "colors.css");
/** The download's type tokens. */
const TYPOGRAPHY_CSS = join(DS_DIR, "tokens", "typography.css");
/** The download's base element styles. */
const BUNDLE_CSS = join(DS_DIR, "_ds_bundle.css");

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

/** A CSS file's rules: each selector of each rule, to its declarations. */
function cssRules(path: string): Map<string, Map<string, string>> {
    // An `@import url(…)` holds semicolons of its own (a font URL's `wght@400;500`).
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/@import\s+url\([^)]*\)[^;]*;/gu, "");
    const out = new Map<string, Map<string, string>>();
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
        const decls = new Map<string, string>();
        for (const decl of block[2]!.split(";")) {
            const colon = decl.indexOf(":");
            if (colon > 0) decls.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
        }
        for (const selector of block[1]!.split(",")) {
            const key = selector.trim().replace(/\s+/gu, " ");
            out.set(key, new Map([...(out.get(key) ?? []), ...decls]));
        }
    }
    return out;
}

/** The download's type and layout tokens, and its base element rules. */
const TYPE = cssRules(TYPOGRAPHY_CSS).get(":root")!;
const LAYOUT = cssRules(join(DS_DIR, "tokens", "layout.css")).get(":root")!;
const BUNDLE = cssRules(BUNDLE_CSS);

/** The download's layout tokens in dark, where they differ (the focus ring). */
const LAYOUT_DARK = cssRules(join(DS_DIR, "tokens", "layout.css")).get(".dark") ?? new Map<string, string>();

/** A design-system value in a mode, its `var()`s resolved. */
function dsIn(value: string, mode: Mode): string {
    return value.replace(/var\(\s*(--[\w-]+)\s*\)/gu, (_m, ref: string) => {
        const v = TYPE.get(ref) ?? (mode === "dark" ? LAYOUT_DARK.get(ref) : undefined) ?? LAYOUT.get(ref);
        return v !== undefined ? dsIn(v, mode) : dsColour(ref, mode);
    });
}

/** A base-style declaration with its `var()`s resolved — type and layout tokens, then (light) colours. */
function dsDeclared(value: string): string {
    return value.replace(/var\(\s*(--[\w-]+)\s*\)/gu, (_m, ref: string) => {
        const v = TYPE.get(ref) ?? LAYOUT.get(ref) ?? DS.light.get(ref);
        if (v === undefined) throw new Error(`the design system declares no ${ref}`);
        return dsDeclared(v);
    });
}

/** One element rule of `_ds_bundle.css`, its declarations resolved. */
function bundleRule(selector: string): Map<string, string> {
    const rule = BUNDLE.get(selector);
    if (rule === undefined) throw new Error(`_ds_bundle.css has no rule for ${selector}`);
    return new Map([...rule].map(([k, v]) => [k, dsDeclared(v)]));
}

/** A font stack's first family, without quotes or a variable font's ` Variable`. */
function firstFamily(stack: string): string {
    return stack.split(",")[0]!.trim().replace(/^["']|["']$/gu, "").replace(/ Variable$/u, "");
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

/** What the page computes for one probe element. */
interface Computed {
    family: string; size: number; weight: string; lineHeight: number; letterSpacing: number;
    color: [number, number, number, number]; background: [number, number, number, number];
    decoration: string; underlineOffset: string; paddingBlock: string; paddingInline: string;
    radius: string; height: number; minWidth: string; borderColor: [number, number, number, number]; fontFeatures: string;
}

/** Mounts the probes, then reads each one's computed type and colours. */
async function probe(page: Page, html: string): Promise<Record<string, Computed>> {
    return page.evaluate((markup) => {
        const c = (window as unknown as { __colour: ColourReader }).__colour;
        let box = document.querySelector<HTMLElement>("[data-type-probe]");
        if (box === null) {
            box = document.createElement("div");
            box.setAttribute("data-type-probe", "");
            document.body.append(box);
        }
        box.innerHTML = markup;
        const px = (v: string) => (v === "normal" ? 0 : Number.parseFloat(v));
        const out: Record<string, unknown> = {};
        for (const el of box.querySelectorAll<HTMLElement>("[data-probe]")) {
            const s = getComputedStyle(el);
            out[el.dataset.probe!] = {
                family: s.fontFamily, size: px(s.fontSize), weight: s.fontWeight,
                lineHeight: px(s.lineHeight), letterSpacing: px(s.letterSpacing),
                color: c.rgb(s.color), background: c.rgb(s.backgroundColor),
                decoration: s.textDecorationLine, underlineOffset: s.textUnderlineOffset,
                paddingBlock: `${s.paddingTop} ${s.paddingBottom}`, paddingInline: `${s.paddingLeft} ${s.paddingRight}`,
                radius: s.borderTopLeftRadius, height: el.getBoundingClientRect().height, minWidth: s.minWidth,
                borderColor: c.rgb(s.borderTopColor), fontFeatures: s.fontFeatureSettings,
            };
        }
        return out as Record<string, Computed>;
    }, html);
}

/** A design-system colour as the page paints it. */
async function painted(page: Page, css: string): Promise<[number, number, number, number]> {
    return page.evaluate((v) => (window as unknown as { __colour: ColourReader }).__colour.rgb(v), css);
}

/** Whether two painted colours are the same, to a channel step. */
const sameColour = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 1);

test.describe("Foundations — type", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("T1: h1–h6 render as the design system's base styles declare them (_ds_bundle.css)", async ({ page }) => {
        await open(page, "light");
        await installReader(page);
        const tags = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
        const read = await probe(page, tags.map((t) => `<${t} data-probe="${t}">Probe</${t}>`).join(""));
        const bad: string[] = [];
        for (const tag of tags) {
            const want = bundleRule(tag);
            const got = read[tag]!;
            const size = Number.parseFloat(want.get("font-size")!);
            const check = (what: string, ok: boolean, detail: string) => { if (!ok) bad.push(`${tag} ${what}: ${detail}`); };
            check("family", firstFamily(got.family) === firstFamily(want.get("font-family")!), `${got.family}, want ${want.get("font-family")}`);
            check("size", Math.abs(got.size - size) < 0.05, `${got.size}px, want ${size}px`);
            check("weight", got.weight === want.get("font-weight"), `${got.weight}, want ${want.get("font-weight")}`);
            const lh = Number.parseFloat(want.get("line-height")!) * size;
            check("line height", Math.abs(got.lineHeight - lh) < 0.05, `${got.lineHeight}px, want ${lh}px`);
            const ls = want.has("letter-spacing") ? Number.parseFloat(want.get("letter-spacing")!) * size : 0;
            check("tracking", Math.abs(got.letterSpacing - ls) < 0.01, `${got.letterSpacing}px, want ${ls}px`);
            // The ink a heading takes on a page is the page's — `--ink`.
            check("ink", sameColour(got.color, await painted(page, want.get("color")!)), `rgba(${got.color.join(", ")}), want ${want.get("color")}`);
        }
        expect(bad).toEqual([]);
    });

    test("T2: links, inline code, key caps and the page's figures render as the design system declares them", async ({ page }) => {
        await open(page, "light");
        await installReader(page);
        const read = await probe(page, [
            `<a href="#probe" data-probe="a">link</a>`,
            `<p style="font-size: 13px"><code data-probe="code">code</code></p>`,
            `<kbd data-probe="kbd">K</kbd>`,
        ].join(""));
        const bad: string[] = [];
        const check = (what: string, ok: boolean, detail: string) => { if (!ok) bad.push(`${what}: ${detail}`); };
        // A link: `--brand-d`, no underline (_ds_bundle.css › a).
        const a = bundleRule("a");
        check("link ink", sameColour(read.a!.color, await painted(page, a.get("color")!)), `rgba(${read.a!.color.join(", ")}), want ${a.get("color")}`);
        check("link decoration", read.a!.decoration === a.get("text-decoration"), `${read.a!.decoration}, want ${a.get("text-decoration")}`);
        // Inline code: mono at 0.92em on `--paper-3`, 1px 5px, `--r-sm` (_ds_bundle.css › code).
        const code = bundleRule("code");
        check("code family", firstFamily(read.code!.family) === firstFamily(code.get("font-family")!), `${read.code!.family}`);
        check("code size", Math.abs(read.code!.size - 13 * Number.parseFloat(code.get("font-size")!)) < 0.05, `${read.code!.size}px, want 0.92 × 13px`);
        check("code ground", sameColour(read.code!.background, await painted(page, code.get("background")!)), `rgba(${read.code!.background.join(", ")}), want ${code.get("background")}`);
        check("code padding", `${read.code!.paddingBlock}|${read.code!.paddingInline}` === "1px 1px|5px 5px", `${read.code!.paddingBlock} / ${read.code!.paddingInline}`);
        check("code radius", read.code!.radius === code.get("border-radius"), `${read.code!.radius}, want ${code.get("border-radius")}`);
        // A key cap (parts-kbd-avatar): 20 tall, mono 11 / 500 in `--ink-2` on
        // `--paper-2`, 1px `--rule-strong`, `--r-sm`.
        const kbd = read.kbd!;
        check("kbd height", Math.abs(kbd.height - 20) < 0.05, `${kbd.height}px, want 20px`);
        check("kbd family", firstFamily(kbd.family) === "JetBrains Mono", kbd.family);
        check("kbd size", Math.abs(kbd.size - Number.parseFloat(TYPE.get("--fs-label-lg")!)) < 0.05, `${kbd.size}px, want --fs-label-lg`);
        check("kbd weight", kbd.weight === TYPE.get("--fw-medium"), `${kbd.weight}, want --fw-medium`);
        check("kbd ink", sameColour(kbd.color, await painted(page, dsColour("--ink-2", "light"))), `rgba(${kbd.color.join(", ")})`);
        check("kbd ground", sameColour(kbd.background, await painted(page, dsColour("--paper-2", "light"))), `rgba(${kbd.background.join(", ")})`);
        check("kbd rule", sameColour(kbd.borderColor, await painted(page, dsColour("--rule-strong", "light"))), `rgba(${kbd.borderColor.join(", ")})`);
        check("kbd radius", kbd.radius === LAYOUT.get("--r-sm"), `${kbd.radius}, want --r-sm ${LAYOUT.get("--r-sm")}`);
        // Hovered, a link is `--brand-dd`, underlined 2px below (_ds_bundle.css › a:hover).
        await page.locator("[data-probe='a']").hover();
        const onHover = await page.evaluate(() => {
            const s = getComputedStyle(document.querySelector<HTMLElement>("[data-probe='a']")!);
            return { color: (window as unknown as { __colour: ColourReader }).__colour.rgb(s.color), decoration: s.textDecorationLine, offset: s.textUnderlineOffset };
        });
        const aHover = bundleRule("a:hover");
        check("hovered link ink", sameColour(onHover.color, await painted(page, aHover.get("color")!)), `rgba(${onHover.color.join(", ")}), want ${aHover.get("color")}`);
        check("hovered link decoration", onHover.decoration === aHover.get("text-decoration"), `${onHover.decoration}, want ${aHover.get("text-decoration")}`);
        check("hovered link offset", onHover.offset === aHover.get("text-underline-offset"), `${onHover.offset}, want ${aHover.get("text-underline-offset")}`);
        // Every figure on the page is tabular (_ds_bundle.css › html, body).
        const figures = await page.evaluate(() => getComputedStyle(document.body).fontFeatureSettings);
        check("page figures", /"tnum"/u.test(figures), figures);
        expect(bad).toEqual([]);
    });
});

/**
 * Every element on the page that casts a shadow — a box-shadow layer that is
 * not inset and is offset or blurred. A ring (`0 0 0 Npx`, spread only) and
 * an inset line are rules, not shadows, and pass.
 */
function castShadows(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        /** A computed box-shadow's layers — commas inside a colour function don't split. */
        const layers = (value: string): string[] => {
            const out: string[] = [];
            let depth = 0;
            let start = 0;
            for (let i = 0; i < value.length; i++) {
                if (value[i] === "(") depth++;
                else if (value[i] === ")") depth--;
                else if (value[i] === "," && depth === 0) { out.push(value.slice(start, i)); start = i + 1; }
            }
            out.push(value.slice(start));
            return out.map((l) => l.trim());
        };
        const bad: string[] = [];
        for (const el of document.querySelectorAll("*")) {
            const value = getComputedStyle(el).boxShadow;
            if (value === "none") continue;
            for (const layer of layers(value)) {
                if (/\binset\b/u.test(layer)) continue;
                const lengths = layer.replace(/[a-z-]+\([^)]*\)/giu, "").match(/-?[\d.]+px/gu) ?? [];
                const [x = 0, y = 0, blur = 0] = lengths.map((v) => Number.parseFloat(v));
                if (x !== 0 || y !== 0 || blur !== 0) {
                    const what = el.getAttribute("data-part") ?? el.getAttribute("data-slot") ?? el.className.toString().split(" ")[0];
                    bad.push(`<${el.tagName.toLowerCase()} ${what}>: ${layer}`);
                }
            }
        }
        return [...new Set(bad)];
    });
}

test.describe("Foundations — radii, shadows and motion", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    for (const mode of MODES) {
        test(`S1 (${mode}): nothing casts a shadow — frames, cards, chips and the overlays separate by rules (tokens/layout.css)`, async ({ page }) => {
            const bad: string[] = [];
            for (const hash of ["container/card/cardBasic", "collections/deck/deckBasic", "collections/library/libraryLarge", "collections/schematic/schematicSlice", "collections/flowchart/flowchartPlant", "e3/sheet/sheet/sheetStress"]) {
                await open(page, mode, hash);
                bad.push(...(await castShadows(page)).map((b) => `${hash} ${b}`));
            }
            // The overlays, open: a popover and a hover card.
            for (const [hash, button] of [["overlays/popover/popoverBasic", /^Open Popover$/u], ["overlays/hover-card/hoverCardOpenFromState", /^Pin the preview$/u]] as const) {
                await open(page, mode, hash);
                const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
                await entry.getByRole("button", { name: button }).first().click();
                await expect(page.locator('[data-part="content"][data-state="open"]').first()).toBeVisible();
                await settled(page);
                bad.push(...(await castShadows(page)).map((b) => `${hash} (open) ${b}`));
            }
            expect(bad).toEqual([]);
        });

        test(`S2 (${mode}): the keyboard's focus wears the one focus ring, --shadow-focus`, async ({ page }) => {
            await open(page, mode);
            await installReader(page);
            await page.keyboard.press("Tab");
            const ring = await page.evaluate(() => {
                const el = document.activeElement;
                return el === null || el === document.body ? null : getComputedStyle(el).boxShadow;
            });
            expect(ring, "a focused element").not.toBeNull();
            // The computed ring leads with its colour; the declared one ends with it.
            const parts = (v: string) => {
                const colour = /[a-z-]+\([^()]*\)/iu.exec(v)?.[0] ?? "";
                const lengths = v.replace(colour, "").trim().split(/\s+/u).filter((t) => t !== "").map((t) => Number.parseFloat(t));
                return { colour, lengths };
            };
            const got = parts(ring!);
            const want = parts(dsIn((mode === "dark" ? LAYOUT_DARK.get("--shadow-focus") : undefined) ?? LAYOUT.get("--shadow-focus")!, mode));
            expect(got.lengths, `offset, blur and spread of ${ring}`).toEqual(want.lengths);
            const gotColour = await painted(page, got.colour);
            const wantColour = await painted(page, want.colour);
            expect(gotColour.every((v, i) => Math.abs(v - wantColour[i]!) <= 2), `the ring's ink: rgba(${gotColour.join(", ")}), want ${want.colour}`).toBe(true);
        });
    }

    test("M1: motion is the design system's — the sidebar toggles over --dur-base on --ease-in-out, and a viewer who asks for less motion gets none", async ({ page }) => {
        await open(page, "light");
        const read = () => page.evaluate(() => {
            const s = getComputedStyle(document.querySelector("aside")!);
            return { duration: s.transitionDuration, easing: s.transitionTimingFunction };
        });
        const moving = await read();
        expect(Number.parseFloat(moving.duration) * 1000).toBe(Number.parseFloat(LAYOUT.get("--dur-base")!));
        expect(moving.easing).toBe(LAYOUT.get("--ease-in-out")!.replace(/\s+/gu, " ").replace(/,\s*/gu, ", "));
        await page.emulateMedia({ reducedMotion: "reduce" });
        const still = await read();
        expect(Number.parseFloat(still.duration), `reduced: ${still.duration}`).toBeLessThan(0.001);
    });
});
