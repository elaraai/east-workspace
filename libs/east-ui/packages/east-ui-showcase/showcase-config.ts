/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Showcase configuration. No hardcoded category lists, no hardcoded
 * pathKey lists — everything is derived from `../east-ui/test/<cat>/*.examples.ts`
 * at build time. This file holds only the small bits that *can't* be inferred
 * from the filesystem: a default layout and optional per-component overrides.
 *
 * Add a new example: drop `test/<category>/<component>.examples.ts`. Done.
 *
 * @packageDocumentation
 */

/** Grid layout for one example card. `columns` = preferred column count
 *  (1 wide, 2 half, 3 third); `bodyHeight` = pixels for the card body. */
export interface ShowcaseLayout {
    columns: 1 | 2 | 3;
    bodyHeight: number;
}

export const DEFAULT_LAYOUT: ShowcaseLayout = { columns: 2, bodyHeight: 280 };

/** Default layout for a Code Reference card. Taller than a component card so
 *  a typical `fn` body shows without scrolling; the `returns` strip sits at
 *  the foot of the same fixed body. */
export const CODE_LAYOUT: ShowcaseLayout = { columns: 2, bodyHeight: 360 };

/** Sidebar section labels. Components = renderable `.tsx` examples;
 *  Code Reference = static `.ts` examples shown as code blocks. */
export const SECTION_COMPONENTS = "Components";
export const SECTION_CODE = "Code Reference";

/** Optional per-pathKey layout overrides. Anything not listed uses
 *  `DEFAULT_LAYOUT`. Add entries only for cards that genuinely need
 *  more / less room than the default (charts, tables, dashboards). */
const LAYOUT_OVERRIDES: Readonly<Record<string, Partial<ShowcaseLayout>>> = {
    "integration/sales-dashboard": { columns: 1, bodyHeight: 680 },
};

export function layoutFor(pathKey: string): ShowcaseLayout {
    return { ...DEFAULT_LAYOUT, ...(LAYOUT_OVERRIDES[pathKey] ?? {}) };
}

/** Layout for a Code Reference card. Same override map applies (keyed by the
 *  `package/path` pathKey) so an unusually long example can earn more room. */
export function codeLayoutFor(pathKey: string): ShowcaseLayout {
    return { ...CODE_LAYOUT, ...(LAYOUT_OVERRIDES[pathKey] ?? {}) };
}

/** Title-case the first path segment of a pathKey to use as a category name.
 *  `"buttons/button"` → `"Buttons"`. */
export function categoryFor(pathKey: string): string {
    const slug = pathKey.split("/", 1)[0];
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}
