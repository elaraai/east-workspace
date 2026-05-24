/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Builds the showcase catalog by auto-discovering every `*.examples.ts`
 * under `../east-ui/test/`. Vite's `import.meta.glob` resolves the pattern
 * at build time, eagerly importing each matched module.
 *
 * The pathKey is derived from the file path; the category is the first
 * path segment (title-cased) — both come straight from the filesystem,
 * so adding a new example file means dropping it in the right folder
 * and the showcase picks it up automatically.
 *
 * Top-level files (no slash in pathKey, e.g. `style.examples.ts`) are
 * skipped — they have no category to file under.
 *
 * @packageDocumentation
 */

import type { ExampleDef } from "@elaraai/east";
import { exampleSources } from "virtual:example-sources";
import { categoryFor, layoutFor, type ShowcaseLayout } from "./showcase-config";

export interface CatalogEntry extends ExampleDef, ShowcaseLayout {
    name: string;
    category: string;
    pathKey: string;
    /** Captured authored source of `fn` — raw TypeScript + highlight.js pre-highlighted HTML. */
    source?: { raw: string; html: string };
}

const exampleModules = import.meta.glob<Record<string, ExampleDef | undefined>>(
    "../east-ui/test/**/*.examples.ts",
    { eager: true },
);

function buildCatalog(): CatalogEntry[] {
    const entries: CatalogEntry[] = [];
    for (const [filePath, mod] of Object.entries(exampleModules)) {
        const pathKey = filePath
            .replace(/^.*\/east-ui\/test\//, "")
            .replace(/\.examples\.ts$/, "");
        if (!pathKey.includes("/")) continue;

        const category = categoryFor(pathKey);
        const layout = layoutFor(pathKey);
        for (const [name, ex] of Object.entries(mod)) {
            if (!ex?.fn) continue;
            entries.push({
                ...ex,
                ...layout,
                name,
                category,
                pathKey,
                source: exampleSources[pathKey]?.[name],
            });
        }
    }
    return entries;
}

export const catalog: readonly CatalogEntry[] = buildCatalog();
export const categories: readonly string[] = [...new Set(catalog.map(e => e.category))].sort();
