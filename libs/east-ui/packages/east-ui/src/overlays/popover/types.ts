/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    NullType,
    BooleanType,
    IntegerType,
    VariantType,
    StringType,
    FunctionType,
} from "@elaraai/east";

import { PlacementType, type PlacementLiteral } from "../tooltip/types.js";

// Re-export PlacementType
export { PlacementType, type PlacementLiteral } from "../tooltip/types.js";

// ============================================================================
// Popover Size Type
// ============================================================================

/**
 * Size variant type for Popover component.
 *
 * @property xs - Extra small padding
 * @property sm - Small padding
 * @property md - Medium padding (default)
 * @property lg - Large padding
 */
export const PopoverSizeType = VariantType({
    xs: NullType,
    sm: NullType,
    md: NullType,
    lg: NullType,
});

export type PopoverSizeType = typeof PopoverSizeType;
export type PopoverSizeLiteral = "xs" | "sm" | "md" | "lg";

// ============================================================================
// Popover Style Type
// ============================================================================

/**
 * Style type for Popover component.
 *
 * @property size - Popover size variant
 * @property placement - Position relative to trigger
 * @property hasArrow - Show arrow pointing to trigger
 * @property gutter - Offset from trigger in pixels
 * @property open - Controlled open state — pair with `onOpenChange`
 * @property defaultOpen - Initial open state, uncontrolled
 * @property closeOnInteractOutside - Close when clicking outside
 * @property closeOnEscape - Close on escape key
 * @property autoFocus - Focus the first focusable element on open
 * @property lazyMount - Delay mounting until first open
 * @property unmountOnExit - Unmount when closed
 * @property onOpenChange - Callback triggered when open state changes
 */
export const PopoverStyleType = StructType({
    size: OptionType(PopoverSizeType),
    placement: OptionType(PlacementType),
    hasArrow: OptionType(BooleanType),
    gutter: OptionType(IntegerType),
    open: OptionType(BooleanType),
    defaultOpen: OptionType(BooleanType),
    closeOnInteractOutside: OptionType(BooleanType),
    closeOnEscape: OptionType(BooleanType),
    autoFocus: OptionType(BooleanType),
    lazyMount: OptionType(BooleanType),
    unmountOnExit: OptionType(BooleanType),
    /** Callback triggered when open state changes */
    onOpenChange: OptionType(FunctionType([BooleanType], NullType)),
});

export type PopoverStyleType = typeof PopoverStyleType;

// ============================================================================
// Popover Style Interface
// ============================================================================

/**
 * TypeScript interface for Popover style options.
 *
 * @property size - Popover size variant
 * @property placement - Position relative to trigger
 * @property hasArrow - Show arrow pointing to trigger
 * @property gutter - Offset from trigger in pixels
 * @property title - Popover title
 * @property description - Popover description
 * @property open - Controlled open state — pair with `onOpenChange`
 * @property defaultOpen - Initial open state
 * @property closeOnInteractOutside - Close when clicking outside
 * @property closeOnEscape - Close on escape key
 * @property autoFocus - Auto-focus first focusable element
 * @property lazyMount - Delay mounting until first open
 * @property unmountOnExit - Unmount when closed
 * @property onOpenChange - Callback triggered when open state changes
 */
export interface PopoverStyle {
    /** Popover size variant */
    size?: SubtypeExprOrValue<PopoverSizeType> | PopoverSizeLiteral;
    /** Position relative to trigger */
    placement?: SubtypeExprOrValue<PlacementType> | PlacementLiteral;
    /** Show arrow pointing to trigger */
    hasArrow?: SubtypeExprOrValue<BooleanType>;
    /** Offset from trigger in pixels */
    gutter?: SubtypeExprOrValue<IntegerType>;
    /** Popover title */
    title?: SubtypeExprOrValue<StringType>;
    /** Popover description */
    description?: SubtypeExprOrValue<StringType>;
    /**
     * Controlled open state — pair with `onOpenChange`. A callback anywhere
     * opens the popover, at its own trigger, by writing the State this reads.
     */
    open?: SubtypeExprOrValue<BooleanType>;
    /** Initial open state */
    defaultOpen?: SubtypeExprOrValue<BooleanType>;
    /** Close when clicking outside */
    closeOnInteractOutside?: SubtypeExprOrValue<BooleanType>;
    /** Close on escape key */
    closeOnEscape?: SubtypeExprOrValue<BooleanType>;
    /** Auto-focus first focusable element */
    autoFocus?: SubtypeExprOrValue<BooleanType>;
    /** Delay mounting until first open */
    lazyMount?: SubtypeExprOrValue<BooleanType>;
    /** Unmount when closed */
    unmountOnExit?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when open state changes */
    onOpenChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
}
