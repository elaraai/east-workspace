/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan paints with the design system's semantic tokens only (#949,
 * `app_design_system/guidelines/component-rules.md` §1). A raw palette step
 * (`brand.600`, `gray.400`) or a hex colour ignores the theme: it reads the
 * same in dark mode, and it drifts from the roles every other surface paints
 * with. This reads the Plan's renderer and recipes — and the shared brush
 * strip and chip it draws with — and fails on either, outside comments.
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The package's `src/`. */
const SRC = fileURLToPath(new URL("../../", import.meta.url));

/** Every source file under `dir`, tests and test helpers excepted. */
function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.tsx?$/u.test(name) && !/\.(test|spec)\.|test-utils/u.test(name) ? [path] : [];
    });
}

const FILES = [
    ...sources(join(SRC, "collections/plan")),
    ...sources(join(SRC, "theme/slot-recipes/plan")),
    join(SRC, "theme/slot-recipes/brushStrip.ts"),
    join(SRC, "theme/recipes/chip.ts"),
];

/** The source with its comments blanked — line numbers kept. */
function code(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//gu, (c) => c.replace(/[^\n]/gu, " "))
        .replace(/\/\/[^\n]*/gu, "");
}

/** A palette step — a colour scale's number rather than a role — as a token
 *  (`brand.600`) or as the CSS variable Chakra writes for it
 *  (`--chakra-colors-brand-600`). */
const PALETTE = /(?:\b|--chakra-colors-)(?:brand|gray|grey|teal|purple|blue|orange|red|green|yellow|pink|cyan)[.-](?:50|[1-9]00|950)\b/gu;
/** A hex colour, where CSS would read one — after a quote, a space or a comma. */
const HEX = /(?<=["'`\s,])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/gu;

describe("the Plan paints with semantic tokens only (#949)", () => {
    test("no raw palette step and no hex colour in its recipes or renderer", () => {
        const found: string[] = [];
        for (const file of FILES) {
            code(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
                for (const m of line.matchAll(PALETTE)) found.push(`${relative(SRC, file)}:${i + 1}: ${m[0]}`);
                for (const m of line.matchAll(HEX)) found.push(`${relative(SRC, file)}:${i + 1}: ${m[0]}`);
            });
        }
        // The check reads the whole Plan, not a corner of it.
        expect(FILES.length).toBeGreaterThan(40);
        expect(found).toEqual([]);
    });

    test("the check itself sees a palette step, a hex colour, and nothing in a comment", () => {
        const probe = code([
            `const a = { color: "{colors.brand.600}" };`,
            `const b = { background: "#1f2a30" };`,
            `const c = { border: "1px solid #fff" };`,
            `const e = "color-mix(in srgb, var(--chakra-colors-gray-400) 40%, transparent)";`,
            `// brand.600 and #1f2a30 in a comment are prose (#949)`,
            `const d = { color: "brand.solid", fill: "brandHeat.3", stroke: "var(--chakra-colors-brand-solid)" };`,
        ].join("\n"));
        expect([...probe.matchAll(PALETTE)].map((m) => m[0])).toEqual(["brand.600", "--chakra-colors-gray-400"]);
        expect([...probe.matchAll(HEX)].map((m) => m[0])).toEqual(["#1f2a30", "#fff"]);
    });
});
