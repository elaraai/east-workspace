/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    OptionType,
    StructType,
    BooleanType,
    FunctionType,
    NullType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { Text } from "../../typography/text/index.js";
import {
    CollapsibleStyleType,
    type CollapsibleStyle,
} from "./types.js";

// Re-export types
export {
    CollapsibleStyleType,
    type CollapsibleStyle,
} from "./types.js";

// ============================================================================
// CollapsibleType — standalone mirror of the inline `Collapsible` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `Collapsible` variant in
 * `component.ts`. Renderers reference this for `equalFor` / `ValueTypeOf`.
 *
 * @property trigger - Trigger content (UIComp — strings coerced to `Text.Root` at factory)
 * @property content - Content shown when expanded (UIComp)
 * @property defaultOpen - Whether the collapsible starts expanded
 * @property onOpenChange - Callback invoked with the new open state
 * @property style - Visual-presentation sub-struct
 */
export const CollapsibleType: StructType<{
    trigger: UIComponentType,
    content: UIComponentType,
    defaultOpen: OptionType<BooleanType>,
    onOpenChange: OptionType<FunctionType<[BooleanType], NullType>>,
    style: OptionType<CollapsibleStyleType>,
}> = StructType({
    trigger: UIComponentType,
    content: UIComponentType,
    defaultOpen: OptionType(BooleanType),
    onOpenChange: OptionType(FunctionType([BooleanType], NullType)),
    style: OptionType(CollapsibleStyleType),
});

export type CollapsibleType = typeof CollapsibleType;

// ============================================================================
// Collapsible Factory
// ============================================================================

type CollapsibleTriggerInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `Collapsible.Root`.
 *
 * @property trigger - Always-visible trigger (string coerced to `Text.Root` or a UIComponent)
 * @property defaultOpen - Whether the collapsible starts expanded
 * @property onOpenChange - Callback invoked with the new open state
 * @property background - Container background colour
 * @property borderColor - Container border colour
 * @property triggerColor - Trigger text colour
 * @property contentColor - Content text colour
 */
export interface CollapsibleOptions extends CollapsibleStyle {
    /** Always-visible trigger (string coerced to `Text.Root` or a UIComponent) — required. */
    trigger: CollapsibleTriggerInput;
    /** Whether the collapsible starts expanded */
    defaultOpen?: SubtypeExprOrValue<BooleanType>;
    /** Callback invoked with the new open state */
    onOpenChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
}

/**
 * Creates a Collapsible — a single open/close region with a rich trigger
 * and arbitrary UIComp content.
 *
 * @param content - Content shown when expanded (UIComp)
 * @param options - Required `trigger`, optional state / behaviour / visual style fields
 * @returns An East expression representing the Collapsible component
 *
 * @remarks
 * Distinct from `Accordion` (multiple sections) and `Disclosure` (text
 * truncation). Use for inline "Why / Show more" drawers in table rows,
 * detail panels, and expandable explanations.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Collapsible, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const whyDrawer = East.function([], UIComponentType, _$ =>
 *     Collapsible.Root(
 *         Text.Root("Because Stage 1 was delayed by ~6h due to setpoint drift since 02:00."),
 *         { trigger: "Why did we recommend this?", defaultOpen: false },
 *     ),
 * );
 * ```
 */
function createCollapsible(
    content: SubtypeExprOrValue<UIComponentType>,
    options: CollapsibleOptions,
): ExprType<UIComponentType> {
    const { trigger, defaultOpen, onOpenChange, ...visual } = options;

    const triggerExpr: ExprType<UIComponentType> = typeof trigger === "string"
        ? Text.Root(trigger)
        : trigger as ExprType<UIComponentType>;

    const hasVisual = Object.values(visual).some(field => field !== undefined);
    const styleValue = hasVisual
        ? East.value({
            background: visual.background !== undefined ? some(visual.background) : none,
            borderColor: visual.borderColor !== undefined ? some(visual.borderColor) : none,
            triggerColor: visual.triggerColor !== undefined ? some(visual.triggerColor) : none,
            contentColor: visual.contentColor !== undefined ? some(visual.contentColor) : none,
        }, CollapsibleStyleType)
        : undefined;

    return East.value(variant("Collapsible", {
        trigger: triggerExpr,
        content,
        defaultOpen: defaultOpen !== undefined ? some(defaultOpen) : none,
        onOpenChange: onOpenChange ? some(onOpenChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Collapsible primitive — single open/close region.
 *
 * @remarks
 * Use `Collapsible.Root(content, { trigger, ... })`.
 */
export const Collapsible = {
    /**
     * Creates a Collapsible component.
     *
     * @param content - Content shown when expanded (UIComp)
     * @param options - Required `trigger`, optional state / behaviour / visual style fields
     * @returns An East expression representing the Collapsible component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Collapsible, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Collapsible.Root(Text.Root("Hidden content."), { trigger: "Details", defaultOpen: false }),
     * );
     * ```
     */
    Root: createCollapsible,
    Types: {
        /**
         * The concrete East type for Collapsible — mirrors the inline
         * `Collapsible` variant in `component.ts`.
         */
        Collapsible: CollapsibleType,
        /**
         * Visual-only style struct for Collapsible.
         */
        Style: CollapsibleStyleType,
    },
} as const;
