/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Diff component — transactional review of pending changes for any
 * combination of {@link Data.bind} bindings.
 *
 * @remarks
 * The Diff card surfaces the in-flight change for each binding the caller
 * lists in `bindings`. Per-leaf Discard, per-group Discard-all, and a
 * footer Apply button drive the binding's commit flow. Conflicts surface
 * inline as orange chooser rows (staged-mode 3-way drift) and as orange
 * "stale" warning badges (drift between a patch dataset's expectations
 * and the current source).
 *
 * Declared via the `EastUI.component` extension API — the React renderer
 * lives in `@elaraai/e3-ui-components` and is wired via
 * `implementUIComponent(DiffComponent, EastChakraDiff)` at module load
 * time.
 *
 * @packageDocumentation
 */

import {
    East,
    StringType,
    BooleanType,
    NullType,
    IntegerType,
    StructType,
    OptionType,
    ArrayType,
    FunctionType,
    none,
    some,
    variant,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, DensityType, type DensityLiteral, type UIComponentType } from "@elaraai/east-ui";

import { DiffBindingType } from "../bind/data.js";

// ============================================================================
// Sub-types — visual style escape hatches.
// ============================================================================

/**
 * Visual style escape hatches for the Diff component. Every visible surface
 * is tokenable; defaults come from the host's Chakra theme (Elara AI brand).
 *
 * @property addedBackground - Soft-tint background for added / inserted leaves.
 * @property addedColor - Foreground for added leaves.
 * @property addedBorderColor - Border for added chips.
 * @property removedBackground - Soft-tint background for removed / deleted leaves.
 * @property removedColor - Foreground for removed leaves.
 * @property removedBorderColor - Border for removed chips.
 * @property changedBackground - Soft-tint background for updated leaves.
 * @property changedColor - Foreground for updated leaves.
 * @property changedBorderColor - Border for updated chips.
 * @property unchangedColor - Foreground for unchanged rows when shown.
 * @property acceptedBackground - Lane background for accepted-row indicator.
 * @property acceptedBorderColor - Left-edge accent stripe for accepted rows.
 * @property rejectedBackground - Lane background for rejected rows.
 * @property rejectedBorderColor - Border for rejected rows.
 * @property headerBackground - Card header background.
 * @property summaryBackground - Stats bar background.
 * @property background - Card body background.
 * @property borderColor - Card outer border.
 * @property indentGuideColor - Vertical guide line for nested rows.
 * @property lineNumberColor - Gutter line numbers in unified mode.
 */
export const DiffStyleType = StructType({
    addedBackground:     OptionType(StringType),
    addedColor:          OptionType(StringType),
    addedBorderColor:    OptionType(StringType),
    removedBackground:   OptionType(StringType),
    removedColor:        OptionType(StringType),
    removedBorderColor:  OptionType(StringType),
    changedBackground:   OptionType(StringType),
    changedColor:        OptionType(StringType),
    changedBorderColor:  OptionType(StringType),
    unchangedColor:      OptionType(StringType),
    acceptedBackground:  OptionType(StringType),
    acceptedBorderColor: OptionType(StringType),
    rejectedBackground:  OptionType(StringType),
    rejectedBorderColor: OptionType(StringType),
    headerBackground:    OptionType(StringType),
    summaryBackground:   OptionType(StringType),
    background:          OptionType(StringType),
    borderColor:         OptionType(StringType),
    indentGuideColor:    OptionType(StringType),
    lineNumberColor:     OptionType(StringType),
});
/** Type alias for {@link DiffStyleType}. */
export type DiffStyleType = typeof DiffStyleType;

// ============================================================================
// Re-export the binding descriptor — it lives in `data.ts` to keep the
// dependency direction one-way (Diff consumes; Data produces).
// ============================================================================

export { DiffBindingType } from "../bind/data.js";

// ============================================================================
// Diff payload — IR shape consumed by the renderer.
// ============================================================================

/**
 * Schema for the `Diff` extension component. Internal IR shape — the
 * developer-facing factory `Diff.Root` accepts {@link DataBindHandleType}
 * descriptors and forwards them as `bindings`.
 *
 * @property bindings - The set of bindings to surface in the card. Each
 *   entry is a {@link DiffBindingType} value (typically obtained via the
 *   `binding` field of a {@link Data.bind} handle).
 * @property readonly - Render the Diff without per-leaf or per-group Discard
 *   buttons. The footer Apply / Discard-all still render. Default `false`
 *   (interactive review).
 * @property hideUnchanged - Elide unchanged rows. None ⇒ false.
 * @property maxDepth - Cap nesting depth before "Show more" collapses. None ⇒ no cap.
 * @property density - Information-density preset (`comfortable` | `compact`
 *   | `condensed`). Defaults to `comfortable`.
 * @property onCommitted - Fired after a successful commit (post-merge).
 * @property onDiscarded - Fired after a successful discard.
 * @property style - Visual style escape hatches.
 */
export const DiffPayloadType = StructType({
    bindings:      ArrayType(DiffBindingType),
    readonly:      OptionType(BooleanType),
    hideUnchanged: OptionType(BooleanType),
    maxDepth:      OptionType(IntegerType),
    density:       OptionType(DensityType),
    onCommitted:   OptionType(FunctionType([], NullType)),
    onDiscarded:   OptionType(FunctionType([], NullType)),
    style:         OptionType(DiffStyleType),
});
/** Type alias for {@link DiffPayloadType}. */
export type DiffPayloadType = typeof DiffPayloadType;

/**
 * Internal `EastUI.component` carrier. Renderers register against this in
 * `@elaraai/e3-ui-components`. Most callers should use {@link Diff.Root}
 * (which wraps this with the handle-friendly API) rather than touching
 * `DiffComponent` directly.
 */
export const DiffComponent = EastUI.component("Diff", DiffPayloadType, { optional: true });

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Options for {@link Diff.Root}.
 *
 * @property bindings - The set of bindings to surface. Pass `view.binding`
 *   from each {@link Data.bind} handle, or hand-build descriptors of shape
 *   {@link DiffBindingType}.
 * @property readonly - Render without per-leaf / per-group Discard buttons.
 *   The footer Apply / Discard-all still render. Defaults to false.
 * @property hideUnchanged - Elide unchanged rows. Defaults to false.
 * @property maxDepth - Cap nesting depth. Defaults to no cap.
 * @property density - Information-density preset (`comfortable` | `compact`
 *   | `condensed`). Defaults to `comfortable`.
 * @property onCommitted - Fired after the user commits.
 * @property onDiscarded - Fired after the user discards.
 * @property style - Visual style escape hatches.
 */
export interface DiffOptions {
    /** Bindings to surface. Typically `[view.binding, ...]`. */
    bindings: SubtypeExprOrValue<ArrayType<DiffBindingType>>;
    /** Render without per-leaf / per-group Discard buttons. Defaults to false (interactive). */
    readonly?: SubtypeExprOrValue<OptionType<BooleanType>>;
    /** Elide unchanged rows. Defaults to false. */
    hideUnchanged?: SubtypeExprOrValue<OptionType<BooleanType>>;
    /** Cap nesting depth before "Show more" collapses. Defaults to no cap. */
    maxDepth?: SubtypeExprOrValue<OptionType<IntegerType>>;
    /** Information-density preset. */
    density?: SubtypeExprOrValue<OptionType<DensityType>> | DensityLiteral;
    /** Fired after a successful commit (post-merge). */
    onCommitted?: SubtypeExprOrValue<OptionType<FunctionType<[], NullType>>>;
    /** Fired after a successful discard. */
    onDiscarded?: SubtypeExprOrValue<OptionType<FunctionType<[], NullType>>>;
    /** Visual style escape hatches — see {@link DiffStyleType}. */
    style?: SubtypeExprOrValue<OptionType<DiffStyleType>>;
}

/**
 * The Diff component namespace. Surfaces transactional pending edits for
 * review and commit, with merge-aware conflict resolution and stale-patch
 * drift detection.
 *
 * @remarks
 * Use `Diff.Root({ bindings: [view.binding, ...] })` to render the panel.
 * The `Component` property is the internal {@link EastUI.component}
 * carrier that renderers register against — most callers shouldn't need
 * it.
 */
export const Diff = {
    /**
     * Build a Diff component. Surfaces every binding's in-flight change in
     * a single review card, with per-leaf accept / reject and a footer
     * Apply that runs the right commit per binding.
     *
     * @param options - {@link DiffOptions}. Only `bindings` is required;
     *   the rest default to absent / interactive.
     * @returns An East expression of {@link UIComponentType} representing
     *   the Diff panel.
     *
     * @remarks
     * The renderer reads each binding's IR descriptor (`source`, optional
     * `patch`, `mode`), looks up the runtime types in the binding
     * registry, and derives the in-flight change to display. Apply's
     * commit code path depends on the binding's mode and patch presence —
     * staged + no patch applies the buffer to source; staged + patch
     * publishes the buffer as a fresh patch to the patch dataset; direct
     * + patch applies the existing patch dataset to the source. Discard
     * always drops the in-flight change in place.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Reactive, UIComponentType } from "@elaraai/east-ui";
     * import { Data, Diff } from "@elaraai/e3-ui";
     * import * as e3 from "@elaraai/e3";
     *
     * const maxWeeklyHoursInput = e3.input("max_weekly_hours", FloatType, 38.0);
     *
     * // Mirrors `diffDefaults` in test/diff.examples.ts (wired via Assert.examples).
     * const diffDefaults = East.function([], UIComponentType, _$ => {
     *     return Reactive.Root(East.function([], UIComponentType, $ => {
     *         const view = $.let(Data.bind(maxWeeklyHoursInput));
     *         return Diff.Root({ bindings: [view.binding] });
     *     }));
     * });
     * ```
     */
    Root(options: DiffOptions): ExprType<UIComponentType> {
        const density = options.density === undefined
            ? none
            : typeof options.density === "string"
                ? some(East.value(variant(options.density, null), DensityType))
                : options.density;
        return DiffComponent.Root({
            bindings:      options.bindings,
            readonly:      options.readonly      ?? none,
            hideUnchanged: options.hideUnchanged ?? none,
            maxDepth:      options.maxDepth      ?? none,
            density,
            onCommitted:   options.onCommitted   ?? none,
            onDiscarded:   options.onDiscarded   ?? none,
            style:         options.style         ?? none,
        });
    },
    /**
     * The internal {@link EastUI.component} carrier. Renderers register
     * against this in `@elaraai/e3-ui-components` via
     * `implementUIComponent(Diff.Component, EastChakraDiff)`. Most callers
     * should use {@link Diff.Root} (the handle-friendly factory) and never
     * touch this directly.
     */
    Component: DiffComponent,
    Types: {
        /** Rendered Diff payload struct (bindings + style). */
        Payload: DiffPayloadType,
        /** Visual-presentation sub-struct (density, layout). */
        Style: DiffStyleType,
    },
} as const;
