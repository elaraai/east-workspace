/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { useSliceReactivity } from "../use-slice-reactivity";

/** East Slice.Summary value type. */
export type SliceSummaryValue = ValueTypeOf<typeof Slice.Summary.Types.Summary>;

export interface EastChakraSliceSummaryProps {
    value: SliceSummaryValue;
}

/**
 * Renders an East UI `Slice.Summary` — a `N results · M filters · clear all`
 * status bar. The count comes from the platform's `slice.activeCount()`;
 * `clear all` calls `slice.clearFilters()`.
 */
export const EastChakraSliceSummary = memo(function EastChakraSliceSummary({ value }: EastChakraSliceSummaryProps) {
    const { slice } = value;
    useSliceReactivity(slice.key);
    const filterCount = Number(slice.activeCount());
    const resultCount = slice.resultCount();

    return (
        <Box
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="10px"
            bg="bg.surface"
            paddingX="18px"
            paddingY="14px"
            textStyle="body.md"
        >
            {resultCount !== undefined && (
                <>
                    <Box as="span" fontFamily="mono" fontWeight="semibold" fontVariantNumeric="tabular-nums" color="fg">
                        {Number(resultCount).toLocaleString()}
                    </Box>
                    {Number(resultCount) === 1 ? " result" : " results"}
                    <Box as="span" color="fg.muted">{" · "}</Box>
                </>
            )}
            <Box as="span" fontFamily="mono" fontVariantNumeric="tabular-nums" color="fg">
                {filterCount}
            </Box>
            {filterCount === 1 ? " narrowing" : " narrowings"}
            {filterCount > 0 && (
                <>
                    <Box as="span" color="fg.muted">{" · "}</Box>
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
