/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Behaviour guard for the adaptive contract (#346):
 *   - `useContainerBelow` / `useContainerBreakpoint` re-derive from the
 *     observed element's width and fall back to desktop defaults when
 *     `ResizeObserver` is unavailable,
 *   - `useCoarsePointer` / `useHoverCapable` mirror `matchMedia` and fall
 *     back to fine-pointer defaults when it is unavailable.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useRef } from "react";
import {
    useContainerBreakpoint,
    useContainerBelow,
    useCoarsePointer,
    useHoverCapable,
    type ContainerBreakpoint,
} from "./adaptive.js";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** Install a ResizeObserver stub whose callback we drive by hand, plus a
 *  `getBoundingClientRect` width the hooks will measure. */
function stubResizeObserver(width: () => number): () => void {
    let callback: (() => void) | undefined;
    class RO {
        constructor(cb: () => void) { callback = cb; }
        observe() { /* noop */ }
        disconnect() { /* noop */ }
    }
    vi.stubGlobal("ResizeObserver", RO);
    // Return 0 so the hook's `frame` latch re-arms after the synchronous run
    // (the hook treats 0 as "no pending frame").
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { fn(); return 0; });
    vi.stubGlobal("cancelAnimationFrame", () => { /* noop */ });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() =>
        ({ width: width(), height: 100, top: 0, left: 0, right: width(), bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect));
    return () => { if (callback) callback(); };
}

function BreakpointProbe({ report }: { report: (bp: ContainerBreakpoint) => void }) {
    const ref = useRef<HTMLDivElement | null>(null);
    report(useContainerBreakpoint(ref));
    return <div ref={ref} />;
}

function BelowProbe({ px, report }: { px: number; report: (below: boolean) => void }) {
    const ref = useRef<HTMLDivElement | null>(null);
    report(useContainerBelow(ref, px));
    return <div ref={ref} />;
}

describe("useContainerBreakpoint", () => {
    test("classifies the measured width and tracks resizes", () => {
        let w = 360;
        const fire = stubResizeObserver(() => w);
        let seen: ContainerBreakpoint = "regular";
        render(<BreakpointProbe report={(bp) => { seen = bp; }} />);
        expect(seen).toBe("compact");

        w = 700;
        act(() => fire());
        expect(seen).toBe("regular");

        w = 1200;
        act(() => fire());
        expect(seen).toBe("wide");
    });

    test("defaults to regular without ResizeObserver", () => {
        vi.stubGlobal("ResizeObserver", undefined);
        let seen: ContainerBreakpoint = "compact";
        render(<BreakpointProbe report={(bp) => { seen = bp; }} />);
        expect(seen).toBe("regular");
    });
});

describe("useContainerBelow", () => {
    test("true strictly below the threshold, false at/above it", () => {
        let w = 559;
        const fire = stubResizeObserver(() => w);
        let seen = false;
        render(<BelowProbe px={560} report={(b) => { seen = b; }} />);
        expect(seen).toBe(true);

        w = 560;
        act(() => fire());
        expect(seen).toBe(false);
    });

    test("defaults to false without ResizeObserver", () => {
        vi.stubGlobal("ResizeObserver", undefined);
        let seen = true;
        render(<BelowProbe px={560} report={(b) => { seen = b; }} />);
        expect(seen).toBe(false);
    });
});

function PointerProbe({ report }: { report: (v: { coarse: boolean; hover: boolean }) => void }) {
    report({ coarse: useCoarsePointer(), hover: useHoverCapable() });
    return null;
}

describe("pointer capability hooks", () => {
    test("read matchMedia when available", () => {
        const mql = (matches: boolean) => ({
            matches,
            addEventListener: () => { /* noop */ },
            removeEventListener: () => { /* noop */ },
        });
        vi.stubGlobal("matchMedia", (q: string) => mql(q.includes("coarse")));
        let seen = { coarse: false, hover: true };
        render(<PointerProbe report={(v) => { seen = v; }} />);
        expect(seen.coarse).toBe(true);
        expect(seen.hover).toBe(false);
    });

    test("fall back to fine-pointer defaults without matchMedia", () => {
        vi.stubGlobal("matchMedia", undefined);
        let seen = { coarse: true, hover: false };
        render(<PointerProbe report={(v) => { seen = v; }} />);
        expect(seen.coarse).toBe(false);
        expect(seen.hover).toBe(true);
    });
});
