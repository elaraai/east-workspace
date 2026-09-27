/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The shared toolbar (#952): one ladder over every item's forms, chosen from
 * measured widths before paint. jsdom lays nothing out, so the widths are
 * stubbed: the row's box is `row.px`, a form's width is its `data-w`, and the
 * gap between items is 10px. The row's ResizeObserver is captured, so a test
 * can move the row's width the way the browser reports it.
 */

import { describe, test, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/index.js";
import { Toolbar, type ToolbarItem } from "./index.js";

afterEach(cleanup);

/** The stubbed layout: the row's box, and the gap between items. */
const row = { px: 0 };
const GAP = 10;

/** The observers the toolbars created, to deliver a width change through. */
const observers: { cb: ResizeObserverCallback; targets: Set<Element> }[] = [];
class ResizeObserverStub {
    private readonly entry: { cb: ResizeObserverCallback; targets: Set<Element> };
    constructor(cb: ResizeObserverCallback) { this.entry = { cb, targets: new Set() }; observers.push(this.entry); }
    observe(el: Element) { this.entry.targets.add(el); }
    unobserve(el: Element) { this.entry.targets.delete(el); }
    disconnect() { this.entry.targets.clear(); }
}

/** A width in the stubbed layout: the row's, an item's (its form's `data-w`), else 0. */
function widthOf(el: Element): number {
    if (el.hasAttribute("data-toolbar")) return row.px;
    if (el.hasAttribute("data-toolbar-item")) return Number((el.firstElementChild as HTMLElement | null)?.dataset["w"] ?? 0);
    return 0;
}

const originalRect = Element.prototype.getBoundingClientRect;
const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = widthOf(this);
        return { x: 0, y: 0, left: 0, top: 0, width, height: 20, right: width, bottom: 20, toJSON() { return {}; } } as DOMRect;
    };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
        const style = computed(el, pseudo);
        if (!el.hasAttribute("data-toolbar")) return style;
        return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? `${GAP}px` : Reflect.get(target, prop)) });
    });
});
afterAll(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    vi.restoreAllMocks();
});

/** A form of the given width, named for the assertions. */
const form = (name: string, w: number) => <span data-w={w} data-form-name={name}>{name}</span>;

/** The rail-like item (ranks 1, 7), a host item (rank 3), a fixed item. */
function items(extra?: Partial<Record<string, Partial<ToolbarItem>>>): ToolbarItem[] {
    return [
        { key: "rail", forms: [form("rail-live", 300), form("rail-chip", 120), form("rail-icon", 40)], rank: [1, 7], ...extra?.["rail"] },
        { key: "tabs", forms: [form("tabs-all", 200), form("tabs-folded", 90)], rank: 3, ...extra?.["tabs"] },
        { key: "history", side: "end", forms: [form("history", 100)], ...extra?.["history"] },
    ];
}

function mount(list: ToolbarItem[], px: number) {
    row.px = px;
    return render(<ChakraProvider value={system}><Toolbar items={list} /></ChakraProvider>);
}

/** The forms on screen, in row order. */
const shown = (container: HTMLElement) =>
    [...container.querySelectorAll("[data-toolbar-item] > [data-form-name]")].map((el) => el.getAttribute("data-form-name"));

/** Move the row's width and deliver it the way the browser does. */
function resize(px: number) {
    row.px = px;
    act(() => {
        for (const o of observers) {
            const rowEl = [...o.targets].find((t) => t.hasAttribute("data-toolbar"));
            if (rowEl !== undefined) o.cb([{ target: rowEl } as ResizeObserverEntry], {} as ResizeObserver);
        }
    });
}

describe("the toolbar's one ladder", () => {
    test("a row that fits renders every item in its widest form", () => {
        const { container } = mount(items(), 620);
        expect(shown(container)).toEqual(["rail-live", "tabs-all", "history"]);
        expect(container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-folds")).toBe("0");
    });

    test("a narrower row folds by rank — and has settled by the time the mount returns", () => {
        // 120 + 200 + 100 + 2 gaps = 440 fits 450; the rail's chip (rank 1) folds first.
        const { container } = mount(items(), 450);
        expect(shown(container)).toEqual(["rail-chip", "tabs-all", "history"]);
        cleanup();
        // 120 + 90 + 100 + 20 = 330.
        expect(shown(mount(items(), 340).container)).toEqual(["rail-chip", "tabs-folded", "history"]);
        cleanup();
        // 40 + 90 + 100 + 20 = 250.
        expect(shown(mount(items(), 260).container)).toEqual(["rail-icon", "tabs-folded", "history"]);
    });

    test("the end cluster starts with the first end item drawn", () => {
        const { container } = mount(items(), 620);
        const ends = [...container.querySelectorAll("[data-toolbar-end]")].map((el) => el.getAttribute("data-toolbar-item"));
        expect(ends).toEqual(["history"]);
    });

    test("a width change moves the toolbar straight to its configuration, both ways", () => {
        const { container } = mount(items(), 620);
        resize(340);
        expect(shown(container)).toEqual(["rail-chip", "tabs-folded", "history"]);
        resize(620);
        expect(shown(container)).toEqual(["rail-live", "tabs-all", "history"]);
        resize(450);
        expect(shown(container)).toEqual(["rail-chip", "tabs-all", "history"]);
    });

    test("the configuration is a function of the width: the same width, reached any way, gives the same row", () => {
        const byWidth = new Map<number, string>();
        const { container } = mount(items(), 700);
        const widths = [700, 600, 500, 440, 400, 330, 300, 250, 200];
        for (const w of [...widths, ...[...widths].reverse(), 330, 700, 250, 440]) {
            resize(w);
            const row = shown(container).join(",");
            const seen = byWidth.get(w);
            if (seen !== undefined) expect(row).toBe(seen);
            byWidth.set(w, row);
        }
    });

    test("an item holding an open overlay keeps its form; the row folds around it", () => {
        const list = items({
            rail: { forms: [<span data-w={300} data-form-name="rail-live"><span data-part="trigger" data-state="open" /></span>, form("rail-chip", 120), form("rail-icon", 40)] },
        });
        const { container } = mount(list, 620);
        resize(430);
        // The rail stays live (its overlay is open); the tabs fold instead: 300 + 90 + 100 + 20 = 510 clips.
        expect(shown(container)).toEqual(["rail-live", "tabs-folded", "history"]);
    });

    test("an item marked held keeps its form", () => {
        const { container } = mount(items({ tabs: { held: true } }), 620);
        resize(300);
        expect(shown(container)).toEqual(["rail-icon", "tabs-all", "history"]);
    });

    test("an empty form hides the item, and takes no gap", () => {
        const list: ToolbarItem[] = [
            { key: "count", forms: [form("count", 100), null], rank: 1 },
            { key: "tabs", forms: [form("tabs", 200)] },
        ];
        const { container } = mount(list, 305);
        // 100 + 200 + 10 = 310 overflows 305: the count hides and the row is 200.
        expect(shown(container)).toEqual(["tabs"]);
        expect(container.querySelector('[data-toolbar-item="count"]')).toBeNull();
    });

    test("a changed version forgets the widths it measured, and measures again", () => {
        // The rail's live form (300) does not fit beside the history: its chip does.
        const pair = (live: number, version?: number): ToolbarItem[] => [
            { key: "rail", forms: [form("rail-live", live), form("rail-chip", 100)], rank: 1, version },
            { key: "history", side: "end", forms: [form("history", 100)] },
        ];
        const { container, rerender } = mount(pair(300, 1), 300);
        expect(shown(container)).toEqual(["rail-chip", "history"]);
        // Its content narrows to 150 — it would fit now. Without a new version the toolbar
        // goes by the live form's width it measured (300) and stays folded…
        rerender(<ChakraProvider value={system}><Toolbar items={pair(150, 1)} /></ChakraProvider>);
        expect(shown(container)).toEqual(["rail-chip", "history"]);
        // …with one, it forgets that width, tries the live form, measures it, and keeps it.
        rerender(<ChakraProvider value={system}><Toolbar items={pair(150, 2)} /></ChakraProvider>);
        expect(shown(container)).toEqual(["rail-live", "history"]);
        // And it measures it again: back at 300, a new version folds it again.
        rerender(<ChakraProvider value={system}><Toolbar items={pair(300, 3)} /></ChakraProvider>);
        expect(shown(container)).toEqual(["rail-chip", "history"]);
    });

    test("a row that is not laid out folds nothing", () => {
        const { container } = mount(items(), 0);
        expect(shown(container)).toEqual(["rail-live", "tabs-all", "history"]);
    });
});
