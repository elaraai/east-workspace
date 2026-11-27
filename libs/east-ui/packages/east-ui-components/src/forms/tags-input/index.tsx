/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useId, useContext, useLayoutEffect, useRef, type CSSProperties, type FocusEvent, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import {
    Box, chakra, Combobox, Portal, TagsInput as ChakraTagsInput, createListCollection, useCombobox, useFieldContext, useRecipe, useTagsInput,
    type TagsInputRootProps, type UseComboboxReturn, type UseTagsInputProps, type UseTagsInputReturn,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { equalFor, equivalentFor, some, none, type ValueTypeOf } from "@elaraai/east";
import { TagsInput } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { composingKey } from "../../editing/shortcuts";
import { useFieldNaming } from "../../hooks/useFieldNaming";
import { useValueSync } from "../../hooks/useValueSync";
import { FramePhoneLayer } from "../../layout/builder-frame/frame-layer.js";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { rankByTyped } from "../../collections/typed-rank.js";
import { usePressRelease } from "../../pointer/press-wait.js";
import { commitTypedText } from "../../primitives/typed-text.js";
import { useListClosesOnFocusOutside } from "../combobox/close-on-focus-outside.js";

// Pre-define equality function at module level
const tagsInputEqual = equivalentFor(TagsInput.Types.Root);
const tagsInputDataEqual = equalFor(TagsInput.Types.Root);

/** What Zag tells of an interaction outside the tags input's box: a press, or a move of the focus. */
type OutsideEvent = Parameters<NonNullable<UseTagsInputProps["onInteractOutside"]>>[0];

/** Zag's name for a press outside the box; its other, a move of the focus, is the box's own blur's to hear. */
const PRESS_OUTSIDE = "pointerdown.outside";

/** A tags input's own element: its tags, its box, and its suggestions. */
const TAGS_ROOT = "[data-scope=tags-input][data-part=root]";

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

/** Props of {@link TagsList}. */
interface TagsListProps {
    /** The box's and its control's ids, which the list shares with the tags input, and the list's own. */
    ids: { input: string; control: string; content: string };
    /** The suggestions it offers now, best first. */
    offered: readonly string[];
    /** What is typed in the box. */
    typed: string;
    /** Whether words typed open it: they match a suggestion the tags input doesn't hold. */
    opens: (typed: string) => boolean;
    /** Tells what is typed, as the list reads it. */
    onTyped: (typed: string) => void;
    /** Takes a suggestion as a tag, the box emptied. */
    onTake: (suggestion: string) => void;
    /** Puts back what is typed: an Esc the list took, its layer hearing the key before the box. */
    onEscape: () => void;
    /** Where the list's api is kept, for the tags input's handlers. */
    listRef: MutableRefObject<UseComboboxReturn<string> | null>;
    /** Where the box is kept, for the tags input's handlers. */
    boxRef: MutableRefObject<HTMLInputElement | null>;
    /** The tags input, its box the list's input: given the ref its box takes. */
    children: (box: (element: HTMLInputElement | null) => void) => ReactNode;
}

/**
 * The list a desktop's tags input offers its suggestions in (east-workspace#1779): the app's combobox over the tags
 * input's box. On a touch screen it closes as the focus leaves it, as the shared combobox's does
 * (`useListClosesOnFocusOutside`): started again, closed, so Zag's close never puts the focus back in the box.
 */
function TagsList(props: TagsListProps) {
    const { epoch, onOpenChange, box } = useListClosesOnFocusOutside();
    return <TagsListRoot key={epoch} {...props} onOpenChange={onOpenChange} box={box} />;
}

/** One start of {@link TagsList}: its combobox, and the tags input it lies over. */
function TagsListRoot({ ids, offered, typed, opens, onTyped, onTake, onEscape, listRef, boxRef, children, onOpenChange, box }: TagsListProps & {
    onOpenChange: (details: { open: boolean }) => void;
    box: (element: HTMLInputElement | null) => void;
}) {
    const collection = useMemo(() => createListCollection({ items: [...offered] }), [offered]);
    const combobox = useCombobox({
        ids,
        collection,
        value: [],
        inputValue: typed,
        allowCustomValue: true,
        selectionBehavior: "clear",
        positioning: { sameWidth: true },
        openOnChange: ({ inputValue }) => opens(inputValue),
        // At once: the list writes the box from this text after the draw, and a later key must not land before it.
        onInputValueChange: (details) => commitTypedText(() => onTyped(details.inputValue)),
        // Esc with the list open is the list's, and it puts back what is typed too: one Esc for the word being made.
        onOpenChange: (details) => {
            onOpenChange(details);
            if (!details.open && details.reason === "escape-key") onEscape();
        },
        onValueChange: (details) => {
            const taken = details.value[0];
            if (taken !== undefined) onTake(taken);
        },
    });
    useLayoutEffect(() => { listRef.current = combobox; });
    // A list with none left to offer closes: the words match none, or each suggestion is a tag now.
    const open = combobox.open;
    useLayoutEffect(() => {
        if (open && offered.length === 0) listRef.current?.setOpen(false);
    }, [open, offered.length, listRef]);
    // The box: the tags input's, and the list's, which hears where the focus goes from it.
    const boxed = useCallback((element: HTMLInputElement | null) => {
        boxRef.current = element;
        box(element);
    }, [boxRef, box]);
    return (
        <Combobox.RootProvider value={combobox}>
            {children(boxed)}
            <Portal>
                <Combobox.Positioner>
                    <Combobox.Content>
                        {collection.items.map((item) => (
                            <Combobox.Item key={item} item={item}>{item}</Combobox.Item>
                        ))}
                    </Combobox.Content>
                </Combobox.Positioner>
            </Portal>
        </Combobox.RootProvider>
    );
}

/**
 * Renders an East UI TagsInput value using Chakra UI TagsInput component.
 * A tag's delete is Font Awesome's xmark, never Chakra's own icon (#1263).
 * Inside a Field with no label of its own, the box a tag is typed in is named
 * by the field's label and described by its help (#1758): the field's label is
 * `for` the hidden input that carries the tags, which no one focuses.
 *
 * Its suggestions are the app's own (east-workspace#1779), never the browser's
 * `<datalist>`, which draws in no style of the app's and which a pick only
 * typed into. On a desktop they are a list under the box, the app's combobox
 * list, as its searches draw theirs: Chakra's tags input over its combobox,
 * one box and one control between them. What is typed narrows them, those it
 * starts first and never a tag the input holds (`rankByTyped`); the list opens
 * only when the words match one, and as ↓ or ↑ is pressed, and closes once
 * none is left to offer, or a tag is made while the box is typed in. ↑ ↓
 * choose; ⏎ or a press takes the one chosen as a tag at once, the box emptied;
 * ⏎ with none chosen makes what is typed the tag, as before. The text the list
 * reads is committed at once (`commitTypedText`), so its write of the box never
 * lands over a later key; and on a touch screen the list closes as the focus
 * leaves the box, as the shared combobox's does (`TagsList`). In a phone's
 * frame, which has no desktop-style popover (ruled 4 Nov 2026), they are a row
 * of chips under the box instead (east-workspace#1741).
 *
 * What is typed in the box and not Entered (#1758):
 *
 * - **Esc puts it back**: the box is emptied and its list closed, so what a
 *   person abandoned is no tag. It is the box's own then: the box says so
 *   (`data-escape-layer`) and takes the key, so what it lies in — a popover, a
 *   phone's view, a pane — stays, and Esc goes back a level at a time
 *   (east-workspace#1779). With nothing typed it is left to what the box lies
 *   in. A key that ends an input method's composition is the composition's.
 * - **As the tags input is left** — the keyboard moving out of it, a press
 *   outside it, whether or not the press takes the focus (Safari's buttons take
 *   none) — it is a tag (`blurBehavior: add`) or is cleared (`clear`). This
 *   renderer does it, never Zag's tags input, whose lands as the press begins:
 *   there it moved what was pressed — a Save under the field, pushed down by
 *   the field's new line of tags — out from under the pointer before the press
 *   could click it (east-workspace#1779). It lands as the press lets go, ahead
 *   of the click the release makes (`usePressRelease`), which then lands on
 *   what was pressed and hears the tag; at once where the keyboard leaves. The
 *   tags input hears every move of the focus out of its box, on any device:
 *   Zag's own tracking hears none on one that takes touch too, where Tab would
 *   have left the text in the box, unsaid. The keyboard moving to one of its
 *   own tags' ×, or a press on one of its own tags or suggestions, has not left
 *   it.
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

    // The box, and the tags input's api and its list's as the last draw left them: what a handler outside their draws
    // reaches.
    const boxRef = useRef<HTMLInputElement | null>(null);
    const latest = useRef<UseTagsInputReturn | null>(null);
    const listRef = useRef<UseComboboxReturn<string> | null>(null);
    // What is typed in the box, as its list reads it.
    const [typed, setTyped] = useState("");

    const handleValueChange = useCallback((details: { value: string[] }) => {
        setProps(prev => ({ ...prev, value: details.value }));
        // A tag made or taken away while the box is typed in closes the list: what it offered was for the words before.
        // One made as the box is left is no business of the list's, whose close would put the focus back in the box.
        const box = boxRef.current;
        if (box !== null && box.ownerDocument.activeElement === box) listRef.current?.setOpen(false);
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(details.value));
        }
    }, [onChangeFn]);

    const handleInputValueChange = useCallback((details: { inputValue: string }) => {
        // At once: the list writes the box from this text after the draw, and a later key must not land before it.
        commitTypedText(() => setTyped(details.inputValue));
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

    // Its suggestions: a list under the box on a desktop, a row of chips in a phone's frame — offered while a tag can
    // be typed in.
    const suggestions = useMemo(() => getSomeorUndefined(value.suggestions), [value.suggestions]);
    const phone = useContext(FramePhoneLayer) !== null;
    const offering = suggestions !== undefined && suggestions.length > 0 && props.readOnly !== true && props.disabled !== true;
    const listed = offering && !phone;
    const chipped = offering && phone;
    // The box's name where it draws no label of its own: its field's.
    const naming = useFieldNaming();
    // The box and its control, each one element for the tags input and its list; the field's label and the hidden
    // input as a Field names them, which Ark's tags input takes from the Field itself only where it is given no ids.
    const uid = useId();
    const fieldIds = useFieldContext()?.ids;
    const listId = `tags-input:${uid}:list`;
    const ids = useMemo(() => ({
        input: `tags-input:${uid}:input`,
        control: `tags-input:${uid}:control`,
        ...(fieldIds?.label !== undefined && { label: fieldIds.label }),
        ...(fieldIds?.control !== undefined && { hiddenInput: fieldIds.control }),
    }), [uid, fieldIds?.label, fieldIds?.control]);
    const listIds = useMemo(() => ({ input: ids.input, control: ids.control, content: listId }), [ids.input, ids.control, listId]);

    // The tags input as Zag drives it, but for what is typed as it is left, which is this renderer's (below): Zag's
    // would land as the press that leaves it begins. Its recipe's props are its root's.
    const { blurBehavior, allowOverflow, size, variant, colorPalette, ...machine } = props;
    // The tags input left: what is typed is a tag, or is cleared, as its blur behaviour says.
    const leave = useCallback(() => {
        const tags = latest.current;
        const box = boxRef.current;
        if (tags === null || box === null) return;
        if (blurBehavior === "clear") {
            tags.clearInputValue();
            return;
        }
        const words = box.value.trim();
        if (blurBehavior !== "add" || words === "" || (tags.atMax && allowOverflow !== true)) return;
        tags.addValue(words);
        tags.clearInputValue();
    }, [blurBehavior, allowOverflow]);
    // ...as the press that left it lets go, ahead of the click its release makes — at once where none did, as the
    // keyboard's Tab leaves — once for each leaving: a press that takes the focus is heard twice, as it lands and as the
    // focus moves.
    const atRelease = usePressRelease();
    const leaving = useRef(false);
    const left = useCallback(() => {
        if (blurBehavior === undefined || leaving.current) return;
        leaving.current = true;
        atRelease(() => {
            leaving.current = false;
            leave();
        });
    }, [blurBehavior, atRelease, leave]);
    // A press outside it, whether or not the press takes the focus; one on its own tags or suggestions — its list,
    // portalled out of it — is no leaving, and Zag's tags input is told so too: it tracks its box and its tags alone,
    // and a press on the list it took for one outside left it deaf to the box, what was typed next no tag and no Esc
    // of its own (east-workspace#1779).
    const onInteractOutside = useCallback((event: OutsideEvent) => {
        if (event.type !== PRESS_OUTSIDE) return;
        const pressed = event.detail.originalEvent.target;
        const box = boxRef.current;
        const own = [box?.closest(TAGS_ROOT), box?.ownerDocument.getElementById(listId)];
        if (pressed instanceof Node && own.some((part) => part?.contains(pressed) === true)) {
            event.preventDefault();
            return;
        }
        left();
    }, [left, listId]);
    // The keyboard leaving it — never for one of its own tags' ×.
    const onBoxBlur = useCallback((event: FocusEvent<HTMLInputElement>) => {
        const next = event.relatedTarget;
        const root = event.currentTarget.closest(TAGS_ROOT);
        if (!(next instanceof Node) || root === null || root.contains(next)) return;
        left();
    }, [left]);
    // Esc puts back what is typed in the box, its list closed, and takes the key: what the box lies in stays.
    const onBoxKey = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Escape" || composingKey(event) || event.currentTarget.value === "") return;
        latest.current?.clearInputValue();
        listRef.current?.setOpen(false);
        event.preventDefault();
    }, []);

    const tags = useTagsInput({
        ...machine,
        ids,
        allowOverflow,
        onValueChange: handleValueChange,
        onInputValueChange: handleInputValueChange,
        onHighlightChange: handleHighlightChange,
        onInteractOutside,
    });
    useLayoutEffect(() => { latest.current = tags; });

    // The list: the suggestions what is typed narrows to, those it starts first, never a tag held. A pick is a tag at
    // once, the box emptied; the list itself holds nothing picked.
    const held = props.value;
    const offered = useMemo(() => (listed && suggestions !== undefined ? rankByTyped(suggestions, typed, held) : []), [listed, suggestions, typed, held]);
    const opens = useCallback((words: string) => suggestions !== undefined && rankByTyped(suggestions, words, held).length > 0, [suggestions, held]);
    const take = useCallback((suggestion: string) => {
        latest.current?.addValue(suggestion);
        latest.current?.clearInputValue();
    }, []);
    const putBack = useCallback(() => { latest.current?.clearInputValue(); }, []);

    const boxProps = {
        placeholder, style: typedStyle, ...(label === undefined ? naming : {}),
        "data-escape-layer": tags.inputValue !== "" ? "" : undefined, onKeyDown: onBoxKey, onBlur: onBoxBlur,
    };
    const field = (box?: (element: HTMLInputElement | null) => void) => (
        <ChakraTagsInput.RootProvider value={tags} size={size} variant={variant} colorPalette={colorPalette}>
            {label && <ChakraTagsInput.Label>{label}</ChakraTagsInput.Label>}
            <ChakraTagsInput.Control>
                {tags.value.map((tag, index) => (
                    <ChakraTagsInput.Item key={index} index={index} value={tag}>
                        <ChakraTagsInput.ItemPreview>
                            <ChakraTagsInput.ItemText>{tag}</ChakraTagsInput.ItemText>
                            <ChakraTagsInput.ItemDeleteTrigger><FontAwesomeIcon icon={faXmark} /></ChakraTagsInput.ItemDeleteTrigger>
                        </ChakraTagsInput.ItemPreview>
                    </ChakraTagsInput.Item>
                ))}
                {/* With a list, the box is the list's input too, the tags input's parts and words on it. Its ref is the
                    inner input's: one given the outer, Ark's `asChild` merges into a new ref at every draw, which React
                    lets go and takes again each time — and a box let go stops the list's listening for the focus. */}
                {box !== undefined
                    ? <ChakraTagsInput.Input asChild {...boxProps}><Combobox.Input unstyled ref={box} /></ChakraTagsInput.Input>
                    : <ChakraTagsInput.Input ref={boxRef} {...boxProps} />}
            </ChakraTagsInput.Control>
            {chipped && !tags.atMax && (
                <TagsSuggestions suggestions={suggestions} held={tags.value} typed={tags.inputValue}
                    onTake={(s) => { tags.addValue(s); tags.clearInputValue(); }} />
            )}
            <ChakraTagsInput.HiddenInput />
        </ChakraTagsInput.RootProvider>
    );
    if (!listed) return field();
    return (
        <TagsList ids={listIds} offered={offered} typed={typed} opens={opens} onTyped={setTyped} onTake={take} onEscape={putBack}
            listRef={listRef} boxRef={boxRef}>
            {field}
        </TagsList>
    );
}, (prev, next) => tagsInputEqual(prev.value, next.value));
