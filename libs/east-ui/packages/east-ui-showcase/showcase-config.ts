/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Showcase configuration. No hardcoded category lists, no hardcoded
 * pathKey lists — everything is derived from `../east-ui/test/<cat>/*.examples.ts`
 * at build time. Entries flow full-width in document order and size to
 * their content, so this file holds only the section / pseudo-category
 * names and the pathKey → category mapping.
 *
 * Add a new example: drop `test/<category>/<component>.examples.ts`. Done.
 *
 * @packageDocumentation
 */

/** Sidebar section labels. East / e3 Components = renderable `.tsx`
 *  examples (e3 ones run against the in-memory dataset cache seeded in
 *  `main.tsx`); Code Reference = static `.ts` examples shown as code
 *  blocks. */
export const SECTION_EAST = "East Components";
export const SECTION_E3 = "e3 Components";
export const SECTION_CODE = "Code Reference";

/** Pseudo-categories — the "All" page per section that concatenates every
 *  category into one document, keyed by section label. */
export const ALL_PAGES: Readonly<Record<string, string>> = {
    [SECTION_EAST]: "All east components",
    [SECTION_E3]: "All e3 components",
    [SECTION_CODE]: "All reference",
};

/** Title-case the first path segment of a pathKey to use as a category name.
 *  `"buttons/button"` → `"Buttons"`. */
export function categoryFor(pathKey: string): string {
    const slug = pathKey.split("/", 1)[0];
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}
