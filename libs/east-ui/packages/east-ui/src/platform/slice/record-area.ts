/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Queries for e3's generated area index (#1385): a loose quadtree laid along a
 * Z-order curve (XZ-ordering), whose keys e3's `e3.recordIndex.area` files each
 * row under once. The twin of `record-interval.ts`.
 *
 * The index's domain is the square `[−cell·2²⁷, cell·2²⁷)` world units in 29
 * levels, a level-L cell `s_L = cell · 2^(28−L)` wide. A row is filed at the
 * deepest level whose cell is at least twice its box's larger side, in the cell
 * holding its box's centre, so its box lies within that cell grown by `s_L/4`
 * on each side (its loose bounds); its key is `m · 32 + L`, `m` the cell's
 * Morton code aligned to level 28 (x in the even bits, y in the odd). A row with
 * no place is `−1`; one outside the domain, not finite or larger than half of it
 * is the root's, `0`.
 */
import { FloatType, IntegerType, compareFor, none, parseFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";
import type { RecordSliceChoiceType } from "./record-types.js";

/** The area index's key field: the row's cell and level, after its leading fields. */
export const AREA_FIELD = "__area";

/** How an area index reads a row's box, as a binding's index metadata carries it. */
export interface AreaMarker {
    /** The row field holding the box's `x`. */
    readonly x: string;
    /** The row field holding its `y`. */
    readonly y: string;
    /** The row field holding its width; absent for a point. */
    readonly width?: string;
    /** The row field holding its height; absent for a point. */
    readonly height?: string;
    /** Whether `x`, `y` is the box's centre, rather than its minimum corner. */
    readonly centre: boolean;
    /** The finest cell's side in world units, a power of two. */
    readonly cell: number;
}

/** The marker's name for a box placed by its centre. */
const AREA_CENTRE = "__centre";
const AREA_ROLES = ["x", "y", "width", "height", "cell"] as const;
const floatText = printFor(FloatType);
const floatOf = parseFor(FloatType);

/**
 * The names of the struct `Data.bindPaged` marks an area index's `__area` with
 * in a binding's index metadata, as an interval's start is marked with a struct
 * naming its end: the box's fields in order — `x`, `y`, then `width` and
 * `height` when given — each named with its role (`x=…`), so one field may hold
 * two roles; `__centre` when the box is placed by its centre; and the cell's
 * power of two (`cell=…`).
 *
 * @param box - How the index reads a row's box
 * @returns The marker struct's field names, in order
 */
export function areaMarkerFields(box: AreaMarker): string[] {
    return [`x=${box.x}`, `y=${box.y}`,
        ...(box.width === undefined || box.height === undefined ? [] : [`width=${box.width}`, `height=${box.height}`]),
        ...(box.centre ? [AREA_CENTRE] : []), `cell=${floatText(box.cell)}`];
}

/**
 * Read an area index's box back from its `__area` marker's field names
 * ({@link areaMarkerFields}).
 *
 * @param names - The marker struct's field names
 * @returns The box, or `undefined` when the names are not an area marker's
 */
export function readAreaMarker(names: readonly string[]): AreaMarker | undefined {
    const roles = new Map<string, string>();
    let centre = false;
    for (const name of names) {
        if (name === AREA_CENTRE) {
            if (centre) return undefined;
            centre = true;
            continue;
        }
        const at = name.indexOf("=");
        const role = name.slice(0, Math.max(at, 0));
        if (at <= 0 || !(AREA_ROLES as readonly string[]).includes(role) || roles.has(role)) return undefined;
        roles.set(role, name.slice(at + 1));
    }
    const x = roles.get("x"), y = roles.get("y"), width = roles.get("width"), height = roles.get("height");
    const cell = floatOf(roles.get("cell") ?? "");
    if (x === undefined || y === undefined || (width === undefined) !== (height === undefined) || !cell.success || !(cell.value > 0)) return undefined;
    return { x, y, ...(width !== undefined && height !== undefined && { width, height }), centre, cell: cell.value };
}

/** The finest level: a level-28 cell is `cell` wide. */
export const AREA_FINEST_LEVEL = 28;

/** The `__area` an unplaced row files under, as its `.east` literal: the unplaced clause's one value. */
export const AREA_UNPLACED = printFor(IntegerType)(-1n);

/** The most searches a window takes a combination of leading values (§11.3). */
export const MAX_AREA_SEARCHES = 266;

/** A window's box in world units, the `window` clause's value. */
export type AreaWindow = Extract<ValueTypeOf<RecordSliceChoiceType>, { type: "window" }>["value"];

const integerText = printFor(IntegerType);
const keyOrder = compareFor(IntegerType);
const FINEST = BigInt(AREA_FINEST_LEVEL);

/**
 * The cells of a level whose loose bounds meet an interval, on one axis.
 *
 * @remarks
 * Every bound is exact: a cell's edges are multiples of its side, a power of
 * two, and its loose bounds a quarter of its side beyond them. A row placed by
 * its box's corner is filed by the centre its key function computes, `x + w/2`,
 * which rounds at most onto a cell's edge, never past one, so its box lies
 * within the loose bounds of the cell it is filed in, as a centred box's does.
 *
 * @param from - The interval's lower end
 * @param to - Its upper end
 * @param half - Half the domain's side
 * @param size - The level's cell side
 * @param count - The level's cells along the axis
 * @returns The cells' indices along the axis, ascending
 */
function cellsMeeting(from: number, to: number, half: number, size: number, count: number): number[] {
    const reach = size / 4;
    // A conservative span of candidates, each then held to the exact test.
    const lo = Math.max(0, Math.floor((from + half - size - reach) / size) - 1);
    const hi = Math.min(count - 1, Math.floor((to + half + reach) / size) + 1);
    const cells: number[] = [];
    for (let i = lo; i <= hi; i++) {
        const start = -half + i * size;
        if (start - reach <= to && start + size + reach >= from) cells.push(i);
    }
    return cells;
}

/** Each byte's bits spread to the even places of sixteen: a byte of one axis's half of a Morton code. */
const SPREAD = Array.from({ length: 256 }, (_, byte) => {
    let spread = 0;
    for (let bit = 0; bit < 8; bit++) spread |= ((byte >> bit) & 1) << (2 * bit);
    return spread;
});

/**
 * The Morton code of a level's cell, aligned to the finest level: a byte of
 * each axis at a time, as a raster of thousands of cells computes thousands.
 *
 * @param ix - The cell's index along x at its level, below `2 ** level`
 * @param iy - Its index along y
 * @param level - Its level
 * @returns x's bits in the even places, y's in the odd, shifted to level 28
 */
function morton(ix: number, iy: number, level: number): bigint {
    let code = 0n;
    for (let byte = 3; byte >= 0; byte--) {
        const shift = 8 * byte;
        code = (code << 16n) | BigInt(SPREAD[(ix >>> shift) & 255]! | (SPREAD[(iy >>> shift) & 255]! << 1));
    }
    return code << BigInt(2 * (AREA_FINEST_LEVEL - level));
}

/**
 * One cell of an area index that a window or a density raster searches
 * (§11.3, D25): its level, where it is, and the search its rows file under —
 * at the window's or the raster's own level, the range from its own key up to
 * its last descendant's, which holds every row filed at that level or finer
 * whose centre lies in it; at a coarser level, its exact key, which holds the
 * rows filed in it, their centres anywhere in it.
 */
export interface AreaCell {
    /** Its level. */
    readonly level: number;
    /** Its index along x, at its level. */
    readonly ix: number;
    /** Its index along y. */
    readonly iy: number;
    /** Its left edge, in world units. */
    readonly minX: number;
    /** Its top edge. */
    readonly minY: number;
    /** Its side, in world units: `cell · 2^(28 − level)`. */
    readonly side: number;
    /** The search its rows file under: a range at the window's or the raster's level, an exact key at a coarser one. */
    readonly query: ValueTypeOf<SeekQueryType>;
}

/** A level's cell, its search given: where it is, from its indices. */
function cellAt(level: number, ix: number, iy: number, half: number, side: number, query: ValueTypeOf<SeekQueryType>): AreaCell {
    return { level, ix, iy, minX: -half + ix * side, minY: -half + iy * side, side, query };
}

/**
 * Plan a window over an area index (§11.3): at most {@link MAX_AREA_SEARCHES}
 * disjoint key searches for one combination of the index's leading values,
 * which together hold every row whose box meets the window, each once — each
 * search a cell, where it is beside it, so a reader can weigh its count by
 * how much of the cell a view holds.
 *
 * 1. The window is the viewport grown by an eighth of its larger side on each
 *    side: the margin, which keeps a pan of that much in hand.
 * 2. `C` is the deepest level whose cell is at least an eighth of the window's
 *    larger side.
 * 3. At each level coarser than `C`, the exact key of each cell whose loose
 *    bounds meet the window. The root is searched whatever the window, since a
 *    row outside the domain, or not finite, files under it.
 * 4. At `C`, for each cell whose loose bounds meet the window, the range from
 *    its own key up to its last descendant's, which starts above the coarser
 *    cells sharing its corner that step 3 reads.
 *
 * Cells are never merged, so a cell's search is the same in every window that
 * holds it, and a pan searches only the cells it adds. What the searches hold
 * beyond the window — rows of a searched cell that the window misses — is the
 * reader's to draw or not.
 *
 * @param prefix - The `.east` literals of the index's leading fields, in order
 * @param box - The viewport, in world units: its minimum and maximum corners
 * @param cell - The index's finest cell's side, a power of two (its `area.cell`)
 * @returns The cells, in their searches' key order
 * @throws {Error} When the viewport is not finite or its maximum is below its
 *   minimum, or when `cell` is not a positive power of two
 */
export function areaCells(prefix: readonly string[], box: AreaWindow, cell: number): AreaCell[] {
    const { minX, minY, maxX, maxY } = box;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error("Choose a window with finite bounds");
    if (maxX < minX || maxY < minY) throw new Error("A window's maximum is below its minimum");
    if (!Number.isFinite(cell) || cell <= 0 || 2 ** Math.round(Math.log2(cell)) !== cell) {
        throw new Error(`An area index's cell is a positive power of two, not ${cell}`);
    }
    const margin = Math.max(maxX - minX, maxY - minY) / 8;
    const fromX = minX - margin, toX = maxX + margin, fromY = minY - margin, toY = maxY + margin;
    const larger = Math.max(toX - fromX, toY - fromY);
    const half = cell * 2 ** 27;
    let deepest = AREA_FINEST_LEVEL;
    while (deepest > 0 && cell * 2 ** (AREA_FINEST_LEVEL - deepest) < larger / 8) deepest--;
    const searches: { start: bigint; cell: AreaCell }[] = [];
    for (let level = 0; level <= deepest; level++) {
        const size = cell * 2 ** (AREA_FINEST_LEVEL - level);
        const count = 2 ** level;
        const xs = level === 0 ? [0] : cellsMeeting(fromX, toX, half, size, count);
        const ys = level === 0 ? [0] : cellsMeeting(fromY, toY, half, size, count);
        for (const ix of xs) {
            for (const iy of ys) {
                const m = morton(ix, iy, level);
                const start = m * 32n + BigInt(level);
                if (level < deepest) {
                    searches.push({ start, cell: cellAt(level, ix, iy, half, size, variant("fields", { values: [...prefix, integerText(start)], prefix: none })) });
                    continue;
                }
                const end = (m + 4n ** (FINEST - BigInt(level))) * 32n;
                const query = variant("range", { from: [...prefix, integerText(start)], to: [...prefix, integerText(end)] });
                searches.push({ start, cell: cellAt(level, ix, iy, half, size, query) });
            }
        }
    }
    return searches.sort((a, b) => keyOrder(a.start, b.start)).map(search => search.cell);
}

/**
 * Plan a window over an area index (§11.3): its searches, as
 * {@link areaCells} plans them, without where each cell is.
 *
 * @param prefix - The `.east` literals of the index's leading fields, in order
 * @param box - The viewport, in world units: its minimum and maximum corners
 * @param cell - The index's finest cell's side, a power of two (its `area.cell`)
 * @returns The searches, in key order
 * @throws {Error} As {@link areaCells} does
 */
export function areaQueries(prefix: readonly string[], box: AreaWindow, cell: number): ValueTypeOf<SeekQueryType>[] {
    return areaCells(prefix, box, cell).map(found => found.query);
}

/** The most counted ranges a density raster asks in one request (§10.4, D25). */
export const MAX_AREA_RASTER = 4096;

/** A density raster over a box (§10.4, D25): its level's cells, counted, and the coarser levels' cells, by exact key. */
export interface AreaRaster {
    /** Its level. */
    readonly level: number;
    /** Its cells' side, in world units. */
    readonly side: number;
    /**
     * Its cells that meet the box, row by row: each the range holding its own rows and every finer level's inside it, so
     * a row counts once, in the cell holding its centre.
     */
    readonly cells: readonly AreaCell[];
    /**
     * The coarser levels' cells whose loose bounds meet the box, in key order, each by its exact key: their rows are
     * boxes larger than half a raster cell, their centres anywhere in it, which the raster's ranges leave out — counted
     * by their keys and read as rows while they are few.
     */
    readonly coarse: readonly AreaCell[];
}

/**
 * Plan a density raster over an area index (§10.4, D25): the counts of its
 * cells at the level whose cells are about a sixty-fourth of the box's larger
 * side, for one combination of the index's leading values, and no row read.
 *
 * 1. The raster's level `R` is the deepest whose cell is at least a
 *    sixty-fourth of the box's larger side, coarser while its cells meeting
 *    the box number more than `budget`.
 * 2. Each level-`R` cell meeting the box is the range from its own key up to
 *    its last descendant's, as {@link areaQueries}' finest level is: it holds
 *    every row filed at `R` or finer whose centre lies in the cell, so a row
 *    counts once, in the cell holding its centre.
 * 3. At each level coarser than `R`, each cell whose loose bounds meet the
 *    box, the root among them, by its exact key: those rows are boxes larger
 *    than half a raster cell, which the ranges leave out — counted by their
 *    keys, and read as rows while they are few.
 *
 * @param prefix - The `.east` literals of the index's leading fields, in order
 * @param box - The box the raster covers, in world units
 * @param cell - The index's finest cell's side, a power of two (its `area.cell`)
 * @param budget - The most cells the raster takes
 * @returns The raster's level, its cells' side, its cells and the coarser levels' cells
 * @throws {Error} When the box is not finite or its maximum is below its minimum, when `cell` is not a positive power of
 *   two, or when `budget` is not a positive whole number
 */
export function areaRaster(prefix: readonly string[], box: AreaWindow, cell: number, budget: number = MAX_AREA_RASTER): AreaRaster {
    const { minX, minY, maxX, maxY } = box;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error("Choose a raster's box with finite bounds");
    if (maxX < minX || maxY < minY) throw new Error("A raster's box has its maximum below its minimum");
    if (!Number.isFinite(cell) || cell <= 0 || 2 ** Math.round(Math.log2(cell)) !== cell) {
        throw new Error(`An area index's cell is a positive power of two, not ${cell}`);
    }
    if (!Number.isInteger(budget) || budget < 1) throw new Error(`A raster takes at least one cell, not ${budget}`);
    const half = cell * 2 ** 27;
    const larger = Math.max(maxX - minX, maxY - minY);
    // The cells of a level whose own bounds meet an interval, on one axis: the first and the last, inside the domain.
    const span = (from: number, to: number, size: number, count: number): [number, number] | undefined => {
        const lo = Math.max(0, Math.floor((from + half) / size));
        const hi = Math.min(count - 1, Math.floor((to + half) / size));
        return hi < lo ? undefined : [lo, hi];
    };
    let level = AREA_FINEST_LEVEL;
    while (level > 0 && cell * 2 ** (AREA_FINEST_LEVEL - level) < larger / 64) level--;
    const sizeOf = (l: number) => cell * 2 ** (AREA_FINEST_LEVEL - l);
    const cellsAt = (l: number) => {
        const xs = span(minX, maxX, sizeOf(l), 2 ** l);
        const ys = span(minY, maxY, sizeOf(l), 2 ** l);
        return xs === undefined || ys === undefined ? 0 : (xs[1] - xs[0] + 1) * (ys[1] - ys[0] + 1);
    };
    while (level > 0 && cellsAt(level) > budget) level--;
    const side = sizeOf(level);
    const cells: AreaCell[] = [];
    const xs = span(minX, maxX, side, 2 ** level);
    const ys = span(minY, maxY, side, 2 ** level);
    if (xs !== undefined && ys !== undefined) {
        const descendants = 4n ** (FINEST - BigInt(level));
        for (let iy = ys[0]; iy <= ys[1]; iy++) {
            for (let ix = xs[0]; ix <= xs[1]; ix++) {
                const m = morton(ix, iy, level);
                const query = variant("range", { from: [...prefix, integerText(m * 32n + BigInt(level))], to: [...prefix, integerText((m + descendants) * 32n)] });
                cells.push(cellAt(level, ix, iy, half, side, query));
            }
        }
    }
    const coarse: { start: bigint; cell: AreaCell }[] = [];
    for (let l = 0; l < level; l++) {
        const size = sizeOf(l);
        const count = 2 ** l;
        for (const ix of l === 0 ? [0] : cellsMeeting(minX, maxX, half, size, count)) {
            for (const iy of l === 0 ? [0] : cellsMeeting(minY, maxY, half, size, count)) {
                const start = morton(ix, iy, l) * 32n + BigInt(l);
                coarse.push({ start, cell: cellAt(l, ix, iy, half, size, variant("fields", { values: [...prefix, integerText(start)], prefix: none })) });
            }
        }
    }
    return { level, side, cells, coarse: coarse.sort((a, b) => keyOrder(a.start, b.start)).map(search => search.cell) };
}
