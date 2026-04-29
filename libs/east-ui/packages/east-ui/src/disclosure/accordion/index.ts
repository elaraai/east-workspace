/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    OptionType,
    StructType,
    StringType,
    BooleanType,
    FunctionType,
    NullType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType } from "../../style.js";
import { Text } from "../../typography/text/index.js";
import {
    AccordionStyleType,
    AccordionVariantType,
    AccordionVariant,
    type AccordionStyle,
    type AccordionOptions,
    type AccordionItemOptions,
    type AccordionVariantLiteral,
} from "./types.js";

// Re-export types
export {
    AccordionStyleType,
    AccordionVariantType,
    AccordionVariant,
    type AccordionStyle,
    type AccordionOptions,
    type AccordionItemOptions,
    type AccordionVariantLiteral,
} from "./types.js";

// ============================================================================
// AccordionItemType — standalone mirror of the inline item sub-struct in component.ts
// ============================================================================

/**
 * Concrete struct mirroring the inline item sub-struct used by the
 * `Accordion` variant in `component.ts`. Renderers reference this for
 * `equalFor` / `ValueTypeOf`.
 *
 * @remarks
 * `trigger` is a UIComponentType — strings passed at the factory boundary
 * are coerced to `Text.Root(s)`. Same container pattern as
 * `Button.Types.Button` / `List.Types.List` / `Note.Types.Note` in earlier
 * plans.
 *
 * @property value - Unique identifier for the item
 * @property trigger - Header/trigger content (UIComp)
 * @property content - Array of child UI components shown when expanded
 * @property disabled - Per-item disabled flag
 */
export const AccordionItemType: StructType<{
    value: StringType,
    trigger: UIComponentType,
    content: ArrayType<UIComponentType>,
    disabled: OptionType<BooleanType>,
}> = StructType({
    value: StringType,
    trigger: UIComponentType,
    content: ArrayType(UIComponentType),
    disabled: OptionType(BooleanType),
});

/**
 * Type representing the AccordionItem structure.
 */
export type AccordionItemType = typeof AccordionItemType;

// ============================================================================
// AccordionType — standalone mirror of the inline `Accordion` variant in component.ts
// ============================================================================

/**
 * Concrete struct mirroring the inline `Accordion` variant in
 * `component.ts`. Renderers reference this for `equalFor` / `ValueTypeOf`.
 *
 * @property items - Array of accordion items
 * @property multiple - Allow multiple items open simultaneously
 * @property collapsible - Allow every item to be closed
 * @property value - Controlled expanded-value list
 * @property defaultValue - Initial expanded-value list (uncontrolled)
 * @property onValueChange - Callback invoked with the new expanded-value list
 * @property style - Visual-presentation sub-struct
 */
export const AccordionType: StructType<{
    items: ArrayType<AccordionItemType>,
    multiple: OptionType<BooleanType>,
    collapsible: OptionType<BooleanType>,
    value: OptionType<ArrayType<StringType>>,
    defaultValue: OptionType<ArrayType<StringType>>,
    onValueChange: OptionType<FunctionType<[ArrayType<StringType>], NullType>>,
    style: OptionType<AccordionStyleType>,
}> = StructType({
    items: ArrayType(AccordionItemType),
    multiple: OptionType(BooleanType),
    collapsible: OptionType(BooleanType),
    value: OptionType(ArrayType(StringType)),
    defaultValue: OptionType(ArrayType(StringType)),
    onValueChange: OptionType(FunctionType([ArrayType(StringType)], NullType)),
    style: OptionType(AccordionStyleType),
});

/**
 * Type representing the Accordion structure.
 */
export type AccordionType = typeof AccordionType;

// ============================================================================
// Accordion Item Factory
// ============================================================================

type AccordionItemTriggerInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * Creates an Accordion item with a rich trigger and content children.
 *
 * @param value - Unique identifier for this item
 * @param trigger - String (coerced to `Text.Root(s)`) or any UIComponentType
 * @param content - Array of child UI components for the collapsible content
 * @param options - Optional per-item configuration (`disabled`)
 * @returns An East expression representing the accordion item
 *
 * @remarks
 * `trigger` is a UIComp — strings coerce to `Text.Root(s)` at the factory
 * boundary, so the common case stays ergonomic.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Accordion, Stack, Text, Badge, UIComponentType } from "@elaraai/east-ui";
 *
 * const richTrigger = East.function([], UIComponentType, _$ =>
 *     Accordion.Root([
 *         Accordion.Item(
 *             "inputs",
 *             Stack.HStack([
 *                 Text.Root("Inputs"),
 *                 Badge.Root("3", { colorPalette: "blue" }),
 *             ], { gap: "2" }),
 *             [Text.Root("Three inputs are defined…")],
 *         ),
 *     ]),
 * );
 * ```
 */
function createAccordionItem(
    value: SubtypeExprOrValue<StringType>,
    trigger: AccordionItemTriggerInput,
    content: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options?: AccordionItemOptions,
): ExprType<AccordionItemType> {
    const triggerExpr: ExprType<UIComponentType> = typeof trigger === "string"
        ? Text.Root(trigger)
        : trigger as ExprType<UIComponentType>;

    return East.value({
        value,
        trigger: triggerExpr,
        content,
        disabled: options?.disabled !== undefined ? some(options.disabled) : none,
    }, AccordionItemType);
}

// ============================================================================
// Accordion Root Factory
// ============================================================================

/**
 * Creates an Accordion component.
 *
 * @param items - Array of accordion items (created with `Accordion.Item`)
 * @param options - Config + state + behaviour + optional `style`
 * @returns An East expression representing the Accordion component
 *
 * @remarks
 * `multiple` / `collapsible` (config),
 * `value` / `defaultValue` (state), and `onValueChange` (behaviour) are
 * top-level options — visual presentation lives inside `options.style`.
 *
 * @example
 * ```ts
 * import { East, ArrayType, NullType, StringType } from "@elaraai/east";
 * import { Accordion, Reactive, State, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * // Static accordion with rich triggers
 * const faq = East.function([], UIComponentType, _$ =>
 *     Accordion.Root([
 *         Accordion.Item("q1", "What is East UI?", [Text.Root("A typed UI library.")]),
 *         Accordion.Item("q2", "Is it open source?", [Text.Root("AGPL-3.0.")]),
 *     ], {
 *         multiple: true,
 *         collapsible: true,
 *         style: { variant: "enclosed" },
 *     }),
 * );
 *
 * // Reactive accordion wired through State.bind
 * const reactive = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const bind = $.let(State.bind([ArrayType(StringType)], "expanded", []));
 *         const expanded = $.let(bind.read());
 *         const onValueChange = $.const(East.function([ArrayType(StringType)], NullType, ($, next) => {
 *             $(bind.write(next));
 *         }));
 *         return Accordion.Root([
 *             Accordion.Item("a", "Section A", [Text.Root("A")]),
 *             Accordion.Item("b", "Section B", [Text.Root("B")]),
 *         ], { multiple: true, value: expanded, onValueChange, style: { variant: "enclosed" } });
 *     })),
 * );
 * ```
 */
function createAccordionRoot(
    items: SubtypeExprOrValue<ArrayType<AccordionItemType>>,
    options?: AccordionOptions,
): ExprType<UIComponentType> {
    const styleValue = options?.style ? buildAccordionStyle(options.style) : undefined;

    // The inline `Accordion` variant in `component.ts` defines `items` using
    // the recursive `node` parameter for the trigger/content UIComp fields.
    // TS can't prove `AccordionItemType` (typed with `UIComponentType`) is
    // structurally equal to the inline shape, even though they unfold to the
    // same thing — cast at the variant-construction boundary.
    return East.value(variant("Accordion", {
        items: items as never,
        multiple: options?.multiple !== undefined ? some(options.multiple) : none,
        collapsible: options?.collapsible !== undefined ? some(options.collapsible) : none,
        value: options?.value !== undefined ? some(options.value) : none,
        defaultValue: options?.defaultValue !== undefined ? some(options.defaultValue) : none,
        onValueChange: options?.onValueChange ? some(options.onValueChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildAccordionStyle(style: AccordionStyle): ExprType<AccordionStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant as AccordionVariantLiteral, null), AccordionVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        triggerBackground: style.triggerBackground !== undefined ? some(style.triggerBackground) : none,
        triggerHoverBackground: style.triggerHoverBackground !== undefined ? some(style.triggerHoverBackground) : none,
        contentBackground: style.contentBackground !== undefined ? some(style.contentBackground) : none,
    }, AccordionStyleType);
}

// ============================================================================
// Accordion Compound Namespace
// ============================================================================

/**
 * Accordion compound primitive for collapsible content panels.
 *
 * @remarks
 * Use `Accordion.Root(items, options)` for the container and
 * `Accordion.Item(value, trigger, content, options)` for each panel. The
 * `trigger` accepts any UIComponentType — strings coerce to `Text.Root(s)`
 * at the factory boundary.
 */
export const Accordion = {
    /**
     * Creates an Accordion container.
     *
     * @param items - Array of accordion items
     * @param options - Config + state + behaviour + optional `style`
     * @returns An East expression representing the Accordion component
     *
     * @remarks
     * See {@link createAccordionRoot} for full semantics. `multiple` /
     * `collapsible` / `value` / `defaultValue` / `onValueChange` are top-level
     * options; `style` holds visual presets and colour slots.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Accordion, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Accordion.Root([
     *         Accordion.Item("a", "Section A", [Text.Root("A")]),
     *         Accordion.Item("b", "Section B", [Text.Root("B")]),
     *     ], {
     *         multiple: true,
     *         collapsible: true,
     *         style: { variant: "enclosed" },
     *     }),
     * );
     * ```
     */
    Root: createAccordionRoot,
    /**
     * Creates an Accordion item.
     *
     * @param value - Unique identifier for the item
     * @param trigger - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param content - Array of child UI components shown when expanded
     * @param options - Per-item options (`disabled`)
     * @returns An East expression representing the Accordion item
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Accordion, Stack, Text, Badge, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Accordion.Item(
     *         "inputs",
     *         Stack.HStack([Text.Root("Inputs"), Badge.Root("3")]),
     *         [Text.Root("Three inputs are defined…")],
     *     ),
     * );
     * ```
     */
    Item: createAccordionItem,
    /**
     * Helper for creating accordion variant values.
     *
     * @param v - The variant string (`"enclosed"` / `"plain"` / `"subtle"`)
     * @returns An East expression representing the variant
     */
    Variant: AccordionVariant,
    Types: {
        /**
         * The concrete East type for the Accordion container — mirrors the
         * inline `Accordion` variant in `component.ts`.
         *
         * @property items - Array of accordion items
         * @property multiple - Allow multiple items open simultaneously
         * @property collapsible - Allow every item to be closed
         * @property value - Controlled expanded-value list
         * @property defaultValue - Initial expanded-value list (uncontrolled)
         * @property onValueChange - Callback invoked with the new expanded-value list
         * @property style - Visual-presentation sub-struct
         */
        Accordion: AccordionType,
        /**
         * The concrete East type for Accordion item data.
         *
         * @property value - Unique identifier for the item
         * @property trigger - Header/trigger content (UIComp)
         * @property content - Array of child UI components
         * @property disabled - Whether the item is disabled
         */
        Item: AccordionItemType,
        /**
         * Visual-only style struct for Accordion. See {@link AccordionStyleType}.
         */
        Style: AccordionStyleType,
        /**
         * Variant enum for Accordion appearance styles.
         *
         * @property enclosed - Bordered accordion with distinct boundaries
         * @property plain - No visible borders or background
         * @property subtle - Light background styling
         */
        Variant: AccordionVariantType,
    },
} as const;
