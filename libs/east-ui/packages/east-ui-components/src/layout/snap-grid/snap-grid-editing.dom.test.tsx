/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The SnapGrid's editing canvas (#990), rule by rule: the selection the host
 * holds (L7), the span and height a handle snaps to (L8, L9), the moves and
 * the row that fits a joining tile (L10), the drop stages (L11), a dropped
 * card built by `create` and the veto (L12), the keyboard (L15), and every
 * gesture as one transaction of the shared session — undone, redone,
 * discarded and saved as one checked batch (L16). Then the builder's frame
 * (#995), laid out by the shared builder frame (#1125): the one toolbar, the
 * zoom and the design widths over a bound view, the selection bar, the saved
 * time, and the panes. Then a pane beside the
 * canvas (#996): the changes it asks for through the bound selection, each
 * one gesture by the canvas's own rules, the rows the author hears the canvas
 * draw, and the history shortcuts from a pane. Then an Apply a screen asks
 * for (#998): answered under the id asked — at once with no drafts, once the
 * source confirms them, or refused in the canvas's words. Then the toolbar a
 * row short of room folds into chips (#1229): its ladder, the View chip's
 * bundle, its menu, and its hold.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { none, some, variant } from "@elaraai/east";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { layOut } from "../../testing/drag-layer.js";
import { faIcons, loneGlyphs } from "../../testing/icons.js";
import {
    BLOCKED, SEED, type EditingSnapGrid, type TileValue,
    announced, clickTile, drop, dragHandle, endZone, gapEl, heightOf, history, historyButton, hold, hostWrites, key, layRows, marks,
    mountSnapGrid, rowsDrawn, selectedTile, spanOf, tileEl,
} from "./snap-grid-editing.test-utils.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
});

/** What each gesture was, in order. */
const origins = (canvas: EditingSnapGrid) => canvas.patches.map((p) => p.origin.type);
/** Each gesture's label, in order. */
const labels = (canvas: EditingSnapGrid) => canvas.patches.map((p) => p.label);
/** The tiles' order and rows, as the source holds them. */
const storedRows = (canvas: EditingSnapGrid) => canvas.stored().map((t) => `${t.id}@${t.row}`);

const SEED_ROWS = [["kpi"], ["trend", "region"], ["board"]];

describe("L7 — the selection", () => {
    test("a click selects the tile: the host's bound state holds it, and the tile wears its handles and its remove button", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        expect(selectedTile(c)).toBeNull();
        await clickTile(c, "trend");
        expect(selectedTile(c)).toBe("trend");
        expect(canvas.boundSelection()).toBe("trend");
        const handles = [...tileEl(c, "trend").querySelectorAll("[data-handle]")].map((h) => h.getAttribute("data-handle"));
        expect(handles).toEqual(["top-left", "top-right", "bottom-left", "both", "span", "height"]);
        expect(tileEl(c, "trend").querySelector("[data-snap-grid-remove]")!.getAttribute("aria-label")).toBe("Remove from page");
        // The others wear none.
        expect(tileEl(c, "region").querySelector("[data-handle]")).toBeNull();
        expect(announced(c)).toBe("");
    }, 30_000);

    test("the host selects through the bound state, and the canvas draws its choice", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await canvas.hostSelects("board");
        expect(selectedTile(c)).toBe("board");
        await canvas.hostSelects(null);
        expect(selectedTile(c)).toBeNull();
    }, 30_000);

    test("Esc clears the selection, and so does a click on the empty canvas", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "trend");
        await key(c, { key: "Escape" }, "trend");
        expect(selectedTile(c)).toBeNull();
        expect(canvas.boundSelection()).toBeNull();
        expect(announced(c)).toBe("Selection cleared");
        await clickTile(c, "region");
        await clickTile(c, "region");
        const empty = c.querySelector<HTMLElement>("[data-snap-grid-canvas]")!;
        await act(async () => {
            fireEvent.pointerDown(empty, { clientX: 5, clientY: 5 });
            fireEvent.click(empty, { clientX: 5, clientY: 5 });
        });
        expect(selectedTile(c)).toBeNull();
    }, 30_000);

    test("without a bound state the canvas keeps its own selection", async () => {
        const canvas = await mountSnapGrid({ bound: false });
        const c = canvas.container;
        await clickTile(c, "region");
        expect(selectedTile(c)).toBe("region");
        expect(canvas.boundSelection()).toBeNull();
    }, 30_000);
});

describe("L8 / L9 — span and height", () => {
    test("[ and ] change the span by one, held to the row's room — at least 2, at most 12 less the rest", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        expect(spanOf(c, "trend")).toBe(7);
        expect(announced(c)).toBe("Revenue trend, span 7");
        await key(c, { key: "]" }, "trend");
        expect(spanOf(c, "trend")).toBe(8);
        // The row holds 12: the breakdown's 4 leave the trend 8 at most.
        await key(c, { key: "]" }, "trend");
        expect(spanOf(c, "trend")).toBe(8);
        await clickTile(c, "region");
        for (let i = 0; i < 3; i++) await key(c, { key: "[" }, "region");
        expect(spanOf(c, "region")).toBe(2);
        // Each change one transaction; a change that changes nothing, none.
        expect(labels(canvas)).toEqual(["Resize Revenue trend", "Resize Revenue trend", "Resize Breakdown bars", "Resize Breakdown bars"]);
        expect(origins(canvas)).toEqual(["resize", "resize", "resize", "resize"]);
        expect(marks(c)).toEqual({ region: "pending" });
    }, 30_000);

    test("the right-edge handle snaps per column of the row, held to the room the row has", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "trend");
        layOut(layRows(c));
        await dragHandle(c, "trend", "span", { x: 600 });
        expect(spanOf(c, "trend")).toBe(6);
        // Past the room the breakdown leaves: held to 8.
        await dragHandle(c, "trend", "span", { x: 1100 });
        expect(spanOf(c, "trend")).toBe(8);
        expect(labels(canvas)).toEqual(["Resize Revenue trend", "Resize Revenue trend"]);
    }, 30_000);

    test("the bottom-edge handle snaps to 40px steps and never past 960; a chart tile shrinks only to its least height, and near its own it returns to auto", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "region");
        await dragHandle(c, "region", "height", { y: 210 });
        expect(heightOf(c, "region")).toBe(200);
        expect(canvas.stored().find((t) => t.id === "region")!.height).toEqual(none);
        await dragHandle(c, "region", "height", { y: 2000 });
        expect(heightOf(c, "region")).toBe(960);
        await clickTile(c, "trend");
        // The trend's least height is 120: a drag to 80 stops there.
        await dragHandle(c, "trend", "height", { y: 90 });
        expect(heightOf(c, "trend")).toBe(120);
        // Released near its content's own height, it is auto again.
        await dragHandle(c, "trend", "height", { y: 4 });
        expect(heightOf(c, "trend")).toBeNull();
        expect(labels(canvas)).toEqual(["Resize Breakdown bars", "Resize Breakdown bars", "Resize Revenue trend", "Resize Revenue trend"]);
    }, 30_000);
});

describe("L10 — moves", () => {
    test("a tile dropped on the end zone takes a row of its own at the end", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await drop(tileEl(c, "trend"), endZone(c));
        expect(rowsDrawn(c)).toEqual([["kpi"], ["region"], ["board"], ["trend"]]);
        expect(labels(canvas)).toEqual(["Move Revenue trend"]);
        expect(origins(canvas)).toEqual(["move"]);
        expect(marks(c)).toEqual({ trend: "pending" });
    }, 30_000);

    test("a tile dropped between rows takes a new row there — and a row left empty is gone", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await drop(tileEl(c, "board"), gapEl(c, 1));
        expect(rowsDrawn(c)).toEqual([["kpi"], ["board"], ["trend", "region"]]);
        await drop(tileEl(c, "kpi"), endZone(c));
        expect(rowsDrawn(c)).toEqual([["board"], ["trend", "region"], ["kpi"]]);
    }, 30_000);

    test("a tile joining a row that cannot hold it: the row rebalances evenly — ⌊12 / n⌋ each", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        layOut(layRows(c));
        // Rest beside the KPI rail, past its middle: the rail's row, after it.
        await drop(tileEl(c, "board"), c.querySelector<HTMLElement>('[data-snap-grid-row="kpis"]')!, { x: 900, y: 50 });
        expect(rowsDrawn(c)).toEqual([["kpi", "board"], ["trend", "region"]]);
        expect([spanOf(c, "kpi"), spanOf(c, "board")]).toEqual([6, 6]);
        // One gesture: the move and the spans it fitted.
        expect(labels(canvas)).toEqual(["Move Assignment board"]);
    }, 30_000);

    test("a tile joining a row with room shrinks to the free columns when that leaves it 3 or more", async () => {
        const seed: TileValue[] = [
            { id: "a", row: "top", span: 8n, height: none, minHeight: none, name: "A", align: variant("top", null) },
            { id: "b", row: "bottom", span: 6n, height: none, minHeight: none, name: "B", align: variant("top", null) },
        ];
        const canvas = await mountSnapGrid({ seed });
        const c = canvas.container;
        layOut(layRows(c));
        await drop(tileEl(c, "b"), c.querySelector<HTMLElement>('[data-snap-grid-row="top"]')!, { x: 1000, y: 50 });
        expect(rowsDrawn(c)).toEqual([["a", "b"]]);
        expect([spanOf(c, "a"), spanOf(c, "b")]).toEqual([8, 4]);
    }, 30_000);

    test("a row holds six tiles at most: a seventh is refused where it rests (⊘), and nothing is drafted", async () => {
        const seed: TileValue[] = [
            ...Array.from({ length: 6 }, (_u, i): TileValue => ({ id: `t${i}`, row: "full", span: 2n, height: none, minHeight: none, name: `T${i}`, align: variant("top", null) })),
            { id: "extra", row: "other", span: 12n, height: none, minHeight: none, name: "Extra", align: variant("top", null) },
        ];
        const canvas = await mountSnapGrid({ seed });
        const c = canvas.container;
        layOut(layRows(c));
        const full = c.querySelector<HTMLElement>('[data-snap-grid-row="full"]')!;
        const letGo = await hold(tileEl(c, "extra"), full, { x: 700, y: 50 });
        expect(full.hasAttribute("data-drop-invalid")).toBe(true);
        await letGo();
        expect(canvas.patches).toHaveLength(0);
        expect(rowsDrawn(c)).toEqual([["t0", "t1", "t2", "t3", "t4", "t5"], ["extra"]]);
    }, 30_000);
});

describe("L11 — the drop stages", () => {
    test("while a tile rests on the end zone it is the drop's target, and a drop leaves no mark behind", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        const zone = endZone(c);
        const letGo = await hold(tileEl(c, "trend"), zone);
        expect(zone.hasAttribute("data-drop-active")).toBe(true);
        expect(zone.hasAttribute("data-drop-invalid")).toBe(false);
        // Its words: at rest, while dragging, and as the target — CSS shows the one that applies. The two
        // under a drag lead with Font Awesome's caret, never a written ▾ (#1263).
        expect([...zone.querySelectorAll("span")].map((s) => [s.textContent, faIcons(s, "caret-down").length, s.firstElementChild?.tagName.toLowerCase() ?? null])).toEqual([
            ["Drag from the library · new 12-col row", 0, null],
            ["Drop between rows, beside a tile, or here", 1, "svg"],
            ["Drop component here · snaps to a new 12-col row", 1, "svg"],
        ]);
        expect(loneGlyphs(zone)).toEqual([]);
        await letGo();
        expect(zone.hasAttribute("data-drop-active")).toBe(false);
        expect(c.querySelector("[data-snap-grid-insert]")).toBeNull();
        expect(c.querySelector("[data-snap-grid-drop]")).toBeNull();
    }, 30_000);

    test("resting beside a tile marks the tile it lands beside", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        layOut(layRows(c));
        const charts = c.querySelector<HTMLElement>('[data-snap-grid-row="charts"]')!;
        const letGo = await hold(tileEl(c, "kpi"), charts, { x: 1000, y: 160 });
        expect(charts.getAttribute("data-snap-grid-drop")).toBe("join");
        expect(tileEl(c, "region").getAttribute("data-snap-grid-insert")).toBe("after");
        await letGo();
        expect(rowsDrawn(c)).toEqual([["trend", "region", "kpi"], ["board"]]);
    }, 30_000);
});

describe("L12 — a dropped card", () => {
    test("a card dropped on the end zone becomes a tile — create's row, in a new row of its own — and one Undo takes it back", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await drop(canvas.getByTestId("card-orders"), endZone(c));
        expect(rowsDrawn(c)).toEqual([...SEED_ROWS, ["orders-1"]]);
        expect(spanOf(c, "orders-1")).toBe(6);
        expect(labels(canvas)).toEqual(["Add orders"]);
        expect(origins(canvas)).toEqual(["drop"]);
        await history(canvas, "Undo");
        expect(rowsDrawn(c)).toEqual(SEED_ROWS);
    }, 30_000);

    test("a card joining a row is fitted to it — here, to the 4 columns the row has free", async () => {
        const seed: TileValue[] = [{ id: "a", row: "top", span: 8n, height: none, minHeight: none, name: "A", align: variant("top", null) }];
        const canvas = await mountSnapGrid({ seed });
        const c = canvas.container;
        layOut(layRows(c));
        await drop(canvas.getByTestId("card-orders"), c.querySelector<HTMLElement>('[data-snap-grid-row="top"]')!, { x: 1000, y: 50 });
        expect(rowsDrawn(c)).toEqual([["a", "orders-1"]]);
        expect([spanOf(c, "a"), spanOf(c, "orders-1")]).toEqual([8, 4]);
        expect(canvas.patches[0]!.draftChanges.map((d) => d.id)).toEqual(["orders-1"]);
    }, 30_000);

    test("canDrop refuses a destination before a draft — the ⊘ stage, and nothing is drafted", async () => {
        const canvas = await mountSnapGrid({ veto: true });
        const c = canvas.container;
        const letGo = await hold(canvas.getByTestId(`card-${BLOCKED}`), endZone(c));
        expect(endZone(c).hasAttribute("data-drop-invalid")).toBe(true);
        await letGo();
        expect(canvas.patches).toHaveLength(0);
        // Another card lands there.
        await drop(canvas.getByTestId("card-orders"), endZone(c));
        expect(labels(canvas)).toEqual(["Add orders"]);
    }, 30_000);

    test("without create no card lands", async () => {
        const canvas = await mountSnapGrid({ creates: false });
        const c = canvas.container;
        await drop(canvas.getByTestId("card-orders"), endZone(c));
        expect(canvas.patches).toHaveLength(0);
        expect(rowsDrawn(c)).toEqual(SEED_ROWS);
    }, 30_000);
});

describe("L15 — the keyboard", () => {
    test("the arrows move the selection: left and right in reading order, up and down onto the nearest tile's columns", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "trend");
        await key(c, { key: "ArrowRight" }, "trend");
        expect(selectedTile(c)).toBe("region");
        expect(announced(c)).toBe("Selected Breakdown bars");
        await key(c, { key: "ArrowUp" }, "region");
        expect(selectedTile(c)).toBe("kpi");
        await key(c, { key: "ArrowDown" }, "kpi");
        expect(selectedTile(c)).toBe("trend");
        await key(c, { key: "ArrowDown" }, "trend");
        expect(selectedTile(c)).toBe("board");
        await key(c, { key: "ArrowLeft" }, "board");
        expect(selectedTile(c)).toBe("region");
        expect(canvas.boundSelection()).toBe("region");
        expect(canvas.patches).toHaveLength(0);
    }, 30_000);

    test("Delete and Backspace remove the selected tile, and the remove button does too", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "region");
        await key(c, { key: "Delete" }, "region");
        expect(rowsDrawn(c)).toEqual([["kpi"], ["trend"], ["board"]]);
        expect(selectedTile(c)).toBeNull();
        expect(announced(c)).toBe("Removed Breakdown bars");
        await clickTile(c, "trend");
        await key(c, { key: "Backspace" }, "trend");
        expect(rowsDrawn(c)).toEqual([["kpi"], ["board"]]);
        await clickTile(c, "board");
        await act(async () => { fireEvent.click(tileEl(c, "board").querySelector("[data-snap-grid-remove]")!); });
        expect(rowsDrawn(c)).toEqual([["kpi"]]);
        expect(labels(canvas)).toEqual(["Remove Breakdown bars", "Remove Revenue trend", "Remove Assignment board"]);
        expect(origins(canvas)).toEqual(["remove", "remove", "remove"]);
    }, 30_000);
});

describe("L16 — every gesture is one transaction", () => {
    test("Undo and Redo restore exactly — through the history item and the keys", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await drop(tileEl(c, "trend"), endZone(c));
        await clickTile(c, "region");
        await key(c, { key: "[" }, "region");
        await drop(canvas.getByTestId("card-orders"), gapEl(c, 0));
        expect(rowsDrawn(c)).toEqual([["orders-1"], ["kpi"], ["region"], ["board"], ["trend"]]);
        await history(canvas, "Undo");
        expect(rowsDrawn(c)).toEqual([["kpi"], ["region"], ["board"], ["trend"]]);
        await key(c, { key: "z", ctrlKey: true });
        expect(spanOf(c, "region")).toBe(4);
        await key(c, { key: "z", metaKey: true });
        expect(rowsDrawn(c)).toEqual(SEED_ROWS);
        expect(marks(c)).toEqual({});
        expect(historyButton(canvas, "Undo").disabled).toBe(true);
        await key(c, { key: "z", ctrlKey: true, shiftKey: true });
        expect(rowsDrawn(c)).toEqual([["kpi"], ["region"], ["board"], ["trend"]]);
        await key(c, { key: "y", ctrlKey: true });
        expect(spanOf(c, "region")).toBe(3);
        await history(canvas, "Redo");
        expect(rowsDrawn(c)).toEqual([["orders-1"], ["kpi"], ["region"], ["board"], ["trend"]]);
        expect(origins(canvas)).toEqual(["move", "resize", "drop", "undo", "undo", "undo", "redo", "redo", "redo"]);
        // Drafts, all of them: the source as it was.
        expect(canvas.writes()).toBe(0);
    }, 30_000);

    test("Discard returns to the source", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await drop(tileEl(c, "board"), gapEl(c, 0));
        await clickTile(c, "trend");
        await key(c, { key: "Delete" }, "trend");
        await history(canvas, "Discard");
        expect(rowsDrawn(c)).toEqual(SEED_ROWS);
        expect(marks(c)).toEqual({});
        expect(historyButton(canvas, "Save").disabled).toBe(true);
        expect(canvas.writes()).toBe(0);
    }, 30_000);

    test("Save sends one checked batch — and the source holds the order the canvas shows", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await drop(tileEl(c, "board"), gapEl(c, 0));
        await drop(canvas.getByTestId("card-orders"), endZone(c));
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        await clickTile(c, "region");
        await key(c, { key: "Delete" }, "region");
        const drawn = rowsDrawn(c);
        await history(canvas, "Save");
        expect(canvas.applies).toHaveLength(1);
        expect(canvas.writes()).toBe(1);
        // The source's order is the canvas's.
        expect(storedRows(canvas)).toEqual(["board@board", "kpi@kpis", "trend@charts", "orders-1@row-1"]);
        expect(canvas.stored().find((t) => t.id === "trend")!.span).toBe(7n);
        await canvas.confirm();
        expect(rowsDrawn(c)).toEqual(drawn);
        expect(marks(c)).toEqual({});
        expect(historyButton(canvas, "Save").disabled).toBe(true);
    }, 30_000);

    test("a height is written into the tile's own row — `some` for a height, `none` back to auto", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "region");
        await dragHandle(c, "region", "height", { y: 250 });
        await history(canvas, "Save");
        expect(canvas.stored().find((t) => t.id === "region")!.height).toEqual(some(240n));
        await canvas.confirm();
        await clickTile(c, "region");
        await dragHandle(c, "region", "height", { y: -300 });
        await history(canvas, "Save");
        expect(canvas.stored().find((t) => t.id === "region")!.height).toEqual(none);
    }, 30_000);

    test("the author's check marks the tile it refuses — and Save waits for it", async () => {
        const canvas = await mountSnapGrid({ ready: true });
        const c = canvas.container;
        await clickTile(c, "region");
        await key(c, { key: "[" }, "region");
        expect(marks(c)).toEqual({ region: "pending" });
        await key(c, { key: "[" }, "region");
        expect(marks(c)).toEqual({ region: "invalid" });
        expect(historyButton(canvas, "Save").disabled).toBe(true);
        await history(canvas, "Undo");
        expect(marks(c)).toEqual({ region: "pending" });
        expect(historyButton(canvas, "Save").disabled).toBe(false);
    }, 30_000);
});

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
        const [row, body] = [...frame.children] as HTMLElement[];
        expect(row!.getAttribute("data-frame-slot")).toBe("toolbar");
        expect([...body!.children].map((el) => el.getAttribute("data-frame-slot"))).toEqual(["start", "main", "end"]);
        // The SnapGrid's own East panes, each placed as it is.
        expect(body!.querySelector('[data-frame-slot="start"]')!.textContent).toBe("Palette");
        expect(body!.querySelector('[data-frame-slot="end"]')!.textContent).toBe("Inspector");
        // The selection bar sits over the canvas only, not the panes.
        expect(body!.querySelector('[data-frame-slot="main"] > [data-snap-grid-main] > [data-snap-grid-selection]')).not.toBeNull();
    }, 30_000);
});

describe("a pane beside the canvas (#996)", () => {
    test("a span request is one resize, held to the row's room — and the request is written back none", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await canvas.hostAsks({ key: "trend", change: variant("span", 6n) });
        expect(spanOf(c, "trend")).toBe(6);
        expect(canvas.boundRequest()).toBeNull();
        // The breakdown's 4 leave the trend 8 at most.
        await canvas.hostAsks({ key: "trend", change: variant("span", 12n) });
        expect(spanOf(c, "trend")).toBe(8);
        expect(labels(canvas)).toEqual(["Resize Revenue trend", "Resize Revenue trend"]);
        expect(origins(canvas)).toEqual(["resize", "resize"]);
        // Each an undoable gesture of the session.
        await history(canvas, "Undo");
        expect(spanOf(c, "trend")).toBe(6);
        expect(canvas.writes()).toBe(0);
    }, 30_000);

    test("a row request moves the tile into that row, fitted to it; past the last row it takes a new row at the end", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await canvas.hostAsks({ key: "board", change: variant("row", 1n) });
        expect(rowsDrawn(c)).toEqual([["kpi", "board"], ["trend", "region"]]);
        expect([spanOf(c, "kpi"), spanOf(c, "board")]).toEqual([6, 6]);
        await canvas.hostAsks({ key: "trend", change: variant("row", 9n) });
        expect(rowsDrawn(c)).toEqual([["kpi", "board"], ["region"], ["trend"]]);
        // Its own row asks nothing.
        await canvas.hostAsks({ key: "region", change: variant("row", 2n) });
        expect(labels(canvas)).toEqual(["Move Assignment board", "Move Revenue trend"]);
        expect(origins(canvas)).toEqual(["move", "move"]);
    }, 30_000);

    test("a row request into a row already holding six tiles lands in a new row after it", async () => {
        const seed: TileValue[] = [
            { id: "extra", row: "top", span: 12n, height: none, minHeight: none, name: "Extra", align: variant("top", null) },
            ...Array.from({ length: 6 }, (_u, i): TileValue => ({ id: `t${i}`, row: "full", span: 2n, height: none, minHeight: none, name: `T${i}`, align: variant("top", null) })),
            { id: "last", row: "bottom", span: 12n, height: none, minHeight: none, name: "Last", align: variant("top", null) },
        ];
        const canvas = await mountSnapGrid({ seed });
        const c = canvas.container;
        await canvas.hostAsks({ key: "extra", change: variant("row", 2n) });
        expect(rowsDrawn(c)).toEqual([["t0", "t1", "t2", "t3", "t4", "t5"], ["extra"], ["last"]]);
        expect(labels(canvas)).toEqual(["Move Extra"]);
    }, 30_000);

    test("a height request sets a height, returns it to auto, and is held to the tile's least height and the most", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await canvas.hostAsks({ key: "region", change: variant("height", some(240n)) });
        expect(heightOf(c, "region")).toBe(240);
        await canvas.hostAsks({ key: "region", change: variant("height", none) });
        expect(heightOf(c, "region")).toBeNull();
        // The trend's least height is 120.
        await canvas.hostAsks({ key: "trend", change: variant("height", some(80n)) });
        expect(heightOf(c, "trend")).toBe(120);
        await canvas.hostAsks({ key: "board", change: variant("height", some(4000n)) });
        expect(heightOf(c, "board")).toBe(960);
        expect(origins(canvas)).toEqual(["resize", "resize", "resize", "resize"]);
    }, 30_000);

    test("an align request writes the field edit.align names, as one typed gesture; without edit.align it is refused, and written back none", async () => {
        const canvas = await mountSnapGrid({ aligns: true });
        const c = canvas.container;
        await canvas.hostAsks({ key: "trend", change: variant("align", variant("center", null)) });
        expect(tileEl(c, "trend").getAttribute("data-align")).toBe("center");
        expect(labels(canvas)).toEqual(["Align Revenue trend"]);
        expect(origins(canvas)).toEqual(["typed"]);
        await history(canvas, "Save");
        expect(canvas.stored().find((t) => t.id === "trend")!.align.type).toBe("center");
        cleanup();
        initializeStore(new UIStore());
        const plain = await mountSnapGrid();
        await plain.hostAsks({ key: "trend", change: variant("align", variant("stretch", null)) });
        expect(plain.patches).toHaveLength(0);
        expect(tileEl(plain.container, "trend").getAttribute("data-align")).toBe("top");
        expect(plain.boundRequest()).toBeNull();
    }, 30_000);

    test("a request for a tile the canvas does not hold changes nothing, and keeps the selection", async () => {
        const canvas = await mountSnapGrid();
        await canvas.hostSelects("trend");
        await canvas.hostAsks({ key: "nowhere", change: variant("span", 4n) });
        expect(canvas.patches).toHaveLength(0);
        expect(canvas.boundRequest()).toBeNull();
        expect(canvas.boundSelection()).toBe("trend");
    }, 30_000);

    test("the author hears the rows the canvas draws — as it mounts, after a gesture, an undo, a move and a discard — and the same rows once", async () => {
        const canvas = await mountSnapGrid({ drafted: true });
        const c = canvas.container;
        const spans = (rows: readonly TileValue[]) => rows.map((t) => `${t.id}:${t.span}`);
        expect(canvas.drafts.map(spans)).toEqual([["kpi:12", "trend:8", "region:4", "board:12"]]);
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        expect(canvas.drafts).toHaveLength(2);
        expect(spans(canvas.drafts[1]!)).toEqual(["kpi:12", "trend:7", "region:4", "board:12"]);
        // What the author keeps is what the canvas draws.
        expect(spans(canvas.heard()!)).toEqual(["kpi:12", "trend:7", "region:4", "board:12"]);
        await history(canvas, "Undo");
        expect(spans(canvas.drafts[2]!)).toEqual(["kpi:12", "trend:8", "region:4", "board:12"]);
        await drop(tileEl(c, "board"), gapEl(c, 0));
        expect(canvas.drafts.at(-1)!.map((t) => t.id)).toEqual(["board", "kpi", "trend", "region"]);
        await history(canvas, "Discard");
        expect(canvas.drafts.at(-1)!.map((t) => t.id)).toEqual(["kpi", "trend", "region", "board"]);
        expect(canvas.drafts).toHaveLength(5);
        // A selection changes no row: nothing new is heard.
        await clickTile(c, "region");
        expect(canvas.drafts).toHaveLength(5);
    }, 30_000);

    test("the history shortcuts work from a pane — a gesture undone and redone with the focus beside the canvas", async () => {
        const canvas = await mountSnapGrid({ chrome: true });
        const c = canvas.container;
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        expect(spanOf(c, "trend")).toBe(7);
        const pane = c.querySelector<HTMLElement>('[data-frame-slot="end"]')!;
        await act(async () => { fireEvent.keyDown(pane, { key: "z", ctrlKey: true }); });
        expect(spanOf(c, "trend")).toBe(8);
        await act(async () => { fireEvent.keyDown(pane, { key: "y", ctrlKey: true }); });
        expect(spanOf(c, "trend")).toBe(7);
    }, 30_000);
});

describe("an Apply a screen asks for (#998)", () => {
    test("with no drafts the canvas answers applied at once, under the id asked, and writes nothing", async () => {
        const canvas = await mountSnapGrid({ applies: true });
        await canvas.hostAsksApply("ask-1");
        expect(canvas.boundApply()).toEqual(variant("applied", "ask-1"));
        expect(canvas.applies).toHaveLength(0);
        expect(canvas.writes()).toBe(0);
    }, 30_000);

    test("with drafts it applies them as its history item does — one checked batch — and answers once the source confirms them", async () => {
        const canvas = await mountSnapGrid({ applies: true });
        const c = canvas.container;
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        await canvas.hostAsksApply("ask-2");
        expect(canvas.applies).toHaveLength(1);
        expect(canvas.writes()).toBe(1);
        expect(canvas.stored().find((t) => t.id === "trend")!.span).toBe(7n);
        // Not until the source reads back as the Apply left it.
        expect(canvas.boundApply()).toEqual(variant("asked", "ask-2"));
        await canvas.confirm();
        expect(canvas.boundApply()).toEqual(variant("applied", "ask-2"));
        expect(marks(c)).toEqual({});
        expect(historyButton(canvas, "Save").disabled).toBe(true);
    }, 30_000);

    test("each ask is answered under its own id", async () => {
        const canvas = await mountSnapGrid({ applies: true });
        await canvas.hostAsksApply("first");
        expect(canvas.boundApply()).toEqual(variant("applied", "first"));
        await canvas.hostAsksApply("second");
        expect(canvas.boundApply()).toEqual(variant("applied", "second"));
    }, 30_000);

    test("drafts the author's check refuses are refused, in the check's words, and nothing is applied", async () => {
        const canvas = await mountSnapGrid({ applies: true, ready: true });
        const c = canvas.container;
        await clickTile(c, "region");
        await key(c, { key: "[" }, "region");
        await key(c, { key: "[" }, "region");
        expect(marks(c)).toEqual({ region: "invalid" });
        await canvas.hostAsksApply("ask-3");
        expect(canvas.boundApply()).toEqual(variant("refused", { id: "ask-3", reason: "A tile spans 3 columns at least" }));
        expect(canvas.applies).toHaveLength(0);
    }, 30_000);

    test("drafts the source moved under are refused, in the history item's words", async () => {
        const canvas = await mountSnapGrid({ applies: true });
        const c = canvas.container;
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        hostWrites(SEED.map((t) => (t.id === "board" ? { ...t, span: 6n } : t)));
        await canvas.confirm();
        await canvas.hostAsksApply("ask-4");
        expect(canvas.boundApply()).toEqual(variant("refused", { id: "ask-4", reason: "Source changed — review or discard these drafts" }));
        expect(canvas.applies).toHaveLength(0);
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
        expect(menuItems()).toEqual(["menuitem:Zoom out", "menuitem:Zoom in", "menuitemradio:Desktop (checked)", "menuitemradio:Tablet"]);
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
