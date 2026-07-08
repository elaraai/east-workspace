/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    BooleanType,
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
import {
    ExpandableStyleType,
    type ExpandableOptions,
} from "./types.js";

// Re-export types
export {
    ExpandableStyleType,
    type ExpandableStyle,
    type ExpandableOptions,
} from "./types.js";

// ============================================================================
// ExpandableType — standalone mirror of the inline `Expandable` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `Expandable` variant in
 * `component.ts`. Renderers reference this for `equalFor` / `ValueTypeOf`.
 *
 * @property content - The region content (UIComp) — keeps its identity across expand/collapse
 * @property expanded - Expanded state (synced on change; omit for local toggling)
 * @property onExpandedChange - Callback invoked with the new expanded state
 * @property label - Accessible name for the toggle control
 * @property style - Visual-presentation sub-struct (zIndex, background)
 */
export const ExpandableType: StructType<{
    content: UIComponentType,
    expanded: OptionType<BooleanType>,
    onExpandedChange: OptionType<FunctionType<[BooleanType], NullType>>,
    label: OptionType<StringType>,
    style: OptionType<ExpandableStyleType>,
}> = StructType({
    content: UIComponentType,
    expanded: OptionType(BooleanType),
    onExpandedChange: OptionType(FunctionType([BooleanType], NullType)),
    label: OptionType(StringType),
    style: OptionType(ExpandableStyleType),
});

export type ExpandableType = typeof ExpandableType;

// ============================================================================
// Expandable Factory
// ============================================================================

/**
 * Creates an Expandable — a region that can expand in place to fill the
 * host application's container (the whole window the app renders in) and
 * collapse back into the surrounding layout.
 *
 * @param content - The region content (UIComp)
 * @param options - Optional state / behaviour / visual style fields
 * @returns An East expression representing the Expandable component
 *
 * @remarks
 * The renderer performs a CSS takeover (`position: fixed; inset: 0`) on the
 * same element — the content keeps its React/DOM identity, so transient
 * state (scroll, selection, splitter drag) survives expand/collapse. This is
 * an in-place resize, not an overlay: distinct from `Collapsible` (in-flow
 * show/hide of a region), `Disclosure` (text truncation), and `Dialog` /
 * `Drawer` (portalled overlays with backdrop semantics that render a copy of
 * their content).
 *
 * The expanded surface fills the viewport only when no ancestor element
 * creates a CSS containing block (`transform`, `filter`, `backdrop-filter`,
 * `perspective`, `contain`) — host apps embedding east-ui must keep the
 * ancestry of expandable regions free of those properties. Esc collapses the
 * topmost expanded region unless an inner overlay consumed the keypress.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Box, Expandable, Text, UIComponentType } from "@elaraai/east-ui/internal";
 *
 * const region = East.function([], UIComponentType, _$ =>
 *     Expandable.Root(
 *         Box.Root([Text.Root("Dense chart region — expand me")], { padding: "3" }),
 *         { label: "Schedule" },
 *     ),
 * );
 * ```
 */
function createExpandable(
    content: SubtypeExprOrValue<UIComponentType>,
    options?: ExpandableOptions,
): ExprType<UIComponentType> {
    const hasVisual = options !== undefined
        && (options.zIndex !== undefined || options.background !== undefined);
    const styleValue = hasVisual
        ? East.value({
            zIndex: options.zIndex !== undefined ? some(options.zIndex) : none,
            background: options.background !== undefined ? some(options.background) : none,
        }, ExpandableStyleType)
        : undefined;

    return East.value(variant("Expandable", {
        content,
        expanded: options?.expanded !== undefined ? some(options.expanded) : none,
        onExpandedChange: options?.onExpandedChange ? some(options.onExpandedChange) : none,
        label: options?.label !== undefined ? some(options.label) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Expandable primitive — a region that expands in place to fill the app
 * container.
 *
 * @remarks
 * Use `Expandable.Root(content, opts)`. Types are exposed via
 * `Expandable.Types`.
 */
export const Expandable = {
    /**
     * Creates an Expandable component.
     *
     * @param content - The region content (UIComp)
     * @param options - Optional state / behaviour / visual style fields
     * @returns An East expression representing the Expandable component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Box, Expandable, Text, UIComponentType } from "@elaraai/east-ui/internal";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Expandable.Root(
     *         Box.Root([Text.Root("Dense chart region — expand me")], { padding: "3" }),
     *         { label: "Schedule" },
     *     ),
     * );
     * ```
     */
    Root: createExpandable,
    Types: {
        /**
         * The concrete East type for Expandable — mirrors the inline
         * `Expandable` variant in `component.ts`.
         */
        Expandable: ExpandableType,
        /**
         * Visual-only style struct for Expandable (zIndex, background).
         */
        Style: ExpandableStyleType,
    },
} as const;
