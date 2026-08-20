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
    // The tick grid spans the RENDER bounds (#620): the #619 overscan periods
    // carry ticks too, clipped at rest by the band's own clip and revealed by
    // a brush pan — the region a slide drags in is labelled, not blank. The
    // pan LAYER itself stays `inset: 0` so its transform origin (the plot's
    // left edge) matches every row layer's; the wider grid is an inner track.
    const rSpan = scale.renderMax - scale.renderMin;
    const ticks = [
        ...scale.overscan.filter((b) => b.index < 0),
        ...scale.buckets,
        ...scale.overscan.filter((b) => b.index >= scale.buckets.length),
    ];
    const columns = ticks.map((b) => `${(((b.x1 - b.x0) / rSpan) * 100).toFixed(4)}%`).join(" ");
    return (
        <Box css={styles.ruler} gridTemplateColumns={gridTemplate} data-slot="ruler">
            <Box css={styles.brushCaption} borderRight="none">{caption}</Box>
            <Box position="relative" minWidth={0} overflow="clip">
                {/* The brush-pan layer (#616): the tick grid + NOW chip are
                    window-anchored and slide with the canvas; the cursor chip
                    is pointer-anchored and stays outside the layer. */}
                <Box css={styles.panLayer} data-plan-panlayer>
                    <Box position="absolute" top={0} bottom={0} display="grid"
                        gridTemplateColumns={columns} data-plan-rulertrack
                        style={{
                            left: `${(scale.renderMin * 100).toFixed(4)}%`,
                            width: `${(rSpan * 100).toFixed(4)}%`,
                        }}>
                        {ticks.map((b) => (
                            <Box key={b.index} css={styles.rulerTick} data-slot="rulerTick">{b.label}</Box>
                        ))}
                    </Box>
                    {scale.nowFrac !== undefined && (
                        <>
                            <Box css={styles.nowLine} left={`${scale.nowFrac * 100}%`} />
                            <Box css={styles.nowChip} left={`${scale.nowFrac * 100}%`}
                                transform={`translate(${chipAnchor(scale.nowFrac)}, -50%)`}>NOW</Box>
                        </>
                    )}
                </Box>
                {cursorChipRef !== undefined && (
                    <Box ref={cursorChipRef} css={styles.cursorChip} top="50%"
                        data-plan-cursorchip style={{ display: "none" }} />
                )}
            </Box>
            {trailing}
        </Box>
    );
}
