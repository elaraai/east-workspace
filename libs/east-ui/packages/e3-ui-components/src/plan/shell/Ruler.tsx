/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ruler (28px, `Plan Spec.html` §2) — the tick band on the shared
 * template, sticky with the header chrome: one mono tick per bucket (grid
 * columns sized by the buckets' window fractions, so clipped edge buckets
 * stay true), the NOW chip on the brand rule, and the cursor readout chip.
 *
 * Where its columns are narrower than their labels it labels every k-th, each
 * whole, k the smallest step at which they fit with a gap between two, a
 * period's first column always among them (#1269, the user's ruling): a
 * week's Monday under days, a month's first week under weeks, a year's January
 * under months or quarters, a day's midnight under hours. A label may run past
 * its column into the blank columns beside it, above their bucket lines; the
 * first and the last sit against the track's ends. The labels are measured
 * before the browser paints (`useRulerFit`, the narrow layout's ruler's too),
 * so no frame shows a label it does not rest on. The renderer sets data
 * attributes: `data-period-start`, `data-thinned` and `data-align` on a tick,
 * `data-tick-label` on its label.
 */

import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import { NowChip, NowLine } from "../../shared/time/now-line.js";
import { usePlanScale } from "../context.js";
import { usePlanWords } from "../words.js";
import { GridSeparators } from "../rows/RowShell.js";
import { startsPeriod, useRulerFit } from "./use-ruler-fit.js";

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
}

/** The 28px ruler band. */
export function PlanRuler({ styles, gridTemplate, caption, cursorChipRef }: PlanRulerProps) {
    const scale = usePlanScale();
    const words = usePlanWords();
    const trackRef = useRef<HTMLDivElement | null>(null);
    const columns = scale.buckets.map((b) => `${((b.x1 - b.x0) * 100).toFixed(4)}%`).join(" ");
    // Which labels draw, measured before paint (#1269).
    const placed = useRulerFit(trackRef, scale);

    return (
        <Box css={styles.ruler} gridTemplateColumns={gridTemplate} data-slot="ruler">
            {/* The gutter's rule runs down through the ruler as through every row. */}
            <Box css={styles.brushCaption}>{caption}</Box>
            <Box ref={trackRef} position="relative" minWidth={0} overflow="clip">
                <Box position="absolute" inset={0} display="grid" gridTemplateColumns={columns}>
                    {scale.buckets.map((b, i) => {
                        const align = placed?.align[i] ?? "centre";
                        return (
                            <Box key={b.index} css={styles.rulerTick} data-slot="rulerTick"
                                data-period-start={startsPeriod(scale, b) ? "" : undefined}
                                data-thinned={placed !== undefined && !placed.shown[i] ? "" : undefined}
                                data-align={align !== "centre" ? align : undefined}>
                                <Box as="span" css={styles.rulerLabel} data-tick-label="">{b.label}</Box>
                            </Box>
                        );
                    })}
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
        </Box>
    );
}
