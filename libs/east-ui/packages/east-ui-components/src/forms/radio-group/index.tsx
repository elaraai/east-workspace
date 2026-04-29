/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useState, useEffect } from "react";
import { RadioGroup as ChakraRadioGroup, HStack, VStack } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { RadioGroup } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const radioGroupEqual = equalFor(RadioGroup.Types.Root);

export type RadioGroupValue = ValueTypeOf<typeof RadioGroup.Types.Root>;

export interface EastChakraRadioGroupProps {
    value: RadioGroupValue;
}

/**
 * Renders an East UI RadioGroup value using Chakra UI's RadioGroup
 * primitive. The IR `value` is the currently-selected item value
 * (empty string when nothing selected). Selection updates fire the
 * East-side `onChange` with the new value.
 */
export const EastChakraRadioGroup = memo(function EastChakraRadioGroup({ value }: EastChakraRadioGroupProps) {
    const style = getSomeorUndefined(value.style);
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;
    const size = style ? getSomeorUndefined(style.size)?.type : undefined;
    const orientationTag = style ? getSomeorUndefined(style.orientation)?.type : undefined;
    const orientation: "horizontal" | "vertical" = orientationTag === "horizontal" ? "horizontal" : "vertical";
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const fillColor = style ? getSomeorUndefined(style.fillColor) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;

    const onChangeFn = getSomeorUndefined(value.onChange);
    const groupDisabled = getSomeorUndefined(value.disabled);
    const required = getSomeorUndefined(value.required);
    const name = getSomeorUndefined(value.name);

    const [localValue, setLocalValue] = useState<string>(value.value);
    useEffect(() => { setLocalValue(value.value); }, [value.value]);

    const handleChange = useCallback((details: { value: string | null }) => {
        const next = details.value ?? "";
        setLocalValue(next);
        if (onChangeFn) queueMicrotask(() => onChangeFn(next));
    }, [onChangeFn]);

    const Stack = orientation === "horizontal" ? HStack : VStack;

    return (
        <ChakraRadioGroup.Root
            value={localValue}
            onValueChange={handleChange}
            colorPalette={colorPalette}
            size={size}
            disabled={groupDisabled}
            required={required}
            name={name}
            orientation={orientation}
        >
            <Stack gap="3" align={orientation === "vertical" ? "start" : undefined}>
                {value.items.map((item) => {
                    const itemDisabled = getSomeorUndefined(item.disabled) ?? false;
                    const label = getSomeorUndefined(item.label) ?? item.value;
                    // Chakra v3 RadioGroup: the indicator's checked-fill comes
                    // from `bg`, the unchecked ring from `borderColor`, the
                    // text from the parent Item's `color`. Inline `style`
                    // would lose to Chakra's CSS classes; using props instead
                    // lets emotion compose the override.
                    return (
                        <ChakraRadioGroup.Item
                            key={item.value}
                            value={item.value}
                            disabled={itemDisabled || groupDisabled}
                            color={color}
                        >
                            <ChakraRadioGroup.ItemHiddenInput />
                            <ChakraRadioGroup.ItemIndicator
                                bg={fillColor}
                                borderColor={borderColor}
                            />
                            <ChakraRadioGroup.ItemText>
                                {label}
                            </ChakraRadioGroup.ItemText>
                        </ChakraRadioGroup.Item>
                    );
                })}
            </Stack>
        </ChakraRadioGroup.Root>
    );
}, (prev, next) => radioGroupEqual(prev.value, next.value));
