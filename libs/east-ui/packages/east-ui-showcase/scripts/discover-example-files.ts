/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Node-side discovery of `*.examples.ts` files under a test root, used by
 * both the Vite source-extraction plugin and the headless snapshot script.
 *
 * Mirrors the Vite-side discovery in `../catalog.ts` (which uses
 * `import.meta.glob` and can't run in Node). The key derivation rule —
 * `relative/path/to/file.examples.ts` → pathKey `relative/path/to/file` —
 * matches catalog.ts exactly, so both sides see the same set of pathKeys.
 *
 * Top-level files with no category directory (e.g. `style.examples.ts`)
 * are skipped — they have no category to file under, same as catalog.ts.
 */

import fg from "fast-glob";
import * as path from "node:path";
import { categoryFor } from "../showcase-config";

export interface DiscoveredExample {
    /** Absolute filesystem path to the `.examples.ts` file. */
    filePath: string;
    /** Path relative to the test root, with `.examples.ts` stripped.
     *  e.g. `buttons/button`. */
    pathKey: string;
    /** First path segment of `pathKey`, title-cased. e.g. `Buttons`. */
    category: string;
}

export interface DiscoverOptions {
    /** Absolute path to the test root — the directory containing
     *  `<category>/<component>.examples.ts` files. */
    testDir: string;
    /** Include top-level files whose pathKey has no `/` (no category
     *  directory). Off by default so the east-ui showcase still skips
     *  category-less files like `style.examples.tsx`. Code-reference roots
     *  keep their examples flat (`array.examples.ts`) and rely on the
     *  package as the category, so they pass `true`. */
    includeTopLevel?: boolean;
}

export async function discoverExampleFiles(opts: DiscoverOptions): Promise<DiscoveredExample[]> {
    const matches = await fg("**/*.examples.{ts,tsx}", { cwd: opts.testDir, absolute: true });
    const out: DiscoveredExample[] = [];
    for (const filePath of matches) {
        const rel = path.relative(opts.testDir, filePath).replace(/\\/g, "/");
        const pathKey = rel.replace(/\.examples\.tsx?$/, "");
        if (!pathKey.includes("/") && !opts.includeTopLevel) continue;
        out.push({ filePath, pathKey, category: categoryFor(pathKey) });
    }
    out.sort((a, b) => a.pathKey.localeCompare(b.pathKey));
    return out;
}
