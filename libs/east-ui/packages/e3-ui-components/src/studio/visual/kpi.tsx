/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A KPI's tile (#1671): its value, the Stat's 26 px number in its field's
 * format, under the tile's eyebrow, which names it; its change against its
 * compare, a DeltaPill in its valence with a caret, so colour is never its
 * only sign, and what it is against; its trend, a sparkline; and its goal, a
 * progress bar with how far to it and the gap (KPI-1 to KPI-3). What it shows
 * and says is {@link kpiModel}'s; this draws it with the parts' own renderers.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import {
    EastChakraProgress, EastChakraSparkline, EastChakraStat, useFormatters,
    type EastChakraSparklineProps, type ProgressValue, type StatValue,
} from "@elaraai/east-ui-components";
import { MetricChipFrame, useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useStudioMessages } from "../messages.js";
import { kpiModel, type KpiView, type VisualAsked } from "./values.js";

/** Props of {@link KpiVisual}: the KPI, its answers and its source, and where its parts keep their state. */
export interface KpiVisualProps extends VisualAsked {
    /** The KPI. */
    readonly kpi: KpiView;
    /** Where its parts keep their state. */
    readonly storageKey: string;
}

/**
 * A KPI's tile: its value, its change, its trend and its goal.
 *
 * @param props - The KPI, its answers and its source
 * @returns The tile's body
 */
export function KpiVisual({ kpi, asks, answers, source, storageKey }: KpiVisualProps) {
    const m = useStudioMessages();
    const words = useFormatters();
    const styles = useSlotStyles("studioVisual");
    const model = useMemo(() => kpiModel(kpi, asks, answers, source, m, words), [kpi, asks, answers, source, m, words]);
    const stat = useMemo((): StatValue => ({
        // The tile's eyebrow names it: the Stat draws no label of its own.
        label: "",
        // An absent value is said in words, never a zero.
        value: model.value === undefined ? variant("String", m.noValue()) : variant("Float", model.value),
        format: model.value === undefined || model.format === undefined ? none : some(model.format),
        helpText: none,
        baseline: none,
        delta: none,
        info: none,
        indicator: none,
        style: none,
        density: none,
    }), [model, m]);
    const trend = useMemo((): EastChakraSparklineProps["value"] => ({
        data: [...model.trend],
        type: some(variant("line", null)),
        style: some({ color: some("series.1"), width: some("100%"), height: some("32px") }),
    }), [model.trend]);
    const progress = useMemo((): ProgressValue | undefined => (model.goal === undefined ? undefined : {
        value: model.goal.standing.share * 100,
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
            <EastChakraStat value={stat} storageKey={`${storageKey}.value`} />
            {change !== undefined && (
                <Box css={styles.change} data-studio-kpi-change={change.change.tone}>
                    <MetricChipFrame
                        tone={change.change.tone} emphasis="outline"
                        icon={{ prefix: "fas", name: change.change.delta > 0 ? "caret-up" : change.change.delta < 0 ? "caret-down" : "minus" }}
                    >
                        {change.text}
                    </MetricChipFrame>
                    <Box as="span" css={styles.against}>{change.against}</Box>
                </Box>
            )}
            {model.trend.length > 0 && (
                <Box css={styles.trend} data-studio-kpi-trend="">
                    <EastChakraSparkline value={trend} />
                </Box>
            )}
            {model.goal !== undefined && progress !== undefined && (
                <Box css={styles.goal} data-studio-kpi-goal="">
                    <EastChakraProgress value={progress} />
                    <Box as="span" css={styles.gap}>{model.goal.text}</Box>
                </Box>
            )}
        </Box>
    );
}
