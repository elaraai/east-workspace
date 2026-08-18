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
import { applySeriesValue, type PlanSeriesInput, type PlanSeriesValue } from "./series.js";

/**
 * The FA glyph each row kind declares.
 *
 * @remarks
 * `PlanTemplateKindType` has documented this set since the template model, and
 * nothing has ever rendered it — the library is the first surface that does.
 * `group` and `rows` are not template kinds and so are not in that set; they
 * take the marks that read as "a section" and "a hand-built list".
 */
const KIND_ICONS: Record<string, string> = {
    span:    "bars-staggered",
    buckets: "border-all",
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
 * @param key - The store key; also the persistence key
 * @param all - Every series that COULD show
 * @param options - Data for counts, and the initial hidden set ({@link PlanPickOptions})
 * @returns A pick handle over the series type
 *
 * @example
 * ```tsx
 * const shown = $.let(Plan.pick("ops.series", all, { data: ops }));
 *
 * <Pick.Panel value={shown} title="Series" />
 * <Plan axis={axis} data={ops} series={Pick.active(shown)} />
 * ```
 */
export function createPlanPick(
    key: string,
    all: PlanSeriesInput,
    options?: PlanPickOptions,
): PickHandle<EastType> {
    const allExpr = East.value(all as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    return createPickBind(key, allExpr, planPickOptions(allExpr, options));
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
