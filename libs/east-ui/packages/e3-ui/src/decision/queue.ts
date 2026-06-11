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
 * `detail` canvas), `Options` (the ranked stack), `Judgement` (prompts ·
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
    NullType,
    FunctionType,
    some,
    none,
    variant,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, DensityType, UIComponentType, type DensityLiteral } from "@elaraai/east-ui";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "@elaraai/east-ui/internal";

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
 * The `DecisionQueue` component payload.
 *
 * @property handle - The surface's decision handle ref (binding descriptors).
 * @property heading - Optional header label (e.g. `"Decisions waiting"`).
 * @property modify - Optional per-kind probe editor: `(decision, update) =>
 *   UIComponentType`; renders as the expanded row's Modify facet.
 *   `update(edited)` writes the decision back through its owning binding.
 * @property detail - Optional per-decision canvas: `(decision) =>
 *   UIComponentType`; renders inside the Evidence facet (the host's chart /
 *   working surface / trajectory).
 * @property defaultExpanded - The case shown expanded before any selection
 *   exists (a display-only default — clicking rows writes the real
 *   selection).
 * @property defaultFacet - The facet the expansion opens with (defaults to
 *   `evidence`).
 * @property onApply - Optional side-effect hook fired with the decision when
 *   Apply resolves it (the resolution itself goes through the handle).
 * @property onReject - Optional side-effect hook fired with the decision
 *   when Reject resolves it.
 * @property slice - Optional rail affordances. The slice itself is
 *   handle-owned (bound by `Decision.bind`, seeded there); this field only
 *   chooses what mounts in the queue's eyebrow rail.
 * @property maxHeight - Optional cap on the queue's height (a CSS length).
 *   The header stays pinned; the rows scroll.
 * @property density - Information-density preset.
 */
export const DecisionQueuePayloadType = StructType({
    handle: DecisionHandleRefType,
    heading: OptionType(StringType),
    modify: OptionType(FunctionType([DecisionType, DecisionUpdateType], UIComponentType)),
    detail: OptionType(FunctionType([DecisionType], UIComponentType)),
    defaultExpanded: OptionType(DecisionType),
    defaultFacet: OptionType(FacetType),
    onApply: OptionType(FunctionType([DecisionType], NullType)),
    onReject: OptionType(FunctionType([DecisionType], NullType)),
    slice: OptionType(ArrayType(SliceAffordanceType)),
    maxHeight: OptionType(StringType),
    density: OptionType(DensityType),
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
 * @property detail - Optional per-decision canvas `(decision) =>
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
 * @property slice - Operator-facing rail over the handle-owned slice: list
 *   the affordances (`["filter", "search"]`-style, or `true` for that
 *   default). The slice itself (binding, initial state, key) belongs to
 *   `Decision.bind`; its narrowing applies before the urgency sort and the
 *   routine split whether or not a rail is mounted — seeding state at bind
 *   with no rail gives an invisible author scope. `brush` is rejected.
 * @property maxHeight - Optional cap on the queue's height (a CSS length).
 *   The header stays pinned; the rows scroll. Unset, the queue grows with
 *   its content.
 * @property density - Information-density preset (`comfortable` | `compact`
 *   | `condensed`).
 */
export interface DecisionQueueOptions {
    handle: DecisionHandleLike;
    heading?: SubtypeExprOrValue<StringType>;
    modify?: (
        decision: ExprType<DecisionType>,
        update: ExprType<DecisionUpdateType>,
    ) => SubtypeExprOrValue<UIComponentType>;
    detail?: (decision: ExprType<DecisionType>) => SubtypeExprOrValue<UIComponentType>;
    defaultExpanded?: SubtypeExprOrValue<OptionType<DecisionType>>;
    defaultFacet?: FacetLiteral | SubtypeExprOrValue<FacetType>;
    onApply?: (decision: ExprType<DecisionType>) => SubtypeExprOrValue<NullType>;
    onReject?: (decision: ExprType<DecisionType>) => SubtypeExprOrValue<NullType>;
    slice?: SliceAffordanceLiteral[] | true;
    maxHeight?: SubtypeExprOrValue<StringType>;
    density?: SubtypeExprOrValue<OptionType<DensityType>> | DensityLiteral;
}

/**
 * The Decision queue component namespace — the Decide surface.
 *
 * @remarks
 * Use `DecisionQueue.Root({ handle, modify: …, detail: … })` inside a
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
    };
} = {
    /**
     * Build a decision queue bound to a decision handle.
     *
     * @param options - {@link DecisionQueueOptions}. Only `handle` is required.
     * @returns An East expression of {@link UIComponentType}.
     */
    Root(options: DecisionQueueOptions): ExprType<UIComponentType> {
        const modify = options.modify === undefined
            ? none
            : some(East.function([DecisionType, DecisionUpdateType], UIComponentType, (_$, decision, update) =>
                East.value(options.modify!(decision, update), UIComponentType)));
        const detail = options.detail === undefined
            ? none
            : some(East.function([DecisionType], UIComponentType, (_$, decision) =>
                East.value(options.detail!(decision), UIComponentType)));
        const onApply = options.onApply === undefined
            ? none
            : some(East.function([DecisionType], NullType, ($, decision) => {
                $(East.value(options.onApply!(decision), NullType));
            }));
        const onReject = options.onReject === undefined
            ? none
            : some(East.function([DecisionType], NullType, ($, decision) => {
                $(East.value(options.onReject!(decision), NullType));
            }));
        const defaultFacet = options.defaultFacet === undefined
            ? none
            : some(typeof options.defaultFacet === "string"
                ? East.value(variant(options.defaultFacet, null), FacetType)
                : options.defaultFacet);
        const sliceAffordances = options.slice === undefined
            ? undefined
            : options.slice === true ? (["filter", "search"] as SliceAffordanceLiteral[]) : options.slice;
        if (sliceAffordances?.includes("brush")) {
            throw new Error("DecisionQueue does not support the 'brush' affordance — it has no continuous axis.");
        }
        const slice = sliceAffordances === undefined
            ? none
            : some(East.value(sliceAffordances.map(a => variant(a, null)), ArrayType(SliceAffordanceType)));
        const density = options.density === undefined
            ? none
            : typeof options.density === "string"
                ? some(East.value(variant(options.density, null), DensityType))
                : options.density;
        return DecisionQueueComponent.Root({
            handle: East.value({
                decisions: options.handle.decisions,
                judgements: options.handle.judgements,
                slice: options.handle.sliceInit,
            }, DecisionHandleRefType),
            heading: options.heading !== undefined ? some(options.heading) : none,
            modify,
            detail,
            defaultExpanded: options.defaultExpanded !== undefined
                ? East.value(options.defaultExpanded, OptionType(DecisionType))
                : none,
            defaultFacet,
            onApply,
            onReject,
            slice,
            maxHeight: options.maxHeight !== undefined ? some(options.maxHeight) : none,
            density,
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
    },
} as const;
