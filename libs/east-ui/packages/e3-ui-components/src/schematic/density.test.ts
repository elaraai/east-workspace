/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the footer says of a kind drawn as its density (#1393, D25): how many
 * rows the density shades in the viewport (`area.ts`' `densityInView`) — every
 * row of each cell inside it, exactly, a cell's rows held to its part of the
 * drawing's extent; the viewport's share of a cell it cuts, and of every cell
 * where a coarser level's rows are spread over them, said to two significant
 * figures; nothing outside it — and the words it says it in (`messages.ts`'
 * `densityNotice`). The density switch counts the viewport too: from the
 * window's cells' counts before a row is read (`cellsInView`), each cell
 * weighed as a density's is; and a window drawn as its density holds only at
 * its zoom, while the density counts more rows in the viewport than a window
 * draws (`windowHolds`).
 */

import { describe, expect, test } from "vitest";
import { none, variant } from "@elaraai/east";
import type { AreaCell } from "@elaraai/east-ui/internal";
import { cellsInView, densityInView, windowHolds, windowOf, type SchematicDensity, type SchematicViewport } from "./area.js";
import { schematicMessages } from "./messages.js";

/** A density of 10 m cells over a 40 × 40 m box: four of its cells hold rows. */
const DENSITY: SchematicDensity = {
    side: 10,
    cells: [
        { minX: 0, minY: 0, count: 1200 }, { minX: 10, minY: 0, count: 800 },
        { minX: 0, minY: 10, count: 6 }, { minX: 30, minY: 30, count: 4000 },
    ],
    most: 4000,
    box: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    spread: false,
    unnarrowed: false,
};

/** Its drawing's extent: the 40 × 40 m its cells lie in. */
const EXTENT = { minX: 0, minY: 0, maxX: 40, maxY: 40 };

describe("densityInView", () => {
    test("every cell inside the box: its rows, exactly", () => {
        expect(densityInView(DENSITY, { minX: 0, minY: 0, maxX: 40, maxY: 40 }, EXTENT)).toEqual({ rows: 6006, exact: true });
        // The first two cells, edge to edge with the box: theirs alone.
        expect(densityInView(DENSITY, { minX: 0, minY: 0, maxX: 20, maxY: 10 }, EXTENT)).toEqual({ rows: 2000, exact: true });
    });

    test("a cell the box cuts gives it its share of the cell's rows: an estimate, to two significant figures, whole below a hundred", () => {
        // Half of the first cell's 1,200 and a quarter of the third's 6: 601.5, said 600.
        expect(densityInView(DENSITY, { minX: 0, minY: 0, maxX: 5, maxY: 15 }, EXTENT)).toEqual({ rows: 600, exact: false });
        // A quarter of the third cell's 6: 1.5, said 2.
        expect(densityInView(DENSITY, { minX: 0, minY: 15, maxX: 5, maxY: 20 }, EXTENT)).toEqual({ rows: 2, exact: false });
    });

    test("a cell outside the box gives it nothing, one that only touches its edge among them", () => {
        expect(densityInView(DENSITY, { minX: 20, minY: 0, maxX: 30, maxY: 20 }, EXTENT)).toEqual({ rows: 0, exact: true });
    });

    test("a box past what the density covers, or a density whose coarser level's rows are spread over its cells, counts no rows exactly", () => {
        // Past its box, rows there are counted nowhere: 6,006 of the rows it covers, said 6,000.
        expect(densityInView(DENSITY, { minX: 0, minY: 0, maxX: 50, maxY: 40 }, EXTENT)).toEqual({ rows: 6000, exact: false });
        // Spread: each cell's count holds a share of a coarser cell's rows.
        expect(densityInView({ ...DENSITY, spread: true }, { minX: 0, minY: 0, maxX: 20, maxY: 10 }, EXTENT)).toEqual({ rows: 2000, exact: false });
    });

    /**
     * A floor 382 m wide under 8 m cells, as the floor of 20,000 racks is: the cells at 376 m reach 2 m past its east
     * edge, and one at 400 m holds rows standing outside it.
     */
    const FLOOR: SchematicDensity = {
        side: 8,
        cells: [{ minX: 0, minY: 0, count: 5 }, { minX: 376, minY: 0, count: 2 }, { minX: 376, minY: 128, count: 3 }],
        most: 5,
        box: { minX: -50, minY: -50, maxX: 440, maxY: 370 },
        spread: false,
        unnarrowed: false,
    };
    const FLOOR_EXTENT = { minX: 0, minY: 0, maxX: 382, maxY: 254 };

    test("a cell's rows lie in its part of the extent: the view Fit leaves, the extent edge to edge, counts every row exactly", () => {
        expect(densityInView(FLOOR, { minX: 0, minY: 0, maxX: 382, maxY: 316 }, FLOOR_EXTENT)).toEqual({ rows: 10, exact: true });
        // A view that cuts the cells' part in the extent takes its share of it: half of 2 and of 3, and the 5, said 8.
        expect(densityInView(FLOOR, { minX: 0, minY: 0, maxX: 379, maxY: 316 }, FLOOR_EXTENT)).toEqual({ rows: 8, exact: false });
    });

    test("a cell wholly outside the extent holds its rows where they stand, and is taken whole", () => {
        const outside: SchematicDensity = { ...FLOOR, cells: [...FLOOR.cells, { minX: 400, minY: 0, count: 4 }] };
        expect(densityInView(outside, { minX: 0, minY: 0, maxX: 420, maxY: 316 }, FLOOR_EXTENT)).toEqual({ rows: 14, exact: true });
        expect(densityInView(outside, { minX: 0, minY: 0, maxX: 404, maxY: 316 }, FLOOR_EXTENT)).toEqual({ rows: 12, exact: false });
    });
});

/** A window's cell where it is, at its level: its search counts nothing here. */
function cellAt(minX: number, minY: number, side: number, level: number): AreaCell {
    return { level, ix: 0, iy: 0, minX, minY, side, query: variant("fields", { values: ["0"], prefix: none }) };
}

describe("cellsInView", () => {
    /** Two 16 m cells of a window over the 40 × 40 m extent, and a 32 m one a level coarser, read by its exact key. */
    const CELLS = [cellAt(0, 0, 16, 23), cellAt(16, 0, 16, 23), cellAt(0, 0, 32, 22)];

    test("a cell inside the box gives it every row, one the box cuts its share, held evenly over it, one outside none", () => {
        // The first cell whole, the second only touching the box, a quarter of the coarser cell's 400.
        expect(cellsInView(CELLS, [1000n, 600n, 400n], { minX: 0, minY: 0, maxX: 16, maxY: 16 }, EXTENT)).toBe(1100);
        // And half of the second: 1,000 + 300 + 150.
        expect(cellsInView(CELLS, [1000n, 600n, 400n], { minX: 0, minY: 0, maxX: 24, maxY: 16 }, EXTENT)).toBe(1450);
    });

    test("a cell reaching past the drawing's extent gives every row to a box holding its part in the extent: the view Fit leaves counts them all", () => {
        const wide = [cellAt(-32, -32, 64, 21)];
        expect(cellsInView(wide, [5000n], { minX: -2, minY: -2, maxX: 42, maxY: 42 }, EXTENT)).toBe(5000);
        // Its part in the extent is 32 m a side: a box holding half of it, half its rows.
        expect(cellsInView(wide, [5000n], { minX: 0, minY: 0, maxX: 16, maxY: 40 }, EXTENT)).toBe(2500);
    });

    test("counts that are not one a cell are refused", () => {
        expect(() => cellsInView(CELLS, [1n], { minX: 0, minY: 0, maxX: 16, maxY: 16 }, EXTENT)).toThrow(/A window of 3 cells was counted 1/);
    });
});

describe("windowHolds", () => {
    /** A viewport at dot zoom: at 2 px a metre it is padded by 5 m, and its window reaches 13.75 m past that. */
    const at = (minX: number, minY: number, maxX: number, maxY: number, ppu = 2): SchematicViewport => ({ box: { minX, minY, maxX, maxY }, ppu, lod: "dot" });
    const VIEW = at(0, 0, 100, 100);
    const WINDOW = windowOf(VIEW);
    /** A drawing 200 m by 100 m. */
    const WIDE = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    /** 6,000 rows over the view's left half: 120 in each of its 10 m cells there. */
    const LEFT: SchematicDensity = {
        side: 10,
        cells: Array.from({ length: 50 }, (_, i) => ({ minX: (i % 5) * 10, minY: Math.floor(i / 5) * 10, count: 120 })),
        most: 120,
        box: WINDOW.reach,
        spread: false,
        unnarrowed: false,
    };

    test("drawn as its rows, it holds while the padded viewport stays inside its reach and at least half its size", () => {
        expect(windowHolds(WINDOW, at(10, 0, 110, 100), undefined, WIDE), "a pan inside the margin").toBe(true);
        expect(windowHolds(WINDOW, at(20, 0, 120, 100), undefined, WIDE), "a pan past its reach").toBe(false);
        expect(windowHolds(WINDOW, at(25, 25, 75, 75, 4), undefined, WIDE), "a zoom in to half its size").toBe(true);
        expect(windowHolds(WINDOW, at(30, 30, 70, 70, 5), undefined, WIDE), "a zoom in past half").toBe(false);
    });

    test("drawn as its density, it holds on a pan at its zoom while the density counts more rows in the viewport than a window draws", () => {
        const drawn = { density: LEFT, capped: false };
        expect(windowHolds(WINDOW, VIEW, drawn, WIDE), "6,000 in view").toBe(true);
        expect(windowHolds(WINDOW, at(5, 0, 105, 100), drawn, WIDE), "about 5,400").toBe(true);
        expect(windowHolds(WINDOW, at(10, 0, 110, 100), drawn, WIDE), "4,800: the viewport's own window reads them").toBe(false);
        // Inside its reach and as dense, at another zoom: the viewport's own window, so a view draws one raster by any route.
        expect(windowHolds(WINDOW, at(0, 0, 100, 100, 2.5), drawn, WIDE)).toBe(false);
    });

    test("drawn as its density because its cells hold more than a window reads, it holds at its zoom whatever the viewport holds", () => {
        expect(windowHolds(WINDOW, at(10, 0, 110, 100), { density: LEFT, capped: true }, WIDE)).toBe(true);
        expect(windowHolds(WINDOW, at(10, 0, 110, 100, 2.5), { density: LEFT, capped: true }, WIDE)).toBe(false);
    });
});

describe("the density's notice", () => {
    /** The notice for a count, printed as the locale prints it. */
    const say = (n: number, count: string, about: boolean, unfiltered: boolean) =>
        schematicMessages.densityNotice({ n, count, name: "rack", about, unfiltered });

    test("how many rows it shades, and that zooming in draws them", () => {
        expect(say(20000, "20,000", false, false)).toBe("Density: 20,000 racks — zoom in to draw them");
        expect(say(1, "1", false, false)).toBe("Density: 1 rack — zoom in to draw it");
    });

    test("an estimate is about that many; the filters the index doesn't lead are said not applied", () => {
        expect(say(3400, "3,400", true, false)).toBe("Density: about 3,400 racks — zoom in to draw them");
        expect(say(3400, "3,400", true, true)).toBe("Density: about 3,400 racks, the filters not applied — zoom in to draw them");
    });
});
