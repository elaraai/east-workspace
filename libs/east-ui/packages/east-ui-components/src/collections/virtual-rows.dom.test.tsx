/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * VirtualRows fixed-row mode (#533): a fixed-height collection opts out of
 * per-row measurement with `measureRows: false`, so rows sit at exact
 * multiples of the fixed height. Under browser zoom, measurement reports
 * device-snapped FRACTIONAL heights even for a fixed-height box, and the
 * drift between measured offsets and rendered boxes paints as stray
 * hairline rules and vertically clipped row text — these tests pin that
 * fractional measurements cannot leak into row offsets.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/index.js";
import { VirtualRows } from "./virtual-rows.js";

const ROW_H = 32;
/** What zoomed measurement reports for a nominally 32px row. */
const FRACTIONAL_ROW_H = 31.594;

const originalGetRect = Element.prototype.getBoundingClientRect;
const originalOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

beforeEach(() => {
    // Row wrappers measure fractional (the zoom scenario); the scroll
    // viewport is sized through offsetHeight (what the virtualizer reads),
    // which jsdom reports as zero — leaving the virtual range empty
    // without this.
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const height = this.hasAttribute("data-index") ? FRACTIONAL_ROW_H : 200;
        return {
            x: 0, y: 0, top: 0, left: 0, right: 240,
            width: 240, height, bottom: height,
            toJSON: () => ({}),
        } as DOMRect;
    };
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) { return this.hasAttribute("data-index") ? ROW_H : 200; },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get() { return 240; },
    });
});

afterEach(() => {
    cleanup();
    Element.prototype.getBoundingClientRect = originalGetRect;
    if (originalOffsetH !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetH);
    if (originalOffsetW !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetW);
});

describe("VirtualRows fixed-row geometry", () => {
    test("measureRows: false keeps rows at exact fixed-height multiples despite fractional measurements", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <VirtualRows
                    height="200px"
                    maxHeight={undefined}
                    count={20}
                    estimateSize={() => ROW_H}
                    measureRows={false}
                    overscan={6}
                    renderRow={(i) => <div>row {i}</div>}
                />
            </ChakraProvider>,
        );
        const wrappers = [...container.querySelectorAll<HTMLElement>("[data-index]")];
        expect(wrappers.length).toBeGreaterThan(1);
        let sawNonZero = false;
        for (const el of wrappers) {
            const match = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform);
            expect(match, `row ${el.dataset["index"]} has a translateY transform`).toBeTruthy();
            const cssPx = Number(match![1]);
            if (cssPx > 0) sawNonZero = true;
            expect(cssPx % ROW_H, `row ${el.dataset["index"]} sits at an exact ${ROW_H}px multiple`).toBe(0);
        }
        expect(sawNonZero, "at least one row sits below the first").toBe(true);
    });
});
