/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Route manifest for the responsive sweep — derives every catalog pathKey
 * from the SAME sources `catalog.ts` globs (east-ui + e3-ui example files),
 * so new examples are covered automatically. `#<pathKey>` deep links resolve
 * to the owning category page and scroll the group into view (App.tsx
 * resolveHash), which mounts the virtualized rows for that file's examples.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EAST_UI_TEST = join(HERE, "..", "..", "..", "east-ui", "test");
const E3_UI_TEST = join(HERE, "..", "..", "..", "e3-ui", "test");

function walk(dir: string): string[] {
    let out: string[] = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out = out.concat(walk(p));
        else out.push(p);
    }
    return out;
}

function pathKeys(root: string, prefix: string): string[] {
    return walk(root)
        .filter((p) => /\.examples\.tsx?$/.test(p))
        .map((p) => relative(root, p).split(sep).join("/").replace(/\.examples\.tsx?$/, ""))
        // catalog.ts skips root-level files for east-ui (pathKey must nest).
        .filter((rel) => prefix !== "" || rel.includes("/"))
        .map((rel) => `${prefix}${rel}`)
        .sort();
}

/** Every catalog pathKey (east-ui `<group>/<component>` + e3-ui `e3/...`). */
export function catalogPathKeys(): string[] {
    return [...pathKeys(EAST_UI_TEST, ""), ...pathKeys(E3_UI_TEST, "e3/")];
}
