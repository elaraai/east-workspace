/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Hover parity on hover-incapable devices (#347):
 *   - Tooltip opens on long-press (500ms hold) and closes on release —
 *     rendered through the ToggleTip chassis (controlled Popover), since
 *     Zag's tooltip machine is hover/focus-only,
 *   - HoverCard toggles open on trigger tap.
 * `matchMedia` is stubbed to report a coarse, hover-incapable pointer.
 * Ark keeps closed overlay content mounted (hidden), so visibility is
 * asserted via `hidden`/`data-state`, not presence in the DOM.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { Tooltip, HoverCard, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../platform/registry.js";
import { system } from "../theme/index.js";
import { EastChakraComponent } from "../component.js";

// Zag's popper autoUpdate reaches for ResizeObserver once an overlay opens;
// jsdom lacks it (same stub as chart.dom.test.tsx).
class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
(globalThis as never as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

/** matchMedia stub: coarse pointer, no hover. */
function stubTouchDevice() {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => { /* noop */ },
        removeEventListener: () => { /* noop */ },
        addListener: () => { /* noop */ },
        removeListener: () => { /* noop */ },
        onchange: null,
        dispatchEvent: () => false,
    }));
}

/** A compiled Tooltip("TIP-BODY") around a Text trigger. */
function buildTooltip(): ValueTypeOf<typeof UIComponentType> {
    const program = East.function([], UIComponentType, (_$) =>
        Tooltip.Root("TIP-BODY", { trigger: Text.Root("PRESS-ME") }),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

/** A compiled HoverCard around a Text trigger. */
function buildHoverCard(): ValueTypeOf<typeof UIComponentType> {
    const program = East.function([], UIComponentType, (_$) =>
        HoverCard.Root([Text.Root("CARD-BODY")], { trigger: Text.Root("TAP-ME") }),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

/** Ark content visibility: mounted, not hidden, and in the open state. */
function isVisible(el: Element | null): boolean {
    if (el === null) return false;
    const html = el as HTMLElement;
    return !html.hidden && html.getAttribute("data-state") === "open";
}

describe("Tooltip long-press (hover-incapable)", () => {
    test("opens after a 500ms touch hold and closes on release", async () => {
        stubTouchDevice();
        vi.useFakeTimers();
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={buildTooltip()} storageKey="t" />
            </ChakraProvider>,
        );
        const trigger = container.querySelector("span") as HTMLElement;
        expect(trigger).toBeTruthy();
        const content = () => document.querySelector('[data-scope="popover"][data-part="content"]');

        fireEvent.pointerDown(trigger, { pointerType: "touch" });
        expect(isVisible(content())).toBe(false);

        // Ark syncs a controlled `open` asynchronously — flush with async
        // timer advancement.
        await act(async () => { await vi.advanceTimersByTimeAsync(600); });
        expect(isVisible(content())).toBe(true);
        expect(document.body.textContent).toContain("TIP-BODY");

        fireEvent.pointerUp(trigger, { pointerType: "touch" });
        await act(async () => { await vi.advanceTimersByTimeAsync(50); });
        expect(isVisible(content())).toBe(false);
    });

    test("a quick tap does not open the tooltip", async () => {
        stubTouchDevice();
        vi.useFakeTimers();
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={buildTooltip()} storageKey="t" />
            </ChakraProvider>,
        );
        const trigger = container.querySelector("span") as HTMLElement;
        const content = () => document.querySelector('[data-scope="popover"][data-part="content"]');

        fireEvent.pointerDown(trigger, { pointerType: "touch" });
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });
        fireEvent.pointerUp(trigger, { pointerType: "touch" });
        await act(async () => { await vi.advanceTimersByTimeAsync(600); });
        expect(isVisible(content())).toBe(false);
    });
});

describe("HoverCard tap-to-toggle (hover-incapable)", () => {
    test("trigger tap opens, second tap closes", async () => {
        stubTouchDevice();
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={buildHoverCard()} storageKey="h" />
            </ChakraProvider>,
        );
        const trigger = container.querySelector("span") as HTMLElement;
        expect(trigger).toBeTruthy();
        const content = () => document.querySelector('[data-scope="hover-card"][data-part="content"]');
        expect(isVisible(content())).toBe(false);

        // Ark syncs a controlled `open` asynchronously — flush a tick.
        await act(async () => { fireEvent.click(trigger); await new Promise((r) => setTimeout(r, 20)); });
        expect(isVisible(content())).toBe(true);
        expect(document.body.textContent).toContain("CARD-BODY");

        await act(async () => { fireEvent.click(trigger); await new Promise((r) => setTimeout(r, 20)); });
        expect(isVisible(content())).toBe(false);
    });
});
