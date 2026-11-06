/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useMemo, useState, useEffect } from "react";
import { RadioGroup as ChakraRadioGroup, HStack, VStack } from "@chakra-ui/react";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { RadioGroup } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

const radioGroupEqual = equivalentFor(RadioGroup.Types.Root);

/** A RadioGroup, decoded: east-ui's `RadioGroup.Types.Root`. */
export type RadioGroupValue = ValueTypeOf<typeof RadioGroup.Types.Root>;

/** Props of {@link EastChakraRadioGroup}. */
export interface EastChakraRadioGroupProps {
    /** The group: its items, the one chosen, its style and what a choice calls. */
    value: RadioGroupValue;
    /** The id of the element that names the group — a question over it, a panel's title — for a host that draws its own label. */
    labelledBy?: string | undefined;
}

/**
 * Renders an East UI RadioGroup value using Chakra UI's RadioGroup
 * primitive. The IR `value` is the currently-selected item value
 * (empty string when nothing selected). Selection updates fire the
 * East-side `onChange` with the new value.
 *
 * @param props - The group, and the id of what names it ({@link EastChakraRadioGroupProps})
 * @returns The group
 */
export const EastChakraRadioGroup = memo(function EastChakraRadioGroup({ value, labelledBy }: EastChakraRadioGroupProps) {
    const style = getSomeorUndefined(value.style);
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;
    const size = style ? getSomeorUndefined(style.size)?.type : undefined;
    const orientationTag = style ? getSomeorUndefined(style.orientation)?.type : undefined;
    const orientation: "horizontal" | "vertical" = orientationTag === "horizontal" ? "horizontal" : "vertical";
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const fillColor = style ? getSomeorUndefined(style.fillColor) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;

    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
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
            colorPalette={colorPalette ?? "brand"}
            size={size}
            disabled={groupDisabled}
            required={required}
            name={name}
            orientation={orientation}
            aria-labelledby={labelledBy}
        >
            <Stack gap="3" align={orientation === "vertical" ? "start" : undefined}>
                {value.items.map((item) => {
                    const itemDisabled = getSomeorUndefined(item.disabled) ?? false;
                    const label = getSomeorUndefined(item.label) ?? item.value;
                    // The radio is outlined-with-dot, never a filled disc:
                    // `fillColor` is the selected accent (checked ring + dot, via
                    // `_checked`), `borderColor` the unchecked ring, `color` the
                    // label. Props (not inline `style`) so emotion composes over
                    // the recipe's checked rules.
                    return (
                        <ChakraRadioGroup.Item
                            key={item.value}
                            value={item.value}
                            disabled={itemDisabled || groupDisabled}
                            color={color}
                        >
                            <ChakraRadioGroup.ItemHiddenInput />
                            <ChakraRadioGroup.ItemIndicator
                                borderColor={borderColor}
                                {...(fillColor ? { _checked: { color: fillColor, borderColor: fillColor } } : {})}
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
}, (prev, next) => radioGroupEqual(prev.value, next.value) && prev.labelledBy === next.labelledBy);
