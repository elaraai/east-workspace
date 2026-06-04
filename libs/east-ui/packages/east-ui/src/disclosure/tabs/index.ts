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
    StringType,
    BooleanType,
    ArrayType,
    FunctionType,
    NullType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { ColorSchemeType, OrientationType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { Text } from "../../typography/text/index.js";
import {
    TabsVariantType,
    TabsVariant,
    TabsJustifyType,
    TabsActivationModeType,
    TabsSizeType,
    TabsStyleType,
    type TabsStyle,
    type TabsOptions,
    type TabsItemOptions,
    type TabsVariantLiteral,
} from "./types.js";

// Re-export types
export {
    TabsVariantType,
    TabsVariant,
    TabsJustifyType,
    TabsActivationModeType,
    TabsSizeType,
    TabsStyleType,
    type TabsVariantLiteral,
    type TabsJustifyLiteral,
    type TabsActivationModeLiteral,
    type TabsSizeLiteral,
    type TabsStyle,
    type TabsOptions,
    type TabsItemOptions,
} from "./types.js";

// ============================================================================
// TabsItemType — standalone mirror of the inline item sub-struct
// ============================================================================

/**
 * Concrete struct mirroring the inline item sub-struct used by the `Tabs`
 * variant in `component.ts`. Renderers reference this for `equalFor` /
 * `ValueTypeOf`.
 *
 * @property value - Unique identifier for this tab
 * @property trigger - Rich trigger (UIComp)
 * @property content - Array of child UI components for the tab panel
 * @property disabled - Whether this tab is disabled
 */
export const TabsItemType: StructType<{
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
 * Type representing the TabsItem structure.
 */
export type TabsItemType = typeof TabsItemType;

// ============================================================================
// TabsType — standalone mirror of the inline `Tabs` variant in component.ts
// ============================================================================

/**
 * Concrete struct mirroring the inline `Tabs` variant in `component.ts`.
 *
 * @property items - Array of tab items
 * @property value - Controlled selected tab value
 * @property defaultValue - Initial selected tab value (uncontrolled)
 * @property onValueChange - Callback invoked with the new selected tab value
 * @property style - Visual-presentation sub-struct
 */
export const TabsType: StructType<{
    items: ArrayType<TabsItemType>,
    value: OptionType<StringType>,
    defaultValue: OptionType<StringType>,
    onValueChange: OptionType<FunctionType<[StringType], NullType>>,
    style: OptionType<TabsStyleType>,
}> = StructType({
    items: ArrayType(TabsItemType),
    value: OptionType(StringType),
    defaultValue: OptionType(StringType),
    onValueChange: OptionType(FunctionType([StringType], NullType)),
    style: OptionType(TabsStyleType),
});

export type TabsType = typeof TabsType;

// ============================================================================
// Tabs Item Factory
// ============================================================================

type TabsTriggerInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * Creates a Tabs item with a rich trigger and content children.
 *
 * @param value - Unique identifier for this tab
 * @param trigger - String (coerced to `Text.Root(s)`) or any UIComponentType
 * @param content - Array of child UI components for the tab panel
 * @param options - Optional per-item configuration (`disabled`)
 * @returns An East expression representing the tabs item
 *
 * @remarks
 * `trigger` is a UIComp — strings coerce to `Text.Root(s)` so the common
 * case stays ergonomic. Rich triggers let callers embed count badges, icons,
 * or two-line labels inline.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Tabs, Stack, Text, Badge, UIComponentType } from "@elaraai/east-ui";
 *
 * const tabsWithBadge = East.function([], UIComponentType, _$ =>
 *     Tabs.Root([
 *         Tabs.Item("inputs", "Inputs", [Text.Root("Three inputs defined.")]),
 *         Tabs.Item(
 *             "results",
 *             Stack.HStack([Text.Root("Results"), Badge.Root("5", { colorPalette: "blue" })], { gap: "2" }),
 *             [Text.Root("Five results computed.")],
 *         ),
 *     ], { defaultValue: "inputs", variant: "line" }),
 * );
 * ```
 */
function createTabsItem(
    value: SubtypeExprOrValue<StringType>,
    trigger: TabsTriggerInput,
    content: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options?: TabsItemOptions,
): ExprType<TabsItemType> {
    const triggerExpr: ExprType<UIComponentType> = typeof trigger === "string"
        ? Text.Root(trigger)
        : trigger as ExprType<UIComponentType>;

    return East.value({
        value,
        trigger: triggerExpr,
        content,
        disabled: options?.disabled !== undefined ? some(options.disabled) : none,
    }, TabsItemType);
}

// ============================================================================
// Tabs Root Factory
// ============================================================================

/**
 * Creates a Tabs component.
 *
 * @param items - Array of tab items (created with `Tabs.Item`)
 * @param options - State + behaviour + visual style fields
 * @returns An East expression representing the Tabs component
 *
 * @remarks
 * `value` / `defaultValue` (state), `onValueChange` (behaviour), and the
 * visual style fields all sit in one flat options bag.
 *
 * @example
 * ```ts
 * import { East, NullType, StringType } from "@elaraai/east";
 * import { Reactive, State, Tabs, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * // Static tabs
 * const tabs = East.function([], UIComponentType, _$ =>
 *     Tabs.Root([
 *         Tabs.Item("overview", "Overview", [Text.Root("Overview.")]),
 *         Tabs.Item("settings", "Settings", [Text.Root("Settings.")]),
 *     ], { defaultValue: "overview", variant: "line" }),
 * );
 *
 * // Reactive tabs via State.bind
 * const reactiveTabs = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const bind = $.let(State.bind([StringType], "active_tab", "a"));
 *         const active = $.let(bind.read());
 *         const onValueChange = $.const(East.function([StringType], NullType, ($, next) => {
 *             $(bind.write(next));
 *         }));
 *         return Tabs.Root([
 *             Tabs.Item("a", "Tab A", [Text.Root("A")]),
 *             Tabs.Item("b", "Tab B", [Text.Root("B")]),
 *         ], { value: active, onValueChange });
 *     })),
 * );
 * ```
 */
function createTabsRoot(
    items: SubtypeExprOrValue<ArrayType<TabsItemType>>,
    options?: TabsOptions,
): ExprType<UIComponentType> {
    const { value, defaultValue, onValueChange, ...visual } = options ?? {};

    const hasVisual = Object.values(visual).some(field => field !== undefined);
    const styleValue = hasVisual ? buildTabsStyle(visual) : undefined;

    // Cast at variant boundary — inline `Tabs` variant in component.ts uses
    // the recursive `node` for item.trigger, structurally identical to
    // `UIComponentType` after unfolding but not provably equal to TS.
    return East.value(variant("Tabs", {
        items: items as never,
        value: value !== undefined ? some(value) : none,
        defaultValue: defaultValue !== undefined ? some(defaultValue) : none,
        onValueChange: onValueChange ? some(onValueChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildTabsStyle(style: TabsStyle): ExprType<TabsStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant as TabsVariantLiteral, null), TabsVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), TabsSizeType)
            : style.size)
        : undefined;

    const orientationValue = style.orientation
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation, null), OrientationType)
            : style.orientation)
        : undefined;

    const activationModeValue = style.activationMode
        ? (typeof style.activationMode === "string"
            ? East.value(variant(style.activationMode, null), TabsActivationModeType)
            : style.activationMode)
        : undefined;

    const justifyValue = style.justify
        ? (typeof style.justify === "string"
            ? East.value(variant(style.justify, null), TabsJustifyType)
            : style.justify)
        : undefined;

    const colorPaletteValue = style.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        orientation: orientationValue ? some(orientationValue) : none,
        activationMode: activationModeValue ? some(activationModeValue) : none,
        fitted: style.fitted !== undefined ? some(style.fitted) : none,
        justify: justifyValue ? some(justifyValue) : none,
        lazyMount: style.lazyMount !== undefined ? some(style.lazyMount) : none,
        unmountOnExit: style.unmountOnExit !== undefined ? some(style.unmountOnExit) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        listBackground: style.listBackground !== undefined ? some(style.listBackground) : none,
        indicatorColor: style.indicatorColor !== undefined ? some(style.indicatorColor) : none,
        activeTriggerColor: style.activeTriggerColor !== undefined ? some(style.activeTriggerColor) : none,
        inactiveTriggerColor: style.inactiveTriggerColor !== undefined ? some(style.inactiveTriggerColor) : none,
        contentBackground: style.contentBackground !== undefined ? some(style.contentBackground) : none,
    }, TabsStyleType);
}

// ============================================================================
// Tabs Compound Namespace
// ============================================================================

/**
 * Tabs compound primitive for tabbed content panels.
 *
 * @remarks
 * Use `Tabs.Root(items, options)` for the container and
 * `Tabs.Item(value, trigger, content, options)` for each tab. The
 * `trigger` accepts any UIComponentType — strings coerce to `Text.Root(s)`.
 */
export const Tabs = {
    /**
     * Creates a Tabs container.
     *
     * @param items - Array of tab items
     * @param options - State + behaviour + visual style fields
     * @returns An East expression representing the Tabs component
     *
     * @remarks
     * See {@link createTabsRoot} for full semantics. `value` / `defaultValue`
     * / `onValueChange` sit alongside the visual style fields (presets +
     * colour slots) in one flat bag.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Tabs, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Tabs.Root([
     *         Tabs.Item("a", "Tab A", [Text.Root("A")]),
     *         Tabs.Item("b", "Tab B", [Text.Root("B")]),
     *     ], { defaultValue: "a", variant: "line" }),
     * );
     * ```
     */
    Root: createTabsRoot,
    /**
     * Creates a Tabs item.
     *
     * @param value - Unique identifier for the tab
     * @param trigger - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param content - Array of child UI components for the tab panel
     * @param options - Per-item options (`disabled`)
     * @returns An East expression representing the Tabs item
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Tabs, Stack, Text, Badge, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Tabs.Item(
     *         "results",
     *         Stack.HStack([Text.Root("Results"), Badge.Root("5")]),
     *         [Text.Root("Five results computed.")],
     *     ),
     * );
     * ```
     */
    Item: createTabsItem,
    /**
     * Helper for creating tabs variant values.
     *
     * @param v - The variant string
     * @returns An East expression representing the variant
     */
    Variant: TabsVariant,
    Types: {
        /**
         * The concrete East type for the Tabs container — mirrors the
         * inline `Tabs` variant in `component.ts`.
         */
        Tabs: TabsType,
        /**
         * The concrete East type for a Tabs item.
         */
        Item: TabsItemType,
        /**
         * Visual-only style struct for Tabs. See {@link TabsStyleType}.
         */
        Style: TabsStyleType,
        /**
         * Variant enum for Tabs appearance styles.
         */
        Variant: TabsVariantType,
        /**
         * Size enum for Tabs (sm / md / lg).
         */
        Size: TabsSizeType,
        /**
         * Justify enum for tab list alignment.
         */
        Justify: TabsJustifyType,
        /**
         * Activation mode enum for keyboard navigation.
         */
        ActivationMode: TabsActivationModeType,
    },
} as const;
