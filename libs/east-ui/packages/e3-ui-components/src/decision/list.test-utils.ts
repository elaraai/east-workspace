/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's list laid out, for a jsdom that lays nothing out
 * (#1454): its frame as tall as the test gives it, as a Sheet's is
 * ({@link boundFrame}), and each row the list mounts as tall as the list
 * estimates it ({@link ROW_PX}) — a section's head, a card closed or open, a
 * receipt, the routine band — so its rows stand apart, as a browser draws
 * them, and every card a frame that tall holds mounts. Nothing scrolls the
 * frame: a card opened stays where it stands.
 *
 * Test use only: the package build leaves `*.test-utils.ts` out.
 *
 * @packageDocumentation
 */

import { boundFrame } from "../sheet/frame.test-utils.js";
import { ROW_PX } from "./list.js";

/** How tall the list draws a mounted row, by what it holds; `undefined` for a row of none of the list's kinds. */
function rowPx(row: HTMLElement): number | undefined {
    const section = row.querySelector("[data-decision-section]");
    if (section !== null) return section.hasAttribute("data-first") ? ROW_PX.firstSection : ROW_PX.section;
    if (row.querySelector("[data-decision-receipt]") !== null) return ROW_PX.receipt;
    const card = row.querySelector("[data-decision-card]");
    if (card !== null) return card.hasAttribute("data-open") ? ROW_PX.openCard : ROW_PX.card;
    const band = row.querySelector("[data-decision-routine]");
    if (band !== null) return ROW_PX.routine + band.querySelectorAll("[data-decision-routine-case]").length * ROW_PX.routineRow;
    return undefined;
}

/**
 * Lays the queue's list out (see the module docs).
 *
 * @param height - The frame's height (px): tall enough for every row the test reads
 * @returns The restore
 */
export function layOutList(height: number): () => void {
    const restoreFrame = boundFrame(height);
    const measured = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const px = this instanceof HTMLElement && this.dataset["slot"] === "virtualRow" ? rowPx(this) : undefined;
        if (px === undefined) return measured.call(this);
        return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: px, width: 0, height: px, toJSON: () => ({}) } as DOMRect;
    };
    return () => {
        Element.prototype.getBoundingClientRect = measured;
        restoreFrame();
    };
}
