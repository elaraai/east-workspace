/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo, useRef, useCallback, type ReactNode } from "react";
import { Box, chakra, Combobox, Portal, createListCollection, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faChevronDown, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useListClosesOnFocusOutside } from "../../forms/combobox/close-on-focus-outside.js";

/** An already-resolved suggestion. Its identity never comes from its label. */
export interface SliceSearchSuggestion { value: string; label: string; meta?: ReactNode; hint?: string; disabled?: boolean }
/** Shared search presentation; adapters own query evaluation and commit semantics. */
export interface SliceSearchInputProps {
    text: string;
    items: readonly SliceSearchSuggestion[];
    onInput: (text: string) => void;
    onSelect: (id: string) => void;
    onSubmit?: () => void;
    compact?: boolean;
    showIds?: boolean;
    placeholder?: string;
    emptyText?: string;
    busy?: boolean;
}

/** Render local and record searches through the same keyboard/touch combobox. */
export function SliceSearchInput({ text, items, onInput, onSelect, onSubmit, compact = true,
    showIds = false, placeholder = "Search…", emptyText = "No matches", busy = false }: SliceSearchInputProps) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const edit = useSlotRecipe({ key: "sliceEdit" })();
    const { epoch, onOpenChange, box } = useListClosesOnFocusOutside();
    const input = useRef<HTMLInputElement | null>(null);
    const inputRef = useCallback((element: HTMLInputElement | null) => { input.current = element; box(element); }, [box]);
    const collection = useMemo(() => createListCollection({ items: [...items] }), [items]);
    const clear = text === "" ? null : <chakra.button type="button" css={styles.searchClear}
        aria-label="Clear search" onClick={() => { onInput(""); input.current?.focus(); }}>
        <FontAwesomeIcon icon={faXmark} />
    </chakra.button>;
    return <Combobox.Root key={epoch} collection={collection} value={[]} inputValue={text}
        onInputValueChange={d => onInput(d.inputValue)}
        onValueChange={d => { const id = d.value[0]; if (id === undefined) onInput(""); else onSelect(id); }}
        onOpenChange={onOpenChange} openOnClick allowCustomValue selectionBehavior="preserve"
        css={compact ? styles.searchCompact : styles.searchFull}
        onKeyDownCapture={event => {
            if (event.key !== "Enter" || onSubmit === undefined || (event.target as HTMLElement).getAttribute("aria-activedescendant")) return;
            event.preventDefault(); event.stopPropagation(); onSubmit();
        }}>
        <Combobox.Control css={compact ? styles.searchPill : undefined}>
            <Combobox.Input ref={inputRef} placeholder={placeholder} aria-label={placeholder} aria-busy={busy} />
            {compact ? clear ?? <Box as="span" css={styles.searchKbd}>/</Box>
                : <Combobox.IndicatorGroup>{clear}<Combobox.Trigger><FontAwesomeIcon icon={faChevronDown} /></Combobox.Trigger></Combobox.IndicatorGroup>}
        </Combobox.Control>
        <Portal><Combobox.Positioner><Combobox.Content>
            <Combobox.Empty>{emptyText}</Combobox.Empty>
            {collection.items.map(item => <Combobox.Item key={item.value} item={item}>
                <Box css={[edit.choiceList, styles.searchFull]}>
                    <Box css={styles.searchSuggestion}>
                        {showIds && <Box as="span" css={styles.searchIdentity}>{item.value}</Box>}
                        <Box as="span" css={styles.searchLabel}>{item.label}</Box>
                        {item.meta !== undefined && <Box as="span" css={styles.searchMeta}>{item.meta}</Box>}
                    </Box>
                    {item.hint && <Box css={edit.hint}>{item.hint}</Box>}
                </Box>
                <Combobox.ItemIndicator><FontAwesomeIcon icon={faCheck} /></Combobox.ItemIndicator>
            </Combobox.Item>)}
        </Combobox.Content></Combobox.Positioner></Portal>
    </Combobox.Root>;
}
