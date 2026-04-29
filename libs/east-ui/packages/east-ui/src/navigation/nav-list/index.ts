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
import { IconType } from "../../display/icon/types.js";
import {
    NavListType,
    NavListStyleType,
    NavListOrientationType,
    NavSectionType,
    NavItemType,
    type NavListStyle,
    type NavSectionInput,
} from "./types.js";

export {
    NavListType,
    NavListStyleType,
    NavListOrientationType,
    NavSectionType,
    NavItemType,
    type NavListStyle,
    type NavListOrientationLiteral,
    type NavSectionInput,
    type NavItemInput,
} from "./types.js";

// ============================================================================
// NavList Factory
// ============================================================================

/**
 * Creates a `NavList` — grouped section navigation list for use
 * inside panels (settings sub-nav, in-drawer navigation, in-card
 * section tabs).
 *
 * @param sections - Array of sections, each with optional label + items
 * @param style - Optional styling + behaviour configuration
 * @returns An East expression representing the NavList
 *
 * @remarks
 * Pure callback primitive: emits `onSelect(key)` when an item is
 * clicked. Active state is per-item (`active: true`) — apps wire
 * this via `Reactive.Root` + `State.bind` in the standard pattern.
 *
 * @example
 * ```ts
 * import { East, BooleanType, NullType, StringType } from "@elaraai/east";
 * import { NavList, Reactive, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     return Reactive.Root(East.function([], UIComponentType, $ => {
 *         const activeBind = $.let(State.bind([StringType], "settings.nav", "profile"));
 *         const active = $.let(activeBind.read(), StringType);
 *         const onSelect = $.const(East.function([StringType], NullType, ($, key) => {
 *             $(activeBind.write(key));
 *         }));
 *         return NavList.Root([
 *             {
 *                 label: "Account",
 *                 items: [
 *                     { key: "profile", label: "Profile", active: active.equals("profile") },
 *                     { key: "security", label: "Security", active: active.equals("security") },
 *                 ],
 *             },
 *         ], { onSelect });
 *     }));
 * });
 * ```
 */
function createNavList(
    sections: NavSectionInput[],
    style?: NavListStyle,
): ExprType<UIComponentType> {
    const orientationValue = style?.orientation
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation, null), NavListOrientationType)
            : style.orientation)
        : undefined;

    const hasStyle = !!style && (
        orientationValue !== undefined ||
        style.sectionLabelColor !== undefined ||
        style.itemColor !== undefined ||
        style.itemHoverBackground !== undefined ||
        style.activeColor !== undefined ||
        style.activeBackground !== undefined ||
        style.activeIndicatorColor !== undefined ||
        style.badgeBackground !== undefined ||
        style.badgeColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        orientation: orientationValue ? some(orientationValue) : none,
        sectionLabelColor: style!.sectionLabelColor !== undefined ? some(style!.sectionLabelColor) : none,
        itemColor: style!.itemColor !== undefined ? some(style!.itemColor) : none,
        itemHoverBackground: style!.itemHoverBackground !== undefined ? some(style!.itemHoverBackground) : none,
        activeColor: style!.activeColor !== undefined ? some(style!.activeColor) : none,
        activeBackground: style!.activeBackground !== undefined ? some(style!.activeBackground) : none,
        activeIndicatorColor: style!.activeIndicatorColor !== undefined ? some(style!.activeIndicatorColor) : none,
        badgeBackground: style!.badgeBackground !== undefined ? some(style!.badgeBackground) : none,
        badgeColor: style!.badgeColor !== undefined ? some(style!.badgeColor) : none,
    }, NavListStyleType) : undefined;

    const sectionsExpr = East.value(
        sections.map(s => East.value({
            label: s.label !== undefined ? some(s.label) : none,
            items: East.value(
                s.items.map(it => {
                    const iconExpr = it.icon !== undefined
                        ? some(East.value({
                            prefix: it.icon.prefix,
                            name: it.icon.name,
                            label: none,
                            style: none,
                        }, IconType))
                        : none;
                    return East.value({
                        key: it.key,
                        label: it.label,
                        icon: iconExpr,
                        badge: it.badge !== undefined ? some(it.badge) : none,
                        active: it.active !== undefined ? some(it.active) : none,
                    }, NavItemType);
                }),
            ),
        }, NavSectionType)),
    );

    return East.value(variant("NavList", {
        sections: sectionsExpr,
        onSelect: style?.onSelect ? some(style.onSelect) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface NavListNamespace {
    Root: typeof createNavList;
    Types: {
        NavList: typeof NavListType;
        Style: typeof NavListStyleType;
        Orientation: typeof NavListOrientationType;
        Section: typeof NavSectionType;
        Item: typeof NavItemType;
    };
}

/**
 * `NavList` namespace — grouped in-panel navigation primitive.
 *
 * @remarks
 * Use `NavList.Root(sections, options?)`. Access IR types via
 * `NavList.Types.NavList`, `NavList.Types.Style`,
 * `NavList.Types.Section`, `NavList.Types.Item`,
 * `NavList.Types.Orientation`.
 */
export const NavList: NavListNamespace = {
    /**
     * Creates a `NavList`. See {@link createNavList}.
     */
    Root: createNavList,
    Types: {
        /**
         * East StructType for the `NavList` value.
         *
         * @property sections - Array of sections, each with optional label + items
         * @property onSelect - Callback fired with the selected item's `key`
         * @property style - Optional visual style sub-struct
         */
        NavList: NavListType,
        /**
         * East StructType holding visual fields for `NavList`.
         *
         * @property orientation - Layout direction
         * @property sectionLabelColor - Section heading text colour
         * @property itemColor - Inactive item text colour
         * @property itemHoverBackground - Hover background colour
         * @property activeColor - Active item text colour
         * @property activeBackground - Active item background colour
         * @property activeIndicatorColor - Active-item left-stripe colour
         * @property badgeBackground - Badge fill colour
         * @property badgeColor - Badge text colour
         */
        Style: NavListStyleType,
        /**
         * Orientation variant for `NavList` layout.
         *
         * @property horizontal - Items laid out in a row
         * @property vertical - Items laid out in a column
         */
        Orientation: NavListOrientationType,
        /**
         * East StructType for an individual section.
         *
         * @property label - Optional section heading
         * @property items - Items belonging to this section
         */
        Section: NavSectionType,
        /**
         * East StructType for an individual nav item.
         *
         * @property key - Stable identifier
         * @property label - Display text
         * @property icon - Optional leading icon
         * @property badge - Optional trailing badge text
         * @property active - Whether this item is currently active
         */
        Item: NavItemType,
    },
};
