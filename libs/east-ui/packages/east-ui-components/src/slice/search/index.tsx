/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState, useEffect } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { type ValueTypeOf, some, none } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useSliceDensity } from "../density";
import { useSliceReactivity } from "../use-slice-reactivity";
import { SliceSearchInput } from "./input.js";

/** East Slice.Search value type. */
export type SliceSearchValue = ValueTypeOf<typeof Slice.Search.Types.Search>;
export interface EastChakraSliceSearchProps { value: SliceSearchValue }

/** Render local Slice search with the shared search input and host-computed matches. */
export const EastChakraSliceSearch = memo(function EastChakraSliceSearch({ value }: EastChakraSliceSearchProps) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const { slice } = value;
    useSliceReactivity(slice.key);
    const density = useSliceDensity(getSomeorUndefined(value.density)?.type);
    const compact = density !== "focused";
    const matches = slice.matches();
    const external = getSomeorUndefined(slice.read().search) ?? "";
    const [text, setText] = useState(external);
    useEffect(() => { setText(external); }, [external]);
    const commit = (query: string) => {
        setText(query);
        queueMicrotask(() => slice.setSearch(query === "" ? none : some(query)));
    };
    const input = <SliceSearchInput text={text} compact={compact} showIds
        items={matches.map(m => ({ value: m.id, label: m.label, meta: getSomeorUndefined(m.meta) }))}
        onInput={commit} onSelect={commit} />;
    if (compact) return input;
    return <Box css={styles.root}>
        <Box css={styles.header}><Box as="span" css={styles.eyebrow}>SEARCH</Box>
            <Box as="span" css={styles.meta}>{`⌘K  ·  ${matches.length} MATCHES`}</Box></Box>
        <Box css={styles.body}>{input}</Box>
        <Box css={styles.footer}><Box as="span" css={styles.footerLabel}>↑↓ navigate · ↵ select · esc close</Box>
            {(value.recent?.length ?? 0) > 0 && <Box as="span" css={styles.footerLabel}>{`recent: ${value.recent.join(" · ")}`}</Box>}
        </Box>
    </Box>;
}, () => false);
