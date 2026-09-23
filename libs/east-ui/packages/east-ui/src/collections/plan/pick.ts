/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan.pick` — the Plan's façade over the shared pick contract (#590).
 *
 * The contract holds identified things and does not know what they are, so an
 * adopter supplies the two things it cannot: how to read identity off one item,
 * and what a useful count is. For a Plan that is a nine-arm match over the
 * series variant, plus the row count that series would contribute.
 *
 * Nothing here is Plan-specific machinery — it is ~40 lines of accessors. The
 * façade exists so an author writes `Plan.pick(key, all)` instead of restating
 * the match at every call site, not because the Plan needs its own contract.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    DictType,
    East,
    Expr,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    some,
    none,
} from "@elaraai/east";

import { IconType } from "../../display/icon/types.js";
import { createPickBind, pickItems, type PickHandle, type PickItemType, type PickOptions } from "../../contracts/pick.js";
import { PlanSeriesType, applySeriesValue, type PlanSeriesInput, type PlanSeriesValue } from "./series.js";

/**
 * The FA glyph the library shows for each series arm — the row kind's glyph
 * for the seven kinds; `group` and `rows` take the marks that read as "a
 * section" and "a hand-built list".
 */
const KIND_ICONS: Record<string, string> = {
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
    /**
     * The canvas data. Supplying it gives each library entry its row COUNT,
     * derived by running that series' own pipeline — which is what turns "this
     * series is on" into "this series contributes 18 rows", and what surfaces
     * the `0 rs` case where a series is switched on to no visible effect.
     *
     * Omit it for a paged canvas: a window cannot know the total, and a wrong
     * count is worse than none.
     */
    data?: SubtypeExprOrValue<DictType<StringType, StructType>>;
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
    const ident = (v: ExprType<StructType>, tag: string) => East.value({
        key:      v["key"] as SubtypeExprOrValue<StringType>,
        title:    v["title"] as SubtypeExprOrValue<StringType>,
        subtitle: v["subtitle"] as SubtypeExprOrValue<OptionType<StringType>>,
        icon:     (v["icon"] as ExprType<OptionType<IconType>>).match({
            some: (_$, ic) => East.value(some(ic), OptionType(IconType)),
            none: (_$) => East.value(
                some({ name: KIND_ICONS[tag] as string, prefix: "fas", label: none, style: none }),
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
            rows:    (_$2, v) => ident(v as unknown as ExprType<StructType>, "rows"),
        }) as never);

    // The row count this series contributes — its own pipeline, run over the
    // canvas data. Absent for a paged canvas, which cannot know a total.
    const data = options?.data;
    const countOf = data === undefined ? undefined : East.function([itemType], IntegerType, (_$, s) =>
        applySeriesValue(s as unknown as PlanSeriesValue,
            East.value(data) as ExprType<DictType<StringType, StructType>>).size());

    return {
        id:       (s) => identityOf(s).key,
        title:    (s) => identityOf(s).title,
        subtitle: (s) => identityOf(s).subtitle,
        icon:     (s) => identityOf(s).icon,
        ...(countOf !== undefined ? { count: (s: ExprType<EastType>) => some(countOf(s)) } : {}),
        ...(options?.hidden !== undefined ? { hidden: options.hidden } : {}),
    };
}

/**
 * Bind a Plan's row series to a persisted pick.
 *
 * @remarks
 * A GROUP is the unit a person picks — "add Machines" — and hiding one takes
 * its whole subtree with it, because the members are built by the group's own
 * `derive`. That is why every arm carries identity (#590 §6.1): without it the
 * library could only offer top-level series, which on a grouped canvas is
 * almost nothing.
 *
 * Identity is read through ONE nine-arm match rather than one match per
 * accessor — every arm carries the same four fields, so matching four times
 * would build four copies of the same traversal.
 *
 * The handle is STATE (`State.bind` underneath), so it is built inside a
 * `Reactive`. Pass it to the canvas as `pick`, in place of `series`: the Plan
 * shows the picked series and mounts the library panel itself.
 *
 * @param key - The store key; also the persistence key
 * @param all - Every series that COULD show
 * @param options - Data for counts, and the initial hidden set ({@link PlanPickOptions})
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
 *         // Every series that COULD show — the library lists these.
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
    const allExpr = East.value(all as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    // Typed at the SERIES shape, not the erased element type: that is what
    // makes `Pick.active(shown)` assignable straight back to the `series` prop.
    return createPickBind(key, allExpr, planPickOptions(allExpr, options)) as unknown as
        PickHandle<ReturnType<typeof PlanSeriesType>>;
}

/**
 * A stable signature of WHICH series a canvas is built from.
 *
 * @remarks
 * Exists for the paged arm. `PagedSourceType` requires that "two sources with
 * the same `id` must serve the same rows", and a derived source built from a
 * SUBSET of the series serves different rows than one built from all of them —
 * so its id has to say so.
 *
 * The Plan's own window cache no longer rests on it. Since #809 the paging
 * driver keeps resident windows only for an EQUIVALENT source — the same id
 * AND the same `page` function, compared by IR and captures
 * (`equivalentFor`) — and a pick toggle rebuilds `page` over a different
 * series list, so the cache drops under an unchanged id too (the paging
 * driver's `controller/paging.test.ts` pins both halves). The signature keeps the
 * id itself honest for every reader of the contract that goes by `id`.
 *
 * The signature is the joined keys, so it assumes a key NAMES a series: same
 * keys ⇒ same rows. Two consequences worth knowing:
 *
 * - Two series sharing a key share one entry in the hidden set and so toggle
 *   together — the active list is both-in or both-out, and the signature
 *   moves either way. They break the LIBRARY instead (one switch, two labels
 *   — `Pick.Panel` reports it).
 * - A key that stays put while the series it names CHANGES leaves the id
 *   unmoved, so the contract's "same id ⇒ same rows" no longer holds for
 *   anything keyed on the id. (The Plan's own cache still drops: the rebuilt
 *   `page` is not equivalent.) Keys must be stable AND identifying, which is
 *   what they were for.
 *
 * Row keys are a separate layer with its own rule: two series emitting the same
 * ROW key resolve LAST_WINS inside `applySeries`, deterministically by series
 * order, and identically in every window (#568).
 *
 * @param all - The series the canvas is built from
 * @returns The series' keys, joined — stable for a given active set
 */
export function seriesSignature(all: PlanSeriesInput): ExprType<StringType> {
    const allExpr = East.value(all as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    const itemType: EastType = (Expr.type(allExpr) as ArrayType<EastType>).value;
    // An EMPTY series list has no element type (`Never`), so there is no
    // variant to match on — and nothing to distinguish either. A canvas with no
    // series is legal (`Plan.Root({ …, series: [] })`).
    if ((itemType as { type?: string }).type !== "Variant") return East.value("", StringType);
    const keyOf = planPickOptions(allExpr).id;
    const keyFn = East.function([itemType], StringType, (_$, s) => keyOf(s));
    return allExpr.reduce(
        (_$, acc, s) => East.str`${acc}/${keyFn(s)}`,
        East.value("", StringType),
    ) as ExprType<StringType>;
}

/**
 * The library entries for a Plan's series — described, with NO state binding.
 *
 * @remarks
 * {@link createPlanPick} builds its `items` from the same accessors, so proving
 * this proves the bound path too. Split out because `State.bind` is not
 * runnable in a `describeEast` spec (`TestImpl` carries no State runtime), and
 * identity / kind icons / counts are exactly the part worth asserting.
 *
 * @param all - Every series that COULD show
 * @param options - Data for counts ({@link PlanPickOptions})
 * @returns One descriptor per series, in declaration order
 */
export function createPlanPickItems(
    all: PlanSeriesInput,
    options?: PlanPickOptions,
): ExprType<ArrayType<PickItemType>> {
    const allExpr = East.value(all as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    return pickItems(allExpr, planPickOptions(allExpr, options));
}
