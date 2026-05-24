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
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType, OrientationType } from "../../style.js";
import { IconType } from "../../display/icon/types.js";
import { Text } from "../../typography/text/index.js";
import {
    EmptyStateStyleType,
    type EmptyStateStyle,
} from "./types.js";

// Re-export types
export {
    EmptyStateStyleType,
    type EmptyStateStyle,
} from "./types.js";

// ============================================================================
// EmptyStateType — standalone mirror of the inline `EmptyState` variant
// ============================================================================

/**
 * Standalone mirror of the inline `EmptyState` variant in `component.ts`.
 * Used by renderers for `equalFor` memoization.
 *
 * @property icon - Optional leading Font Awesome icon
 * @property title - Rich node for the empty-state title
 * @property description - Optional rich node for the description
 * @property actions - Optional rich actions slot (e.g. a Button or HStack of Buttons)
 * @property style - Optional visual-only style sub-struct
 */
export const EmptyStateType: StructType<{
    icon: OptionType<IconType>,
    glyph: OptionType<StringType>,
    title: UIComponentType,
    description: OptionType<UIComponentType>,
    actions: OptionType<UIComponentType>,
    style: OptionType<EmptyStateStyleType>,
}> = StructType({
    icon: OptionType(IconType),
    glyph: OptionType(StringType),
    title: UIComponentType,
    description: OptionType(UIComponentType),
    actions: OptionType(UIComponentType),
    style: OptionType(EmptyStateStyleType),
});

export type EmptyStateType = typeof EmptyStateType;

// ============================================================================
// EmptyState Root Factory
// ============================================================================

type EmptyStateInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `EmptyState.Root`.
 *
 * @property icon - Optional leading Font Awesome icon
 * @property description - Optional description (rich or string)
 * @property actions - Optional trailing action(s) (rich; typically a Button or HStack)
 * @property style - Optional visual-only style
 */
export interface EmptyStateOptions {
    /** Optional leading Font Awesome icon (off-spec escape hatch) */
    icon?: { prefix: string; name: string } | SubtypeExprOrValue<IconType>;
    /** Spec-preferred mono glyph string (e.g. `"·   ·   ·"` / `"+ + +"`) — renders at 36px mono with letter-spacing 0.1em, colour `border.strong`. When set, takes precedence over `icon`. */
    glyph?: SubtypeExprOrValue<StringType>;
    /** Optional description (rich or string) */
    description?: EmptyStateInput;
    /** Optional trailing action(s) (rich; typically a Button or HStack) */
    actions?: EmptyStateInput;
    /** Optional visual-only style */
    style?: EmptyStateStyle;
}

/**
 * Creates an EmptyState — a placeholder for a section that would otherwise
 * render zero rows / zero results / no scenarios.
 *
 * @param title - String (coerced to `Text.Root(s)`) or UIComponentType
 * @param options - Optional `icon` / `description` / `actions` / `style`
 * @returns An East expression representing the EmptyState component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { EmptyState, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const empty = East.function([], UIComponentType, _$ =>
 *     EmptyState.Root("No results", {
 *         icon: { prefix: "fas", name: "magnifying-glass" },
 *         description: "Try clearing filters or broadening your search.",
 *         actions: Button.Root("Clear filters"),
 *     }),
 * );
 * ```
 */
function createEmptyStateRoot(
    title: EmptyStateInput,
    options?: EmptyStateOptions,
): ExprType<UIComponentType> {
    const titleExpr: ExprType<UIComponentType> = typeof title === "string"
        ? Text.Root(title)
        : title as ExprType<UIComponentType>;

    const descriptionValue = options?.description !== undefined
        ? (typeof options.description === "string"
            ? Text.Root(options.description)
            : options.description as ExprType<UIComponentType>)
        : undefined;

    const actionsValue = options?.actions !== undefined
        ? (typeof options.actions === "string"
            ? Text.Root(options.actions)
            : options.actions as ExprType<UIComponentType>)
        : undefined;

    const iconValue = options?.icon && typeof (options.icon as { prefix?: unknown }).prefix === "string"
        ? East.value({
            prefix: (options.icon as { prefix: string }).prefix,
            name: (options.icon as { name: string }).name,
            label: none,
            style: none,
        }, IconType)
        : (options?.icon as SubtypeExprOrValue<IconType> | undefined);

    const styleValue = options?.style ? buildEmptyStateStyle(options.style) : undefined;

    return East.value(variant("EmptyState", {
        icon: iconValue ? some(iconValue) : none,
        glyph: options?.glyph !== undefined ? some(options.glyph) : none,
        title: titleExpr,
        description: descriptionValue ? some(descriptionValue) : none,
        actions: actionsValue ? some(actionsValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildEmptyStateStyle(style: EmptyStateStyle): ExprType<EmptyStateStyleType> {
    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    // OrientationType unused here but imported for signature symmetry with other
    // feedback components.
    void OrientationType;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        iconColor: style.iconColor !== undefined ? some(style.iconColor) : none,
    }, EmptyStateStyleType);
}

/**
 * EmptyState primitive — placeholder UI for zero-state sections.
 *
 * @remarks
 * Use as the fallback body of a Card in `state: "empty"` or as a standalone
 * section when a list / table / scenario picker renders no rows.
 */
export const EmptyState = {
    /**
     * Creates an EmptyState.
     *
     * @param title - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param options - Optional `icon` / `description` / `actions` / `style`
     *
     * @example
     * ```ts
     * EmptyState.Root("No scenarios yet — create one", {
     *     icon: { prefix: "fas", name: "folder-plus" },
     *     actions: Button.Root("New scenario", { style: { variant: "solid" } }),
     * });
     * ```
     */
    Root: createEmptyStateRoot,
    Types: {
        /**
         * East StructType for an EmptyState value — mirrors the inline
         * `EmptyState` variant in `component.ts`.
         *
         * @remarks
         * Exposed on the namespace so consumers can reference the IR type
         * via `EmptyState.Types.EmptyState` without reaching into module
         * internals.
         *
         * @property icon - Optional leading indicator icon
         * @property title - Title UIComponent (required)
         * @property description - Optional description UIComponent
         * @property actions - Optional action row (typically a Button or Stack of buttons)
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        EmptyState: EmptyStateType,
        /**
         * East StructType holding every visual field for an EmptyState.
         *
         * @remarks
         * Mirror of `EmptyStateStyleType` from `./types.js`. Content
         * (title / description / icon / actions) lives on the main
         * variant; this struct carries only the size preset and the four
         * colour slots.
         *
         * @property size - Size preset (sm / md / lg)
         * @property color - Default text colour
         * @property background - Background colour
         * @property borderColor - Border colour
         * @property iconColor - Colour of the leading indicator icon
         */
        Style: EmptyStateStyleType,
    },
} as const;
