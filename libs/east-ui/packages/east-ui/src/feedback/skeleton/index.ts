/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    IntegerType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    SkeletonType,
    SkeletonShapeType,
    SkeletonStyleType,
    type SkeletonShapeLiteral,
    type SkeletonStyle,
} from "./types.js";

// Re-export types
export {
    SkeletonType,
    SkeletonShapeType,
    SkeletonStyleType,
    type SkeletonShapeLiteral,
    type SkeletonStyle,
} from "./types.js";

// ============================================================================
// Skeleton Factory
// ============================================================================

/**
 * TypeScript options bag for `Skeleton.Root`.
 *
 * @property lines - Number of text lines (only used when `shape === "text"`)
 * @property fontSize - Text line font-size (only used when `shape === "text"`)
 * @property count - Repeat the skeleton `count` times (wrapped in a VStack)
 * @property style - Optional visual-only style
 */
export interface SkeletonOptions {
    /** Number of text lines (only used when `shape === "text"`) */
    lines?: SubtypeExprOrValue<IntegerType>;
    /** Text line font-size (only used when `shape === "text"`) */
    fontSize?: SubtypeExprOrValue<StringType>;
    /** Repeat the skeleton `count` times (wrapped in a VStack) */
    count?: SubtypeExprOrValue<IntegerType>;
    /** Optional visual-only style */
    style?: SkeletonStyle;
}

/**
 * Creates a Skeleton placeholder.
 *
 * @param shape - Visual shape — "text" / "rect" / "circle"
 * @param options - Optional `lines` / `fontSize` / `count` / `style`
 * @returns An East expression representing the Skeleton component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Skeleton, UIComponentType } from "@elaraai/east-ui";
 *
 * const loading = East.function([], UIComponentType, _$ =>
 *     Skeleton.Root("text", { lines: 3n }),
 * );
 * ```
 */
function createSkeletonRoot(
    shape: SkeletonShapeLiteral | SubtypeExprOrValue<SkeletonShapeType>,
    options?: SkeletonOptions,
): ExprType<UIComponentType> {
    const shapeValue = typeof shape === "string"
        ? East.value(variant(shape, null), SkeletonShapeType)
        : shape as ExprType<SkeletonShapeType>;

    const styleValue = options?.style ? buildSkeletonStyle(options.style) : undefined;

    return East.value(variant("Skeleton", {
        shape: shapeValue,
        lines: options?.lines !== undefined ? some(options.lines) : none,
        fontSize: options?.fontSize !== undefined ? some(options.fontSize) : none,
        count: options?.count !== undefined ? some(options.count) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildSkeletonStyle(style: SkeletonStyle): ExprType<SkeletonStyleType> {
    return East.value({
        width: style.width !== undefined ? some(style.width) : none,
        height: style.height !== undefined ? some(style.height) : none,
        background: style.background !== undefined ? some(style.background) : none,
        shimmerColor: style.shimmerColor !== undefined ? some(style.shimmerColor) : none,
    }, SkeletonStyleType);
}

/**
 * Skeleton primitive — shape-preserving loading placeholder.
 *
 * @remarks
 * Prefer over `Spinner` when the skeleton shape can mimic the content that's
 * loading (table rows, card body, avatar). The renderer dispatches on `shape`.
 */
export const Skeleton = {
    /**
     * Creates a Skeleton.
     *
     * @param shape - "text" / "rect" / "circle"
     * @param options - Optional `lines` / `fontSize` / `count` / `style`
     *
     * @example
     * ```ts
     * Skeleton.Root("rect", { style: { width: "100%", height: "120px" } });
     * ```
     */
    Root: createSkeletonRoot,
    Types: {
        /**
         * East StructType for a Skeleton value — the serialisable IR shape.
         *
         * @remarks
         * Mirror of `SkeletonType` from `./types.js`. Exposed on the
         * namespace so consumers can reference the IR type via
         * `Skeleton.Types.Skeleton` without reaching into module internals.
         *
         * @property shape - Visual shape (text / rect / circle)
         * @property lines - Number of text lines (only meaningful when `shape === "text"`)
         * @property fontSize - Text line font-size (only meaningful when `shape === "text"`)
         * @property count - Repeat the skeleton `count` times (wrapped in a VStack)
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Skeleton: SkeletonType,
        /**
         * East StructType holding every visual field for a Skeleton.
         *
         * @remarks
         * Mirror of `SkeletonStyleType` from `./types.js`. Dimensions
         * (width/height) and the two colour slots (base + shimmer
         * highlight) live here per §0.10.
         *
         * @property width - Skeleton width (CSS length)
         * @property height - Skeleton height (CSS length)
         * @property background - Base colour
         * @property shimmerColor - Shimmer animation highlight colour
         */
        Style: SkeletonStyleType,
        /**
         * Skeleton shape variant — determines which underlying Chakra
         * primitive is used by the renderer.
         *
         * @remarks
         * Mirror of `SkeletonShapeType` from `./types.js`.
         *
         * @property text - Horizontal lines (paragraphs of text)
         * @property rect - Rectangle (images / banner blocks / buttons)
         * @property circle - Circle (avatars)
         */
        Shape: SkeletonShapeType,
    },
} as const;
