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
    ArrayType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { OrientationType } from "../../style.js";
import {
    DataListVariantType,
    DataListSizeType,
    DataListStyleType,
    type DataListStyle,
} from "./types.js";
import { UIComponentType } from "../../component.js";

export {
    DataListVariantType,
    DataListVariant,
    DataListSizeType,
    DataListStyleType,
    type DataListSizeLiteral,
    type DataListVariantLiteral,
    type DataListStyle,
} from "./types.js";

// ============================================================================
// DataList Item Type
// ============================================================================

/**
 * East StructType for a DataList item — a single label/value pair.
 *
 * @remarks
 * Each item in a DataList is a `{ label, value }` struct. `label` is a
 * plain string (the term); `value` is any `UIComponentType` (the
 * definition).
 *
 * @property label - The term / label for this item
 * @property value - The definition / value for this item (UIComponent)
 */
export const DataListItemType = StructType({
    label: StringType,
    value: UIComponentType,
});

/** Type alias for the DataList item struct. */
export type DataListItemType = typeof DataListItemType;

// ============================================================================
// DataList Root Type — standalone mirror of the inline Collections variant
// ============================================================================

/**
 * East StructType for a DataList value — the serialisable IR shape.
 *
 * @remarks
 * Mirrors the inline `DataList` variant in `component.ts`. Main struct
 * carries only `items` (content) and a single `style` sub-struct per
 * the type-shape convention.
 *
 * @property items - Array of DataList items (label + value)
 * @property style - Optional visual style sub-struct
 */
export const DataListRootType = StructType({
    items: ArrayType(DataListItemType),
    style: OptionType(DataListStyleType),
});

/** Type alias for the DataList root struct. */
export type DataListRootType = typeof DataListRootType;

// ============================================================================
// DataList factory
// ============================================================================

/**
 * Internal — wraps a flat `DataListStyle` options bag into the nested
 * `DataListStyleType` struct expected by the IR.
 *
 * @remarks
 * Returns `undefined` when every style field is absent so the caller
 * can emit `none` for the outer `style: OptionType(DataListStyleType)`.
 */
function buildDataListStyle(style: DataListStyle | undefined): ExprType<DataListStyleType> | undefined {
    if (style === undefined) return undefined;
    const hasAny = style.orientation !== undefined
        || style.size !== undefined
        || style.variant !== undefined
        || style.background !== undefined
        || style.borderColor !== undefined
        || style.labelColor !== undefined
        || style.valueColor !== undefined;
    if (!hasAny) return undefined;

    const orientationValue = style.orientation !== undefined
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation, null), OrientationType)
            : style.orientation)
        : undefined;
    const sizeValue = style.size !== undefined
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), DataListSizeType)
            : style.size)
        : undefined;
    const variantValue = style.variant !== undefined
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), DataListVariantType)
            : style.variant)
        : undefined;

    return East.value({
        orientation: orientationValue ? some(orientationValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        variant: variantValue ? some(variantValue) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        labelColor: style.labelColor !== undefined ? some(style.labelColor) : none,
        valueColor: style.valueColor !== undefined ? some(style.valueColor) : none,
    }, DataListStyleType);
}

/**
 * Creates a DataList component value — a list of label/value pairs
 * (HTML `<dl>` description-list equivalent).
 *
 * @param items - Array of DataList items (each `{ label, value }`)
 * @param style - Optional visual style fields (see {@link DataListStyle})
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Style fields are flat at the call-site for ergonomics but internally
 * nest into `style: OptionType(DataListStyleType)` per the east-ui
 * main/style type-shape convention. Content lives on the main struct;
 * visual presentation lives inside `style`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { DataList, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return DataList.Root([
 *         { label: "Status", value: Text.Root("Active") },
 *         { label: "Created", value: Text.Root("Jan 1, 2024") },
 *     ], {
 *         orientation: "horizontal",
 *         variant: "bold",
 *     });
 * });
 * ```
 */
function DataListRoot(
    items: SubtypeExprOrValue<ArrayType<DataListItemType>>,
    style?: DataListStyle,
): ExprType<UIComponentType>  {
    const styleValue = buildDataListStyle(style);
    return East.value(variant("DataList", {
        items: East.value(items, ArrayType(DataListItemType)),
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// DataList Compound Component
// ============================================================================

interface DataListNamespace {
    Root: typeof DataListRoot;
    Types: {
        Root: typeof DataListRootType;
        Item: typeof DataListItemType;
        Style: typeof DataListStyleType;
        Variant: typeof DataListVariantType;
        Size: typeof DataListSizeType;
    };
}

/**
 * DataList — description-list compound primitive for rendering
 * structured label/value metadata.
 *
 * @remarks
 * Use `DataList.Root(items, { ...style })`. Items are plain
 * `{ label, value }` struct literals at the factory boundary;
 * `value` accepts any `UIComponentType` (strings via `Text.Root`).
 */
export const DataList: DataListNamespace = {
    /**
     * Creates a DataList component value.
     *
     * @param items - Array of DataList items (label + value)
     * @param style - Optional visual style fields
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { DataList, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return DataList.Root([
     *         { label: "Name", value: Text.Root("John Doe") },
     *         { label: "Email", value: Text.Root("john@example.com") },
     *         { label: "Role", value: Text.Root("Administrator") },
     *     ], {
     *         orientation: "horizontal",
     *         labelColor: "fg.muted",
     *     });
     * });
     * ```
     */
    Root: DataListRoot,
    Types: {
        /**
         * East StructType for a DataList value — the serialisable IR
         * shape (mirrors the inline `DataList` variant in
         * `component.ts`).
         *
         * @property items - Array of DataList items
         * @property style - Optional visual style sub-struct
         */
        Root: DataListRootType,
        /**
         * East StructType for a single DataList item.
         *
         * @property label - The term / label for this item
         * @property value - The definition / value (UIComponent)
         */
        Item: DataListItemType,
        /**
         * East StructType holding every visual field for a DataList.
         *
         * @remarks
         * Mirror of `DataListStyleType` from `./types.js`. Covers the
         * layout preset (`orientation`), size / variant presets, and
         * four colour slots (`background`, `borderColor`, `labelColor`,
         * `valueColor`).
         *
         * @property orientation - Layout direction (horizontal / vertical)
         * @property size - Size of the data list (sm / md / lg)
         * @property variant - Visual variant (subtle / bold)
         * @property background - Explicit container background colour override
         * @property borderColor - Explicit container border colour override
         * @property labelColor - Explicit label colour override
         * @property valueColor - Explicit value colour override
         */
        Style: DataListStyleType,
        /**
         * Variant type for DataList visual style.
         *
         * @property subtle - Light / subtle styling
         * @property bold - Bold / emphasized styling
         */
        Variant: DataListVariantType,
        /**
         * Size options for DataList.
         *
         * @remarks
         * Chakra UI DataList supports sm / md / lg.
         *
         * @property sm - Small
         * @property md - Medium (default)
         * @property lg - Large
         */
        Size: DataListSizeType,
    },
};
