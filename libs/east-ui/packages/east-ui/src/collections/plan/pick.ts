/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan.pick` — the Plan's façade over the shared pick contract (#590).
 *
 * The contract holds identified things and does not know what they are, so an
 * adopter supplies what it cannot: how to read identity off one item. For a
 * Plan that is an eleven-arm match over the series variant — every arm carries
 * the same four identity fields, and the arm itself picks the kind's icon.
 *
 * There are no per-series row counts (#822): a count means something only when
 * every entry is in hand, and nothing on a Plan may behave differently because
 * its data is inline or paged.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    East,
    Expr,
    OptionType,
    StringType,
    StructType,
    some,
    none,
} from "@elaraai/east";

import { IconType } from "../../display/icon/types.js";
import { createPickBind, pickItems, type PickHandle, type PickItemType, type PickOptions } from "../../contracts/pick.js";
import { PlanSeriesType, checkSeries, type PlanSeriesArm, type PlanSeriesInput, type PlanSeriesValue } from "./series.js";

/**
 * The FA glyph the library shows for each series kind — the row kind's glyph
 * for the seven row kinds; the four composites take the marks that read as
 * "a group per entry", "a titled block", "one entry several ways" and "a
 * hand-built list".
 */
const KIND_ICONS: Record<PlanSeriesArm, string> = {
    span:    "bars-staggered",
    // `border-all` was a 2x2 grid of squares — the same mark `table-cells-large`
    // draws for heat, and at 12px the two were indistinguishable (#590 §6.3).
    // Buckets quantise into COLUMNS with lanes inside them, so a columns mark
    // says what the row is and separates cleanly from heat's grid.
    buckets: "table-columns",
    chart:   "chart-line",
    heat:    "table-cells-large",
    table:   "table-list",
    cards:   "user-group",
    events:  "flag",
    group:   "layer-group",
    section: "heading",
    views:   "clone",
    rows:    "list",
};

/** Identity read off ONE series — the whole of what the library needs. */
const PlanSeriesIdentityType = StructType({
    key:      StringType,
    title:    StringType,
    subtitle: OptionType(StringType),
    icon:     OptionType(IconType),
});

/** Options for {@link createPlanPick}. */
export interface PlanPickOptions {
    /** Series switched off to begin with; omit ⇒ everything shows. */
    hidden?: readonly string[];
}

/** The shared accessors — see {@link createPlanPick}. */
function planPickOptions(
    allExpr: ExprType<ArrayType<EastType>>,
    options?: PlanPickOptions,
): PickOptions<EastType> {
    const itemType: EastType = (Expr.type(allExpr) as ArrayType<EastType>).value;

    /** One arm's identity, with the KIND's glyph when the series declares none. */
    const ident = (v: ExprType<StructType>, tag: PlanSeriesArm) => East.value({
        key:      v["key"] as SubtypeExprOrValue<StringType>,
        title:    v["title"] as SubtypeExprOrValue<StringType>,
        subtitle: v["subtitle"] as SubtypeExprOrValue<OptionType<StringType>>,
        icon:     (v["icon"] as ExprType<OptionType<IconType>>).match({
            some: (_$, ic) => East.value(some(ic), OptionType(IconType)),
            none: (_$) => East.value(
                some({ name: KIND_ICONS[tag], prefix: "fas", label: none, style: none }),
                OptionType(IconType)),
        }),
    }, PlanSeriesIdentityType);

    // ONE reified match, CALLED by each accessor — every arm carries the same
    // four fields, so matching per accessor would build four copies of the same
    // traversal (`shared/reify.ts`: reify once, then call). The arms are spelled
    // out rather than generated, mirroring `applySeriesValue` — an arm added to
    // the variant should fail this match, not fall through a computed map.
    const identityOf = East.function([itemType], PlanSeriesIdentityType, (_$, s) =>
        (s as unknown as PlanSeriesValue).match({
            span:    (_$2, v) => ident(v as unknown as ExprType<StructType>, "span"),
            buckets: (_$2, v) => ident(v as unknown as ExprType<StructType>, "buckets"),
            chart:   (_$2, v) => ident(v as unknown as ExprType<StructType>, "chart"),
            heat:    (_$2, v) => ident(v as unknown as ExprType<StructType>, "heat"),
            table:   (_$2, v) => ident(v as unknown as ExprType<StructType>, "table"),
            cards:   (_$2, v) => ident(v as unknown as ExprType<StructType>, "cards"),
            events:  (_$2, v) => ident(v as unknown as ExprType<StructType>, "events"),
            group:   (_$2, v) => ident(v as unknown as ExprType<StructType>, "group"),
            section: (_$2, v) => ident(v as unknown as ExprType<StructType>, "section"),
            views:   (_$2, v) => ident(v as unknown as ExprType<StructType>, "views"),
            rows:    (_$2, v) => ident(v as unknown as ExprType<StructType>, "rows"),
        }) as never);

    return {
        id:       (s) => identityOf(s).key,
        title:    (s) => identityOf(s).title,
        subtitle: (s) => identityOf(s).subtitle,
        icon:     (s) => identityOf(s).icon,
        ...(options?.hidden !== undefined ? { hidden: options.hidden } : {}),
    };
}

/**
 * Bind a Plan's row series to a persisted pick.
 *
 * @remarks
 * The list is the layout (#822): the canvas shows the series still switched
 * on, in the order they are listed, one block each — so the order written here
 * is the order on screen. A section, a group or a views series is the unit a
 * person picks — "add Machines" — and hiding one takes its whole subtree with
 * it, because its members are built by its own `derive`.
 *
 * Identity is read through ONE match rather than one match per accessor —
 * every arm carries the same four fields, so matching four times would build
 * four copies of the same traversal. A TS list is checked here for two series
 * sharing a key (one switch would wear two labels).
 *
 * The handle is STATE (`State.bind` underneath), so it is built inside a
 * `Reactive`. Pass it to the canvas as `pick`, in place of `series`: the Plan
 * shows the picked series and mounts the library panel itself.
 *
 * @param key - The store key; also the persistence key
 * @param all - Every series that COULD show, in layout order
 * @param options - The initial hidden set ({@link PlanPickOptions})
 * @returns A pick handle over the series type — the canvas's `pick` prop
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { EventStateType, Plan, Reactive, UIComponentType } from "@elaraai/east-ui";
 *
 * const canvas = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
 *         const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
 *             const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
 *             return w1.addWeeks(n.subtract(1n));
 *         }));
 *         const JobRow = StructType({
 *             batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
 *         });
 *         const OpsRow = StructType({
 *             series: StringType, jobs: ArrayType(JobRow), cells: ArrayType(Plan.Types.HeatCell),
 *         });
 *         const noJobs = $.const([], ArrayType(JobRow));
 *         const noCells = $.const([], ArrayType(Plan.Types.HeatCell));
 *         const pcts = $.const([46.0, 58.0, 66.0, 72.0, 84.0, 96.0], ArrayType(FloatType));
 *         const cells = $.let(East.Array.generate(6n, Plan.Types.HeatCell, (_$, i) => ({
 *             at: Plan.at.time(week(i.multiply(2n).add(27n))), value: some(pcts.get(i)), label: none,
 *         })));
 *         const ops = $.const(new Map([
 *             ["L1-M03", { series: "machines", cells: noCells,
 *                          jobs: [{ batch: "B-214", start: week(28n), end: week(31n), state: variant("in-progress", null) }] }],
 *             ["L1-M04", { series: "machines", cells: noCells,
 *                          jobs: [{ batch: "B-208", start: week(27n), end: week(30n), state: variant("actual", null) }] }],
 *             ["L2-load", { series: "load", cells, jobs: noJobs }],
 *         ]), DictType(StringType, OpsRow));
 *         // Every series that COULD show — the library lists these, and the
 *         // canvas shows the ones switched on in this order.
 *         const all = $.const([
 *             Plan.series.span(OpsRow, {
 *                 key: "machines", title: "Machine jobs", subtitle: "one row per machine",
 *                 match: r => r.series.equal("machines"),
 *                 label: (_r, k) => k, id: true,
 *                 runs: r => r.jobs.map((_$, j) => Plan.run({
 *                     key: j.batch, start: j.start, end: j.end,
 *                     label: East.str`RUN · ${j.batch}`, state: j.state,
 *                 })),
 *             }),
 *             Plan.series.heat(OpsRow, {
 *                 key: "load", title: "Line load", subtitle: "% per fortnight",
 *                 match: r => r.series.equal("load"),
 *                 label: (_r, k) => k,
 *                 cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
 *             }),
 *         ], ArrayType(Plan.Types.Series(OpsRow)));
 *         // The handle is STATE — which series are switched off, persisted
 *         // under its key — so it lives inside the Reactive. "load" starts off.
 *         const shown = $.let(Plan.pick("ex.plan.pick", all, { hidden: ["load"] }));
 *         const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
 *         // `pick` REPLACES `series`: the canvas shows the picked series and
 *         // mounts the library itself, so nothing else is wired.
 *         return (
 *             <Plan
 *                 axis={axis}
 *                 data={ops}
 *                 pick={shown}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function createPlanPick(
    key: string,
    all: PlanSeriesInput,
    options?: PlanPickOptions,
): PickHandle<ReturnType<typeof PlanSeriesType>> {
    checkSeries(all, "Plan.pick");
    const allExpr = East.value(all as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    // Typed at the SERIES shape, not the erased element type: that is what
    // makes `Pick.active(shown)` assignable straight back to the `series` prop.
    return createPickBind(key, allExpr, planPickOptions(allExpr, options)) as unknown as
        PickHandle<ReturnType<typeof PlanSeriesType>>;
}

/**
 * The library entries for a Plan's series — described, with NO state binding.
 *
 * @remarks
 * {@link createPlanPick} builds its `items` from the same accessors, so proving
 * this proves the bound path too. Split out because `State.bind` is not
 * runnable in a `describeEast` spec (`TestImpl` carries no State runtime), and
 * identity and kind icons are exactly the part worth asserting.
 *
 * @param all - Every series that COULD show
 * @returns One descriptor per series, in declaration order
 */
export function createPlanPickItems(all: PlanSeriesInput): ExprType<ArrayType<PickItemType>> {
    checkSeries(all, "Plan.pickItems");
    const allExpr = East.value(all as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    return pickItems(allExpr, planPickOptions(allExpr));
}
