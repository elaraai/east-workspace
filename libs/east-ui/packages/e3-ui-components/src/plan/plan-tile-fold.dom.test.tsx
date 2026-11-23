/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A bucket cell's tiles in its slots (#1735, #1267): the day's room in its
 * lane's, every edge on a whole pixel of the plot its row measures; one tile
 * takes the day, two halves, three or four quarters, from five three and a
 * `+n` in the last quarter — named for what it holds and where — whose menu
 * lists the rest by their tiles' names; a pick keeps the tile in a slot,
 * focuses it and opens its popover. A folded tile is out of the row's walk,
 * which reaches the chip in its place. Narrow days keep the floor: slots under
 * it give way to fewer, the `+n` taking the rest. The slots follow the plot as
 * it resizes, and an open menu stays open through it. A day of one slot shows
 * a kept tile alone until it is let go. A cell with no room for one of its
 * several tiles draws its chip alone across the day, listing every tile, and a
 * pick opens the tile's popover hung from the chip (#1276); a lone tile there
 * draws as a mark across the cell, its click its own (#1710). jsdom lays
 * nothing out: the plot measures as the stand-in layout below says.
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
    status: none, color: none, colorPalette: none, stretch: none, content: none, animation: none,
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
        slice: none, nested: none, footer: [], id: none, sources: [], editing: none, canDrop: none,
        onSelect: none, onElementClick: none, onGroupToggle: none, onGrainChange: none, ui: none, style: none,
    } as unknown as PlanRootValue;
}

/** The van's tiles: three in Jul 6's day, then one alone in Jul 20's. */
const VAN = planRow("van", variant("buckets", {
    lanes: [], markers: [],
    events: [
        tile("a", 1, "ALPHA"),
        tile("b", 1, undefined, variant("proposed", variant("recommended", null))),
        tile("c", 1, "S-A"),
        tile("d", 3, "DELTA"),
    ],
}));

/** The yard's six tiles in Jul 6's day. */
const YARD = planRow("van", variant("buckets", {
    lanes: [], markers: [],
    events: ["u", "v", "w", "x", "y", "z"].map((key) => tile(key, 1, key.toUpperCase())),
}));

/** The plot as the stand-in layout gives it: twelve weekly days at a pitch, a buckets row of one lane less its rule. */
let plot = { width: 12 * 132, height: 24 };
/** A day's pitch, as the stand-in plot gives it. */
const pitched = (pitch: number) => { plot = { width: 12 * pitch, height: 24 }; };
/** Each ResizeObserver's callback and what it observes: a row's measure is called as the plot changes, with an entry
 *  for each element it observes, as a browser delivers them. */
const observers: Array<{ callback: (entries: { target: Element }[]) => void; targets: Element[] }> = [];
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
    observer: (globalThis as { ResizeObserver?: unknown }).ResizeObserver,
};

beforeEach(() => {
    initializeStore(new UIStore());
    pitched(132);
    observers.length = 0;
    watched.length = 0;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IntersectionObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const { width, height } = this.matches("[data-plan-cells-measure]") ? plot : { width: 0, height: 0 };
        return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    };
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        private readonly observer: { callback: (entries: { target: Element }[]) => void; targets: Element[] };
        constructor(callback: (entries: { target: Element }[]) => void) { this.observer = { callback, targets: [] }; observers.push(this.observer); }
        observe(target: Element) { this.observer.targets.push(target); }
        unobserve(target: Element) { this.observer.targets.splice(this.observer.targets.indexOf(target), 1); }
        disconnect() { this.observer.targets.length = 0; }
    };
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    Element.prototype.getBoundingClientRect = saved.rect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved.observer;
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

/** The plot has resized: the rows' measures hear it, as the layout would tell them. */
const resized = async () => {
    await act(async () => {
        for (const { callback, targets } of observers) {
            const measured = targets.filter((el) => el.matches("[data-plan-cells-measure]"));
            if (measured.length > 0) callback(measured.map((target) => ({ target })));
        }
    });
};

/** A resolver opening a body named after an event tile's ref. */
const popover = (ref: PlanElementRefValue) =>
    (ref.type === "event" ? some(variant("Text", { value: `POP · ${ref.value.event}`, style: none })) : none);

const renderPlan = (key: string, row: PlanWireRow = VAN, withPopover = true) => render(
    <ChakraProvider value={system}>
        <EastChakraPlan value={planRoot([row], withPopover ? popover : undefined)} storageKey={key} />
    </ChakraProvider>,
);

const cellAt = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`${rowSel("van")} [data-plan-cell="${key}"]`)!;
/** Jul 6's cell as it draws: the tiles that show, by key, the folded ones, and its chip's words and name. */
function cellOf(container: HTMLElement, key = "1:0") {
    const cell = cellAt(container, key);
    const tiles = [...cell.querySelectorAll<HTMLElement>("[data-event]")];
    const chip = cell.querySelector<HTMLElement>("[data-tile-more]");
    return {
        shown: tiles.filter((el) => !el.hasAttribute("data-folded")).map((el) => el.getAttribute("data-event")),
        folded: tiles.filter((el) => el.hasAttribute("data-folded")).map((el) => el.getAttribute("data-event")),
        chip: chip === null ? null : [chip.textContent, chip.getAttribute("aria-label")],
    };
}
/** Where a cell's shown tiles stand: each one's key, left and width, as its slot sets them. */
const placesOf = (container: HTMLElement, key: string) => [...cellAt(container, key).querySelectorAll<HTMLElement>("[data-event]:not([data-folded])")]
    .map((el) => [el.getAttribute("data-event"), el.style.left, el.style.width]);
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

describe("a bucket cell's tiles in its slots (#1735)", () => {
    test("at B 132, three tiles take quarters 2px in and 5 apart, a lone tile the day; the cell is the day's room, its rule its last pixel, in a lane of 24", () => {
        const { container } = renderPlan("plan-1735-slots");
        expect(cellOf(container)).toEqual({ shown: ["a", "b", "c"], folded: [], chip: null });
        expect(placesOf(container, "1:0")).toEqual([["a", "2px", "28px"], ["b", "35px", "28px"], ["c", "68px", "28px"]]);
        expect(placesOf(container, "3:0")).toEqual([["d", "2px", "127px"]]);
        const cell = cellAt(container, "1:0").style;
        expect([cell.left, cell.width, cell.top, cell.height, cell.getPropertyValue("--plan-tile-top")]).toEqual(["132px", "131px", "0px", "24px", "2px"]);
    });

    test("five or more: three tiles and a +n in the last quarter, named for what it holds and where", () => {
        const { container } = renderPlan("plan-1735-five", YARD);
        expect(cellOf(container)).toEqual({ shown: ["u", "v", "w"], folded: ["x", "y", "z"], chip: ["+3", "3 more events, Week of Jul 6, 2026"] });
        expect([chipOf(container).style.left, chipOf(container).style.width]).toEqual(["101px", "28px"]);
    });

    test("narrow days keep the floor: at B 90 the three are one and a +2 in halves; at B 40 the +3 alone, every event in it, none more than another (#1680's review)", () => {
        pitched(90);
        const { container } = renderPlan("plan-1735-halves");
        expect(cellOf(container)).toEqual({ shown: ["a"], folded: ["b", "c"], chip: ["+2", "2 more events, Week of Jul 6, 2026"] });
        expect(placesOf(container, "1:0")).toEqual([["a", "2px", "40px"]]);
        expect([chipOf(container).style.left, chipOf(container).style.width]).toEqual(["47px", "40px"]);
        cleanup();
        pitched(40);
        const narrow = renderPlan("plan-1735-alone");
        expect(cellOf(narrow.container)).toEqual({ shown: [], folded: ["a", "b", "c"], chip: ["+3", "3 events, Week of Jul 6, 2026"] });
    });

    test("the menu lists the folded tiles by their names; a pick keeps the tile in a slot, focuses it and opens its popover", async () => {
        pitched(90);
        const { container } = renderPlan("plan-1267-pick");
        await openMenu(container);
        expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
            "Event, Week of Jul 6, 2026, recommended",
            "S-A, Week of Jul 6, 2026, confirmed",
        ]);
        await pick(/^S-A/);
        // S-A takes the one slot beside the chip; ALPHA folds.
        await waitFor(() => expect(cellOf(container).shown).toEqual(["c"]));
        expect(cellOf(container)).toEqual({ shown: ["c"], folded: ["a", "b"], chip: ["+2", "2 more events, Week of Jul 6, 2026"] });
        await waitFor(() => expect(document.activeElement).toBe(tileOf(container, "c")));
        expect(await screen.findByText("POP · c")).toBeTruthy();
    });

    test("a folded tile is out of the row's walk, and the chip stands in it where the tiles it folds would be", async () => {
        pitched(90);
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

    test("the slots follow the plot: wider, every tile shows and the chip goes; narrower again, they fold — and an open menu stays open while its chip stands", async () => {
        pitched(90);
        const { container } = renderPlan("plan-1735-resize");
        expect(cellOf(container).chip).toEqual(["+2", "2 more events, Week of Jul 6, 2026"]);
        pitched(132);
        await resized();
        expect(cellOf(container)).toEqual({ shown: ["a", "b", "c"], folded: [], chip: null });
        pitched(90);
        await resized();
        expect(cellOf(container).shown).toEqual(["a"]);
        await openMenu(container);
        const items = ["Event, Week of Jul 6, 2026, recommended", "S-A, Week of Jul 6, 2026, confirmed"];
        const menu = () => ({
            open: chipOf(container)?.getAttribute("aria-expanded") ?? null,
            items: screen.queryAllByRole("menuitem").map((item) => item.textContent),
        });
        expect(menu()).toEqual({ open: "true", items });
        pitched(95);
        await resized();
        expect(menu()).toEqual({ open: "true", items });
    });

    test("a day with no room for one tile: several fold into its chip alone, across the day, which lists every tile and a pick opens the tile's popover hung from the chip (#1276); a lone tile draws as a mark across its day — the tile itself, never a count of one, its click its popover (#1710)", async () => {
        pitched(7);
        const { container } = renderPlan("plan-1276-no-room");
        // Jul 6's three tiles: every one folds into the chip, the cell's one part, kept or not.
        expect(cellOf(container)).toEqual({ shown: [], folded: ["a", "b", "c"], chip: ["+3", "3 events, Week of Jul 6, 2026"] });
        const chip = chipOf(container);
        expect(chip.hasAttribute("data-no-room")).toBe(true);
        await openMenu(container);
        await pick(/^ALPHA/);
        expect(await screen.findByText("POP · a")).toBeTruthy();
        // ALPHA, which cannot draw beside the others, stays folded; its popover watches the chip, which it hangs from.
        expect(tileOf(container, "a").hasAttribute("data-folded")).toBe(true);
        expect(watched.at(-1)).toBe(chip);
        // DELTA alone in Jul 20's day: no chip, the tile drawn as the cell's mark.
        const lone = cellAt(container, "3:0");
        expect(lone.querySelector("[data-tile-more]")).toBeNull();
        expect(lone.querySelector("[data-plan-cell-tiles]")!.hasAttribute("data-no-room")).toBe(true);
        expect(tileOf(container, "d").hasAttribute("data-folded")).toBe(false);
        // Its click is the tile's own: its popover, which watches the tile.
        await act(async () => { fireEvent.click(tileOf(container, "d")); });
        expect(await screen.findByText("POP · d")).toBeTruthy();
        expect(watched.at(-1)).toBe(tileOf(container, "d"));
    });

    test("on a day of one slot, a kept tile stands alone while the chip waits; let go, it folds and hands the focus to the chip", async () => {
        pitched(40);
        const { container } = renderPlan("plan-1267-alone");
        expect(cellOf(container).chip).toEqual(["+3", "3 events, Week of Jul 6, 2026"]);
        await openMenu(container);
        await pick(/^ALPHA/);
        await waitFor(() => expect(cellOf(container)).toEqual({ shown: ["a"], folded: ["b", "c"], chip: null }));
        expect(placesOf(container, "1:0")).toEqual([["a", "2px", "35px"]]);
        await waitFor(() => expect(document.activeElement).toBe(tileOf(container, "a")));
        expect(await screen.findByText("POP · a")).toBeTruthy();
        // Esc closes the popover and hands the focus back to ALPHA, which the cell no longer keeps: it folds, and
        // the chip, back, takes the focus.
        fireEvent.keyDown(tileOf(container, "a"), { key: "Escape" });
        await waitFor(() => expect(cellOf(container).chip).toEqual(["+3", "3 events, Week of Jul 6, 2026"]));
        expect(document.activeElement).toBe(chipOf(container));
    });
});

/** A stand-in controller whose selection holds `elements` — what a click on an event kind's tile selects (#1197). */
const selecting = (elements: readonly string[]): PlanController => ({
    subscribe: () => () => undefined,
    getSnapshot: () => ({ store: { ui: { elements } }, overlay: { popover: null } }),
}) as unknown as PlanController;

/** A tile as the cell draws it, by its key. */
const standIn = (key: string): BucketCellTile => ({
    key,
    name: key.toUpperCase(),
    draw: (folded, place) => <div key={key} data-event={key} data-folded={folded ? "" : undefined} style={place} tabIndex={-1} role="button" />,
});

describe("a bucket cell keeps a selected event's tile in a slot (#1267)", () => {
    test("a tile the canvas has selected — an event kind's — never folds: it takes its slot first", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <PlanControllerContext.Provider value={selecting(["b"])}>
                    <BucketCell styles={{}} rowKey="van" cellKey="1:0" place={{}} over={undefined}
                        tiles={["a", "b", "c"].map(standIn)} marker={null} folds pitch={90} frac={0} bucket="Week of Jul 6, 2026"
                        lane={undefined} words={PLAN_WORDS} onClick={() => undefined} />
                </PlanControllerContext.Provider>
            </ChakraProvider>,
        );
        // Halves at B 90: B in the one slot beside the chip, A and C in it.
        expect([...container.querySelectorAll("[data-event]:not([data-folded])")].map((el) => el.getAttribute("data-event"))).toEqual(["b"]);
        expect(container.querySelector("[data-tile-more]")?.textContent).toBe("+2");
    });
});
