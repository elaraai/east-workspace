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
    IntegerType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType, OrientationType } from "../../style.js";
import { IconType } from "../../display/icon/types.js";
import { Text } from "../../typography/text/index.js";
import {
    StepsStyleType,
    StepStatusType,
    StepStatus,
    type StepsStyle,
    type StepStatusLiteral,
} from "./types.js";

// Re-export types
export {
    StepsStyleType,
    StepStatusType,
    StepStatus,
    type StepsStyle,
    type StepStatusLiteral,
} from "./types.js";

// ============================================================================
// StepItemType — standalone mirror of the inline item sub-struct
// ============================================================================

/**
 * Concrete struct mirroring the inline item sub-struct used by the `Steps`
 * variant in `component.ts`.
 *
 * @property title - Rich title (UIComp — strings coerced at the factory)
 * @property description - Optional rich description
 * @property icon - Optional leading icon
 * @property status - Step status (pending / active / completed / error / skipped)
 */
export const StepItemType: StructType<{
    title: UIComponentType,
    description: OptionType<UIComponentType>,
    icon: OptionType<IconType>,
    status: StepStatusType,
}> = StructType({
    title: UIComponentType,
    description: OptionType(UIComponentType),
    icon: OptionType(IconType),
    status: StepStatusType,
});

export type StepItemType = typeof StepItemType;

// ============================================================================
// StepsType — standalone mirror of the inline `Steps` variant
// ============================================================================

export const StepsType: StructType<{
    items: ArrayType<StepItemType>,
    activeIndex: OptionType<IntegerType>,
    style: OptionType<StepsStyleType>,
}> = StructType({
    items: ArrayType(StepItemType),
    activeIndex: OptionType(IntegerType),
    style: OptionType(StepsStyleType),
});

export type StepsType = typeof StepsType;

// ============================================================================
// Steps Item Factory
// ============================================================================

type StepTitleInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `Steps.Item`.
 *
 * @property description - Optional rich description (string coerced to Text.Root)
 * @property icon - Optional leading icon
 */
export interface StepItemOptions {
    description?: StepTitleInput;
    icon?: { prefix: string; name: string } | SubtypeExprOrValue<IconType>;
}

/**
 * Creates a Step item.
 *
 * @param title - String (coerced to `Text.Root(s)`) or UIComponentType
 * @param status - Status literal (`"pending" | "active" | "completed" | "error" | "skipped"`) or expression
 * @param options - Optional description + icon
 * @returns An East expression representing the step item
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Steps, UIComponentType } from "@elaraai/east-ui";
 *
 * const step = Steps.Item("Upload data", "completed", {
 *     description: "Imported 3,200 rows from CSV",
 *     icon: { prefix: "fas", name: "upload" },
 * });
 * ```
 */
function createStepItem(
    title: StepTitleInput,
    status: StepStatusLiteral | SubtypeExprOrValue<StepStatusType>,
    options?: StepItemOptions,
): ExprType<StepItemType> {
    const titleExpr: ExprType<UIComponentType> = typeof title === "string"
        ? Text.Root(title)
        : title as ExprType<UIComponentType>;

    const statusValue = typeof status === "string"
        ? East.value(variant(status as StepStatusLiteral, null), StepStatusType)
        : status as ExprType<StepStatusType>;

    const descriptionValue = options?.description !== undefined
        ? (typeof options.description === "string"
            ? Text.Root(options.description)
            : options.description as ExprType<UIComponentType>)
        : undefined;

    const iconValue = options?.icon && typeof (options.icon as { prefix?: unknown }).prefix === "string"
        ? East.value({
            prefix: (options.icon as { prefix: string }).prefix,
            name: (options.icon as { name: string }).name,
            label: none,
            style: none,
        }, IconType)
        : (options?.icon as SubtypeExprOrValue<IconType> | undefined);

    return East.value({
        title: titleExpr,
        description: descriptionValue ? some(descriptionValue) : none,
        icon: iconValue ? some(iconValue) : none,
        status: statusValue,
    }, StepItemType);
}

// ============================================================================
// Steps Root Factory
// ============================================================================

/**
 * TypeScript options bag for `Steps.Root`.
 *
 * @property activeIndex - Active (current) step index (0-based)
 * @property style - Visual-presentation sub-struct
 */
export interface StepsOptions {
    activeIndex?: SubtypeExprOrValue<IntegerType>;
    style?: StepsStyle;
}

/**
 * Creates a Steps component — an ordered process indicator with per-step
 * status markers.
 *
 * @param items - Array of step items (created with `Steps.Item`)
 * @param options - State + optional `style`
 * @returns An East expression representing the Steps component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Steps, UIComponentType } from "@elaraai/east-ui";
 *
 * const onboarding = East.function([], UIComponentType, _$ =>
 *     Steps.Root([
 *         Steps.Item("Upload data", "completed"),
 *         Steps.Item("Validate rows", "active"),
 *         Steps.Item("Map fields", "pending"),
 *         Steps.Item("Confirm", "pending"),
 *     ], { activeIndex: 1n, style: { orientation: "horizontal" } }),
 * );
 * ```
 */
function createStepsRoot(
    items: SubtypeExprOrValue<ArrayType<StepItemType>>,
    options?: StepsOptions,
): ExprType<UIComponentType> {
    const styleValue = options?.style ? buildStepsStyle(options.style) : undefined;

    return East.value(variant("Steps", {
        items: items as never,
        activeIndex: options?.activeIndex !== undefined ? some(options.activeIndex) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildStepsStyle(style: StepsStyle): ExprType<StepsStyleType> {
    const orientationValue = style.orientation
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation, null), OrientationType)
            : style.orientation)
        : undefined;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        orientation: orientationValue ? some(orientationValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        pendingColor: style.pendingColor !== undefined ? some(style.pendingColor) : none,
        activeColor: style.activeColor !== undefined ? some(style.activeColor) : none,
        completedColor: style.completedColor !== undefined ? some(style.completedColor) : none,
        errorColor: style.errorColor !== undefined ? some(style.errorColor) : none,
        skippedColor: style.skippedColor !== undefined ? some(style.skippedColor) : none,
        connectorColor: style.connectorColor !== undefined ? some(style.connectorColor) : none,
    }, StepsStyleType);
}

/**
 * Steps primitive — ordered process indicator with per-step status.
 *
 * @remarks
 * Use `Steps.Root(items, options)` for the container and
 * `Steps.Item(title, status, options)` for each step.
 */
export const Steps = {
    /**
     * Creates a Steps container.
     *
     * @param items - Array of step items
     * @param options - State + optional `style`
     * @returns An East expression representing the Steps component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Steps, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Steps.Root([
     *         Steps.Item("Upload", "completed"),
     *         Steps.Item("Validate", "active"),
     *         Steps.Item("Confirm", "pending"),
     *     ], { activeIndex: 1n }),
     * );
     * ```
     */
    Root: createStepsRoot,
    /**
     * Creates a Step item.
     *
     * @param title - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param status - Status literal or expression
     * @param options - Optional description + icon
     *
     * @example
     * ```ts
     * Steps.Item("Upload", "completed", { description: "Imported 3,200 rows" });
     * ```
     */
    Item: createStepItem,
    /**
     * Helper — create a StepStatusType value from a string literal.
     */
    Status: StepStatus,
    Types: {
        /**
         * The concrete East type for Steps — mirrors the inline `Steps`
         * variant in `component.ts`.
         */
        Steps: StepsType,
        /**
         * The concrete East type for a Step item.
         */
        Item: StepItemType,
        /**
         * Visual-only style struct for Steps.
         */
        Style: StepsStyleType,
        /**
         * StepStatus variant enum (shared with Timeline).
         */
        Status: StepStatusType,
    },
} as const;
