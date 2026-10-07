/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan.over(data, [series…])` (#1191, `Plan Builder Spec.md` PB9): series
 * over a dataset, read only, for a Plan's `rows` — a dataset's rows beside the
 * event kinds, laid out as `data` and `series` lay a canvas out.
 *
 * A Plan's edits go through its event kinds' records, so a series here that
 * declares `edit` is refused.
 *
 * @packageDocumentation
 */

import { East, Expr, printType, type DictType, type EastType, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";
import { PlanBlocksType, type PlanAxisKindLiteral, type PlanKinded } from "./types.js";
import { applySeries, checkSeries, planSeriesFacts, planSeriesKeys, type PlanSeriesFacts, type PlanSeriesValue } from "./series.js";
import type { PlanBindHandle } from "./root.js";

/** The keys of the series each `Plan.over` laid out, by the blocks it returned. */
const OVER_KEYS = new WeakMap<object, readonly string[]>();

/**
 * One series a `Plan.over` was given: what it is, and the keys its rows carry.
 *
 * @internal
 */
export interface PlanOverSeries {
    /** Its facts: kind, key and title. */
    readonly facts: PlanSeriesFacts;
    /** The keys of its rows: its own, and every series' nested in it. */
    readonly keys: readonly string[];
}

/** The series each `Plan.over` was given, in order, by the blocks it returned. */
const OVER_SERIES = new WeakMap<object, readonly PlanOverSeries[]>();

/**
 * The series a `Plan.over` was given, in order — what a Plan's library lists
 * in its Series tab, an eye apiece, and what hiding each hides (#1195).
 *
 * @param rows - One of a Plan's `rows`
 * @returns The series; `undefined` for anything `Plan.over` did not return
 * @internal
 */
export function overSeries(rows: unknown): readonly PlanOverSeries[] | undefined {
    return typeof rows === "object" && rows !== null ? OVER_SERIES.get(rows) : undefined;
}

/**
 * The keys of the series a `Plan.over` laid out — what a Plan holds the keys
 * it gives its own rows apart from (#1192).
 *
 * @param rows - One of a Plan's `rows`
 * @returns Its series' keys, the series nested in them included; `undefined` for anything `Plan.over` did not return
 * @internal
 */
export function overSeriesKeys(rows: unknown): readonly string[] | undefined {
    return typeof rows === "object" && rows !== null ? OVER_KEYS.get(rows) : undefined;
}

/**
 * The blocks `Plan.over` makes: series over a dataset, read only, for a Plan's
 * `rows` — branded with the axis kind its series ride.
 *
 * @typeParam K - The axis kind the series ride
 */
export type PlanOverRows<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanBlocksType>, K>;

/**
 * Lays series out over a dataset, read only, for a Plan's `rows`.
 *
 * @typeParam K - The axis kind the series ride
 * @param data - The dataset: a keyed collection (`Data.bind(d).read()`), or a bind handle over one
 * @param series - The `Plan.series.*` values over its entries, written in place — the list is the layout
 * @returns The blocks, for a Plan's `rows`
 * @throws {Error} When `data` is not a keyed collection; no series is given; a series is not a `Plan.series.*` value
 *   written in place, is built over entries of another type, or declares `edit`; or two series share a key
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, VariantType, some, variant } from "@elaraai/east";
 * import { EventStateType, Format, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const PrintPress = StructType({ name: StringType, hall: StringType, sheets_per_hour: FloatType });
 * export const PrintJob = StructType({
 *     title: StringType,
 *     start: OptionType(DateTimeType),
 *     end: OptionType(DateTimeType),
 *     press: OptionType(StringType),
 *     state: EventStateType,
 *     sheets: FloatType,
 *     customer: StringType,
 *     stock: VariantType({ coated: NullType, uncoated: NullType, board: NullType }),
 *     due: OptionType(DateTimeType),
 * });
 * export const PrintStock = StructType({ name: StringType, weekly: ArrayType(FloatType) });
 * export const planPrintPresses = e3.record("plan_print_presses", DictType(StringType, PrintPress), new Map([
 *     ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }],
 *     ["a2", { name: "Press A2", hall: "Hall A", sheets_per_hour: 10000.0 }],
 *     ["a3", { name: "Press A3", hall: "Hall A", sheets_per_hour: 8000.0 }],
 *     ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
 *     ["b2", { name: "Press B2", hall: "Hall B", sheets_per_hour: 12000.0 }],
 *     ["b3", { name: "Press B3", hall: "Hall B", sheets_per_hour: 6000.0 }],
 * ]));
 * export const planLinkJobs = e3.record("plan_link_jobs", DictType(StringType, PrintJob), new Map([
 *     ["J-2001", { title: "Handbook covers", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T08:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 12000.0, customer: "Elmway College", stock: variant("board", null), due: some(new Date("2026-10-07T00:00:00Z")) }],
 *     ["J-2002", { title: "Course handbook", start: some(new Date("2026-10-13T06:00:00Z")), end: some(new Date("2026-10-13T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-2003", { title: "Box sleeves", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T09:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 18000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
 *     ["J-2004", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T12:00:00Z")), press: some("a1"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 * ]));
 * export const planLinkJobsPatch = e3.mutation.patch(planLinkJobs);
 * export const planLinkStock = e3.input("plan_link_stock", DictType(StringType, PrintStock), variant("value", new Map([
 *     ["board", { name: "Board", weekly: [40.0, 22.0, 31.0, 18.0] }],
 *     ["coated", { name: "Coated", weekly: [520.0, 410.0, 460.0, 380.0] }],
 *     ["uncoated", { name: "Uncoated", weekly: [300.0, 260.0, 280.0, 240.0] }],
 * ])));
 *
 * const planEventLinks = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const presses = $.let(Record.bind(planPrintPresses, []));
 *         const jobs = $.let(Record.bind(planLinkJobs, [planLinkJobsPatch]));
 *         const stock = $.let(Data.bind(planLinkStock));
 *         // The window's first Monday: each stock reading runs from it, a week apiece.
 *         const first = $.const(new Date("2026-10-05T00:00:00Z"), DateTimeType);
 *         const StockWeek = StructType({ at: DateTimeType, value: OptionType(FloatType) });
 *         const weekly = $.const(East.function([ArrayType(FloatType)], ArrayType(StockWeek), (_$2, readings) =>
 *             East.Array.generate(readings.size(), StockWeek, (_$3, i) => ({ at: first.addWeeks(i), value: some(readings.get(i)) }))));
 *         const axis = $.let(Plan.axis({
 *             window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
 *             resolution: "week",
 *         }));
 *         return (
 *             <Plan
 *                 axis={axis}
 *                 resources={{
 *                     presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall }),
 *                 }}
 *                 events={{
 *                     job: Schedule.events(jobs, {
 *                         name: "Print job", icon: "file-lines",
 *                         title: "title", start: "start", end: "end",
 *                         resource: { field: "press", of: "presses" },
 *                         state: "state", quantity: { field: "sheets", unit: "sheets" },
 *                     }),
 *                 }}
 *                 rows={[
 *                     Plan.over(stock, [
 *                         Plan.series.table(PrintStock, {
 *                             key: "stock", title: "Paper stock", label: s => s.name,
 *                             cells: s => Plan.tableCells(weekly(s.weekly)),
 *                             format: Format.Number({ maximumFractionDigits: 0n }),
 *                         }),
 *                     ]),
 *                 ]}
 *                 links={[
 *                     Plan.link({
 *                         key: "covers", from: Plan.eventRef("job", "J-2001"), to: Plan.eventRef("job", "J-2002"),
 *                         quantity: Plan.quantity(12000.0, { unit: "covers" }),
 *                     }),
 *                     Plan.link({
 *                         key: "sleeves", from: Plan.eventRef("job", "J-2003"), to: Plan.eventRef("job", "J-2004"),
 *                         quantity: Plan.quantity(18000.0, { unit: "sleeves" }),
 *                     }),
 *                 ]}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function createOver<K extends PlanAxisKindLiteral = never>(
    data: SubtypeExprOrValue<DictType<EastType, EastType>> | PlanBindHandle,
    series: PlanSeriesValue<K>[],
): PlanOverRows<K> {
    const value = East.value(data as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const valueType = Expr.type(value as unknown as Expr) as EastType;
    const read = valueType.type === "Struct" ? (valueType.fields as Record<string, EastType>)["read"] : undefined;
    const source = read !== undefined && read.type === "Function" ? (value as unknown as PlanBindHandle).read() as unknown as ExprType<EastType> : value;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict") {
        throw new Error(`Plan.over: \`data\` is a keyed collection — a Dict, or a bind handle over one (Data.bind) — and this one is ${printType(type)}`);
    }
    if (series.length === 0) {
        throw new Error("Plan.over: lays series over the dataset — give at least one `Plan.series.*`");
    }
    const given = series.map((one, i): PlanOverSeries => {
        const facts = planSeriesFacts(one, type, `Plan.over › series[${i}]`);
        if (facts === undefined) {
            throw new Error(`Plan.over: series[${i}] is a Plan.series.* value written in place — a series bound or stored elsewhere cannot be checked to be read only`);
        }
        if (facts.writes) {
            throw new Error(`Plan.over: series[${i}], ${facts.arm} "${facts.title}", declares \`edit\` — a Plan's rows over a dataset are read only, and its edits go through its event kinds (Schedule.events)`);
        }
        // Written in place, so its keys are known: its own and its nested series'.
        return { facts, keys: planSeriesKeys([one]) ?? [facts.key] };
    });
    checkSeries(series, "Plan.over");
    const blocks = applySeries(series, source) as unknown as PlanOverRows<K>;
    const keys = planSeriesKeys(series);
    if (keys !== undefined) OVER_KEYS.set(blocks, keys);
    OVER_SERIES.set(blocks, given);
    return blocks;
}
