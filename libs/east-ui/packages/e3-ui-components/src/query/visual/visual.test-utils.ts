/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The visual tests' orders (#1671): a quarter of them and two a year before,
 * listed as a surface lists a source — each field's label, revenue in
 * dollars and margin a percent — and a visual's answers as e3 gives them:
 * each program it prints, asked in memory.
 */

import { ArrayType, DateTimeType, FloatType, IntegerType, OptionType, StringType, StructType, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { toValueFormat } from "@elaraai/east-ui/internal";
import type { Studio, StudioSourceType } from "@elaraai/e3-ui/internal";
import { utcAt as at } from "../../plan/plan.test-utils.js";
import { createInMemoryQueryCall } from "../in-memory-call.js";
import { queryRoot } from "../one-shot.js";
import { askProgram, type VisualAnswer } from "./ask.js";
import { printVisual, visualValues, type PrintState, type RecordsPage, type VisualAsk } from "./print.js";
import { printSourceOf } from "./source.js";

/** An order. */
export const OrderRow = StructType({ ordered_at: DateTimeType, region: StringType, customer: StringType, revenue: FloatType, units: IntegerType, margin: OptionType(FloatType) });

/** The orders: five in the quarter from July 2026, and two a year before — Victoria's, and Queensland's, which the quarter has none of. */
export const ORDERS: ValueTypeOf<typeof OrderRow>[] = [
    { ordered_at: at("2026-07-03T10:00:00"), region: "SA", customer: "Northwind", revenue: 100, units: 3n, margin: some(0.2) },
    { ordered_at: at("2026-07-20T10:00:00"), region: "NSW", customer: "Harbour", revenue: 50, units: 1n, margin: none },
    { ordered_at: at("2026-08-02T10:00:00"), region: "SA", customer: "Summit", revenue: 70, units: 2n, margin: some(0.1) },
    { ordered_at: at("2026-08-15T10:00:00"), region: "VIC", customer: "Northwind", revenue: 30, units: 5n, margin: some(0.3) },
    { ordered_at: at("2026-09-01T10:00:00"), region: "WA", customer: "Summit", revenue: 20, units: 1n, margin: some(0.4) },
    { ordered_at: at("2025-07-10T10:00:00"), region: "VIC", customer: "Northwind", revenue: 40, units: 4n, margin: some(0.3) },
    { ordered_at: at("2025-08-10T10:00:00"), region: "QLD", customer: "Harbour", revenue: 10, units: 1n, margin: none },
];

const PATH = [variant("field", "inputs"), variant("field", "orders")];

/** The orders, as a surface lists them: each field labelled, revenue in Australian dollars, margin a percent, ranged by the order's date. */
export const LISTED_ORDERS: ValueTypeOf<typeof StudioSourceType> = {
    key: "orders", name: "Orders", icon: "receipt", description: none,
    binding: { name: "orders", source: variant("value", PATH), type: toEastTypeValue(ArrayType(OrderRow)) },
    fields: [
        { id: "ordered_at", label: "Ordered", kind: variant("date", null), format: none },
        { id: "region", label: "Region", kind: variant("text", null), format: none },
        { id: "customer", label: "Customer", kind: variant("text", null), format: none },
        { id: "revenue", label: "Revenue", kind: variant("number", null), format: some(toValueFormat({ currency: { code: "AUD" } })) },
        { id: "units", label: "Units", kind: variant("number", null), format: none },
        { id: "margin", label: "Margin", kind: variant("number", null), format: some(toValueFormat("percent")) },
    ],
    range: some("ordered_at"), search: [], split: [],
};

/** The orders as the printer reads them. */
export const ORDERS_SOURCE = printSourceOf(LISTED_ORDERS)!;

/** The root the orders' programs read. */
const ROOT = queryRoot([{ name: "orders", path: PATH, type: toEastTypeValue(ArrayType(OrderRow)) }]);

/** The calls, answered in memory over the orders. */
const SEAMS = { call: createInMemoryQueryCall([{ path: PATH, type: ArrayType(OrderRow), value: ORDERS }]), split: undefined, collection: undefined, status: undefined };

/** A page's state with the quarter from July 2026 as its window. */
export const QUARTER: PrintState = { filters: [], window: { from: at("2026-07-01T00:00:00"), to: at("2026-10-01T00:00:00") } };

/** A visual's asks, their answers as e3 gives them, and the values the asks' indexes name. */
export interface Answered {
    readonly asks: readonly VisualAsk[];
    readonly answers: VisualAnswer[];
    readonly values: ReturnType<typeof visualValues>;
}

/**
 * A visual over the orders, asked: each program it prints, asked in memory as
 * e3 asks it.
 *
 * @param content - The visual, as a placement holds it
 * @param state - The page's state; the quarter's window unless given
 * @param page - A records table's rows it asks; its first page unless given
 * @returns Its asks, their answers, and its values
 */
export async function answered(content: ReturnType<typeof Studio.visual.of>, state: PrintState = QUARTER, page?: RecordsPage): Promise<Answered> {
    if (content.type !== "visual") throw new Error("not a visual");
    const printed = printVisual(content.value, ORDERS_SOURCE, state, page);
    if (printed.kind !== "asks") throw new Error(`printed ${printed.kind}`);
    const answers = await Promise.all(printed.asks.map(async ask => {
        const kept = await askProgram(ask.program, ROOT, SEAMS, {}, new AbortController().signal);
        if (kept === undefined) throw new Error("abandoned");
        return kept.value;
    }));
    return { asks: printed.asks, answers, values: visualValues(content.value.view) };
}
