/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan toolbar's one row under width pressure (#952): one ladder over its
 * items — the slice rail's two clusters first, in the rail's order (search,
 * the range, the filter builder, the terminal chip, the icon), then the
 * Plan's own (the user's decision): the summary shortens to its count, the
 * resolution segment folds into its menu, then the grain segment, and last
 * the summary hides. jsdom lays nothing out, so each item's width is stubbed
 * by the form it shows, every fold giving room back; the gap is 10px.
 */

import { describe, test, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { buildSliceHandle } from "../../platform/slice/index.js";
import { sliceConfig } from "../../platform/slice/slice.test-utils.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { PlanToolbar, type PlanToolbarProps } from "./shell/Toolbar.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

/** Each item's width in each of its forms, widest first (a hidden form has no box). */
const FORM_PX: Record<string, readonly number[]> = {
    cluster: [300, 240, 160, 110, 40],
    grain: [170, 90],
    range: [200, 80],
    resolution: [150, 80],
    summary: [260, 120],
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

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

/** A slice over two dated rows, with nothing narrowed. */
function sliceHandle(): PlanToolbarProps["slice"] {
    initializeStore(new UIStore());
    const cfg = sliceConfig({
        at: variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none }),
    }, { rangeFieldId: some("at") });
    const initial = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none,
        resolution: some(variant("week", null)),
    };
    return buildSliceHandle("plan.toolbar.ladder", cfg, initial as never,
        [{ at: W27 }, { at: W39 }] as never, none) as never;
}

/** The toolbar of a canvas with a root group, a bound slice and every chrome affordance. */
function Harness({ slice }: { slice: PlanToolbarProps["slice"] }) {
    const styles = useSlotRecipe({ key: "plan" })() as unknown as Record<string, Record<string, unknown>>;
    return (
        <PlanToolbar styles={styles} slice={slice}
            affordances={["filter", "search", "range", "resolution", "summary"]}
            resolution="week" resolutions={["week", "day"]} grain="group" />
    );
}

/** Each item's form of its forms, as the toolbar says it folded them. */
function stateOf(container: HTMLElement): Map<string, number> {
    const text = container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-state")!;
    return new Map(text.split(";").map((part) => {
        const [key, of] = part.split("=");
        return [key!, Number(of!.split("/")[0])] as const;
    }));
}

/** The Plan's ladder, step by step: the rail's (search, the range, the filter
 *  builder, the terminal chip, the icon), then the Plan's own. */
const LADDER: ReadonlyArray<readonly [string, number]> = [
    ["cluster", 1], ["range", 1], ["cluster", 2], ["cluster", 3], ["cluster", 4],
    ["summary", 1], ["resolution", 1], ["grain", 1], ["summary", 2],
];

/** The row a configuration needs: every drawn form's width, and a 10px gap between drawn items. */
function needs(forms: ReadonlyMap<string, number>): number {
    const drawn = [...forms].flatMap(([key, form]) => {
        const px = FORM_PX[key]![form];
        return px === undefined ? [] : [px];
    });
    return drawn.reduce((a, b) => a + b, 0) + 10 * Math.max(0, drawn.length - 1);
}

describe("the Plan toolbar's ladder (#952)", () => {
    test("a narrowing row folds the rail first, in its order, then the summary shortens, the resolution then the grain fold into menus, and the summary hides", () => {
        const slice = sliceHandle();
        let forms = new Map([["cluster", 0], ["grain", 0], ["range", 0], ["resolution", 0], ["summary", 0]]);
        row.px = needs(forms);
        const ui = render(<ChakraProvider value={system}><Harness slice={slice} /></ChakraProvider>);
        expect(stateOf(ui.container)).toEqual(forms);
        const at = (px: number) => {
            row.px = px;
            ui.rerender(<ChakraProvider value={system}><Harness slice={slice} /></ChakraProvider>);
            return stateOf(ui.container);
        };
        // Each configuration on the ladder holds in exactly the row it needs,
        // and a pixel less takes the next step — and only that one.
        for (const [key, form] of LADDER) {
            const room = needs(forms);
            expect(at(room), `${room}px`).toEqual(forms);
            forms = new Map(forms).set(key, form);
            expect(at(room - 1), `${room - 1}px, the step ${key}→${form}`).toEqual(forms);
        }
        // Folded all the way: the rail's icon, the range's chip, both segments as menus, no summary.
        const c = ui.container;
        expect(c.querySelector("[data-toolbar-item='cluster'] [data-rail-rung='icon']")).not.toBeNull();
        expect(c.querySelector("[data-plan-segmenu='resolution']")!.textContent).toContain("WEEK");
        expect(c.querySelector("[data-plan-segmenu='grain']")!.textContent).toContain("GROUP");
        expect(c.querySelector("[data-plan-seg]")).toBeNull();
        expect(c.querySelector("[data-slot='toolbarSummary']")).toBeNull();
    });

    test("the shortened summary is its count alone", () => {
        const slice = sliceHandle();
        // Past the rail's floor, with the summary's first step taken: the
        // full line (260) gives way to the count (120).
        row.px = 40 + 170 + 80 + 150 + 120 + 40;
        const { container } = render(<ChakraProvider value={system}><Harness slice={slice} /></ChakraProvider>);
        expect(stateOf(container).get("summary")).toBe(1);
        expect(container.querySelector("[data-slot='toolbarSummary']")!.textContent).toBe("2 of 2");
    });
});
