/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A bucket cell with more tiles than it has room for (#1267): the tiles that
 * fit, each drawn whole, then a `+n` chip counting the rest, named for what it
 * holds and where; its menu lists them by their tiles' names, and a pick keeps
 * the tile on the cell's run, focuses it and opens its popover. A folded tile
 * is out of the row's walk, which reaches the chip in its place. The fold is
 * measured again as the room changes, and an open menu stays open through it.
 * A cell with no room beside the chip for a kept tile's floor shows the kept
 * tile alone until it is let go. A cell with no room for one tile draws none:
 * its chip alone, across the cell, lists every tile, and a pick opens the
 * tile's popover hung from the chip (#1276). jsdom lays nothing out: the
 * tiles, the chip's stand-in and the room measure as the stand-in layout below
 * says.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { system, UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import type { PlanElementRefValue } from "./context.js";
import { oneBlock, rowId, rowSel } from "./plan.test-utils.js";
import { BucketCell, type BucketCellTile } from "./rows/BucketCell.js";
import { PlanControllerContext } from "./controller/react.js";
import type { PlanController } from "./controller/index.js";
import { PLAN_WORDS } from "./words.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const week = (n: number) => new Date(W27.getTime() + n * 7 * 86_400_000);
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;

/** A tile: its key, the week it sits in, its label (none, a proposal's `plan`) and its state. */
const tile = (key: string, at: number, label: string | undefined, state: unknown = variant("confirmed", null)) => ({
    key, at: t(week(at)), lane: none, label: label !== undefined ? some(label) : none, icon: none, state,
    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none,
});

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown): PlanWireRow {
    return {
        id: rowId(key), parent: none,
        gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind, collapsed: false, pinned: false, height: none, status: none, expand: none,
    } as unknown as PlanWireRow;
}

function planRoot(rows: PlanWireRow[], popover?: unknown): PlanRootValue {
    return {
        rows: variant("inline", oneBlock(rows)),
        links: [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [], now: none, format: none,
        }),
        grain: none,
        popover: popover !== undefined ? some(popover) : none,
        hover: none, expandRender: none, expandGutter: none, pick: none,
        slice: none, footer: [], id: none, sources: [], editing: none, canDrop: none,
        onSelect: none, onElementClick: none, onGroupToggle: none, onGrainChange: none, ui: none, style: none,
    } as unknown as PlanRootValue;
}

/** The van's tiles: three in Jul 6's cell, then one alone in Jul 20's. */
const VAN = planRow("van", variant("buckets", {
    lanes: [], markers: [],
    events: [
        tile("a", 1, "ALPHA"),
        tile("b", 1, undefined, variant("proposed", variant("recommended", null))),
        tile("c", 1, "S-A"),
        tile("d", 3, "DELTA"),
    ],
}));

/** Each tile's width drawn whole, in the stand-in layout; the chip's stand-in 24px; the tiles 5px apart. */
const WIDTHS: Readonly<Record<string, number>> = { a: 40, b: 45, c: 28, d: 50 };
const CHIP = 24;
/** The widths the stand-in layout draws the tiles at now — {@link WIDTHS} until a test's font arrives. */
let widths: Readonly<Record<string, number>> = WIDTHS;

/** The room each cell's tiles have, as the stand-in layout gives it. */
let room = 200;
/** Each ResizeObserver's callback and what it observes: a cell's is called as its room changes. */
const observers: Array<{ callback: () => void; targets: Element[] }> = [];
/** The page's fonts: jsdom has none, so a cell hears this stand-in's `loadingdone`. */
let fonts = new EventTarget();
/** What the canvas's IntersectionObservers watch — an open popover's anchor among them. */
const watched: Element[] = [];
/** Every IntersectionObserver the canvas creates — a popover watches its anchor with one. */
class IntersectionObserverStub {
    observe(target: Element) { watched.push(target); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
}
const saved = {
    rect: Element.prototype.getBoundingClientRect,
    computed: window.getComputedStyle,
    observer: (globalThis as { ResizeObserver?: unknown }).ResizeObserver,
};

beforeEach(() => {
    initializeStore(new UIStore());
    room = 200;
    widths = WIDTHS;
    observers.length = 0;
    watched.length = 0;
    fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IntersectionObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = this.matches("[data-plan-cell-tiles]") ? room
            : this.matches("[data-event]") ? widths[this.getAttribute("data-event") ?? ""] ?? 0
                : this.matches("[data-tile-more-measure]") ? CHIP : 0;
        return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect;
    };
    window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
        const style = saved.computed.call(window, el, pseudo);
        if (!el.matches("[data-plan-cell-tiles]")) return style;
        return new Proxy(style, {
            get: (target, prop) => {
                if (prop === "columnGap") return "5px";
                const value = Reflect.get(target, prop) as unknown;
                return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
            },
        });
    }) as typeof window.getComputedStyle;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        private readonly observer: { callback: () => void; targets: Element[] };
        constructor(callback: () => void) { this.observer = { callback, targets: [] }; observers.push(this.observer); }
        observe(target: Element) { this.observer.targets.push(target); }
        unobserve() {}
        disconnect() { this.observer.targets.length = 0; }
    };
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    Element.prototype.getBoundingClientRect = saved.rect;
    window.getComputedStyle = saved.computed;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved.observer;
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    Reflect.deleteProperty(document, "fonts");
});

/** The cells' room has changed: their observers hear it, as the layout would tell them. */
const resized = async () => {
    await act(async () => {
        for (const { callback, targets } of observers) if (targets.some((el) => el.matches("[data-plan-cell-tiles]"))) callback();
    });
};

/** A resolver opening a body named after an event tile's ref. */
const popover = (ref: PlanElementRefValue) =>
    (ref.type === "event" ? some(variant("Text", { value: `POP · ${ref.value.event}`, style: none })) : none);

const renderPlan = (key: string, withPopover = true) => render(
    <ChakraProvider value={system}>
        <EastChakraPlan value={planRoot([VAN], withPopover ? popover : undefined)} storageKey={key} />
    </ChakraProvider>,
);

/** Jul 6's cell as it draws: the tiles that show, by key, the folded ones, and its chip's words and name. */
function cellOf(container: HTMLElement) {
    const cell = container.querySelector<HTMLElement>(`${rowSel("van")} [data-plan-cell="1:0"]`)!;
    const tiles = [...cell.querySelectorAll<HTMLElement>("[data-event]")];
    const chip = cell.querySelector<HTMLElement>("[data-tile-more]");
    return {
        shown: tiles.filter((el) => !el.hasAttribute("data-folded")).map((el) => el.getAttribute("data-event")),
        folded: tiles.filter((el) => el.hasAttribute("data-folded")).map((el) => el.getAttribute("data-event")),
        chip: chip === null ? null : [chip.textContent, chip.getAttribute("aria-label")],
        measuring: cell.querySelector("[data-tile-more-measure]") !== null,
    };
}
const chipOf = (container: HTMLElement) => container.querySelector<HTMLElement>(`${rowSel("van")} [data-tile-more]`)!;
const tileOf = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`${rowSel("van")} [data-event="${key}"]`)!;
/** Opens the chip's menu. */
const openMenu = async (container: HTMLElement) => { await act(async () => { fireEvent.click(chipOf(container)); }); };
/** Picks a tile from the open menu as a pointer does: pressed on the item, then its click. */
const pick = async (name: RegExp) => {
    const item = screen.getByRole("menuitem", { name });
    await act(async () => { fireEvent.pointerDown(item); });
    await act(async () => { fireEvent.click(item); });
};

describe("a bucket cell with more tiles than room (#1267)", () => {
    test("a cell its tiles fit draws every tile and no chip; a lone tile with room for it never folds", () => {
        const { container } = renderPlan("plan-1267-fit");
        expect(cellOf(container)).toEqual({ shown: ["a", "b", "c"], folded: [], chip: null, measuring: false });
        room = 10;
        const narrow = renderPlan("plan-1267-lone");
        expect(narrow.container.querySelectorAll(`${rowSel("van")} [data-event="d"][data-folded]`)).toHaveLength(0);
    });

    test("short of room, the run that fits beside the chip shows and the chip counts the rest, named for what it holds and where", () => {
        // Beside the chip: 90 less 24 and its gap, 61 — ALPHA (40) fits; the proposal after it does not.
        room = 90;
        const { container } = renderPlan("plan-1267-fold");
        expect(cellOf(container)).toEqual({
            shown: ["a"], folded: ["b", "c"], chip: ["+2", "2 more events, Week of Jul 6, 2026"], measuring: false,
        });
    });

    test("with no room for any tile beside it, the chip alone counts them all", () => {
        room = 40;
        const { container } = renderPlan("plan-1267-chip-alone");
        expect(cellOf(container)).toEqual({
            shown: [], folded: ["a", "b", "c"], chip: ["+3", "3 more events, Week of Jul 6, 2026"], measuring: false,
        });
    });

    test("the menu lists the folded tiles by their names; a pick keeps the tile on the run, focuses it and opens its popover", async () => {
        room = 90;
        const { container } = renderPlan("plan-1267-pick");
        await openMenu(container);
        expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
            "Event, Week of Jul 6, 2026, recommended",
            "S-A, Week of Jul 6, 2026, confirmed",
        ]);
        await pick(/^S-A/);
        // S-A takes its place first; ALPHA after it no longer fits beside the chip.
        await waitFor(() => expect(cellOf(container).shown).toEqual(["c"]));
        expect(cellOf(container)).toEqual({
            shown: ["c"], folded: ["a", "b"], chip: ["+2", "2 more events, Week of Jul 6, 2026"], measuring: false,
        });
        await waitFor(() => expect(document.activeElement).toBe(tileOf(container, "c")));
        expect(await screen.findByText("POP · c")).toBeTruthy();
    });

    test("a folded tile is out of the row's walk, and the chip stands in it where the tiles it folds would be", async () => {
        room = 90;
        const { container } = renderPlan("plan-1267-walk");
        const a = tileOf(container, "a");
        act(() => a.focus());
        fireEvent.keyDown(a, { key: "ArrowRight" });
        expect(document.activeElement).toBe(chipOf(container));
        fireEvent.keyDown(chipOf(container), { key: "ArrowRight" });
        expect(document.activeElement).toBe(tileOf(container, "d"));
        fireEvent.keyDown(tileOf(container, "d"), { key: "ArrowLeft" });
        expect(document.activeElement).toBe(chipOf(container));
        fireEvent.keyDown(chipOf(container), { key: "Home" });
        expect(document.activeElement).toBe(a);
    });

    test("the fold follows the room: wider, every tile shows and the chip goes; narrower again, they fold", async () => {
        room = 90;
        const { container } = renderPlan("plan-1267-resize");
        expect(cellOf(container).chip).toEqual(["+2", "2 more events, Week of Jul 6, 2026"]);
        room = 200;
        await resized();
        expect(cellOf(container)).toEqual({ shown: ["a", "b", "c"], folded: [], chip: null, measuring: false });
        room = 90;
        await resized();
        expect(cellOf(container).shown).toEqual(["a"]);
    });

    test("a font arriving measures the cell again: tiles it draws narrower fit, and the chip goes", async () => {
        room = 90;
        const { container } = renderPlan("plan-1267-font");
        expect(cellOf(container).shown).toEqual(["a"]);
        // The face arrives and draws every tile narrower: 20 + 5 + 25 + 5 + 20 is 75, in 90 of room.
        widths = { ...WIDTHS, a: 20, b: 25, c: 20 };
        await act(async () => { fonts.dispatchEvent(new Event("loadingdone")); });
        expect(cellOf(container)).toEqual({ shown: ["a", "b", "c"], folded: [], chip: null, measuring: false });
    });

    test("an open menu stays open, with its items, as the cell measures again — a font arriving, or the room changing", async () => {
        room = 90;
        const { container } = renderPlan("plan-1267-open");
        await openMenu(container);
        const menu = () => ({
            open: chipOf(container)?.getAttribute("aria-expanded") ?? null,
            items: screen.queryAllByRole("menuitem").map((item) => item.textContent),
        });
        const items = ["Event, Week of Jul 6, 2026, recommended", "S-A, Week of Jul 6, 2026, confirmed"];
        expect(menu()).toEqual({ open: "true", items });
        await act(async () => { fonts.dispatchEvent(new Event("loadingdone")); });
        expect(menu()).toEqual({ open: "true", items });
        room = 95;
        await resized();
        expect(menu()).toEqual({ open: "true", items });
    });

    test("a cell with no room for one tile draws none: its chip alone, across the cell, lists every tile; a pick opens the tile's popover, hung from the chip (#1276)", async () => {
        room = 0;
        const { container } = renderPlan("plan-1276-no-room");
        // Jul 6's three tiles, and DELTA alone in Jul 20's cell: every one folds, kept or not.
        expect(cellOf(container)).toEqual({
            shown: [], folded: ["a", "b", "c"], chip: ["+3", "3 more events, Week of Jul 6, 2026"], measuring: false,
        });
        const lone = container.querySelector<HTMLElement>(`${rowSel("van")} [data-plan-cell="3:0"]`)!;
        const chip = lone.querySelector<HTMLElement>("[data-tile-more]")!;
        expect([chip.textContent, chip.getAttribute("aria-label")]).toEqual(["+1", "1 more event, Week of Jul 20, 2026"]);
        expect([chip.hasAttribute("data-no-room"), tileOf(container, "d").hasAttribute("data-folded")]).toEqual([true, true]);
        await act(async () => { fireEvent.click(chip); });
        expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["DELTA, Week of Jul 20, 2026, confirmed"]);
        await pick(/^DELTA/);
        expect(await screen.findByText("POP · d")).toBeTruthy();
        // DELTA, which cannot draw, stays folded; its popover watches the chip, which it hangs from.
        expect(tileOf(container, "d").hasAttribute("data-folded")).toBe(true);
        expect(watched.at(-1)).toBe(chip);
    });

    test("with no room beside the chip for a kept tile's floor, the kept tile shows alone; let go, it folds and hands the focus to the chip", async () => {
        room = 40;
        const { container } = renderPlan("plan-1267-alone");
        expect(cellOf(container).chip).toEqual(["+3", "3 more events, Week of Jul 6, 2026"]);
        await openMenu(container);
        await pick(/^ALPHA/);
        // ALPHA alone: 40 less the chip leaves no room for its 20px floor beside it.
        await waitFor(() => expect(cellOf(container)).toEqual({ shown: ["a"], folded: ["b", "c"], chip: null, measuring: false }));
        await waitFor(() => expect(document.activeElement).toBe(tileOf(container, "a")));
        expect(await screen.findByText("POP · a")).toBeTruthy();
        // Esc closes the popover and hands the focus back to ALPHA, which the cell no longer keeps: it folds, and
        // the chip, back, takes the focus.
        fireEvent.keyDown(tileOf(container, "a"), { key: "Escape" });
        await waitFor(() => expect(cellOf(container).chip).toEqual(["+3", "3 more events, Week of Jul 6, 2026"]));
        expect(document.activeElement).toBe(chipOf(container));
    });
});

/** A stand-in controller whose selection holds `elements` — what a click on an event kind's tile selects (#1197). */
const selecting = (elements: readonly string[]): PlanController => ({
    subscribe: () => () => undefined,
    getSnapshot: () => ({ store: { ui: { elements } }, overlay: { popover: null } }),
}) as unknown as PlanController;

/** A tile as the cell draws it, by its key: a button its stand-in layout sizes. */
const standIn = (key: string): BucketCellTile => ({
    key,
    name: key.toUpperCase(),
    draw: (folded) => <div key={key} data-event={key} data-folded={folded ? "" : undefined} tabIndex={-1} role="button" />,
});

describe("a bucket cell keeps a selected event's tile on its run (#1267)", () => {
    test("a tile the canvas has selected — an event kind's — never folds: it takes its place first", () => {
        room = 90;
        const { container } = render(
            <ChakraProvider value={system}>
                <PlanControllerContext.Provider value={selecting(["b"])}>
                    <BucketCell styles={{}} rowKey="van" cellKey="1:0" place={{}} over={undefined} caption={null}
                        tiles={["a", "b", "c"].map(standIn)} marker={null} folds frac={0} bucket="Week of Jul 6, 2026"
                        lane={undefined} words={PLAN_WORDS} onClick={() => undefined} signature="a|b|c" />
                </PlanControllerContext.Provider>
            </ChakraProvider>,
        );
        // B first; A after it would take 45 + 5 + 40, 90, of the 61 beside the chip.
        expect([...container.querySelectorAll("[data-event]:not([data-folded])")].map((el) => el.getAttribute("data-event"))).toEqual(["b"]);
        expect(container.querySelector("[data-tile-more]")?.textContent).toBe("+2");
    });
});
