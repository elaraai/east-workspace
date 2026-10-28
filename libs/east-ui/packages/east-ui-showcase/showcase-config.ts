/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Showcase configuration. No hardcoded category lists, no hardcoded
 * pathKey lists — everything is derived from `../east-ui/test/<cat>/*.examples.ts`
 * at build time. Entries flow full-width in document order and size to
 * their content, so this file holds only the section names, the name each
 * area's e3 package is served under and the pathKey → category mapping.
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

/**
 * The name an area's e3 package is served under (#849, #1397) — an area is the
 * e3 examples of one category, one directory of e3-ui's `test/`: the dev
 * server answers `/<name>`, and the build emits it as an asset of this name
 * and its content's hash (`assets/e3-showcase-<area>-<hash>.zip`), whose URL
 * the bundle carries. The e3 the page runs deploys it into the area's
 * workspace (`showcase-e3.ts`); `scripts/vite-plugin-e3-showcase.ts` makes it.
 *
 * @param area - The area, e.g. `schematic`
 * @returns The zip's name, e.g. `e3-showcase-schematic.zip`
 */
export function e3ShowcaseZip(area: string): string {
    return `e3-showcase-${area}.zip`;
}

/**
 * The area whose e3 package a zip's name names: what {@link e3ShowcaseZip}
 * names it, read back.
 *
 * @param name - The zip's name, e.g. `e3-showcase-schematic.zip`
 * @returns Its area, e.g. `schematic`, or `undefined` for any other name
 */
export function e3ShowcaseZipArea(name: string): string | undefined {
    return /^e3-showcase-([^/]+)\.zip$/.exec(name)?.[1];
}

/** Title-case the first path segment of a pathKey to use as a category name.
 *  `"buttons/button"` → `"Buttons"`. */
export function categoryFor(pathKey: string): string {
    const slug = pathKey.split("/", 1)[0];
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}
