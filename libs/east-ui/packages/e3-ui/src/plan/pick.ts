/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a Plan's series show (#590, #1541 U3) — the Plan's façade over the
 * shared pick contract.
 *
 * A Plan's `series` is the list; `hidden` names the ones off to start. Where
 * its library lists `Plan.library.series()` the series are PICKED: the Series
 * tab lists each with its eye, what a viewer switches there is state, kept
 * under the Plan's `id`, and the canvas leaves out what it holds. A Plan
 * without the tab binds no state, and `hidden` names the series it does not
 * draw.
 *
 * The contract holds identified things and does not know what they are, so an
 * adopter supplies what it cannot: the things. For a Plan they are the lines
 * of its series list (`planPickables`): each series at the top of the list
 * whole — a section or a group leaves with its subtree — and each member of a
 * `views` alone, since each is a row of its own beside the others. A list
 * known only as it runs (an East expression) is read as it runs, an
 * eleven-arm match over the series variant: every arm carries the same four
 * identity fields, and the arm itself picks the kind's icon.
 *
 * There are no per-series row counts (#822): a count means something only when
 * every entry is in hand, and nothing on a Plan may behave differently because
 * its data is inline or paged.
 *
 * @packageDocumentation
 */

import {
    type BlockBuilder,
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

import { IconType, PickItemType, type PickBindType, type PickOptions } from "@elaraai/east-ui";
import { createPickBind, pickItems } from "@elaraai/east-ui/internal";
import { resolveIcon } from "./builders.js";
import {
    PlanHiddenType, checkSeries, planPickables, planSeriesKeys,
    type PlanPickable, type PlanSeriesArm, type PlanSeriesInput, type PlanSeriesValue,
} from "./series.js";

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

/**
 * A series' identity: ONE reified match, which each accessor calls — every
 * arm carries the same four fields, so matching per accessor would build four
 * copies of the same traversal (`shared/reify.ts`: reify once, then call). The
 * arms are spelled out rather than generated, mirroring `applySeriesValue` —
 * an arm added to the variant should fail this match, not fall through a
 * computed map.
 *
 * @param itemType - The series' type, as the list holding them gives it
 * @returns The function
 */
const seriesIdentity = (itemType: EastType) => East.function([itemType], PlanSeriesIdentityType, (_$, s) =>
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

/**
 * The shared accessors over a series value, each calling the series' identity
 * held in the block they are built in: a function written into each would
 * write its match over every series kind out once an accessor, and the pick's
 * derivations call them five times.
 *
 * @param identityOf - The series' identity ({@link seriesIdentity}), held in a variable
 * @returns The accessors
 */
function seriesAccessors(identityOf: (s: ExprType<EastType>) => ExprType<typeof PlanSeriesIdentityType>): PickOptions<EastType> {
    return {
        id:       (s) => identityOf(s).key,
        title:    (s) => identityOf(s).title,
        subtitle: (s) => identityOf(s).subtitle,
        icon:     (s) => identityOf(s).icon,
    };
}

/** One line of the Series tab, known as the Plan is built: its series' key, its name, its role line, and its icon or its kind's. */
function lineItem(line: PlanPickable): ExprType<PickItemType> {
    return East.value({
        id: line.key,
        title: line.title,
        subtitle: line.subtitle === undefined ? none : some(line.subtitle),
        icon: some(line.icon !== undefined ? resolveIcon(line.icon) : { name: KIND_ICONS[line.arm], prefix: "fas", label: none, style: none }),
        count: none,
        narrowed: false,
    }, PickItemType);
}

/**
 * The library entries for a Plan's series — described, with NO state binding:
 * what the Series tab lists of them, in the order the canvas draws them.
 *
 * @remarks
 * A list written in place is read as the Plan is built: each series at the
 * top of the list by its key, and each member of a `views` alone (#1541, U3).
 * A list known only as it runs — an East expression, or one holding a series
 * bound elsewhere — lists each of its series whole, read off the value.
 *
 * The pick a Plan binds lists exactly these, so proving this proves the bound
 * path too. Split out because `State.bind` is not runnable in a `describeEast`
 * spec (`TestImpl` carries no State runtime), and identity and kind icons are
 * exactly the part worth asserting.
 *
 * @param all - Every series that COULD show
 * @returns One descriptor per line, in declaration order
 */
export function createPlanPickItems(all: PlanSeriesInput): ExprType<ArrayType<PickItemType>> {
    checkSeries(all, "Plan.pickItems");
    const lines = planPickables(all);
    if (lines !== undefined) return East.value(lines.map(lineItem), ArrayType(PickItemType));
    const allExpr = East.value(all as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    const itemType: EastType = (Expr.type(allExpr) as ArrayType<EastType>).value;
    return Expr.block(($) => pickItems(allExpr, seriesAccessors($.const(seriesIdentity(itemType)))));
}

/**
 * The words the removed `pick` is refused in (#1541, U3), naming what replaces it.
 *
 * @returns The refusal
 * @internal
 */
export function pickRefusal(): string {
    return "Plan: `pick` is removed (#1541) — `series` is the list, its series picked where `library` lists " +
        "Plan.library.series(), kept under the Plan's `id`, and `hidden` names the ones off to start: give `series` the " +
        "list Plan.pick was given and `hidden` the keys it hid, series={[…]} hidden={[\"utilisation\"]}";
}

/**
 * What a Plan shows of its series (#1541, U3).
 *
 * @internal
 * @property pick - The pick the Series tab switches the series through, on the wire; none where nothing picks
 * @property hidden - The keys the canvas leaves out, read where it is written: the pick's state, or the list `hidden`
 *   gave; none where every series shows
 */
export interface PlanShown {
    readonly pick: ExprType<PickBindType> | undefined;
    readonly hidden: ExprType<PlanHiddenType> | undefined;
}

/** Each name in quotes, in a list. */
const quoted = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(", ");

/**
 * Refuses a `hidden` that names something no viewer could switch back on: a
 * key the series list does not hold, a series nested in another, or a `views`
 * itself.
 *
 * @param series - The `series` input
 * @param hidden - The keys `hidden` names
 * @throws {Error} Naming the key, what it is, and the keys `hidden` may name
 */
function checkHidden(series: PlanSeriesInput, hidden: readonly string[]): void {
    if (!Array.isArray(hidden) || hidden.some((name) => typeof name !== "string")) {
        throw new Error("Plan: `hidden` lists the keys of the series off to start — hidden={[\"utilisation\"]}");
    }
    // A list known only as it runs names its series then: a key naming none is ignored, as the pick's state is.
    const lines = planPickables(series);
    if (lines === undefined) return;
    const names = lines.map((line) => line.key);
    const tree = planSeriesKeys(series) ?? [];
    // Each series at the top of the list, by its own key: one that is no line is a `views`, listed as its members.
    const top = (series as readonly unknown[]).map((one) => planSeriesKeys([one])?.[0]);
    for (const name of hidden) {
        if (names.includes(name)) continue;
        const what = !tree.includes(name) ? "which is no series of this Plan"
            : top.includes(name) ? "a `views`, whose members show and hide each alone"
                : "a series nested in another, which shows and hides with it";
        throw new Error(`Plan: \`hidden\` names "${name}", ${what} — it names a series at the top of \`series\`, or a member of a \`views\` there: ${quoted(names)}`);
    }
}

/**
 * Works out what a Plan shows of its series (#1541, U3), in the block its
 * root is built in.
 *
 * @remarks
 * With `key` the series are PICKED: the pick is bound under it through the
 * shared contract (`Pick.bind`), its items the Series tab's lines and its
 * state seeded with `hidden`; the canvas leaves out what the state holds,
 * read wherever its rows are made — a paged window read later sees what the
 * viewer has switched since. The bind is STATE (`State.bind` underneath), so
 * such a Plan sits inside a `Reactive`. Without `key` nothing is bound:
 * `hidden` is the set itself.
 *
 * @typeParam B - The block's type
 * @param $ - The block the Plan's root is built in: the pick is held in it once
 * @param series - The Plan's `series`, when it has any
 * @param hidden - The keys of the series off to start
 * @param key - The State key the pick is kept under, where the library lists the Series tab; none, nothing picks
 * @returns The pick and the hidden set
 * @throws {Error} When `hidden` is given with no `series`, or names a key no viewer could switch back on
 * @internal
 */
export function planShown<B extends EastType>($: BlockBuilder<B>, series: PlanSeriesInput | undefined, hidden: readonly string[] | undefined, key: string | undefined): PlanShown {
    if (series === undefined) {
        if (hidden !== undefined) {
            throw new Error("Plan: `hidden` names series of `series`, and this Plan has none — give `series` with it, or leave `hidden` out");
        }
        return { pick: undefined, hidden: undefined };
    }
    if (hidden !== undefined) checkHidden(series, hidden);
    if (key === undefined) {
        return { pick: undefined, hidden: hidden === undefined || hidden.length === 0 ? undefined : East.value(new Set(hidden), PlanHiddenType) };
    }
    // The pick over the tab's lines themselves: the contract's own bind, its state the keys switched off.
    const handle = $.const(createPickBind(key, createPlanPickItems(series), {
        id: (line) => line.id,
        title: (line) => line.title,
        subtitle: (line) => line.subtitle,
        icon: (line) => line.icon,
        ...(hidden !== undefined ? { hidden } : {}),
    }));
    return { pick: handle.pick, hidden: handle.pick.state.read().toSet() };
}
