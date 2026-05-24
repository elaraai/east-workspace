/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useState, useEffect } from "react";
import { RadioCard as ChakraRadioCard, HStack, VStack } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { RadioCardGroup } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const radioCardGroupEqual = equalFor(RadioCardGroup.Types.Root);

export type RadioCardGroupValue = ValueTypeOf<typeof RadioCardGroup.Types.Root>;

export interface EastChakraRadioCardGroupProps {
    value: RadioCardGroupValue;
}

/**
 * Renders an East UI RadioCardGroup value using Chakra UI's
 * RadioCardGroup primitive (card-style radios with optional
 * description per item).
 */
export const EastChakraRadioCardGroup = memo(function EastChakraRadioCardGroup({ value }: EastChakraRadioCardGroupProps) {
    const style = getSomeorUndefined(value.style);
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;
    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;
    // Chakra's RadioCard size accepts only sm/md/lg — coerce xs → sm.
    const size: "sm" | "md" | "lg" | undefined = sizeTag === "xs" ? "sm" : sizeTag;
    const orientationTag = style ? getSomeorUndefined(style.orientation)?.type : undefined;
    const orientation: "horizontal" | "vertical" = orientationTag === "horizontal" ? "horizontal" : "vertical";
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const descriptionColor = style ? getSomeorUndefined(style.descriptionColor) : undefined;
    const cardBackground = style ? getSomeorUndefined(style.cardBackground) : undefined;
    const selectedCardBackground = style ? getSomeorUndefined(style.selectedCardBackground) : undefined;
    const selectedBorderColor = style ? getSomeorUndefined(style.selectedBorderColor) : undefined;

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
        <ChakraRadioCard.Root
            value={localValue}
            onValueChange={handleChange}
            colorPalette={colorPalette ?? "brand"}
            size={size}
            disabled={groupDisabled}
            required={required}
            name={name}
            orientation={orientation}
        >
            <Stack gap="3" align={orientation === "vertical" ? "stretch" : undefined}>
                {value.items.map((item) => {
                    const itemDisabled = getSomeorUndefined(item.disabled) ?? false;
                    const description = getSomeorUndefined(item.description);
                    const isSelected = item.value === localValue;
                    return (
                        <ChakraRadioCard.Item
                            key={item.value}
                            value={item.value}
                            disabled={itemDisabled || groupDisabled}
                            bg={isSelected ? selectedCardBackground : cardBackground}
                            borderColor={isSelected ? selectedBorderColor : undefined}
                        >
                            <ChakraRadioCard.ItemHiddenInput />
                            <ChakraRadioCard.ItemControl>
                                <ChakraRadioCard.ItemContent>
                                    <ChakraRadioCard.ItemText color={color}>
                                        {item.label}
                                    </ChakraRadioCard.ItemText>
                                    {description && (
                                        <ChakraRadioCard.ItemDescription color={descriptionColor}>
                                            {description}
                                        </ChakraRadioCard.ItemDescription>
                                    )}
                                </ChakraRadioCard.ItemContent>
                                <ChakraRadioCard.ItemIndicator />
                            </ChakraRadioCard.ItemControl>
                        </ChakraRadioCard.Item>
                    );
                })}
            </Stack>
        </ChakraRadioCard.Root>
    );
}, (prev, next) => radioCardGroupEqual(prev.value, next.value));
