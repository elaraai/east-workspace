/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, variant, VariantType, type ExprType } from "@elaraai/east";

// ============================================================================
// Orientation
// ============================================================================

/**
 * Orientation variant type for layout direction.
 *
 * @remarks
 * Create instances using the {@link Orientation} function.
 *
 * @property horizontal - Horizontal layout (left to right)
 * @property vertical - Vertical layout (top to bottom)
 */
export const OrientationType = VariantType({
    horizontal: NullType,
    vertical: NullType,
});

/**
 * Type representing orientation variant values.
 */
export type OrientationType = typeof OrientationType;

/**
 * String literal type for orientation values.
 */
export type OrientationLiteral = "horizontal" | "vertical";

/**
 * Creates an orientation variant expression.
 *
 * @param orientation - The orientation value
 * @returns An East expression representing the orientation
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Orientation("horizontal");
 * ```
 */
export function Orientation(orientation: "horizontal" | "vertical"): ExprType<OrientationType> {
    return East.value(variant(orientation, null), OrientationType);
}

// ============================================================================
// Flex Direction
// ============================================================================

/**
 * Flex direction variant type for flexbox layouts.
 *
 * @remarks
 * Create instances using the {@link FlexDirection} function.
 *
 * @property row - Row direction (horizontal, left to right)
 * @property column - Column direction (vertical, top to bottom)
 * @property row-reverse - Row direction reversed (horizontal, right to left)
 * @property column-reverse - Column direction reversed (vertical, bottom to top)
 */
export const FlexDirectionType = VariantType({
    row: NullType,
    column: NullType,
    "row-reverse": NullType,
    "column-reverse": NullType,
});

/**
 * Type representing flex direction variant values.
 */
export type FlexDirectionType = typeof FlexDirectionType;

/**
 * String literal type for flex direction values.
 */
export type FlexDirectionLiteral = "row" | "column" | "row-reverse" | "column-reverse";

/**
 * Creates a flex direction variant expression.
 *
 * @param direction - The flex direction value
 * @returns An East expression representing the flex direction
 */
export function FlexDirection(direction: "row" | "column" | "row-reverse" | "column-reverse"): ExprType<FlexDirectionType> {
    return East.value(variant(direction, null), FlexDirectionType);
}

// ============================================================================
// Justify Content
// ============================================================================

/**
 * Justify content variant type for flexbox/grid alignment.
 *
 * @remarks
 * Create instances using the {@link JustifyContent} function.
 *
 * @property flex-start - Align items to the start
 * @property flex-end - Align items to the end
 * @property center - Center items
 * @property space-between - Distribute items with space between
 * @property space-around - Distribute items with space around
 * @property space-evenly - Distribute items with equal space
 */
export const JustifyContentType = VariantType({
    "flex-start": NullType,
    "flex-end": NullType,
    center: NullType,
    "space-between": NullType,
    "space-around": NullType,
    "space-evenly": NullType,
});

/**
 * Type representing justify content variant values.
 */
export type JustifyContentType = typeof JustifyContentType;

/**
 * String literal type for justify content values.
 */
export type JustifyContentLiteral = "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly";

/**
 * Creates a justify content variant expression.
 *
 * @param justify - The justify content value
 * @returns An East expression representing the justify content
 */
export function JustifyContent(justify: "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly"): ExprType<JustifyContentType> {
    return East.value(variant(justify, null), JustifyContentType);
}

// ============================================================================
// Align Items
// ============================================================================

/**
 * Align items variant type for flexbox/grid cross-axis alignment.
 *
 * @remarks
 * Create instances using the {@link AlignItems} function.
 *
 * @property flex-start - Align items to the start of the cross axis
 * @property flex-end - Align items to the end of the cross axis
 * @property center - Center items on the cross axis
 * @property baseline - Align items to text baseline
 * @property stretch - Stretch items to fill the container
 */
export const AlignItemsType = VariantType({
    "flex-start": NullType,
    "flex-end": NullType,
    center: NullType,
    baseline: NullType,
    stretch: NullType,
});

/**
 * Type representing align items variant values.
 */
export type AlignItemsType = typeof AlignItemsType;

/**
 * String literal type for align items values.
 */
export type AlignItemsLiteral = "flex-start" | "flex-end" | "center" | "baseline" | "stretch";

/**
 * Creates an align items variant expression.
 *
 * @param align - The align items value
 * @returns An East expression representing the align items
 */
export function AlignItems(align: "flex-start" | "flex-end" | "center" | "baseline" | "stretch"): ExprType<AlignItemsType> {
    return East.value(variant(align, null), AlignItemsType);
}

// ============================================================================
// Flex Wrap
// ============================================================================

/**
 * Flex wrap variant type for controlling flex item wrapping.
 *
 * @remarks
 * Create instances using the {@link FlexWrap} function.
 *
 * @property nowrap - Items don't wrap
 * @property wrap - Items wrap to next line
 * @property wrap-reverse - Items wrap in reverse order
 */
export const FlexWrapType = VariantType({
    nowrap: NullType,
    wrap: NullType,
    "wrap-reverse": NullType,
});

/**
 * Type representing flex wrap variant values.
 */
export type FlexWrapType = typeof FlexWrapType;

/**
 * String literal type for flex wrap values.
 */
export type FlexWrapLiteral = "nowrap" | "wrap" | "wrap-reverse";

/**
 * Creates a flex wrap variant expression.
 *
 * @param wrap - The flex wrap value
 * @returns An East expression representing the flex wrap
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.FlexWrap("wrap");
 * ```
 */
export function FlexWrap(wrap: "nowrap" | "wrap" | "wrap-reverse"): ExprType<FlexWrapType> {
    return East.value(variant(wrap, null), FlexWrapType);
}

// ============================================================================
// Display
// ============================================================================

/**
 * Display variant type for CSS display property.
 *
 * @remarks
 * Create instances using the {@link Display} function.
 *
 * @property block - Block-level element
 * @property inline - Inline element
 * @property inline-block - Inline-block element
 * @property flex - Flex container
 * @property inline-flex - Inline flex container
 * @property grid - Grid container
 * @property inline-grid - Inline grid container
 * @property none - Hidden element
 */
export const DisplayType = VariantType({
    block: NullType,
    inline: NullType,
    "inline-block": NullType,
    flex: NullType,
    "inline-flex": NullType,
    grid: NullType,
    "inline-grid": NullType,
    none: NullType,
});

/**
 * Type representing display variant values.
 */
export type DisplayType = typeof DisplayType;

/**
 * String literal type for display values.
 */
export type DisplayLiteral = "block" | "inline" | "inline-block" | "flex" | "inline-flex" | "grid" | "inline-grid" | "none";

/**
 * Creates a display variant expression.
 *
 * @param display - The display value
 * @returns An East expression representing the display
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Display("flex");
 * ```
 */
export function Display(display: "block" | "inline" | "inline-block" | "flex" | "inline-flex" | "grid" | "inline-grid" | "none"): ExprType<DisplayType> {
    return East.value(variant(display, null), DisplayType);
}

// ============================================================================
// Overflow
// ============================================================================

/**
 * Overflow variant type for controlling element overflow behavior.
 *
 * @remarks
 * Create instances using the {@link Overflow} function.
 *
 * @property visible - Content is not clipped
 * @property hidden - Content is clipped with no scrollbars
 * @property scroll - Content is clipped with scrollbars always visible
 * @property auto - Content is clipped with scrollbars as needed
 */
export const OverflowType = VariantType({
    visible: NullType,
    hidden: NullType,
    scroll: NullType,
    auto: NullType,
});

/**
 * Type representing overflow variant values.
 */
export type OverflowType = typeof OverflowType;

/**
 * String literal type for overflow values.
 */
export type OverflowLiteral = "visible" | "hidden" | "scroll" | "auto";

/**
 * Creates an overflow variant expression.
 *
 * @param overflow - The overflow value
 * @returns An East expression representing the overflow behavior
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Overflow("hidden");
 * ```
 */
export function Overflow(overflow: "visible" | "hidden" | "scroll" | "auto"): ExprType<OverflowType> {
    return East.value(variant(overflow, null), OverflowType);
}

// ============================================================================
// Position
// ============================================================================

/**
 * Position variant type for CSS `position` property.
 *
 * @remarks
 * Create instances using the {@link Position} function. Unlocks sticky headers
 * / subnavs / action bars, and absolutely-positioned detail drawers inside
 * scrollable panes. Patterns such as `Sticky`, `DecisionBar`, `BatchActionBar`,
 * and `Banner` rely on this token.
 *
 * @property static - Normal document flow (default browser behaviour)
 * @property relative - Positioned relative to its normal position
 * @property absolute - Positioned relative to the nearest positioned ancestor
 * @property fixed - Positioned relative to the viewport
 * @property sticky - Behaves like `relative` until a scroll threshold, then `fixed`
 */
export const PositionType = VariantType({
    static: NullType,
    relative: NullType,
    absolute: NullType,
    fixed: NullType,
    sticky: NullType,
});

/**
 * Type representing position variant values.
 */
export type PositionType = typeof PositionType;

/**
 * String literal type for position values.
 */
export type PositionLiteral = "static" | "relative" | "absolute" | "fixed" | "sticky";

/**
 * Creates a position variant expression.
 *
 * @param position - The CSS position value
 * @returns An East expression representing the position
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Position("sticky");
 * ```
 */
export function Position(position: PositionLiteral): ExprType<PositionType> {
    return East.value(variant(position, null), PositionType);
}

// ============================================================================
// Cursor
// ============================================================================

/**
 * Cursor variant type for CSS `cursor` property.
 *
 * @remarks
 * Create instances using the {@link Cursor} function. Used for help-icon
 * affordances, splitter / resize grips, disabled states, and dnd previews.
 *
 * @property auto - Browser decides (default)
 * @property default - Platform default arrow
 * @property pointer - Hand cursor — signals a clickable target
 * @property help - Question-mark cursor — signals an info affordance
 * @property wait - Hourglass cursor — signals blocking work
 * @property not-allowed - Circle-with-slash — signals disabled target
 * @property text - I-beam — editable text
 * @property move - Four-arrow — draggable element
 * @property col-resize - Column-resize handle
 * @property row-resize - Row-resize handle
 */
export const CursorType = VariantType({
    auto: NullType,
    default: NullType,
    pointer: NullType,
    help: NullType,
    wait: NullType,
    "not-allowed": NullType,
    text: NullType,
    move: NullType,
    "col-resize": NullType,
    "row-resize": NullType,
});

/**
 * Type representing cursor variant values.
 */
export type CursorType = typeof CursorType;

/**
 * String literal type for cursor values.
 */
export type CursorLiteral =
    | "auto" | "default" | "pointer" | "help" | "wait"
    | "not-allowed" | "text" | "move" | "col-resize" | "row-resize";

/**
 * Creates a cursor variant expression.
 *
 * @param cursor - The CSS cursor value
 * @returns An East expression representing the cursor
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Cursor("help");
 * ```
 */
export function Cursor(cursor: CursorLiteral): ExprType<CursorType> {
    return East.value(variant(cursor, null), CursorType);
}
