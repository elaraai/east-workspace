/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useEffect, useId } from "react";
import { TagsInput as ChakraTagsInput, type TagsInputRootProps } from "@chakra-ui/react";
import { equalFor, some, none, type ValueTypeOf } from "@elaraai/east";
import { TagsInput } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

// Pre-define equality function at module level
const tagsInputEqual = equalFor(TagsInput.Types.Root);

/** East TagsInput value type */
export type TagsInputValue = ValueTypeOf<typeof TagsInput.Types.Root>;

/**
 * Converts an East UI TagsInput value to Chakra UI TagsInput props.
 * Pure function - easy to test independently.
 */
export function toChakraTagsInput(value: TagsInputValue): TagsInputRootProps {
    const max = getSomeorUndefined(value.max);
    const maxLength = getSomeorUndefined(value.maxLength);
    const style = getSomeorUndefined(value.style);
    const variantTag = style ? getSomeorUndefined(style.variant)?.type : undefined;
    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;

    return {
        value: value.value,
        defaultValue: getSomeorUndefined(value.defaultValue),
        max: max !== undefined ? Number(max) : undefined,
        maxLength: maxLength !== undefined ? Number(maxLength) : undefined,
        disabled: getSomeorUndefined(value.disabled),
        readOnly: getSomeorUndefined(value.readOnly),
        invalid: getSomeorUndefined(value.invalid),
        editable: getSomeorUndefined(value.editable),
        delimiter: getSomeorUndefined(value.delimiter),
        addOnPaste: getSomeorUndefined(value.addOnPaste),
        blurBehavior: getSomeorUndefined(value.blurBehavior)?.type,
        allowOverflow: getSomeorUndefined(value.allowOverflow),
        size: sizeTag,
        variant: variantTag,
        colorPalette: colorPalette ?? "brand",
    };
}

export interface EastChakraTagsInputProps {
    value: TagsInputValue;
}

/**
 * Renders an East UI TagsInput value using Chakra UI TagsInput component.
 */
export const EastChakraTagsInput = memo(function EastChakraTagsInput({ value }: EastChakraTagsInputProps) {
    const [props, setProps] = useState(toChakraTagsInput(value));
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const placeholder = useMemo(() => getSomeorUndefined(value.placeholder), [value.placeholder]);

    // Extract callbacks
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const onInputChangeFn = useMemo(() => getSomeorUndefined(value.onInputChange), [value.onInputChange]);
    const onHighlightChangeFn = useMemo(() => getSomeorUndefined(value.onHighlightChange), [value.onHighlightChange]);

    useEffect(() => {
        setProps(() => toChakraTagsInput(value));
    }, [value]);

    const handleValueChange = useCallback((details: { value: string[] }) => {
        setProps(prev => ({ ...prev, value: details.value }));
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(details.value));
        }
    }, [onChangeFn]);

    const handleInputValueChange = useCallback((details: { inputValue: string }) => {
        if (onInputChangeFn) {
            queueMicrotask(() => onInputChangeFn(details.inputValue));
        }
    }, [onInputChangeFn]);

    const handleHighlightChange = useCallback((details: { highlightedValue: string | null }) => {
        if (onHighlightChangeFn) {
            const optionValue = details.highlightedValue !== null
                ? some(details.highlightedValue)
                : none;
            queueMicrotask(() => onHighlightChangeFn(optionValue));
        }
    }, [onHighlightChangeFn]);

    // Optional autocomplete: surface suggestions via a native <datalist> linked
    // to the text input (free entry still allowed; #131).
    const suggestions = useMemo(() => getSomeorUndefined(value.suggestions), [value.suggestions]);
    const listId = useId();
    const hasSuggestions = suggestions !== undefined && suggestions.length > 0;

    return (
        <ChakraTagsInput.Root
            {...props}
            onValueChange={handleValueChange}
            onInputValueChange={handleInputValueChange}
            onHighlightChange={handleHighlightChange}
        >
            {label && <ChakraTagsInput.Label>{label}</ChakraTagsInput.Label>}
            <ChakraTagsInput.Control>
                <ChakraTagsInput.Context>
                    {(api) => api.value.map((tag, index) => (
                        <ChakraTagsInput.Item key={index} index={index} value={tag}>
                            <ChakraTagsInput.ItemPreview>
                                <ChakraTagsInput.ItemText>{tag}</ChakraTagsInput.ItemText>
                                <ChakraTagsInput.ItemDeleteTrigger />
                            </ChakraTagsInput.ItemPreview>
                        </ChakraTagsInput.Item>
                    ))}
                </ChakraTagsInput.Context>
                <ChakraTagsInput.Input placeholder={placeholder} list={hasSuggestions ? listId : undefined} />
            </ChakraTagsInput.Control>
            {hasSuggestions && (
                <datalist id={listId}>
                    {suggestions.map(s => <option key={s} value={s} />)}
                </datalist>
            )}
            <ChakraTagsInput.HiddenInput />
        </ChakraTagsInput.Root>
    );
}, (prev, next) => tagsInputEqual(prev.value, next.value));
