/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useEffect } from "react";
import { Slider as ChakraSlider, type ConditionalValue, type SliderRootProps, type SliderValueChangeDetails } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Slider } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

// Pre-define equality function at module level
const sliderEqual = equalFor(Slider.Types.Slider);

/** East Slider value type */
export type SliderValue = ValueTypeOf<typeof Slider.Types.Slider>;

/**
 * Converts an East UI Slider value to Chakra UI Slider props.
 * Pure function - easy to test independently.
 */
export function toChakraSlider(value: SliderValue): SliderRootProps {
    const style = getSomeorUndefined(value.style);
    const orientation = style ? getSomeorUndefined(style.orientation)?.type : undefined;
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;
    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;
    const variantTag = style ? getSomeorUndefined(style.variant)?.type : undefined;

    return {
        value: [value.value],
        min: getSomeorUndefined(value.min),
        max: getSomeorUndefined(value.max),
        step: getSomeorUndefined(value.step),
        orientation,
        colorPalette: colorPalette ?? "brand",
        size: sizeTag as ConditionalValue<"sm" | "md" | "lg" | undefined>,
        variant: variantTag as ConditionalValue<"outline" | "solid" | undefined>,
        disabled: getSomeorUndefined(value.disabled),
    };
}

export interface EastChakraSliderProps {
    value: SliderValue;
}

/**
 * Renders an East UI Slider value using Chakra UI Slider component.
 */
export const EastChakraSlider = memo(function EastChakraSlider({ value }: EastChakraSliderProps) {
    const [props, setProps] = useState(toChakraSlider(value));
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const onChangeEndFn = useMemo(() => getSomeorUndefined(value.onChangeEnd), [value.onChangeEnd]);

    useEffect(() => {
        setProps(() => toChakraSlider(value))
    }, [value]); // Re-run effect if value object reference changes

    const handleValueChange = useCallback((details: SliderValueChangeDetails) => {
        setProps(prev => ({ ...prev, value: details.value }))
        if (onChangeFn && details.value.length > 0) {
            queueMicrotask(() => onChangeFn(details.value[0]!));
        }
    }, [onChangeFn]);

    const handleValueChangeEnd = useCallback((details: SliderValueChangeDetails) => {
        setProps(prev => ({ ...prev, value: details.value }))
        if (onChangeEndFn && details.value.length > 0) {
            queueMicrotask(() => onChangeEndFn(details.value[0]!));
        }
    }, [onChangeEndFn]);

    return (
        <ChakraSlider.Root
            {...props}
            width="100%"
            thumbAlignment="center"
            onValueChange={handleValueChange}
            onValueChangeEnd={handleValueChangeEnd}
        >
            <ChakraSlider.Control>
                <ChakraSlider.Track>
                    <ChakraSlider.Range />
                </ChakraSlider.Track>
                <ChakraSlider.Thumbs />
            </ChakraSlider.Control>
        </ChakraSlider.Root>
    );
}, (prev, next) => sliderEqual(prev.value, next.value));
