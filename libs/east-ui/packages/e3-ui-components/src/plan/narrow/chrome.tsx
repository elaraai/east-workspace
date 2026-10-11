/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The narrow layout's shared ruler (split out of `narrow/index.tsx`, #815).
 * Its resolution is the frame's toolbar's segment (#1193), folded to a
 * one-chip menu where the row is short of room (#952).
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { NowLine } from "../../shared/time/now-line.js";
import { usePlanScale } from "../context.js";
import { usePlanWords } from "../words.js";
import { TimeRulerRow, timeRulerUnits } from "../../shared/time/ruler.js";

type Styles = Record<string, Record<string, unknown>>;

/**
 * The shared ruler — the LIST's sticky first row, not a row of the header.
 * It wears the desktop ruler's vocabulary (the panel surface, a separator
 * per bucket so its rhythm IS the card grids', a strong bottom rule) and
 * sits 10px under the tab baseline on the page, so it reads as the axis
 * over the cards rather than as a strip welded under the tab underline
 * (which is what a filled band directly beneath the tabs looked like). The
 * tick TRACK is inset to the card bodies' inset (25px) so the columns line
 * up down the page.
 *
 * Its labels are the desktop ruler's (#1269, `useRulerFit`): measured as
 * they draw, every k-th where the columns are narrower than they are, each
 * whole on the ruler's paper, each period's first column among them, and the
 * first and the last against the track's ends. The now bucket's label wears
 * the brand — a 28px band has no lane for the NOW chip, and a chip laid over
 * the labels hid the two it straddled — and draws wherever it clears the
 * periods' first columns, the labels it crowds giving way to it.
 */
export function NarrowRuler({ styles }: { styles: Styles }) {
    const scale = usePlanScale();
    const words = usePlanWords();
    const units = useMemo(() => timeRulerUnits(scale, words), [scale, words]);
    const nowIndex = scale.nowFrac === undefined ? undefined
        : scale.buckets.find((b) => scale.nowFrac! >= b.x0 && scale.nowFrac! < b.x1)?.index;
    const rulerStyles = { ...styles, rulerTick: styles.narrowRulerTick ?? {} };
    return (
        <Box css={styles.narrowRuler} data-slot="narrowRuler" data-time={units !== undefined ? "" : undefined}>
            <Box css={styles.narrowRulerTrack}>
                {units !== undefined && <TimeRulerRow scale={units} styles={rulerStyles} band="units" owner="plan-narrow" />}
                <TimeRulerRow scale={scale} styles={rulerStyles} band="ticks" owner="plan-narrow" highlight={nowIndex} />
                {scale.nowFrac !== undefined && <NowLine styles={styles} at={scale.nowFrac} />}
            </Box>
        </Box>
    );
}
