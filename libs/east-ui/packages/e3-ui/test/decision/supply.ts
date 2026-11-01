/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The decision queue's example app's supply side (#1454, `Decision Queue
 * Spec.md` §5.3): records no builder draws, each drawn by a target of the
 * queue's own — the stock orders, which a projection reads by each option's
 * own forecast; one item's stock across the stores, read as a mix; the
 * catalogue's minimum stock, a rule across its ranges, each range's items
 * counted through an index on it; and the service rounds' areas, each in a
 * round — and the patch a model writes of each, built with East's own diff of
 * the rows it touches, as `changes.ts` builds the builders'. Every name and
 * figure is generated.
 */
import { BooleanType, DictType, FloatType, SortedMap, StringType, StructType, diffFor, type ValueTypeOf } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { byString } from "./changes.js";

// ============================================================================
// The stock orders, which a projection reads by each option's own forecast
// ============================================================================

/** A week of an option's forecast: the units the model expects on hand then. */
export const ForecastPoint = StructType({ week: FloatType, units: FloatType });

/** An order of stock: the item, the week it lands in and how many units. */
export const StockOrder = StructType({ item: StringType, week: FloatType, units: FloatType });

/** A forecast, from its weeks and the units on hand in each. */
function forecast(points: readonly (readonly [number, number])[]): ValueTypeOf<typeof ForecastPoint>[] {
    return points.map(([week, units]) => ({ week, units }));
}

/** The C5 envelopes on hand with no order: through their 400-unit minimum in week 11, and out early in week 12. */
export const c5NoOrder = forecast([[9, 1_200], [10, 820], [11, 440], [12, 60], [12.16, 0], [16, 0]]);
/** With 1,500 units landing in week 11: above the minimum through week 15. */
export const c5Order1500 = forecast([[9, 1_200], [10, 820], [11, 440], [11, 1_940], [12, 1_560], [13, 1_180], [14, 800], [15, 420], [16, 40]]);
/** With 2,000 landing in week 11: above it through week 16. */
export const c5Order2000 = forecast([[9, 1_200], [10, 820], [11, 440], [11, 2_440], [12, 2_060], [13, 1_680], [14, 1_300], [15, 920], [16, 540]]);

/** The stock orders' patch, as a model diffs the rows it touches. */
const diffOrders = diffFor(DictType(StringType, StockOrder));

/** The stock orders' patch booking `units` of the C5 envelopes for week 11; `undefined` books none, a patch that changes nothing. */
export function stockOrderPatch(units: number | undefined) {
    const empty = new SortedMap<string, ValueTypeOf<typeof StockOrder>>([], byString);
    return diffOrders(empty, units === undefined ? empty : new SortedMap([["c5-w11", { item: "C5 envelopes", week: 11, units }]], byString));
}

/** The stock orders, booked through their patch door. */
export const stockOrders = e3.record("stock_orders", DictType(StringType, StockOrder), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// ============================================================================
// One item's stock across the stores, read as a mix
// ============================================================================

/** One item's stock at a store: the store's name and the units it holds. */
export const StoreStock = StructType({ store: StringType, units: FloatType });

/** The C5 envelopes' stock at the five stores: 12,000 units. */
export const storeStockRows: SortedMap<string, ValueTypeOf<typeof StoreStock>> = new SortedMap<string, ValueTypeOf<typeof StoreStock>>([
    ["harbour", { store: "Harbour", units: 3_800 }],
    ["hillside", { store: "Hillside", units: 3_000 }],
    ["market", { store: "Market St", units: 2_400 }],
    ["riverside", { store: "Riverside", units: 1_600 }],
    ["station", { store: "Station Rd", units: 1_200 }],
], byString);

/** The stores' patch, as a model diffs the rows it touches. */
const diffStock = diffFor(DictType(StringType, StoreStock));

/** The stores' patch moving stock between them, each store named to the units it holds after: the patch of those rows alone. */
export function stockSplitPatch(changes: readonly (readonly [string, number])[]) {
    const before = new SortedMap(changes.map(([key]) => [key, storeStockRows.get(key)!] as const), byString);
    const after = new SortedMap(changes.map(([key, units]) => [key, { ...storeStockRows.get(key)!, units }] as const), byString);
    return diffStock(before, after);
}

/** The stores' stock, written through its patch door. */
export const storeStock = e3.record("store_stock", DictType(StringType, StoreStock), {
    initial: storeStockRows,
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// ============================================================================
// The catalogue's minimum stock, a rule across its ranges
// ============================================================================

/** An item of the catalogue: its name, its range and the stock it is reordered at. */
export const CatalogueItem = StructType({ name: StringType, range: StringType, min: FloatType });

/** The catalogue's ranges, each with how many items it holds: 2,470 in all. */
const RANGES: readonly (readonly [string, number])[] = [["Envelopes", 980], ["Labels", 410], ["Folders", 520], ["Notebooks", 300], ["Cards", 260]];

/** An item's key: its range's first three letters and its number in it, `env-0042`. */
function itemKey(range: string, n: number): string {
    return `${range.substring(0, 3).toLowerCase()}-${String(n).padStart(4, "0")}`;
}

/** The catalogue's items: each range's numbered from 1, their minimums 100 to 400 units. */
export const catalogueRows: SortedMap<string, ValueTypeOf<typeof CatalogueItem>> = new SortedMap<string, ValueTypeOf<typeof CatalogueItem>>(
    RANGES.flatMap(([range, count]) => Array.from({ length: count }, (_, i): [string, ValueTypeOf<typeof CatalogueItem>] =>
        [itemKey(range, i + 1), { name: `${range} ${i + 1}`, range, min: (i % 4 + 1) * 100 }])),
    byString,
);

/** The catalogue's patch, as a model diffs the rows it touches. */
const diffItems = diffFor(DictType(StringType, CatalogueItem));

/**
 * The catalogue's patch moving the minimum of the first items of each range given by a share of it — `[range, items,
 * by]`, `by` 0.08 for 8% more — each whole: the patch of those rows alone.
 */
export function minimumsPatch(moves: readonly (readonly [string, number, number])[]) {
    const moved = moves.flatMap(([range, items, by]) => Array.from({ length: items }, (_, i) => {
        const key = itemKey(range, i + 1);
        const row = catalogueRows.get(key)!;
        return [key, row, { ...row, min: Math.round(row.min * (1 + by)) }] as const;
    }));
    return diffItems(new SortedMap(moved.map(([key, row]) => [key, row] as const), byString),
        new SortedMap(moved.map(([key, , after]) => [key, after] as const), byString));
}

/** The catalogue, written through its patch door, its items indexed by range: what a rule's groups are counted through. */
export const catalogue = e3.record("catalogue", DictType(StringType, CatalogueItem), {
    initial: catalogueRows,
    indexes: (index) => ({
        catalogue_by_range: index.on(["range"]),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// ============================================================================
// The service rounds' areas, each in a round
// ============================================================================

/** An area the service rounds cover: the round it is in, its column and row on the map, and whether a round starts from it. */
export const ServiceArea = StructType({ round: StringType, column: FloatType, row: FloatType, depot: BooleanType });

/**
 * The rounds' map, a line of it a row: `a` or `b` an area of round A or B, `A` or `B` one its round starts from, `>` one
 * of round A on the boundary, which a model moves to B, and `.` no area.
 */
const ROUNDS_MAP = ["..aaaa>bbb..", "aAaaa>>bbbb.", "aaaaa>>bbBb.", ".aaaaa>bbbb."];

/** An area's key: its column's letter and its row's number, `G2`. */
function areaKey(column: number, row: number): string {
    return `${"ABCDEFGHIJKL".charAt(column)}${row + 1}`;
}

/** The rounds' 40 areas: 25 in round A and 15 in round B. */
export const serviceAreaRows: SortedMap<string, ValueTypeOf<typeof ServiceArea>> = new SortedMap<string, ValueTypeOf<typeof ServiceArea>>(
    ROUNDS_MAP.flatMap((line, row) => [...line].flatMap((cell, column): [string, ValueTypeOf<typeof ServiceArea>][] => (cell === "." ? [] : [[
        areaKey(column, row), { round: cell === "b" || cell === "B" ? "b" : "a", column, row, depot: cell === "A" || cell === "B" },
    ]]))),
    byString,
);

/** The six areas of round A on its boundary with round B. */
export const boundaryAreas: readonly string[] = ROUNDS_MAP.flatMap((line, row) => [...line].flatMap((cell, column) => (cell === ">" ? [areaKey(column, row)] : [])));

/** The areas' patch, as a model diffs the rows it touches. */
const diffAreas = diffFor(DictType(StringType, ServiceArea));

/** The areas' patch moving each area named into the round given: the patch of those rows alone. */
export function roundsPatch(keys: readonly string[], round: string) {
    return diffAreas(new SortedMap(keys.map((key) => [key, serviceAreaRows.get(key)!] as const), byString),
        new SortedMap(keys.map((key) => [key, { ...serviceAreaRows.get(key)!, round }] as const), byString));
}

/** The service rounds' areas, written through their patch door. */
export const serviceAreas = e3.record("service_areas", DictType(StringType, ServiceArea), {
    initial: serviceAreaRows,
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
