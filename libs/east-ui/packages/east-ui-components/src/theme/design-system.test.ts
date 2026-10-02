/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The token guard: the theme follows the design system.
 *
 * The East Design System lives in claude.ai/design ("East Design System") and
 * is downloaded, read-only, into `libs/east-ui/app_design_system/`. Its tokens
 * are `tokens/colors.css`, `tokens/typography.css` and `tokens/layout.css`: a
 * light block (`:root`) and a dark one (`[data-theme="dark"], .dark`). This
 * reads those files and holds every design-system token to the theme token
 * {@link TABLE} names for it — its value in light and in dark, resolved through
 * the theme's references exactly as Chakra layers them — and fails naming the
 * token on any drift. A new token in the design system fails too, until the
 * table maps it.
 *
 * It also holds every token a theme module names to existing: a reference to a
 * token that isn't there (`{easings.smooth}`, `warning.subtle.strong`) resolves
 * to nothing, and the style it carries is silently dropped.
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { system } from "./index.js";

/** The download's token files. */
const TOKENS = fileURLToPath(new URL("../../../../app_design_system/tokens/", import.meta.url));
const TOKEN_FILES = ["colors.css", "typography.css", "layout.css"] as const;

type Mode = "light" | "dark";
const MODES = ["light", "dark"] as const satisfies readonly Mode[];

// ─── The design system's tokens, read from its CSS ──────────────────────────

/** One file's custom properties, by block. */
interface Declared { light: Map<string, string>; dark: Map<string, string> }

/**
 * A token file's custom properties: `:root` is the light block, the
 * `[data-theme="dark"], .dark` block the dark one. Any other selector fails —
 * the guard must learn it before it can hold the theme to it.
 */
function declared(file: string): Declared {
    const css = readFileSync(join(TOKENS, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/@import\s+url\([^)]*\)\s*;/gu, "");
    const out: Declared = { light: new Map(), dark: new Map() };
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
        const selector = block[1]!.trim().replace(/\s+/gu, " ");
        const into = selector === ":root" ? out.light
            : selector === '[data-theme="dark"], .dark' ? out.dark
            : undefined;
        if (into === undefined) throw new Error(`tokens/${file}: a block under "${selector}", which the guard does not read`);
        for (const decl of block[2]!.split(";")) {
            const colon = decl.indexOf(":");
            if (colon < 0) continue;
            const name = decl.slice(0, colon).trim();
            if (name.startsWith("--")) into.set(name, decl.slice(colon + 1).trim());
        }
    }
    return out;
}

const DS: Declared = { light: new Map(), dark: new Map() };
for (const file of TOKEN_FILES) {
    const d = declared(file);
    for (const [k, v] of d.light) DS.light.set(k, v);
    for (const [k, v] of d.dark) DS.dark.set(k, v);
}

/**
 * A design-system token's value in a mode, its `var()`s resolved in that mode.
 * The dark block overrides the light one; a token only `:root` declares is the
 * same in both (the raw scales, the sizes).
 */
function dsValue(name: string, mode: Mode, seen: readonly string[] = []): string {
    if (seen.includes(name)) throw new Error(`a cycle in the design system: ${[...seen, name].join(" → ")}`);
    const value = (mode === "dark" ? DS.dark.get(name) : undefined) ?? DS.light.get(name);
    if (value === undefined) throw new Error(`the design system declares no ${name}`);
    return value.replace(/var\(\s*(--[\w-]+)\s*\)/gu, (_m, ref: string) => dsValue(ref, mode, [...seen, name]));
}

// ─── The theme's tokens, resolved as Chakra layers them ─────────────────────

const THEME = system._config.theme as {
    tokens: Record<string, unknown>;
    semanticTokens: Record<string, unknown>;
    textStyles: Record<string, unknown>;
    layerStyles: Record<string, unknown>;
};

/** The node at a dotted path. A key may hold dots itself (`bg["success.subtle"]`). */
function nodeAt(tree: unknown, parts: readonly string[]): unknown {
    if (parts.length === 0) return tree;
    if (tree === null || typeof tree !== "object") return undefined;
    for (let n = parts.length; n >= 1; n--) {
        const key = parts.slice(0, n).join(".");
        if (Object.hasOwn(tree, key)) {
            const found = nodeAt((tree as Record<string, unknown>)[key], parts.slice(n));
            if (found !== undefined) return found;
        }
    }
    return undefined;
}

/** A token's own `{ value }`: the node, or the group's `DEFAULT`. */
function tokenOf(node: unknown): { value: unknown } | undefined {
    if (node === null || typeof node !== "object") return undefined;
    if ("value" in node) return node as { value: unknown };
    if ("DEFAULT" in node) return tokenOf((node as Record<string, unknown>)["DEFAULT"]);
    return undefined;
}

/** The theme token at `category.path` — the semantic token where both define
 *  one (Chakra registers it last, so it is the one a reference reads). */
function themeToken(path: string): { value: unknown } | undefined {
    const [category, ...rest] = path.split(".");
    return tokenOf(nodeAt(THEME.semanticTokens[category!], rest))
        ?? tokenOf(nodeAt(THEME.tokens[category!], rest));
}

/**
 * A token's value in a mode. Chakra writes `base` under `:where(html,
 * .chakra-theme)`, `_light` under `:root` and `_dark` under `.dark` after it,
 * so light reads `_light` over `base`, and dark — where `:root` matches too —
 * `_dark`, then `_light`, then `base`.
 */
function pick(path: string, value: unknown, mode: Mode): string {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (value === null || typeof value !== "object") throw new Error(`${path}: a value of no shape the guard reads`);
    const conditions = value as Record<string, unknown>;
    for (const key of Object.keys(conditions)) {
        if (!["base", "_light", "_dark"].includes(key)) throw new Error(`${path}: a "${key}" condition, which the guard does not read`);
    }
    const chosen = mode === "light"
        ? conditions["_light"] ?? conditions["base"]
        : conditions["_dark"] ?? conditions["_light"] ?? conditions["base"];
    if (typeof chosen !== "string" && typeof chosen !== "number") throw new Error(`${path}: no ${mode} value`);
    return String(chosen);
}

/** A theme token's value in a mode, its `{references}` resolved in that mode. */
function themeValue(path: string, mode: Mode, seen: readonly string[] = []): string {
    if (seen.includes(path)) throw new Error(`a cycle in the theme: ${[...seen, path].join(" → ")}`);
    const token = themeToken(path);
    if (token === undefined) throw new Error(`the theme has no token ${path}`);
    return pick(path, token.value, mode).replace(/\{([^}]+)\}/gu, (_m, ref: string) => {
        if (ref.includes("/")) throw new Error(`${path}: the alpha reference {${ref}} is not a design-system value`);
        return themeValue(ref.trim(), mode, [...seen, path]);
    });
}

// ─── Comparing ──────────────────────────────────────────────────────────────

/** A value in one spelling: whitespace, case and short hex evened out. */
function normal(value: string): string {
    return value.trim()
        .replace(/\s+/gu, " ")
        .replace(/\s*,\s*/gu, ", ")
        .replace(/\(\s+/gu, "(")
        .replace(/\s+\)/gu, ")")
        .replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/giu, "#$1$1$2$2$3$3")
        .toLowerCase();
}

/**
 * A font stack, its families unquoted. The theme self-hosts each family's
 * variable face (`@fontsource-variable/*`), registered as "<Family> Variable"
 * and named first, before the family itself; that face is the family, so it is
 * dropped before the stacks are compared.
 */
function fontStack(value: string): string {
    const families = value.split(",").map((f) => f.trim().replace(/^["']|["']$/gu, "")).filter((f) => f !== "");
    return families
        .filter((f, i) => !(f.endsWith(" Variable") && families[i + 1] === f.slice(0, -" Variable".length)))
        .join(", ");
}

function comparable(ds: string, value: string): string {
    return ds.startsWith("--font-") ? fontStack(value) : normal(value);
}

// ─── The mapping table ──────────────────────────────────────────────────────

/**
 * Every design-system token and the ONE theme token that holds its value,
 * with the aliases that must hold it too. Paths are `category.path`.
 */
const TABLE: ReadonlyArray<readonly [ds: string, theme: string, aliases?: readonly string[]]> = [
    // Ink — text.
    ["--ink", "colors.fg", ["colors.fg.default"]],
    ["--ink-2", "colors.fg.strong"],
    ["--ink-3", "colors.fg.muted", ["colors.neutral.fg"]],
    ["--ink-4", "colors.fg.subtle", ["colors.neutral.solid"]],
    ["--ink-5", "colors.fg.faint"],
    // Paper — surfaces.
    ["--paper", "colors.bg.surface", ["colors.bg", "colors.brand.contrast"]],
    ["--paper-2", "colors.bg.canvas", ["colors.bg.panel"]],
    ["--paper-3", "colors.bg.subtle", ["colors.bg.muted", "colors.bg.emphasized", "colors.neutral.subtle"]],
    // Rules — structure.
    ["--rule", "colors.border.subtle", ["colors.border", "colors.border.muted"]],
    ["--rule-strong", "colors.border.strong", ["colors.border.emphasized", "colors.neutral.border"]],
    // Brand.
    ["--brand", "colors.brandMark", ["colors.border.focus", "colors.brand.focusRing"]],
    ["--brand-d", "colors.brand.solid", ["colors.link", "colors.border.brand", "colors.brand.border", "colors.series.brand"]],
    ["--brand-dd", "colors.brandPressed", ["colors.brand.fg", "colors.brand.emphasized", "colors.link.hover"]],
    ["--brand-tint", "colors.brandTint", ["colors.bg.brand.subtle", "colors.brand.muted", "colors.brand.subtle"]],
    // Valence — the bases mark; the text steps are words.
    ["--pos", "colors.status.pos", ["colors.success.solid", "colors.border.success"]],
    ["--neg", "colors.status.neg", ["colors.danger.solid", "colors.border.error"]],
    ["--warn", "colors.status.warn", ["colors.warning.solid", "colors.border.warning"]],
    ["--info", "colors.status.info", ["colors.info.solid", "colors.border.info"]],
    ["--pos-text", "colors.fg.success", ["colors.success.fg"]],
    ["--neg-text", "colors.fg.danger", ["colors.danger.fg", "colors.fg.error"]],
    ["--warn-text", "colors.fg.warning", ["colors.warning.fg"]],
    ["--info-text", "colors.fg.info", ["colors.info.fg"]],
    // The sequential ramp.
    ["--heat-1", "colors.heat.1"],
    ["--heat-2", "colors.heat.2"],
    ["--heat-3", "colors.heat.3"],
    ["--heat-4", "colors.heat.4"],
    ["--heat-5", "colors.heat.5"],
    // Inverse — the Stamp and the Tooltip.
    ["--bg-inverse", "colors.bg.inverse", ["colors.bg.inverted"]],
    ["--fg-inverse", "colors.fg.inverse", ["colors.fg.inverted"]],
    // Chart accents, in the comparison order after series 1.
    ["--teal-500", "colors.accent.teal", ["colors.series.brandDeep"]],
    ["--purple-500", "colors.accent.purple"],
    ["--blue-500", "colors.accent.blue"],
    ["--orange-500", "colors.accent.orange"],
    // The raw scales the semantic tokens are drawn from.
    ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((step) => [
        [`--brand-${step}`, `colors.brand.${step}`] as const,
        [`--gray-${step}`, `colors.gray.${step}`] as const,
    ]),
    // Type.
    ["--font-brand", "fonts.heading"],
    ["--font-body", "fonts.body"],
    ["--font-mono", "fonts.mono"],
    ["--fs-label-xs", "fontSizes.label.xs"],
    ["--fs-label-sm", "fontSizes.label.sm"],
    ["--fs-label-md", "fontSizes.label.md"],
    ["--fs-label-lg", "fontSizes.label.lg"],
    ["--fs-body-sm", "fontSizes.body.sm"],
    ["--fs-body", "fontSizes.body"],
    ["--fs-body-lg", "fontSizes.body.lg"],
    ["--fs-title-xs", "fontSizes.title.xs"],
    ["--fs-title-sm", "fontSizes.title.sm"],
    ["--fs-title-md", "fontSizes.title.md"],
    ["--fs-title-lg", "fontSizes.title.lg"],
    ["--fs-title-xl", "fontSizes.title.xl"],
    ["--fs-num", "fontSizes.num"],
    ["--fw-light", "fontWeights.light"],
    ["--fw-normal", "fontWeights.normal"],
    ["--fw-medium", "fontWeights.medium"],
    ["--fw-semibold", "fontWeights.semibold"],
    ["--fw-bold", "fontWeights.bold"],
    ["--fw-extra", "fontWeights.extrabold"],
    ["--lh-tight", "lineHeights.tight"],
    ["--lh-snug", "lineHeights.snug"],
    ["--lh-normal", "lineHeights.normal"],
    ["--lh-relaxed", "lineHeights.relaxed"],
    // Space — the 4px scale.
    ...(["0", "1", "2", "3", "4", "5", "6", "8", "10", "12", "16", "20"] as const)
        .map((step) => [`--sp-${step}`, `spacing.${step}`] as const),
    // Radii.
    ["--r-sm", "radii.sm"],
    ["--r-md", "radii.md"],
    ["--r-lg", "radii.lg"],
    ["--r-full", "radii.full"],
    // The one shadow: the focus ring, outside on controls, inset on cells and rows.
    ["--shadow-focus", "shadows.focus"],
    ["--shadow-focus-inset", "shadows.focusInset"],
    // Motion.
    ["--dur-fast", "durations.fast"],
    ["--dur-base", "durations.normal"],
    ["--dur-slow", "durations.slow"],
    ["--ease-out", "easings.out"],
    ["--ease-in-out", "easings.inOut"],
];

/**
 * What the design system declares and the theme has no token for, by the
 * design system's own word: the deprecated set it keeps "only so older mocks
 * resolve; never use" (its README, Tokens), and the raw hues it never names
 * for a chart (its chart order is teal, purple, blue, orange).
 */
const NOT_THEMED = new Set([
    "--bg-primary", "--bg-secondary", "--bg-tertiary", "--fg-primary", "--fg-secondary", "--fg-muted",
    "--border-subtle", "--border-strong", "--border-focus", "--card-bg", "--card-border",
    "--link", "--link-hover", "--brand-l",
    "--shadow-xs", "--shadow-sm", "--shadow-md", "--shadow-lg", "--shadow-xl",
    "--green-500", "--red-500", "--yellow-500",
]);

/** Each mapped name, and each alias, as a row of its own. */
const ROWS = TABLE.flatMap(([ds, theme, aliases]) => [
    { ds, theme, role: "the token" },
    ...(aliases ?? []).map((alias) => ({ ds, theme: alias, role: "an alias" })),
]);

describe("the theme follows the design system (app_design_system/tokens)", () => {
    test("the design system's token files hold both blocks", () => {
        // The guard reads something: the files have their tokens and their dark overrides.
        expect(DS.light.size).toBeGreaterThan(100);
        expect(DS.dark.size).toBeGreaterThan(20);
    });

    test("the table maps every token the design system declares", () => {
        const mapped = new Set(TABLE.map(([ds]) => ds));
        const unmapped = [...new Set([...DS.light.keys(), ...DS.dark.keys()])]
            .filter((name) => !mapped.has(name) && !NOT_THEMED.has(name));
        expect(unmapped, "design-system tokens the theme does not map").toEqual([]);
    });

    test("the table maps only tokens the design system declares", () => {
        const gone = TABLE.map(([ds]) => ds).filter((ds) => !DS.light.has(ds) && !DS.dark.has(ds));
        expect(gone, "mapped tokens the design system no longer declares").toEqual([]);
    });

    test.each(ROWS)("$ds is $theme ($role) in both themes", ({ ds, theme }) => {
        for (const mode of MODES) {
            const want = comparable(ds, dsValue(ds, mode));
            const got = comparable(ds, themeValue(theme, mode));
            expect(got, `${ds} in ${mode}: the theme's ${theme} drifted from the design system`).toBe(want);
        }
    });
});

// ─── Every token a theme module names exists ────────────────────────────────

/** The theme's own modules: every `.ts` under `theme/`, tests aside. */
function themeModules(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return themeModules(path);
        return /\.ts$/u.test(name) && !/\.test\.ts$/u.test(name) ? [path] : [];
    });
}

/** The properties whose bare value Chakra reads as a token, and the category it reads. */
const TOKEN_PROPS: Readonly<Record<string, string>> = {
    color: "colors", background: "colors", bg: "colors", backgroundColor: "colors", bgColor: "colors",
    borderColor: "colors", borderTopColor: "colors", borderBottomColor: "colors", borderLeftColor: "colors",
    borderRightColor: "colors", borderInlineStartColor: "colors", borderInlineEndColor: "colors",
    borderBlockStartColor: "colors", borderBlockEndColor: "colors", borderStartColor: "colors", borderEndColor: "colors",
    fill: "colors", stroke: "colors", outlineColor: "colors", accentColor: "colors", caretColor: "colors",
    textDecorationColor: "colors", boxShadowColor: "colors", ringColor: "colors", focusRingColor: "colors",
    fontSize: "fontSizes", fontWeight: "fontWeights", lineHeight: "lineHeights", letterSpacing: "letterSpacings",
    fontFamily: "fonts", borderRadius: "radii", rounded: "radii", boxShadow: "shadows", shadow: "shadows",
    transitionDuration: "durations", animationDuration: "durations",
    transitionTimingFunction: "easings", animationTimingFunction: "easings",
};

/** A bare value that names a token: a word, dotted on, never a number or a CSS function. */
const BARE_TOKEN = /^[a-zA-Z][\w-]*(?:\.[\w-]+)+(?:\/\d+)?$/u;

/** Whether a reference names a token the merged system has. */
function exists(path: string): boolean {
    // `colorPalette.*` are virtual tokens, one per palette role.
    if (path.startsWith("colors.colorPalette.")) return true;
    return themeToken(path.replace(/\/\d+$/u, "")) !== undefined;
}

/** Every token reference a value object holds, with where it sits. */
function references(value: unknown, where: string, out: string[]): void {
    if (typeof value === "string") return;
    if (value === null || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        const at = `${where}.${key}`;
        if (typeof v === "string") {
            for (const m of v.matchAll(/\{([^}]+)\}/gu)) {
                if (!exists(m[1]!.trim())) out.push(`${at}: {${m[1]}}`);
            }
            const category = TOKEN_PROPS[key];
            if (category !== undefined && BARE_TOKEN.test(v) && !exists(`${category}.${v}`)) out.push(`${at}: "${v}" is no ${category} token`);
            if (key === "textStyle" && v !== "none" && nodeAt(THEME.textStyles, v.split(".")) === undefined) out.push(`${at}: no text style "${v}"`);
            if (key === "layerStyle" && v !== "none" && nodeAt(THEME.layerStyles, v.split(".")) === undefined) out.push(`${at}: no layer style "${v}"`);
        } else {
            references(v, at, out);
        }
    }
}

describe("every token the theme names exists", () => {
    const THEME_DIR = fileURLToPath(new URL("./", import.meta.url));
    const modules = themeModules(THEME_DIR);

    test("its modules are all read", () => {
        // The tokens, the styles and every recipe — not a corner of the theme.
        expect(modules.length).toBeGreaterThan(90);
    });

    test("no reference resolves to nothing", async () => {
        const missing: string[] = [];
        for (const file of modules) {
            const mod = await import(pathToFileURL(file).href) as Record<string, unknown>;
            for (const [name, value] of Object.entries(mod)) {
                // The built system holds Chakra's own config as well as ours; the
                // theme's values are read from the modules that define them.
                if (value !== null && typeof value === "object" && "$$chakra" in value) continue;
                references(value, `${relative(THEME_DIR, file)}:${name}`, missing);
            }
        }
        expect(missing).toEqual([]);
    });
});
