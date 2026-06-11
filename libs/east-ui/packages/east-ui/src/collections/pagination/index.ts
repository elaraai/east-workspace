/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    PaginationSizeType,
    PaginationVariantType,
    PaginationStyleType,
    PaginationType,
    type PaginationOptions,
} from "./types.js";

export {
    PaginationSizeType,
    PaginationVariantType,
    PaginationStyleType,
    PaginationType,
    type PaginationOptions,
} from "./types.js";

// ============================================================================
// Helpers
// ============================================================================

function buildPaginationStyle(options: PaginationOptions | undefined): ExprType<PaginationStyleType> | undefined {
    if (options === undefined) return undefined;
    const hasAny = options.size !== undefined
        || options.variant !== undefined
        || options.color !== undefined
        || options.background !== undefined
        || options.activeBackground !== undefined
        || options.activeColor !== undefined
        || options.siblings !== undefined
        || options.boundaries !== undefined;
    if (!hasAny) return undefined;

    const sizeValue = options.size !== undefined
        ? (typeof options.size === "string"
            ? East.value(variant(options.size, null), PaginationSizeType)
            : options.size)
        : undefined;

    const variantValue = options.variant !== undefined
        ? (typeof options.variant === "string"
            ? East.value(variant(options.variant, null), PaginationVariantType)
            : options.variant)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        variant: variantValue ? some(variantValue) : none,
        color: options.color !== undefined ? some(options.color) : none,
        background: options.background !== undefined ? some(options.background) : none,
        activeBackground: options.activeBackground !== undefined ? some(options.activeBackground) : none,
        activeColor: options.activeColor !== undefined ? some(options.activeColor) : none,
        siblings: options.siblings !== undefined ? some(options.siblings) : none,
        boundaries: options.boundaries !== undefined ? some(options.boundaries) : none,
    }, PaginationStyleType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a Pagination component value — a standalone page-navigation
 * control.
 *
 * @param options - Required `page` / `pageSize` / `count` / `onPageChange`,
 *   optional visual style fields
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Also consumed internally by `Table` (the Table renderer composes a
 * Pagination beneath the table body when `Table.pagination` is set) and
 * by other paged collections (BarStrip, etc.). The primitive is
 * standalone so consumers can place it anywhere.
 *
 * @example
 * ```ts
 * import { East, IntegerType, NullType } from "@elaraai/east";
 * import { Pagination, Reactive, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     return Reactive.Root(East.function([], UIComponentType, $ => {
 *         $.if(State.has("page").not(), $ => {
 *             $(State.write([IntegerType], "page", 0n));
 *         });
 *         const page = $.let(State.read([IntegerType], "page"), IntegerType);
 *         const onChange = $.const(East.function([IntegerType], NullType, ($, next) => {
 *             $(State.write([IntegerType], "page", next));
 *         }));
 *         return Pagination.Root({ page, pageSize: 20n, count: 500n, onPageChange: onChange, size: "md" });
 *     }));
 * });
 * ```
 */
function createPagination(
    options: PaginationOptions,
): ExprType<UIComponentType> {
    const { page, pageSize, count, onPageChange } = options;
    const styleValue = buildPaginationStyle(options);

    return East.value(variant("Pagination", {
        page,
        pageSize,
        count,
        onPageChange,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// Namespace Export
// ============================================================================

interface PaginationNamespace {
    Root: typeof createPagination;
    Types: {
        Pagination: typeof PaginationType;
        Style: typeof PaginationStyleType;
        Size: typeof PaginationSizeType;
        Variant: typeof PaginationVariantType;
    };
}

/**
 * Pagination — standalone page navigation primitive.
 *
 * @remarks
 * Use `Pagination.Root({ page, pageSize, count, onPageChange, ... })`.
 * Consumed by Table internally and usable standalone beneath paged
 * collections (BarStrip, etc.).
 */
export const Pagination: PaginationNamespace = {
    /**
     * Creates a Pagination component value.
     *
     * @param options - Required `page` / `pageSize` / `count` / `onPageChange`,
     *   optional visual style (size / variant / colour slots / siblings / boundaries)
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East, IntegerType, NullType } from "@elaraai/east";
     * import { Pagination, Reactive, State, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, (_$) => {
     *     return Reactive.Root(East.function([], UIComponentType, $ => {
     *         $.if(State.has("page").not(), $ => {
     *             $(State.write([IntegerType], "page", 0n));
     *         });
     *         const page = $.let(State.read([IntegerType], "page"), IntegerType);
     *         const onChange = $.const(East.function([IntegerType], NullType, ($, next) => {
     *             $(State.write([IntegerType], "page", next));
     *         }));
     *         return Pagination.Root({ page, pageSize: 20n, count: 500n, onPageChange: onChange, size: "md", variant: "outline" });
     *     }));
     * });
     * ```
     */
    Root: createPagination,
    Types: {
        /**
         * Standalone East StructType mirror of the inline `Pagination`
         * variant in `component.ts`.
         *
         * @remarks
         * Main carries content / behaviour; `style` carries visual
         * fields only (per 0).
         *
         * @property page - Current 0-based page index
         * @property pageSize - Number of items per page
         * @property count - Total item count
         * @property onPageChange - Callback fired with the new page index
         * @property style - Optional visual style sub-struct
         */
        Pagination: PaginationType,
        /**
         * East StructType holding every visual field for a Pagination.
         *
         * @remarks
         * Visual-only. Content and behaviour live on the main
         * struct.
         *
         * @property size - Size preset (sm / md / lg)
         * @property variant - Visual variant (outline / subtle)
         * @property color - Text-colour override for inactive triggers
         * @property background - Background override for inactive triggers
         * @property activeBackground - Background override for the active trigger
         * @property activeColor - Text-colour override for the active trigger
         * @property siblings - Sibling-page triggers shown around the current page
         * @property boundaries - Boundary-page triggers shown at start/end
         */
        Style: PaginationStyleType,
        /**
         * East VariantType for the Pagination size preset.
         *
         * @property sm - Small (28px tall triggers)
         * @property md - Medium (36px tall triggers — default)
         * @property lg - Large (44px tall triggers)
         */
        Size: PaginationSizeType,
        /**
         * East VariantType for the Pagination visual variant.
         *
         * @property outline - Outlined button treatment
         * @property subtle - Subtle-background treatment (default)
         */
        Variant: PaginationVariantType,
    },
};
