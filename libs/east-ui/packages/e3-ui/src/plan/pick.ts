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

import { IconType, type PickHandle, type PickItemType, type PickOptions } from "@elaraai/east-ui";
import { createPickBind, pickItems } from "@elaraai/east-ui/internal";
import { PlanSeriesType, checkSeries, type PlanSeriesArm, type PlanSeriesInput, type PlanSeriesValue } from "./series.js";

/**
 * The FA glyph the library shows for each series kind — the row kind's glyph
 * for the seven row kinds; the four composites take the marks that read as
 * "a group per entry", "a titled block", "one entry several ways" and "a
 * hand-built list". The library pane's Series tab lists a measure and a
 * Plan's own rows with them too (#1195).
 *
 * @internal
 */
export const KIND_ICONS: Readonly<Record<PlanSeriesArm, string>> = {
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
 * person picks — "add Presses" — and hiding one takes its whole subtree with
 * it, because its members are built by its own `derive`.
 *
 * Identity is read through ONE match rather than one match per accessor —
 * every arm carries the same four fields, so matching four times would build
 * four copies of the same traversal. A TS list is checked here for two series
 * sharing a key (one switch would wear two labels).
 *
 * The handle is STATE (`State.bind` underneath), so it is built inside a
 * `Reactive`. Pass it to the canvas as `pick`, in place of `series`: the Plan
 * shows the picked series, and its library's Series tab
 * (`Plan.library.series()`) lists them, each with its eye. The data flagship,
 * `planTargetState`, picks its whole series list this way, one hidden to
 * start.
 *
 * @param key - The store key; also the persistence key
 * @param all - Every series that COULD show, in layout order
 * @param options - The initial hidden set ({@link PlanPickOptions})
 * @returns A pick handle over the series type — the canvas's `pick` prop
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
