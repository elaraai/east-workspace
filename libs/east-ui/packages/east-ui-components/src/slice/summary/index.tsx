/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { useSliceReactivity } from "../use-slice-reactivity";

/** East Slice.Summary value type. */
export type SliceSummaryValue = ValueTypeOf<typeof Slice.Summary.Types.Summary>;

export interface EastChakraSliceSummaryProps {
    value: SliceSummaryValue;
}

/**
 * Renders an East UI `Slice.Summary` — a `N of M results · K narrowings ·
 * clear all` status bar. Result and total come from the platform's
 * `slice.resultCount()` / `slice.totalCount()` (the denominator gives the
 * essential "1,284 of 50,000" context, #169); the narrowing count from
 * `slice.activeCount()`; `clear all` calls `slice.clearFilters()`.
 */
export const EastChakraSliceSummary = memo(function EastChakraSliceSummary({ value }: EastChakraSliceSummaryProps) {
    const { slice } = value;
    useSliceReactivity(slice.key);
    const filterCount = Number(slice.activeCount());
    const resultCount = slice.resultCount();
    const totalCount = Number(slice.totalCount());

    const frame = useSlotRecipe({ key: "sliceFrame" })();
    return (
        <Box css={frame.frameFooter}>
            {resultCount !== undefined && (
                <>
                    <Box as="span" css={frame.frameFooterStat}>{Number(resultCount).toLocaleString()}</Box>
                    {/* The denominator only reads when a total exists (bound rows). */}
                    {totalCount > 0 && <Box as="span">{`of ${totalCount.toLocaleString()}`}</Box>}
                    <Box as="span">{Number(resultCount) === 1 ? "result" : "results"}</Box>
                    <Box as="span">·</Box>
                </>
            )}
            <Box as="span" css={frame.frameFooterStat}>{filterCount}</Box>
            <Box as="span">{filterCount === 1 ? "narrowing" : "narrowings"}</Box>
            {filterCount > 0 && (
                <>
                    <Box as="span">·</Box>
                    <chakra.button
                        type="button"
                        color="link"
                        fontWeight="medium"
                        cursor="pointer"
                        _hover={{ textDecoration: "underline", textUnderlineOffset: "2px" }}
                        onClick={() => { slice.clearFilters(); }}
                    >
                        clear all
                    </chakra.button>
                </>
            )}
        </Box>
    );
}, () => false);
