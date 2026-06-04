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
    NullType,
    FunctionType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType } from "../../style.js";
import { IconType } from "../../display/icon/types.js";
import { Text } from "../../typography/text/index.js";
import {
    BannerStatusType,
    type BannerStatusLiteral,
} from "./status-type.js";
import {
    BannerStyleType,
    BannerVariantType,
    type BannerStyle,
} from "./types.js";

// Re-export types
export {
    BannerStatusType,
    BannerStatus,
    type BannerStatusLiteral,
} from "./status-type.js";
export {
    BannerStyleType,
    BannerVariantType,
    BannerVariant,
    type BannerStyle,
    type BannerVariantLiteral,
} from "./types.js";

// ============================================================================
// BannerType — standalone mirror of the inline `Banner` variant
// ============================================================================

/**
 * Standalone mirror of the inline `Banner` variant in `component.ts`.
 * Reuses `BannerStatusType` for semantic classification.
 */
export const BannerType: StructType<{
    status: BannerStatusType,
    title: UIComponentType,
    description: OptionType<UIComponentType>,
    actions: OptionType<UIComponentType>,
    icon: OptionType<IconType>,
    dismissible: OptionType<BooleanType>,
    showIcon: OptionType<BooleanType>,
    onDismiss: OptionType<FunctionType<[], NullType>>,
    style: OptionType<BannerStyleType>,
}> = StructType({
    status: BannerStatusType,
    title: UIComponentType,
    description: OptionType(UIComponentType),
    actions: OptionType(UIComponentType),
    icon: OptionType(IconType),
    dismissible: OptionType(BooleanType),
    showIcon: OptionType(BooleanType),
    onDismiss: OptionType(FunctionType([], NullType)),
    style: OptionType(BannerStyleType),
});

export type BannerType = typeof BannerType;

// ============================================================================
// Paired-icon map (shared with Alert / Status)
// ============================================================================

const PAIRED_ICONS: Record<BannerStatusLiteral, { prefix: "fas"; name: string }> = {
    info: { prefix: "fas", name: "circle-info" },
    warning: { prefix: "fas", name: "triangle-exclamation" },
    success: { prefix: "fas", name: "circle-check" },
    error: { prefix: "fas", name: "circle-xmark" },
    neutral: { prefix: "fas", name: "circle" },
    change: { prefix: "fas", name: "circle-check" },
    guard: { prefix: "fas", name: "shield-halved" },
    stale: { prefix: "fas", name: "clock-rotate-left" },
};

// ============================================================================
// Banner Factory
// ============================================================================

type BannerInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `Banner.Root`.
 *
 * @property status - The banner status (info / warning / success / error / neutral / …)
 * @property title - Banner title (string coerced to `Text.Root` or a UIComponent)
 * @property description - Optional description (rich or string)
 * @property actions - Optional trailing action(s)
 * @property icon - Explicit icon override (skips paired default)
 * @property dismissible - Whether to show a close button
 * @property showIcon - Whether to show the paired icon (default true)
 * @property onDismiss - Callback fired when the close button is pressed
 * @property variant - Visual preset (subtle / solid / outline)
 * @property size - Size preset (sm / md / lg)
 * @property color - Text colour
 * @property background - Background colour
 * @property borderColor - Border colour
 * @property iconColor - Colour of the leading paired icon
 * @property accentColor - Prominent left / top accent stripe
 */
export interface BannerOptions extends BannerStyle {
    /** The banner status (info / warning / success / error / neutral / …) — required. */
    status: BannerStatusLiteral | SubtypeExprOrValue<BannerStatusType>;
    /** Banner title (string coerced to `Text.Root` or a UIComponent) — required. */
    title: BannerInput;
    /** Optional description (rich or string) */
    description?: BannerInput;
    /** Optional trailing action(s) */
    actions?: BannerInput;
    /** Explicit icon override (skips paired default) */
    icon?: { prefix: string; name: string } | SubtypeExprOrValue<IconType>;
    /** Whether to show a close button */
    dismissible?: SubtypeExprOrValue<BooleanType>;
    /** Whether to show the paired icon (default true) */
    showIcon?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired when the close button is pressed */
    onDismiss?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}

/**
 * Creates a Banner — a full-width page-level feedback surface with paired
 * icon.
 *
 * @param options - Required `status` + `title`, optional rich description /
 *   actions / dismissible / visual style fields
 * @returns An East expression representing the Banner component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Banner, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const stale = East.function([], UIComponentType, _$ =>
 *     Banner.Root({
 *         status: "warning",
 *         title: "Data last refreshed 48m ago",
 *         description: "Some metrics may be stale.",
 *         actions: Button.Root("Refresh"),
 *     }),
 * );
 * ```
 */
function createBannerRoot(
    options: BannerOptions,
): ExprType<UIComponentType> {
    const { status, title, description, actions, icon, dismissible, showIcon, onDismiss, ...visual } = options;

    const statusValue = typeof status === "string"
        ? East.value(variant(status, null), BannerStatusType)
        : status as ExprType<BannerStatusType>;

    const titleExpr: ExprType<UIComponentType> = typeof title === "string"
        ? Text.Root(title)
        : title as ExprType<UIComponentType>;

    const coerce = (input: BannerInput | undefined): ExprType<UIComponentType> | undefined => {
        if (input === undefined) return undefined;
        return typeof input === "string"
            ? Text.Root(input)
            : input as ExprType<UIComponentType>;
    };

    const descriptionValue = coerce(description);
    const actionsValue = coerce(actions);

    // paired-icon
    let iconValue: SubtypeExprOrValue<IconType> | undefined;
    const showIconResolved = showIcon ?? true;
    if (icon && typeof (icon as { prefix?: unknown }).prefix === "string") {
        iconValue = East.value({
            prefix: (icon as { prefix: string }).prefix,
            name: (icon as { name: string }).name,
            label: none,
            style: none,
        }, IconType);
    } else if (icon !== undefined) {
        iconValue = icon as SubtypeExprOrValue<IconType>;
    } else if (showIconResolved === true && typeof status === "string") {
        const paired = PAIRED_ICONS[status];
        iconValue = East.value({
            prefix: paired.prefix,
            name: paired.name,
            label: none,
            style: none,
        }, IconType);
    }

    const hasVisual = Object.values(visual).some(field => field !== undefined);
    const styleValue = hasVisual ? buildBannerStyle(visual) : undefined;

    return East.value(variant("Banner", {
        status: statusValue,
        title: titleExpr,
        description: descriptionValue ? some(descriptionValue) : none,
        actions: actionsValue ? some(actionsValue) : none,
        icon: iconValue ? some(iconValue) : none,
        dismissible: dismissible !== undefined ? some(dismissible) : none,
        showIcon: showIcon !== undefined ? some(showIcon) : none,
        onDismiss: onDismiss !== undefined ? some(onDismiss) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildBannerStyle(style: BannerStyle): ExprType<BannerStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), BannerVariantType)
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
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        iconColor: style.iconColor !== undefined ? some(style.iconColor) : none,
        accentColor: style.accentColor !== undefined ? some(style.accentColor) : none,
    }, BannerStyleType);
}

/**
 * Banner primitive — full-width page-level feedback surface with paired icon.
 */
export const Banner = {
    /**
     * Creates a Banner.
     *
     * @param options - Required `status` + `title`, optional rich description /
     *   actions / dismissible / visual style fields
     *
     * @example
     * ```ts
     * Banner.Root({
     *     status: "warning",
     *     title: "Data last refreshed 48m ago",
     *     actions: Button.Root("Refresh"),
     * });
     * ```
     */
    Root: createBannerRoot,
    Types: {
        /**
         * East StructType for a Banner value — mirrors the inline `Banner`
         * variant in `component.ts`.
         *
         * @remarks
         * Exposed on the namespace so consumers can reference the IR type
         * via `Banner.Types.Banner` without reaching into module internals.
         *
         * @property status - Semantic classification (shared with Alert / Toast)
         * @property title - Banner title
         * @property description - Optional description body
         * @property icon - Optional explicit icon (overrides the default paired icon)
         * @property closable - Whether a close affordance is rendered
         * @property showIcon - Whether the default paired icon is shown
         * @property actions - Optional action buttons row
         * @property onClose - Optional close-button callback
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Banner: BannerType,
        /**
         * Semantic status classification for Banner — shared vocabulary
         * with Alert / Toast.
         *
         * @remarks
         * Drives default paired-icon selection and colour palette.
         *
         * @property info - Informational notice
         * @property success - Confirmation / on-track
         * @property warning - Non-blocking caution
         * @property error - Error / failure
         * @property neutral - Default / idle
         */
        Status: BannerStatusType,
        /**
         * East StructType holding every visual field for a Banner.
         *
         * @remarks
         * Mirror of `BannerStyleType` from `./types.js`. Covers the four
         * colour slots (text, background, border, icon) applied alongside
         * the default palette driven by `status`.
         *
         * @property color - Explicit text colour override
         * @property background - Explicit background override
         * @property borderColor - Explicit border colour override
         * @property iconColor - Explicit icon tint override
         */
        Style: BannerStyleType,
    },
} as const;
