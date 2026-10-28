/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A theme token as the page resolves it, for the specs that measure a
 * builder's colours against the design system's: the Allocation's and the
 * Schematic's.
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
