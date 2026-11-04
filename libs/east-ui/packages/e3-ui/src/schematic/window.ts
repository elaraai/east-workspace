/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Schematic kind's reads by area (#1386, `Schematic Builder Spec.md` §10.4):
 * a kind's record read whole, or its narrowing read complete through its
 * source of the Schematic's `Slice.bindRecords`, are the reads every kind over
 * the app's record shares (`utils/record-kind.ts`). Reading by area — a
 * viewport's window from an area index alone, and the density at overview
 * (§10.4, #1393) — is the renderer's reader's, which reads a window by its
 * cells as the Plan's events are read (D41): what this module gives it is
 * which index and which searches a window reads
 * ({@link schematicAreaIndexes}, {@link schematicWindowPlan}), the agreement
 * of an area index's box with the kind's roles (SC34), and the density's
 * raster ({@link schematicRaster}); the kind's `rowsOf` makes the rows it
 * reads its stored rows.
 *
 * @packageDocumentation
 */

import {
    BooleanType, OptionType, SortedMap, StringType, StructType, compareFor, equalFor, some, variant,
    type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import {
    MAX_AREA_RASTER, MAX_LANDED_SEARCHES, MAX_RECORD_SLICE_RUNS, RecordSliceReadType,
    areaQueries, areaRaster, recordOnPrinter,
    type AreaCell, type AreaWindow, type RecordOnPrinter, type RecordSliceChoiceType, type RecordSliceIndexType,
} from "@elaraai/east-ui/internal";
import type { SchematicBoxFieldsType } from "./types.js";

/**
 * A kind's source of the Schematic's slice, as the payload hands it to the
 * kind: the source's typed record Slice handle, `Slice.bindRecords`' part
 * named after the kind's slot, bound once in the payload's block
 * (`recordSources(…).bind($)`, #1356). A kind's read reads its members inside
 * its function, so it holds this one source, never the whole slice.
 */
export type SchematicKindPart = ExprType<StructType>;

// ============================================================================
// Reading by area (§10.4, §11.4, #1393)
// ============================================================================

/** One index a record Slice's binding lists, decoded. */
type Index = ValueTypeOf<typeof RecordSliceIndexType>;
/** A record Slice's narrowing, decoded. */
type Where = ReadonlyMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>;
/** The fields a kind's box is, decoded. */
type BoxFields = ValueTypeOf<typeof SchematicBoxFieldsType>;

/**
 * Past this many rows in view, the canvas draws the density in place of items
 * (D25): by the counts its window's searches answer — each cell's rows held
 * evenly over it, the view's share of them — and, past those, by the
 * density's own count of the view, which its footer says.
 */
export const SCHEMATIC_WINDOW_ROWS = 5_000;

/**
 * The most rows a window's searches hold for its rows to be read (D25): its
 * view's, its margin's and its cells' reach past them, which hold some twice a
 * view's rows over an even floor — four views' worth. Past this, the window
 * draws its density whatever its view holds, and a zoom in plans one that
 * holds fewer.
 */
export const SCHEMATIC_WINDOW_READ_ROWS = 20_000;

const stringEqual = equalFor(StringType);
const compareString = compareFor(StringType);
const sideEqual = equalFor(OptionType(StringType));
const booleanEqual = equalFor(BooleanType);

/** A kind's area indexes (§10.4, D20): the one led by no field, and those led by fields beside it. */
export interface SchematicAreaIndexes {
    /** The area index led by no field: what reads the window whatever the rail chooses. */
    readonly unled: Index;
    /** The area indexes led by fields, in the order the source lists them: each reads a choice of its fields and the window in one. */
    readonly led: readonly Index[];
}

/** A box's fields and where it is placed, as a refusal names them. */
function boxText(box: { x: string; y: string; width: BoxFields["width"]; height: BoxFields["height"] }, centre: boolean): string {
    const sides = box.width.type === "some" && box.height.type === "some" ? `, width: "${box.width.value}", height: "${box.height.value}"` : "";
    return `x: "${box.x}", y: "${box.y}"${sides}, at: "${centre ? "centre" : "corner"}"`;
}

/**
 * The area indexes a kind is read by (§10.4, §11.4, SC34): those its source of
 * the slice lists, each held to the kind's roles — the same `x`, `y`, `width`
 * and `height` fields, at the centre for an item kind and the corner for a
 * zone kind — one led by no field among them.
 *
 * @param indexes - The indexes the kind's source lists (its config's)
 * @param box - The fields the kind's box is (its kind's `box`)
 * @param sort - The kind's sort: items are placed by their centre, zones by their corner
 * @param where - The kind, as a refusal names it
 * @returns Its area indexes; `undefined` for a source that lists none, through which the kind reads its narrowing complete
 * @throws {Error} When an area index's box isn't the kind's roles, naming both; when none is led by no field, naming the
 *   index to declare
 */
export function schematicAreaIndexes(indexes: readonly Index[], box: BoxFields, sort: "items" | "zones", where: string): SchematicAreaIndexes | undefined {
    const areas = indexes.filter((index) => index.area.type === "some");
    if (areas.length === 0) return undefined;
    const centre = sort === "items";
    for (const index of areas) {
        if (index.area.type !== "some") continue;
        const area = index.area.value;
        if (!stringEqual(area.x, box.x) || !stringEqual(area.y, box.y) || !sideEqual(area.width, box.width) || !sideEqual(area.height, box.height)
            || !booleanEqual(area.centre, centre)) {
            throw new Error(`${where}: the area index '${index.name}' boxes each row by { ${boxText(area, area.centre)} }, and the kind's roles place it by ` +
                `{ ${boxText(box, centre)} } — an area index the kind is read by boxes each row as its roles place it: declare it ` +
                `index.area({ ${boxText(box, centre)}, cell })`);
        }
    }
    // An area index's fields are its leading fields alone, its key's `on` (#1432).
    const unled = areas.find((index) => index.fields.length === 0);
    if (unled === undefined) {
        const named = areas.map((index) => `'${index.name}'`).join(", ");
        throw new Error(`${where}: a kind read by area reads its window through an area index led by no field, whatever the rail chooses, and ` +
            `${named} ${areas.length === 1 ? "is" : "are"} led by fields — declare index.area({ ${boxText(box, centre)}, cell }) ` +
            "beside it, and list it in Data.bindPaged's indexes");
    }
    return { unled, led: areas.filter((index) => index.fields.length > 0) };
}

/** Which area index a window reads, and how (§10.4, SC34). */
export interface SchematicWindowPlan {
    /** The index read. */
    readonly index: Index;
    /** Its finest cell's side, a power of two. */
    readonly cell: number;
    /** The `.east` literals of its leading values, a combination each, a window's searches asked of each: `[[]]` for the unled index. */
    readonly prefixes: readonly (readonly string[])[];
    /** The narrowing's fields the index doesn't lead, which `within` asks of the window's rows; none where it serves the narrowing whole. */
    readonly residual: readonly string[];
}

/**
 * Which area index a window reads (§10.4, SC34): one whose `on` the rail's
 * exact choices fill — each leading field a choice of values, one value for a
 * Set field — while its searches across those choices stay within the record
 * slice's bound on landed searches, the one leaving the fewest fields of the
 * narrowing to `within` first; otherwise the one led by no field, the
 * narrowing asked of the window's rows. The window is a read, never the
 * rail's: it is never a choice, and never counted.
 *
 * @param areas - The kind's area indexes ({@link schematicAreaIndexes})
 * @param where - The narrowing the window reads: the rail's, or none, to read every row
 * @param box - The window's box, in world units: its searches grow it by the margin (`areaQueries`)
 * @returns The index, its leading values and the fields left to `within`
 */
export function schematicWindowPlan(areas: SchematicAreaIndexes, where: Where, box: AreaWindow): SchematicWindowPlan {
    return areaPlan(areas, where, (index) => areaQueries([], box, cellOf(index), NO_LEADING).length);
}

/** The `on` of no leading field: a window asks the same cells whatever an index's leading values, so they are counted under none. */
const NO_LEADING = recordOnPrinter(StructType({}));

/** An area index's finest cell's side. */
function cellOf(index: Index): number {
    return index.area.type === "some" ? index.area.value.cell : 1;
}

/**
 * Which area index a read by area reads through (§10.4, SC34): one whose `on`
 * the narrowing's exact choices fill — each leading field a choice of values,
 * one value for a Set field — while the read's searches across those choices
 * stay within the record slice's bound on landed searches, the one leaving the
 * fewest fields of the narrowing to `within` first; otherwise the one led by
 * no field.
 *
 * @param areas - The kind's area indexes
 * @param where - The narrowing the read takes
 * @param searches - How many searches the read asks of each combination of an index's leading values
 * @returns The index, its leading values and the fields left to `within`
 */
function areaPlan(areas: SchematicAreaIndexes, where: Where, searches: (index: Index) => number): SchematicWindowPlan {
    let best: SchematicWindowPlan | undefined;
    for (const index of areas.led) {
        const leading = index.fields;
        let prefixes: string[][] = [[]];
        let fills = true;
        for (const field of leading) {
            const choice = where.get(field);
            const values = choice?.type === "values" ? [...new Set(choice.value)] : [];
            if (values.length === 0 || (index.sets.has(field) && values.length !== 1) || prefixes.length * values.length > MAX_RECORD_SLICE_RUNS) {
                fills = false;
                break;
            }
            prefixes = prefixes.flatMap((prefix) => values.map((value) => [...prefix, value]));
        }
        if (!fills || prefixes.length * searches(index) > MAX_LANDED_SEARCHES) continue;
        const residual = [...where.keys()].filter((field) => !leading.some((led) => stringEqual(led, field)));
        if (best === undefined || residual.length < best.residual.length) best = { index, cell: cellOf(index), prefixes, residual };
    }
    return best ?? { index: areas.unled, cell: cellOf(areas.unled), prefixes: [[]], residual: [...where.keys()] };
}

/** How a kind read by area reads its rows with no position: the read it asks, and the fields it leaves to `within`. */
export interface SchematicUnplacedPlan {
    /** The index read. */
    readonly index: Index;
    /**
     * The read it asks (`pageWhere`, `countWhere`): the narrowing's choices of the fields the index leads, and beside them
     * the unplaced clause (#1432).
     */
    readonly read: ValueTypeOf<typeof RecordSliceReadType>;
    /** The narrowing's fields the index doesn't lead, which `within` asks of the rows read; none where it serves the narrowing whole. */
    readonly residual: readonly string[];
}

/**
 * How a kind read by area reads its rows with no position — its Backlog's
 * (§8, §11.4, #1393): through the area index the window would read through
 * ({@link schematicWindowPlan}'s rule, one search a combination of its leading
 * values), the narrowing's choices of the fields it leads beside the unplaced
 * clause; the narrowing's other fields left to `within`, asked of the rows
 * read. The unplaced clause is offered only by an index whose `x` and `y` are
 * Options, as a kind with a backlog boxes its rows.
 *
 * @param areas - The kind's area indexes ({@link schematicAreaIndexes})
 * @param where - The narrowing: the rail's
 * @returns The index, the narrowing a read takes and the fields left to `within`
 */
export function schematicUnplacedPlan(areas: SchematicAreaIndexes, where: Where): SchematicUnplacedPlan {
    const plan = areaPlan(areas, where, () => 1);
    const taken = new SortedMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>([], compareString);
    for (const [field, choice] of where) if (plan.index.fields.some((name) => stringEqual(name, field))) taken.set(field, choice);
    return { index: plan.index, read: { where: taken, area: some(variant("unplaced", null)) }, residual: plan.residual };
}

/** A window's density raster (§10.4, D25): one level's cells, counted, a combination of the index's leading values at a time. */
export interface SchematicRaster {
    /** Its level. */
    readonly level: number;
    /** Its cells' side, in world units. */
    readonly side: number;
    /** Each combination's cells, in the plan's order of its prefixes: through a led index, a raster per value. */
    readonly cells: readonly (readonly AreaCell[])[];
    /**
     * The coarser levels' cells, every combination's: their rows are boxes larger than half a raster cell, counted by their
     * keys, and read as rows while they are few.
     */
    readonly coarse: readonly AreaCell[];
}

/**
 * A window's density raster (§10.4, D25): the counts of its area index's cells
 * at the level whose cells are about a sixty-fourth of the box, each
 * combination of its leading values a raster of its own, all of them in at
 * most {@link MAX_AREA_RASTER} counted ranges, and the coarser levels' cells by
 * exact key.
 *
 * @param plan - The window's plan ({@link schematicWindowPlan})
 * @param box - The box the raster covers, in world units
 * @param printOn - The plan's index's `on` printer: the coarser cells' searches name its leading values as one (#1432)
 * @returns The raster
 */
export function schematicRaster(plan: SchematicWindowPlan, box: AreaWindow, printOn: RecordOnPrinter): SchematicRaster {
    const budget = Math.max(1, Math.floor(MAX_AREA_RASTER / plan.prefixes.length));
    const rasters = plan.prefixes.map((prefix) => areaRaster(prefix, box, plan.cell, printOn, budget));
    // The same box, cell and budget: every combination's raster is at one level.
    const first = rasters[0]!;
    return { level: first.level, side: first.side, cells: rasters.map((raster) => raster.cells), coarse: rasters.flatMap((raster) => raster.coarse) };
}

/** One cell of a window's density raster that holds rows (D25): its corner, in world units, and how many rows it holds. */
export interface SchematicDensityCell {
    /** Its left edge. */
    readonly minX: number;
    /** Its top edge. */
    readonly minY: number;
    /** How many rows' centres it holds — some of them a coarser cell's rows' share, spread over it. */
    readonly count: number;
}

/**
 * A window's density raster's cells that hold rows (§10.4, D25): each cell's
 * count, every combination's raster added up cell by cell — they are all at one
 * level, over one box — and, given the coarser levels' counts where their rows
 * are too many to read, each coarser cell's rows spread evenly over the raster
 * cells it covers: a row's centre lies anywhere in the cell it is filed in. A
 * cell holds rows while it holds at least half of one.
 *
 * @param raster - The raster ({@link schematicRaster})
 * @param counts - Each of its cells' count, every combination's cells in turn, as `raster.cells` lists them
 * @param spread - Each of its coarser cells' count, as `raster.coarse` lists them, to spread over it; `undefined` while
 *   their rows are read as rows
 * @returns The cells that hold rows, row by row
 * @throws {Error} When the counts are not one a cell
 */
export function schematicDensityCells(raster: SchematicRaster, counts: readonly bigint[], spread?: readonly bigint[]): SchematicDensityCell[] {
    const grid = raster.cells[0] ?? [];
    const total = raster.cells.reduce((sum, cells) => sum + cells.length, 0);
    if (counts.length !== total || (spread !== undefined && spread.length !== raster.coarse.length)) {
        throw new Error(`A density raster of ${total} cells and ${raster.coarse.length} coarser ones was counted ${counts.length} and ${spread?.length ?? 0}`);
    }
    if (grid.length === 0) return [];
    // Every combination's raster is the same grid, row by row: a cell's place in it is its place in each.
    const x0 = grid[0]!.ix, y0 = grid[0]!.iy, x1 = grid[grid.length - 1]!.ix, y1 = grid[grid.length - 1]!.iy;
    const across = x1 - x0 + 1;
    const held = new Float64Array(grid.length);
    let at = 0;
    for (const cells of raster.cells) for (let i = 0; i < cells.length; i++) held[i] = held[i]! + Number(counts[at++]!);
    raster.coarse.forEach((cell, i) => {
        const count = spread === undefined ? 0 : Number(spread[i]!);
        if (count === 0) return;
        // A cell `d` levels coarser covers 2^d raster cells a side: each holds its share of the cell's rows.
        const span = 2 ** (raster.level - cell.level);
        const share = count / (span * span);
        const fromX = Math.max(x0, cell.ix * span), toX = Math.min(x1, (cell.ix + 1) * span - 1);
        const fromY = Math.max(y0, cell.iy * span), toY = Math.min(y1, (cell.iy + 1) * span - 1);
        for (let iy = fromY; iy <= toY; iy++) {
            for (let ix = fromX; ix <= toX; ix++) {
                const k = (iy - y0) * across + (ix - x0);
                held[k] = held[k]! + share;
            }
        }
    });
    return grid.flatMap((cell, i) => (held[i]! >= 0.5 ? [{ minX: cell.minX, minY: cell.minY, count: held[i]! }] : []));
}
