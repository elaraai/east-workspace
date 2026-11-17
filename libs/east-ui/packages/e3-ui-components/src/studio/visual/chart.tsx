/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart visual's tile (#1671): its spec — {@link chartModel}'s, read from
 * its answers — drawn by east-ui-components' chart renderer, filling its tile;
 * and, when it holds fewer groups than its source has, a line that says how
 * many of how many (CHT-9). A click on a mark, a slice or a legend row tells
 * the tile (CHT-8).
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { EastVisxChart, type ChartMarkHandler } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { chartModel, type ChartView } from "./chart-spec.js";
import { ShownNote } from "./notes.js";
import type { VisualAsked } from "./values.js";

/** Props of {@link ChartVisual}: the chart, its answers and its source, and what a click tells. */
export interface ChartVisualProps extends VisualAsked {
    /** The chart. */
    readonly chart: ChartView;
    /** Told a mark, a slice or a legend row a click falls on; the chart takes no click without it. */
    readonly onMark?: ChartMarkHandler | undefined;
}

/**
 * A chart visual's tile: its chart, and what it holds of how many.
 *
 * @param props - The chart, its answers, its source and what a click tells
 * @returns The tile's body; nothing when its groups' program did not answer
 */
export function ChartVisual({ chart, asks, answers, source, onMark }: ChartVisualProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const model = useMemo(() => chartModel(chart, asks, answers, source, words, m), [chart, asks, answers, source, words, m]);
    if (model === undefined) return null;
    return (
        <Box css={styles.root} data-studio-chart={chart.type}>
            <EastVisxChart value={model.spec} {...(onMark !== undefined ? { onMark } : {})} />
            {model.shown !== undefined && <ShownNote shown={model.shown} />}
        </Box>
    );
}
