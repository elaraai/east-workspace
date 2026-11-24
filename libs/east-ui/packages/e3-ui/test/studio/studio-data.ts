/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The data the Studio examples' components read (`studio.examples.tsx`, which
 * re-exports each of them): the week's figures, revenue by day, the sales and
 * the returns, orders by week, visits by day, and the floor's areas, shifts,
 * people, assignments and rota.
 */

import { ArrayType, DateTimeType, FloatType, IntegerType, NullType, StringType, StructType, VariantType, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";

/** What a KPI measures: an amount of money, a count, a price or a ratio. */
const KpiUnit = VariantType({ money: NullType, count: NullType, price: NullType, ratio: NullType });

/** The week's figures, each with its change on last week in percent — what a KPI task writes. */
export const studioKpis = e3.input("studio_kpis", ArrayType(StructType({
    label: StringType, value: FloatType, unit: KpiUnit, change: FloatType,
})), variant("value", [
    { label: "Revenue", value: 1284000.0, unit: variant("money", null), change: 6.4 },
    { label: "Orders", value: 8412.0, unit: variant("count", null), change: 2.1 },
    { label: "Avg ticket", value: 152.0, unit: variant("price", null), change: -1.3 },
    { label: "Fill rate", value: 0.94, unit: variant("ratio", null), change: 0.0 },
]));

/** Revenue by day. */
export const studioRevenueDaily = e3.input("studio_revenue_daily", ArrayType(StructType({ day: DateTimeType, revenue: FloatType })), variant("value", [
    { day: new Date("2026-02-12T00:00:00Z"), revenue: 2640000.0 },
    { day: new Date("2026-02-19T00:00:00Z"), revenue: 2710000.0 },
    { day: new Date("2026-02-26T00:00:00Z"), revenue: 2900000.0 },
    { day: new Date("2026-03-05T00:00:00Z"), revenue: 3180000.0 },
    { day: new Date("2026-03-12T00:00:00Z"), revenue: 3300000.0 },
    { day: new Date("2026-03-19T00:00:00Z"), revenue: 3430000.0 },
]));

/** This week's sales, one row per region per channel. */
export const studioSales = e3.input("studio_sales", ArrayType(StructType({ region: StringType, channel: StringType, revenue: FloatType })), variant("value", [
    { region: "North", channel: "Store", revenue: 331200.0 },
    { region: "North", channel: "Online", revenue: 208080.0 },
    { region: "South", channel: "Store", revenue: 238824.0 },
    { region: "South", channel: "Online", revenue: 159216.0 },
    { region: "West", channel: "Store", revenue: 197604.0 },
    { region: "West", channel: "Online", revenue: 149076.0 },
]));

/** This week's returns, one row per region, channel and reason: the items that came back, and what was refunded for them. */
export const studioReturns = e3.input("studio_returns", ArrayType(StructType({
    region: StringType, channel: StringType, reason: StringType, items: IntegerType, refunded: FloatType,
})), variant("value", [
    { region: "North", channel: "Store", reason: "Damaged", items: 31n, refunded: 5208.0 },
    { region: "North", channel: "Store", reason: "Changed mind", items: 18n, refunded: 2736.0 },
    { region: "North", channel: "Online", reason: "Damaged", items: 22n, refunded: 3696.0 },
    { region: "North", channel: "Online", reason: "Wrong size", items: 41n, refunded: 5699.0 },
    { region: "South", channel: "Store", reason: "Damaged", items: 19n, refunded: 3192.0 },
    { region: "South", channel: "Store", reason: "Changed mind", items: 12n, refunded: 1824.0 },
    { region: "South", channel: "Online", reason: "Wrong size", items: 27n, refunded: 3753.0 },
    { region: "West", channel: "Store", reason: "Damaged", items: 15n, refunded: 2520.0 },
    { region: "West", channel: "Online", reason: "Changed mind", items: 9n, refunded: 1368.0 },
    { region: "West", channel: "Online", reason: "Wrong size", items: 24n, refunded: 3336.0 },
]));

/** Orders by week. */
export const studioOrdersWeekly = e3.input("studio_orders_weekly", ArrayType(StructType({ week: StringType, orders: FloatType })), variant("value", [
    { week: "W9", orders: 96.0 }, { week: "W10", orders: 158.0 }, { week: "W11", orders: 214.0 },
    { week: "W12", orders: 271.0 }, { week: "W13", orders: 248.0 }, { week: "W14", orders: 196.0 },
]));

/** Visits by day, the last two weeks. */
export const studioVisitsDaily = e3.input("studio_visits_daily", ArrayType(StructType({ day: DateTimeType, visits: FloatType })), variant("value", [
    { day: new Date("2026-03-06T00:00:00Z"), visits: 412.0 }, { day: new Date("2026-03-07T00:00:00Z"), visits: 388.0 },
    { day: new Date("2026-03-08T00:00:00Z"), visits: 301.0 }, { day: new Date("2026-03-09T00:00:00Z"), visits: 296.0 },
    { day: new Date("2026-03-10T00:00:00Z"), visits: 455.0 }, { day: new Date("2026-03-11T00:00:00Z"), visits: 471.0 },
    { day: new Date("2026-03-12T00:00:00Z"), visits: 468.0 }, { day: new Date("2026-03-13T00:00:00Z"), visits: 502.0 },
    { day: new Date("2026-03-14T00:00:00Z"), visits: 479.0 }, { day: new Date("2026-03-15T00:00:00Z"), visits: 344.0 },
    { day: new Date("2026-03-16T00:00:00Z"), visits: 327.0 }, { day: new Date("2026-03-17T00:00:00Z"), visits: 518.0 },
    { day: new Date("2026-03-18T00:00:00Z"), visits: 546.0 }, { day: new Date("2026-03-19T00:00:00Z"), visits: 561.0 },
]));

/** The floor's areas, its shifts and its people. */
export const studioAreas = e3.input("studio_areas", ArrayType(StructType({ id: StringType, name: StringType })), variant("value", [
    { id: "north", name: "North" }, { id: "south", name: "South" },
]));
export const studioShifts = e3.input("studio_shifts", ArrayType(StructType({ id: StringType, name: StringType, window: StringType })), variant("value", [
    { id: "am", name: "AM", window: "06–14" }, { id: "pm", name: "PM", window: "14–22" }, { id: "night", name: "Night", window: "22–06" },
]));
export const studioPeople = e3.input("studio_people", ArrayType(StructType({ id: StringType, name: StringType })), variant("value", [
    { id: "p1", name: "Ana Ruiz" }, { id: "p2", name: "Ben Cole" }, { id: "p3", name: "Cai Lin" }, { id: "p4", name: "Dev Rao" },
    { id: "p5", name: "Eli Moss" }, { id: "p6", name: "Fay Ong" }, { id: "p7", name: "Gus Hart" }, { id: "p8", name: "Hana Ito" },
]));

/** Who works where today. */
export const studioAssignmentsToday = e3.input("studio_assignments_today", ArrayType(StructType({
    id: StringType, person: StringType, area: StringType, shift: StringType,
})), variant("value", [
    { id: "a1", person: "p1", area: "north", shift: "am" }, { id: "a2", person: "p2", area: "north", shift: "am" },
    { id: "a3", person: "p3", area: "north", shift: "pm" }, { id: "a4", person: "p4", area: "north", shift: "night" },
    { id: "a5", person: "p5", area: "south", shift: "am" }, { id: "a6", person: "p6", area: "south", shift: "pm" },
    { id: "a7", person: "p7", area: "south", shift: "pm" }, { id: "a8", person: "p8", area: "south", shift: "night" },
]));

/** This week's rota. */
export const studioRotaWeek = e3.input("studio_rota_week", ArrayType(StructType({
    id: StringType, person: StringType, day: StringType, hours: IntegerType,
})), variant("value", [
    { id: "r1", person: "p1", day: "Mon", hours: 8n }, { id: "r2", person: "p1", day: "Tue", hours: 8n }, { id: "r3", person: "p1", day: "Wed", hours: 8n },
    { id: "r4", person: "p2", day: "Mon", hours: 8n }, { id: "r5", person: "p2", day: "Thu", hours: 8n }, { id: "r6", person: "p2", day: "Fri", hours: 6n },
    { id: "r7", person: "p3", day: "Tue", hours: 8n }, { id: "r8", person: "p3", day: "Wed", hours: 8n }, { id: "r9", person: "p3", day: "Thu", hours: 8n },
    { id: "r10", person: "p4", day: "Mon", hours: 10n }, { id: "r11", person: "p4", day: "Fri", hours: 10n },
]));
