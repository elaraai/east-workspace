/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart visual's tile (#1671): its spec — {@link chartModel}'s, read from
 * its answers — drawn by east-ui-components' chart renderer, filling its tile,
 * its numbers printed short as every tile's are; over it, where its model has
 * one, the line that says what its axes are; and, when it holds fewer groups
 * than its source has, a line that says how many of how many (CHT-9). A click
 * on a mark, a slice or a legend row tells the tile (CHT-8).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { EastVisxChart, type ChartMarkHandler, type ChartNumberText } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { chartModel, type ChartView } from "./chart-spec.js";
import { useGroupClicks } from "./clicks.js";
import { VisualMeta } from "./meta.js";
import { ShownNote } from "./notes.js";
import { shortNumber, type VisualAsked } from "./values.js";

/** Props of {@link ChartVisual}: the chart, its answers and its source. */
export interface ChartVisualProps extends VisualAsked {
    /** The chart. */
    readonly chart: ChartView;
}

/**
 * A chart visual's tile: its chart, and what it holds of how many.
 *
 * @param props - The chart, its answers and its source
 * @returns The tile's body; nothing when its groups' program did not answer
 */
export function ChartVisual({ chart, asks, answers, source }: ChartVisualProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const model = useMemo(() => chartModel(chart, asks, answers, source, words, m), [chart, asks, answers, source, words, m]);
    // A tile's numbers are short: an axis's ticks with no zeros ending their decimals, a pie's values each to three figures.
    const trimmed = model?.numbers === "ticks";
    const numberText = useCallback<ChartNumberText>((n, format, of) => shortNumber(n, format, words.formatters, of, trimmed), [words, trimmed]);
    // A click on a mark, a slice or a legend row tells the groups it stands for (CHT-8); the chart takes no click
    // where its visual's click does nothing.
    const { raise, onClickCapture } = useGroupClicks();
    const onMark = useMemo((): ChartMarkHandler | undefined => (raise === undefined || model === undefined ? undefined : (mark) => { raise(model.clicked(mark)); }),
        [raise, model]);
    if (model === undefined) return null;
    return (
        <Box css={styles.root} data-studio-chart={chart.type} onClickCapture={onClickCapture}>
            <VisualMeta view={variant("chart", chart)} source={source} shown={model.shown} />
            {model.caption !== undefined && <Box css={styles.caption} data-studio-chart-caption="">{model.caption}</Box>}
            <EastVisxChart value={model.spec} numberText={numberText} {...(onMark !== undefined ? { onMark } : {})} />
            {model.shown !== undefined && <ShownNote shown={model.shown} />}
        </Box>
    );
}
