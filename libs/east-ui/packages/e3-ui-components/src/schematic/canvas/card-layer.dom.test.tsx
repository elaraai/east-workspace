/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The card layer's card sizes (#1403): each card's size as the page lays it
 * out, heard by a ResizeObserver, for a link's end to meet. The map is the
 * layer's to keep bounded and cheap — written in place as a size moves, never
 * copied whole a batch, and a card let go of as the layer stops observing it —
 * so a long session over a floor of thousands of racks keeps the sizes of the
 * cards it draws, no more. jsdom has no ResizeObserver: the test's stands in,
 * reporting the sizes a page would.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { defaultValue, some } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { Schematic } from "@elaraai/e3-ui/internal";
import type { SchematicNarrowedLook } from "../narrowing.js";
import { SchematicCardLayer } from "./card-layer";
import { drawnItem, type DrawnItem } from "./drawn";
import type { LodTier } from "./model";

/** What the observer the layer makes reports: each card a size, as a page lays it out. */
class StandInObserver {
    static made: StandInObserver | undefined;
    readonly observed = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) { StandInObserver.made = this; }
    observe(el: Element): void { this.observed.add(el); }
    unobserve(el: Element): void { this.observed.delete(el); }
    disconnect(): void { this.observed.clear(); }
    /** Reports a batch: each card's border box. */
    report(sizes: readonly (readonly [Element, number, number])[]): void {
        const entries = sizes.map(([target, w, h]) => ({ target, borderBoxSize: [{ inlineSize: w, blockSize: h }] }));
        this.callback(entries as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
}

beforeEach(() => {
    StandInObserver.made = undefined;
    vi.stubGlobal("ResizeObserver", StandInObserver);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const T = Schematic.Types;
/** A rack drawn as a card. */
const rack = (key: string, x: number): DrawnItem => drawnItem({ kind: "racks", key }, {
    ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y: 2 }), label: key,
}, undefined)!;
const a = rack("A01", 2), b = rack("A02", 6);

/** No narrowing's look. */
const LOOK: SchematicNarrowedLook = { dim: false, opacity: 0.35, desaturate: true, dot: false, emphasis: undefined, frame: false, fit: false };

/** The layer over some cards, its sizes kept in `sizes`. */
function layer(items: readonly DrawnItem[], sizes: RefObject<Map<string, { w: number; h: number }>>, applyCamera: () => void) {
    return (
        <ChakraProvider value={system}>
            <SchematicCardLayer cardLayerRef={createRef<HTMLDivElement>()} styles={{}} visibleItems={items}
                tiers={new Map<string, LodTier>(items.map((item) => [item.key, "card"]))} lod="card" context={new Set()} look={LOOK} matches={new Set()}
                renderSelected={new Set()} lockedKeys={new Set()} layerAlpha={new Map()} connectDraft={null} dropMark={undefined} centers={new Map()}
                cardSizesRef={sizes} applyCamera={applyCamera} />
        </ChakraProvider>
    );
}

/** A card's element, by its item. */
const cardOf = (container: HTMLElement, item: DrawnItem) => container.querySelector(`[data-card-key=${JSON.stringify(item.key)}]`)!;

test("each card's size is written in place as it moves — the same map across batches, never a copy of it — and a card the layer lets go of leaves it", () => {
    const sizes: RefObject<Map<string, { w: number; h: number }>> = { current: new Map() };
    const applyCamera = vi.fn();
    const { container, rerender } = render(layer([a, b], sizes, applyCamera));
    const observer = StandInObserver.made!;
    expect(observer.observed.size).toBe(2);
    // The first batch: both cards' sizes heard, and the paint asked to draw again.
    act(() => { observer.report([[cardOf(container, a), 100, 40], [cardOf(container, b), 60, 40]]); });
    expect([sizes.current.get(a.key), sizes.current.get(b.key)]).toEqual([{ w: 100, h: 40 }, { w: 60, h: 40 }]);
    expect(applyCamera).toHaveBeenCalledTimes(1);
    // A batch moving one card's size writes it into the same map.
    const held = sizes.current;
    act(() => { observer.report([[cardOf(container, a), 120, 40]]); });
    expect(Object.is(sizes.current, held)).toBe(true);
    expect(sizes.current.get(a.key)).toEqual({ w: 120, h: 40 });
    expect(applyCamera).toHaveBeenCalledTimes(2);
    // A01 no longer draws as a card: the layer stops observing it, and its size goes.
    rerender(layer([b], sizes, applyCamera));
    expect(observer.observed.size).toBe(1);
    expect([sizes.current.has(a.key), sizes.current.get(b.key)]).toEqual([false, { w: 60, h: 40 }]);
});
