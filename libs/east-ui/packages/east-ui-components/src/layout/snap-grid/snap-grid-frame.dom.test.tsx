/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The SnapGrid's editing canvas in the builder's frame (#995), laid out by the
 * shared builder frame (#1125): the one toolbar, the zoom and the design
 * widths over a bound view, the selection bar, the saved time, the panes, and
 * what a host says in its banners slot (#1673).
 * Then the canvas at a phone's design width (#1673): the page laid out as a
 * phone shows it. Then the toolbar a row short of room folds into chips
 * (#1229): its ladder, the View chip's bundle, its menu, and its hold.
 */

import { describe, test, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { layOut } from "../../testing/drag-layer.js";
import { faIcons } from "../../testing/icons.js";
import {
    SEED, SEED_ROWS, canvasTestSetup, labels, type EditingSnapGrid,
    announced, clickTile, drop, gapEl, history, hold, key, layRows, mountSnapGrid, rowsDrawn, selectedTile, settle, spanOf, tileEl,
} from "./snap-grid-editing.test-utils.js";

canvasTestSetup();

describe("the builder's frame (#995)", () => {
    /** The toolbar's items, by key, in their order along the row. */
    const toolbarItems = (c: HTMLElement) =>
        [...c.querySelectorAll("[data-frame-slot=toolbar] [data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"));
    /** A button by its accessible name. */
    const button = (canvas: EditingSnapGrid, name: string) => canvas.getByRole("button", { name }) as HTMLButtonElement;
    /** The canvas's design width — the most it lays out at — and its zoom, as it draws them. */
    const drawn = (c: HTMLElement) => {
        const style = c.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style;
        return { width: style.maxWidth, zoom: style.getPropertyValue("zoom") };
    };

    test("one toolbar: the host's start items and the grid chip; the width readout, the zoom, the history item, the widths and the host's end items", async () => {
        const canvas = await mountSnapGrid({ chrome: true });
        const c = canvas.container;
        expect(toolbarItems(c)).toEqual(["start-0", "grid", "readout", "zoom", "rule", "history", "widths", "end-0"]);
        const item = (key: string) => c.querySelector(`[data-toolbar-item="${key}"]`)!.textContent;
        expect([item("start-0"), item("grid"), item("readout"), item("zoom"), item("end-0")])
            .toEqual(["Draft", "12 col · snap on", "1440 px", "100%", "Publish"]);
        expect([button(canvas, "Desktop"), button(canvas, "Tablet")].map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
        // The frame is the canvas's own: a card, the toolbar across it.
        expect(c.querySelector("[data-snap-grid-editor]")!.getAttribute("data-surface")).toBe("card");
    }, 30_000);

    test("the zoom steps by 10% within 50%–150%, writing the bound view; the canvas draws at it", async () => {
        const canvas = await mountSnapGrid({ chrome: true });
        const c = canvas.container;
        await act(async () => { fireEvent.click(button(canvas, "Zoom in")); });
        expect(canvas.boundView()).toEqual({ width: null, zoom: 1.1 });
        expect(c.querySelector("[data-snap-grid-zoom] output")!.textContent).toBe("110%");
        expect(drawn(c)).toEqual({ width: "1440px", zoom: "1.1" });
        for (let i = 0; i < 8; i++) await act(async () => { fireEvent.click(button(canvas, "Zoom out")); });
        expect(canvas.boundView().zoom).toBe(0.5);
        expect(button(canvas, "Zoom out").disabled).toBe(true);
        expect(button(canvas, "Zoom in").disabled).toBe(false);
        // Nothing the view holds is a gesture.
        expect(canvas.patches).toHaveLength(0);
    }, 30_000);

    test("a design width presses its button and writes the bound view; the canvas and the readout follow", async () => {
        const canvas = await mountSnapGrid({ chrome: true });
        const c = canvas.container;
        await act(async () => { fireEvent.click(button(canvas, "Tablet")); });
        expect(canvas.boundView()).toEqual({ width: "1024px", zoom: null });
        expect(drawn(c).width).toBe("1024px");
        expect(c.querySelector('[data-toolbar-item="readout"]')!.textContent).toBe("1024 px");
        expect([button(canvas, "Desktop"), button(canvas, "Tablet")].map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    }, 30_000);

    test("without a bound view the canvas keeps its own zoom", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await act(async () => { fireEvent.click(button(canvas, "Zoom in")); });
        expect(drawn(c).zoom).toBe("1.1");
        expect(canvas.boundView()).toEqual({ width: null, zoom: null });
        // No design width, so no readout; no widths, so no presets.
        expect(toolbarItems(c)).toEqual(["grid", "zoom", "rule", "history"]);
    }, 30_000);

    test("the selection bar names the selected tile — its icon, name and meta — and, with nothing selected, says what to do", async () => {
        const canvas = await mountSnapGrid({ chrome: true });
        const c = canvas.container;
        const bar = () => c.querySelector<HTMLElement>("[data-snap-grid-selection]")!;
        expect([...bar().children].map((el) => el.textContent)).toEqual(["No selection", "Click a component on the grid to arrange it"]);
        await clickTile(c, "trend");
        expect(bar().querySelector("svg")!.getAttribute("data-icon")).toBe("gauge-high");
        expect([...bar().children].map((el) => el.textContent)).toEqual(["", "Revenue trend", "trend · sales_daily"]);
        await canvas.hostSelects("board");
        expect([...bar().children].map((el) => el.textContent)).toEqual(["", "Assignment board", "board · sales_daily"]);
    }, 30_000);

    test("once the source confirms a Save the toolbar says when it saved; a Discard clears it", async () => {
        const canvas = await mountSnapGrid({ chrome: true });
        const c = canvas.container;
        const saved = () => c.querySelector("[data-snap-grid-saved]")?.textContent;
        expect(saved()).toBeUndefined();
        await drop(tileEl(c, "board"), gapEl(c, 0));
        await history(canvas, "Save");
        await canvas.confirm();
        expect(saved()).toMatch(/^Saved · \d\d:\d\d$/);
        expect(toolbarItems(c).slice(0, 3)).toEqual(["start-0", "grid", "saved"]);
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        await history(canvas, "Discard");
        expect(saved()).toBeUndefined();
    }, 30_000);

    test("the panes sit beside the canvas column, under the toolbar", async () => {
        const canvas = await mountSnapGrid({ chrome: true });
        const c = canvas.container;
        const editor = c.querySelector<HTMLElement>("[data-snap-grid-editor]")!;
        // The canvas's frame is the builder frame (#1125), the editor's first child.
        const frame = editor.firstElementChild as HTMLElement;
        expect(frame.hasAttribute("data-builder-frame")).toBe(true);
        const [row, banners, body] = [...frame.children] as HTMLElement[];
        expect(row!.getAttribute("data-frame-slot")).toBe("toolbar");
        // The session's banners under the toolbar, the frame's full width.
        expect(banners!.getAttribute("data-frame-slot")).toBe("banners");
        expect([...body!.children].map((el) => el.getAttribute("data-frame-slot"))).toEqual(["start", "main", "end"]);
        // The SnapGrid's own East panes, each placed as it is.
        expect(body!.querySelector('[data-frame-slot="start"]')!.textContent).toBe("Palette");
        expect(body!.querySelector('[data-frame-slot="end"]')!.textContent).toBe("Inspector");
        // The selection bar sits over the canvas only, not the panes.
        expect(body!.querySelector('[data-frame-slot="main"] > [data-snap-grid-main] > [data-snap-grid-selection]')).not.toBeNull();
    }, 30_000);

    test("what a host says over the canvas stands in the frame's banners slot under the toolbar, as every builder's banners do — never over the toolbar (#1673)", async () => {
        const canvas = await mountSnapGrid({ chrome: true, banners: <div data-testid="host-banner">Pick a tile</div> });
        const frame = canvas.container.querySelector<HTMLElement>("[data-snap-grid-editor]")!.firstElementChild as HTMLElement;
        const [row, banners] = [...frame.children] as HTMLElement[];
        expect([row!.getAttribute("data-frame-slot"), banners!.getAttribute("data-frame-slot")]).toEqual(["toolbar", "banners"]);
        expect([banners!.querySelector("[data-testid=host-banner]")?.textContent, row!.querySelector("[data-testid=host-banner]")]).toEqual(["Pick a tile", null]);
    }, 30_000);
});

describe("at a phone's design width (#1673)", () => {
    /** The canvas with Mobile pressed: its design width a phone's. */
    async function onMobile(): Promise<EditingSnapGrid> {
        const canvas = await mountSnapGrid({ chrome: true });
        await act(async () => { fireEvent.click(canvas.getByRole("button", { name: "Mobile" })); });
        await settle();
        return canvas;
    }
    /** Whether the canvas stands stacked, and the design width it draws at. */
    const laidOut = (c: HTMLElement) => {
        const el = c.querySelector<HTMLElement>("[data-snap-grid-canvas]")!;
        return { stacked: el.hasAttribute("data-stacked"), width: el.style.maxWidth };
    };
    /** The tiles a pointer picks up. */
    const draggable = (c: HTMLElement) => SEED.filter((t) => tileEl(c, t.id).hasAttribute("data-draggable")).map((t) => t.id);

    test("Mobile lays the page out as a phone shows it — stacked at 390px, no column ruler, nothing to pick up — and Desktop puts it back on its columns", async () => {
        const canvas = await onMobile();
        const c = canvas.container;
        expect(canvas.boundView()).toEqual({ width: "390px", zoom: null });
        expect(laidOut(c)).toEqual({ stacked: true, width: "390px" });
        expect(c.querySelector("[data-snap-grid-ruler], [data-snap-grid-bands]")).toBeNull();
        expect(draggable(c)).toEqual([]);
        // The rows as the page holds them: a phone only stacks them, and pressing Mobile is no gesture.
        expect([rowsDrawn(c), canvas.patches.length]).toEqual([SEED_ROWS, 0]);
        await act(async () => { fireEvent.click(canvas.getByRole("button", { name: "Desktop" })); });
        expect([laidOut(c), c.querySelector("[data-snap-grid-ruler]") !== null, draggable(c)])
            .toEqual([{ stacked: false, width: "1440px" }, true, ["kpi", "trend", "region", "board"]]);
    }, 30_000);

    test("a tile is selected there, wearing its badge and its toolbar but no handles; [ and ] leave its span, and up and down step through the column", async () => {
        const canvas = await onMobile();
        const c = canvas.container;
        await clickTile(c, "trend");
        const tile = tileEl(c, "trend");
        expect([selectedTile(c), tile.querySelector("[data-handle]"), tile.querySelector("[data-snap-grid-badge]")!.textContent, tile.querySelector("[data-snap-grid-tile-bar]") !== null])
            .toEqual(["trend", null, "Revenue trend · 8/12", true]);
        await key(c, { key: "]" }, "trend");
        await key(c, { key: "[" }, "trend");
        expect([spanOf(c, "trend"), canvas.patches.length]).toEqual([8, 0]);
        // One column in reading order: down from the trend to the breakdown a desktop draws beside it.
        await key(c, { key: "ArrowDown" }, "trend");
        expect(selectedTile(c)).toBe("region");
        await key(c, { key: "ArrowDown" }, "region");
        await key(c, { key: "ArrowLeft" }, "board");
        await key(c, { key: "ArrowRight" }, "board");
        expect(selectedTile(c)).toBe("board");
        await key(c, { key: "ArrowUp" }, "board");
        expect([selectedTile(c), announced(c)]).toEqual(["region", "Selected Breakdown bars"]);
        // Removing a tile is a phone's gesture too.
        await key(c, { key: "Delete" }, "region");
        expect(rowsDrawn(c)).toEqual([["kpi"], ["trend"], ["board"]]);
        expect(labels(canvas)).toEqual(["Remove Breakdown bars"]);
    }, 30_000);

    test("a card lands only between rows, a row of its own: resting in a row it is refused (⊘) and nothing is drafted; in the gap it makes a new row there", async () => {
        const canvas = await onMobile();
        const c = canvas.container;
        layOut(layRows(c));
        const charts = c.querySelector<HTMLElement>('[data-snap-grid-row="charts"]')!;
        const letGo = await hold(canvas.getByTestId("card-orders"), charts, { x: 1000, y: 160 });
        expect(charts.hasAttribute("data-drop-invalid")).toBe(true);
        await letGo();
        expect(canvas.patches).toHaveLength(0);
        await drop(canvas.getByTestId("card-orders"), gapEl(c, 1));
        expect(rowsDrawn(c)).toEqual([["kpi"], ["orders-1"], ["trend", "region"], ["board"]]);
        expect(labels(canvas)).toEqual(["Add orders"]);
    }, 30_000);
});

describe("the toolbar folded into chips (#1229)", () => {
    // jsdom lays nothing out: the row's box is `row.px`, an item's width is its
    // form's in FORM_PX (a hidden form has no box), and the gap is 10px. The
    // row's ResizeObserver is captured, so a test moves its width as a browser does.
    const row = { px: 0 };
    /** Each item's width in each of its forms, widest first. */
    const FORM_PX: Record<string, readonly number[]> = {
        "start-0": [57], grid: [110], readout: [62], zoom: [100, 45], rule: [1], history: [300, 136], widths: [150, 72], "end-0": [60],
    };
    const observers: { cb: ResizeObserverCallback; targets: Set<Element> }[] = [];
    class CapturingObserver {
        private readonly entry: { cb: ResizeObserverCallback; targets: Set<Element> };
        constructor(cb: ResizeObserverCallback) { this.entry = { cb, targets: new Set() }; observers.push(this.entry); }
        observe(el: Element) { this.entry.targets.add(el); }
        unobserve(el: Element) { this.entry.targets.delete(el); }
        disconnect() { this.entry.targets.clear(); }
    }
    const widthOf = (el: Element): number => {
        if (el.hasAttribute("data-toolbar")) return row.px;
        const key = el.getAttribute("data-toolbar-item");
        return key === null ? 0 : FORM_PX[key]?.[Number(el.getAttribute("data-toolbar-form"))] ?? 0;
    };
    const realRect = Element.prototype.getBoundingClientRect;
    const realObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    beforeAll(() => {
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = CapturingObserver;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            const width = widthOf(this);
            return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
        };
    });
    beforeEach(() => {
        const computed = window.getComputedStyle.bind(window);
        vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
            const style = computed(el, pseudo);
            if (!el.hasAttribute("data-toolbar")) return style;
            return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
        });
    });
    afterAll(() => {
        Element.prototype.getBoundingClientRect = realRect;
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realObserver;
    });

    /** Move the row's width and deliver it as the browser does. */
    function resize(px: number) {
        row.px = px;
        act(() => {
            for (const o of observers) {
                const rowEl = [...o.targets].find((t) => t.hasAttribute("data-toolbar") && t.isConnected);
                if (rowEl !== undefined) o.cb([{ target: rowEl } as ResizeObserverEntry], {} as ResizeObserver);
            }
        });
    }
    /** The frame's toolbar row. */
    const bar = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-frame-slot=toolbar] [data-toolbar]")!;
    /** Each item's form of its forms, as the toolbar says it folded them. */
    const stateOf = (c: HTMLElement) => new Map(bar(c).getAttribute("data-toolbar-state")!.split(";").map((part) => {
        const [key, of] = part.split("=");
        return [key!, Number(of!.split("/")[0])] as const;
    }));
    /** The row a configuration needs: every drawn form's width, and a 10px gap between drawn items. */
    function needs(forms: ReadonlyMap<string, number>): number {
        const drawn = [...forms].flatMap(([key, form]) => {
            const px = FORM_PX[key]![form];
            return px === undefined ? [] : [px];
        });
        return drawn.reduce((a, b) => a + b, 0) + 10 * Math.max(0, drawn.length - 1);
    }
    /** The ladder, move by move — the View chip's bundle one move of two steps. */
    const MOVES: ReadonlyArray<ReadonlyArray<readonly [string, number]>> = [
        [["grid", 1]], [["readout", 1]], [["widths", 1]], [["zoom", 1], ["widths", 2]], [["start-0", 1]], [["history", 1]],
    ];
    /** The open menu's items: each one's role, its words and whether it is checked. */
    const menuItems = () => [...document.querySelectorAll("[role=menuitem], [role=menuitemradio]")].map((el) =>
        `${el.getAttribute("role")}:${el.textContent}${el.getAttribute("aria-checked") === "true" ? " (checked)" : ""}`);
    /** Opens the chip's menu, once its items show. */
    async function openMenu(chip: HTMLElement) {
        await act(async () => { fireEvent.click(chip); });
        await waitFor(() => expect(document.querySelectorAll("[role=menuitem]").length).toBeGreaterThan(0));
    }
    /** An item of the open menu, by its words. */
    const menuItem = (words: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio]")]
        .find((el) => el.textContent === words)!;
    /** Picks an item as a pointer does: pressed on it, then its click. */
    async function pick(words: string) {
        const item = menuItem(words);
        await act(async () => { fireEvent.pointerDown(item); });
        await act(async () => { fireEvent.click(item); });
    }

    test("one ladder: the grid chip, the readout and the widths to their icons; then the zoom into the View chip as the widths hide, in one step; then the start items; the history last", async () => {
        row.px = 4000;
        const canvas = await mountSnapGrid({ chrome: true });
        const c = canvas.container;
        expect(bar(c).getAttribute("data-toolbar-ladder")).toBe("grid>1 readout>1 widths>1 zoom>1 widths>2 start-0>1 history>1");
        let forms = new Map([["start-0", 0], ["grid", 0], ["readout", 0], ["zoom", 0], ["rule", 0], ["history", 0], ["widths", 0], ["end-0", 0]]);
        expect(stateOf(c)).toEqual(forms);
        // Each configuration holds in exactly the row it needs, and a pixel less takes the next move — and only that.
        for (const move of MOVES) {
            const room = needs(forms);
            resize(room);
            expect(stateOf(c), `${room}px`).toEqual(forms);
            forms = new Map(forms);
            for (const [key, form] of move) forms.set(key, form);
            resize(room - 1);
            expect(stateOf(c), `${room - 1}px, ${move.map(([k, f]) => `${k}→${f}`).join(" + ")}`).toEqual(forms);
        }
        // Folded all the way: the View chip, the rule, the history's buttons and the host's end item.
        expect([...bar(c).querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"))).toEqual(["zoom", "rule", "history", "end-0"]);
        expect(bar(c).querySelector("[data-snap-grid-view]")!.getAttribute("aria-label")).toBe("View");
        expect(bar(c).querySelector("[data-snap-grid-zoom]")).toBeNull();
    }, 30_000);

    test("the View chip's menu does what the zoom and the widths do: Zoom out and Zoom in step by 10% and leave it open; a width is a choice of one, and closes it", async () => {
        row.px = 1;
        const canvas = await mountSnapGrid({ chrome: true });
        const chip = bar(canvas.container).querySelector<HTMLElement>("[data-snap-grid-view]")!;
        // The chip is Font Awesome's eye and its caret, never a written ▾ (#1263).
        expect([chip.textContent, faIcons(chip, "eye").length, faIcons(chip, "caret-down").length]).toEqual(["", 1, 1]);
        await openMenu(chip);
        expect(menuItems()).toEqual(["menuitem:Zoom out", "menuitem:Zoom in", "menuitemradio:Desktop (checked)", "menuitemradio:Tablet", "menuitemradio:Mobile"]);
        const zoomShown = () => document.querySelector("[data-snap-grid-view-zoom]")!.textContent;
        expect(zoomShown()).toBe("100%");
        await pick("Zoom in");
        expect(canvas.boundView()).toEqual({ width: null, zoom: 1.1 });
        expect(zoomShown()).toBe("110%");
        expect(chip.getAttribute("aria-expanded")).toBe("true");
        await pick("Zoom out");
        await pick("Zoom out");
        expect(canvas.boundView().zoom).toBe(0.9);
        expect(zoomShown()).toBe("90%");
        await pick("Tablet");
        expect(canvas.boundView()).toEqual({ width: "1024px", zoom: 0.9 });
        await waitFor(() => expect(chip.getAttribute("aria-expanded")).toBe("false"));
        expect(canvas.container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style.maxWidth).toBe("1024px");
        // Nothing the view holds is a gesture.
        expect(canvas.patches).toHaveLength(0);
    }, 30_000);

    test("while the View chip's menu is open the row keeps its configuration: the widths never unfold beside it", async () => {
        row.px = 1;
        const canvas = await mountSnapGrid({ chrome: true });
        const chip = bar(canvas.container).querySelector<HTMLElement>("[data-snap-grid-view]")!;
        await openMenu(chip);
        resize(4000);
        expect(stateOf(canvas.container).get("zoom")).toBe(1);
        expect(stateOf(canvas.container).get("widths")).toBe(2);
        // Its own items unfold around it: they share no bundle with it.
        expect(stateOf(canvas.container).get("grid")).toBe(0);
        // Closed — the chip pressed again — the row takes the configuration for its width.
        await act(async () => { fireEvent.click(chip); });
        await waitFor(() => expect(chip.getAttribute("aria-expanded")).toBe("false"));
        resize(4000);
        expect(stateOf(canvas.container).get("zoom")).toBe(0);
        expect(stateOf(canvas.container).get("widths")).toBe(0);
    }, 30_000);
});
