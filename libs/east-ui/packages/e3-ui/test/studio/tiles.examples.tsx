/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The renderer's tile tests' own data (#1673), which they read on e3 itself:
 * a handful of orders small enough to total by eye, the managers of their
 * regions, and a quarter of orders with the year before's. It holds no
 * example: the tests mount it beside the Studio's examples, and the showcase
 * lists nothing of it.
 */

import { ArrayType, DateTimeType, FloatType, IntegerType, OptionType, StringType, StructType, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import e3 from "@elaraai/e3";

/** Three orders: South Australia's two and New South Wales' one, over July and August — 210 of revenue, 7 units. */
export const tileTestOrders = e3.input("tile_test_orders", ArrayType(StructType({
    ordered_at: DateTimeType, region: StringType, revenue: FloatType, units: IntegerType,
})), variant("value", [
    { ordered_at: new Date("2026-07-03T10:00:00Z"), region: "SA", revenue: 100.0, units: 4n },
    { ordered_at: new Date("2026-07-20T10:00:00Z"), region: "NSW", revenue: 50.0, units: 1n },
    { ordered_at: new Date("2026-08-02T10:00:00Z"), region: "SA", revenue: 60.0, units: 2n },
]));

/** Who manages each region of those orders: a source a list on it leads the orders by. */
export const tileTestManagers = e3.input("tile_test_managers", ArrayType(StructType({ region: StringType, manager: StringType })), variant("value", [
    { region: "SA", manager: "Avery" },
    { region: "NSW", manager: "Blake" },
]));

/** An order of {@link tileTestQuarter}: when, where, for whom, for how much, how many units, and its margin where it is known. */
export const TileTestQuarterRow = StructType({
    ordered_at: DateTimeType, region: StringType, customer: StringType, revenue: FloatType, units: IntegerType, margin: OptionType(FloatType),
});

/**
 * Five orders in the quarter from July 2026 and two a year before —
 * Victoria's, and Queensland's, which the quarter has none of: the rows the
 * renderer's visual tests total, and a page filter's values are read from.
 */
export const tileTestQuarterRows: ValueTypeOf<typeof TileTestQuarterRow>[] = [
    { ordered_at: new Date("2026-07-03T10:00:00Z"), region: "SA", customer: "Northwind", revenue: 100.0, units: 3n, margin: some(0.2) },
    { ordered_at: new Date("2026-07-20T10:00:00Z"), region: "NSW", customer: "Harbour", revenue: 50.0, units: 1n, margin: none },
    { ordered_at: new Date("2026-08-02T10:00:00Z"), region: "SA", customer: "Summit", revenue: 70.0, units: 2n, margin: some(0.1) },
    { ordered_at: new Date("2026-08-15T10:00:00Z"), region: "VIC", customer: "Northwind", revenue: 30.0, units: 5n, margin: some(0.3) },
    { ordered_at: new Date("2026-09-01T10:00:00Z"), region: "WA", customer: "Summit", revenue: 20.0, units: 1n, margin: some(0.4) },
    { ordered_at: new Date("2025-07-10T10:00:00Z"), region: "VIC", customer: "Northwind", revenue: 40.0, units: 4n, margin: some(0.3) },
    { ordered_at: new Date("2025-08-10T10:00:00Z"), region: "QLD", customer: "Harbour", revenue: 10.0, units: 1n, margin: none },
];

/** The quarter's orders, as e3 holds them (#1673): what a renderer test reads them from on e3 itself. */
export const tileTestQuarter = e3.input("tile_test_quarter", ArrayType(TileTestQuarterRow), variant("value", tileTestQuarterRows));
