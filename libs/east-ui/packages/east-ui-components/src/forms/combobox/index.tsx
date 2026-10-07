/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState, useMemo, useCallback } from "react";
import { Portal } from "@chakra-ui/react";
import { Combobox as ChakraCombobox, createListCollection } from "@chakra-ui/react";
import { StringType, equalFor, equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Combobox } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useValueSync } from "../../hooks/useValueSync";
import { closedText, useListClosesOnFocusOutside } from "./close-on-focus-outside.js";

// Pre-define equality function at module level
const comboboxRootEqual = equivalentFor(Combobox.Types.Root);
const comboboxRootDataEqual = equalFor(Combobox.Types.Root);
const stringEqual = equalFor(StringType);

/** East Combobox Root value type */
export type ComboboxRootValue = ValueTypeOf<typeof Combobox.Types.Root>;

/** East Combobox Item value type */
export type ComboboxItemValue = ValueTypeOf<typeof Combobox.Types.Item>;

/**
 * Converts an East UI Combobox value to Chakra UI Combobox props.
 * Pure function - easy to test independently.
 */
export function toChakraCombobox(value: ComboboxRootValue) {
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
        allowCustomValue: getSomeorUndefined(value.allowCustomValue),
        color: colour,
        bg: background,
        borderColor,
    };
}

export interface EastChakraComboboxProps {
    value: ComboboxRootValue;
    /** How committing an option treats the typed input text: `"replace"`
     *  (the default) writes the option's label into the input, `"preserve"`
     *  leaves the typed text untouched (host-driven search boxes, where the
     *  label is display-only and replacing — then re-syncing the controlled
     *  empty selection — would wipe the query), `"clear"` empties it. */
    selectionBehavior?: 'clear' | 'replace' | 'preserve';
}

/**
 * Renders an East UI Combobox value using Chakra UI Combobox component. Its
 * list closes when the focus moves to anything outside the list, the box and
 * its triggers — on a touch screen too, where Zag leaves it open (#1228,
 * `close-on-focus-outside.ts`), closed there as Zag closes it on a desktop:
 * text no item holds, where custom values are refused, reverted by the
 * selection behaviour, and the host told. A blur to nothing — the phone's
 * keyboard dismissed — moves the focus nowhere, and closes nothing, on any
 * device.
 */
export const EastChakraCombobox = memo(function EastChakraCombobox({ value, selectionBehavior }: EastChakraComboboxProps) {
    const [props, setProps] = useState(toChakraCombobox(value));
    const placeholder = useMemo(() => getSomeorUndefined(value.placeholder), [value.placeholder]);
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const onChangeMultipleFn = useMemo(() => getSomeorUndefined(value.onChangeMultiple), [value.onChangeMultiple]);
    const onInputValueChangeFn = useMemo(() => getSomeorUndefined(value.onInputValueChange), [value.onInputValueChange]);
    const onOpenChangeFn = useMemo(() => getSomeorUndefined(value.onOpenChange), [value.onOpenChange]);
    const isMultiple = useMemo(() => getSomeorUndefined(value.multiple), [value.multiple]);

    const [inputValue, setInputValue] = useState("");

    useValueSync(value, comboboxRootDataEqual, () => setProps(toChakraCombobox(value)));

    const allItems = useMemo(() => {
        return value.items.map(item => ({
            value: item.value,
            label: item.label,
            disabled: getSomeorUndefined(item.disabled) ?? false,
        }));
    }, [value.items]);

    const collection = useMemo(() => {
        const filtered = allItems.filter(item =>
            item.label.toLowerCase().includes(inputValue.toLowerCase())
        );
        return createListCollection({ items: filtered });
    }, [allItems, inputValue]);

    const handleValueChange = useCallback((details: { value: string[] }) => {
        setProps(prev => ({ ...prev, value: details.value }));
        if (isMultiple && onChangeMultipleFn) {
            queueMicrotask(() => onChangeMultipleFn(details.value));
        } else if (!isMultiple && onChangeFn && details.value.length > 0) {
            queueMicrotask(() => onChangeFn(details.value[0]!));
        }
    }, [isMultiple, onChangeFn, onChangeMultipleFn]);

    const handleInputValueChange = useCallback((details: { inputValue: string }) => {
        setInputValue(details.inputValue);
        if (onInputValueChangeFn) {
            queueMicrotask(() => onInputValueChangeFn(details.inputValue));
        }
    }, [onInputValueChangeFn]);

    // A list the combobox closes on a touch screen, the focus moved outside it, closed as Zag's outside interaction
    // closes one: text no item holds, where custom values are refused, reverted by the selection behaviour (Zag's
    // default: "clear" for a multiple, "replace" otherwise) against the selected items' labels, as Zag joins them;
    // the host told of the text, then of the close — Zag, started again, says neither.
    const closedOutside = useCallback(() => {
        const selected = createListCollection({ items: allItems }).stringifyMany(props.value);
        const text = closedText(inputValue, selected, selectionBehavior ?? (isMultiple === true ? "clear" : "replace"), props.allowCustomValue === true);
        if (!stringEqual(text, inputValue)) handleInputValueChange({ inputValue: text });
        if (onOpenChangeFn) {
            queueMicrotask(() => onOpenChangeFn(false));
        }
    }, [props.value, props.allowCustomValue, allItems, inputValue, selectionBehavior, isMultiple, handleInputValueChange, onOpenChangeFn]);
    const { epoch, onOpenChange: trackOpen, box } = useListClosesOnFocusOutside(closedOutside);

    const handleOpenChange = useCallback((details: { open: boolean }) => {
        trackOpen(details);
        if (onOpenChangeFn) {
            queueMicrotask(() => onOpenChangeFn(details.open));
        }
    }, [trackOpen, onOpenChangeFn]);

    return (
        <ChakraCombobox.Root
            key={epoch}
            {...props}
            {...(selectionBehavior !== undefined && { selectionBehavior })}
            collection={collection}
            inputValue={inputValue}
            onValueChange={handleValueChange}
            onInputValueChange={handleInputValueChange}
            onOpenChange={handleOpenChange}
        >
            <ChakraCombobox.Control>
                <ChakraCombobox.Input ref={box} placeholder={placeholder ?? "Search..."} />
                <ChakraCombobox.IndicatorGroup>
                    <ChakraCombobox.ClearTrigger />
                    <ChakraCombobox.Trigger />
                </ChakraCombobox.IndicatorGroup>
            </ChakraCombobox.Control>
            <Portal>
                <ChakraCombobox.Positioner>
                    <ChakraCombobox.Content>
                        <ChakraCombobox.Empty>No results found</ChakraCombobox.Empty>
                        {collection.items.map((item) => (
                            <ChakraCombobox.Item key={item.value} item={item}>
                                {item.label}
                                <ChakraCombobox.ItemIndicator />
                            </ChakraCombobox.Item>
                        ))}
                    </ChakraCombobox.Content>
                </ChakraCombobox.Positioner>
            </Portal>
        </ChakraCombobox.Root>
    );
}, (prev, next) => comboboxRootEqual(prev.value, next.value) && prev.selectionBehavior === next.selectionBehavior);
