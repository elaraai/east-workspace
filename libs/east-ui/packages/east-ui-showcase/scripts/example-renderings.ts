/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * The Code Reference examples' renderings in other languages come from the
 * Claude plugin's example index (`libs/east-claude-plugin/index.json`, #654):
 * every program example there is stored as its IR with the TypeScript and the
 * python printed from it, keyed by `<package>:<file>.examples.ts:<export>`.
 * The showcase keeps the authored TypeScript (comments included) for its
 * TypeScript view and takes the python from the index — one generator, two
 * consumers, and the showcase never needs east-py (#655).
 *
 * Node-side only (read at build time by `vite-plugin-example-sources`).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** What the showcase reads of one index entry. */
export interface IndexRendering {
    /** `["typescript", "python"]` for a program, `["tsx"]` for a JSX example, `["typescript"]` for a hand-written stub. */
    languages: string[];
    /** The python printed from the example's IR, or null when the index was built without it. */
    python: string | null;
}

interface IndexEntry {
    id: string;
    languages?: string[];
    python?: string | null;
}

/** The plugin index's path, from the showcase package root. */
export function defaultIndexPath(rootDir: string): string {
    return path.resolve(rootDir, "../../../east-claude-plugin/index.json");
}

/** The index id of a Code Reference example — the plugin's `generate-index` id:
 *  the package label, the example file's basename, the export name. `file` is
 *  the showcase's path within the package's test dir, without extension. */
export function indexIdFor(pkg: string, file: string, name: string): string {
    return `${pkg}:${path.posix.basename(file)}.examples.ts:${name}`;
}

/** Every rendering in the index, by id. */
export async function loadIndexRenderings(indexPath: string): Promise<Map<string, IndexRendering>> {
    const raw = await fs.readFile(indexPath, "utf8");
    const data = JSON.parse(raw) as { entries: IndexEntry[] };
    const out = new Map<string, IndexRendering>();
    for (const e of data.entries) {
        out.set(e.id, { languages: e.languages ?? ["typescript"], python: e.python ?? null });
    }
    return out;
}

/** The error a stale index raises: every Code Reference example must be in it. */
export function missingRenderingsError(missing: string[], indexPath: string): Error {
    const shown = missing.slice(0, 8).map((id) => `  - ${id}`).join("\n");
    const more = missing.length > 8 ? `\n  … and ${missing.length - 8} more` : "";
    return new Error(
        `${missing.length} Code Reference example(s) have no entry in the plugin's example index (${indexPath}):\n` +
        `${shown}${more}\n` +
        `The index is stale — regenerate it: cd libs/east-claude-plugin && make index`,
    );
}
