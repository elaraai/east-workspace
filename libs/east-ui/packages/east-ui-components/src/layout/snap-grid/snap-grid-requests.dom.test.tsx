/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What a host asks of the SnapGrid's editing canvas. A pane beside it (#996):
 * the changes it asks for through the bound selection, each one gesture by the
 * canvas's own rules, the rows the author hears the canvas draw, and the
 * history shortcuts from a pane. What a tile shows and its copies (#1672): a
 * field of its entry a pane sets, and a duplicate — asked by a pane or from
 * the selected tile's own toolbar, under its badge — and an entry the host
 * built, added after a tile (#1673). An Apply a screen asks for (#998):
 * answered under the id asked — at once with no drafts, once the source
 * confirms them, or refused in the canvas's words.
 */

import { describe, test, expect, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { IntegerType, StringType, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { initializeStore } from "../../platform/state-runtime.js";
import { resetKept } from "../../platform/kept.js";
import { UIStore } from "../../platform/state-store.js";
import { faIcons } from "../../testing/icons.js";
import {
    SEED, SEED_ROWS, Tile, canvasTestSetup, labels, origins, storedRows, type TileValue,
    announced, clickTile, drop, gapEl, heightOf, history, historyButton, hostWrites, key, marks,
    mountSnapGrid, rowsDrawn, selectedTile, spanOf, tileEl,
} from "./snap-grid-editing.test-utils.js";

canvasTestSetup();

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
        // A canvas without edit.align, in a tab of its own: nothing kept from the first.
        cleanup();
        initializeStore(new UIStore());
        window.sessionStorage.clear();
        resetKept();
        const plain = await mountSnapGrid();
        await plain.hostAsks({ key: "trend", change: variant("align", variant("stretch", null)) });
        expect(plain.patches).toHaveLength(0);
        expect(tileEl(plain.container, "trend").getAttribute("data-align")).toBe("top");
        expect(plain.boundRequest()).toBeNull();
    }, 30_000);

    test("a reload keeps the drafts in this tab: the tile resized is drawn as it was, still to save, and Save saves it", async () => {
        const canvas = await mountSnapGrid({ drafted: true });
        const spans = (rows: readonly TileValue[]) => rows.map((t) => `${t.id}:${t.span}`);
        await clickTile(canvas.container, "trend");
        await key(canvas.container, { key: "[" }, "trend");
        expect(spans(canvas.heard()!)).toEqual(["kpi:12", "trend:7", "region:4", "board:12"]);
        // A reload: the page and its UI store go; the tab's storage stays.
        cleanup();
        initializeStore(new UIStore());
        resetKept();
        const again = await mountSnapGrid({ drafted: true });
        await waitFor(() => expect(spans(again.heard()!)).toEqual(["kpi:12", "trend:7", "region:4", "board:12"]));
        await history(again, "Save");
        expect(again.stored().find((t) => t.id === "trend")!.span).toBe(7n);
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

describe("what a tile shows, and its copies (#1672)", () => {
    const encodeText = encodeBeast2For(StringType);
    const encodeInteger = encodeBeast2For(IntegerType);
    const encodeTile = encodeBeast2For(Tile);

    test("a field request sets that field of the tile's entry as one typed gesture: the tile draws what it now holds, Undo takes it back, and the request is written back none", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await canvas.hostAsks({ key: "trend", change: variant("field", { name: "name", value: encodeText("Revenue by week") }) });
        expect(tileEl(c, "trend").textContent).toBe("Revenue by week");
        expect([labels(canvas), origins(canvas), canvas.boundRequest()]).toEqual([["Edit Revenue trend"], ["typed"], null]);
        await history(canvas, "Undo");
        expect(tileEl(c, "trend").textContent).toBe("Revenue trend");
        expect(canvas.writes()).toBe(0);
    }, 30_000);

    test("a field request never sets the tile's identity or its place, a field it lacks, a value of another type, or the value it holds", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const canvas = await mountSnapGrid();
        const asked: ReadonlyArray<readonly [string, Uint8Array]> = [
            ["id", encodeText("chart")], ["row", encodeText("kpis")], ["span", encodeInteger(4n)], ["colour", encodeText("teal")],
            ["name", encodeInteger(7n)], ["name", encodeText("Revenue trend")],
        ];
        for (const [name, value] of asked) await canvas.hostAsks({ key: "trend", change: variant("field", { name, value }) });
        expect([canvas.patches.length, canvas.boundRequest(), tileEl(canvas.container, "trend").textContent]).toEqual([0, null, "Revenue trend"]);
        // The value of another type is said as it is refused.
        expect(error).toHaveBeenCalledWith('[SnapGrid] the value asked for "name" could not be read:', expect.anything());
    }, 30_000);

    test("a duplicate request copies the tile after it in its row while the row has room at its span — one insert, selected and said — and Save keeps it, the original's entry under its own key", async () => {
        const seed: TileValue[] = [{ id: "kpi", row: "kpis", span: 4n, height: none, minHeight: none, name: "KPI", align: variant("top", null) }];
        const canvas = await mountSnapGrid({ seed });
        const c = canvas.container;
        await canvas.hostAsks({ key: "kpi", change: variant("duplicate", null) });
        expect(rowsDrawn(c)).toEqual([["kpi", "kpi-1"]]);
        expect([spanOf(c, "kpi-1"), canvas.boundSelection(), selectedTile(c), announced(c)]).toEqual([4, "kpi-1", "kpi-1", "Duplicated KPI"]);
        expect([labels(canvas), origins(canvas), canvas.boundRequest()]).toEqual([["Duplicate KPI"], ["insert"], null]);
        await history(canvas, "Save");
        const stored = canvas.stored();
        expect([storedRows(canvas), stored.map((t) => t.span), stored.map((t) => t.name)]).toEqual([["kpi@kpis", "kpi-1@kpis"], [4n, 4n], ["KPI", "KPI"]]);
    }, 30_000);

    test("the selected tile's Duplicate copies it into a new row after a row with no room for it, nothing in the row narrowed; one Undo takes it back", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "region");
        await act(async () => { fireEvent.click(tileEl(c, "region").querySelector("[data-snap-grid-duplicate]")!); });
        expect(rowsDrawn(c)).toEqual([["kpi"], ["trend", "region"], ["region-1"], ["board"]]);
        expect([spanOf(c, "trend"), spanOf(c, "region"), spanOf(c, "region-1"), selectedTile(c), announced(c)])
            .toEqual([8, 4, 4, "region-1", "Duplicated Breakdown bars"]);
        await history(canvas, "Undo");
        expect(rowsDrawn(c)).toEqual(SEED_ROWS);
    }, 30_000);

    test("an add request places an entry the host built in a new row after the tile's row, under a fresh key and the new row's — one insert, selected and said — and one Undo takes it back (#1673)", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        // The entry's own key and row are never kept: its key seeds a fresh one, and its row is the new row's.
        const built = encodeTile({ id: "linked", row: "kpis", span: 6n, height: none, minHeight: none, name: "Linked chart", align: variant("top", null) });
        await canvas.hostAsks({ key: "trend", change: variant("add", built) });
        expect(rowsDrawn(c)).toEqual([["kpi"], ["trend", "region"], ["linked-1"], ["board"]]);
        // Selected, it wears its name and its span over its top edge.
        expect([spanOf(c, "linked-1"), tileEl(c, "linked-1").querySelector("[data-snap-grid-badge]")!.textContent, canvas.boundSelection(), selectedTile(c), announced(c)])
            .toEqual([6, "Linked chart · 6/12", "linked-1", "linked-1", "Added Linked chart"]);
        // Nothing of the rows it landed between changed.
        expect([spanOf(c, "trend"), spanOf(c, "region")]).toEqual([8, 4]);
        expect([labels(canvas), origins(canvas), canvas.boundRequest()]).toEqual([["Add Linked chart"], ["insert"], null]);
        await history(canvas, "Undo");
        expect(rowsDrawn(c)).toEqual(SEED_ROWS);
    }, 30_000);

    test("an add request after a tile the canvas does not hold, or of bytes that are no entry, adds nothing and is written back", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const canvas = await mountSnapGrid();
        const built = encodeTile({ id: "linked", row: "", span: 6n, height: none, minHeight: none, name: "Linked chart", align: variant("top", null) });
        await canvas.hostAsks({ key: "gone", change: variant("add", built) });
        await canvas.hostAsks({ key: "trend", change: variant("add", encodeText("not an entry")) });
        expect([rowsDrawn(canvas.container), canvas.patches.length, canvas.boundRequest()]).toEqual([SEED_ROWS, 0, null]);
        expect(error).toHaveBeenCalledWith("[SnapGrid] the entry asked to be added could not be read:", expect.anything());
    }, 30_000);

    test("the selected tile wears its name and span over its top edge, and its toolbar: Duplicate and Remove — no Edit, this host editing nothing it shows", async () => {
        const canvas = await mountSnapGrid();
        const c = canvas.container;
        await clickTile(c, "region");
        const tile = tileEl(c, "region");
        expect(tile.querySelector("[data-snap-grid-badge]")!.textContent).toBe("Breakdown bars · 4/12");
        expect([...tile.querySelectorAll("[data-snap-grid-tile-bar] button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Duplicate", "Remove from page"]);
        expect(faIcons(tile.querySelector<HTMLElement>("[data-snap-grid-duplicate]")!, "clone")).toHaveLength(1);
        // The others wear neither.
        expect(tileEl(c, "trend").querySelector("[data-snap-grid-badge], [data-snap-grid-tile-bar]")).toBeNull();
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

    test("a tile changed here and otherwise by another write is a conflict: the frame's banner says so, and its Choose opens the card, which names the tile as the page shows it and its span as a side panel does", async () => {
        const canvas = await mountSnapGrid({ applies: true });
        const c = canvas.container;
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        hostWrites(SEED.map((t) => (t.id === "trend" ? { ...t, span: 5n } : t)));
        await canvas.confirm();
        await waitFor(() => expect(c.querySelector('[data-session-banner="conflicts"]')).not.toBeNull());
        await act(async () => { fireEvent.click(c.querySelector('[data-session-banner="conflicts"] [data-banner-action="choose"]')!); });
        await waitFor(() => expect(document.querySelectorAll("[data-conflict-card]")).toHaveLength(1));
        expect(document.querySelector("[data-conflict-card] [data-conflict-item]")!.textContent).toBe("Revenue trend");
        expect(document.querySelector("[data-conflict-card] [data-conflict-label]")!.textContent).toBe("Column span");
    }, 30_000);

    test("a tile holding a conflict not yet chosen wears the warn ring, and no other tile does; choosing takes it off, and Undo puts it back", async () => {
        const canvas = await mountSnapGrid({ applies: true });
        const c = canvas.container;
        const ringed = () => SEED.filter((t) => tileEl(c, t.id).hasAttribute("data-conflict")).map((t) => t.id);
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        expect(ringed()).toEqual([]);
        hostWrites(SEED.map((t) => (t.id === "trend" ? { ...t, span: 5n } : t)));
        await canvas.confirm();
        await waitFor(() => expect(ringed()).toEqual(["trend"]));
        await act(async () => { fireEvent.click(c.querySelector('[data-session-banner="conflicts"] [data-banner-action="choose"]')!); });
        await waitFor(() => expect(document.querySelectorAll("[data-conflict-card]")).toHaveLength(1));
        await act(async () => { fireEvent.click(document.querySelector<HTMLInputElement>("[data-conflict-card] [data-choice=source] input")!); });
        await waitFor(() => expect(ringed()).toEqual([]));
        await history(canvas, "Undo");
        await waitFor(() => expect(ringed()).toEqual(["trend"]));
    }, 30_000);

    test("drafts the source moved under are carried over — another write's change of another tile beside them — and the Apply asked saves them", async () => {
        const canvas = await mountSnapGrid({ applies: true });
        const c = canvas.container;
        await clickTile(c, "trend");
        await key(c, { key: "[" }, "trend");
        hostWrites(SEED.map((t) => (t.id === "board" ? { ...t, span: 6n } : t)));
        await canvas.confirm();
        await canvas.hostAsksApply("ask-4");
        expect(canvas.applies).toHaveLength(1);
        const stored = canvas.stored();
        expect([stored.find((t) => t.id === "trend")!.span, stored.find((t) => t.id === "board")!.span]).toEqual([7n, 6n]);
    }, 30_000);
});
