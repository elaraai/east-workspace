/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    variant,
    ArrayType,
    OptionType,
    StructType,
    StringType,
    IntegerType,
    BooleanType,
    FunctionType,
    NullType,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { OrientationType } from "../../style.js";
import {
    CarouselStyleType,
    type CarouselStyle,
    type CarouselOptions,
} from "./types.js";

// Re-export types
export {
    CarouselStyleType,
    OrientationType,
    type CarouselStyle,
    type CarouselOptions,
    type OrientationLiteral,
} from "./types.js";

// ============================================================================
// CarouselType — standalone mirror of the inline `Carousel` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `Carousel` variant in `component.ts`.
 * Renderers reference this for `equalFor` / `ValueTypeOf`.
 *
 * @property items - Array of carousel slide items (UIComp)
 * @property index - Controlled current slide index
 * @property defaultIndex - Initial slide index (uncontrolled)
 * @property slidesPerView - Number of visible slides
 * @property slidesPerMove - Number of slides to advance per step
 * @property loop - Enable infinite scrolling
 * @property autoplay - Enable automatic advancement
 * @property allowMouseDrag - Allow mouse drag navigation
 * @property showIndicators - Show dot indicators
 * @property showControls - Show prev/next controls
 * @property spacing - Gap between slides (Chakra spacing token)
 * @property onIndexChange - Callback invoked when the active slide changes
 * @property style - Visual-presentation sub-struct (includes `padding`)
 */
export const CarouselType: StructType<{
    items: ArrayType<UIComponentType>,
    index: OptionType<IntegerType>,
    defaultIndex: OptionType<IntegerType>,
    slidesPerView: OptionType<IntegerType>,
    slidesPerMove: OptionType<IntegerType>,
    loop: OptionType<BooleanType>,
    autoplay: OptionType<BooleanType>,
    allowMouseDrag: OptionType<BooleanType>,
    showIndicators: OptionType<BooleanType>,
    showControls: OptionType<BooleanType>,
    spacing: OptionType<StringType>,
    onIndexChange: OptionType<FunctionType<[IntegerType], NullType>>,
    style: OptionType<CarouselStyleType>,
}> = StructType({
    items: ArrayType(UIComponentType),
    index: OptionType(IntegerType),
    defaultIndex: OptionType(IntegerType),
    slidesPerView: OptionType(IntegerType),
    slidesPerMove: OptionType(IntegerType),
    loop: OptionType(BooleanType),
    autoplay: OptionType(BooleanType),
    allowMouseDrag: OptionType(BooleanType),
    showIndicators: OptionType(BooleanType),
    showControls: OptionType(BooleanType),
    spacing: OptionType(StringType),
    onIndexChange: OptionType(FunctionType([IntegerType], NullType)),
    style: OptionType(CarouselStyleType),
});

export type CarouselType = typeof CarouselType;

// ============================================================================
// Carousel Factory
// ============================================================================

/**
 * Creates a Carousel component.
 *
 * @param items - Array of UIComp slides (one UIComp per slide)
 * @param options - State + config + behaviour + optional `style`
 * @returns An East expression representing the Carousel component
 *
 * @remarks
 * Note: state (`index` / `defaultIndex`), config
 * (`loop` / `autoplay` / `slidesPerView` / `slidesPerMove` /
 * `allowMouseDrag` / `showIndicators` / `showControls` / `spacing`), and
 * behaviour (`onIndexChange`) are top-level options — visual presentation
 * (`orientation`, `padding`, indicator/control colour slots) lives inside
 * `options.style`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Carousel, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Carousel.Root(
 *         [Text.Root("Slide 1"), Text.Root("Slide 2"), Text.Root("Slide 3")],
 *         {
 *             defaultIndex: 0n,
 *             slidesPerView: 1n,
 *             loop: true,
 *             showIndicators: true,
 *             showControls: true,
 *             spacing: "4",
 *             style: { orientation: "horizontal", padding: "2", activeIndicatorColor: "#3d5cff" },
 *         },
 *     ),
 * );
 * ```
 */
function createCarousel(
    items: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options?: CarouselOptions,
): ExprType<UIComponentType> {
    const opts: CarouselOptions = options ?? {};
    const {
        index, defaultIndex, slidesPerView, slidesPerMove, loop, autoplay,
        allowMouseDrag, showIndicators, showControls, spacing, onIndexChange, ...visual
    } = opts;
    const styleValue = Object.values(visual).some(field => field !== undefined)
        ? buildCarouselStyle(opts)
        : undefined;

    return East.value(variant("Carousel", {
        items,
        index: index !== undefined ? some(index) : none,
        defaultIndex: defaultIndex !== undefined ? some(defaultIndex) : none,
        slidesPerView: slidesPerView !== undefined ? some(slidesPerView) : none,
        slidesPerMove: slidesPerMove !== undefined ? some(slidesPerMove) : none,
        loop: loop !== undefined ? some(loop) : none,
        autoplay: autoplay !== undefined ? some(autoplay) : none,
        allowMouseDrag: allowMouseDrag !== undefined ? some(allowMouseDrag) : none,
        showIndicators: showIndicators !== undefined ? some(showIndicators) : none,
        showControls: showControls !== undefined ? some(showControls) : none,
        spacing: spacing !== undefined ? some(spacing) : none,
        onIndexChange: onIndexChange ? some(onIndexChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildCarouselStyle(style: CarouselStyle): ExprType<CarouselStyleType> {
    const orientationValue = style.orientation
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation, null), OrientationType)
            : style.orientation)
        : undefined;

    return East.value({
        orientation: orientationValue ? some(orientationValue) : none,
        padding: style.padding !== undefined ? some(style.padding) : none,
        indicatorColor: style.indicatorColor !== undefined ? some(style.indicatorColor) : none,
        activeIndicatorColor: style.activeIndicatorColor !== undefined ? some(style.activeIndicatorColor) : none,
        controlColor: style.controlColor !== undefined ? some(style.controlColor) : none,
        controlBackground: style.controlBackground !== undefined ? some(style.controlBackground) : none,
    }, CarouselStyleType);
}

// ============================================================================
// Carousel Namespace
// ============================================================================

/**
 * Carousel primitive — horizontal (or vertical) slideshow of UIComp slides.
 *
 * @remarks
 * Use `Carousel.Root(items, options)` to create a carousel, or access
 * `Carousel.Types.Carousel` for the East type. State + config + behaviour
 * sit at the top level; `style` holds the `orientation` preset and colour
 * escape hatches.
 */
export const Carousel = {
    /**
     * Creates a Carousel component.
     *
     * @param items - Array of UIComp slides
     * @param options - State + config + behaviour + optional `style`
     * @returns An East expression representing the Carousel component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Carousel, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Carousel.Root(
     *         [Text.Root("A"), Text.Root("B"), Text.Root("C")],
     *         { defaultIndex: 0n, loop: true, showIndicators: true, spacing: "4" },
     *     ),
     * );
     * ```
     */
    Root: createCarousel,
    Types: {
        /**
         * The concrete East type for the Carousel — mirrors the inline
         * `Carousel` variant in `component.ts`.
         */
        Carousel: CarouselType,
        /**
         * Visual-only style struct for Carousel. See {@link CarouselStyleType}.
         */
        Style: CarouselStyleType,
    },
} as const;
