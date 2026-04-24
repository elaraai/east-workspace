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
    BooleanType,
    NullType,
    FunctionType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { IconType } from "../../display/icon/types.js";
import { Text } from "../../typography/text/index.js";
import {
    AlertStatusType,
    AlertStatus,
    AlertVariantType,
    AlertVariant,
    AlertStyleType,
    type AlertStatusLiteral,
    type AlertStyle,
} from "./types.js";

// Re-export types
export {
    AlertStatusType,
    AlertStatus,
    AlertVariantType,
    AlertVariant,
    AlertStyleType,
    type AlertStatusLiteral,
    type AlertVariantLiteral,
    type AlertStyle,
} from "./types.js";

// ============================================================================
// AlertType — standalone mirror of the inline `Alert` variant
// ============================================================================

/**
 * Standalone mirror of the inline `Alert` variant in `component.ts`. Used by
 * renderers for `equalFor` memoization.
 */
export const AlertType: StructType<{
    status: AlertStatusType,
    title: OptionType<UIComponentType>,
    description: OptionType<UIComponentType>,
    body: OptionType<ArrayType<UIComponentType>>,
    actions: OptionType<UIComponentType>,
    icon: OptionType<IconType>,
    closable: OptionType<BooleanType>,
    showIcon: OptionType<BooleanType>,
    onClose: OptionType<FunctionType<[], NullType>>,
    style: OptionType<AlertStyleType>,
}> = StructType({
    status: AlertStatusType,
    title: OptionType(UIComponentType),
    description: OptionType(UIComponentType),
    body: OptionType(ArrayType(UIComponentType)),
    actions: OptionType(UIComponentType),
    icon: OptionType(IconType),
    closable: OptionType(BooleanType),
    showIcon: OptionType(BooleanType),
    onClose: OptionType(FunctionType([], NullType)),
    style: OptionType(AlertStyleType),
});

export type AlertType = typeof AlertType;

// ============================================================================
// §0.3 Paired-icon map (mirrors Status)
// ============================================================================

const PAIRED_ICONS: Record<AlertStatusLiteral, { prefix: "fas"; name: string }> = {
    info: { prefix: "fas", name: "circle-info" },
    warning: { prefix: "fas", name: "triangle-exclamation" },
    success: { prefix: "fas", name: "circle-check" },
    error: { prefix: "fas", name: "circle-xmark" },
    neutral: { prefix: "fas", name: "circle" },
};

// ============================================================================
// Alert Factory
// ============================================================================

type AlertContentInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `Alert.Root`.
 *
 * @property title - Optional rich title (string coerced to `Text.Root`)
 * @property description - Optional rich description (string coerced to `Text.Root`)
 * @property body - Optional array of rich body nodes (e.g. an embedded input)
 * @property actions - Optional trailing action(s) (typically a Button or HStack)
 * @property icon - Explicit Font Awesome icon (overrides the §0.3 paired default)
 * @property closable - Whether to show a close button
 * @property onClose - Callback fired when the close button is pressed
 * @property style - Optional visual-only style
 */
export interface AlertOptions {
    /** Optional rich title (string coerced to `Text.Root`) */
    title?: AlertContentInput;
    /** Optional rich description (string coerced to `Text.Root`) */
    description?: AlertContentInput;
    /** Optional array of rich body nodes (e.g. an embedded input) */
    body?: SubtypeExprOrValue<ArrayType<UIComponentType>>;
    /** Optional trailing action(s) (typically a Button or HStack) */
    actions?: AlertContentInput;
    /** Explicit Font Awesome icon (overrides the §0.3 paired default) */
    icon?: { prefix: string; name: string } | SubtypeExprOrValue<IconType>;
    /** Whether to show a close button */
    closable?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired when the close button is pressed */
    onClose?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Optional visual-only style */
    style?: AlertStyle;
}

/**
 * Creates an Alert component with status, rich content, and an auto-injected
 * paired icon per §0.3.
 *
 * @param status - The alert status (info / warning / success / error / neutral)
 * @param options - Optional `title` / `description` / `body` / `actions` /
 *   `icon` / `closable` / `onClose` / `style`
 * @returns An East expression representing the alert component
 *
 * @remarks
 * The factory auto-injects the paired icon corresponding to `status` unless
 * `icon` is explicitly provided. Strings passed to `title` / `description` /
 * each `body` entry / `actions` are coerced to `Text.Root(s)`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Alert, UIComponentType } from "@elaraai/east-ui";
 *
 * const hint = East.function([], UIComponentType, _$ =>
 *     Alert.Root("warning", {
 *         title: "Session expiring",
 *         description: "Your session will end in 5 minutes.",
 *     }),
 * );
 * ```
 */
function createAlert(
    status: AlertStatusLiteral | SubtypeExprOrValue<AlertStatusType>,
    options?: AlertOptions,
): ExprType<UIComponentType> {
    const statusValue = typeof status === "string"
        ? East.value(variant(status, null), AlertStatusType)
        : status as ExprType<AlertStatusType>;

    const coerce = (input: AlertContentInput | undefined): ExprType<UIComponentType> | undefined => {
        if (input === undefined) return undefined;
        return typeof input === "string"
            ? Text.Root(input)
            : input as ExprType<UIComponentType>;
    };

    const titleValue = coerce(options?.title);
    const descriptionValue = coerce(options?.description);
    const actionsValue = coerce(options?.actions);

    // §0.3 paired-icon injection
    let iconValue: SubtypeExprOrValue<IconType> | undefined;
    if (options?.icon && typeof (options.icon as { prefix?: unknown }).prefix === "string") {
        iconValue = East.value({
            prefix: (options.icon as { prefix: string }).prefix,
            name: (options.icon as { name: string }).name,
            style: none,
        }, IconType);
    } else if (options?.icon !== undefined) {
        iconValue = options.icon as SubtypeExprOrValue<IconType>;
    } else if (typeof status === "string") {
        const paired = PAIRED_ICONS[status];
        iconValue = East.value({
            prefix: paired.prefix,
            name: paired.name,
            style: none,
        }, IconType);
    }

    const styleValue = options?.style ? buildAlertStyle(options.style) : undefined;

    return East.value(variant("Alert", {
        status: statusValue,
        title: titleValue ? some(titleValue) : none,
        description: descriptionValue ? some(descriptionValue) : none,
        body: options?.body !== undefined ? some(options.body as never) : none,
        actions: actionsValue ? some(actionsValue) : none,
        icon: iconValue ? some(iconValue) : none,
        closable: options?.closable !== undefined ? some(options.closable) : none,
        showIcon: none,
        onClose: options?.onClose !== undefined ? some(options.onClose) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildAlertStyle(style: AlertStyle): ExprType<AlertStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), AlertVariantType)
            : style.variant)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        iconColor: style.iconColor !== undefined ? some(style.iconColor) : none,
    }, AlertStyleType);
}

/**
 * Alert primitive — semantic feedback surface with rich content and a paired
 * icon per §0.3.
 */
export const Alert = {
    /**
     * Creates an Alert.
     *
     * @param status - "info" / "warning" / "success" / "error" / "neutral"
     * @param options - Optional rich content + state + style
     *
     * @example
     * ```ts
     * Alert.Root("warning", {
     *     title: "n_trials = 0",
     *     description: "Bayesian draws will be skipped.",
     * });
     * ```
     */
    Root: createAlert,
    Status: AlertStatus,
    Variant: AlertVariant,
    Types: {
        /**
         * East StructType for an Alert value — mirrors the inline `Alert`
         * variant in `component.ts`.
         *
         * @remarks
         * Exposed on the namespace so consumers can reference the IR type
         * via `Alert.Types.Alert` without reaching into module internals.
         *
         * @property status - Semantic classification (info / warning / success / error / neutral)
         * @property title - Optional short alert title (UIComponent)
         * @property description - Optional short rich description (UIComponent)
         * @property body - Optional rich body — array of UIComponents rendered below title/description
         * @property actions - Optional action row (typically `Button.Root(...)` wrapped in a stack)
         * @property icon - Optional explicit icon (overrides the default paired-icon)
         * @property closable - Whether a close affordance is rendered
         * @property showIcon - Whether the default paired icon is shown
         * @property onClose - Optional close-button callback
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Alert: AlertType,
        /**
         * Semantic status classification for Alert — shared with Banner /
         * Toast.
         *
         * @remarks
         * Drives default paired-icon selection and colour palette per §0.3.
         *
         * @property info - Informational notice
         * @property success - Confirmation / on-track
         * @property warning - Non-blocking caution
         * @property error - Error / failure
         * @property neutral - Default / idle
         */
        Status: AlertStatusType,
        /**
         * Visual preset variant for Alert.
         *
         * @remarks
         * Mirror of the shared `StyleVariantType` restricted to the three
         * presets the Chakra v3 Alert compound accepts.
         *
         * @property solid - Filled background + high-contrast text
         * @property subtle - Tinted background + default text (default)
         * @property outline - Border-only with background transparent
         */
        Variant: AlertVariantType,
        /**
         * East StructType holding every visual field for an Alert.
         *
         * @remarks
         * Mirror of `AlertStyleType` from `./types.js`. Covers the four
         * colour slots (text, background, border, icon) plus the visual
         * preset (`variant`) and optional explicit padding.
         *
         * @property variant - Visual preset (solid / subtle / outline)
         * @property color - Explicit text colour override
         * @property background - Explicit background override
         * @property borderColor - Explicit border colour
         * @property iconColor - Explicit icon tint
         */
        Style: AlertStyleType,
    },
} as const;
