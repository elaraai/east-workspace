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
    type CollapsibleOptions,
} from "./types.js";

// Re-export types
export {
    CollapsibleStyleType,
    type CollapsibleStyle,
    type CollapsibleOptions,
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
 * Creates a Collapsible — a single open/close region with a rich trigger
 * and arbitrary UIComp content.
 *
 * @param trigger - String (coerced to `Text.Root(s)`) or UIComponentType
 * @param content - Content shown when expanded (UIComp)
 * @param options - State + behaviour + optional `style`
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
 *         "Why did we recommend this?",
 *         Text.Root("Because Stage 1 was delayed by ~6h due to setpoint drift since 02:00."),
 *         { defaultOpen: false },
 *     ),
 * );
 * ```
 */
function createCollapsible(
    trigger: CollapsibleTriggerInput,
    content: SubtypeExprOrValue<UIComponentType>,
    options?: CollapsibleOptions,
): ExprType<UIComponentType> {
    const triggerExpr: ExprType<UIComponentType> = typeof trigger === "string"
        ? Text.Root(trigger)
        : trigger as ExprType<UIComponentType>;

    const styleValue = options?.style
        ? East.value({
            background: options.style.background !== undefined ? some(options.style.background) : none,
            borderColor: options.style.borderColor !== undefined ? some(options.style.borderColor) : none,
            triggerColor: options.style.triggerColor !== undefined ? some(options.style.triggerColor) : none,
            contentColor: options.style.contentColor !== undefined ? some(options.style.contentColor) : none,
        }, CollapsibleStyleType)
        : undefined;

    return East.value(variant("Collapsible", {
        trigger: triggerExpr,
        content,
        defaultOpen: options?.defaultOpen !== undefined ? some(options.defaultOpen) : none,
        onOpenChange: options?.onOpenChange ? some(options.onOpenChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Collapsible primitive — single open/close region.
 *
 * @remarks
 * Use `Collapsible.Root(trigger, content, options)`.
 */
export const Collapsible = {
    /**
     * Creates a Collapsible component.
     *
     * @param trigger - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param content - Content shown when expanded (UIComp)
     * @param options - State + behaviour + optional `style`
     * @returns An East expression representing the Collapsible component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Collapsible, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Collapsible.Root("Details", Text.Root("Hidden content."), { defaultOpen: false }),
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
