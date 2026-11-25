/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Behaviour guard for the adaptive contract (#346):
 *   - `useContainerBelow` / `useContainerBreakpoint` / `useContainerColumns`
 *     re-derive from the observed element's width — a crossing committed
 *     inside the observer's own delivery, before the frame at the new width
 *     paints (#1259) — and fall back to desktop defaults when `ResizeObserver`
 *     is unavailable,
 *   - the element observed is the one the ref holds after each commit: one its
 *     host draws again is followed, and the old one let go (east-workspace#1772),
 *   - `useCoarsePointer` / `useHoverCapable` mirror `matchMedia` and fall
 *     back to fine-pointer defaults when it is unavailable.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import {
    useContainerBreakpoint,
    useContainerBelow,
    useContainerColumns,
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

    test("a crossing commits inside the observer's own delivery — before the frame at the new width paints, never a frame later", () => {
        let w = 559;
        const fire = stubResizeObserver(() => w);
        // No frame ever begins: whatever waits for one never lands.
        vi.stubGlobal("requestAnimationFrame", () => 1);
        let seen = false;
        render(<BelowProbe px={560} report={(b) => { seen = b; }} />);
        expect(seen).toBe(true);

        w = 600;
        act(() => {
            fire();
            // Read inside the delivery, before act flushes anything of its own.
            expect(seen).toBe(false);
        });
    });

    test("initial pane placement settles before any ResizeObserver delivery", () => {
        let width = 360;
        stubResizeObserver(() => width);
        let seen = false;
        function Frame() {
            const ref = useRef<HTMLDivElement>(null);
            seen = useContainerBelow(ref, 480);
            // BuilderFrame opens at its declared pane sizes, then places them
            // against available width in a layout effect during the mount.
            useLayoutEffect(() => { width = 700; }, []);
            return <div ref={ref} />;
        }
        render(<Frame />);
        expect(seen).toBe(false);
    });

    test("defaults to false without ResizeObserver", () => {
        vi.stubGlobal("ResizeObserver", undefined);
        let seen = true;
        render(<BelowProbe px={560} report={(b) => { seen = b; }} />);
        expect(seen).toBe(false);
    });
});

describe("the element observed (east-workspace#1772)", () => {
    test("is the one the ref holds after each commit: drawn again under a new key, or after none, the new one is observed and the old one let go", () => {
        // Each element observed, and the observer that hears it: a browser tells an observer of the elements it watches.
        const observing = new Map<Element, () => void>();
        class RO {
            private readonly watched = new Set<Element>();
            private readonly callback: () => void;
            constructor(callback: () => void) { this.callback = callback; }
            observe(el: Element) { this.watched.add(el); observing.set(el, this.callback); }
            unobserve(el: Element) { this.watched.delete(el); observing.delete(el); }
            disconnect() { for (const el of this.watched) observing.delete(el); this.watched.clear(); }
        }
        vi.stubGlobal("ResizeObserver", RO);
        let width = 600;
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() =>
            ({ width, height: 100, top: 0, left: 0, right: width, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect));
        let seen = true;
        const report = (below: boolean) => { seen = below; };
        function Host({ drawn }: { drawn?: string }) {
            const ref = useRef<HTMLDivElement | null>(null);
            report(useContainerBelow(ref, 560));
            return drawn === undefined ? null : <div key={drawn} ref={ref} data-drawn={drawn} />;
        }
        const { container, rerender } = render(<Host drawn="a" />);
        const drawn = (name: string) => container.querySelector(`[data-drawn="${name}"]`)!;
        expect([[...observing.keys()], seen]).toEqual([[drawn("a")], false]);
        // Drawn again under a new key: the new element is the one observed, and a resize of it is heard.
        rerender(<Host drawn="b" />);
        expect([...observing.keys()]).toEqual([drawn("b")]);
        width = 500;
        act(() => observing.get(drawn("b"))!());
        expect(seen).toBe(true);
        // Drawn none, it observes nothing; drawn again, the new element, measured as it is drawn.
        rerender(<Host />);
        expect([...observing.keys()]).toEqual([]);
        width = 700;
        rerender(<Host drawn="c" />);
        expect([[...observing.keys()], seen]).toEqual([[drawn("c")], false]);
    });
});

describe("useContainerColumns", () => {
    function ColumnsProbe({ report }: { report: (columns: number) => void }) {
        const ref = useRef<HTMLDivElement | null>(null);
        const columns = useContainerColumns(ref, 300, 12, 40);
        return <div ref={ref}><Drawn columns={columns} report={report} /></div>;
    }
    /** What the probe draws, told its columns each time it is drawn: React may call the probe again on a width that leaves the count, but draws none of its tree again. */
    function Drawn({ columns, report }: { columns: number; report: (columns: number) => void }) {
        report(columns);
        return null;
    }

    test("as many columns of their least width, their gap apart, as fit between the margins — one at least — its host's tree drawn again only as the count changes", () => {
        let w = 1000;
        const fire = stubResizeObserver(() => w);
        const seen: number[] = [];
        render(<ColumnsProbe report={(columns) => { seen.push(columns); }} />);
        // 1000 less 40 of margins holds three of 300 with 12 between them; a fourth needs 312 more.
        expect(seen.at(-1)).toBe(3);
        const renders = seen.length;
        w = 990;
        act(() => fire());
        expect(seen.length).toBe(renders);
        w = 700;
        act(() => fire());
        expect(seen.at(-1)).toBe(2);
        w = 280;
        act(() => fire());
        expect(seen.at(-1)).toBe(1);
    });

    test("one without ResizeObserver", () => {
        vi.stubGlobal("ResizeObserver", undefined);
        let seen = 0;
        render(<ColumnsProbe report={(columns) => { seen = columns; }} />);
        expect(seen).toBe(1);
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
