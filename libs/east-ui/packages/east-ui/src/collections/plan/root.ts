/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan root — `Plan.Root`, which assembles the whole canvas value against
 * the `component.ts` arm.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    ArrayType,
    BooleanType,
    DictType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    isTypeEqual,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";
import { DensityType, type DensityLiteral } from "../../style/interaction.js";
import { buildReview, type ReviewConfig } from "../../contracts/review.js";
import { DragEventType } from "../../contracts/drag.js";
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import {
    PlanAxisType,
    PlanGrainType,
    type PlanGrainLiteral,
    PlanLinkType,
    PlanRowIdType,
    PlanRunClickEventType,
    PlanEventClickEventType,
    PlanMarkClickEventType,
    PlanChipClickEventType,
    PlanCellClickEventType,
    PlanGroupToggleEventType,
    PlanFooterItemType,
    PlanStyleType,
    PlanElementRefType,
    PlanBlocksType,
    PlanRowsType,
    type PlanAxisKindLiteral,
    type PlanAxisInput,
} from "./types.js";
import { PlanReviewType } from "./ir.js";
import { resolveTag, WINDOWLESS_AXES } from "./builders.js";
import { applySeries, checkSeries, PlanSeriesType, type PlanSeriesInput } from "./series.js";
import { pickActive, PickBindType, type PickHandle } from "../../contracts/pick.js";
import { resolveRowSource, buildRowSource, type PagedSourceLike } from "../../contracts/source.js";


// ============================================================================
// Root
// ============================================================================

/** The default slice affordance list (§1 toolbar). */
const DEFAULT_PLAN_AFFORDANCES: SliceAffordanceLiteral[] =
    ["cohort", "filter", "search", "range", "resolution", "brush", "summary"];

/**
 * The Plan review config — the shared {@link ReviewConfig} at the row's id
 * ({@link PlanRowIdType}).
 */
export type PlanReviewConfig = ReviewConfig<PlanRowIdType>;

/**
 * Configuration for {@link Plan.Root} (the `<Plan>` tag's props).
 *
 * @remarks
 * `K` is the canvas's axis kind, inferred from `axis` ALONE (`series` is a
 * `NoInfer` site): a `Plan.axis.number(...)` fixes `K = "number"`, and every
 * series in the array must then carry a kind within it — a `"time"` series
 * is a compile error at the tag. An erased axis (a `$.let`-bound expression,
 * a variant value) leaves `K` at every kind, so the render-time diagnostic
 * decides; an erased series (`$.const`-bound list, East expression) is
 * accepted on any axis for the same reason.
 *
 * @typeParam K - The canvas's axis kind — inferred from `axis`
 * @property axis - The shared axis declaration (`Plan.axis` / `.time` / `.number` / `.ordinal`)
 * @property data - The source — a `Dict<K, R>` value/expression, or a paged source of one; pairs with `series` or `pick`
 * @property series - The row series over `data` — `Plan.series.*` values; the list IS the layout; exclusive with `pick`
 * @property pick - A bound series library (`Plan.pick`) — the canvas shows the picked series and mounts the library panel; exclusive with `series`
 * @property links - The link graph (R1) — run-edge quantity links (`Plan.link` values)
 * @property grain - Initial grain (`"group"` / `"resource"`; default resource)
 * @property popover - Generalized click-popover resolver over the element ref (`none` result ⇒ no surface)
 * @property hover - Generalized hovercard resolver over the element ref (`none` result ⇒ no surface)
 * @property expandRender - The R2 developer render for rows declaring `expand` (called with the row's id)
 * @property expandGutter - The R2 gutter render — fills the expanded row's grown gutter cell (called with the row's id)
 * @property review - The shared review chrome (decision column + batch foot)
 * @property slice - Bound slice chrome (toolbar affordances)
 * @property footer - Status-footer items
 * @property id - DnD target identity
 * @property sources - Library ids accepted for `add` drags
 * @property onDrag - The shared drag funnel — a library card dropped on a row reports an `add`
 * @property canDrop - IR-level drop veto (the ⊘ stage)
 * @property onSelect - Row click (selection)
 * @property onRunClick - Span bar click
 * @property onEventClick - Bucket tile click
 * @property onMarkClick - Event mark / decision diamond click
 * @property onChipClick - Cards chip click
 * @property onCellClick - Heat / table / weight / segment cell click
 * @property onGroupToggle - A row with children expanded or collapsed
 * @property onGrainChange - Grain segment change
 * @property style - Sizing, density and gutter width
 */
export interface PlanConfig<K extends PlanAxisKindLiteral = PlanAxisKindLiteral> {
    /** The shared axis declaration (`Plan.axis` / `.time` / `.number` / `.ordinal`) — fixes the canvas kind `K`.
     *  A time or number axis states its `window`, or the canvas binds a `slice` whose range supplies it —
     *  there is no fit to the data (#822), inline or paged. */
    axis: PlanAxisInput<K>;
    /** The source — a KEYED collection: a `Dict<K, R>` value or expression (a
     *  `$.let`-bound map, `Data.bind(...).read()`) for the INLINE arm, or a
     *  `$.let`-bound paged handle over one (`Data.bindPaged(ops)`) for the
     *  PAGED arm; the East type is the discriminant. Any key type: a row's path
     *  starts with its entry's key (the String itself, any other key as its
     *  `.east` text), so the canvas is addressed by the keys the source is
     *  searched and windowed by. Entries may be any East type — a struct, a
     *  recursive node, or a collection (`groupToDicts`' groups).
     *
     *  A positional collection is refused — key it at the call site with
     *  `rows.toDict((_$, r) => r.id)`, which makes the choice explicit. */
    data: SubtypeExprOrValue<DictType<EastType, EastType>> | PagedSourceLike;
    /** The row series over `data` — `Plan.series.*` values, a TS array or an
     *  East expression of `ArrayType(Plan.Types.Series(R))`.
     *
     *  The list IS the layout (#822): each series contributes one contiguous
     *  block, top to bottom in declared order, its rows in source order, each
     *  parent followed by its subtree. Series keys must be unique across the
     *  whole series tree — a TS array is checked here.
     *
     *  Every series' axis kind must lie within the axis's (`K`): a `"time"`
     *  series on a `"number"` axis fails to compile here. */
    series?: PlanSeriesInput<NoInfer<K>>;
    /**
     * A bound series library from `Plan.pick` — the pickable form of `series`.
     *
     * @remarks
     * Exclusive with `series`, because the handle already CARRIES the series
     * list; passing both would say it twice and leave the two free to disagree.
     * Give one or the other: `series` for a fixed canvas, `pick` for a canvas
     * whose rows the user chooses.
     *
     * The Plan does the rest — it feeds itself the picked series (in the pick's
     * order, which is the layout) and mounts the library panel as chrome, the
     * way `slice` mounts the rail.
     *
     * A pick is STATE, so a Plan carrying one must sit inside a `Reactive` —
     * `Plan.pick` binds through `State.bind`, and a bind outside a reactive
     * evaluation promotes the enclosing function to async.
     */
    pick?: PickHandle<ReturnType<typeof PlanSeriesType>>;
    /** The link graph (R1) — run-edge quantity links (`Plan.link` values, map-derivable
     *  from data, their ends `Plan.ref(series, …path)`); the links-focus control gathers a
     *  row's transitive family over it. */
    links?: SubtypeExprOrValue<ArrayType<PlanLinkType>>;
    /** Initial grain (default `"resource"`). */
    grain?: PlanGrainLiteral | SubtypeExprOrValue<PlanGrainType>;
    /** Generalized click-popover resolver — called with the clicked element's
     *  ref (`run` / `event` / `chip` / `mark` / `cell` arm, each carrying the
     *  row's id); returning `none` opens no surface. */
    popover?: SubtypeExprOrValue<FunctionType<[PlanElementRefType], OptionType<UIComponentType>>>;
    /** Generalized hovercard resolver — the hover twin of `popover`. */
    hover?: SubtypeExprOrValue<FunctionType<[PlanElementRefType], OptionType<UIComponentType>>>;
    /** The R2 developer render — called with the row's id when a row declaring
     *  `expand` focuses; builds the mounted body from captured data /
     *  bind-handles. */
    expandRender?: SubtypeExprOrValue<FunctionType<[PlanRowIdType], UIComponentType>>;
    /** The R2 GUTTER render — an expanded row's gutter cell grows with the row
     *  (one tall cell, top-aligned under the row's name), and this fills the
     *  space that opens up: the identity, measures or controls that only earn
     *  their place once the row has the canvas. Called with the same row id
     *  as `expandRender`. */
    expandGutter?: SubtypeExprOrValue<FunctionType<[PlanRowIdType], UIComponentType>>;
    /** The shared review chrome (decision column + batch foot); callbacks receive the row's id. */
    review?: PlanReviewConfig;
    /** Bound slice chrome — the handle + toolbar affordances (default `["cohort","filter","search","range","resolution","brush","summary"]`). */
    slice?: {
        /** The bound handle from `Slice.bind`. */
        slice: SubtypeExprOrValue<SliceBindType>;
        /** The toolbar affordances, in order. */
        affordances?: SliceAffordanceLiteral[];
    };
    /** Status-footer items (`end: true` right-aligns). */
    footer?: {
        /** The footer text. */
        text: SubtypeExprOrValue<StringType>;
        /** Optional status tint. */
        tone?: StatusValueLiteral | SubtypeExprOrValue<StatusValueType>;
        /** Right-align the item. */
        end?: boolean;
    }[];
    /** DnD target identity — names the Plan in drag-grammar cell refs. */
    id?: string;
    /** Library ids accepted for `add` drags (omit = no adds). */
    sources?: string[];
    /** The shared drag funnel (`contracts/drag.ts`) — a library card dropped on a row reports an
     *  `add` here, its `CellRef.row` the row id's canonical text. Nothing on the canvas starts a
     *  drag, so `move` / `resize` / `remove` never arrive. */
    onDrag?: SubtypeExprOrValue<FunctionType<[DragEventType], NullType>>;
    /** IR-level drop veto — `false` ⇒ the ⊘ invalid stage; a throwing predicate fails open. */
    canDrop?: SubtypeExprOrValue<FunctionType<[DragEventType], BooleanType>>;
    /** Row click (selection) — the row's id. */
    onSelect?: SubtypeExprOrValue<FunctionType<[PlanRowIdType], NullType>>;
    /** Span bar click (`{ row, run }`). */
    onRunClick?: SubtypeExprOrValue<FunctionType<[PlanRunClickEventType], NullType>>;
    /** Bucket tile click (`{ row, event }`). */
    onEventClick?: SubtypeExprOrValue<FunctionType<[PlanEventClickEventType], NullType>>;
    /** Event mark / span decision-diamond click (`{ row, mark }`). */
    onMarkClick?: SubtypeExprOrValue<FunctionType<[PlanMarkClickEventType], NullType>>;
    /** Cards chip click (`{ row, chip }`). */
    onChipClick?: SubtypeExprOrValue<FunctionType<[PlanChipClickEventType], NullType>>;
    /** Bucket-cell click (`{ row, at }` — the bucket instant, not an index). */
    onCellClick?: SubtypeExprOrValue<FunctionType<[PlanCellClickEventType], NullType>>;
    /** A row with children expanded or collapsed (fires after the in-place swap). */
    onGroupToggle?: SubtypeExprOrValue<FunctionType<[PlanGroupToggleEventType], NullType>>;
    /** Grain segment change (grain is Plan-local state; initial via `grain`). */
    onGrainChange?: SubtypeExprOrValue<FunctionType<[PlanGrainType], NullType>>;
    /** Sizing (#320), density, gutter width. */
    style?: {
        /** Definite height (`"fill"` fills the parent). */
        height?: SubtypeExprOrValue<StringType>;
        /** Max-height cap. */
        maxHeight?: SubtypeExprOrValue<StringType>;
        /** Row rhythm. */
        density?: DensityLiteral | SubtypeExprOrValue<DensityType>;
        /** Gutter width — a CSS px size (`"168px"`; default 168). */
        gutterWidth?: SubtypeExprOrValue<StringType>;
    };
}

/** The source collection a series list's East type reads — its `derive`'s input, when the list's element is a series variant. */
function seriesSourceOf(list: ExprType<EastType>): EastType | undefined {
    const element = (Expr.type(list as unknown as Expr) as { value?: { type?: string; cases?: Record<string, { fields?: Record<string, { inputs?: EastType[] }> }> } }).value;
    if (element?.type !== "Variant") return undefined;
    return element.cases?.["span"]?.fields?.["derive"]?.inputs?.[0];
}

/**
 * Creates the Plan root — the whole canvas.
 *
 * @typeParam K - The canvas's axis kind, inferred from `config.axis`; every series must lie within it
 * @param config - The Plan configuration ({@link PlanConfig})
 * @returns An East expression of `UIComponentType`
 * @throws {Error} When `data` is not a keyed source, `series` / `pick` are both or neither given, two series share a
 *   key, a bound series list reads another key type than `data`, or the axis states no window and no slice is bound
 *
 * @remarks
 * Window and resolution have no callbacks by design: they are slice writes
 * (`setRange` / `setResolution`) — hosts observe the slice. Dragging a
 * proposal is a Modify on its decision, not a free edit — host semantics
 * behind `onDrag`; the surface only reports.
 */
export function createPlanRoot<K extends PlanAxisKindLiteral = PlanAxisKindLiteral>(config: PlanConfig<K>): ExprType<UIComponentType> {
    // A canvas is DEFINED as data + series (+ the root resolvers) — there
    // is no rows-authoring channel; the IR's inline arm is what inline
    // application collapses to.
    if (config.data === undefined) {
        throw new Error("Plan: `data` is required — a canvas is its data plus the series over it");
    }
    if ((config.series === undefined) === (config.pick === undefined)) {
        throw new Error(
            "Plan: give exactly one of `series` or `pick` — `series` for a fixed canvas, " +
            "`pick` for a pickable one. A `Plan.pick` handle already carries the series list, " +
            "so passing both says it twice and lets the two disagree.",
        );
    }
    // There is no fit to the data (#822): every canvas states its window, or
    // binds a slice whose range supplies it — inline and paged alike.
    if (WINDOWLESS_AXES.has(config.axis as object) && config.slice === undefined) {
        throw new Error(
            "Plan: the axis states no `window` and no `slice` is bound — declare the window " +
            "(`Plan.axis({ window: { min, max }, … })`), or bind a slice whose range supplies it. " +
            "A canvas never fits its axis to the data, so it reads the same inline and paged.",
        );
    }
    if (config.series !== undefined) checkSeries(config.series, "Plan");
    // A pick feeds the canvas its SURVIVING series; everything downstream sees
    // one series input either way.
    const seriesInput: PlanSeriesInput = config.pick !== undefined
        ? (pickActive(config.pick) as unknown as PlanSeriesInput)
        : config.series as PlanSeriesInput;
    // The shared row-source resolution (#567): inline collection, paged
    // source, or a whole-value bind handle — one dispatch, one vocabulary,
    // and the series pipeline is the `make` that turns each window's entries
    // into canvas rows (the single R-erasure point).
    const resolved = resolveRowSource(config.data, "Plan");
    // The canvas is KEYED: a row's path starts with its entry's key, which is
    // what keeps the canvas addressable by the keys the source is searched and
    // windowed by (#568). Refuse anything else rather than inventing keys.
    const collectionType = resolved.collectionType as { type: string };
    if (collectionType.type !== "Dict") {
        throw new Error(
            "Plan: `data` must be a keyed collection (`Dict<K, R>`) — a row's path starts with its entry's " +
            "key, so the canvas is addressed the same way the source is (the row space a paged source windows " +
            `and seeks). Got a ${collectionType.type}; key it at the call site, e.g. ` +
            "`data={rows.toDict((_$, r) => r.id)}`.",
        );
    }
    // A series list bound as an East value was built for its declared key
    // type — it must read the source's.
    if (!Array.isArray(seriesInput)) {
        const reads = seriesSourceOf(seriesInput as unknown as ExprType<EastType>);
        if (reads !== undefined && !isTypeEqual(reads, resolved.collectionType)) {
            throw new Error(
                "Plan: the series list is typed for another source than `data` — a list bound as an East value " +
                "(a `$.const` list, a `Plan.pick`) is built for the entries' declared key type, String unless a " +
                "series says `keyType`. Declare `keyType` on each series and type the list " +
                "`Plan.Types.Series(R, keyType)`, or pass the series as a TS array, which is built for `data` itself.",
            );
        }
    }
    // The canvas's BLOCKS, in layout order (#823): inline, the whole source's;
    // paged, each window's share of every block — one read serves them all.
    const rowsValue = buildRowSource(
        resolved,
        PlanBlocksType,
        (source) => applySeries(seriesInput, source),
    ) as unknown as ExprType<PlanRowsType>;
    const style = config.style;
    const styleValue = style !== undefined
        ? some(East.value({
            height:      style.height !== undefined ? some(style.height) : none,
            maxHeight:   style.maxHeight !== undefined ? some(style.maxHeight) : none,
            density:     style.density !== undefined ? some(resolveTag(style.density, DensityType)) : none,
            gutterWidth: style.gutterWidth !== undefined ? some(style.gutterWidth) : none,
        }, PlanStyleType))
        : none;
    const sliceChrome = config.slice !== undefined
        ? some(East.value({
            slice: config.slice.slice,
            affordances: East.value(
                (config.slice.affordances ?? DEFAULT_PLAN_AFFORDANCES).map(a => variant(a, null)),
                ArrayType(SliceAffordanceType),
            ),
        }, SliceChromeType))
        : none;
    return East.value(variant("Plan", {
        rows:     rowsValue,
        links:    East.value(config.links ?? [], ArrayType(PlanLinkType)),
        axis:     config.axis as SubtypeExprOrValue<PlanAxisType>,
        grain:    config.grain !== undefined ? some(resolveTag(config.grain, PlanGrainType)) : none,
        // East.value pins the exact function type (the Schematic `itemHover`
        // pattern) so the arm's recursion-marker slots unify.
        popover: config.popover !== undefined
            ? some(East.value(config.popover, FunctionType([PlanElementRefType], OptionType(UIComponentType))))
            : none,
        hover: config.hover !== undefined
            ? some(East.value(config.hover, FunctionType([PlanElementRefType], OptionType(UIComponentType))))
            : none,
        expandRender: config.expandRender !== undefined
            ? some(East.value(config.expandRender, FunctionType([PlanRowIdType], UIComponentType)))
            : none,
        expandGutter: config.expandGutter !== undefined
            ? some(East.value(config.expandGutter, FunctionType([PlanRowIdType], UIComponentType)))
            : none,
        review:   config.review !== undefined ? some(buildReview(config.review, PlanReviewType)) : none,
        // The library rides as chrome, like the slice rail: the non-generic
        // contract only, since the arm must stay a closed East type.
        pick:     config.pick !== undefined
            ? some(East.value((config.pick as unknown as ExprType<StructType<{ pick: PickBindType }>>).pick, PickBindType))
            : none,
        slice:    sliceChrome,
        footer:   (config.footer ?? []).map(f => East.value({
            text: f.text,
            tone: f.tone !== undefined ? some(resolveTag(f.tone, StatusValueType)) : none,
            end:  f.end !== undefined ? some(f.end) : none,
        }, PlanFooterItemType)),
        id:       config.id ?? "",
        sources:  East.value(config.sources ?? [], ArrayType(StringType)),
        onDrag:   config.onDrag !== undefined ? some(config.onDrag) : none,
        canDrop:  config.canDrop !== undefined ? some(config.canDrop) : none,
        onSelect: config.onSelect !== undefined ? some(config.onSelect) : none,
        onRunClick:    config.onRunClick !== undefined ? some(config.onRunClick) : none,
        onEventClick:  config.onEventClick !== undefined ? some(config.onEventClick) : none,
        onMarkClick:   config.onMarkClick !== undefined ? some(config.onMarkClick) : none,
        onChipClick:   config.onChipClick !== undefined ? some(config.onChipClick) : none,
        onCellClick:   config.onCellClick !== undefined ? some(config.onCellClick) : none,
        onGroupToggle: config.onGroupToggle !== undefined ? some(config.onGroupToggle) : none,
        onGrainChange: config.onGrainChange !== undefined ? some(config.onGrainChange) : none,
        style:    styleValue,
    }), UIComponentType);
}
