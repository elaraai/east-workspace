/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useId, type FocusEvent, type KeyboardEvent } from "react";
import { TagsInput as ChakraTagsInput, type TagsInputRootProps, type UseTagsInputReturn } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { equalFor, equivalentFor, some, none, type ValueTypeOf } from "@elaraai/east";
import { TagsInput } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { composingKey } from "../../editing/shortcuts";
import { useFieldNaming } from "../../hooks/useFieldNaming";
import { useValueSync } from "../../hooks/useValueSync";

// Pre-define equality function at module level
const tagsInputEqual = equivalentFor(TagsInput.Types.Root);
const tagsInputDataEqual = equalFor(TagsInput.Types.Root);

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
 * A tag's delete is Font Awesome's xmark, never Chakra's own icon (#1263).
 * Inside a Field with no label of its own, the box a tag is typed in is named
 * by the field's label and described by its help (#1758): the field's label is
 * `for` the hidden input that carries the tags, which no one focuses.
 *
 * What is typed in the box and not Entered (#1758):
 *
 * - **Esc puts it back**: the box is emptied, so what a person abandoned is no
 *   tag as they leave. A key that ends an input method's composition is the
 *   composition's.
 * - **As the keyboard leaves the tags input** it is a tag (`blurBehavior:
 *   add`) or is cleared (`clear`), as a press outside it makes it. The tags
 *   input hears a press anywhere, but a move of the focus only on a device
 *   that takes no touch, so on a touchscreen laptop or a tablet with a keyboard
 *   Tab left the text in the box, unsaid. The keyboard moving to one of its own
 *   tags' × has not left it.
 */
export const EastChakraTagsInput = memo(function EastChakraTagsInput({ value }: EastChakraTagsInputProps) {
    const [props, setProps] = useState(toChakraTagsInput(value));
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const placeholder = useMemo(() => getSomeorUndefined(value.placeholder), [value.placeholder]);

    // Extract callbacks
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const onInputChangeFn = useMemo(() => getSomeorUndefined(value.onInputChange), [value.onInputChange]);
    const onHighlightChangeFn = useMemo(() => getSomeorUndefined(value.onHighlightChange), [value.onHighlightChange]);

    useValueSync(value, tagsInputDataEqual, () => setProps(toChakraTagsInput(value)));

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
    // The box's name where it draws no label of its own: its field's.
    const naming = useFieldNaming();
    // Esc puts back what is typed in the box.
    const onBoxKey = useCallback((api: UseTagsInputReturn, event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Escape" || composingKey(event)) return;
        api.clearInputValue();
    }, []);
    // The keyboard leaves the tags input: what is typed is a tag, or is cleared, as its blur behaviour says.
    const { blurBehavior, allowOverflow } = props;
    const onBoxBlur = useCallback((api: UseTagsInputReturn, event: FocusEvent<HTMLInputElement>) => {
        const next = event.relatedTarget;
        const root = event.currentTarget.closest("[data-scope=tags-input][data-part=root]");
        if (!(next instanceof Node) || root === null || root.contains(next)) return;
        if (blurBehavior === "clear") {
            api.clearInputValue();
            return;
        }
        const typed = event.currentTarget.value.trim();
        if (blurBehavior !== "add" || typed === "" || (api.atMax && allowOverflow !== true)) return;
        api.addValue(typed);
        api.clearInputValue();
    }, [blurBehavior, allowOverflow]);

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
                    {(api) => (
                        <>
                            {api.value.map((tag, index) => (
                                <ChakraTagsInput.Item key={index} index={index} value={tag}>
                                    <ChakraTagsInput.ItemPreview>
                                        <ChakraTagsInput.ItemText>{tag}</ChakraTagsInput.ItemText>
                                        <ChakraTagsInput.ItemDeleteTrigger><FontAwesomeIcon icon={faXmark} /></ChakraTagsInput.ItemDeleteTrigger>
                                    </ChakraTagsInput.ItemPreview>
                                </ChakraTagsInput.Item>
                            ))}
                            <ChakraTagsInput.Input placeholder={placeholder} list={hasSuggestions ? listId : undefined} {...(label === undefined ? naming : {})}
                                onKeyDown={(event) => onBoxKey(api, event)} onBlur={(event) => onBoxBlur(api, event)} />
                        </>
                    )}
                </ChakraTagsInput.Context>
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
