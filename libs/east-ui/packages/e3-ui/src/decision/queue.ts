/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `DecisionQueue` — *the* Decide surface (see `design/decide.html` §2.3).
 * One queue over the handle's unioned cases, sorted by urgency with the
 * routine tail collapsed. The case view is the row's expanded state, not a
 * sibling component: selecting a row opens one compact facet at a time
 * beneath it — `Evidence` (the model's argument + the host's per-decision
 * `evidence` canvas), `Options` (the ranked stack), `Judgement` (prompts ·
 * knowledge · lever builder, gating Apply), `Modify` (the host's per-kind
 * probe via the `modify` slot). Apply / Reject stay on the row and resolve
 * through the handle.
 *
 * An `EastUI.component` extension: the payload carries the handle's ref
 * (binding descriptors) plus the host's slots; the renderer registers
 * against {@link DecisionQueue.Component} in `@elaraai/e3-ui-components`.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    StructType,
    OptionType,
    VariantType,
    StringType,
    BooleanType,
    NullType,
    FunctionType,
    some,
    none,
    variant,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, DensityType, UIComponentType, type DensityLiteral } from "@elaraai/east-ui";
import { SliceAffordanceType, SliceBindType, reifyAccessor, type SliceAffordanceLiteral } from "@elaraai/east-ui/internal";

import { DecisionHandleRefType, type DecisionHandleLike } from "./bind.js";
import { DecisionType, DecisionUpdateType } from "./types.js";

export { DecisionUpdateType } from "./types.js";

// ============================================================================
// Payload — the fixed IR shape the renderer decodes.
// ============================================================================

/** The expanded row's facet. */
export const FacetType = VariantType({
    evidence: NullType,
    options: NullType,
    judgement: NullType,
    modify: NullType,
});
/** Type alias for {@link FacetType}. */
export type FacetType = typeof FacetType;
/** String-literal proxy for {@link FacetType}. */
export type FacetLiteral = "evidence" | "options" | "judgement" | "modify";

/**
 * The author-selectable *data* facets — `modify` is excluded because it is
 * gated purely by its callback prop. The `facets` include-list is typed over
 * this subset so listing a facet without its data is impossible.
 */
export const DataFacetType = VariantType({
    evidence: NullType,
    options: NullType,
    judgement: NullType,
});
/** Type alias for {@link DataFacetType}. */
export type DataFacetType = typeof DataFacetType;
/** String-literal proxy for {@link DataFacetType}. */
export type DataFacetLiteral = "evidence" | "options" | "judgement";

/**
 * One custom grouping offered in the Group-by toolbar: a toolbar label plus a
 * group-value accessor over the decision. The built-in `urgency` / `kind` /
 * `none` groupings are framework-provided and never declared here.
 *
 * @property label - Toolbar segment label + group-head identity.
 * @property value - Group-value accessor; the renderer runs it per decision to
 *   bucket rows into sections.
 */
export const DecisionGroupType = StructType({
    label: StringType,
    value: FunctionType([DecisionType], StringType),
});
/** Type alias for {@link DecisionGroupType}. */
export type DecisionGroupType = typeof DecisionGroupType;

/**
 * The `DecisionQueue` component payload.
 *
 * @property handle - The surface's decision handle ref (binding descriptors).
 * @property heading - Optional header label (e.g. `"Decisions waiting"`).
 * @property modify - Optional per-kind probe editor: `(decision, update) =>
 *   UIComponentType`; renders as the expanded row's Modify facet.
 *   `update(edited)` writes the decision back through its owning binding.
 * @property evidence - Optional per-decision Evidence-tab canvas: `(decision) =>
 *   UIComponentType`; renders inside the Evidence facet (the host's chart /
 *   working surface / trajectory).
 * @property defaultExpanded - The case shown expanded before any selection
 *   exists (a display-only default — clicking rows writes the real
 *   selection).
 * @property defaultFacet - The facet the expansion opens with (defaults to
 *   `evidence`).
 * @property facets - Optional include-list of data facets to show
 *   (`evidence` / `options` / `judgement`); absent ⇒ all. `modify` is always
 *   callback-gated and composes with this list.
 * @property onApply - Optional side-effect hook fired with the decision when
 *   Apply resolves it (the resolution itself goes through the handle).
 * @property onReject - Optional side-effect hook fired with the decision
 *   when Reject resolves it.
 * @property slice - Optional author-bound slice handle over the queue; its
 *   narrowing (matched with the slice's own bound config) applies before the
 *   urgency sort and the routine split whether or not a rail mounts.
 * @property affordances - Which rail affordances mount in the queue's eyebrow
 *   when `slice` is set.
 * @property maxHeight - Optional cap on the queue's height (a CSS length).
 *   The header stays pinned; the rows scroll.
 * @property density - Information-density preset.
 * @property groups - Custom groupings for the Group-by toolbar (label →
 *   accessor); built-in `urgency` / `kind` / `none` are added by the renderer.
 * @property groupBy - The grouping that opens first (`"urgency"` / `"kind"` /
 *   `"none"` / a `groups` label). Present (or non-empty `groups`) ⇒ the toolbar
 *   mounts; both absent ⇒ the flat queue.
 * @property collapsible - Whether group heads collapse and a Collapse-/Expand-all
 *   control mounts.
 */
export const DecisionQueuePayloadType = StructType({
    handle: DecisionHandleRefType,
    heading: OptionType(StringType),
    modify: OptionType(FunctionType([DecisionType, DecisionUpdateType], UIComponentType)),
    evidence: OptionType(FunctionType([DecisionType], UIComponentType)),
    defaultExpanded: OptionType(DecisionType),
    defaultFacet: OptionType(FacetType),
    facets: OptionType(ArrayType(DataFacetType)),
    onApply: OptionType(FunctionType([DecisionType], NullType)),
    onReject: OptionType(FunctionType([DecisionType], NullType)),
    slice: OptionType(SliceBindType),
    affordances: OptionType(ArrayType(SliceAffordanceType)),
    maxHeight: OptionType(StringType),
    density: OptionType(DensityType),
    groups: OptionType(ArrayType(DecisionGroupType)),
    groupBy: OptionType(StringType),
    collapsible: OptionType(BooleanType),
});
/** Type alias for {@link DecisionQueuePayloadType}. */
export type DecisionQueuePayloadType = typeof DecisionQueuePayloadType;

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const DecisionQueueComponent = EastUI.component("DecisionQueue", DecisionQueuePayloadType, { optional: true });

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Options for {@link DecisionQueue.Root}.
 *
 * @property handle - The surface's `Decision.bind` handle.
 * @property heading - Optional header label.
 * @property modify - Optional per-kind probe editor `(decision, update) =>
 *   UIComponentType` — the expanded row's Modify facet. (A typed arrow; the
 *   factory lifts it to an `East.function`.)
 * @property evidence - Optional per-decision Evidence-tab canvas `(decision) =>
 *   UIComponentType` — rendered inside the Evidence facet.
 * @property defaultExpanded - The case shown expanded before any selection
 *   exists — an *option*: pass a `firstMap` predicate's result directly.
 *   Derive it from the bound data, never a copied id literal; when the
 *   case leaves the data (e.g. it is applied) the option goes `none` and
 *   nothing is expanded.
 * @property defaultFacet - The facet the expansion opens with (defaults to
 *   `evidence`).
 * @property onApply - Optional per-row Apply side-effect hook.
 * @property onReject - Optional per-row Reject side-effect hook.
 * @property slice - Author-bound slice handle over the queue — the `Table`
 *   pattern, with an ordinary `Slice.config` over the decision envelope and
 *   the handle's own queue union as the rows feed:
 *   `Slice.bind([Decision.Types.Decision], key, cfg, Slice.state({…}),
 *   handle.queue(), none)`. You own the key (per-surface scopes over one
 *   handle, shareable with any other component) and the config (which fields
 *   the rail offers; the queue's narrowing matches with the same bound
 *   config). Narrowing applies before the urgency sort and the routine split
 *   whether or not a rail is mounted — seeding state with no rail gives an
 *   invisible author scope.
 * @property affordances - Rail affordances when `slice` is set (default
 *   `["filter", "search"]`). `brush` is rejected — the queue has no
 *   continuous axis.
 * @property maxHeight - Optional cap on the queue's height (a CSS length).
 *   The header stays pinned; the rows scroll. Unset, the queue grows with
 *   its content.
 * @property density - Information-density preset (`comfortable` | `compact`
 *   | `condensed`).
 * @property groups - Custom groupings for the Group-by toolbar — a map of
 *   toolbar label → group-value accessor `(decision) => String`.
 * @property groupBy - The grouping that opens first (`"urgency"` / `"kind"` /
 *   `"none"` / a `groups` label; default `"urgency"`). Passing this or `groups`
 *   mounts the toolbar; omit both for the flat queue.
 * @property collapsible - Whether group heads collapse and a Collapse-/Expand-all
 *   control mounts (default `true`).
 */
export interface DecisionQueueOptions {
    handle: DecisionHandleLike;
    heading?: SubtypeExprOrValue<StringType>;
    /**
     * Per-kind probe editor — a pass-through `East.function` value (like
     * `Table` column `render`), not invoked at build time. Authoring it as a
     * real function means the host builds the editor inside (capturing only the
     * `decision` + `update` params + plain data / bind-handles), so the body
     * never captures a pre-built `UIComponentType` — which crashes the beast2
     * encoder (#136).
     */
    modify?: SubtypeExprOrValue<FunctionType<[DecisionType, DecisionUpdateType], UIComponentType>>;
    /** Per-decision Evidence-tab canvas — a pass-through `East.function` value, not invoked at build time (#136). */
    evidence?: SubtypeExprOrValue<FunctionType<[DecisionType], UIComponentType>>;
    defaultExpanded?: SubtypeExprOrValue<OptionType<DecisionType>>;
    defaultFacet?: FacetLiteral | SubtypeExprOrValue<FacetType>;
    /** Include-list of data facets to show (`evidence` / `options` / `judgement`); omit ⇒ all.
     *  `modify` stays callback-gated. Accepts a string-literal array OR a runtime
     *  `Array<DataFacet>` expression (mirrors `defaultFacet`). */
    facets?: DataFacetLiteral[] | SubtypeExprOrValue<ArrayType<DataFacetType>>;
    /** Per-row Apply side-effect hook — a pass-through `East.function` value (like `modify`/`evidence`), not invoked at build time. */
    onApply?: SubtypeExprOrValue<FunctionType<[DecisionType], NullType>>;
    /** Per-row Reject side-effect hook — a pass-through `East.function` value, not invoked at build time. */
    onReject?: SubtypeExprOrValue<FunctionType<[DecisionType], NullType>>;
    /** Author-bound slice handle over the queue (`Slice.bind` over the decision envelope, rows = `handle.queue()`) — chrome + narrowing. */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Rail affordances when `slice` is set. Default `["filter", "search"]`; `[]` keeps the narrowing with no rail; `brush` is rejected. */
    affordances?: SliceAffordanceLiteral[];
    maxHeight?: SubtypeExprOrValue<StringType>;
    density?: SubtypeExprOrValue<OptionType<DensityType>> | DensityLiteral;
    /** Custom groupings for the Group-by toolbar — a map of toolbar label →
     *  group-value accessor `(decision) => String`. Urgency / Kind / None are
     *  added automatically; you declare only custom groupings, all one shape. */
    groups?: Record<string, (decision: ExprType<DecisionType>) => SubtypeExprOrValue<StringType>>;
    /** The grouping that opens first: `"urgency"` | `"kind"` | `"none"` | a
     *  `groups` label (default `"urgency"`). Passing this or `groups` mounts the
     *  Group-by toolbar; omit both for a flat queue. */
    groupBy?: string;
    /** Group heads collapse + a Collapse-/Expand-all control mounts (default `true`). */
    collapsible?: SubtypeExprOrValue<BooleanType>;
}

/**
 * The Decision queue component namespace — the Decide surface.
 *
 * @remarks
 * Use `DecisionQueue.Root({ handle, modify: …, evidence: … })` inside a
 * `Reactive` block, with the handle from `Decision.bind`. The `Component`
 * property is the {@link EastUI.component} carrier the renderer registers
 * against.
 */
export const DecisionQueue: {
    Root(options: DecisionQueueOptions): ExprType<UIComponentType>;
    Component: typeof DecisionQueueComponent;
    Types: {
        Payload: DecisionQueuePayloadType;
        Update: DecisionUpdateType;
        Facet: FacetType;
        DataFacet: DataFacetType;
        Group: DecisionGroupType;
    };
} = {
    /**
     * Build a decision queue bound to a decision handle.
     *
     * @param options - {@link DecisionQueueOptions}. Only `handle` is required.
     * @returns An East expression of {@link UIComponentType}.
     */
    Root(options: DecisionQueueOptions): ExprType<UIComponentType> {
        // Pass the render functions through untouched (like Table column
        // `render`) — never invoke them at build time, so the host builds the
        // editor inside the function and captures no pre-built UIComponentType.
        const modify = options.modify === undefined
            ? none
            : some(East.value(options.modify, FunctionType([DecisionType, DecisionUpdateType], UIComponentType)));
        const evidence = options.evidence === undefined
            ? none
            : some(East.value(options.evidence, FunctionType([DecisionType], UIComponentType)));
        // Apply / Reject hooks pass through untouched (like `modify`/`evidence`) —
        // never invoked at build time, so the author writes them as real
        // `East.function` values that capture only data + bind-handles.
        const onApply = options.onApply === undefined
            ? none
            : some(East.value(options.onApply, FunctionType([DecisionType], NullType)));
        const onReject = options.onReject === undefined
            ? none
            : some(East.value(options.onReject, FunctionType([DecisionType], NullType)));
        const defaultFacet = options.defaultFacet === undefined
            ? none
            : some(typeof options.defaultFacet === "string"
                ? East.value(variant(options.defaultFacet, null), FacetType)
                : options.defaultFacet);
        const facets = options.facets === undefined
            ? none
            // A plain string-literal include-list → lift each into its DataFacet
            // variant; anything else (a `DataFacet` value array or a runtime
            // `Array<DataFacet>` expression) passes straight through.
            : some(Array.isArray(options.facets) && options.facets.every(f => typeof f === "string")
                ? East.value((options.facets as DataFacetLiteral[]).map(f => variant(f, null)), ArrayType(DataFacetType))
                : East.value(options.facets as SubtypeExprOrValue<ArrayType<DataFacetType>>, ArrayType(DataFacetType)));
        // Author-bound slice handle (Table pattern) + rail affordances. The
        // affordance list defaults when a slice is passed; a rail without a
        // slice has nothing to mount, so `affordances` alone is ignored, and
        // an explicit `[]` keeps the slice's narrowing with no rail (the
        // invisible author scope).
        const sliceAffordances = options.slice === undefined
            ? undefined
            : options.affordances ?? (["filter", "search"] as SliceAffordanceLiteral[]);
        if (sliceAffordances?.includes("brush")) {
            throw new Error("DecisionQueue does not support the 'brush' affordance — it has no continuous axis.");
        }
        const slice = options.slice === undefined
            ? none
            : some(East.value(options.slice, SliceBindType));
        const affordances = sliceAffordances === undefined || sliceAffordances.length === 0
            ? none
            : some(East.value(sliceAffordances.map(a => variant(a, null)), ArrayType(SliceAffordanceType)));
        const density = options.density === undefined
            ? none
            : typeof options.density === "string"
                ? some(East.value(variant(options.density, null), DensityType))
                : options.density;
        // Custom groupings: lift each bare accessor to a pass-through East
        // function (like `modify` / `evidence`) — the renderer runs it per row.
        const groups = options.groups === undefined
            ? none
            : some(East.value(
                Object.entries(options.groups).map(([label, accessor]) => ({
                    label,
                    value: reifyAccessor([DecisionType], (d: ExprType<DecisionType>) => East.value(accessor(d), StringType)),
                })),
                ArrayType(DecisionGroupType)));
        // Grouping mounts when either the default or a custom map is given.
        const grouped = options.groupBy !== undefined || options.groups !== undefined;
        const groupBy = grouped ? some(East.value(options.groupBy ?? "urgency", StringType)) : none;
        const collapsible = options.collapsible === undefined
            ? none
            : some(East.value(options.collapsible, BooleanType));
        return DecisionQueueComponent.Root({
            handle: East.value({
                decisions: options.handle.decisions,
                judgements: options.handle.judgements,
            }, DecisionHandleRefType),
            heading: options.heading !== undefined ? some(options.heading) : none,
            modify,
            evidence,
            defaultExpanded: options.defaultExpanded !== undefined
                ? East.value(options.defaultExpanded, OptionType(DecisionType))
                : none,
            defaultFacet,
            facets,
            onApply,
            onReject,
            slice,
            affordances,
            maxHeight: options.maxHeight !== undefined ? some(options.maxHeight) : none,
            density,
            groups,
            groupBy,
            collapsible,
        });
    },
    /** The internal {@link EastUI.component} carrier renderers register against. */
    Component: DecisionQueueComponent,
    Types: {
        /** The rendered payload struct. */
        Payload: DecisionQueuePayloadType,
        /** The probe editor's `update` writer. */
        Update: DecisionUpdateType,
        /** The expanded row's facet variant. */
        Facet: FacetType,
        /** The author-selectable data-facet subset (`evidence` / `options` / `judgement`). */
        DataFacet: DataFacetType,
        /** One custom grouping definition (`label` + accessor). */
        Group: DecisionGroupType,
    },
} as const;
