/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bucket cell's fold (#1267), as `fitTiles` decides it from what the cell
 * measured: every tile when all fit; else the run from the first that fits
 * beside the `+n` chip, the rest folded; the chip alone when none fits; a lone
 * tile never folded, nor the tile the cell keeps — beside the chip, shrunk to
 * its floor at least, or alone while the chip waits — unless the cell has no
 * room for one tile at the least it draws: then every tile folds, and the chip
 * is the cell's one part (#1276).
 */

import { describe, test, expect } from "vitest";
import { fitTiles, type TileCellMeasure } from "./tile-fold.js";

/** Three tiles in a week's cell, 5px apart, as the Plan's are: a ✓ (20), a proposal's grip and `plan` (45), and `S-A` (28); the chip 24px after a 5px gap; a tile's floor 20px, and the least it draws 3px. */
const cell = (room: number): TileCellMeasure => ({ room, tiles: [20, 45, 28], gap: 5, more: 29, floor: 20, least: 3 });

describe("fitTiles (#1267)", () => {
    test("every tile fits: each shows, and no chip", () => {
        // 20 + 45 + 28, and two gaps: 103.
        expect(fitTiles(cell(103), undefined)).toEqual({ shown: [0, 1, 2], folded: 0, chip: false, noRoom: false });
    });

    test("a fit is to a hundredth of a pixel: the room is measured, not rounded", () => {
        expect(fitTiles(cell(102.995), undefined).folded).toBe(0);
        expect(fitTiles(cell(102.98), undefined).folded).toBeGreaterThan(0);
    });

    test("short of room, the run from the first that fits beside the chip shows, and the chip counts the rest", () => {
        // Beside the chip: 100 less 29. The ✓ (20) and the proposal (5 + 45) take 70; `S-A` folds.
        expect(fitTiles(cell(100), undefined)).toEqual({ shown: [0, 1], folded: 1, chip: true, noRoom: false });
        // The ✓ alone beside it: the proposal after it doesn't fit.
        expect(fitTiles(cell(60), undefined)).toEqual({ shown: [0], folded: 2, chip: true, noRoom: false });
    });

    test("a tile after one that folded folds too, though it would fit: the run is in the cell's order", () => {
        expect(fitTiles({ room: 70, tiles: [20, 45, 10], gap: 5, more: 29, floor: 20, least: 3 }, undefined)).toEqual({ shown: [0], folded: 2, chip: true, noRoom: false });
    });

    test("when none fits beside the chip, the chip alone counts them all", () => {
        expect(fitTiles(cell(40), undefined)).toEqual({ shown: [], folded: 3, chip: true, noRoom: false });
    });

    test("a lone tile never folds while its cell has room for it — shrunk to that room, down to the least a tile draws", () => {
        expect(fitTiles({ room: 12, tiles: [45], gap: 5, more: 29, floor: 20, least: 3 }, undefined)).toEqual({ shown: [0], folded: 0, chip: false, noRoom: false });
        expect(fitTiles({ room: 3, tiles: [45], gap: 5, more: 29, floor: 3, least: 3 }, undefined)).toEqual({ shown: [0], folded: 0, chip: false, noRoom: false });
        expect(fitTiles({ room: 12, tiles: [], gap: 5, more: 29, floor: 20, least: 3 }, undefined)).toEqual({ shown: [], folded: 0, chip: false, noRoom: false });
    });

    test("a cell with no room for one tile — less than the least it draws — folds every tile into its chip, the cell's one part (#1276)", () => {
        // A lone tile in a cell at its floor: no room at all.
        expect(fitTiles({ room: 0, tiles: [45], gap: 5, more: 29, floor: 0, least: 3 }, undefined)).toEqual({ shown: [], folded: 1, chip: true, noRoom: true });
        expect(fitTiles({ room: 2.98, tiles: [20], gap: 5, more: 29, floor: 2.98, least: 3 }, undefined)).toEqual({ shown: [], folded: 1, chip: true, noRoom: true });
        // Three tiles: the chip counts them all, and a kept tile, which could not draw, folds with them.
        expect(fitTiles(cell(2), undefined)).toEqual({ shown: [], folded: 3, chip: true, noRoom: true });
        expect(fitTiles(cell(2), 1)).toEqual({ shown: [], folded: 3, chip: true, noRoom: true });
        // A tile whose whole width is narrower than the least draws whole in its own.
        expect(fitTiles({ room: 2, tiles: [2], gap: 5, more: 29, floor: 2, least: 3 }, undefined)).toEqual({ shown: [0], folded: 0, chip: false, noRoom: false });
    });

    test("the kept tile never folds: it takes its place first, and the run from the first fills the rest", () => {
        // `S-A` kept (28), then the ✓ (5 + 20): 53 of 71; the proposal folds.
        expect(fitTiles(cell(100), 2)).toEqual({ shown: [0, 2], folded: 1, chip: true, noRoom: false });
        // The proposal kept (45), then the ✓ (5 + 20): 70 of 71.
        expect(fitTiles(cell(100), 1)).toEqual({ shown: [0, 1], folded: 1, chip: true, noRoom: false });
    });

    test("the kept tile beside the chip shrinks to the room there when its whole width has none — down to its floor", () => {
        // 60 less 29 leaves 31: the proposal (45) shrinks to it, and nothing else fits.
        expect(fitTiles(cell(60), 1)).toEqual({ shown: [1], folded: 2, chip: true, noRoom: false });
        // 49 less 29 leaves 20: its floor, exactly.
        expect(fitTiles(cell(49), 1)).toEqual({ shown: [1], folded: 2, chip: true, noRoom: false });
    });

    test("with no room beside the chip for the kept tile's floor, the kept tile shows alone and the chip waits", () => {
        // 40 less 29 leaves 11, under the 20px floor.
        expect(fitTiles(cell(40), 1)).toEqual({ shown: [1], folded: 2, chip: false, noRoom: false });
        // A cell narrower than the floor itself floors the tile at the cell: the ✓ kept at 12px.
        expect(fitTiles({ room: 12, tiles: [12, 12], gap: 5, more: 29, floor: 12, least: 3 }, 0)).toEqual({ shown: [0], folded: 1, chip: false, noRoom: false });
    });

    test("a kept index out of range keeps nothing", () => {
        expect(fitTiles(cell(100), -1)).toEqual({ shown: [0, 1], folded: 1, chip: true, noRoom: false });
        expect(fitTiles(cell(100), 7)).toEqual({ shown: [0, 1], folded: 1, chip: true, noRoom: false });
    });
});
