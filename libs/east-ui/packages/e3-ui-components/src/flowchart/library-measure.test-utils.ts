/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's library pane, measured for its DOM tests (#1501): each tab's
 * Library lists its cards through a virtualizer, which lays out only the rows
 * its viewport holds, and jsdom lays out nothing. `flowchartHarness` measures
 * nothing, so the canvas keeps the geometry its tests point at; these measures
 * give each Library what the e3 harness gives it when it measures — a viewport
 * 272 by 700 px, each row 62 px high — and leave every other element as jsdom
 * has it.
 *
 * @packageDocumentation
 */

import { beforeEach, vi } from "vitest";

/** A Library's viewport: its list's scrolling element. */
const VIEWPORT = "[data-library] [data-scrollable]";

/**
 * Measures each Library of the pane before each test, as the e3 harness does,
 * main and the canvas unmeasured. A test file calls it once at its top level,
 * after `flowchartHarness()`; the harness's `afterEach` restores every measure.
 */
export function measureLibrary(): void {
    beforeEach(() => {
        const realRect = Element.prototype.getBoundingClientRect;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            const viewport = this.matches(VIEWPORT);
            const row = this.hasAttribute("data-index") && this.closest("[data-library]") !== null;
            if (!viewport && !row) return realRect.call(this);
            const height = viewport ? 700 : 62;
            return { x: 0, y: 0, top: 0, left: 0, right: 272, bottom: height, width: 272, height, toJSON() {} };
        });
        // The virtualizer reads its viewport's offsets; jsdom's are 0 for every element.
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
            return this.matches(VIEWPORT) ? 700 : 0;
        });
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
            return this.matches(VIEWPORT) ? 272 : 0;
        });
    });
}
