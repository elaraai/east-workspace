/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useId, useContext, useLayoutEffect, useRef, type CSSProperties } from "react";
import { Box, chakra, TagsInput as ChakraTagsInput, useRecipe, type TagsInputRootProps } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { equalFor, equivalentFor, some, none, type ValueTypeOf } from "@elaraai/east";
import { TagsInput } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useFieldNaming } from "../../hooks/useFieldNaming";
import { useValueSync } from "../../hooks/useValueSync";
import { FramePhoneLayer } from "../../layout/builder-frame/frame-layer.js";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { rankByTyped } from "../../collections/typed-rank.js";

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

/** Props of {@link TagsSuggestions}. */
interface TagsSuggestionsProps {
    /** The input's suggestions, in their order. */
    suggestions: readonly string[];
    /** The tags it holds. */
    held: readonly string[];
    /** What is typed in its box. */
    typed: string;
    /** Takes a suggestion as a tag, the box cleared. */
    onTake: (suggestion: string) => void;
}

/**
 * A phone's suggestions (ruled 4 Nov 2026: no desktop-style popover on a phone): one row of the design system's chips
 * under the box, each a `+` and its words — those the tags don't hold, what is typed narrowing them, those it starts
 * first (`rankByTyped`). A tap takes one and leaves the focus where it was, so a phone's keyboard stays up; the row
 * starts at its best again as the words change. The row stands, its height kept, while any suggestion is left to take
 * — empty where the words match none, and for the moment a member typed is taken before its words clear — so the
 * field never jumps as it is typed in, nor what gives way to it; with every one taken, no row.
 */
const TagsSuggestions = memo(function TagsSuggestions({ suggestions, held, typed, onTake }: TagsSuggestionsProps) {
    const styles = useSlotStyles("tagsInput");
    const chip = useRecipe({ key: "chip" });
    const left = useMemo(() => rankByTyped(suggestions, "", held), [suggestions, held]);
    const shown = useMemo(() => rankByTyped(suggestions, typed, held), [suggestions, held, typed]);
    const rowRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => { if (rowRef.current !== null) rowRef.current.scrollLeft = 0; }, [typed]);
    if (left.length === 0) return null;
    return (
        <Box ref={rowRef} css={styles.suggestions} data-tags-suggestions="">
            {shown.map((s) => (
                <chakra.button key={s} type="button" css={chip({ tone: "neutral" })} data-tags-suggestion=""
                    onPointerDown={(e) => e.preventDefault()} onClick={() => onTake(s)}>
                    <FontAwesomeIcon icon={faPlus} data-chip-icon="" aria-hidden />
                    {s}
                </chakra.button>
            ))}
        </Box>
    );
});

/**
 * Renders an East UI TagsInput value using Chakra UI TagsInput component.
 * A tag's delete is Font Awesome's xmark, never Chakra's own icon (#1263).
 * Its suggestions are a native <datalist> — on a phone, a row of chips under it.
 * Inside a Field with no label of its own, the box a tag is typed in is named
 * by the field's label and described by its help (#1758): the field's label is
 * `for` the hidden input that carries the tags, which no one focuses.
 */
export const EastChakraTagsInput = memo(function EastChakraTagsInput({ value }: EastChakraTagsInputProps) {
    const [props, setProps] = useState(toChakraTagsInput(value));
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const placeholder = useMemo(() => getSomeorUndefined(value.placeholder), [value.placeholder]);
    // The box's least width holds its placeholder whole (the recipe's `--tags-typed`): its length in the box's own
    // `ch`, so a line too short for it wraps the box onto a line of its own rather than cutting its words.
    const typedStyle = useMemo(() => (placeholder === undefined ? undefined : { "--tags-typed": `${placeholder.length}ch` } as CSSProperties), [placeholder]);

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
    // to the text input (free entry still allowed; #131) — but in a phone's
    // frame, which has no desktop-style popover (ruled 4 Nov 2026), as a row of
    // chips under the box (east-workspace#1741).
    const suggestions = useMemo(() => getSomeorUndefined(value.suggestions), [value.suggestions]);
    const listId = useId();
    const phone = useContext(FramePhoneLayer) !== null;
    const hasSuggestions = suggestions !== undefined && suggestions.length > 0;
    const listed = hasSuggestions && !phone;
    const chipped = hasSuggestions && phone && props.readOnly !== true && props.disabled !== true;
    // The box's name where it draws no label of its own: its field's.
    const naming = useFieldNaming();

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
                                <ChakraTagsInput.ItemDeleteTrigger><FontAwesomeIcon icon={faXmark} /></ChakraTagsInput.ItemDeleteTrigger>
                            </ChakraTagsInput.ItemPreview>
                        </ChakraTagsInput.Item>
                    ))}
                </ChakraTagsInput.Context>
                <ChakraTagsInput.Input placeholder={placeholder} list={listed ? listId : undefined} style={typedStyle} {...(label === undefined ? naming : {})} />
            </ChakraTagsInput.Control>
            {listed && (
                <datalist id={listId}>
                    {suggestions.map(s => <option key={s} value={s} />)}
                </datalist>
            )}
            {chipped && (
                <ChakraTagsInput.Context>
                    {(api) => (api.atMax ? null : (
                        <TagsSuggestions suggestions={suggestions} held={api.value} typed={api.inputValue}
                            onTake={(s) => { api.addValue(s); api.clearInputValue(); }} />
                    ))}
                </ChakraTagsInput.Context>
            )}
            <ChakraTagsInput.HiddenInput />
        </ChakraTagsInput.Root>
    );
}, (prev, next) => tagsInputEqual(prev.value, next.value));
