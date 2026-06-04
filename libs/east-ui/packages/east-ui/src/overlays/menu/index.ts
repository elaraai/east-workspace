/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    variant,
    some,
    none,
    StringType,
    BooleanType,
    ArrayType,
    OptionType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    MenuItemType,
    MenuStyleType,
    type MenuStyle,
    PlacementType,
} from "./types.js";

// Re-export types
export {
    MenuItemType,
    MenuStyleType,
    type MenuStyle,
    PlacementType,
    type PlacementLiteral,
} from "./types.js";

// ============================================================================
// Menu Type
// ============================================================================

/**
 * East StructType for Menu component.
 *
 * @remarks
 * Menu wraps a trigger element and displays a dropdown menu on click.
 * The trigger can be any UI component. Visual fields (placement) live in
 * `style`.
 *
 * @property trigger - The UI component that triggers the menu on click
 * @property items - Array of menu items (Item or Separator)
 * @property style - Optional visual-only style sub-struct
 */
export const MenuType: StructType<{
    trigger: UIComponentType,
    items: ArrayType<MenuItemType>,
    style: OptionType<MenuStyleType>,
}> = StructType({
    trigger: UIComponentType,
    items: ArrayType(MenuItemType),
    style: OptionType(MenuStyleType),
});

/**
 * Type alias for MenuType.
 */
export type MenuType = typeof MenuType;

// ============================================================================
// Menu Item Factories
// ============================================================================

/**
 * Creates a menu item.
 *
 * @param value - Unique identifier for the item
 * @param label - Display text for the item
 * @param disabled - Whether the item is disabled
 * @returns An East expression representing the menu item
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Menu, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Menu.Root(
 *         Button.Root("Actions"),
 *         [
 *             Menu.Item("edit", "Edit"),
 *             Menu.Item("delete", "Delete", true),
 *         ]
 *     );
 * });
 * ```
 */
function createMenuItem(
    value: SubtypeExprOrValue<typeof StringType>,
    label: SubtypeExprOrValue<typeof StringType>,
    disabled?: SubtypeExprOrValue<typeof BooleanType>
): ExprType<MenuItemType> {
    return East.value(variant("Item", {
        value: value,
        label: label,
        disabled: disabled !== undefined ? some(disabled) : none,
    }), MenuItemType);
}

/**
 * Creates a menu separator.
 *
 * @returns An East expression representing a menu separator
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Menu, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Menu.Root(
 *         Button.Root("File"),
 *         [
 *             Menu.Item("new", "New"),
 *             Menu.Separator(),
 *             Menu.Item("exit", "Exit"),
 *         ]
 *     );
 * });
 * ```
 */
function createMenuSeparator(): ExprType<MenuItemType> {
    return East.value(variant("Separator", null), MenuItemType);
}

// ============================================================================
// Menu Factory
// ============================================================================

/**
 * Creates a Menu component.
 *
 * @param options - Required `trigger` + `items`, optional visual style fields
 * @returns An East expression representing the Menu component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Menu, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Menu.Root({
 *         trigger: Button.Root("Actions"),
 *         items: [
 *             Menu.Item("edit", "Edit"),
 *             Menu.Separator(),
 *             Menu.Item("delete", "Delete"),
 *         ],
 *         placement: "bottom-start",
 *     });
 * });
 * ```
 */
export interface MenuOptions extends MenuStyle {
    /** The element that triggers the menu — required. */
    trigger: SubtypeExprOrValue<UIComponentType>;
    /** Array of menu items created with `Menu.Item` / `Menu.Separator` — required. */
    items: SubtypeExprOrValue<ArrayType<MenuItemType>>;
}

function createMenu(
    options: MenuOptions,
): ExprType<UIComponentType> {
    const { trigger, items, ...style } = options;

    const placementValue = style.placement
        ? (typeof style.placement === "string"
            ? East.value(variant(style.placement, null), PlacementType)
            : style.placement)
        : undefined;

    const styleValue = placementValue !== undefined
        ? East.value({
            placement: some(placementValue),
        }, MenuStyleType)
        : undefined;

    return East.value(variant("Menu", {
        trigger: trigger,
        items: items,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// Menu Namespace Export
// ============================================================================

/**
 * Menu component namespace.
 *
 * @remarks
 * Menu provides a dropdown menu triggered by a UI element.
 * Use `Menu.Root({ trigger, items, ... })` to create a menu, `Menu.Item(value, label)` for items, and `Menu.Separator()` for dividers.
 */
export const Menu = {
    /**
     * Creates a Menu component with a trigger and menu items.
     *
     * @param options - Required `trigger` + `items`, optional visual style fields
     * @returns An East expression representing the Menu component
     *
     * @remarks
     * Menu provides a dropdown list of actions triggered by clicking a UI element.
     * Supports items with labels and values, plus separators for visual grouping.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Menu, Button, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Menu.Root({
     *         trigger: Button.Root("Actions"),
     *         items: [
     *             Menu.Item("edit", "Edit"),
     *             Menu.Separator(),
     *             Menu.Item("delete", "Delete"),
     *         ],
     *     });
     * });
     * ```
     */
    Root: createMenu,
    /**
     * Creates a menu item with value and label.
     *
     * @param value - Unique identifier for the item
     * @param label - Display text for the item
     * @param disabled - Whether the item is disabled
     * @returns An East expression representing the menu item
     *
     * @remarks
     * Menu items are clickable entries within a Menu. Each item has a unique
     * value for identification and a label for display.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Menu, Button, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Menu.Root(
     *         Button.Root("Actions"),
     *         [
     *             Menu.Item("edit", "Edit"),
     *             Menu.Item("delete", "Delete", true), // disabled
     *         ]
     *     );
     * });
     * ```
     */
    Item: createMenuItem,
    /**
     * Creates a menu separator for visual grouping.
     *
     * @returns An East expression representing a menu separator
     *
     * @remarks
     * Separators create visual dividers between groups of menu items.
     * Use them to organize related actions within a menu.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Menu, Button, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Menu.Root(
     *         Button.Root("File"),
     *         [
     *             Menu.Item("new", "New"),
     *             Menu.Item("open", "Open"),
     *             Menu.Separator(),
     *             Menu.Item("exit", "Exit"),
     *         ]
     *     );
     * });
     * ```
     */
    Separator: createMenuSeparator,
    Types: {
        /**
         * East StructType for Menu component.
         *
         * @remarks
         * Menu wraps a trigger element and displays a dropdown menu on click.
         * The trigger can be any UI component. Visual fields (placement)
         * live in `style`.
         *
         * @property trigger - The UI component that triggers the menu on click
         * @property items - Array of menu items (Item or Separator)
         * @property style - Optional visual-only style sub-struct (see `Style`)
         */
        Menu: MenuType,
        /**
         * Menu item variant type.
         *
         * @remarks
         * Menu items can be either an Item (clickable menu entry) or a Separator (visual divider).
         *
         * @property Item - A clickable menu item with value, label, and optional disabled state
         * @property Separator - A visual separator between menu items
         */
        Item: MenuItemType,
        /**
         * Style type for Menu component.
         *
         * @remarks
         * Contains optional styling properties for the menu.
         *
         * @property placement - Where to position the menu relative to the trigger
         */
        Style: MenuStyleType,
        /**
         * Placement options for Tooltip positioning.
         *
         * @remarks
         * Controls where the tooltip appears relative to its trigger element.
         * Supports all cardinal directions with start/end variations.
         *
         * @property top - Centered above the trigger
         * @property top-start - Above, aligned to start
         * @property top-end - Above, aligned to end
         * @property bottom - Centered below the trigger
         * @property bottom-start - Below, aligned to start
         * @property bottom-end - Below, aligned to end
         * @property left - Centered to the left
         * @property left-start - Left, aligned to start
         * @property left-end - Left, aligned to end
         * @property right - Centered to the right
         * @property right-start - Right, aligned to start
         * @property right-end - Right, aligned to end
         */
        Placement: PlacementType,
    },
} as const;
