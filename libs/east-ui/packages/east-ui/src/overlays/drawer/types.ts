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
    VariantType,
    StringType,
    FunctionType,
} from "@elaraai/east";

// ============================================================================
// Drawer Size Type
// ============================================================================

/**
 * Size variant type for Drawer component.
 *
 * @property xs - Extra small (20rem max width)
 * @property sm - Small (28rem max width)
 * @property md - Medium (32rem max width)
 * @property lg - Large (42rem max width)
 * @property xl - Extra large (56rem max width)
 * @property full - Full viewport
 */
export const DrawerSizeType = VariantType({
    xs: NullType,
    sm: NullType,
    md: NullType,
    lg: NullType,
    xl: NullType,
    full: NullType,
});

export type DrawerSizeType = typeof DrawerSizeType;
export type DrawerSizeLiteral = "xs" | "sm" | "md" | "lg" | "xl" | "full";

// ============================================================================
// Drawer Placement Type
// ============================================================================

/**
 * Placement variant type for Drawer component.
 *
 * @property start - Left side (RTL-aware)
 * @property end - Right side (RTL-aware)
 * @property top - Top edge
 * @property bottom - Bottom edge
 */
export const DrawerPlacementType = VariantType({
    start: NullType,
    end: NullType,
    top: NullType,
    bottom: NullType,
});

export type DrawerPlacementType = typeof DrawerPlacementType;
export type DrawerPlacementLiteral = "start" | "end" | "top" | "bottom";

// ============================================================================
// Drawer Style Type
// ============================================================================

/**
 * Style type for Drawer component.
 *
 * @property size - Drawer size variant
 * @property placement - Edge placement
 * @property contained - Render within parent container
 * @property onOpenChange - Callback triggered when open state changes
 * @property onExitComplete - Callback triggered when exit animation completes
 * @property bodyPadding - CSS padding shorthand for the body (default `"16px 20px"`)
 * @property flush - When `true`, removes body padding (full-bleed); overrides `bodyPadding`
 * @property fillBody - When `true`, body becomes a definite-height flex column so a single `height:100%`/`flex:1` child fills the panel and owns its own scroll
 */
export const DrawerStyleType = StructType({
    size: OptionType(DrawerSizeType),
    placement: OptionType(DrawerPlacementType),
    contained: OptionType(BooleanType),
    /** Callback triggered when open state changes */
    onOpenChange: OptionType(FunctionType([BooleanType], NullType)),
    /** Callback triggered when exit animation completes */
    onExitComplete: OptionType(FunctionType([], NullType)),
    /** CSS padding shorthand for the body (default `"16px 20px"`) */
    bodyPadding: OptionType(StringType),
    /** When `true`, removes body padding (full-bleed); overrides `bodyPadding` */
    flush: OptionType(BooleanType),
    /** When `true`, body becomes a definite-height flex column so a single child fills + owns its scroll */
    fillBody: OptionType(BooleanType),
    /** When `true`, this drawer collapses to a thin vertical rail (icon + rotated title) while a deeper drawer is open on top of it, instead of hiding behind it (#328); clicking the rail pops the stack back to it */
    stacked: OptionType(BooleanType),
    /** Font Awesome icon name shown on the collapsed stack rail (#328); falls back to a chevron */
    stackIcon: OptionType(StringType),
});

export type DrawerStyleType = typeof DrawerStyleType;

// ============================================================================
// Drawer Style Interface
// ============================================================================

/**
 * TypeScript interface for Drawer style options.
 *
 * @property size - Drawer size variant
 * @property placement - Edge placement
 * @property contained - Render within parent container
 * @property eyebrow - Mono uppercase eyebrow above the title
 * @property title - Drawer title
 * @property description - Drawer description
 * @property open - Controlled open state
 * @property defaultOpen - Initial open state
 * @property closeOnInteractOutside - Close when clicking outside
 * @property closeOnEscape - Close on escape key
 * @property lazyMount - Delay mounting until first open
 * @property unmountOnExit - Unmount when closed
 * @property onOpenChange - Callback triggered when open state changes
 * @property onExitComplete - Callback triggered when exit animation completes
 * @property bodyPadding - CSS padding shorthand for the body (default `"16px 20px"`)
 * @property flush - When `true`, removes body padding (full-bleed); overrides `bodyPadding`
 * @property fillBody - When `true`, the body fills the panel height so a single child owns its scroll
 */
export interface DrawerStyle {
    /** Drawer size variant */
    size?: SubtypeExprOrValue<DrawerSizeType> | DrawerSizeLiteral;
    /** Edge placement */
    placement?: SubtypeExprOrValue<DrawerPlacementType> | DrawerPlacementLiteral;
    /** Render within parent container */
    contained?: SubtypeExprOrValue<BooleanType>;
    /** Mono uppercase eyebrow above the title (e.g. the surface or section name) */
    eyebrow?: SubtypeExprOrValue<StringType>;
    /** Drawer title */
    title?: SubtypeExprOrValue<StringType>;
    /** Drawer description */
    description?: SubtypeExprOrValue<StringType>;
    /** Controlled open state */
    open?: SubtypeExprOrValue<BooleanType>;
    /** Initial open state */
    defaultOpen?: SubtypeExprOrValue<BooleanType>;
    /** Close when clicking outside */
    closeOnInteractOutside?: SubtypeExprOrValue<BooleanType>;
    /** Close on escape key */
    closeOnEscape?: SubtypeExprOrValue<BooleanType>;
    /** Delay mounting until first open */
    lazyMount?: SubtypeExprOrValue<BooleanType>;
    /** Unmount when closed */
    unmountOnExit?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when open state changes */
    onOpenChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
    /** Callback triggered when exit animation completes */
    onExitComplete?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** CSS padding shorthand for the body (default `"16px 20px"`). */
    bodyPadding?: SubtypeExprOrValue<StringType>;
    /** When `true`, removes body padding (full-bleed) so a Table / Planner / Chart fills the drawer body. Overrides `bodyPadding`. */
    flush?: SubtypeExprOrValue<BooleanType>;
    /** When `true`, the body is a definite-height flex column (`minHeight:0`, clipped) so a single `height:100%`/`flex:1` child fills the panel and owns its internal scroll instead of the whole panel scrolling. */
    fillBody?: SubtypeExprOrValue<BooleanType>;
    /** When `true`, this drawer collapses to a thin vertical rail (icon + rotated title) while a deeper drawer is open on top of it — instead of hiding behind it — so the stack you drilled through stays a visible, navigable spine (#328). Click the rail to pop back to this drawer (closing the deeper ones); Esc pops one level. */
    stacked?: SubtypeExprOrValue<BooleanType>;
    /** Font Awesome icon name shown on the collapsed stack rail (#328); falls back to a chevron. */
    stackIcon?: SubtypeExprOrValue<StringType>;
}
