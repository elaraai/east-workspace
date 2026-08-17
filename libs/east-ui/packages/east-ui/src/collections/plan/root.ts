/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan root — row-library templates (the binding rides `make`) and
 * `Plan.Root`, which assembles the whole canvas value against the
 * `component.ts` arm.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    BooleanType,
    DictType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
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
    PlanRowRefType,
    PlanRunClickEventType,
    PlanEventClickEventType,
    PlanMarkClickEventType,
    PlanChipClickEventType,
    PlanCellClickEventType,
    PlanGroupToggleEventType,
    PlanFooterItemType,
    PlanStyleType,
    PlanTemplateKindType,
    type PlanTemplateKindLiteral,
    PlanElementRefType,
    PlanRowsCollectionType,
    PlanRowsType,
    PlanTemplateType,
} from "./types.js";
import { PlanReviewType } from "./ir.js";
import { resolveTag, resolveIcon, type PlanIconInput } from "./builders.js";
import { applySeries, type PlanSeriesInput } from "./series.js";
import { resolveRowSource, buildRowSource, type PagedSourceLike } from "../../contracts/source.js";

// ============================================================================
// Templates
// ============================================================================

/**
 * Flat input for {@link Plan.template} — one row-library card.
 *
 * @property key - Template identity (drag refs)
 * @property label - The card name (`"Chart"`)
 * @property sublabel - The muted role line (`"utilisation %"`)
 * @property kind - The row kind (drives the default card icon)
 * @property icon - Optional card-icon override
 * @property make - The binding — builds the live row subtree from captured data / bind-handles
 */
export interface PlanTemplateInput {
    /** Template identity (drag refs). */
    key: SubtypeExprOrValue<StringType>;
    /** The card name (`"Chart"`). */
    label: SubtypeExprOrValue<StringType>;
    /** The muted role line (`"utilisation %"`). */
    sublabel?: SubtypeExprOrValue<StringType>;
    /** The row kind — drives the default FA card icon. */
    kind: PlanTemplateKindLiteral | SubtypeExprOrValue<PlanTemplateKindType>;
    /** Optional card-icon override. */
    icon?: PlanIconInput;
    /** The binding — an `East.function([], Plan.Types.Rows)` building the live
     *  keyed subtree from captured data / bind-handles. */
    make: SubtypeExprOrValue<FunctionType<[], PlanRowsCollectionType>>;
}

/**
 * Builds one row-library template. Templates carry their binding — `make`
 * builds the finished subtree from captured data and bind-handles, so a
 * dropped row is live immediately and the host's `onDrag` add-handler is one
 * generic line (find the template, `make()`, insert).
 *
 * @param input - The template configuration ({@link PlanTemplateInput})
 * @returns An East expression of {@link PlanTemplateType}
 */
export function createTemplate(input: PlanTemplateInput): ExprType<PlanTemplateType> {
    return East.value({
        key:      input.key,
        label:    input.label,
        sublabel: input.sublabel !== undefined ? some(input.sublabel) : none,
        kind:     resolveTag(input.kind, PlanTemplateKindType),
        icon:     input.icon !== undefined ? some(resolveIcon(input.icon)) : none,
        // Pin the exact East type (the Schematic `itemHover` / Table
        // `expandedContent` pattern) — the widened input form erases
        // `UIComponentType`'s nominal identity, which the `component.ts`
        // arm's recursion-marker slots unify against.
        make:     East.value(input.make, FunctionType([], PlanRowsCollectionType)),
    }, PlanTemplateType);
}

// ============================================================================
// Root
// ============================================================================

/** The default slice affordance list (§1 toolbar). */
const DEFAULT_PLAN_AFFORDANCES: SliceAffordanceLiteral[] =
    ["cohort", "filter", "search", "range", "resolution", "brush", "summary"];

/**
 * The Plan review config — the shared {@link ReviewConfig} at the keyed-row
 * subject (`{ key }`).
 */
export type PlanReviewConfig = ReviewConfig<PlanRowRefType>;

/**
 * Configuration for {@link Plan.Root} (the `<Plan>` tag's props).
 *
 * @property axis - The shared time-axis declaration (`Plan.axis`)
 * @property rows - The canvas rows — kind-factory results (flattened subtrees); exclusive with `data`/`series`
 * @property data - The raw data source (a `Dict<String, R>` value/expression, or a paged source of one); pairs with `series`
 * @property series - The row series over `data` — `Plan.series.*` values (declared order resolves key collisions; rows sit in KEY order)
 * @property grain - Initial grain (`"group"` / `"resource"`; default resource)
 * @property library - Row-library templates (`Plan.template` values)
 * @property popover - Generalized click-popover resolver over the element ref (`none` result ⇒ no surface)
 * @property hover - Generalized hovercard resolver over the element ref (`none` result ⇒ no surface)
 * @property expandRender - The R2 developer render for rows declaring `expand` (called with the row ref)
 * @property expandGutter - The R2 gutter render — fills the expanded row's grown gutter cell (called with the row ref)
 * @property review - The shared review chrome (decision column + batch foot)
 * @property slice - Bound slice chrome (toolbar affordances)
 * @property footer - Status-footer items
 * @property id - DnD target identity
 * @property sources - Library ids accepted for `add` drags
 * @property onDrag - The shared drag funnel (every drag kind)
 * @property canDrop - IR-level drop veto (the ⊘ stage)
 * @property onSelect - Row click (selection)
 * @property onRunClick - Span bar click
 * @property onEventClick - Bucket tile click
 * @property onMarkClick - Event mark / decision diamond click
 * @property onChipClick - Cards chip click
 * @property onCellClick - Heat / table / weight / segment cell click
 * @property onGroupToggle - Group strip ↔ rows toggle
 * @property onGrainChange - Grain segment change
 * @property style - Sizing, density and gutter width
 */
export interface PlanConfig {
    /** The shared time-axis declaration (`Plan.axis`). */
    axis: SubtypeExprOrValue<PlanAxisType>;
    /** The raw data source — a KEYED collection: a `Dict<String, R>` value or
     *  expression (a `$.let`-bound map, `Data.bind(...).read()`) for the INLINE
     *  arm, or a `$.let`-bound paged handle over one (`Data.bindPaged(ops)`)
     *  for the PAGED arm; the East type is the discriminant.
     *
     *  The keys are load-bearing: a leaf row's key IS its data key, so the
     *  canvas is ordered and addressed by the same keys the source is
     *  (`datasetGetPage` windows and `datasetFindKey` searches that key order).
     *  A positional collection is refused — key it at the call site with
     *  `rows.toDict((_$, r) => r.id)`, which makes the choice explicit.
     *
     *  A PAGED canvas must also declare `axis.window` (or bind a slice range):
     *  fitting the axis to whatever prefix has landed would re-fit it on every
     *  window (#567 D8). */
    data: SubtypeExprOrValue<DictType<StringType, StructType>> | PagedSourceLike;
    /** The row series over `data` — `Plan.series.*` values, applied in DECLARED
     *  order (a TS array or an East expression of
     *  `ArrayType(Plan.Types.Series(R))`).
     *
     *  Declared order resolves KEY COLLISIONS only (last wins). It does NOT
     *  set row order on screen: the canvas is one keyed collection
     *  (`PlanRowsCollectionType` is a `Dict`, decoded as a `SortedMap`), so
     *  rows sit in canonical KEY order however the series are listed. Order
     *  rows by keying them for it — a `prefix` per series, or ordered data
     *  keys (`"10-line1"`, `"20-line2"`).
     *
     *  Literal one-off chrome rides a `Plan.series.rows` entry. */
    series: PlanSeriesInput;
    /** The link graph (R1) — run-edge quantity links (`Plan.link` values, map-derivable
     *  from data); the links-focus control gathers a row's transitive family over it. */
    links?: SubtypeExprOrValue<ArrayType<PlanLinkType>>;
    /** Initial grain (default `"resource"`). */
    grain?: PlanGrainLiteral | SubtypeExprOrValue<PlanGrainType>;
    /** Row-library templates (`Plan.template` values); non-empty enables the composition affordance. */
    library?: SubtypeExprOrValue<PlanTemplateType>[];
    /** Generalized click-popover resolver — called with the clicked element's
     *  ref (`run` / `event` / `chip` / `mark` / `cell` arm, each carrying the
     *  row key); returning `none` opens no surface. */
    popover?: SubtypeExprOrValue<FunctionType<[PlanElementRefType], OptionType<UIComponentType>>>;
    /** Generalized hovercard resolver — the hover twin of `popover`. */
    hover?: SubtypeExprOrValue<FunctionType<[PlanElementRefType], OptionType<UIComponentType>>>;
    /** The R2 developer render — called with the row ref when a row declaring
     *  `expand` focuses; builds the mounted body from captured data /
     *  bind-handles. */
    expandRender?: SubtypeExprOrValue<FunctionType<[PlanRowRefType], UIComponentType>>;
    /** The R2 GUTTER render — an expanded row's gutter cell grows with the row
     *  (one tall cell, top-aligned under the row's name), and this fills the
     *  space that opens up: the identity, measures or controls that only earn
     *  their place once the row has the canvas. Called with the same row ref
     *  as `expandRender`. */
    expandGutter?: SubtypeExprOrValue<FunctionType<[PlanRowRefType], UIComponentType>>;
    /** The shared review chrome (decision column + batch foot); callbacks receive `{ key }`. */
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
    /** The shared drag funnel — runs, chips, tiles, templates and reorders all report through it. */
    onDrag?: SubtypeExprOrValue<FunctionType<[DragEventType], NullType>>;
    /** IR-level drop veto — `false` ⇒ the ⊘ invalid stage; a throwing predicate fails open. */
    canDrop?: SubtypeExprOrValue<FunctionType<[DragEventType], BooleanType>>;
    /** Row click (selection). */
    onSelect?: SubtypeExprOrValue<FunctionType<[PlanRowRefType], NullType>>;
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
    /** Group strip ↔ rows toggle (fires after the in-place swap). */
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

/**
 * Creates the Plan root — the whole canvas.
 *
 * @param config - The Plan configuration ({@link PlanConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @remarks
 * Window and resolution have no callbacks by design: they are slice writes
 * (`setRange` / `setResolution`) — hosts observe the slice. Dragging a
 * proposal is a Modify on its decision, not a free edit — host semantics
 * behind `onDrag`; the surface only reports.
 */
export function createPlanRoot(config: PlanConfig): ExprType<UIComponentType> {
    // A canvas is DEFINED as data + series (+ the root resolvers) — there
    // is no rows-authoring channel; the IR's inline arm is what inline
    // application collapses to.
    if (config.data === undefined || config.series === undefined) {
        throw new Error("Plan: `data` and `series` are required — a canvas is its data plus the series over it");
    }
    // The shared row-source resolution (#567): inline collection, paged
    // source, or a whole-value bind handle — one dispatch, one vocabulary,
    // and the series pipeline is the `make` that turns each window's domain
    // rows into canvas rows (the single R-erasure point).
    const resolved = resolveRowSource(config.data, "Plan");
    // The canvas is KEYED, so its source must be: a leaf row's key is its data
    // key, which is what keeps the canvas addressable by the keys the source is
    // searched and windowed by (#568). Refuse anything else here rather than
    // inventing keys the source does not have.
    const keyType = (resolved.keyType as { type?: string } | undefined)?.type;
    if (keyType !== "String") {
        const got = (resolved.collectionType as { type: string }).type;
        const keyed = keyType !== undefined ? ` keyed by ${keyType}` : "";
        throw new Error(
            "Plan: `data` must be a keyed collection (`Dict<String, R>`) — its keys become the " +
            "canvas row keys, so the canvas is ordered and addressed the same way the source is " +
            "(the row space a paged source windows and seeks). " +
            `Got a ${got}${keyed}; key it at the call site, e.g. ` +
            "`data={rows.toDict((_$, r) => r.id)}`.",
        );
    }
    const rowsValue = buildRowSource(
        resolved,
        PlanRowsCollectionType,
        (source) => applySeries(config.series, source as ExprType<DictType<StringType, StructType>>),
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
        axis:     config.axis,
        grain:    config.grain !== undefined ? some(resolveTag(config.grain, PlanGrainType)) : none,
        library:  East.value(config.library ?? [], ArrayType(PlanTemplateType)),
        // East.value pins the exact function type (the Schematic `itemHover`
        // pattern) so the arm's recursion-marker slots unify.
        popover: config.popover !== undefined
            ? some(East.value(config.popover, FunctionType([PlanElementRefType], OptionType(UIComponentType))))
            : none,
        hover: config.hover !== undefined
            ? some(East.value(config.hover, FunctionType([PlanElementRefType], OptionType(UIComponentType))))
            : none,
        expandRender: config.expandRender !== undefined
            ? some(East.value(config.expandRender, FunctionType([PlanRowRefType], UIComponentType)))
            : none,
        expandGutter: config.expandGutter !== undefined
            ? some(East.value(config.expandGutter, FunctionType([PlanRowRefType], UIComponentType)))
            : none,
        review:   config.review !== undefined ? some(buildReview(config.review, PlanReviewType)) : none,
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
