/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useEffect } from "react";
import { Portal } from "@chakra-ui/react";
import { Select as ChakraSelect, createListCollection, type SelectRootProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Select } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

// Pre-define equality function at module level
const selectRootEqual = equalFor(Select.Types.Root);

/** East Select Root value type */
export type SelectRootValue = ValueTypeOf<typeof Select.Types.Root>;

/** East Select Item value type */
export type SelectItemValue = ValueTypeOf<typeof Select.Types.Item>;

/** Select item for collection */
interface SelectCollectionItem {
    value: string;
    label: string;
    disabled?: boolean;
}

/**
 * Converts an East UI Select value to Chakra UI Select props.
 * Pure function - easy to test independently.
 */
export function toChakraSelect(value: SelectRootValue): Omit<SelectRootProps<SelectCollectionItem>, "collection"> {
    const selectedValue = getSomeorUndefined(value.value);
    const style = getSomeorUndefined(value.style);
    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;
    const colour = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;

    return {
        value: selectedValue ? [selectedValue] : [],
        multiple: getSomeorUndefined(value.multiple),
        disabled: getSomeorUndefined(value.disabled),
        size: sizeTag,
        color: colour,
        bg: background,
        borderColor,
    };
}

export interface EastChakraSelectProps {
    /** Accessible name for the trigger (React-side; not part of the East payload). */
    ariaLabel?: string;
    /** Render the dropdown in place instead of a portal (React-side). Needed
     *  inside popovers, where a portalled listbox counts as an outside
     *  interaction and dismisses the popover. */
    portalled?: boolean;
    value: SelectRootValue;
}

/**
 * Renders an East UI Select value using Chakra UI Select component.
 */
export const EastChakraSelect = memo(function EastChakraSelect({ value, ariaLabel, portalled }: EastChakraSelectProps) {
    const [props, setProps] = useState(toChakraSelect(value));
    const placeholder = useMemo(() => getSomeorUndefined(value.placeholder), [value.placeholder]);
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const onChangeMultipleFn = useMemo(() => getSomeorUndefined(value.onChangeMultiple), [value.onChangeMultiple]);
    const onOpenChangeFn = useMemo(() => getSomeorUndefined(value.onOpenChange), [value.onOpenChange]);
    const isMultiple = useMemo(() => getSomeorUndefined(value.multiple), [value.multiple]);

    useEffect(() => {
        setProps(() => toChakraSelect(value));
    }, [value]);

    const collection = useMemo(() => {
        const items = value.items.map(item => ({
            value: item.value,
            label: item.label,
            disabled: getSomeorUndefined(item.disabled) ?? false,
        }));
        return createListCollection({ items });
    }, [value.items]);

    const handleValueChange = useCallback((details: { value: string[] }) => {
        setProps(prev => ({ ...prev, value: details.value }));
        if (isMultiple && onChangeMultipleFn) {
            queueMicrotask(() => onChangeMultipleFn(details.value));
        } else if (!isMultiple && onChangeFn && details.value.length > 0) {
            queueMicrotask(() => onChangeFn(details.value[0]!));
        }
    }, [isMultiple, onChangeFn, onChangeMultipleFn]);

    const handleOpenChange = useCallback((details: { open: boolean }) => {
        if (onOpenChangeFn) {
            queueMicrotask(() => onOpenChangeFn(details.open));
        }
    }, [onOpenChangeFn]);

    return (
        <ChakraSelect.Root
            collection={collection}
            {...props}
            onValueChange={handleValueChange}
            onOpenChange={handleOpenChange}
        >
            <ChakraSelect.HiddenSelect />
            <ChakraSelect.Control>
                <ChakraSelect.Trigger {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}>
                    <ChakraSelect.ValueText placeholder={placeholder ?? "Select..."} />
                </ChakraSelect.Trigger>
                <ChakraSelect.IndicatorGroup>
                    <ChakraSelect.Indicator />
                </ChakraSelect.IndicatorGroup>
            </ChakraSelect.Control>
            <Portal disabled={portalled === false}>
                <ChakraSelect.Positioner>
                    <ChakraSelect.Content>
                        {collection.items.map((item) => (
                            <ChakraSelect.Item key={item.value} item={item}>
                                {item.label}
                                <ChakraSelect.ItemIndicator />
                            </ChakraSelect.Item>
                        ))}
                    </ChakraSelect.Content>
                </ChakraSelect.Positioner>
            </Portal>
        </ChakraSelect.Root>
    );
}, (prev, next) => selectRootEqual(prev.value, next.value) && prev.ariaLabel === next.ariaLabel && prev.portalled === next.portalled);
