/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A KPI's tile (#1671), as its mock draws it: its value, a 26 px number in
 * short with its unit a small label beside it, under the tile's eyebrow, which
 * names it; at the end of that row its change against its compare, a DeltaPill
 * in its valence with a caret, so colour is never its only sign; its goal, a
 * square progress bar with a tick at the goal; its trend, a sparkline; and one
 * line of annotation — what the change is against, how far to the goal and
 * the gap (KPI-1 to KPI-3). Each part is gone with its well. What it shows and
 * says is {@link kpiModel}'s; this draws it. At every width a page gives its
 * tile it stands whole (#1692): the `studioVisual` recipe wraps its row and
 * steps its number down; its annotation, cut where it runs past, is whole on
 * hover.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { EastChakraProgress, EastChakraSparkline, useFormatters, type EastChakraSparklineProps, type ProgressValue } from "@elaraai/east-ui-components";
import { MetricChipFrame, useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useStudioMessages } from "../messages.js";
import { kpiModel, type KpiView, type VisualAsked } from "./values.js";

/** Props of {@link KpiVisual}: the KPI, its answers and its source. */
export interface KpiVisualProps extends VisualAsked {
    /** The KPI. */
    readonly kpi: KpiView;
}

/**
 * A KPI's tile: its value and unit, its change, its goal, its trend and its
 * one line of annotation.
 *
 * @param props - The KPI, its answers and its source
 * @returns The tile's body
 */
export function KpiVisual({ kpi, asks, answers, source }: KpiVisualProps) {
    const m = useStudioMessages();
    const words = useFormatters();
    const styles = useSlotStyles("studioVisual");
    const model = useMemo(() => kpiModel(kpi, asks, answers, source, m, words), [kpi, asks, answers, source, m, words]);
    const trend = useMemo((): EastChakraSparklineProps["value"] => ({
        data: [...model.trend],
        type: some(variant("line", null)),
        style: some({ color: some("series.1"), width: some("100%"), height: some("36px") }),
    }), [model.trend]);
    const progress = useMemo((): ProgressValue | undefined => (model.goal === undefined ? undefined : {
        value: model.goal.share * 100,
        min: some(0),
        max: some(100),
        label: none,
        valueText: none,
        showValue: none,
        indeterminate: none,
        estimatedDuration: none,
        startedAt: none,
        style: none,
    }), [model.goal]);
    const change = model.change;
    return (
        <Box css={styles.kpi} data-studio-kpi="">
            <Box css={styles.kpiRow}>
                <Box css={styles.kpiValue}>
                    {model.text === undefined ? (
                        // An absent value is said in words, never a zero.
                        <Box as="span" css={styles.absent} data-studio-kpi-value="" data-absent="">{m.noValue()}</Box>
                    ) : (
                        <>
                            <Box as="span" css={styles.kpiNumber} data-studio-kpi-value="">{model.text}</Box>
                            {model.unit !== undefined && <Box as="span" css={styles.kpiUnit} data-studio-kpi-unit="">{model.unit}</Box>}
                        </>
                    )}
                </Box>
                {change !== undefined && (
                    <Box as="span" css={styles.kpiChange} data-studio-kpi-change={change.change.tone}>
                        <MetricChipFrame
                            tone={change.change.tone}
                            icon={{ prefix: "fas", name: change.change.delta > 0 ? "caret-up" : change.change.delta < 0 ? "caret-down" : "minus" }}
                        >
                            {change.text}
                        </MetricChipFrame>
                    </Box>
                )}
            </Box>
            {progress !== undefined && (
                <Box css={styles.goal} data-studio-kpi-goal="">
                    <EastChakraProgress value={progress} />
                    <Box css={styles.goalTick} data-studio-kpi-goal-tick="" />
                </Box>
            )}
            {model.trend.length > 0 && (
                <Box css={styles.trend} data-studio-kpi-trend="">
                    <EastChakraSparkline value={trend} />
                </Box>
            )}
            {model.annotation !== undefined && <Box css={styles.anno} data-studio-kpi-note="" title={model.annotation}>{model.annotation}</Box>}
        </Box>
    );
}
