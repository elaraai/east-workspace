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
    AsyncFunctionType,
    BlobType,
    BooleanType,
    DictType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    isTypeEqual,
    toEastTypeValue,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";
import { DensityType, type DensityLiteral } from "../../style/interaction.js";
import { DragEventType } from "../../contracts/drag.js";
import {
    EditingApplyResultType,
    EditingChangeSetTypeFor,
    EditingDraftFieldType,
    EditingPatchEventTypeWith,
    EditingReadinessType,
    EditingWireApplyType,
    buildKeyedInlineApply,
} from "../../contracts/editing.js";
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import {
    PlanAxisType,
    PlanGrainType,
    type PlanGrainLiteral,
    PlanLinkType,
    PlanRowIdType,
    PlanGroupToggleEventType,
    PlanFooterItemType,
    PlanStyleType,
    PlanElementRefType,
    PlanBlocksType,
    PlanRowsType,
    PlanUiBindType,
    PlanEditingType,
    PlanReadyEntryType,
    PlanWriteRequestType,
    PLAN_PAGE_SIZE,
    type PlanAxisKindLiteral,
    type PlanAxisInput,
} from "./types.js";
import { PlanReviewType } from "./ir.js";
import { resolveTag, WINDOWLESS_AXES } from "./builders.js";
import { applySeries, checkSeries, seriesWriteFn, PlanSeriesType, type PlanSeriesInput } from "./series.js";
import { pickActive, PickBindType, type PickHandle } from "../../contracts/pick.js";
import {
    resolveRowSource, buildRowSource, buildPagedWindow,
    type PagedSourceLike, type ResolvedRowSource,
} from "../../contracts/source.js";


// ============================================================================
// Root
// ============================================================================

/** The default slice affordance list (§1 toolbar). */
const DEFAULT_PLAN_AFFORDANCES: SliceAffordanceLiteral[] =
    ["cohort", "filter", "search", "range", "resolution", "brush", "summary"];

/**
 * The Plan's review chrome (#880) — the decision column and the batch foot.
 *
 * @remarks
 * A verdict is a gesture of the editing session, not a callback: the series
 * whose rows are reviewed names the entry field a verdict writes
 * (`review: { verdict: "approval" }`), Approve / Reject on a row and Approve
 * all / Reject all at the foot draft its entries, and Apply sends them as one
 * checked batch (`editing`). Rerun changes no data, so it stays a callback.
 *
 * @property columnLabel - The decision column's header (default `"Decision"`)
 * @property summary - The foot's eyebrow — a host-composed component
 * @property onRerun - Rerun (absent ⇒ no Rerun button)
 * @property rerunLabel - The Rerun button's label (default `"Rerun"`)
 */
export interface PlanReviewConfig {
    /** The decision column's header (default `"Decision"`). */
    columnLabel?: SubtypeExprOrValue<StringType> | string;
    /** The foot's eyebrow — a host-composed component. */
    summary?: SubtypeExprOrValue<UIComponentType>;
    /** Rerun (absent ⇒ no Rerun button) — it changes no data, so it stays a callback. */
    onRerun?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** The Rerun button's label (default `"Rerun"`). */
    rerunLabel?: SubtypeExprOrValue<StringType> | string;
}

/**
 * The Plan's editing session (#880) — the Sheet's, over the canvas's entries:
 * every verdict and every dropped card is a DRAFT of the entry it was made on,
 * each gesture one undoable transaction, and Apply one checked, idempotent
 * batch against the base the drafts began from.
 *
 * @remarks
 * The entries are `data`'s top-level entries: a gesture on a row at any depth
 * drafts the entry its row came from (the whole subtree rides in it), and the
 * canvas draws a draft by deriving the entry's rows again — exactly what
 * Apply leaves. The callbacks are East functions over the canvas's own entry
 * type `R` and key type `K`:
 *
 * - `onApply(Editing.Types.ChangeSet(R, K)) → Editing.Types.ApplyResult`
 *   commits a batch — sync or async. Its base is the inline `Dict`'s snapshot,
 *   or a paged source's revision; a batch against a source that moved is
 *   refused, never rebased.
 * - `onUpdate(Dict<K, R>)` is the inline adapter instead: with
 *   `data={liveHandle}` it applies each batch with `Editing.apply` over the
 *   handle's latest `Dict` and writes the whole result — idempotent across
 *   retries. Exclusive with `onApply`.
 * - `onPatch(Plan.Types.PatchEvent(R))` observes every gesture.
 * - `ready(R, K) → Editing.Types.Readiness` is the author's check over one
 *   drafted entry; a refusal blocks Apply and names the entry.
 *
 * @property onApply - Commit one checked batch (sync or async)
 * @property onUpdate - The inline adapter's writer — the whole collection with the batch applied (requires `data={liveHandle}`)
 * @property onPatch - Observe every gesture
 * @property mode - `"batch"` (Apply sends) or `"auto"` (each ready gesture goes at once)
 * @property ready - The author's readiness check over a drafted entry
 */
export interface PlanEditingConfig {
    /** Commit one checked batch — `Fn(Editing.Types.ChangeSet(R, K)) → Editing.Types.ApplyResult`, sync or async. */
    onApply?: ExprType<EastType>;
    /** The inline adapter's writer — `Fn(Dict<K, R>) → Null`; requires `data={liveHandle}`, exclusive with `onApply`. */
    onUpdate?: ExprType<EastType>;
    /** Observe every gesture — `Fn(Plan.Types.PatchEvent(R)) → Null`. */
    onPatch?: ExprType<EastType>;
    /** When a ready batch goes: on Apply (`"batch"`, the default), or at once (`"auto"`). */
    mode?: "batch" | "auto";
    /** The author's check over one drafted entry — `Fn(R, K) → Editing.Types.Readiness`. */
    ready?: ExprType<EastType>;
}

/**
 * A whole-value bind handle (`State.bind` / `Data.bind`) over a keyed
 * collection — accepted as `data`. The canvas reads it as the inline arm, and
 * `editing.onUpdate` writes each applied batch back through it (#880).
 */
export interface PlanBindHandle {
    /** The handle's read. */
    read: (...args: never[]) => Expr<DictType<EastType, EastType>>;
}

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
 * @property data - The source — a `Dict<K, R>` value/expression, a bind handle over one, or a paged source of one; pairs with `series` or `pick`
 * @property series - The row series over `data` — `Plan.series.*` values; the list IS the layout; exclusive with `pick`
 * @property pick - A bound series library (`Plan.pick`) — the canvas shows the picked series and mounts the library panel; exclusive with `series`
 * @property links - The link graph (R1) — run-edge quantity links (`Plan.link` values)
 * @property grain - Initial grain (`"group"` / `"resource"`; default resource)
 * @property popover - Generalized click-popover resolver over the element ref (`none` result ⇒ no surface)
 * @property hover - Generalized hovercard resolver over the element ref (`none` result ⇒ no surface)
 * @property expandRender - The R2 developer render for rows declaring `expand` (called with the row's id)
 * @property expandGutter - The R2 gutter render — fills the expanded row's grown gutter cell (called with the row's id)
 * @property review - The review chrome (decision column + batch foot); a verdict is a gesture of `editing`
 * @property editing - The editing session (#880) — every verdict and dropped card a draft, applied as one checked batch
 * @property slice - Bound slice chrome (toolbar affordances)
 * @property footer - Status-footer items
 * @property id - DnD target identity (omit ⇒ the canvas is no drop target)
 * @property sources - Library ids accepted for `add` drags
 * @property canDrop - IR-level drop veto (the ⊘ stage) — consulted before a drop becomes a draft
 * @property onSelect - Row click (selection)
 * @property onElementClick - A click on any element — run, tile, mark, chip, cell or link ribbon — by its ref (#824)
 * @property onGroupToggle - A row with children expanded or collapsed
 * @property onGrainChange - Grain segment change
 * @property ui - A bound interaction state (`State.bind` at `Plan.Types.UiState`, #824)
 * @property style - Sizing, density and gutter width
 */
export interface PlanConfig<K extends PlanAxisKindLiteral = PlanAxisKindLiteral> {
    /** The shared axis declaration (`Plan.axis` / `.time` / `.number` / `.ordinal`) — fixes the canvas kind `K`.
     *  A time or number axis states its `window`, or the canvas binds a `slice` whose range supplies it —
     *  there is no fit to the data (#822), inline or paged. */
    axis: PlanAxisInput<K>;
    /** The source — a KEYED collection: a `Dict<K, R>` value or expression (a
     *  `$.let`-bound map, `Data.bind(...).read()`) or a whole-value bind handle
     *  over one (`data={handle}` — what `editing.onUpdate` writes back
     *  through) for the INLINE arm, or a `$.let`-bound paged handle over one
     *  (`Data.bindPaged(ops)`) for the PAGED arm; the East type is the
     *  discriminant. Any key type: a row's path
     *  starts with its entry's key (the String itself, any other key as its
     *  `.east` text), so the canvas is addressed by the keys the source is
     *  searched and windowed by. Entries may be any East type — a struct, a
     *  recursive node, or a collection (`groupToDicts`' groups).
     *
     *  A positional collection is refused — key it at the call site with
     *  `rows.toDict((_$, r) => r.id)`, which makes the choice explicit. */
    data: SubtypeExprOrValue<DictType<EastType, EastType>> | PlanBindHandle | PagedSourceLike;
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
     *  row's id, or a ribbon's `link` arm); returning `none` opens no surface. */
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
    /** The review chrome (decision column + batch foot, #880). A verdict is a gesture of `editing`, written into
     *  the field the reviewed series names (`review: { verdict }` on the series). */
    review?: PlanReviewConfig;
    /** The editing session (#880) — see {@link PlanEditingConfig}. Without it the canvas takes no gesture: the
     *  decision buttons are disabled and no card lands. */
    editing?: PlanEditingConfig;
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
    /** DnD target identity — names the Plan in drag-grammar cell refs. Omit ⇒ the canvas is no drop target.
     *  A card lands only on a row whose series declares `edit` (where it lands and how it becomes an item),
     *  as a draft of the root's `editing` session (#880). */
    id?: string;
    /** Library ids accepted for `add` drags (omit = no adds). */
    sources?: string[];
    /** IR-level drop veto — consulted with the candidate `add` (its `CellRef.row` the row id's canonical
     *  text) before a drop becomes a draft; `false` ⇒ the ⊘ invalid stage; a throwing predicate fails open. */
    canDrop?: SubtypeExprOrValue<FunctionType<[DragEventType], BooleanType>>;
    /** Row click (selection) — the row's id. */
    onSelect?: SubtypeExprOrValue<FunctionType<[PlanRowIdType], NullType>>;
    /** A click on any element, by its ref (#824) — `run` (`{ row, run }`), `event` (`{ row, event }`),
     *  `mark` (an event mark or a decision diamond, `{ row, mark }`), `chip` (`{ row, chip }`), `cell`
     *  (`{ row, at }` — the bucket's instant, not an index) or a link ribbon's `link` (`{ key, from, to }`).
     *  One function over one variant, as the `popover` / `hover` resolvers are: `ref.match({ … })`. */
    onElementClick?: SubtypeExprOrValue<FunctionType<[PlanElementRefType], NullType>>;
    /** A row with children expanded or collapsed (fires after the in-place swap). */
    onGroupToggle?: SubtypeExprOrValue<FunctionType<[PlanGroupToggleEventType], NullType>>;
    /** Grain segment change (grain is Plan-local state; initial via `grain`). */
    onGrainChange?: SubtypeExprOrValue<FunctionType<[PlanGrainType], NullType>>;
    /**
     * The canvas's interaction state, held by the host (#824) — a
     * `State.bind([Plan.Types.UiState], key, Plan.uiState())` handle.
     *
     * @remarks
     * Bound, the canvas reads it and writes the user's actions back: the
     * selection, the rows folded or opened against what they declare, the
     * charts expanded. Write it from outside to select a row, fold or open one,
     * expand a chart, or — through `focus` — bring a row into view (a deep
     * link, a list beside the canvas); the canvas spends a `focus` request
     * once it has. Unbound, the canvas keeps the state itself and persists the
     * user's folds and charts under its storage key (#813).
     *
     * A write re-renders whatever reads the state, like any `State.bind`: read
     * it in the `Reactive` that renders the canvas only for what depends on it.
     */
    ui?: SubtypeExprOrValue<PlanUiBindType>;
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
 * (`setRange` / `setResolution`) — hosts observe the slice. A change to the
 * data — a verdict, a dropped card — is a draft of the `editing` session,
 * applied as one checked batch (#880).
 */
export function createPlanRoot<K extends PlanAxisKindLiteral = PlanAxisKindLiteral>(config: PlanConfig<K>): ExprType<UIComponentType> {
    // A canvas is DEFINED as data + series (+ the root resolvers) — there
    // is no rows-authoring channel; the IR's inline arm is what inline
    // application collapses to.
    if (config.data === undefined) {
        throw new Error("Plan: `data` is required — a canvas is its data plus the series over it");
    }
    // The removed callbacks, named (#880) — a plain JS caller would otherwise
    // lose them silently.
    if ("onDrag" in (config as object)) {
        throw new Error(
            "Plan: `onDrag` is removed (#880) — a card dropped on a row is a draft of the `editing` session: declare " +
            "`edit: { items, create }` on the series it lands on, and commit with `editing.onApply` (or `onUpdate`)");
    }
    const removedVerbs = ["onApprove", "onReject", "onApproveAll", "onRejectAll"]
        .filter((k) => config.review !== undefined && k in (config.review as object));
    if (removedVerbs.length > 0) {
        throw new Error(
            `Plan: review.${removedVerbs.join(" / review.")} ${removedVerbs.length > 1 ? "are" : "is"} removed (#880) — a verdict is a ` +
            "draft of the `editing` session: name the field it writes on the reviewed series (`review: { verdict: \"approval\" }`), " +
            "and commit with `editing.onApply` (or `onUpdate`)");
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
        review:   config.review !== undefined ? some(East.value({
            columnLabel: config.review.columnLabel ?? "Decision",
            summary:     config.review.summary !== undefined ? some(config.review.summary) : none,
            onRerun:     config.review.onRerun !== undefined ? some(config.review.onRerun) : none,
            rerunLabel:  config.review.rerunLabel ?? "Rerun",
        }, PlanReviewType)) : none,
        editing:  config.editing !== undefined ? some(buildPlanEditing(resolved, seriesInput, config.editing)) : none,
        // The library rides as chrome, like the slice rail: the non-generic
        // contract only, since the arm must stay a closed East type.
        pick:     config.pick !== undefined
            ? some(East.value((config.pick as unknown as ExprType<StructType<{ pick: PickBindType }>>).pick, PickBindType))
            : none,
        slice:    sliceChrome,
        footer:   (config.footer ?? []).map(f => East.value({
            text: f.text,
            tone: f.tone !== undefined ? some(resolveTag(f.tone, StatusValueType)) : none,
            end:  f.end ?? false,
        }, PlanFooterItemType)),
        id:       config.id !== undefined ? some(config.id) : none,
        sources:  East.value(config.sources ?? [], ArrayType(StringType)),
        canDrop:  config.canDrop !== undefined ? some(config.canDrop) : none,
        onSelect: config.onSelect !== undefined ? some(config.onSelect) : none,
        onElementClick: config.onElementClick !== undefined
            ? some(East.value(config.onElementClick, FunctionType([PlanElementRefType], NullType)))
            : none,
        onGroupToggle: config.onGroupToggle !== undefined ? some(config.onGroupToggle) : none,
        onGrainChange: config.onGrainChange !== undefined ? some(config.onGrainChange) : none,
        ui:       config.ui !== undefined ? some(East.value(config.ui, PlanUiBindType)) : none,
        style:    styleValue,
    }), UIComponentType);
}

// ============================================================================
// Editing (#880) — the canvas's side of the shared session
// ============================================================================

/**
 * An author callback, held to its exact East signature: a function of
 * `inputs` returning `output` — sync, or async where allowed.
 *
 * @param value - The author's function
 * @param inputs - Its parameter types
 * @param output - Its result type
 * @param name - The `editing` field, for the message
 * @param allowAsync - Whether an async function is accepted
 * @param expected - The signature in words, for the message
 * @returns The function
 * @throws {Error} Naming the field and the signature it must have
 */
function checkedCallback(
    value: ExprType<EastType>,
    inputs: readonly EastType[],
    output: EastType,
    name: string,
    allowAsync: boolean,
    expected: string,
): ExprType<EastType> {
    const fn = East.value(value as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(fn as unknown as Expr) as { type: string; inputs?: EastType[]; output?: EastType };
    const callable = type.type === "Function" || (allowAsync && type.type === "AsyncFunction");
    const matches = callable && type.inputs !== undefined && type.inputs.length === inputs.length
        && type.inputs.every((t, i) => isTypeEqual(t, inputs[i]!))
        && type.output !== undefined && isTypeEqual(type.output, output);
    if (!matches) {
        throw new Error(`Plan: editing.${name} must be an East ${allowAsync ? "sync or async " : ""}function ${expected}`);
    }
    return fn;
}

/**
 * The canvas's editing declaration (#880) — the shared session's fields over
 * the source's top-level entries, and the canvas's own: its blocks with the
 * drafted entries in place, one entry's blocks, the gestures written into
 * entries, a window's entry ids and the author's readiness check.
 *
 * @remarks
 * Everything crosses as bytes at the exact entry type the wire names, so the
 * arm stays closed. The entries are read where the canvas reads them — the
 * inline `Dict`, or the very windows the canvas pages (`buildPagedWindow`), so
 * an entry read back for a gesture is a window the canvas already holds.
 *
 * @param resolved - The resolved `data` — a keyed collection, inline or paged
 * @param series - The series input the canvas applies
 * @param input - The author's editing declaration
 * @returns The editing declaration, on the wire
 * @throws {Error} When the declaration is inconsistent, or a callback has another signature
 */
function buildPlanEditing(resolved: ResolvedRowSource, series: PlanSeriesInput, input: PlanEditingConfig): ExprType<PlanEditingType> {
    const sourceType = resolved.collectionType as DictType<EastType, EastType>;
    const entryType = sourceType.value;
    const keyType = sourceType.key;
    const draftType = EditingDraftFieldType(entryType);
    const batchType = EditingChangeSetTypeFor(entryType, keyType);
    const eventType = EditingPatchEventTypeWith(entryType, draftType);
    const DraftsType = DictType(StringType, BlobType);
    if (input.onApply !== undefined && input.onUpdate !== undefined) {
        throw new Error("Plan: editing takes onApply or the inline onUpdate adapter, not both");
    }
    if (input.onUpdate !== undefined && (resolved.kind !== "inline" || resolved.live === undefined)) {
        throw new Error(
            "Plan: editing.onUpdate requires data={liveHandle}, so each batch reads the latest entries — pass the bound " +
            "handle itself, or commit with onApply");
    }
    if (input.mode === "auto" && input.onApply === undefined && input.onUpdate === undefined) {
        throw new Error("Plan: editing.mode \"auto\" applies each ready gesture at once — it needs onApply or onUpdate to apply it with");
    }
    if (resolved.kind === "paged" && input.onApply !== undefined) {
        const fields = (Expr.type(resolved.source as unknown as Expr) as StructType).fields;
        if (fields["revision"] === undefined || fields["refresh"] === undefined) {
            throw new Error(
                "Plan: editing a paged source needs its revision and refresh — a batch is checked against the revision it " +
                "began at, and the drafts retire once the source reads back at the revision it committed");
        }
    }

    // An entry's id is its key's text — the first segment of its rows' paths:
    // a String key as it is, any other key its `.east` text.
    const keyOf = ((keyType as { type: string }).type === "String"
        ? East.function([StringType], StringType, (_$, id) => id)
        : East.function([StringType], keyType, (_$, id) => id.parse(keyType))) as unknown as ExprType<FunctionType<[StringType], EastType>>;
    const idOf = ((keyType as { type: string }).type === "String"
        ? East.function([StringType], StringType, (_$, key) => key)
        : East.function([keyType], StringType, (_$, key) => East.print(key))) as unknown as ExprType<FunctionType<[EastType], StringType>>;

    // Where the entries are read: the inline Dict, or the canvas's own windows.
    const inline = resolved.kind === "inline" ? resolved.rows as unknown as ExprType<DictType<EastType, EastType>> : undefined;
    const window = resolved.kind === "paged"
        ? buildPagedWindow(resolved) as unknown as ExprType<FunctionType<[IntegerType, IntegerType], OptionType<DictType<EastType, EastType>>>>
        : undefined;
    const pageSize = BigInt(PLAN_PAGE_SIZE);

    // One entry, read back: inline by key; paged from the window it came from
    // (aligned to the canvas's page), the very request the canvas made.
    const readEntry = East.function([StringType, IntegerType], OptionType(BlobType), ($, id, offset) => {
        const parse = $.const(keyOf);
        const key = $.let(parse(id));
        const result = $.let(none, OptionType(BlobType));
        if (inline !== undefined) {
            const all = $.const(inline);
            $.match(all.tryGet(key), {
                some: ($2, entry) => { $2.assign(result, some(East.Blob.encodeBeast(entry, "v2"))); },
            });
        } else {
            const read = $.const(window!);
            const start = $.let(offset.subtract(offset.remainder(pageSize)));
            const piece = $.let(read(start, pageSize));
            $.match(piece, {
                some: ($2, entries) => {
                    $2.match(entries.tryGet(key), {
                        some: ($3, entry) => { $3.assign(result, some(East.Blob.encodeBeast(entry, "v2"))); },
                    });
                },
            });
        }
        return result;
    });

    // The entries with the drafted ones in their place — a new collection, the
    // source's untouched — and the series applied to it: a draft draws exactly
    // as the applied batch will.
    const withDrafts = East.function([sourceType, DraftsType], sourceType, ($, entries, drafts) => {
        const idText = $.const(idOf);
        return entries.map(($2, value, key) => {
            const id = $2.let(idText(key));
            return drafts.has(id).ifElse(() => drafts.get(id).decodeBeast(entryType, "v2"), () => value);
        });
    });
    const derive = East.function([IntegerType, IntegerType, DraftsType], OptionType(PlanBlocksType), ($, offset, limit, drafts) => {
        const draft = $.const(withDrafts);
        const result = $.let(none, OptionType(PlanBlocksType));
        if (inline !== undefined) {
            const all = $.const(inline);
            const drafted = $.let(draft(all, drafts));
            $.assign(result, some(applySeries(series, drafted)));
        } else {
            const read = $.const(window!);
            const piece = $.let(read(offset, limit));
            $.match(piece, {
                some: ($2, entries) => {
                    const drafted = $2.let(draft(entries, drafts));
                    $2.assign(result, some(applySeries(series, drafted)));
                },
            });
        }
        return result;
    });

    // One entry's blocks — what a draft is compared by, row by row.
    const deriveEntry = East.function([StringType, BlobType], PlanBlocksType, ($, id, bytes) => {
        const parse = $.const(keyOf);
        const one = $.let(new Map(), sourceType);
        $(one.insert(parse(id), bytes.decodeBeast(entryType, "v2")));
        return applySeries(series, one);
    });

    // Gestures written into their entries, through the series that made each
    // row; `none` for an entry no series took the gesture on.
    const writeOne = seriesWriteFn(series, sourceType);
    const write = East.function([ArrayType(PlanWriteRequestType)], ArrayType(OptionType(BlobType)), ($, requests) => {
        const writeRow = $.const(writeOne);
        const parse = $.const(keyOf);
        return requests.map(($2, request) => {
            const key = $2.let(parse(request.id));
            const entry = $2.let(request.entry.decodeBeast(entryType, "v2"), entryType);
            const out = $2.let(none, OptionType(BlobType));
            $2.for(request.rows, ($3, row) => {
                const next = $3.let(writeRow(entry, key, row, request.gesture));
                $3.match(next, { some: ($4, value) => { $4.assign(entry, value); } });
                $3.if(next.hasTag("some"), ($4) => { $4.assign(out, some(East.Blob.encodeBeast(entry, "v2"))); });
            });
            return out;
        });
    });

    // A window's entry ids, in the source's order.
    const entryIds = East.function([IntegerType, IntegerType], OptionType(ArrayType(StringType)), ($, offset, limit) => {
        const idText = $.const(idOf);
        const result = $.let(none, OptionType(ArrayType(StringType)));
        if (inline !== undefined) {
            const all = $.const(inline);
            const ids = $.let(all.toArray(($2, _value, key) => idText(key)));
            const n = $.let(ids.size());
            const start = $.let(offset.less(n).ifElse(() => offset, () => n));
            const end = $.let(offset.add(limit).less(n).ifElse(() => offset.add(limit), () => n));
            $.assign(result, some(ids.slice(start, end)));
        } else {
            const read = $.const(window!);
            const piece = $.let(read(offset, limit));
            $.match(piece, {
                some: ($2, entries) => { $2.assign(result, some(entries.toArray(($3, _value, key) => idText(key)))); },
            });
        }
        return result;
    });

    // The author's readiness check, one result per drafted entry, in order. A
    // check that throws refuses its own entry alone.
    const authorReady = input.ready === undefined ? undefined : checkedCallback(input.ready, [entryType, keyType], EditingReadinessType,
        "ready", false, "over this canvas's entry and key (R, K), returning Editing.Types.Readiness");
    const ready = authorReady === undefined ? undefined : East.function([ArrayType(PlanReadyEntryType)], ArrayType(EditingReadinessType), ($, batch) => {
        const check = $.const(authorReady as unknown as ExprType<FunctionType<[EastType, EastType], typeof EditingReadinessType>>);
        const parse = $.const(keyOf);
        return batch.map(($2, item) => {
            const result = $2.let(variant("ready", null), EditingReadinessType);
            $2.try(($3) => {
                $3.assign(result, check(item.entry.decodeBeast(entryType, "v2"), parse(item.id)));
            }).catch(($3, message) => {
                $3.assign(result, variant("invalid", [{ field: "", message: East.str`Readiness check failed: ${message}` }]));
            });
            return result;
        });
    });

    // The authoritative apply: the author's, or the inline adapter over the
    // live handle's latest Dict (#879's protocol, keyed).
    const live = resolved.kind === "inline" ? resolved.live : undefined;
    const reader = live !== undefined
        ? (live as unknown as ExprType<StructType<{ read: FunctionType<[], DictType<EastType, EastType>> }>>).read
        : undefined;
    const authorApply = input.onApply === undefined ? undefined : checkedCallback(input.onApply, [batchType], EditingApplyResultType,
        "onApply", true, "over Editing.Types.ChangeSet(R, K) — this canvas's entry and key types — returning Editing.Types.ApplyResult");
    const sourceFields = resolved.kind === "paged" ? (Expr.type(resolved.source as unknown as Expr) as StructType).fields : {};
    const sourceId: ExprType<StringType> = resolved.kind === "paged"
        ? (sourceFields["id"] !== undefined
            ? (resolved.source as unknown as ExprType<StructType<{ id: StringType }>>).id
            : East.value("", StringType))
        : reader !== undefined ? East.print(East.Blob.encodeBeast(reader, "v2"))
            : authorApply !== undefined ? East.print(East.Blob.encodeBeast(authorApply, "v2"))
                : East.value("readonly-inline", StringType);
    let onApply: ExprType<typeof EditingWireApplyType> | undefined;
    if (input.onUpdate !== undefined && reader !== undefined) {
        const writer = checkedCallback(input.onUpdate, [sourceType], NullType, "onUpdate", false,
            "over the whole Dict<K, R> the batch leaves, returning Null");
        onApply = East.value(variant("sync", buildKeyedInlineApply(sourceType, sourceId, reader as unknown as ExprType<FunctionType>,
            writer as unknown as ExprType<FunctionType>)), EditingWireApplyType);
    } else if (authorApply !== undefined) {
        const typedBatch = batchType as unknown as StructType<Record<never, never>>;
        if ((Expr.type(authorApply as unknown as Expr) as { type: string }).type === "AsyncFunction") {
            const fn = authorApply as unknown as ExprType<AsyncFunctionType<[typeof typedBatch], typeof EditingApplyResultType>>;
            onApply = East.value(variant("async", East.asyncFunction([BlobType], EditingApplyResultType, ($, blob) => {
                const apply = $.const(fn);
                return apply(blob.decodeBeast(typedBatch, "v2"));
            })), EditingWireApplyType);
        } else {
            const fn = authorApply as unknown as ExprType<FunctionType<[typeof typedBatch], typeof EditingApplyResultType>>;
            onApply = East.value(variant("sync", East.function([BlobType], EditingApplyResultType, ($, blob) => {
                const apply = $.const(fn);
                return apply(blob.decodeBeast(typedBatch, "v2"));
            })), EditingWireApplyType);
        }
    }
    const authorPatch = input.onPatch === undefined ? undefined : checkedCallback(input.onPatch, [eventType], NullType,
        "onPatch", false, "over Plan.Types.PatchEvent(R), returning Null");
    const onPatch = authorPatch === undefined ? undefined : East.function([BlobType], NullType, ($, blob) => {
        const observe = $.const(authorPatch as unknown as ExprType<FunctionType<[EastType], NullType>>);
        $(observe(blob.decodeBeast(eventType, "v2")));
    });

    return East.value({
        sourceId,
        entryType: toEastTypeValue(entryType),
        idField: none,
        draftType: toEastTypeValue(draftType),
        children: none,
        keyType: some(toEastTypeValue(keyType)),
        snapshot: inline !== undefined ? some(East.Blob.encodeBeast(inline, "v2")) : none,
        readEntry,
        onPatch: onPatch !== undefined ? some(onPatch) : none,
        onApply: onApply !== undefined ? some(onApply) : none,
        mode: variant(input.mode ?? "batch", null),
        derive,
        deriveEntry,
        write,
        entryIds,
        ready: ready !== undefined ? some(ready) : none,
    }, PlanEditingType);
}
