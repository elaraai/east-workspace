/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A theme token as the page resolves it, for the specs that measure a
 * builder's colours against the design system's: the Allocation's, the
 * Schematic's and the Record's.
 */

import type { Page } from "playwright/test";

/**
 * A theme colour token as the page resolves it, as a computed colour.
 *
 * @param page - The page
 * @param name - The token's CSS variable name, after `--chakra-colors-` (`fg-muted`)
 * @returns Its computed colour
 */
export function token(page: Page, name: string): Promise<string> {
    return page.evaluate((n) => {
        const probe = document.createElement("span");
        probe.style.color = `var(--chakra-colors-${n})`;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
    }, name);
}

/**
 * A value as the page computes it: a token's variable, or what a recipe makes
 * of several — a wash mixed from two colours, a shadow.
 *
 * @param page - The page
 * @param property - The property it is given, as a style object names it (`backgroundColor`)
 * @param value - The value a recipe gives it (`var(--chakra-shadows-focus-inset)`)
 * @returns Its computed value
 */
export function computed(page: Page, property: "backgroundColor" | "boxShadow" | "fontFamily" | "fontSize", value: string): Promise<string> {
    return page.evaluate(([p, v]) => {
        const probe = document.createElement("span");
        probe.style[p] = v;
        document.body.appendChild(probe);
        const out = getComputedStyle(probe)[p];
        probe.remove();
        return out;
    }, [property, value] as const);
}
