/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    IntegerType,
    BooleanType,
    FunctionType,
    NullType,
} from "@elaraai/east";

import { OrientationType } from "../../style.js";
import type { OrientationLiteral } from "../../style.js";

// Re-export OrientationType for convenience
export { OrientationType, type OrientationLiteral } from "../../style.js";

// ============================================================================
// Carousel Style Type
// ============================================================================

/**
 * Visual-only style struct for Carousel.
 *
 * @remarks
 * Holds the geometric preset (`orientation`), the viewport padding,
 * plus colour escape hatches for the indicator and prev/next control
 * slots.
 *
 * @property orientation - Slide direction (horizontal / vertical)
 * @property padding - Viewport padding (CSS length / Chakra spacing token)
 * @property indicatorColor - Indicator dot colour (unselected)
 * @property activeIndicatorColor - Indicator dot colour for the active slide
 * @property controlColor - Prev/next arrow glyph colour
 * @property controlBackground - Prev/next arrow button background
 */
export const CarouselStyleType = StructType({
    orientation: OptionType(OrientationType),
    padding: OptionType(StringType),
    indicatorColor: OptionType(StringType),
    activeIndicatorColor: OptionType(StringType),
    controlColor: OptionType(StringType),
    controlBackground: OptionType(StringType),
});

/**
 * Type representing the CarouselStyle structure.
 */
export type CarouselStyleType = typeof CarouselStyleType;

// ============================================================================
// Carousel Style Interface
// ============================================================================

/**
 * TypeScript options bag for Carousel's `style` sub-struct — visual props only.
 *
 * @property orientation - Slide direction (horizontal / vertical)
 * @property padding - Viewport padding (CSS length / Chakra spacing token)
 * @property indicatorColor - Indicator dot colour (unselected)
 * @property activeIndicatorColor - Active-slide indicator dot colour
 * @property controlColor - Prev/next arrow glyph colour
 * @property controlBackground - Prev/next arrow button background
 */
export interface CarouselStyle {
    /** Slide direction */
    orientation?: SubtypeExprOrValue<OrientationType> | OrientationLiteral;
    /** Viewport padding (CSS length / Chakra spacing token) */
    padding?: SubtypeExprOrValue<StringType>;
    /** Indicator dot colour (unselected) */
    indicatorColor?: SubtypeExprOrValue<StringType>;
    /** Active-slide indicator dot colour */
    activeIndicatorColor?: SubtypeExprOrValue<StringType>;
    /** Prev/next arrow glyph colour */
    controlColor?: SubtypeExprOrValue<StringType>;
    /** Prev/next arrow button background */
    controlBackground?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript options bag for `Carousel.Root`.
 *
 * @remarks
 * State (`index` / `defaultIndex`), config (`loop` / `autoplay` /
 * `slidesPerView` / `slidesPerMove` / `allowMouseDrag` / `showIndicators` /
 * `showControls` / `spacing`), and behaviour (`onIndexChange`) live at
 * the top level. Visual presentation (including `padding`) lives inside
 * the nested `style` object.
 *
 * @property index - Controlled current slide index
 * @property defaultIndex - Initial slide index (uncontrolled)
 * @property slidesPerView - Number of visible slides
 * @property slidesPerMove - Number of slides to advance per step
 * @property loop - Whether to enable infinite scrolling
 * @property autoplay - Whether to enable automatic advancement
 * @property allowMouseDrag - Whether to allow mouse drag navigation
 * @property showIndicators - Whether to show dot indicators
 * @property showControls - Whether to show prev/next controls
 * @property spacing - Gap between slides (Chakra spacing token)
 * @property onIndexChange - Callback invoked when the active slide changes
 * @property style - Visual-presentation sub-struct
 */
export interface CarouselOptions extends CarouselStyle {
    /** Controlled current slide index */
    index?: SubtypeExprOrValue<IntegerType>;
    /** Initial slide index (uncontrolled) */
    defaultIndex?: SubtypeExprOrValue<IntegerType>;
    /** Number of visible slides */
    slidesPerView?: SubtypeExprOrValue<IntegerType>;
    /** Number of slides to advance per step */
    slidesPerMove?: SubtypeExprOrValue<IntegerType>;
    /** Whether to enable infinite scrolling */
    loop?: SubtypeExprOrValue<BooleanType>;
    /** Whether to enable automatic advancement */
    autoplay?: SubtypeExprOrValue<BooleanType>;
    /** Whether to allow mouse drag navigation */
    allowMouseDrag?: SubtypeExprOrValue<BooleanType>;
    /** Whether to show dot indicators */
    showIndicators?: SubtypeExprOrValue<BooleanType>;
    /** Whether to show prev/next controls */
    showControls?: SubtypeExprOrValue<BooleanType>;
    /** Gap between slides (Chakra spacing token) */
    spacing?: SubtypeExprOrValue<StringType>;
    /** Callback invoked when the active slide changes */
    onIndexChange?: SubtypeExprOrValue<FunctionType<[IntegerType], NullType>>;
}
