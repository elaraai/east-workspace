/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's toolbar items on its frame's one row under width pressure
 * (#1245, `Flowchart Builder Spec.md` §7.1, FB8, FB9): one ladder over its
 * items — the slice's rail first, in the rail's order (its search, its
 * filter, the terminal chip, the icon), then the flowchart's own: the
 * freshness chip goes, LR · TD folds into its one chip, and find state's box
 * folds to its icon. jsdom lays nothing out, so each item's width is stubbed
 * by the form it shows, every fold giving room back; the gap is 10px.
 */

import { describe, test, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { StringType, none, toEastTypeValue, type ValueTypeOf } from "@elaraai/east";
import type { Slice } from "@elaraai/east-ui/internal";
import { system, formatters, buildSliceHandle, UIStore, Toolbar, type KeySearchSource } from "@elaraai/east-ui-components";
import { sliceConfig, stringField } from "@elaraai/east-ui-components/testing";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { useFlowchartToolbarItems, type FlowchartToolbarProps } from "./toolbar.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

/** Each item's width in each of its forms, widest first (a hidden form has no box). */
const FORM_PX: Record<string, readonly number[]> = {
    seek: [200, 44],
    orientation: [80, 56],
    freshness: [150],
    rail: [300, 240, 160, 110, 40],
};

function widthOf(el: Element): number {
    if (el.hasAttribute("data-toolbar")) return row.px;
    const key = el.getAttribute("data-toolbar-item");
    if (key === null) return 0;
    return FORM_PX[key]?.[Number(el.getAttribute("data-toolbar-form"))] ?? 0;
}

const originalRect = Element.prototype.getBoundingClientRect;
const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = widthOf(this);
        return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
    };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
        const style = computed(el, pseudo);
        if (!el.hasAttribute("data-toolbar")) return style;
        return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
    });
});
afterAll(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    vi.restoreAllMocks();
});

/** A slice over two transitions, with nothing narrowed — what the rail mounts. */
function sliceHandle(): ValueTypeOf<typeof Slice.Types.Bind> {
    initializeStore(new UIStore());
    const cfg = sliceConfig({ src: stringField((r: { src: string }) => r.src) }, { searchFieldIds: ["src"] });
    const initial = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
    };
    return buildSliceHandle("flowchart.toolbar.ladder", cfg, initial as never, [{ src: "ARV" }, { src: "SCN" }] as never, none) as never;
}

/** Find state over a flow's states — the toolbar mounts it; nothing here searches. */
const FIND: KeySearchSource = {
    resetKey: "Inbound parcels", keyType: toEastTypeValue(StringType),
    find: async () => ({ found: false, row: 0, count: 0 }), listRange: async () => [], jump: () => {}, clear: () => {},
};

/** What the items take, but for the recipe's styles. */
type Parts = Omit<FlowchartToolbarProps, "styles">;

/** A flowchart with everything on its toolbar: find state, LR · TD, the freshness chip and the rail. */
function everything(): Parts {
    return {
        find: FIND, orientation: "LR", onOrientation: () => {},
        freshness: { label: "scans-2026.09", date: undefined },
        slice: sliceHandle(), affordances: ["filter", "search"], words: formatters("en-US"),
    };
}

/** The flowchart's items on the frame's one row, as its frame lays them out. */
function Harness({ parts }: { parts: Parts }) {
    const styles = useSlotRecipe({ key: "flowchart" })() as Record<string, SystemStyleObject>;
    return <Toolbar items={useFlowchartToolbarItems({ styles, ...parts })} />;
}

/** Each item's form of its forms, as the toolbar says it folded them, in the row's order. */
function stateOf(container: HTMLElement): Map<string, number> {
    const text = container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-state")!;
    return new Map(text.split(";").map((part) => {
        const [key, of] = part.split("=");
        return [key!, Number(of!.split("/")[0])] as const;
    }));
}

/** The flowchart's ladder, step by step: the rail's (its search, its filter,
 *  the terminal chip, the icon), then its own — the freshness chip, LR · TD,
 *  find state. */
const LADDER: ReadonlyArray<readonly [string, number]> = [
    ["rail", 1], ["rail", 2], ["rail", 3], ["rail", 4], ["freshness", 1], ["orientation", 1], ["seek", 1],
];

/** The row a configuration needs: every drawn form's width, and a 10px gap between drawn items. */
function needs(forms: ReadonlyMap<string, number>): number {
    const drawn = [...forms].flatMap(([key, form]) => {
        const px = FORM_PX[key]![form];
        return px === undefined ? [] : [px];
    });
    return drawn.reduce((a, b) => a + b, 0) + 10 * Math.max(0, drawn.length - 1);
}

/** Walks the ladder: each configuration on it holds in exactly the row it needs,
 *  and a pixel less takes the next step — and only that one. */
function walk(parts: Parts, start: ReadonlyMap<string, number>, ladder: ReadonlyArray<readonly [string, number]>) {
    let forms = new Map(start);
    row.px = needs(forms);
    const ui = render(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
    expect(stateOf(ui.container)).toEqual(forms);
    const at = (px: number) => {
        row.px = px;
        ui.rerender(<ChakraProvider value={system}><Harness parts={parts} /></ChakraProvider>);
        return stateOf(ui.container);
    };
    for (const [key, form] of ladder) {
        const room = needs(forms);
        expect(at(room), `${room}px`).toEqual(forms);
        forms = new Map(forms).set(key, form);
        expect(at(room - 1), `${room - 1}px, the step ${key}→${form}`).toEqual(forms);
    }
    return ui.container;
}

describe("the Flowchart's toolbar items (#1245)", () => {
    test("they are one row in §7.1's order: find state, LR · TD and the freshness chip at its start, the slice's rail at its end (FB8)", () => {
        row.px = 4000;
        const { container } = render(<ChakraProvider value={system}><Harness parts={everything()} /></ChakraProvider>);
        expect([...stateOf(container).keys()]).toEqual(["seek", "orientation", "freshness", "rail"]);
        const end = [...container.querySelectorAll("[data-toolbar-item][data-toolbar-end]")].map((el) => el.getAttribute("data-toolbar-item"));
        expect(end).toEqual(["rail"]);
        // Each in its widest form: find state's box, LR · TD's strip, the chip, the rail's live affordances.
        expect(container.querySelector("[data-toolbar-item='seek'] [data-part='dataset-key-search']")).not.toBeNull();
        expect(container.querySelector("[data-toolbar-item='orientation'] [data-flowchart-seg='orientation']")).not.toBeNull();
        expect(container.querySelector("[data-toolbar-item='freshness'] [data-flowchart-freshness]")!.textContent).toBe("scans-2026.09");
        expect(container.querySelector("[data-toolbar-item='rail'] [data-slice-rail='rail']")).not.toBeNull();
    });

    test("a narrowing row folds the rail first, in its order, then the freshness chip goes, LR · TD folds into its chip and find state into its icon (FB9)", () => {
        const start = new Map([["seek", 0], ["orientation", 0], ["freshness", 0], ["rail", 0]]);
        const c = walk(everything(), start, LADDER);
        // Folded all the way: the rail's icon, no freshness chip, LR · TD's one
        // chip naming the orientation, and find state's icon, named for it.
        expect(c.querySelector("[data-toolbar-item='rail'] [data-rail-rung='icon']")).not.toBeNull();
        expect(c.querySelector("[data-flowchart-freshness]")).toBeNull();
        // The chip says its orientation and no more: its caret is Font Awesome's solid caret-down, never a glyph.
        expect(c.querySelector("[data-flowchart-segmenu='orientation']")!.textContent).toBe("LR");
        expect(c.querySelector("[data-flowchart-segmenu='orientation'] [data-chip-caret] svg[data-prefix='fas'][data-icon='caret-down']")).not.toBeNull();
        expect(c.querySelector("[data-flowchart-seg]")).toBeNull();
        expect(c.querySelector("[data-toolbar-item='seek'] [data-key-search='icon']")!.getAttribute("aria-label")).toBe("Find state");
        expect(c.querySelector("[data-part='dataset-key-search']")).toBeNull();
    });

    test("over a flow with no state there is no find state, and with no slice or freshness LR · TD is the row", () => {
        row.px = 4000;
        const { container } = render(<ChakraProvider value={system}><Harness parts={{
            find: undefined, orientation: "TD", onOrientation: () => {}, freshness: undefined,
            slice: undefined, affordances: [], words: formatters("en-US"),
        }} /></ChakraProvider>);
        expect([...stateOf(container).keys()]).toEqual(["orientation"]);
        expect(container.querySelector("[data-flowchart-seg='orientation'] [aria-checked='true']")!.textContent).toBe("TD");
    });
});
