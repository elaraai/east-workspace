/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    NullType,
    BooleanType,
    VariantType,
} from "@elaraai/east";

import { PlacementType, type PlacementLiteral } from "../tooltip/types.js";
import { type IconName } from "../../display/icon/types.js";

// Re-export PlacementType for convenience
export { PlacementType, type PlacementLiteral } from "../tooltip/types.js";

// ============================================================================
// Menu Item Type
// ============================================================================

/**
 * Menu item variant type.
 *
 * @remarks
 * Menu items can be an Item (clickable menu entry), a GroupLabel (uppercase
 * mono eyebrow naming the section below it), or a Separator (visual divider).
 * Destructive items render in the negative ink and belong at the bottom of
 * the menu, after a separator.
 *
 * @property Item - A clickable menu item with value, label, and optional icon / accelerator / disabled / destructive state
 * @property GroupLabel - An uppercase eyebrow heading for the items that follow
 * @property Separator - A visual separator between menu items
 */
export const MenuItemType = VariantType({
    /** A clickable menu item */
    Item: StructType({
        /** Unique identifier for the item */
        value: StringType,
        /** Display text for the item */
        label: StringType,
        /** Whether the item is disabled */
        disabled: OptionType(BooleanType),
        /** Font Awesome solid icon name rendered before the label (e.g. `"pen"`, `"copy"`) */
        icon: OptionType(StringType),
        /** Keyboard accelerator shown right-aligned in mono (e.g. `"⌘D"`) */
        command: OptionType(StringType),
        /** Whether the action is destructive — renders in the negative ink */
        destructive: OptionType(BooleanType),
    }),
    /** An uppercase eyebrow heading for the items that follow */
    GroupLabel: StructType({
        /** Heading text — rendered uppercase in the mono eyebrow style */
        label: StringType,
    }),
    /** A visual separator between items */
    Separator: NullType,
});

/**
 * Type representing the MenuItem structure.
 */
export type MenuItemType = typeof MenuItemType;

/**
 * TypeScript interface for the optional fields of a menu item.
 *
 * @property disabled - Whether the item is disabled
 * @property icon - Font Awesome solid icon name rendered before the label
 * @property command - Keyboard accelerator shown right-aligned in mono
 * @property destructive - Whether the action is destructive (negative ink)
 */
export interface MenuItemOptions {
    /** Whether the item is disabled */
    disabled?: SubtypeExprOrValue<typeof BooleanType>;
    /** Font Awesome solid icon name rendered before the label (the icon set is `fas`-only per the spec) */
    icon?: IconName | ExprType<StringType>;
    /** Keyboard accelerator shown right-aligned in mono (e.g. `"⌘D"`) */
    command?: SubtypeExprOrValue<typeof StringType>;
    /** Whether the action is destructive — renders in the negative ink */
    destructive?: SubtypeExprOrValue<typeof BooleanType>;
}

// ============================================================================
// Menu Style Type
// ============================================================================

/**
 * Visual-only style struct for Menu.
 *
 * @remarks
 * The visual fields (placement) live in `style`, not on the
 * main struct.
 *
 * @property placement - Where to position the menu relative to the trigger
 */
export const MenuStyleType = StructType({
    placement: OptionType(PlacementType),
});

/**
 * Type representing the MenuStyle structure.
 */
export type MenuStyleType = typeof MenuStyleType;

// ============================================================================
// Menu Style Interface
// ============================================================================

/**
 * TypeScript interface for Menu style options.
 *
 * @property placement - Where to position the menu relative to the trigger
 */
export interface MenuStyle {
    /** Where to position the menu relative to the trigger */
    placement?: SubtypeExprOrValue<PlacementType> | PlacementLiteral;
}
