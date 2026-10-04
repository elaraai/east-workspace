/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * The query builder (#875) as a solution writes it: the datasets its queries
 * read — #875's shared fixture, the query editor mock's data (`Query Editor
 * Spec.md` §6) — the one saved queries record its operators build, holding the
 * mock's seven saved queries, and the builder over them, open on one; and an
 * order history too large for one call, which e3 tasks generate when the
 * dataflow runs, with its own saved queries and builder (#1132).
 */

import {
    ArrayType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, RecursiveType, SortedMap, StringType,
    StructType, VariantType, compareFor, example, none, some, variant,
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

/** A customer's tier. */
const Tier = VariantType({ gold: NullType, standard: NullType });

/** A customer, and their tier. */
const Customer = StructType({ name: StringType, region: StringType, tier: Tier });

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
// The order history — generated where data is made (#1132)
// ============================================================================

/**
 * How many orders the order history holds: a small authored constant, the
 * orders themselves generated by {@link historyTask} when the dataflow runs —
 * a dataset this size is made where data is made, never written into the
 * package. They weigh more than one of the showcase's pieces, so a query over
 * them runs as a split call.
 */
export const historyCount = e3.input("history_count", IntegerType, variant("value", 36_000n));

/** How many accounts place the history's orders. They weigh more than one piece too, so the history joined with them is re-keyed. */
export const accountCount = e3.input("account_count", IntegerType, variant("value", 20_000n));

/** An account's key: `A` and its number plus 100,000 — fixed width, so key order is number order. */
const accountKey = East.function([IntegerType], StringType, (_$, n) => East.str`A${n.add(100_000n)}`);

/** A number's scramble, 0 to 1,000,002: the same every run, and far from its neighbours'. */
const scramble = East.function([IntegerType], IntegerType, (_$, n) => n.multiply(2_654_435n).add(97n).remainder(1_000_003n));

/**
 * The accounts, generated from their count, by key: each named for a trading
 * name and its number, in one of eight regions, one in five gold — each drawn
 * from the account's scrambled number.
 */
export const generateAccounts = East.function([IntegerType], DictType(StringType, Customer), ($, count) => {
    const regions = $.const(["NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT", "ACT"], ArrayType(StringType));
    const names = $.const(["Harbour Foods", "Coastline Retail", "Ridge Grocers", "Southbank Market", "Sunfield Traders", "Northgate Supply"], ArrayType(StringType));
    return East.Array.range(0n, count).toDict(
        (_$, n) => accountKey(n),
        ($2, n) => {
            const h = $2.let(scramble(n));
            const gold = $2.let(h.remainder(5n).equal(0n));
            const tier = $2.let(gold.ifElse(($3) => $3.const(variant("gold", null), Tier), ($3) => $3.const(variant("standard", null), Tier)));
            return $2.const({ name: East.str`${names.get(h.remainder(6n))} ${n.add(1n)}`, region: regions.get(h.remainder(8n)), tier }, Customer);
        },
    );
});

/** The task that generates the accounts. */
export const accountsTask = e3.task("accounts", [accountCount], generateAccounts);

/** Each account's credit limit, by the account's key — $5,000 to $49,950 — but every fifth account's, which has none. */
export const generateCredit = East.function([IntegerType], DictType(StringType, FloatType), (_$, count) =>
    East.Array.range(0n, count)
        .filter((_$2, n) => n.remainder(5n).notEqual(0n))
        .toDict((_$2, n) => accountKey(n), (_$2, n) => scramble(n).remainder(900n).add(100n).multiply(50n).toFloat()));

/** The task that generates the credit limits. */
export const creditTask = e3.task("credit", [accountCount], generateCredit);

/**
 * The order history, generated from its count and the accounts': orders
 * 100,001 on, each placed by an account, of one to three lines from the
 * fixture's eight SKUs, a tenth of them 10% off and a tenth 5% off, the total
 * to the cent. Seven in ten have shipped — each order 22 minutes after the
 * one before it, from 6 January 2025 to July 2026 — two in ten are pending,
 * and one in ten was cancelled. Each is drawn from the order's scrambled
 * number.
 */
export const generateHistory = East.function([IntegerType, IntegerType], ArrayType(Order), ($, count, accounts) => {
    const catalog = $.const([
        { sku: "BRK-100", price: 12.4 }, { sku: "HNG-220", price: 8.9 }, { sku: "PLT-310", price: 46.0 }, { sku: "RAL-900", price: 64.5 },
        { sku: "BLT-045", price: 0.85 }, { sku: "WSH-008", price: 0.18 }, { sku: "SCR-012", price: 0.32 }, { sku: "CLP-150", price: 3.75 },
    ], ArrayType(StructType({ sku: StringType, price: FloatType })));
    const reasons = $.const(["Customer request", "Payment failed", "Out of stock"], ArrayType(StringType));
    const opened = $.const(new Date("2025-01-06T08:00:00.000Z"), DateTimeType);
    return East.Array.range(0n, count).map(($2, i) => {
        const h = $2.let(scramble(i));
        const lines = $2.let(East.Array.range(0n, h.remainder(3n).add(1n)).map(($3, k) => {
            const item = $3.let(catalog.get(h.add(k.multiply(5n)).remainder(8n)));
            return $3.const({ price: item.price, qty: h.add(k.multiply(3n)).remainder(40n).add(1n), sku: item.sku }, Line);
        }));
        const gross = $2.let(lines.sum(($3, line) => line.price.multiply(line.qty.toFloat())));
        const off = $2.let(h.remainder(10n));
        const discount = $2.let(off.equal(0n).ifElse(
            ($3) => $3.const(some(0.1), OptionType(FloatType)),
            ($3) => off.equal(1n).ifElse(($4) => $4.const(some(0.05), OptionType(FloatType)), ($4) => $4.const(none, OptionType(FloatType))),
        ));
        const kept = $2.let(off.equal(0n).ifElse(($3) => $3.const(0.9), ($3) => off.equal(1n).ifElse(($4) => $4.const(0.95), ($4) => $4.const(1.0))));
        const cents = $2.let(gross.multiply(kept).multiply(100.0).add(0.5));
        const state = $2.let(i.remainder(10n));
        const shipped = $2.let(opened.addMinutes(i.multiply(22n)));
        const status = $2.let(state.lessThan(7n).ifElse(
            ($3) => $3.const(variant("shipped", { date: shipped }), Status),
            ($3) => state.lessThan(9n).ifElse(
                ($4) => $4.const(variant("pending", null), Status),
                ($4) => $4.const(variant("cancelled", { reason: reasons.get(h.remainder(3n)) }), Status),
            ),
        ));
        return $2.const({
            customer_id: accountKey(h.remainder(accounts)), discount, id: i.add(100_001n), lines, status,
            total: cents.subtract(cents.remainder(1.0)).divide(100.0),
        }, Order);
    });
});

/** The task that generates the order history. */
export const historyTask = e3.task("order_history", [historyCount, accountCount], generateHistory);

// ============================================================================
// The saved queries — the one record the operators build
// ============================================================================

/**
 * The saved queries record: the mock's seven (`Query Editor Spec.md` §6),
 * each its canonical jq — what the builder's steps print — checked against the
 * data sources the builders bind when the package builds, and described where
 * the mock describes it; the rest describe themselves.
 */
export const queries = e3.record("queries", Query.Types.Saved, Query.saved({ orders, customers, forecast, model, bom }, [
    {
        name: "Top shipped orders, 2026",
        jq: `.customers as $customers
| .orders
| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))
| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})
| map({order: .id, customer: .name, region, total, shipped: .status.value.date})
| sort_by(-.total)
| .[:10]`,
        savedAt: new Date("2026-10-01T09:00:00Z"),
    },
    {
        name: "Revenue by region",
        jq: `.customers as $customers
| .orders
| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))
| map(. + {region: $customers[.customer_id].region})
| group_by(.region)
| map({region: .[0].region, revenue: map(.total) | add, orders: length})
| sort_by(-.revenue)
| .[:3]`,
        description: "Top 3 regions by shipped revenue in 2026, from orders of $100 or more.",
        savedAt: new Date("2026-09-29T09:00:00Z"),
    },
    {
        name: "Shipped revenue by month",
        jq: `.orders
| map(select(.status.type == "shipped"))
| map(. + {ship_month: .status.value.date | strftime("%Y-%m")})
| group_by(.ship_month)
| map({ship_month: .[0].ship_month, revenue: map(.total) | add, orders: length})
| sort_by(.ship_month)`,
        savedAt: new Date("2026-09-12T09:00:00Z"),
    },
    {
        name: "Large orders with no discount",
        jq: `.orders
| map(select(.total >= 1000 and .discount == null))
| map({id, customer_id, total, status})
| sort_by(-.total)`,
        savedAt: new Date("2026-09-03T09:00:00Z"),
    },
    {
        name: "Units by SKU",
        jq: `.orders
| [.[] | . as $order | .lines[] | . + {order_id: $order.id}]
| group_by(.sku)
| map({sku: .[0].sku, units: map(.qty) | add, orders: map(.order_id) | unique | length})
| sort_by(-.units)`,
        savedAt: new Date("2026-08-28T09:00:00Z"),
    },
    {
        name: "Pump parts cost",
        jq: `.bom
| [recurse(.children[]) | {cost, sku}]
| {total_cost: map(.cost) | add, parts: length, dearest: map(.cost) | max}`,
        description: "Total cost, part count and dearest part in the PUMP-A bill of materials.",
        savedAt: new Date("2026-08-20T09:00:00Z"),
    },
    {
        name: "Demand at $10–$12, NSW",
        jq: `.model
| [range(10.0; 12.0 + 0.5 / 2; 0.5) as $price | {price: $price, demand: call(.; {price: $price, region: "NSW"})}]`,
        description: "Modelled demand in NSW at prices from $10 to $12, in $0.50 steps.",
        savedAt: new Date("2026-08-14T09:00:00Z"),
    },
]));

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

// ============================================================================
// The order history's saved queries, and its builder (#1132)
// ============================================================================

/**
 * The saved queries over the order history, one of each way a query too large
 * for one call runs: over the history's pieces; the history joined with the
 * accounts, both large, re-keyed; and the accounts joined with their credit
 * limits, keyed alike, cut at the same keys — each checked against the three
 * generated datasets, each a task's output, when the package builds.
 */
export const historyQueries = e3.record("history_queries", Query.Types.Saved, Query.saved({ order_history: historyTask, accounts: accountsTask, credit: creditTask }, [
    {
        name: "History revenue by month",
        jq: `.order_history
| map(select(.status.type == "shipped"))
| map(. + {ship_month: .status.value.date | strftime("%Y-%m")})
| group_by(.ship_month)
| map({ship_month: .[0].ship_month, revenue: map(.total) | add, orders: length})`,
        description: "Shipped revenue by month over the whole order history, run over its pieces.",
        savedAt: new Date("2026-10-02T09:00:00Z"),
    },
    {
        name: "History revenue by region",
        jq: `.accounts as $accounts
| .order_history
| map(select(.status.type == "shipped"))
| map(. + {region: $accounts[.customer_id].region})
| group_by(.region)
| map({region: .[0].region, revenue: map(.total) | add, orders: length})`,
        description: "Shipped revenue by the region of the account that placed each order.",
        savedAt: new Date("2026-10-02T10:00:00Z"),
    },
    {
        name: "Credit by region",
        jq: `.credit as $credit
| .accounts
| to_entries
| map({region: .value.region, limit: ($credit[.key] // 0)})
| group_by(.region)
| map({region: .[0].region, limit: map(.limit) | add, accounts: length})`,
        description: "Each region's accounts and their credit limits added up; an account with no limit counts as none.",
        savedAt: new Date("2026-10-02T11:00:00Z"),
    },
]));

/** Its one write. */
export const historyQueriesPatch = e3.mutation.patch(historyQueries);

export const queryBuilderHistory = example({
    keywords: [
        "Query", "Query.Builder", "split call", "pieces", "re-key", "re-keyed join", "join", "cut at the same keys", "co-partitioned",
        "large data", "order history", "generated", "e3.task", "Data.bindPaged", "plan",
    ],
    description: "The builder over data too large for one call — an order history of 36,000 orders, the 20,000 accounts that place them and their credit limits, which e3 tasks generate when the dataflow runs, each bound by window and never downloaded — open on History revenue by region: the history joined with the accounts, both large, so the run re-keys it as two split calls, which the results footer's plan read-out says. Its other saved queries run as a split call over the history's pieces, and as a join of two lookups keyed alike, cut at the same keys",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const saved = $.let(Record.bind(historyQueries, [historyQueriesPatch]));
            const history = $.let(Data.bindPaged(historyTask));
            const accounts = $.let(Data.bindPaged(accountsTask));
            const credit = $.let(Data.bindPaged(creditTask));
            return (
                <Box height="760px">
                    <Query.Builder queries={saved} query="History revenue by region" id="history"
                        datasets={{ order_history: history, accounts, credit }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// The query library
// ============================================================================

export const queryLibrary = example({
    keywords: [
        "Query", "Query.Library", "query library", "saved queries", "gallery", "wireframe", "Open in builder", "New query",
        "search", "sort", "grid", "list", "recent", "Record.bind", "Data.bind",
    ],
    description: "The query library over the same record and data sources: one toolbar — the search, Sort, Grid · List and \"+ New query on orders\" — beside the data sources with their counts of saved queries and this viewer's recent runs; the seven saved queries as a gallery, each card a wireframe of its steps with its name, its description and what it gives, and \"Open in builder →\", which opens the query in the builder that shares its id",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const saved = $.let(Record.bind(queries, [queriesPatch]));
            const orderRows = $.let(Data.bind(orders));
            const customerRows = $.let(Data.bind(customers));
            const weekly = $.let(Data.bind(forecast));
            const demand = $.let(Data.bind(model));
            const parts = $.let(Data.bind(bom));
            return (
                <Box height="720px">
                    <Query.Library queries={saved} id="top"
                        datasets={{ orders: orderRows, customers: customerRows, forecast: weekly, model: demand, bom: parts }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
