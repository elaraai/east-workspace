/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * The query builder (#875) as a solution writes it: the datasets its queries
 * read — #875's shared fixture, the query editor mock's data (`Query Editor
 * Spec.md` §6) — the one saved queries record its operators build, holding the
 * mock's seven saved queries, and the builder over them, open on one.
 */

import {
    ArrayType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, RecursiveType, SortedMap, StringType,
    StructType, VariantType, checkJq, compareFor, example, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Query, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The data — #875's shared fixture: the mock's data, from seed 875
// ============================================================================

/** One line of an order: a SKU, its unit price and the quantity ordered. */
const Line = StructType({ price: FloatType, qty: IntegerType, sku: StringType });

/** Where an order stands: cancelled for a reason, pending, or shipped on a date. */
const Status = VariantType({ cancelled: StructType({ reason: StringType }), pending: NullType, shipped: StructType({ date: DateTimeType }) });

/** An order: `discount` is the fraction taken off, when there is one, and `total` the lines' gross less it, to the cent. */
const Order = StructType({
    customer_id: StringType, discount: OptionType(FloatType), id: IntegerType, lines: ArrayType(Line), status: Status, total: FloatType,
});

/** A customer, and their tier. */
const Customer = StructType({ name: StringType, region: StringType, tier: VariantType({ gold: NullType, standard: NullType }) });

/** Weekly demand by region: eight weeks, the first at index 0. */
const Forecast = StructType({ regions: DictType(StringType, StructType({ weekly: ArrayType(FloatType) })) });

/** A part and the parts it is built from: a bill of materials. */
const Part = RecursiveType(self => StructType({ children: ArrayType(self), cost: FloatType, sku: StringType }));

/** The demand model: units sold at a unit price in a region. */
const ModelInput = StructType({ price: FloatType, region: StringType });
const Model = FunctionType([ModelInput], FloatType);

/** The orders, ids 1001–1040, in id order: the mock's forty, drawn from seed 875 (`Query Editor Spec.md` §6). */
export const orders = e3.input("orders", ArrayType(Order), variant("value", [
    { id: 1001n, customer_id: "C01", discount: some(0.1), total: 80.1, status: variant("shipped", { date: new Date("2026-04-27T09:00:00.000Z") }),
        lines: [{ price: 8.9, qty: 10n, sku: "HNG-220" }] },
    { id: 1002n, customer_id: "C07", discount: none, total: 1171.58, status: variant("shipped", { date: new Date("2026-01-15T16:00:00.000Z") }),
        lines: [{ price: 0.85, qty: 38n, sku: "BLT-045" }, { price: 46.0, qty: 24n, sku: "PLT-310" }, { price: 0.18, qty: 196n, sku: "WSH-008" }] },
    { id: 1003n, customer_id: "C02", discount: none, total: 453.0, status: variant("shipped", { date: new Date("2026-04-06T16:00:00.000Z") }),
        lines: [{ price: 12.4, qty: 15n, sku: "BRK-100" }, { price: 8.9, qty: 30n, sku: "HNG-220" }] },
    { id: 1004n, customer_id: "C05", discount: some(0.15), total: 128.61, status: variant("pending", null),
        lines: [{ price: 8.9, qty: 17n, sku: "HNG-220" }] },
    { id: 1005n, customer_id: "C02", discount: none, total: 520.24, status: variant("pending", null),
        lines: [{ price: 46.0, qty: 6n, sku: "PLT-310" }, { price: 12.4, qty: 19n, sku: "BRK-100" }, { price: 0.18, qty: 48n, sku: "WSH-008" }] },
    { id: 1006n, customer_id: "C06", discount: none, total: 210.8, status: variant("shipped", { date: new Date("2026-06-03T14:00:00.000Z") }),
        lines: [{ price: 12.4, qty: 17n, sku: "BRK-100" }] },
    { id: 1007n, customer_id: "C05", discount: some(0.1), total: 1162.92, status: variant("shipped", { date: new Date("2026-04-06T09:00:00.000Z") }),
        lines: [{ price: 0.32, qty: 184n, sku: "SCR-012" }, { price: 64.5, qty: 5n, sku: "RAL-900" }, { price: 46.0, qty: 7n, sku: "PLT-310" }, { price: 3.75, qty: 157n, sku: "CLP-150" }] },
    { id: 1008n, customer_id: "C05", discount: none, total: 1280.3, status: variant("pending", null),
        lines: [{ price: 0.85, qty: 143n, sku: "BLT-045" }, { price: 64.5, qty: 10n, sku: "RAL-900" }, { price: 3.75, qty: 137n, sku: "CLP-150" }] },
    { id: 1009n, customer_id: "C04", discount: some(0.05), total: 409.51, status: variant("shipped", { date: new Date("2025-11-18T09:00:00.000Z") }),
        lines: [{ price: 64.5, qty: 6n, sku: "RAL-900" }, { price: 0.18, qty: 211n, sku: "WSH-008" }, { price: 0.32, qty: 19n, sku: "SCR-012" }] },
    { id: 1010n, customer_id: "C05", discount: some(0.05), total: 142.23, status: variant("shipped", { date: new Date("2025-10-14T12:00:00.000Z") }),
        lines: [{ price: 0.18, qty: 189n, sku: "WSH-008" }, { price: 8.9, qty: 13n, sku: "HNG-220" }] },
    { id: 1011n, customer_id: "C08", discount: none, total: 1027.4, status: variant("pending", null),
        lines: [{ price: 8.9, qty: 29n, sku: "HNG-220" }, { price: 64.5, qty: 8n, sku: "RAL-900" }, { price: 0.85, qty: 298n, sku: "BLT-045" }] },
    { id: 1012n, customer_id: "C02", discount: none, total: 1109.6, status: variant("shipped", { date: new Date("2026-04-01T08:00:00.000Z") }),
        lines: [{ price: 12.4, qty: 19n, sku: "BRK-100" }, { price: 46.0, qty: 19n, sku: "PLT-310" }] },
    { id: 1013n, customer_id: "C08", discount: some(0.05), total: 311.37, status: variant("shipped", { date: new Date("2026-04-27T10:00:00.000Z") }),
        lines: [{ price: 64.5, qty: 4n, sku: "RAL-900" }, { price: 0.32, qty: 218n, sku: "SCR-012" }] },
    { id: 1014n, customer_id: "C07", discount: none, total: 1765.97, status: variant("shipped", { date: new Date("2026-03-09T08:00:00.000Z") }),
        lines: [{ price: 46.0, qty: 30n, sku: "PLT-310" }, { price: 0.18, qty: 254n, sku: "WSH-008" }, { price: 0.85, qty: 269n, sku: "BLT-045" }, { price: 12.4, qty: 9n, sku: "BRK-100" }] },
    { id: 1015n, customer_id: "C03", discount: none, total: 3646.84, status: variant("pending", null),
        lines: [{ price: 46.0, qty: 19n, sku: "PLT-310" }, { price: 64.5, qty: 26n, sku: "RAL-900" }, { price: 3.75, qty: 276n, sku: "CLP-150" }, { price: 0.18, qty: 338n, sku: "WSH-008" }] },
    { id: 1016n, customer_id: "C02", discount: none, total: 1882.9, status: variant("pending", null),
        lines: [{ price: 12.4, qty: 1n, sku: "BRK-100" }, { price: 64.5, qty: 29n, sku: "RAL-900" }] },
    { id: 1017n, customer_id: "C02", discount: some(0.05), total: 2005.59, status: variant("pending", null),
        lines: [{ price: 0.85, qty: 89n, sku: "BLT-045" }, { price: 46.0, qty: 12n, sku: "PLT-310" }, { price: 64.5, qty: 23n, sku: "RAL-900" }] },
    { id: 1018n, customer_id: "C03", discount: none, total: 1372.99, status: variant("pending", null),
        lines: [{ price: 46.0, qty: 26n, sku: "PLT-310" }, { price: 0.18, qty: 138n, sku: "WSH-008" }, { price: 0.85, qty: 179n, sku: "BLT-045" }] },
    { id: 1019n, customer_id: "C05", discount: none, total: 684.65, status: variant("pending", null),
        lines: [{ price: 0.85, qty: 301n, sku: "BLT-045" }, { price: 12.4, qty: 26n, sku: "BRK-100" }, { price: 8.9, qty: 8n, sku: "HNG-220" }, { price: 0.32, qty: 110n, sku: "SCR-012" }] },
    { id: 1020n, customer_id: "C01", discount: some(0.05), total: 297.01, status: variant("shipped", { date: new Date("2026-02-06T11:00:00.000Z") }),
        lines: [{ price: 0.32, qty: 75n, sku: "SCR-012" }, { price: 0.18, qty: 88n, sku: "WSH-008" }, { price: 12.4, qty: 22n, sku: "BRK-100" }] },
    { id: 1021n, customer_id: "C07", discount: none, total: 1225.5, status: variant("shipped", { date: new Date("2026-05-18T14:00:00.000Z") }),
        lines: [{ price: 64.5, qty: 19n, sku: "RAL-900" }] },
    { id: 1022n, customer_id: "C07", discount: some(0.15), total: 36.26, status: variant("shipped", { date: new Date("2026-01-03T10:00:00.000Z") }),
        lines: [{ price: 0.18, qty: 237n, sku: "WSH-008" }] },
    { id: 1023n, customer_id: "C01", discount: some(0.1), total: 1352.32, status: variant("shipped", { date: new Date("2026-01-08T12:00:00.000Z") }),
        lines: [{ price: 0.32, qty: 32n, sku: "SCR-012" }, { price: 8.9, qty: 13n, sku: "HNG-220" }, { price: 0.18, qty: 123n, sku: "WSH-008" }, { price: 64.5, qty: 21n, sku: "RAL-900" }] },
    { id: 1024n, customer_id: "C05", discount: some(0.05), total: 623.52, status: variant("cancelled", { reason: "Customer request" }),
        lines: [{ price: 46.0, qty: 4n, sku: "PLT-310" }, { price: 0.18, qty: 209n, sku: "WSH-008" }, { price: 0.32, qty: 351n, sku: "SCR-012" }, { price: 12.4, qty: 26n, sku: "BRK-100" }] },
    { id: 1025n, customer_id: "C01", discount: some(0.1), total: 2577.23, status: variant("cancelled", { reason: "Payment failed" }),
        lines: [{ price: 0.18, qty: 213n, sku: "WSH-008" }, { price: 64.5, qty: 27n, sku: "RAL-900" }, { price: 3.75, qty: 289n, sku: "CLP-150" }] },
    { id: 1026n, customer_id: "C03", discount: none, total: 1913.4, status: variant("shipped", { date: new Date("2026-03-07T08:00:00.000Z") }),
        lines: [{ price: 0.85, qty: 354n, sku: "BLT-045" }, { price: 64.5, qty: 25n, sku: "RAL-900" }] },
    { id: 1027n, customer_id: "C08", discount: none, total: 808.19, status: variant("shipped", { date: new Date("2026-06-26T10:00:00.000Z") }),
        lines: [{ price: 0.85, qty: 3n, sku: "BLT-045" }, { price: 8.9, qty: 25n, sku: "HNG-220" }, { price: 64.5, qty: 8n, sku: "RAL-900" }, { price: 0.18, qty: 373n, sku: "WSH-008" }] },
    { id: 1028n, customer_id: "C06", discount: none, total: 173.45, status: variant("pending", null),
        lines: [{ price: 0.85, qty: 47n, sku: "BLT-045" }, { price: 8.9, qty: 15n, sku: "HNG-220" }] },
    { id: 1029n, customer_id: "C05", discount: none, total: 64.96, status: variant("shipped", { date: new Date("2026-03-19T16:00:00.000Z") }),
        lines: [{ price: 0.32, qty: 203n, sku: "SCR-012" }] },
    { id: 1030n, customer_id: "C03", discount: none, total: 913.36, status: variant("pending", null),
        lines: [{ price: 0.85, qty: 380n, sku: "BLT-045" }, { price: 3.75, qty: 4n, sku: "CLP-150" }, { price: 46.0, qty: 12n, sku: "PLT-310" }, { price: 0.32, qty: 73n, sku: "SCR-012" }] },
    { id: 1031n, customer_id: "C06", discount: none, total: 1537.52, status: variant("shipped", { date: new Date("2026-05-31T13:00:00.000Z") }),
        lines: [{ price: 0.18, qty: 264n, sku: "WSH-008" }, { price: 12.4, qty: 20n, sku: "BRK-100" }, { price: 46.0, qty: 27n, sku: "PLT-310" }] },
    { id: 1032n, customer_id: "C02", discount: none, total: 1892.81, status: variant("cancelled", { reason: "Out of stock" }),
        lines: [{ price: 46.0, qty: 26n, sku: "PLT-310" }, { price: 3.75, qty: 183n, sku: "CLP-150" }, { price: 0.32, qty: 33n, sku: "SCR-012" }] },
    { id: 1033n, customer_id: "C01", discount: none, total: 1834.15, status: variant("pending", null),
        lines: [{ price: 64.5, qty: 27n, sku: "RAL-900" }, { price: 0.85, qty: 109n, sku: "BLT-045" }] },
    { id: 1034n, customer_id: "C03", discount: none, total: 323.06, status: variant("pending", null),
        lines: [{ price: 0.32, qty: 140n, sku: "SCR-012" }, { price: 12.4, qty: 19n, sku: "BRK-100" }, { price: 0.18, qty: 237n, sku: "WSH-008" }] },
    { id: 1035n, customer_id: "C06", discount: none, total: 2381.61, status: variant("shipped", { date: new Date("2026-06-01T14:00:00.000Z") }),
        lines: [{ price: 0.18, qty: 292n, sku: "WSH-008" }, { price: 3.75, qty: 279n, sku: "CLP-150" }, { price: 0.85, qty: 48n, sku: "BLT-045" }, { price: 46.0, qty: 27n, sku: "PLT-310" }] },
    { id: 1036n, customer_id: "C01", discount: some(0.05), total: 1041.68, status: variant("shipped", { date: new Date("2026-05-26T13:00:00.000Z") }),
        lines: [{ price: 64.5, qty: 17n, sku: "RAL-900" }] },
    { id: 1037n, customer_id: "C08", discount: none, total: 774.5, status: variant("pending", null),
        lines: [{ price: 46.0, qty: 12n, sku: "PLT-310" }, { price: 8.9, qty: 25n, sku: "HNG-220" }] },
    { id: 1038n, customer_id: "C01", discount: none, total: 1758.0, status: variant("shipped", { date: new Date("2025-10-28T08:00:00.000Z") }),
        lines: [{ price: 64.5, qty: 8n, sku: "RAL-900" }, { price: 46.0, qty: 27n, sku: "PLT-310" }] },
    { id: 1039n, customer_id: "C06", discount: none, total: 471.06, status: variant("shipped", { date: new Date("2026-04-04T13:00:00.000Z") }),
        lines: [{ price: 8.9, qty: 15n, sku: "HNG-220" }, { price: 0.18, qty: 222n, sku: "WSH-008" }, { price: 12.4, qty: 24n, sku: "BRK-100" }] },
    { id: 1040n, customer_id: "C02", discount: none, total: 884.1, status: variant("shipped", { date: new Date("2025-12-08T14:00:00.000Z") }),
        lines: [{ price: 46.0, qty: 14n, sku: "PLT-310" }, { price: 8.9, qty: 18n, sku: "HNG-220" }, { price: 0.85, qty: 94n, sku: "BLT-045" }] },
]));

/** The customers, by id. */
export const customers = e3.input("customers", DictType(StringType, Customer), variant("value", new SortedMap([
    ["C01", { name: "Harbour Foods", region: "NSW", tier: variant("gold", null) }],
    ["C02", { name: "Coastline Retail", region: "NSW", tier: variant("standard", null) }],
    ["C03", { name: "Ridge Grocers", region: "VIC", tier: variant("gold", null) }],
    ["C04", { name: "Southbank Market", region: "VIC", tier: variant("standard", null) }],
    ["C05", { name: "Sunfield Traders", region: "QLD", tier: variant("standard", null) }],
    ["C06", { name: "Northgate Supply", region: "QLD", tier: variant("gold", null) }],
    ["C07", { name: "Westend Provisions", region: "WA", tier: variant("standard", null) }],
    ["C08", { name: "Ironbark Stores", region: "SA", tier: variant("standard", null) }],
], compareFor(StringType))));

/** Weekly demand by region: eight weeks of `base × (0.9 + 0.03w + 0.01i)`, to one place, for the region at index i of NSW, VIC, QLD, WA, SA. */
export const forecast = e3.input("forecast", Forecast, variant("value", {
    regions: new SortedMap([
        ["NSW", { weekly: [1080.0, 1116.0, 1152.0, 1188.0, 1224.0, 1260.0, 1296.0, 1332.0] }],
        ["QLD", { weekly: [791.2, 817.0, 842.8, 868.6, 894.4, 920.2, 946.0, 971.8] }],
        ["SA", { weekly: [385.4, 397.7, 410.0, 422.3, 434.6, 446.9, 459.2, 471.5] }],
        ["VIC", { weekly: [955.5, 987.0, 1018.5, 1050.0, 1081.5, 1113.0, 1144.5, 1176.0] }],
        ["WA", { weekly: [502.2, 518.4, 534.6, 550.8, 567.0, 583.2, 599.4, 615.6] }],
    ], compareFor(StringType)),
}));

/** The demand model, `round₂(base[region] × (price / 10)^−1.4)`: the units sold at a unit price in a region. */
const demandModel = East.function([ModelInput], FloatType, ($, input) => {
    const base = $.const(new SortedMap([["NSW", 1200.0], ["QLD", 860.0], ["SA", 410.0], ["VIC", 1050.0], ["WA", 540.0]], compareFor(StringType)), DictType(StringType, FloatType));
    // A region the model does not know has a base of 300.
    const demand = base.get(input.region, () => 300.0).multiply(input.price.divide(10.0).pow(-1.4));
    const cents = $.const(demand.multiply(100.0).add(0.5));
    return cents.subtract(cents.remainder(1.0)).divide(100.0);
});

/** The demand model as data: an East function every runtime can call, which a query tries over a range. */
export const model = e3.input("model", Model, variant("value", East.compile(demandModel, [])));

/** The bill of materials for PUMP-A. */
export const bom = e3.input("bom", Part, variant("value", {
    sku: "PUMP-A", cost: 42.0, children: [
        { sku: "MOTOR-1", cost: 120.0, children: [
            { sku: "ROTOR-1", cost: 18.5, children: [] }, { sku: "STATOR-1", cost: 22.0, children: [] }, { sku: "BRG-6203", cost: 3.2, children: [] },
        ] },
        { sku: "HOUSING-2", cost: 35.0, children: [{ sku: "GASKET-9", cost: 1.1, children: [] }, { sku: "BOLT-M8", cost: 0.4, children: [] }] },
        { sku: "IMPELLER-3", cost: 27.5, children: [] },
        { sku: "SEAL-KIT", cost: 6.8, children: [{ sku: "ORING-12", cost: 0.3, children: [] }, { sku: "ORING-18", cost: 0.35, children: [] }] },
    ],
}));

// ============================================================================
// The saved queries — the one record the operators build
// ============================================================================

/** The data sources the builders bind, in the order they bind them: what a query is checked against. */
const SOURCES = [
    { name: "orders", path: orders.path, type: orders.type },
    { name: "customers", path: customers.path, type: customers.type },
    { name: "forecast", path: forecast.path, type: forecast.type },
    { name: "model", path: model.path, type: model.type },
    { name: "bom", path: bom.path, type: bom.type },
] as const;
const Root = StructType(Object.fromEntries(SOURCES.map(s => [s.name, s.type])));

/**
 * The mock's seven saved queries (`Query Editor Spec.md` §6): each its
 * canonical jq — what the builder's steps print — checked against the data
 * sources, reading the ones it reads, and described where the mock describes
 * it; the rest describe themselves.
 */
const SAVED: readonly (readonly [name: string, program: string, description: string | undefined, savedAt: Date])[] = [
    ["Top shipped orders, 2026", `.customers as $customers
| .orders
| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))
| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})
| map({order: .id, customer: .name, region, total, shipped: .status.value.date})
| sort_by(-.total)
| .[:10]`, undefined, new Date("2026-10-01T09:00:00Z")],
    ["Revenue by region", `.customers as $customers
| .orders
| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))
| map(. + {region: $customers[.customer_id].region})
| group_by(.region)
| map({region: .[0].region, revenue: map(.total) | add, orders: length})
| sort_by(-.revenue)
| .[:3]`, "Top 3 regions by shipped revenue in 2026, from orders of $100 or more.", new Date("2026-09-29T09:00:00Z")],
    ["Shipped revenue by month", `.orders
| map(select(.status.type == "shipped"))
| map(. + {ship_month: .status.value.date | strftime("%Y-%m")})
| group_by(.ship_month)
| map({ship_month: .[0].ship_month, revenue: map(.total) | add, orders: length})
| sort_by(.ship_month)`, undefined, new Date("2026-09-12T09:00:00Z")],
    ["Large orders with no discount", `.orders
| map(select(.total >= 1000 and .discount == null))
| map({id, customer_id, total, status})
| sort_by(-.total)`, undefined, new Date("2026-09-03T09:00:00Z")],
    ["Units by SKU", `.orders
| [.[] | . as $order | .lines[] | . + {order_id: $order.id}]
| group_by(.sku)
| map({sku: .[0].sku, units: map(.qty) | add, orders: map(.order_id) | unique | length})
| sort_by(-.units)`, undefined, new Date("2026-08-28T09:00:00Z")],
    ["Pump parts cost", `.bom
| [recurse(.children[]) | {cost, sku}]
| {total_cost: map(.cost) | add, parts: length, dearest: map(.cost) | max}`,
    "Total cost, part count and dearest part in the PUMP-A bill of materials.", new Date("2026-08-20T09:00:00Z")],
    ["Demand at $10–$12, NSW", `.model
| [range(10.0; 12.0 + 0.5 / 2; 0.5) as $price | {price: $price, demand: call(.; {price: $price, region: "NSW"})}]`,
    "Modelled demand in NSW at prices from $10 to $12, in $0.50 steps.", new Date("2026-08-14T09:00:00Z")],
];

/** The saved queries record: the mock's seven, by name. */
export const queries = e3.record("queries", Query.Types.Saved, new SortedMap(SAVED.map(([name, program, description, savedAt]) => {
    const checked = checkJq(program, Root, { root: true });
    if (checked.query === null) throw new Error(`${name} does not check: ${checked.diagnostics.map(d => d.message).join("; ")}`);
    const saved: ValueTypeOf<typeof Query.Types.SavedQuery> = {
        name,
        description: description === undefined ? none : some(description),
        query: checked.query,
        root: SOURCES.filter(s => checked.reads.includes(s.name)).map(s => ({ name: s.name, path: s.path })),
        saved_at: savedAt,
    };
    return [name, saved] as const;
}), compareFor(StringType)));

/** The record's one write. */
export const queriesPatch = e3.mutation.patch(queries);

/** A record no query has been saved to yet. */
export const queriesEmpty = e3.record("queries_empty", Query.Types.Saved, new SortedMap([], compareFor(StringType)));

/** Its one write. */
export const queriesEmptyPatch = e3.mutation.patch(queriesEmpty);

// ============================================================================
// The builders
// ============================================================================

export const queryBuilder = example({
    keywords: [
        "Query", "Query.Builder", "query builder", "jq", "steps", "saved queries", "run", "results", "Table", "Value tree", "Download", "CSV",
        "Record.bind", "patch", "e3.record", "e3.mutation.patch", "Data.bind", "datasets", "one-shot",
    ],
    description: "The query builder over the shared fixture's datasets and the saved queries record, open on Top shipped orders, 2026: one toolbar — Visual · jq, Table · Tree, Download, the history item, Copy jq, Save… and Run — the pane's Query tab with its five steps and their counted shape lines, and the ten orders it gives as a Table beside it",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const saved = $.let(Record.bind(queries, [queriesPatch]));
            const orderRows = $.let(Data.bind(orders));
            const customerRows = $.let(Data.bind(customers));
            const weekly = $.let(Data.bind(forecast));
            const demand = $.let(Data.bind(model));
            const parts = $.let(Data.bind(bom));
            return (
                <Box height="760px">
                    <Query.Builder queries={saved} query="Top shipped orders, 2026" id="top"
                        datasets={{ orders: orderRows, customers: customerRows, forecast: weekly, model: demand, bom: parts }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const queryBuilderBom = example({
    keywords: ["Query", "Query.Builder", "tree", "recursive", "bill of materials", "List every part in the tree", "Group and total", "Value tree"],
    description: "The same builder open on Pump parts cost: every part of the PUMP-A bill of materials, walked, then totalled — its cost, its part count and its dearest part, one value shown as a Value tree",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const saved = $.let(Record.bind(queries, [queriesPatch]));
            const orderRows = $.let(Data.bind(orders));
            const customerRows = $.let(Data.bind(customers));
            const weekly = $.let(Data.bind(forecast));
            const demand = $.let(Data.bind(model));
            const parts = $.let(Data.bind(bom));
            return (
                <Box height="640px">
                    <Query.Builder queries={saved} query="Pump parts cost" id="bom"
                        datasets={{ orders: orderRows, customers: customerRows, forecast: weekly, model: demand, bom: parts }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const queryBuilderModel = example({
    keywords: ["Query", "Query.Builder", "model", "function", "Try the model over a range", "call", "what if"],
    description: "The same builder open on Demand at $10–$12, NSW: the demand model, an East function in the data, tried at each price from $10 to $12 in $0.50 steps, one row per price",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const saved = $.let(Record.bind(queries, [queriesPatch]));
            const orderRows = $.let(Data.bind(orders));
            const customerRows = $.let(Data.bind(customers));
            const weekly = $.let(Data.bind(forecast));
            const demand = $.let(Data.bind(model));
            const parts = $.let(Data.bind(bom));
            return (
                <Box height="640px">
                    <Query.Builder queries={saved} query="Demand at $10–$12, NSW" id="model"
                        datasets={{ orders: orderRows, customers: customerRows, forecast: weekly, model: demand, bom: parts }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const queryBuilderEmpty = example({
    keywords: ["Query", "Query.Builder", "new query", "empty", "Add a step", "Quick add"],
    description: "A builder over a record with no saved queries: a new query on orders, its Query tab asking for a first step, and nothing run yet",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const saved = $.let(Record.bind(queriesEmpty, [queriesEmptyPatch]));
            const orderRows = $.let(Data.bind(orders));
            const customerRows = $.let(Data.bind(customers));
            return (
                <Box height="560px">
                    <Query.Builder queries={saved} id="empty" datasets={{ orders: orderRows, customers: customerRows }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
