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
import { NowChip, NowLine } from "../../shared/time/now-line.js";
import { usePlanScale } from "../context.js";
import { usePlanWords } from "../words.js";
import { GridSeparators } from "../rows/RowShell.js";

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
    /** The cursor readout chip's element — always mounted (hidden), written
     *  DIRECTLY by the canvas's cursor controller (#609): label, position and
     *  visibility are DOM writes, so a pointermove renders nothing. */
    cursorChipRef?: React.Ref<HTMLDivElement>;
    /** The trailing cell for the review decision column (#569). */
    trailing?: React.ReactNode;
}

/** The 28px ruler band. */
export function PlanRuler({ styles, gridTemplate, caption, cursorChipRef, trailing }: PlanRulerProps) {
    const scale = usePlanScale();
    const words = usePlanWords();
    const columns = scale.buckets.map((b) => `${((b.x1 - b.x0) * 100).toFixed(4)}%`).join(" ");
    return (
        <Box css={styles.ruler} gridTemplateColumns={gridTemplate} data-slot="ruler">
            {/* The gutter's rule runs down through the ruler as through every row. */}
            <Box css={styles.brushCaption}>{caption}</Box>
            <Box position="relative" minWidth={0} overflow="clip">
                <Box position="absolute" inset={0} display="grid" gridTemplateColumns={columns}>
                    {scale.buckets.map((b) => (
                        <Box key={b.index} css={styles.rulerTick} data-slot="rulerTick">{b.label}</Box>
                    ))}
                </Box>
                {/* The bucket lines and the now line are the ROWS' — the same
                    elements, placed in a box of the plot's own geometry — so
                    the header's lines are the rows' lines, pixel for pixel,
                    however an edge rounds. */}
                <GridSeparators styles={styles} />
                {scale.nowFrac !== undefined && (
                    <>
                        <NowLine styles={styles} at={scale.nowFrac} data-plan-now />
                        <NowChip styles={styles} at={scale.nowFrac} anchor={chipAnchor(scale.nowFrac)} data-plan-nowchip>{words.m.now()}</NowChip>
                    </>
                )}
                {cursorChipRef !== undefined && (
                    <Box ref={cursorChipRef} css={styles.cursorChip} top="50%"
                        data-plan-cursorchip style={{ display: "none" }} />
                )}
            </Box>
            {trailing}
        </Box>
    );
}
