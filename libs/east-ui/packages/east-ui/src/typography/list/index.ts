/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    type ExprType,
    East,
    ArrayType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { OverflowType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import { IconType } from "../../display/icon/types.js";
import {
    ListVariantType,
    ListMarkerType,
    ListVisualStyleType,
    type ListStyle,
    type ListMarkerLiteral,
} from "./types.js";
import { Text } from "../text/index.js";

// Re-export types
export {
    ListVariantType,
    ListMarkerType,
    ListVisualStyleType,
    type ListStyle,
} from "./types.js";

/**
 * Concrete struct type mirroring the inline `List` variant arm in
 * `component.ts`. Renderers use this for `equalFor` / `ValueTypeOf`.
 */
export const ListType: StructType<{
    items: ArrayType<UIComponentType>,
    style: OptionType<ListVisualStyleType>,
}> = StructType({
    items: ArrayType(UIComponentType),
    style: OptionType(ListVisualStyleType),
});

export type ListType = typeof ListType;

// ============================================================================
// List Component
// ============================================================================

type ListItemInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * Creates a List component with rich item children.
 *
 * @param items - Array of items. Plain strings are coerced to `Text.Root(s)`
 *                at the factory boundary; any `UIComponentType` expression
 *                is forwarded as-is.
 * @param style - Optional visual-style configuration.
 * @returns An East expression representing the list component.
 */
function createList(
    items:
        | ListItemInput[]
        | SubtypeExprOrValue<ArrayType<UIComponentType>>,
    style?: ListStyle,
): ExprType<UIComponentType> {
    const itemsValue = Array.isArray(items)
        ? items.map(coerceItem)
        : items;

    const styleValue = style ? buildListVisualStyle(style) : undefined;

    return East.value(variant("List", {
        items: itemsValue,
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

function coerceItem(item: ListItemInput): ExprType<UIComponentType> {
    if (typeof item === "string") {
        return Text.Root(item);
    }
    return item as ExprType<UIComponentType>;
}

function buildListVisualStyle(style: ListStyle): ExprType<ListVisualStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), ListVariantType)
            : style.variant)
        : undefined;

    const markerValue = (() => {
        if (style.markerIcon !== undefined) {
            return East.value(
                variant("icon", style.markerIcon as SubtypeExprOrValue<IconType>),
                ListMarkerType,
            );
        }
        if (style.marker !== undefined) {
            if (typeof style.marker === "string") {
                const literal = style.marker as ListMarkerLiteral;
                return East.value(variant(literal, null), ListMarkerType);
            }
            return style.marker;
        }
        return undefined;
    })();

    const overflowValue = style.overflow
        ? (typeof style.overflow === "string"
            ? East.value(variant(style.overflow, null), OverflowType)
            : style.overflow)
        : undefined;

    const overflowXValue = style.overflowX
        ? (typeof style.overflowX === "string"
            ? East.value(variant(style.overflowX, null), OverflowType)
            : style.overflowX)
        : undefined;

    const overflowYValue = style.overflowY
        ? (typeof style.overflowY === "string"
            ? East.value(variant(style.overflowY, null), OverflowType)
            : style.overflowY)
        : undefined;

    const paddingValue = style.padding
        ? (typeof style.padding === "string"
            ? East.value({
                top: some(style.padding),
                right: some(style.padding),
                bottom: some(style.padding),
                left: some(style.padding),
            }, PaddingType)
            : style.padding)
        : undefined;

    const marginValue = style.margin
        ? (typeof style.margin === "string"
            ? East.value({
                top: some(style.margin),
                right: some(style.margin),
                bottom: some(style.margin),
                left: some(style.margin),
            }, MarginType)
            : style.margin)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        marker: markerValue ? some(markerValue) : none,
        colorPalette: style.colorPalette ? some(style.colorPalette) : none,
        gap: style.gap ? some(style.gap) : none,
        overflow: overflowValue ? some(overflowValue) : none,
        overflowX: overflowXValue ? some(overflowXValue) : none,
        overflowY: overflowYValue ? some(overflowYValue) : none,
        width: style.width ? some(style.width) : none,
        height: style.height ? some(style.height) : none,
        minWidth: style.minWidth ? some(style.minWidth) : none,
        minHeight: style.minHeight ? some(style.minHeight) : none,
        maxWidth: style.maxWidth ? some(style.maxWidth) : none,
        maxHeight: style.maxHeight ? some(style.maxHeight) : none,
        padding: paddingValue ? some(paddingValue) : none,
        margin: marginValue ? some(marginValue) : none,
        opacity: style.opacity !== undefined ? some(style.opacity) : none,
        color: style.color ? some(style.color) : none,
        markerColor: style.markerColor ? some(style.markerColor) : none,
    }, ListVisualStyleType);
}

/**
 * List component for rendering ordered / unordered lists with rich items.
 *
 * @remarks
 * `items` is `ArrayType(UIComponentType)` — each item can be any east-ui
 * primitive (text, icons, HStacks…). Strings passed at the factory boundary
 * are coerced to `Text.Root(s)` for ergonomics. All visual fields live inside
 * the `style` sub-struct per the `{ content, style }` type-shape convention.
 *
 * `marker: "check"` and `marker: "dash"` render real SVG glyphs with
 * `role="img"` + `aria-label` so screen readers announce them — never
 * CSS-only `::before` characters (a11y contract).
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { List, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return List.Root([
 *         "Max 5 consecutive shifts — 412 staff, clear",
 *         "SLA: 92% on-time (27 misses)",
 *         "Stale data: 3 feeds > 24h old",
 *     ], { marker: "check", markerColor: "fg.success" });
 * });
 * ```
 */
export const List = {
    Root: createList,
    Types: {
        List: ListType,
        Variant: ListVariantType,
        Marker: ListMarkerType,
        Style: ListVisualStyleType,
    },
} as const;
