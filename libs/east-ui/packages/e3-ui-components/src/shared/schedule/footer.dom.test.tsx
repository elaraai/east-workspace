/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The footer rail's wrap (the Schematic's footer): measured at the rail's
 * unwrapped gap whatever form it is in, so a rail that fits only once wrapped
 * stays wrapped instead of looping; and a wrapped rail whose one item wraps its
 * own words, filling it, stays wrapped too.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useRailWrap } from "./footer.js";

const observers: (() => void)[] = [];
class ResizeObserverStub {
    constructor(callback: () => void) { observers.push(callback); }
    observe() {}
    disconnect() {}
}
/** One item that wraps its own words once the rail wraps: 308px on one line, filling the rail's 24px-less width wrapped. */
function LongRail({ width }: { width: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const wrap = useRailWrap(ref, "density");
    return <div ref={ref} data-rail={width} data-gap-var="" data-wrap={wrap ? "" : undefined}><span data-long="" /></div>;
}

/** Three 100px items in a rail `width` wide: 12px of inline padding a side, 14px apart unwrapped, 10px wrapped. */
function Rail({ width, gapVar = true }: { width: number; gapVar?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const wrap = useRailWrap(ref, "legend");
    return <div ref={ref} data-rail={width} data-gap-var={gapVar ? "" : undefined} data-wrap={wrap ? "" : undefined}>
        {[0, 1, 2].map(i => <span key={i} />)}
    </div>;
}

function stubGeometry() {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const rail = this.parentElement;
        const long = rail?.hasAttribute("data-wrap") === true ? Number(rail.getAttribute("data-rail")) - 24 : 308;
        const width = this.hasAttribute("data-rail") ? Number(this.getAttribute("data-rail")) : this.hasAttribute("data-long") ? long : 100;
        return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 20, width, height: 20, toJSON() {} };
    });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
        if (!el.hasAttribute("data-rail")) return real(el);
        const wrapped = el.hasAttribute("data-wrap");
        return {
            columnGap: wrapped ? "10px" : "14px", paddingInlineStart: "12px", paddingInlineEnd: "12px",
            borderInlineStartWidth: "0px", borderInlineEndWidth: "0px",
            getPropertyValue: (name: string) => name === "--builder-footer-gap" && el.hasAttribute("data-gap-var") ? "14px" : "",
        } as unknown as CSSStyleDeclaration;
    });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); observers.length = 0; });

describe("the footer rail's wrap", () => {
    test("a rail whose items need more than one line wraps, and one they fit does not", () => {
        stubGeometry();
        // Unwrapped the items need 300 + 2 × 14 + 24 = 352px.
        const fits = render(<Rail width={360} />);
        expect(fits.container.querySelector("[data-wrap]")).toBeNull();
        fits.unmount();
        const tight = render(<Rail width={340} />);
        expect(tight.container.querySelector("[data-wrap]")).not.toBeNull();
    });

    test("a rail between its wrapped and unwrapped widths stays wrapped: it is measured at its unwrapped gap", () => {
        stubGeometry();
        // 348px: too narrow for 352px unwrapped, wide enough for 344px at the wrapped gap.
        const { container } = render(<Rail width={348} />);
        expect(container.querySelector("[data-wrap]")).not.toBeNull();
        // Each measure the rail's observer runs — its items moving as it wraps — keeps it wrapped.
        for (let i = 0; i < 3; i++) {
            act(() => { for (const observe of [...observers]) observe(); });
            expect(container.querySelector("[data-wrap]"), `measure ${i + 1}`).not.toBeNull();
        }
    });

    test("a rail whose one item is wider than it wraps, and stays wrapped while the item, wrapping its own words, fills it", () => {
        stubGeometry();
        // 308 + 24 = 332px on one line in a 294px rail: wrapped, the item fills the rail's 270px, and 294px is no reason to unwrap.
        const { container } = render(<LongRail width={294} />);
        expect(container.querySelector("[data-wrap]")).not.toBeNull();
        for (let i = 0; i < 3; i++) {
            act(() => { for (const observe of [...observers]) observe(); });
            expect(container.querySelector("[data-wrap]"), `measure ${i + 1}`).not.toBeNull();
        }
    });

    test("a rail whose one item fits on one line with room does not wrap", () => {
        stubGeometry();
        // In a 400px rail the one item's 332px fits on one line.
        const { container } = render(<LongRail width={400} />);
        expect(container.querySelector("[data-wrap]")).toBeNull();
    });

    test("a rail that keeps no unwrapped gap measures by its current one", () => {
        stubGeometry();
        const { container } = render(<Rail width={340} gapVar={false} />);
        expect(container.querySelector("[data-wrap]")).not.toBeNull();
    });
});
