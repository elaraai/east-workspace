/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Sheet's lint guard (#859): a spread into a call or a constructor under
 * `collections/sheet/` fails lint, as under `collections/plan/` (#810) — past
 * the engine's argument limit (~125,000 on Node 22) it throws RangeError. A
 * spread into an array literal has no such limit and passes.
 */

import { test, expect } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The spread guard's messages for a snippet linted as if it sat at `path`. */
async function spreadsAt(path: string, code: string): Promise<string[]> {
    const eslint = new ESLint({
        cwd: packageRoot,
        // The snippet is no file of the TS project: lint it without type information.
        overrideConfig: [{ files: ["src/**/*.ts"], languageOptions: { parserOptions: { project: false } } }],
    });
    const [result] = await eslint.lintText(code, { filePath: `${packageRoot}${path}` });
    return result!.messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

const CODE = [
    "export function f(xs: number[]): number[] {",
    "    const out: number[] = [];",
    "    out.push(...xs);",
    "    void new Set(...[xs]);",
    "    return [...xs, Math.max(0, ...xs)];",
    "}",
    "",
].join("\n");

test("a spread into a call or a constructor under collections/sheet/ fails lint; into an array literal it passes", async () => {
    const sheet = await spreadsAt("src/collections/sheet/probe-spread.ts", CODE);
    // out.push(...xs), new Set(...[xs]) and Math.max(0, ...xs) — not [...xs].
    expect(sheet).toHaveLength(3);
    expect(sheet.every((m) => m.includes("collections/sheet/") && m.includes("#859"))).toBe(true);
    // A folder with no guard of its own is untouched by it.
    expect(await spreadsAt("src/collections/table/probe-spread.ts", CODE)).toEqual([]);
}, 60_000);
