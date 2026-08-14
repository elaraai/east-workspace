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
                        <Box css={styles.nowChip} left={`${scale.nowFrac * 100}%`}>NOW</Box>
                    </>
                )}
                {cursor !== undefined && (
                    <Box css={styles.cursorChip} left={`${cursor.frac * 100}%`} top="50%" transform="translate(-50%, -50%)">
                        {cursor.label}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
