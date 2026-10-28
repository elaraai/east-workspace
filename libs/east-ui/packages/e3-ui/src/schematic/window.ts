/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Schematic kind's reads (#1386, `Schematic Builder Spec.md` §10.4): its
 * record read whole, or its narrowing read complete through its source of the
 * Schematic's `Slice.bindRecords` — the record slice's `PagedScan`, over
 * `recordSliceReadPlatform` — each answering `none` while a read is in flight.
 * Reading by area — a viewport's window from an area index alone, and the
 * density at overview (§10.4, #1393) — is the renderer's reader's, which reads
 * a window by its cells as the Plan's events are read (D41): what this module
 * gives it is which index and which searches a window reads
 * ({@link schematicAreaIndexes}, {@link schematicWindowPlan}), the agreement
 * of an area index's box with the kind's roles (SC34), and the density's
 * raster ({@link schematicRaster}); the kind's `rowsOf` makes the rows it
 * reads its stored rows.
 *
 * Through its source a kind reads what its narrowing holds and nothing else:
 * the source's choices, each as the rail holds it. Under `narrowed="dim"` it
 * reads every row through its source instead, and never the narrowing, so a
 * choice reads none of its rows again: the renderer draws the rows the
 * narrowing leaves out as context, from the source's shown keys (§10.3,
 * #1392). An entry's row is its `row` — the source joins it — or its `value`,
 * for an index that carries the whole row (D29).
 *
 * @packageDocumentation
 */

import {
    BooleanType, DictType, East, Expr, IntegerType, OptionType, SortedMap, StringType, compareFor, equalFor, isSubtype, isTypeEqual, none, some, variant,
    type ArrayType, type EastType, type ExprType, type FunctionType, type StructType, type ValueTypeOf,
} from "@elaraai/east";
import {
    AREA_FIELD, AREA_UNPLACED, MAX_AREA_RASTER, MAX_LANDED_SEARCHES, MAX_RECORD_SLICE_RUNS, RecordSliceBindType, RecordSliceConfigType, RecordSliceStateType,
    RecordSliceWhereType, areaQueries, areaRaster, recordSliceReadPlatform,
    type AreaCell, type AreaWindow, type RecordSliceChoiceType, type RecordSliceIndexType,
} from "@elaraai/east-ui/internal";
import { optionOf } from "../schedule/window.js";
import type { SchematicBoxFieldsType } from "./types.js";

/**
 * A kind's source of the Schematic's slice, as the payload hands it to the
 * kind: the source's typed record Slice handle, `Slice.bindRecords`' part
 * named after the kind's slot, bound once in the payload's block
 * (`recordSources(…).bind($)`, #1356). A kind's read reads its members inside
 * its function, so it holds this one source, never the whole slice.
 */
export type SchematicKindPart = ExprType<StructType>;

/** A kind's rows, by key: what a read of it gives; `none` while it is in flight. */
type RowsRead = ExprType<FunctionType<[], OptionType<DictType<StringType, EastType>>>>;

/**
 * A kind's record read whole: its binding's `read()` — `Record.bind`'s or
 * `Data.bind`'s — by key.
 *
 * @param handle - The record's binding
 * @param rowType - Its row type
 * @returns `()` → the record's rows, by key
 */
export function schematicWholeRows(handle: ExprType<EastType>, rowType: StructType): RowsRead {
    const Held = DictType(StringType, rowType);
    const read = (handle as unknown as { read: () => ExprType<DictType<StringType, StructType>> }).read;
    return East.function([], OptionType(Held), (_$) => East.value(some(read()), OptionType(Held))) as unknown as RowsRead;
}

/**
 * A kind's narrowing read complete through its source of the slice (see the
 * module docs).
 *
 * @param part - The kind's source of the slice, bound in the payload
 * @param slot - The kind's slot, which names the source
 * @param rowType - The kind's record's row type
 * @param where - The kind, as a refusal names it
 * @param every - Whether it reads every row, the narrowing read nowhere: under `narrowed="dim"`, what the narrowing
 *   leaves out draws as context
 * @returns `()` → the rows the narrowing holds — or every row — by key; `none` while a search or a page is in flight
 * @throws {Error} When the source narrows another record, or reads neither its rows nor an index carrying them
 */
export function schematicSourceRows(part: SchematicKindPart, slot: string, rowType: StructType, where: string, every = false): RowsRead {
    const type = Expr.type(part as unknown as Expr) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : {};
    const data = fields["data"];
    const page = fields["pageWhere"];
    const output = page?.type === "Function" ? page.output : undefined;
    const collection = output === undefined ? undefined : optionOf(output);
    const entry = collection?.type === "Array" ? collection.value as EastType : undefined;
    const entryFields = entry?.type === "Struct" ? entry.fields as Record<string, EastType> : undefined;
    const keyed = entryFields?.["key"] !== undefined && isTypeEqual(entryFields["key"], StringType);
    // An entry's row: its `row`, which a joined read fills, or its `value`, when the index carries the whole row (D29).
    const joined = entryFields?.["row"] !== undefined && isTypeEqual(entryFields["row"], OptionType(rowType));
    const carried = entryFields?.["value"] !== undefined && isTypeEqual(entryFields["value"], rowType);
    const pages = page?.type === "Function" && page.inputs.length === 3 && isTypeEqual(page.inputs[0]!, RecordSliceWhereType)
        && isTypeEqual(page.inputs[1]!, IntegerType) && isTypeEqual(page.inputs[2]!, IntegerType);
    const identified = data?.type === "Struct" && data.fields["id"] !== undefined && isTypeEqual(data.fields["id"], StringType)
        && data.fields["revision"] !== undefined && data.fields["revision"].type === "Function";
    const sliced = Object.entries(RecordSliceBindType.fields).every(([name, expected]) => fields[name] !== undefined && isSubtype(fields[name]!, expected));
    if (!pages || !keyed || !(joined || carried) || !identified || !sliced) {
        throw new Error(`${where}: the slice's source "${slot}" narrows another record — name it after this kind's slot, over the kind's own record: ` +
            `Data.bindPaged(record, { indexes }), its rows joined or carried by its indexes`);
    }
    const Held = DictType(StringType, rowType);
    const Entries = collection as ArrayType<StructType<{ key: StringType; row: OptionType<EastType>; value: EastType }>>;
    const noRows = `${where}: the slice's source "${slot}" reads no rows — bind it with Data.bindPaged(record, { indexes, join: true })`;
    return East.function([], OptionType(Held), ($) => {
        // The source as the payload bound it, its members read here: the read captures the source alone.
        const source = $.const(part as unknown as ExprType<StructType<{
            config: RecordSliceConfigType;
            read: FunctionType<[], RecordSliceStateType>;
            countWhere: FunctionType<[RecordSliceWhereType], OptionType<IntegerType>>;
            pageWhere: FunctionType<[RecordSliceWhereType, IntegerType, IntegerType], OptionType<typeof Entries>>;
            data: StructType<{ id: StringType; revision: FunctionType<[], OptionType<StringType>> }>;
        }>>);
        const countWhere = $.const(source.countWhere);
        const pageWhere = $.const(source.pageWhere);
        const id = $.const(source.data.id);
        const revision = $.const(source.data.revision);
        // The narrowing the read takes: none under `dim` — every row, the source's state read nowhere, so a choice reads
        // nothing again and the renderer dims what it leaves out (§10.3) — else the rail's, each of the source's choices.
        let taken: ExprType<typeof RecordSliceWhereType>;
        if (every) {
            taken = $.const(new Map(), RecordSliceWhereType);
        } else {
            const read = $.const(source.read);
            const state = $.const(read());
            taken = $.const(state.where);
        }
        const result = $.let(none, OptionType(Held));
        $.match(recordSliceReadPlatform([Entries], id, revision, countWhere, pageWhere, taken), {
            some: ($2, entries) => {
                const held = $2.let(new Map(), Held);
                $2.for(entries, ($3, e) => {
                    if (joined) {
                        $3.match(e.row, {
                            some: ($4, row) => { $4(held.insert(e.key, row as never)); },
                            none: ($4) => {
                                if (carried) $4(held.insert(e.key, e.value as never));
                                else $4.error(noRows);
                            },
                        });
                    } else {
                        $3(held.insert(e.key, e.value as never));
                    }
                });
                $2.assign(result, some(held));
            },
        });
        return result;
    }) as unknown as RowsRead;
}

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
                `e3.recordIndex.area(name, record, { ${boxText(box, centre)}, cell })`);
        }
    }
    const unled = areas.find((index) => index.fields.length === 1);
    if (unled === undefined) {
        const named = areas.map((index) => `'${index.name}'`).join(", ");
        throw new Error(`${where}: a kind read by area reads its window through an area index led by no field, whatever the rail chooses, and ` +
            `${named} ${areas.length === 1 ? "is" : "are"} led by fields — declare e3.recordIndex.area(name, record, { ${boxText(box, centre)}, cell }) ` +
            "beside it, and list it in Data.bindPaged's indexes");
    }
    return { unled, led: areas.filter((index) => index.fields.length > 1) };
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
    return areaPlan(areas, where, (index) => areaQueries([], box, cellOf(index)).length);
}

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
        const leading = index.fields.slice(0, -1);
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

/** How a kind read by area reads its rows with no position: the narrowing a read takes, and the fields it leaves to `within`. */
export interface SchematicUnplacedPlan {
    /** The index read. */
    readonly index: Index;
    /**
     * The narrowing a read takes (`pageWhere`, `countWhere`): the narrowing's choices of the fields the index leads, and the
     * unplaced clause under `__area`.
     */
    readonly where: ValueTypeOf<typeof RecordSliceWhereType>;
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
    const led = plan.index.fields.slice(0, -1);
    const taken = new SortedMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>([], compareString);
    for (const [field, choice] of where) if (led.some((name) => stringEqual(name, field))) taken.set(field, choice);
    taken.set(AREA_FIELD, variant("values", [AREA_UNPLACED]));
    return { index: plan.index, where: taken, residual: plan.residual };
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
 * @returns The raster
 */
export function schematicRaster(plan: SchematicWindowPlan, box: AreaWindow): SchematicRaster {
    const budget = Math.max(1, Math.floor(MAX_AREA_RASTER / plan.prefixes.length));
    const rasters = plan.prefixes.map((prefix) => areaRaster(prefix, box, plan.cell, budget));
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
