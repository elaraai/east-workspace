/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
    Carousel as ChakraCarousel,
    type CarouselRootProps,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Carousel } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const carouselEqual = equalFor(Carousel.Types.Carousel);

/** East Carousel value type */
export type CarouselValue = ValueTypeOf<typeof Carousel.Types.Carousel>;

/**
 * Converts an East UI Carousel value to Chakra UI CarouselRoot props.
 *
 * @remarks
 * `spacing` lives on main (gap-between-slides). `orientation` and
 * `padding` come from `style` — colour slots also live in `style` and
 * are applied via CSS on sub-components in the renderer body.
 */
export function toChakraCarousel(value: CarouselValue): CarouselRootProps {
    const style = getSomeorUndefined(value.style);
    const slidesPerView = getSomeorUndefined(value.slidesPerView);
    const slidesPerMove = getSomeorUndefined(value.slidesPerMove);
    const defaultIndex = getSomeorUndefined(value.defaultIndex);
    const index = getSomeorUndefined(value.index);

    return {
        slideCount: value.items.length,
        orientation: style ? getSomeorUndefined(style.orientation)?.type : undefined,
        gap: getSomeorUndefined(value.spacing),
        padding: style ? getSomeorUndefined(style.padding) : undefined,
        loop: getSomeorUndefined(value.loop),
        autoplay: getSomeorUndefined(value.autoplay),
        allowMouseDrag: getSomeorUndefined(value.allowMouseDrag),
        ...(slidesPerView !== undefined && { slidesPerPage: Number(slidesPerView) }),
        ...(slidesPerMove !== undefined && { slidesPerMove: Number(slidesPerMove) }),
        ...(defaultIndex !== undefined && { defaultPage: Number(defaultIndex) }),
        ...(index !== undefined && { page: Number(index) }),
    };
}

interface CarouselPersistedState {
    currentPage: number;
}

export interface EastChakraCarouselProps {
    value: CarouselValue;
    /** Storage key for persisting current slide in localStorage. Omit for ephemeral state. */
    storageKey: string;
}

/**
 * Renders an East UI Carousel value using Chakra UI Carousel components.
 */
export const EastChakraCarousel = memo(function EastChakraCarousel({ value, storageKey }: EastChakraCarouselProps) {
    const props = useMemo(() => toChakraCarousel(value), [value]);
    const showControls = getSomeorUndefined(value.showControls) ?? true;
    const showIndicators = getSomeorUndefined(value.showIndicators) ?? true;
    const onIndexChangeFn = useMemo(
        () => getSomeorUndefined(value.onIndexChange),
        [value.onIndexChange],
    );

    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const indicatorColor = style ? getSomeorUndefined(style.indicatorColor) : undefined;
    const activeIndicatorColor = style ? getSomeorUndefined(style.activeIndicatorColor) : undefined;
    const controlColor = style ? getSomeorUndefined(style.controlColor) : undefined;
    const controlBackground = style ? getSomeorUndefined(style.controlBackground) : undefined;

    const defaultPage = useMemo(() => {
        const idx = getSomeorUndefined(value.defaultIndex);
        return idx !== undefined ? Number(idx) : 0;
    }, [value.defaultIndex]);

    const { state: persistedState, setState: setPersistedState } = usePersistedState<CarouselPersistedState>(
        storageKey,
        { currentPage: defaultPage },
    );

    const handlePageChange = useCallback((details: { page: number }) => {
        setPersistedState(prev => ({ ...prev, currentPage: details.page }));
        if (onIndexChangeFn) {
            queueMicrotask(() => onIndexChangeFn(BigInt(details.page)));
        }
    }, [onIndexChangeFn, setPersistedState]);

    const effectivePage = useMemo(
        () => persistedState.currentPage,
        [persistedState.currentPage],
    );

    return (
        <ChakraCarousel.Root {...props} page={effectivePage} onPageChange={handlePageChange}>
            <ChakraCarousel.ItemGroup>
                {value.items.map((item, index) => (
                    <ChakraCarousel.Item key={index} index={index}>
                        <EastChakraComponent value={item} storageKey={`${storageKey}.${index}`} />
                    </ChakraCarousel.Item>
                ))}
            </ChakraCarousel.ItemGroup>
            {showControls && (
                <ChakraCarousel.Control>
                    <ChakraCarousel.PrevTrigger
                        aria-label="Previous slide"
                        {...(controlColor !== undefined ? { color: controlColor } : {})}
                        {...(controlBackground !== undefined ? { bg: controlBackground } : {})}
                    >
                        <FontAwesomeIcon icon={faChevronLeft} />
                    </ChakraCarousel.PrevTrigger>
                    <ChakraCarousel.NextTrigger
                        aria-label="Next slide"
                        {...(controlColor !== undefined ? { color: controlColor } : {})}
                        {...(controlBackground !== undefined ? { bg: controlBackground } : {})}
                    >
                        <FontAwesomeIcon icon={faChevronRight} />
                    </ChakraCarousel.NextTrigger>
                </ChakraCarousel.Control>
            )}
            {showIndicators && (
                <ChakraCarousel.IndicatorGroup>
                    {value.items.map((_, index) => (
                        <ChakraCarousel.Indicator
                            key={index}
                            index={index}
                            {...(indicatorColor !== undefined ? { bg: indicatorColor } : {})}
                            {...(activeIndicatorColor !== undefined
                                ? { _selected: { bg: activeIndicatorColor } }
                                : {})}
                        />
                    ))}
                </ChakraCarousel.IndicatorGroup>
            )}
        </ChakraCarousel.Root>
    );
}, (prev, next) => carouselEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
