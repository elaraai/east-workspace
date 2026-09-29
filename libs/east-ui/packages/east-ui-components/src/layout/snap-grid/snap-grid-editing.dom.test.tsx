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
 * discarded and applied as one checked batch (L16).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { none, some } from "@elaraai/east";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { layOut } from "../../dnd/dnd.test-utils.js";
import {
    BLOCKED, SEED, type EditingSnapGrid, type TileValue,
    announced, clickTile, drop, dragHandle, endZone, gapEl, heightOf, history, historyButton, hold, key, layRows, marks,
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
            { id: "a", row: "top", span: 8n, height: none, minHeight: none, name: "A" },
            { id: "b", row: "bottom", span: 6n, height: none, minHeight: none, name: "B" },
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
            ...Array.from({ length: 6 }, (_u, i): TileValue => ({ id: `t${i}`, row: "full", span: 2n, height: none, minHeight: none, name: `T${i}` })),
            { id: "extra", row: "other", span: 12n, height: none, minHeight: none, name: "Extra" },
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
        // Its words: at rest, while dragging, and as the target — CSS shows the one that applies.
        expect([...zone.querySelectorAll("span")].map((s) => s.textContent)).toEqual([
            "Drag from the library · new 12-col row",
            "▾ Drop between rows, beside a tile, or here",
            "▾ Drop component here · snaps to a new 12-col row",
        ]);
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
        const seed: TileValue[] = [{ id: "a", row: "top", span: 8n, height: none, minHeight: none, name: "A" }];
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
        expect(historyButton(canvas, "Apply changes").disabled).toBe(true);
        expect(canvas.writes()).toBe(0);
    }, 30_000);

    test("Apply sends one checked batch — and the source holds the order the canvas shows", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await drop(tileEl(c, "board"), gapEl(c, 0));
        await drop(canvas.getByTestId("card-orders"), endZone(c));
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        await clickTile(c, "region");
        await key(c, { key: "Delete" }, "region");
        const drawn = rowsDrawn(c);
        await history(canvas, "Apply changes");
        expect(canvas.applies).toHaveLength(1);
        expect(canvas.writes()).toBe(1);
        // The source's order is the canvas's.
        expect(storedRows(canvas)).toEqual(["board@board", "kpi@kpis", "trend@charts", "orders-1@row-1"]);
        expect(canvas.stored().find((t) => t.id === "trend")!.span).toBe(7n);
        await canvas.confirm();
        expect(rowsDrawn(c)).toEqual(drawn);
        expect(marks(c)).toEqual({});
        expect(historyButton(canvas, "Apply changes").disabled).toBe(true);
    }, 30_000);

    test("a height is written into the tile's own row — `some` for a height, `none` back to auto", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "region");
        await dragHandle(c, "region", "height", { y: 250 });
        await history(canvas, "Apply changes");
        expect(canvas.stored().find((t) => t.id === "region")!.height).toEqual(some(240n));
        await canvas.confirm();
        await clickTile(c, "region");
        await dragHandle(c, "region", "height", { y: -300 });
        await history(canvas, "Apply changes");
        expect(canvas.stored().find((t) => t.id === "region")!.height).toEqual(none);
    }, 30_000);

    test("the author's check marks the tile it refuses — and Apply waits for it", async () => {
        const canvas = await mountSnapGrid({ ready: true });
        const c = canvas.container;
        await clickTile(c, "region");
        await key(c, { key: "[" }, "region");
        expect(marks(c)).toEqual({ region: "pending" });
        await key(c, { key: "[" }, "region");
        expect(marks(c)).toEqual({ region: "invalid" });
        expect(historyButton(canvas, "Apply changes").disabled).toBe(true);
        await history(canvas, "Undo");
        expect(marks(c)).toEqual({ region: "pending" });
        expect(historyButton(canvas, "Apply changes").disabled).toBe(false);
    }, 30_000);
});
