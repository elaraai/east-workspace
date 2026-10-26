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

import { useEffect, type ReactElement } from "react";
import { createPortal } from "react-dom";
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

    test("an overlay that closes in its own render releases its item: the row folds again, with no render of the toolbar's (#1231)", async () => {
        const list = items({
            rail: { forms: [<span data-w={300} data-form-name="rail-live"><span data-part="trigger" data-state="open" /></span>, form("rail-chip", 120), form("rail-icon", 40)] },
        });
        const { container } = mount(list, 620);
        resize(430);
        expect(shown(container)).toEqual(["rail-live", "tabs-folded", "history"]);
        // The overlay closes as its own machine renders it: only its trigger's state turns.
        await act(async () => {
            container.querySelector("[data-part='trigger']")!.setAttribute("data-state", "closed");
            await Promise.resolve();
        });
        // 120 + 90 + 100 + 20 = 330 fits 430 — the chip (rank 1) and the tabs (rank 3) fold.
        expect(shown(container)).toEqual(["rail-chip", "tabs-folded", "history"]);
    });

    test("a tooltip showing on an item holds nothing: the row folds as its width says, and stays folded as the tooltip comes and goes", async () => {
        // A tooltip shows wherever the pointer rests — on an item a narrowing row moved under it, too.
        const list = items({
            rail: { forms: [<span data-w={300} data-form-name="rail-live"><span data-scope="tooltip" data-part="trigger" data-state="open" /></span>, form("rail-chip", 120), form("rail-icon", 40)] },
        });
        const { container } = mount(list, 620);
        resize(300);
        // 40 + 90 + 100 + 20 = 250 fits 300: the rail folds to its icon, its tooltip notwithstanding.
        expect(shown(container)).toEqual(["rail-icon", "tabs-folded", "history"]);
        cleanup();
        // A tooltip opening later, on an item the row then narrows past, holds it no more than one open from the start.
        const tipped = mount(items({
            rail: { forms: [<span data-w={300} data-form-name="rail-live"><span data-scope="tooltip" data-part="trigger" data-state="closed" /></span>, form("rail-chip", 120), form("rail-icon", 40)] },
        }), 620);
        expect(shown(tipped.container)).toEqual(["rail-live", "tabs-all", "history"]);
        await act(async () => {
            tipped.container.querySelector("[data-scope='tooltip']")!.setAttribute("data-state", "open");
            await Promise.resolve();
        });
        resize(300);
        expect(shown(tipped.container)).toEqual(["rail-icon", "tabs-folded", "history"]);
    });

    test("an item marked held keeps its form", () => {
        const { container } = mount(items({ tabs: { held: true } }), 620);
        resize(300);
        expect(shown(container)).toEqual(["rail-icon", "tabs-all", "history"]);
    });

    /**
     * A chip that takes the place of two controls (#1229), as the SnapGrid
     * editor's View chip does: the segments fold to their icons (rank 40), then
     * the zoom folds into the chip and the segments hide with it — one bundle
     * at one rank (50). `chip` is the zoom's folded form.
     */
    const viewItems = (chip = form("zoom-chip", 45)): ToolbarItem[] => [
        { key: "zoom", forms: [form("zoom", 100), chip], rank: 50, bundle: "view" },
        { key: "widths", forms: [form("widths", 140), form("widths-icons", 72), null], rank: [40, 50], bundle: [undefined, "view"] },
        { key: "history", side: "end", forms: [form("history", 220)] },
    ];

    test("a bundle's steps apply together: the chip draws in the step that hides the controls it holds, and the ladder lists every step (#1229)", () => {
        // 100 + 72 + 220 + 20 = 412: the segments' icons fit.
        const { container } = mount(viewItems(), 412);
        expect(shown(container)).toEqual(["zoom", "widths-icons", "history"]);
        expect(container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-ladder")).toBe("widths>1 zoom>1 widths>2");
        // At 400 the chip beside the icons (45 + 72 + 220 + 20 = 357) would fit — half the bundle: both steps apply.
        resize(400);
        expect(shown(container)).toEqual(["zoom-chip", "history"]);
        expect(container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-folds")).toBe("3");
        resize(412);
        expect(shown(container)).toEqual(["zoom", "widths-icons", "history"]);
    });

    test("a held member holds its bundle: while the chip's menu is open, the controls it holds never unfold beside it (#1229)", () => {
        const open = <span data-w={45} data-form-name="zoom-chip"><span data-part="trigger" data-state="open" /></span>;
        const { container } = mount(viewItems(open), 300);
        expect(shown(container)).toEqual(["zoom-chip", "history"]);
        // Room for every control now — the segments' labels too — but the chip holds its menu open.
        resize(620);
        expect(shown(container)).toEqual(["zoom-chip", "history"]);
        resize(300);
        expect(shown(container)).toEqual(["zoom-chip", "history"]);
    });

    /**
     * A search whose box folds into a View popover with the zoom, as the
     * Schematic's Find does (#1395): held while its query stands — folding
     * last, as the key search does — it holds the View; the steps join the
     * bundle as something is selected.
     */
    const searchItems = (held: boolean, steps: boolean): ToolbarItem[] => [
        { key: "zoom", forms: [form("zoom", 100), null], rank: 50, bundle: "view" },
        { key: "seek", forms: [form("seek-box", 160), form("seek-view", 45)], rank: 50, bundle: "view", foldsLast: held },
        ...(steps ? [{ key: "steps", forms: [form("steps", 72), null], rank: 50, bundle: "view" }] : []),
        { key: "history", side: "end", forms: [form("history", 136)] },
    ];
    const rerenderWith = (rerender: (ui: ReactElement) => void, list: ToolbarItem[]) =>
        rerender(<ChakraProvider value={system}><Toolbar items={list} /></ChakraProvider>);

    test("an item that joins a held bundle takes it as it stands: beside the folded View its search holds, the steps join folded and the row still fits; beside the box held unfolded, they show (#1395)", () => {
        // 45 + 136 + 10 = 191 fits 200: the View applies, the zoom inside it.
        const narrow = mount(searchItems(false, false), 200);
        expect(shown(narrow.container)).toEqual(["seek-view", "history"]);
        // A query typed holds the View; something selected, the steps join it — folded, the history still in the row.
        rerenderWith(narrow.rerender, searchItems(true, false));
        rerenderWith(narrow.rerender, searchItems(true, true));
        expect(shown(narrow.container)).toEqual(["seek-view", "history"]);
        expect(narrow.container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-state")).toBe("zoom=1/2;seek=1/2;steps=1/2;history=0/1");
        cleanup();
        // With room, the box is held unfolded: the View does not apply, and the steps show beside it.
        const wide = mount(searchItems(false, false), 620);
        expect(shown(wide.container)).toEqual(["zoom", "seek-box", "history"]);
        rerenderWith(wide.rerender, searchItems(true, false));
        rerenderWith(wide.rerender, searchItems(true, true));
        expect(shown(wide.container)).toEqual(["zoom", "seek-box", "steps", "history"]);
    });

    /**
     * The Schematic's row (#1404): the tools drop their words, then fold into a chip, both their own steps, and last go
     * into the View with the zoom and the steps, one bundle the box folds into too.
     */
    const schematicItems = (held: boolean, steps: boolean): ToolbarItem[] => [
        { key: "tools", forms: [form("tools", 180), form("tools-icons", 120), form("tools-chip", 60), null], rank: [10, 30, 50], bundle: [undefined, undefined, "view"] },
        { key: "zoom", forms: [form("zoom", 100), null], rank: 50, bundle: "view" },
        { key: "seek", forms: [form("seek-box", 160), form("seek-view", 45)], rank: 50, bundle: "view", foldsLast: held },
        ...(steps ? [{ key: "steps", forms: [form("steps", 70), null], rank: 50, bundle: "view" }] : []),
        { key: "history", side: "end", forms: [form("history", 170), form("history-buttons", 130)] },
    ];

    test("the box its query holds keeps the View off, and the row folds what is left around it: the tools to their icons, then their chip, the history last (#1404)", () => {
        // 180 + 100 + 160 + 170 + 30 = 640 fits.
        const { container, rerender } = mount(schematicItems(false, false), 640);
        expect(shown(container)).toEqual(["tools", "zoom", "seek-box", "history"]);
        // A query typed holds the box; something selected, the steps join beside it — the View held off, the tools fold
        // to their icons (120 + 100 + 160 + 70 + 170 + 40 = 660), to their chip (600), then the history (560).
        rerenderWith(rerender, schematicItems(true, false));
        rerenderWith(rerender, schematicItems(true, true));
        expect(shown(container)).toEqual(["tools-chip", "zoom", "seek-box", "steps", "history"]);
        resize(570);
        expect(shown(container)).toEqual(["tools-chip", "zoom", "seek-box", "steps", "history-buttons"]);
        expect(container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-state")).toBe("tools=2/4;zoom=0/2;seek=0/2;steps=0/2;history=1/2");
        // Room again: the tools unfold beside the held box, as far as the row allows — never into the View it holds off.
        resize(700);
        expect(shown(container)).toEqual(["tools-icons", "zoom", "seek-box", "steps", "history"]);
        resize(760);
        expect(shown(container)).toEqual(["tools", "zoom", "seek-box", "steps", "history"]);
        // The query cleared, the box folds with the rest again: the View takes the tools, the zoom, the box and the steps.
        rerenderWith(rerender, schematicItems(false, true));
        resize(300);
        expect(shown(container)).toEqual(["seek-view", "history"]);
    });

    /**
     * The Schematic's row as its key search folds (ruled 26 Oct 2026, "Find folds"): the box folds to its icon, then into
     * the View with the tools, the zoom and the steps — folding last while its query stands.
     */
    const findItems = (held: boolean, steps: boolean): ToolbarItem[] => [
        { key: "tools", forms: [form("tools", 180), form("tools-icons", 120), form("tools-chip", 60), null], rank: [10, 30, 50], bundle: [undefined, undefined, "view"] },
        { key: "zoom", forms: [form("zoom", 100), null], rank: 50, bundle: "view" },
        { key: "seek", forms: [form("seek-box", 200), form("seek-icon", 40), form("seek-view", 45)], rank: [20, 50], bundle: [undefined, "view"], foldsLast: held },
        ...(steps ? [{ key: "steps", forms: [form("steps", 70), null], rank: 50, bundle: "view" }] : []),
        { key: "history", side: "end", forms: [form("history", 170), form("history-buttons", 130)] },
    ];

    test("an item that folds last keeps its form while anything else in the row can fold; once nothing else can, it folds on — its bundle still off, the rest unfolding as the row allows — and back no more while so marked; the history always in the row (ruled 26 Oct 2026, \"Find folds\")", () => {
        // 180 + 100 + 200 + 170 + 30 = 680: every item at its widest.
        const { container, rerender } = mount(findItems(false, false), 760);
        expect(shown(container)).toEqual(["tools", "zoom", "seek-box", "history"]);
        // A query holds the box; a pick selects, and the steps join beside it: 180 + 100 + 200 + 70 + 170 + 40 = 760.
        rerenderWith(rerender, findItems(true, false));
        rerenderWith(rerender, findItems(true, true));
        expect(shown(container)).toEqual(["tools", "zoom", "seek-box", "steps", "history"]);
        // Everything else folds first: the tools to their chip, the history to its buttons — 60 + 100 + 200 + 70 + 130 + 40 = 600.
        resize(600);
        expect(shown(container)).toEqual(["tools-chip", "zoom", "seek-box", "steps", "history-buttons"]);
        // A pixel less, and nothing else can fold: the box folds to its icon, the View it holds off still off, and the
        // row folds no further than it must around it — 120 + 100 + 40 + 70 + 170 + 40 = 540.
        resize(599);
        expect(shown(container)).toEqual(["tools-icons", "zoom", "seek-icon", "steps", "history"]);
        // Held, it unfolds no more, whatever the room.
        resize(760);
        expect(shown(container)).toEqual(["tools", "zoom", "seek-icon", "steps", "history"]);
        // Narrower than its icon and every other step allow: into the View, with the tools, the zoom and the steps.
        resize(300);
        expect(shown(container)).toEqual(["seek-view", "history"]);
        // The query cleared, it folds with the rest again: with room, the box.
        rerenderWith(rerender, findItems(false, true));
        resize(760);
        expect(shown(container)).toEqual(["tools", "zoom", "seek-box", "steps", "history"]);
    });

    test("what an item keeps is drawn once whatever form it takes, in no place of the row, and outlives every fold", () => {
        const stage = document.createElement("div");
        let mounts = 0;
        function Kept() {
            useEffect(() => { mounts += 1; }, []);
            return <span data-kept="">kept</span>;
        }
        const list: ToolbarItem[] = [
            { key: "box", forms: [form("box", 300), form("icon", 40)], rank: 1, keep: createPortal(<Kept />, stage) },
            { key: "history", side: "end", forms: [form("history", 100)] },
        ];
        const { container } = mount(list, 620);
        expect(shown(container)).toEqual(["box", "history"]);
        resize(200);
        expect(shown(container)).toEqual(["icon", "history"]);
        resize(620);
        expect(shown(container)).toEqual(["box", "history"]);
        expect(mounts).toBe(1);
        expect(stage.querySelectorAll("[data-kept]").length).toBe(1);
        expect(container.querySelector("[data-kept]")).toBeNull();
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
