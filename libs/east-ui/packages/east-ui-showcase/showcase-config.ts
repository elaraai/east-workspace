/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Showcase configuration. No hardcoded category lists, no hardcoded
 * pathKey lists — everything is derived from `../east-ui/test/<cat>/*.examples.ts`
 * at build time. Entries flow full-width in document order and size to
 * their content, so this file holds only the section names, the e3 repository
 * and workspaces the e3 examples run in and the name each area's workspace
 * bundle is served under, and the pathKey → category mapping.
 *
 * Add a new example: drop `test/<category>/<component>.examples.ts`. Done.
 *
 * @packageDocumentation
 */

/** Sidebar section labels. East / e3 Components = renderable `.tsx`
 *  examples (e3 ones run against the e3 the page runs, `showcase-e3.ts`);
 *  Code Reference = static `.ts` examples shown as code blocks. */
export const SECTION_EAST = "East Components";
export const SECTION_E3 = "e3 Components";
export const SECTION_CODE = "Code Reference";

/** The repository of the e3 the page runs, which every area's workspace is
 *  made in (`showcase-e3.ts`), and of the e3 the build makes them in. */
export const SHOWCASE_REPO = "default";

/**
 * The workspace an area's examples bind (#1397): an area is the e3 examples of
 * one category, one directory of e3-ui's `test/`.
 *
 * @param area - The area
 * @returns The area's own name
 */
export function showcaseE3Workspace(area: string): string {
    return area;
}

/**
 * The name an area's workspace bundle is served under (#849, #1397): the
 * area's workspace as the build made it — its package deployed and its
 * dataflow run — written out in one stream of beast2, which the e3 the page
 * runs makes the area's workspace from (`showcase-e3.ts`). The dev server
 * answers `/<name>`, and the build emits it as an asset of this name and its
 * content's hash (`assets/e3-showcase-<area>-<hash>.beast2`), whose URL the
 * page's code carries; `scripts/vite-plugin-e3-showcase.ts` makes it.
 *
 * @param area - The area, e.g. `schematic`
 * @returns The bundle's name, e.g. `e3-showcase-schematic.beast2`
 */
export function e3ShowcaseBundle(area: string): string {
    return `e3-showcase-${area}.beast2`;
}

/**
 * The area whose workspace a bundle's name names: what
 * {@link e3ShowcaseBundle} names it, read back.
 *
 * @param name - The bundle's name, e.g. `e3-showcase-schematic.beast2`
 * @returns Its area, e.g. `schematic`, or `undefined` for any other name
 */
export function e3ShowcaseBundleArea(name: string): string | undefined {
    return /^e3-showcase-([^/]+)\.beast2$/.exec(name)?.[1];
}

/** Title-case the first path segment of a pathKey to use as a category name.
 *  `"buttons/button"` → `"Buttons"`. */
export function categoryFor(pathKey: string): string {
    const slug = pathKey.split("/", 1)[0];
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}
