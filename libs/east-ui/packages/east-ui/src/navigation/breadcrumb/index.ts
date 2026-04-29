/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    variant,
} from "@elaraai/east";

import { ColorSchemeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { BreadcrumbVariantType, BreadcrumbSizeType, BreadcrumbItemType, BreadcrumbRootType, BreadcrumbStyleType, type BreadcrumbStyle } from "./types.js";

// Re-export types
export { BreadcrumbVariantType, BreadcrumbSizeType, BreadcrumbItemType, BreadcrumbRootType, BreadcrumbStyleType, type BreadcrumbStyle, type BreadcrumbSizeLiteral } from "./types.js";


// ============================================================================
// Breadcrumb Root Function
// ============================================================================

/**
 * Creates a Breadcrumb component with items and optional styling.
 *
 * @param items - Array of breadcrumb item configurations
 * @param style - Optional styling configuration
 * @returns An East expression representing the breadcrumb component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Breadcrumb, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Breadcrumb.Root([
 *         { label: "Home", current: variant("none", null), onClick: variant("some", myClickFn) },
 *         { label: "Products", current: variant("none", null), onClick: variant("some", myClickFn) },
 *         { label: "Widget", current: variant("some", true), onClick: variant("none", null) },
 *     ], {
 *         variant: "plain",
 *         size: "md",
 *     });
 * });
 * ```
 */
function createBreadcrumb(
    items: SubtypeExprOrValue<ArrayType<BreadcrumbItemType>>,
    style?: BreadcrumbStyle
): ExprType<UIComponentType> {
    const variantValue = style?.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), BreadcrumbVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), BreadcrumbSizeType)
            : style.size)
        : undefined;

    const colorPaletteValue = style?.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const hasStyle = variantValue !== undefined || sizeValue !== undefined || colorPaletteValue !== undefined;

    const styleValue = hasStyle
        ? East.value({
            variant: variantValue ? variant("some", variantValue) : variant("none", null),
            size: sizeValue ? variant("some", sizeValue) : variant("none", null),
            colorPalette: colorPaletteValue ? variant("some", colorPaletteValue) : variant("none", null),
        }, BreadcrumbStyleType)
        : undefined;

    return East.value(variant("Breadcrumb", {
        items: items,
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

// ============================================================================
// Breadcrumb Compound Component
// ============================================================================

/**
 * Breadcrumb component for navigation hierarchy display.
 *
 * @remarks
 * Use `Breadcrumb.Root(items, style)` to create a breadcrumb navigation.
 */
export const Breadcrumb = {
    /**
     * Creates a Breadcrumb component with items and optional styling.
     *
     * @param items - Array of breadcrumb item configurations
     * @param style - Optional styling configuration
     * @returns An East expression representing the breadcrumb component
     *
     * @example
     * ```ts
     * import { East, variant } from "@elaraai/east";
     * import { Breadcrumb, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Breadcrumb.Root([
     *         { label: "Home", current: variant("none", null), onClick: variant("some", myClickFn) },
     *         { label: "Products", current: variant("none", null), onClick: variant("some", myClickFn) },
     *         { label: "Widget", current: variant("some", true), onClick: variant("none", null) },
     *     ], {
     *         variant: "plain",
     *         size: "md",
     *     });
     * });
     * ```
     */
    Root: createBreadcrumb,
    Types: {
        /**
         * East StructType for Breadcrumb component data.
         *
         * @remarks
         * Visual fields (variant, size, colorPalette) live in `style` per
         * 0.
         *
         * @property items - Array of breadcrumb items
         * @property style - Optional visual-only style sub-struct (see `Style`)
         */
        Root: BreadcrumbRootType,
        /**
         * East StructType holding every visual field for a Breadcrumb.
         *
         * @remarks
         * Mirror of `BreadcrumbStyleType` from `./types.js`.
         *
         * @property variant - Visual variant (underline or plain)
         * @property size - Size of the breadcrumb (sm, md, lg)
         * @property colorPalette - Colour scheme for the breadcrumb
         */
        Style: BreadcrumbStyleType,
        /**
         * Type for a single breadcrumb item.
         */
        Item: BreadcrumbItemType,
        /**
         * Variant type for breadcrumb visual style.
         */
        Variant: BreadcrumbVariantType,
        Size: BreadcrumbSizeType,
    },
} as const;
