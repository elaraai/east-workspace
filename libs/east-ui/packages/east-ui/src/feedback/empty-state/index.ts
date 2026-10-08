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
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType, OrientationType } from "../../style.js";
import { IconType, refuseNonSolid, type SolidIconPrefix } from "../../display/icon/types.js";
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
 * @property icon - Optional leading Font Awesome solid icon — the empty state's one mark
 * @property title - Rich node for the empty-state title
 * @property description - Optional rich node for the description
 * @property actions - Optional rich actions slot (e.g. a Button or HStack of Buttons)
 * @property style - Optional visual-only style sub-struct
 */
export const EmptyStateType: StructType<{
    icon: OptionType<IconType>,
    title: UIComponentType,
    description: OptionType<UIComponentType>,
    actions: OptionType<UIComponentType>,
    style: OptionType<EmptyStateStyleType>,
}> = StructType({
    icon: OptionType(IconType),
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
 * @property title - Title (string coerced to `Text.Root` or a UIComponent)
 * @property icon - Optional leading Font Awesome solid icon — the empty state's one mark
 * @property description - Optional description (rich or string)
 * @property actions - Optional trailing action(s) (rich; typically a Button or HStack)
 * @property size - Size preset (sm / md / lg)
 * @property color - Default text colour
 * @property background - Background colour
 * @property borderColor - Border colour
 * @property iconColor - Colour of the leading indicator icon
 */
export interface EmptyStateOptions extends EmptyStateStyle {
    /** Title (string coerced to `Text.Root` or a UIComponent) — required. */
    title: EmptyStateInput;
    /** Optional leading Font Awesome solid icon, `{ prefix: "fas", name: "inbox" }` — the empty state's one mark, above the title. */
    icon?: { prefix: SolidIconPrefix; name: string } | SubtypeExprOrValue<IconType>;
    /** Optional description (rich or string) */
    description?: EmptyStateInput;
    /** Optional trailing action(s) (rich; typically a Button or HStack) */
    actions?: EmptyStateInput;
}

/**
 * Creates an EmptyState — a placeholder for a section that would otherwise
 * render zero rows / zero results / no scenarios.
 *
 * @param options - Required `title`, optional `icon` / `description` /
 *   `actions` / visual style fields
 * @returns An East expression representing the EmptyState component
 * @throws When `glyph` is given — removed in #1263: an empty state's mark is
 *   a Font Awesome solid icon, its `icon` — and when `icon` is another set's
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { EmptyState, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const empty = East.function([], UIComponentType, _$ =>
 *     EmptyState.Root({
 *         title: "No results",
 *         icon: { prefix: "fas", name: "magnifying-glass" },
 *         description: "Try clearing filters or broadening your search.",
 *         actions: Button.Root("Clear filters"),
 *     }),
 * );
 * ```
 */
function createEmptyStateRoot(
    options: EmptyStateOptions,
): ExprType<UIComponentType> {
    // The removed glyph, named (#1263) — a plain JS caller would otherwise lose
    // it silently: every icon is a Font Awesome solid icon, never a text glyph.
    if ("glyph" in (options as object)) {
        throw new Error(
            "EmptyState: `glyph` is removed (#1263) — an empty state's mark is a Font Awesome solid icon: " +
            "give `icon` instead, as `{ prefix: \"fas\", name: \"<icon>\" }`");
    }
    refuseNonSolid("EmptyState icon", options.icon);
    const { title, icon, description, actions, ...visual } = options;

    const titleExpr: ExprType<UIComponentType> = typeof title === "string"
        ? Text.Root(title)
        : title as ExprType<UIComponentType>;

    const descriptionValue = description !== undefined
        ? (typeof description === "string"
            ? Text.Root(description)
            : description as ExprType<UIComponentType>)
        : undefined;

    const actionsValue = actions !== undefined
        ? (typeof actions === "string"
            ? Text.Root(actions)
            : actions as ExprType<UIComponentType>)
        : undefined;

    const iconValue = icon && typeof (icon as { prefix?: unknown }).prefix === "string"
        ? East.value({
            prefix: (icon as { prefix: string }).prefix,
            name: (icon as { name: string }).name,
            label: none,
            style: none,
        }, IconType)
        : (icon as SubtypeExprOrValue<IconType> | undefined);

    const hasVisual = Object.values(visual).some(field => field !== undefined);
    const styleValue = hasVisual ? buildEmptyStateStyle(visual) : undefined;

    return East.value(variant("EmptyState", {
        icon: iconValue ? some(iconValue) : none,
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
     * @param options - Required `title`, optional `icon` (a Font Awesome solid
     *   icon) / `description` / `actions` / visual style fields
     *
     * @example
     * ```ts
     * EmptyState.Root({
     *     title: "No scenarios yet — create one",
     *     icon: { prefix: "fas", name: "folder-plus" },
     *     actions: Button.Root("New scenario", { variant: "solid" }),
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
