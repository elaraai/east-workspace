/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ruler (28px, `Plan Spec.html` §2) — the tick band on the shared
 * template, sticky with the header chrome: one mono tick per bucket (grid
 * columns sized by the buckets' window fractions, so clipped edge buckets
 * stay true), the NOW chip on the brand rule, and the cursor readout chip.
 */

import { Box } from "@chakra-ui/react";
import { usePlanScale } from "../context.js";

type Styles = Record<string, Record<string, unknown>>;

/**
 * Where a chip sits relative to the instant it marks.
 *
 * Centred through the middle of the track, and anchored INSIDE at either end.
 * The ruler clips (so a chip can never inflate the canvas's scroll width), and
 * this is what keeps the clip from ever having to cut the label: at the last
 * column the readout you are hovering to read is exactly the one that would
 * lose half its text.
 */
export function chipAnchor(frac: number): string {
    if (frac > 0.92) return "-100%";
    if (frac < 0.08) return "0%";
    return "-50%";
}

export interface PlanRulerProps {
    styles: Styles;
    gridTemplate: string;
    /** The gutter caption — the active grain's name (`RESOURCE`, the §1 mock). */
    caption: string;
    /** The cursor fraction + its bucket's label (the readout chip). */
    cursor: { frac: number; label: string } | undefined;
}

/** The 28px ruler band. */
export function PlanRuler({ styles, gridTemplate, caption, cursor }: PlanRulerProps) {
    const scale = usePlanScale();
    const columns = scale.buckets.map((b) => `${((b.x1 - b.x0) * 100).toFixed(4)}%`).join(" ");
    return (
        <Box css={styles.ruler} gridTemplateColumns={gridTemplate} data-slot="ruler">
            <Box css={styles.brushCaption} borderRight="none">{caption}</Box>
            <Box position="relative" display="grid" gridTemplateColumns={columns} minWidth={0}>
                {scale.buckets.map((b) => (
                    <Box key={b.index} css={styles.rulerTick} data-slot="rulerTick">{b.label}</Box>
                ))}
                {scale.nowFrac !== undefined && (
                    <>
                        <Box css={styles.nowLine} left={`${scale.nowFrac * 100}%`} />
                        <Box css={styles.nowChip} left={`${scale.nowFrac * 100}%`}
                            transform={`translate(${chipAnchor(scale.nowFrac)}, -50%)`}>NOW</Box>
                    </>
                )}
                {cursor !== undefined && (
                    <Box css={styles.cursorChip} left={`${cursor.frac * 100}%`} top="50%"
                        transform={`translate(${chipAnchor(cursor.frac)}, -50%)`}>
                        {cursor.label}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
