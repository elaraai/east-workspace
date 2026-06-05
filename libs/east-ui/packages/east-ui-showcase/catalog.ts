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
import { codeExamples, exampleSources, type CapturedSource } from "virtual:example-sources";
import {
    SECTION_CODE, SECTION_COMPONENTS, categoryFor, codeLayoutFor, layoutFor,
    type ShowcaseLayout,
} from "./showcase-config";

interface CatalogBase extends ShowcaseLayout {
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
        const layout = layoutFor(pathKey);
        for (const [name, ex] of Object.entries(mod)) {
            if (!ex?.fn) continue;
            entries.push({
                ...layout,
                tier: "live",
                name,
                section: SECTION_COMPONENTS,
                category,
                pathKey,
                description: ex.description,
                keywords: ex.keywords,
                fn: ex.fn,
                source: exampleSources[pathKey]?.[name],
            });
        }
    }
    return entries;
}

function buildCodeReference(): CodeEntry[] {
    return codeExamples.map(ex => ({
        ...codeLayoutFor(ex.pathKey),
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

export const catalog: readonly CatalogEntry[] = [...buildComponents(), ...buildCodeReference()];

/** One sidebar group: a section header and the categories filed under it,
 *  in catalog order (Components first, then Code Reference). */
export interface NavSection {
    section: string;
    categories: string[];
}

function buildNav(): NavSection[] {
    const order = [SECTION_COMPONENTS, SECTION_CODE];
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

/** Flat category list (Components then Code Reference) for default selection. */
export const categories: readonly string[] = navSections.flatMap(s => s.categories);
