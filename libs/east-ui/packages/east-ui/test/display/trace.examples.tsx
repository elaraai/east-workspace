/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Trace, ChipRail, Separator, Tag, VStack, Stack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const TRACE_DENSITIES_DATA = [
    { name: "A", values: [12, 14, 13, 18, 20, 22] },
    { name: "B", values: [40, 38, 35, 30, 28, 25] },
];
const TRACE_SCALES_DATA = [
    { name: "A", values: [12, 14, 13, 18, 20, 22] },
    { name: "B", values: [40, 38, 35, 30, 28, 25] },
    { name: "C", values: [5, 9, 7, 11, 8, 14] },
];
const TRACE_RAGGED_DATA = [
    { name: "Series A", values: [12, 11, 10, 9, 8] },  // 5 steps
    { name: "°C", values: [22, 23, 24, 25, 26, 27] },  // 6 steps — one longer
];
const TRACE_LABEL_WIDTH_DATA = [
    { name: "Series A · 20", values: [12, 14, 13, 18, 20, 22] },
    { name: "Series B · 8", values: [3, 5, 4, 6, 8, 7] },
    { name: "Series C · 12", values: [8, 10, 9, 11, 12, 10] },
];

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const traceBasic = example({
    keywords: ["Trace", "heatmap", "now", "measured", "predicted"],
    description: "Two tracks over a shared step axis with a now-line after four measured steps and per-step axis labels",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Trace
                tracks={[
                    { name: "A", values: [12, 14, 13, 18, 20, 22] },
                    { name: "B", values: [40, 38, 35, 30, 28, 25] },
                ]}
                now={4n}
                density="comfortable"
                scale="brand"
                axis={["−3", "−2", "−1", "0", "+1", "+2"]}
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// With ChipRail — the cross-component height-match contract
// ============================================================================

export const traceWithChipRail = example({
    keywords: ["Trace", "ChipRail", "density", "table", "align", "row"],
    description: "A Trace and a ChipRail at the same density sit at matching heights — the case for adjacent table cells",
    fn: East.function([], UIComponentType, ($) => {
        const trace = $.const(
            <Trace
                tracks={[{ name: "A", values: [12, 14, 13, 18, 20, 22] }]}
                now={4n}
                density="compact"
                scale="brand"
            />,
        );
        const rail = $.const(
            <ChipRail density="compact" separator="dot">
                <Tag>Open</Tag>
                <Tag>3 days</Tag>
                <Tag>On track</Tag>
            </ChipRail>,
        );
        return (
            <Stack direction="row" gap="8">
                {trace}
                {rail}
            </Stack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Trace — densities, scales, ragged tracks, label gutter (variant panel)
// ============================================================================

export const traceVariants = example({
    keywords: ["Trace", "density", "condensed", "compact", "comfortable", "sizes", "scale", "brand", "diverge", "categorical", "colour", "ragged", "unequal", "lengths", "padding", "phantom", "row", "labelWidth", "gutter", "label", "truncate", "width"],
    description: "Trace variant panel — densities (the three densities stacked — step height + font scale condensed → compact → comfortable, matching ChipRail), scales (the three colour encodings — sequential brand, diverging about each track's midpoint, and one hue per track), ragged (tracks of unequal length — the longer track is padded into its own row), label width (a wider label gutter so a per-track total folded into the name stays legible)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<Trace tracks={TRACE_DENSITIES_DATA} now={4n} density="condensed" />);
        const compact = $.const(<Trace tracks={TRACE_DENSITIES_DATA} now={4n} density="compact" />);
        const comfortable = $.const(<Trace tracks={TRACE_DENSITIES_DATA} now={4n} density="comfortable" />);
        const brand = $.const(<Trace tracks={TRACE_SCALES_DATA} now={4n} density="compact" scale="brand" />);
        const diverge = $.const(<Trace tracks={TRACE_SCALES_DATA} now={4n} density="compact" scale="diverge" />);
        const categorical = $.const(<Trace tracks={TRACE_SCALES_DATA} now={4n} density="compact" scale="categorical" />);
        return (
            <VStack gap="4" align="stretch">
                <Separator label="DENSITIES" align="start" />
                <Stack direction="column" gap="6">
                    {condensed}
                    {compact}
                    {comfortable}
                </Stack>
                <Separator label="SCALES" align="start" />
                <Stack direction="column" gap="6">
                    {brand}
                    {diverge}
                    {categorical}
                </Stack>
                <Separator label="RAGGED" align="start" />
                <Trace
                    tracks={TRACE_RAGGED_DATA}
                    now={4n}
                    future="ghost"
                    density="compact"
                />
                <Separator label="LABEL WIDTH" align="start" />
                <Trace
                    tracks={TRACE_LABEL_WIDTH_DATA}
                    now={4n}
                    density="compact"
                    labelWidth="120px"
                />
            </VStack>
        );
    }),
    inputs: [],
});
