/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The visual tests' orders (#1671): a quarter of them and two a year before —
 * the e3-ui tiles examples' `tile_test_quarter`, which a renderer test reads
 * on e3 itself (#1673) — listed as a surface lists a source — each field's
 * label, revenue in dollars and margin a percent — and a visual's answers as
 * e3 gives them: each program it prints, asked in memory, for the tests of
 * what a renderer makes of an answer.
 */

import { ArrayType, none, parseJq, some, toEastTypeValue, variant, type JqNode, type ValueTypeOf } from "@elaraai/east";
import { toValueFormat } from "@elaraai/east-ui/internal";
import type { Studio, StudioSourceType, StudioVisualType } from "@elaraai/e3-ui/internal";
import * as tiles from "@elaraai/e3-ui/examples/studio/tiles";
import { utcAt as at } from "../../plan/plan.test-utils.js";
import { createInMemoryQueryCall } from "../in-memory-call.js";
import { queryRoot } from "../one-shot.js";
import { printAlert, type AlertField } from "./alert.js";
import { askProgram, type VisualAnswer } from "./ask.js";
import { printStateOf } from "./filters.js";
import { printVisual, visualValues, type PrintState, type VisualAsk, type VisualPage } from "./print.js";
import { printSourceOf } from "./source.js";

/** An order. */
export const OrderRow = tiles.TileTestQuarterRow;

/** The orders: five in the quarter from July 2026, and two a year before — Victoria's, and Queensland's, which the quarter has none of. */
export const ORDERS: ValueTypeOf<typeof OrderRow>[] = tiles.tileTestQuarterRows;

/** Where e3 holds them. */
const PATH = tiles.tileTestQuarter.path;

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
    range: some("ordered_at"),
};

/** The orders as the printer reads them. */
export const ORDERS_SOURCE = printSourceOf(LISTED_ORDERS)!;

/** The root the orders' programs read. */
export const ORDERS_ROOT = queryRoot([{ name: "orders", path: PATH, type: toEastTypeValue(ArrayType(OrderRow)) }]);

/** The calls, answered in memory over the orders. */
const SEAMS = { call: createInMemoryQueryCall([{ path: PATH, type: ArrayType(OrderRow), value: ORDERS }]), split: undefined, collection: undefined, status: undefined };

/**
 * A jq condition over one row, as a filter holds it.
 *
 * @param text - The condition's jq
 * @returns The condition
 */
export function condition(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") throw new Error(`does not parse: ${text}`);
    return parsed.program.value;
}

/** The minute the visual tests' pages are read at: in the quarter's last month. */
export const QUARTER_NOW = at("2026-09-15T12:00:00");

/** A page's state whose one filter holds the orders' date to the quarter from July 2026. */
export const QUARTER: PrintState = printStateOf(
    [{ source: "orders", where: condition(`.ordered_at >= "2026-07-01" and .ordered_at < "2026-10-01"`), from: none }], "orders", ORDERS_SOURCE, QUARTER_NOW,
);

/** A visual's asks, their answers as e3 gives them, and the values the asks' indexes name. */
export interface Answered {
    readonly asks: readonly VisualAsk[];
    readonly answers: VisualAnswer[];
    readonly values: ReturnType<typeof visualValues>;
}

/**
 * A placement's visual.
 *
 * @param content - What the placement holds
 * @returns Its visual
 * @throws {Error} When it holds no visual
 */
export function visualOf(content: ReturnType<typeof Studio.visual.of>): ValueTypeOf<typeof StudioVisualType> {
    if (content.type !== "visual") throw new Error("not a visual");
    return content.value;
}

/**
 * A program over the orders, asked in memory as e3 asks it, at the quarter's minute.
 *
 * @param program - The program
 * @returns Its answer
 */
export async function asked(program: string): Promise<VisualAnswer> {
    const kept = await askProgram(program, ORDERS_ROOT, SEAMS, { now: QUARTER_NOW }, new AbortController().signal);
    if (kept === undefined) throw new Error("abandoned");
    return kept.value;
}

/**
 * A visual over the orders, asked: each program it prints, asked in memory as
 * e3 asks it.
 *
 * @param content - The visual, as a placement holds it
 * @param state - The page's state; the quarter's filter unless given
 * @param page - The page of its rows it asks — a records table's, a list's, a summary's, a pivot's; its first unless given
 * @returns Its asks, their answers, and its values
 */
export async function answered(content: ReturnType<typeof Studio.visual.of>, state: PrintState = QUARTER, page?: VisualPage): Promise<Answered> {
    const visual = visualOf(content);
    const printed = printVisual(visual, ORDERS_SOURCE, state, page);
    if (printed.kind !== "asks") throw new Error(`printed ${printed.kind}`);
    const answers = await Promise.all(printed.asks.map((ask) => asked(ask.program)));
    return { asks: printed.asks, answers, values: visualValues(visual.view) };
}

/**
 * An alert on a visual over the orders, asked (#1674): its check's program,
 * asked in memory as e3 asks it, at the quarter's minute.
 *
 * @param content - The visual, as a placement holds it
 * @param where - The alert's condition over one of the visual's rows
 * @param state - The alert's filters; the quarter's unless given
 * @returns The program, its answer, and the fields of the rows it checks
 */
export async function alertAnswered(content: ReturnType<typeof Studio.visual.of>, where: JqNode, state: PrintState = QUARTER): Promise<{
    readonly program: string; readonly answer: VisualAnswer; readonly fields: readonly AlertField[]; readonly readsNow: boolean;
}> {
    const printed = printAlert(visualOf(content), ORDERS_SOURCE, state, where);
    if (printed.kind !== "ask") throw new Error(`printed ${printed.kind}`);
    return { program: printed.ask.program, answer: await asked(printed.ask.program), fields: printed.fields, readsNow: printed.ask.readsNow };
}
