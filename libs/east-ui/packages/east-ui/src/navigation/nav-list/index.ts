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
    NavSectionType,
    NavItemType,
    NavListSurfaceType,
    type NavListStyle,
    type NavSectionInput,
} from "./types.js";

export {
    NavListType,
    NavSectionType,
    NavItemType,
    NavListSurfaceType,
    type NavListSurfaceLiteral,
    type NavListStyle,
    type NavSectionInput,
    type NavItemInput,
} from "./types.js";

// ============================================================================
// NavList Factory
// ============================================================================

/**
 * Creates a `NavList` — grouped top-level navigation rendered as the
 * bsys Sidebar recipe (mono uppercase rows, brand-tint active with a
 * 3 px brand-d left rule, paper-2 card chrome).
 *
 * @param sections - Array of sections, each with optional label + items
 * @param style - Optional configuration (`onSelect`, `surface`, `background`)
 * @returns An East expression representing the NavList
 *
 * @remarks
 * Pure callback primitive: emits `onSelect(key)` when an item is
 * clicked. Active state is per-item (`active: true`) — apps wire
 * this via `Reactive.Root` + `State.bind` in the standard pattern.
 *
 * @example
 * ```ts
 * import { East, NullType, StringType } from "@elaraai/east";
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
        surface: style?.surface !== undefined
            ? some(typeof style.surface === "string"
                ? East.value(variant(style.surface, null), NavListSurfaceType)
                : style.surface)
            : none,
        background: style?.background !== undefined ? some(style.background) : none,
    }), UIComponentType);
}

interface NavListNamespace {
    Root: typeof createNavList;
    Types: {
        NavList: typeof NavListType;
        Section: typeof NavSectionType;
        Item: typeof NavItemType;
    };
}

/**
 * `NavList` namespace — grouped top-level navigation primitive.
 *
 * @remarks
 * Use `NavList.Root(sections, options?)`. Access IR types via
 * `NavList.Types.NavList`, `NavList.Types.Section`,
 * `NavList.Types.Item`.
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
         */
        NavList: NavListType,
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
