/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Builds the showcase catalog from two sources, split by the example file's
 * extension:
 *
 * - **Components** (`*.examples.tsx`) — east-ui examples that return
 *   renderable UI. Eagerly imported via `import.meta.glob` and rendered live;
 *   the `code` toggle shows the captured source.
 * - **Code Reference** (`*.examples.ts`) — examples from the non-UI packages
 *   (`scripts/example-roots.ts`: east, east-node-*, east-py-datascience).
 *   These pull in Node / Python runtimes and can't run in the browser, so
 *   they are read *statically* from `virtual:example-sources` and shown as
 *   highlighted code blocks plus their declared `returns` value.
 *
 * For Components the category is the first path segment (title-cased); for
 * Code Reference it's the source package. Both come straight from the
 * filesystem — dropping a new example file in the right place is all it takes.
 *
 * @packageDocumentation
 */

import type { ExampleDef } from "@elaraai/east";
import { codeExamples, exampleSources, exampleDependencies, type CapturedSource } from "virtual:example-sources";
import { SECTION_CODE, SECTION_E3, SECTION_EAST, categoryFor } from "./showcase-config";

interface CatalogBase {
    name: string;
    section: string;
    category: string;
    pathKey: string;
    description: string;
    keywords: string[];
}

/** A renderable UI example — live East IR plus its captured source. */
export interface LiveEntry extends CatalogBase {
    tier: "live";
    fn: ExampleDef["fn"];
    source?: CapturedSource;
    /** The example file's module-scope dependencies (e3.input / record /
     *  mutation defs the bodies reference), shared by every example in the
     *  file. Absent for files that inline everything. */
    dependencies?: CapturedSource;
}

/** A non-UI example shown as source code plus its declared `returns`. */
export interface CodeEntry extends CatalogBase {
    tier: "code";
    /** Source text of the `returns` value. */
    returns: string;
    source: CapturedSource;
}

export type CatalogEntry = LiveEntry | CodeEntry;

const componentModules = import.meta.glob<Record<string, ExampleDef | undefined>>(
    "../east-ui/test/**/*.examples.tsx",
    { eager: true },
);

function buildComponents(): LiveEntry[] {
    const entries: LiveEntry[] = [];
    for (const [filePath, mod] of Object.entries(componentModules)) {
        const pathKey = filePath
            .replace(/^.*\/east-ui\/test\//, "")
            .replace(/\.examples\.tsx?$/, "");
        if (!pathKey.includes("/")) continue;

        const category = categoryFor(pathKey);
        for (const [name, ex] of Object.entries(mod)) {
            if (!ex?.fn) continue;
            entries.push({
                tier: "live",
                name,
                section: SECTION_EAST,
                category,
                pathKey,
                description: ex.description,
                keywords: ex.keywords,
                fn: ex.fn,
                source: exampleSources[pathKey]?.[name],
                dependencies: exampleDependencies[pathKey],
            });
        }
    }
    return entries;
}

/* e3-ui examples export `ExampleDef`s alongside the `e3.input` dataset
 * definitions their `Data.bind` calls read — so the modules are typed
 * `unknown` and filtered per-export. */
const e3Modules = import.meta.glob<Record<string, unknown>>(
    "../e3-ui/test/**/*.examples.tsx",
    { eager: true },
);

/** Raw e3 example modules — `main.tsx` seeds the in-memory reactive-dataset
 *  cache from their exported `e3.input` defaults before first render. */
export const e3ExampleModules: ReadonlyArray<Record<string, unknown>> = Object.values(e3Modules);

function isExampleDef(x: unknown): x is ExampleDef {
    return typeof x === "object" && x !== null
        && "fn" in x && "description" in x && "keywords" in x;
}

function buildE3Components(): LiveEntry[] {
    const entries: LiveEntry[] = [];
    for (const [filePath, mod] of Object.entries(e3Modules)) {
        const rel = filePath
            .replace(/^.*\/e3-ui\/test\//, "")
            .replace(/\.examples\.tsx?$/, "");
        // e3-ui's test dir mirrors east-ui's `<group>/<component>` layout;
        // the group directory is the category and the `e3/` prefix keeps
        // pathKeys collision-free against east-ui's keys.
        const pathKey = `e3/${rel}`;
        const group = rel.split("/")[0] ?? rel;
        const category = group.charAt(0).toUpperCase() + group.slice(1);
        for (const [name, ex] of Object.entries(mod)) {
            if (!isExampleDef(ex)) continue;
            entries.push({
                tier: "live",
                name,
                section: SECTION_E3,
                category,
                pathKey,
                description: ex.description,
                keywords: ex.keywords,
                fn: ex.fn,
                source: exampleSources[pathKey]?.[name],
                dependencies: exampleDependencies[pathKey],
            });
        }
    }
    return entries;
}

function buildCodeReference(): CodeEntry[] {
    return codeExamples.map(ex => ({
        tier: "code",
        name: ex.name,
        section: SECTION_CODE,
        category: ex.package,
        pathKey: ex.pathKey,
        description: ex.description,
        keywords: ex.keywords,
        returns: ex.returns,
        source: ex.source,
    }));
}

export const catalog: readonly CatalogEntry[] = [
    ...buildComponents(),
    ...buildE3Components(),
    ...buildCodeReference(),
];

/** One sidebar group: a section header and the categories filed under it,
 *  in catalog order (East Components, e3 Components, then Code Reference). */
export interface NavSection {
    section: string;
    categories: string[];
}

function buildNav(): NavSection[] {
    const order = [SECTION_EAST, SECTION_E3, SECTION_CODE];
    return order
        .map(section => ({
            section,
            categories: [
                ...new Set(catalog.filter(e => e.section === section).map(e => e.category)),
            ].sort(),
        }))
        .filter(s => s.categories.length > 0);
}

export const navSections: readonly NavSection[] = buildNav();
