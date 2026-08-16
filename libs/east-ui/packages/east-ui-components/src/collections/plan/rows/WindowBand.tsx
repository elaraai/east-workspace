/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run of source elements that is NOT resident (#577) — one band, sized by the
 * ledger.
 *
 * Deliberately ONE element rather than a skeleton per row: the canvas cannot
 * know how many rows an unvisited window produces (a series emits several per
 * source element, or none), so drawing a row count would assert something it
 * has no way to support. The repeating rule reads as rows without claiming a
 * number, and the caption states what IS known — how many source elements the
 * band covers.
 *
 * Its height comes from the ledger, so this band and the rows that replace it
 * occupy exactly the same space: scrolling in loads content without moving
 * anything below, and eviction puts the band back with nothing shifting either.
 */

import { Box } from "@chakra-ui/react";
import { bandElements, type PlanBand } from "../use-plan-paging.js";

type Styles = Record<string, Record<string, unknown>>;

export interface WindowBandProps {
    band: PlanBand;
    styles: Styles;
    /** Whether a window inside this band is currently in flight. */
    loading: boolean;
}

/** The unloaded run above or below the resident rows. */
export function WindowBand({ band, styles, loading }: WindowBandProps) {
    const count = bandElements(band);
    const caption = loading
        ? `Loading elements ${band.from.toLocaleString()}–${band.to.toLocaleString()}`
        : band.at === "head"
            ? `${count.toLocaleString()} earlier elements — scroll to load`
            : `${count.toLocaleString()} more elements — scroll to load`;
    return (
        <Box
            css={styles.windowBand}
            height={`${Math.max(0, band.px)}px`}
            data-plan-window-band={band.at}
            data-plan-elements={count}
            aria-busy={loading ? "true" : undefined}
        >
            <Box css={styles.windowBandCaption}>{caption}</Box>
        </Box>
    );
}
