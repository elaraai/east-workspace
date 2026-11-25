/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A day picker's legend as the page lays it out (#1595), for the Roster's and
 * the Allocation's specs alike: each item's mark before its word — how far
 * before, and whether it stands at the middle of its word's line.
 */

import type { Locator } from "playwright/test";

/** One legend item as laid out: how far its mark ends before its word, in px, and whether the mark stands at the middle of the word's line. */
export interface LegendItemLaid {
    readonly gap: number;
    readonly centred: boolean;
}

/**
 * Each of a legend's items as the page lays it out.
 *
 * @param items - The legend's items, each a mark (`data-state`) then its word
 * @returns Each item's layout, in order
 */
export function legendLaid(items: Locator): Promise<LegendItemLaid[]> {
    return items.evaluateAll((els) => els.map((item): LegendItemLaid => {
        const mark = item.querySelector("[data-state]")!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents([...item.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!);
        const word = range.getBoundingClientRect();
        return { gap: Math.round((word.left - mark.right) * 100) / 100, centred: Math.abs((mark.top + mark.bottom) / 2 - (word.top + word.bottom) / 2) <= 1 };
    }));
}
