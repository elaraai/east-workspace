/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
  East, ArrayType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, RecursiveType, StringType, StructType,
  VariantType, example, none, some, variant,
} from "@elaraai/east";

const Status = VariantType({ cancelled: StructType({ reason: StringType }), pending: NullType, shipped: StructType({ date: DateTimeType }) });
const Order = StructType({ customer: StringType, id: IntegerType, status: Status, total: FloatType });
const Customer = StructType({ name: StringType, region: StringType });
const Part = RecursiveType(self => StructType({ children: ArrayType(self), cost: FloatType, sku: StringType }));
const Revenue = StructType({ customer: OptionType(StringType), revenue: FloatType });

const ORDERS = [
  { customer: "C01", id: 1n, status: variant("shipped", { date: new Date(Date.UTC(2026, 0, 15)) }), total: 250.0 },
  { customer: "C02", id: 2n, status: variant("pending", null), total: 1200.0 },
  { customer: "C01", id: 3n, status: variant("shipped", { date: new Date(Date.UTC(2025, 10, 3)) }), total: 1600.0 },
];

const CUSTOMERS = new Map([["C01", { name: "Harbour Foods", region: "NSW" }]]);

const PUMP = {
  children: [
    { children: [{ children: [], cost: 18.5, sku: "ROTOR-1" }], cost: 120.0, sku: "MOTOR-1" },
    { children: [], cost: 27.5, sku: "IMPELLER-3" },
  ],
  cost: 42.0,
  sku: "PUMP-A",
};

// ---------------------------------------------------------------------------
// East.jq: a query as East code
// ---------------------------------------------------------------------------

export const queryJqSelect = example({
  keywords: ["jq", "query", "East.jq", "select", "filter", "map", "stream"],
  description: "Query an array with jq: the ids of the orders over 1000",
  fn: East.function([], ArrayType(IntegerType), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    return East.jq(orders, "[.[] | select(.total > 1000) | .id]", ArrayType(IntegerType));
  }),
  inputs: [],
  returns: [2n, 3n],
});

export const queryJqRoot = example({
  keywords: ["jq", "query", "East.jq", "root", "datasets", "lookup", "join", "as"],
  description: "Query several named inputs as one root: each order's customer name, looked up by id",
  fn: East.function([], ArrayType(OptionType(StringType)), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    const customers = $.const(CUSTOMERS, DictType(StringType, Customer));
    return East.jq({ customers, orders }, ".customers as $c | .orders | map($c[.customer].name)", ArrayType(OptionType(StringType)));
  }),
  inputs: [],
  returns: [some("Harbour Foods"), none, some("Harbour Foods")],
});

export const queryJqFirst = example({
  keywords: ["jq", "query", "East.jq", "first", "maybe", "Option", "early exit"],
  description: "A query with at most one output gives an Option: the first order over 1000, stopping there",
  fn: East.function([], OptionType(IntegerType), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    return East.jq(orders, "first(.[] | select(.total > 1000)) | .id", OptionType(IntegerType));
  }),
  inputs: [],
  returns: some(2n),
});

export const queryJqReduce = example({
  keywords: ["jq", "query", "East.jq", "reduce", "Dict", "accumulator", "sum", "group"],
  description: "Reduce into a dict whose type the checker infers: revenue by customer",
  fn: East.function([], DictType(StringType, FloatType), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    return East.jq(orders, "reduce .[] as $o ({}; .[$o.customer] += $o.total)", DictType(StringType, FloatType));
  }),
  inputs: [],
  returns: new Map([["C01", 1850.0], ["C02", 1200.0]]),
});

export const queryJqGroupBy = example({
  keywords: ["jq", "query", "East.jq", "group_by", "sort_by", "add", "aggregate", "report"],
  description: "Group, total and sort: revenue per customer, largest first (a group's first row is an index, so its field is an Option)",
  fn: East.function([], ArrayType(Revenue), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    return East.jq(orders, "group_by(.customer) | map({customer: .[0].customer, revenue: (map(.total) | add)}) | sort_by(-.revenue)", ArrayType(Revenue));
  }),
  inputs: [],
  returns: [{ customer: some("C01"), revenue: 1850.0 }, { customer: some("C02"), revenue: 1200.0 }],
});

export const queryJqVariant = example({
  keywords: ["jq", "query", "East.jq", "variant", "narrowing", "type", "value", "year", "DateTime"],
  description: "A case test narrows a variant, so its payload is read exactly: the year each shipped order shipped",
  fn: East.function([], ArrayType(IntegerType), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    return East.jq(orders, "map(select(.status.type == \"shipped\") | .status.value.date | year)", ArrayType(IntegerType));
  }),
  inputs: [],
  returns: [2026n, 2025n],
});

export const queryJqDateLiteral = example({
  keywords: ["jq", "query", "East.jq", "DateTime", "ISO", "strftime", "date", "compare"],
  description: "Compare a DateTime with an ISO date written in the query, and format it with strftime",
  fn: East.function([], ArrayType(StringType), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    return East.jq(orders, "[.[] | select(.status.type == \"shipped\") | .status.value.date | select(. >= \"2026-01-01\") | strftime(\"%Y-%m\")]", ArrayType(StringType));
  }),
  inputs: [],
  returns: ["2026-01"],
});

export const queryJqUpdate = example({
  keywords: ["jq", "query", "East.jq", "update", "assignment", "|=", "=", "new field"],
  description: "Update-assignment rebuilds each value, and a new field gives a new struct type",
  fn: East.function([], ArrayType(StructType({ id: IntegerType, total: FloatType, large: IntegerType })), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    return East.jq(orders, "map({id, total} | .total |= . * 2 | .large = (if .total > 1000 then 1 else 0 end))",
      ArrayType(StructType({ id: IntegerType, total: FloatType, large: IntegerType })));
  }),
  inputs: [],
  returns: [{ id: 1n, total: 500.0, large: 0n }, { id: 2n, total: 2400.0, large: 1n }, { id: 3n, total: 3200.0, large: 1n }],
});

export const queryJqTryCatch = example({
  keywords: ["jq", "query", "East.jq", "try", "catch", "error", "message"],
  description: "try/catch: the handler receives the error's message",
  fn: East.function([], OptionType(StringType), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    return East.jq(orders, "try error(\"no such order\") catch .", OptionType(StringType));
  }),
  inputs: [],
  returns: some("no such order"),
});

export const queryJqLimit = example({
  keywords: ["jq", "query", "East.jq", "limit", "label", "break", "early exit", "stream"],
  description: "limit(n; f) stops its stream after n outputs",
  fn: East.function([], ArrayType(IntegerType), ($) => {
    const orders = $.const(ORDERS, ArrayType(Order));
    return East.jq(orders, "[limit(2; .[] | .id)]", ArrayType(IntegerType));
  }),
  inputs: [],
  returns: [1n, 2n],
});

export const queryJqRecurse = example({
  keywords: ["jq", "query", "East.jq", "recurse", "RecursiveType", "tree", "walk", "depth first"],
  description: "Walk a recursive value depth first: every part's SKU",
  fn: East.function([], ArrayType(StringType), ($) => {
    const bom = $.const(PUMP, Part);
    return East.jq(bom, "[recurse(.children[]) | .sku]", ArrayType(StringType));
  }),
  inputs: [],
  returns: ["PUMP-A", "MOTOR-1", "ROTOR-1", "IMPELLER-3"],
});
