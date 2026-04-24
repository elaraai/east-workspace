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
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType } from "../../style.js";
import { IconType } from "../../display/icon/types.js";
import { Text } from "../../typography/text/index.js";
import {
    StatusValueType,
    StatusStyleType,
    type StatusValueLiteral,
    type StatusStyle,
} from "./types.js";

// Re-export types
export {
    StatusValueType,
    StatusStyleType,
    type StatusValueLiteral,
    type StatusStyle,
} from "./types.js";

// ============================================================================
// StatusType — standalone mirror of the inline `Status` variant
// ============================================================================

/**
 * Standalone mirror of the inline `Status` variant in `component.ts`.
 * Used by renderers for `equalFor` memoization.
 *
 * @property value - Semantic classification (success / warning / danger / info / neutral)
 * @property label - Rich label node
 * @property icon - Paired or override Font Awesome icon
 * @property pulsing - Animate the indicator dot
 * @property showIcon - Whether to render the paired icon (default true)
 * @property style - Optional visual-only style
 */
export const StatusType: StructType<{
    value: StatusValueType,
    label: UIComponentType,
    icon: OptionType<IconType>,
    pulsing: OptionType<BooleanType>,
    showIcon: OptionType<BooleanType>,
    style: OptionType<StatusStyleType>,
}> = StructType({
    value: StatusValueType,
    label: UIComponentType,
    icon: OptionType(IconType),
    pulsing: OptionType(BooleanType),
    showIcon: OptionType(BooleanType),
    style: OptionType(StatusStyleType),
});

export type StatusType = typeof StatusType;

// ============================================================================
// §0.3 Paired-icon map
// ============================================================================

const PAIRED_ICONS: Record<StatusValueLiteral, { prefix: "fas"; name: string }> = {
    success: { prefix: "fas", name: "circle-check" },
    warning: { prefix: "fas", name: "triangle-exclamation" },
    danger: { prefix: "fas", name: "circle-xmark" },
    info: { prefix: "fas", name: "circle-info" },
    neutral: { prefix: "fas", name: "circle" },
};

// ============================================================================
// Status Root Factory
// ============================================================================

type StatusInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `Status.Root`.
 *
 * @property value - Semantic classification — defaults to `"neutral"` if omitted
 * @property icon - Explicit icon override (skips paired-icon default)
 * @property pulsing - Animate the indicator dot
 * @property showIcon - Whether to show the paired icon (default true)
 * @property style - Optional visual-only style
 */
export interface StatusOptions {
    /** Semantic classification — defaults to `"neutral"` if omitted */
    value?: StatusValueLiteral | SubtypeExprOrValue<StatusValueType>;
    /** Explicit icon override (skips paired-icon default) */
    icon?: { prefix: string; name: string } | SubtypeExprOrValue<IconType>;
    /** Animate the indicator dot */
    pulsing?: SubtypeExprOrValue<BooleanType>;
    /** Whether to show the paired icon (default true) */
    showIcon?: SubtypeExprOrValue<BooleanType>;
    /** Optional visual-only style */
    style?: StatusStyle;
}

/**
 * Creates a Status chip with a semantic classification and a paired icon per §0.3.
 *
 * @param label - String (coerced to `Text.Root(s)`) or UIComponentType
 * @param options - Optional `value` / `icon` / `pulsing` / `showIcon` / `style`
 * @returns An East expression representing the Status component
 *
 * @remarks
 * The IR factory auto-injects the paired icon corresponding to `value` unless
 * `icon` is provided (override) or `showIcon: false` (opt out). The mapping is:
 * success → `circle-check`, warning → `triangle-exclamation`, danger →
 * `circle-xmark`, info → `circle-info`, neutral → `circle`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Status, UIComponentType } from "@elaraai/east-ui";
 *
 * const chip = East.function([], UIComponentType, _$ =>
 *     Status.Root("Up to date", { value: "success" }),
 * );
 * ```
 */
function createStatusRoot(
    label: StatusInput,
    options?: StatusOptions,
): ExprType<UIComponentType> {
    const labelExpr: ExprType<UIComponentType> = typeof label === "string"
        ? Text.Root(label)
        : label as ExprType<UIComponentType>;

    const valueLiteral: StatusValueLiteral = typeof options?.value === "string"
        ? options.value
        : "neutral";
    const valueValue = typeof options?.value === "string" || options?.value === undefined
        ? East.value(variant(valueLiteral, null), StatusValueType)
        : options.value as ExprType<StatusValueType>;

    // Paired-icon injection per §0.3
    const explicitIcon = options?.icon && typeof (options.icon as { prefix?: unknown }).prefix === "string"
        ? East.value({
            prefix: (options.icon as { prefix: string }).prefix,
            name: (options.icon as { name: string }).name,
            style: none,
        }, IconType)
        : (options?.icon as SubtypeExprOrValue<IconType> | undefined);

    const showIcon = options?.showIcon ?? true;
    // If `icon` explicitly provided → use it. If `showIcon === false` → no icon.
    // Otherwise inject the paired default when the value is a static literal.
    let iconValue: SubtypeExprOrValue<IconType> | undefined;
    if (explicitIcon !== undefined) {
        iconValue = explicitIcon;
    } else if (showIcon === true && typeof options?.value === "string") {
        const paired = PAIRED_ICONS[valueLiteral];
        iconValue = East.value({
            prefix: paired.prefix,
            name: paired.name,
            style: none,
        }, IconType);
    } else if (showIcon === true && options?.value === undefined) {
        const paired = PAIRED_ICONS["neutral"];
        iconValue = East.value({
            prefix: paired.prefix,
            name: paired.name,
            style: none,
        }, IconType);
    }

    const styleValue = options?.style ? buildStatusStyle(options.style) : undefined;

    return East.value(variant("Status", {
        value: valueValue,
        label: labelExpr,
        icon: iconValue ? some(iconValue) : none,
        pulsing: options?.pulsing !== undefined ? some(options.pulsing) : none,
        showIcon: options?.showIcon !== undefined ? some(options.showIcon) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildStatusStyle(style: StatusStyle): ExprType<StatusStyleType> {
    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        dotColor: style.dotColor !== undefined ? some(style.dotColor) : none,
    }, StatusStyleType);
}

/**
 * Status primitive — semantic classification chip with a paired icon (§0.3)
 * and an indicator dot.
 *
 * @remarks
 * Use for freshness chips, recompute progress markers, and per-row health
 * indicators. The paired-icon injection happens in the IR factory so every
 * renderer inherits it.
 */
export const Status = {
    /**
     * Creates a Status chip.
     *
     * @param label - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param options - Optional `value` / `icon` / `pulsing` / `showIcon` / `style`
     *
     * @example
     * ```ts
     * Status.Root("Recomputing", { value: "warning", pulsing: true });
     * ```
     */
    Root: createStatusRoot,
    Types: {
        /** The concrete East type for Status. */
        Status: StatusType,
        /** Semantic classification variant. */
        Value: StatusValueType,
        /** Visual-only style struct for Status. */
        Style: StatusStyleType,
    },
} as const;
