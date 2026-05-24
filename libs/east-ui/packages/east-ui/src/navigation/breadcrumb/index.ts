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
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { BreadcrumbItemType, BreadcrumbRootType, BreadcrumbStyleType, type BreadcrumbStyle } from "./types.js";

// Re-export types
export { BreadcrumbItemType, BreadcrumbRootType, BreadcrumbStyleType, type BreadcrumbStyle } from "./types.js";


// ============================================================================
// Breadcrumb Root Function
// ============================================================================

/**
 * Creates a Breadcrumb component with items and an optional run anchor.
 *
 * @param items - Array of breadcrumb item configurations
 * @param style - Optional styling configuration (`runAnchor`)
 * @returns An East expression representing the breadcrumb component
 *
 * @remarks
 * Fixed mono style per the bsys Breadcrumb spec: brand-d links, a mono
 * `/` separator in ink-4, current page non-link in ink weight 600. Pass
 * `runAnchor` to pin the crumb to a specific run (vertical rule + `run #N`).
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { Breadcrumb, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     return Breadcrumb.Root([
 *         { label: "SE region", current: variant("none", null), onClick: variant("none", null) },
 *         { label: "wk of Sep 16", current: variant("none", null), onClick: variant("none", null) },
 *         { label: "Roster builder", current: variant("some", true), onClick: variant("none", null) },
 *     ], { runAnchor: "run #42" });
 * });
 * ```
 */
function createBreadcrumb(
    items: SubtypeExprOrValue<ArrayType<BreadcrumbItemType>>,
    style?: BreadcrumbStyle
): ExprType<UIComponentType> {
    const styleValue = style?.runAnchor !== undefined
        ? East.value({
            runAnchor: some(style.runAnchor),
        }, BreadcrumbStyleType)
        : undefined;

    return East.value(variant("Breadcrumb", {
        items: items,
        style: styleValue ? some(styleValue) : none,
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
     * Creates a Breadcrumb component with items and an optional run anchor.
     *
     * @param items - Array of breadcrumb item configurations
     * @param style - Optional styling configuration (`runAnchor`)
     * @returns An East expression representing the breadcrumb component
     *
     * @example
     * ```ts
     * import { East, variant } from "@elaraai/east";
     * import { Breadcrumb, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, (_$) => {
     *     return Breadcrumb.Root([
     *         { label: "SE region", current: variant("none", null), onClick: variant("none", null) },
     *         { label: "Roster builder", current: variant("some", true), onClick: variant("none", null) },
     *     ], { runAnchor: "run #42" });
     * });
     * ```
     */
    Root: createBreadcrumb,
    Types: {
        /**
         * East StructType for Breadcrumb component data.
         *
         * @property items - Array of breadcrumb items
         * @property style - Optional visual-only style sub-struct (see `Style`)
         */
        Root: BreadcrumbRootType,
        /**
         * East StructType holding the visual fields for a Breadcrumb.
         *
         * @property runAnchor - Optional trailing run anchor text
         */
        Style: BreadcrumbStyleType,
        /**
         * Type for a single breadcrumb item.
         */
        Item: BreadcrumbItemType,
    },
} as const;
