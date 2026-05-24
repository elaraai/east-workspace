/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState, useEffect, useMemo, useCallback } from "react";
import { Box, Combobox as ChakraCombobox, Portal, createListCollection, useSlotRecipe } from "@chakra-ui/react";
import { type ValueTypeOf, some, none } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { useSliceDensity } from "../density";
import { useSliceReactivity } from "../use-slice-reactivity";

/** East Slice.Search value type. */
export type SliceSearchValue = ValueTypeOf<typeof Slice.Search.Types.Search>;

export interface EastChakraSliceSearchProps {
    value: SliceSearchValue;
}

/**
 * Renders an East UI `Slice.Search` — a Chakra Combobox typeahead over a slice
 * dimension. **Compact** (in a `Slice.Frame` eyebrow): the closed `.search`
 * pill — magnifier glyph + placeholder + `/` kbd hint — whose dropdown anchors
 * below on focus. **Focused** (standalone): the full search frame with the
 * `⌘K · N matches` eyebrow and the keyboard-hint footer. Typing drives
 * `state.search` via `slice.setSearch`; the host-computed `matches` populate the
 * dropdown as-is (the Combobox does not re-filter); selecting one commits via
 * `slice.setSearch(some(id))`.
 */
export const EastChakraSliceSearch = memo(function EastChakraSliceSearch({ value }: EastChakraSliceSearchProps) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const { slice } = value;
    const recent = value.recent ?? [];
    useSliceReactivity(slice.key);
    const density = useSliceDensity(getSomeorUndefined(value.density)?.type as ("compact" | "focused" | undefined));
    const compact = density === "compact";
    const matches = slice.matches();

    const externalQuery = getSomeorUndefined(slice.read().search) ?? "";
    const [inputValue, setInputValue] = useState(externalQuery);
    useEffect(() => { setInputValue(externalQuery); }, [externalQuery]);

    // Matches are host-computed (already filtered for the query) — the collection
    // is rendered as-is; the Combobox does not re-filter.
    const collection = useMemo(() => createListCollection({
        items: matches.map(m => ({ label: m.label, value: m.id, meta: getSomeorUndefined(m.meta) })),
    }), [matches]);

    const handleInput = useCallback((d: { inputValue: string }) => {
        setInputValue(d.inputValue);
        queueMicrotask(() => slice.setSearch(d.inputValue === "" ? none : some(d.inputValue)));
    }, [slice]);

    const handleSelect = useCallback((d: { value: string[] }) => {
        const id = d.value[0];
        if (id !== undefined) queueMicrotask(() => slice.setSearch(some(id)));
    }, [slice]);

    const dropdown = (
        <Portal>
            <ChakraCombobox.Positioner>
                <ChakraCombobox.Content>
                    <ChakraCombobox.Empty>No matches</ChakraCombobox.Empty>
                    {collection.items.map(item => (
                        <ChakraCombobox.Item key={item.value} item={item}>
                            <Box display="flex" gap="{spacing.3}" alignItems="baseline" width="full">
                                <Box as="span" fontFamily="mono" fontWeight="semibold" minWidth="6rem">{item.value}</Box>
                                <Box as="span" flex="1" color="fg">{item.label}</Box>
                                {item.meta !== undefined && (
                                    <Box as="span" css={styles.footerLabel} color="fg.muted">{item.meta}</Box>
                                )}
                            </Box>
                            <ChakraCombobox.ItemIndicator />
                        </ChakraCombobox.Item>
                    ))}
                </ChakraCombobox.Content>
            </ChakraCombobox.Positioner>
        </Portal>
    );

    // Compact — the closed `.search` pill (magnifier + placeholder + `/` kbd),
    // the dropdown anchored below on focus. Lives in the eyebrow's right zone.
    if (compact) {
        return (
            <ChakraCombobox.Root
                collection={collection}
                inputValue={inputValue}
                onInputValueChange={handleInput}
                onValueChange={handleSelect}
                openOnClick
                flex="1 1 240px"
                minWidth="200px"
                maxWidth="480px"
            >
                <ChakraCombobox.Control css={styles.searchPill}>
                    <ChakraCombobox.Input placeholder="Search…" />
                    <Box as="span" css={styles.searchKbd}>/</Box>
                </ChakraCombobox.Control>
                {dropdown}
            </ChakraCombobox.Root>
        );
    }

    return (
        <Box css={styles.root}>
            <Box css={styles.header}>
                <Box as="span" css={styles.eyebrow}>SEARCH</Box>
                <Box as="span" css={styles.meta}>{`⌘K  ·  ${matches.length} MATCHES`}</Box>
            </Box>
            <Box css={styles.body}>
                <ChakraCombobox.Root
                    collection={collection}
                    inputValue={inputValue}
                    onInputValueChange={handleInput}
                    onValueChange={handleSelect}
                    openOnClick
                    width="full"
                >
                    <ChakraCombobox.Control>
                        <ChakraCombobox.Input placeholder="Search…" fontFamily="mono" />
                        <ChakraCombobox.IndicatorGroup>
                            <ChakraCombobox.Trigger />
                        </ChakraCombobox.IndicatorGroup>
                    </ChakraCombobox.Control>
                    {dropdown}
                </ChakraCombobox.Root>
            </Box>
            <Box css={styles.footer}>
                <Box as="span" css={styles.footerLabel}>↑↓ navigate · ↵ select · esc close</Box>
                {recent.length > 0 && (
                    <Box as="span" css={styles.footerLabel} color="fg.muted">{`recent: ${recent.join(" · ")}`}</Box>
                )}
            </Box>
        </Box>
    );
}, () => false);
