/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Behaviour guard for Splitter `collapseBelow` (#350):
 *   - below the authored container width the panels render as a stacked
 *     column (no resize triggers),
 *   - at/above it the Zag splitter renders as before,
 *   - without `collapseBelow` narrow containers keep the split (no change
 *     for existing IR).
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { Splitter, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
});

/** Drive-by-hand ResizeObserver + measured width stub (adaptive contract). */
function stubContainerWidth(width: () => number): () => void {
    let callback: (() => void) | undefined;
    class RO {
        constructor(cb: () => void) { callback = cb; }
        observe() { /* noop */ }
        disconnect() { /* noop */ }
    }
    vi.stubGlobal("ResizeObserver", RO);
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { fn(); return 0; });
    vi.stubGlobal("cancelAnimationFrame", () => { /* noop */ });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() =>
        ({ width: width(), height: 300, top: 0, left: 0, right: width(), bottom: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect));
    return () => { if (callback) callback(); };
}

function buildSplitter(collapseBelow?: number): ValueTypeOf<typeof UIComponentType> {
    const program = East.function([], UIComponentType, (_$) =>
        Splitter.Root({
            panels: [
                Splitter.Panel(Text.Root("LEFT"), { id: "left" }),
                Splitter.Panel(Text.Root("RIGHT"), { id: "right" }),
            ],
            defaultSize: [50, 50],
            orientation: "horizontal",
            ...(collapseBelow !== undefined ? { collapseBelow } : {}),
        }),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

describe("Splitter collapseBelow (#350)", () => {
    test("stacks below the threshold and restores above it", () => {
        let w = 360;
        const fire = stubContainerWidth(() => w);
        render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={buildSplitter(480)} storageKey="sp" />
            </ChakraProvider>,
        );
        expect(document.querySelector("[data-splitter-stacked]")).not.toBeNull();
        expect(document.querySelector('[data-part="resize-trigger"]')).toBeNull();
        expect(document.body.textContent).toContain("LEFT");
        expect(document.body.textContent).toContain("RIGHT");

        w = 800;
        act(() => fire());
        expect(document.querySelector("[data-splitter-stacked]")).toBeNull();
        expect(document.querySelector('[data-part="resize-trigger"]')).not.toBeNull();
    });

    test("no collapseBelow keeps the split at any width", () => {
        stubContainerWidth(() => 320);
        render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={buildSplitter()} storageKey="sp2" />
            </ChakraProvider>,
        );
        expect(document.querySelector("[data-splitter-stacked]")).toBeNull();
        expect(document.querySelector('[data-part="resize-trigger"]')).not.toBeNull();
    });
});
