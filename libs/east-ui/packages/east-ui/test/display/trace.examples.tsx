/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Trace, ChipRail, Tag, Stack } from "@elaraai/east-ui";

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

export const traceDensities = example({
    keywords: ["Trace", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "The three densities stacked — step height + font scale condensed → compact → comfortable (matching ChipRail)",
    fn: East.function([], UIComponentType, ($) => {
        const tracks = [
            { name: "A", values: [12, 14, 13, 18, 20, 22] },
            { name: "B", values: [40, 38, 35, 30, 28, 25] },
        ];
        const condensed = $.const(<Trace tracks={tracks} now={4n} density="condensed" />);
        const compact = $.const(<Trace tracks={tracks} now={4n} density="compact" />);
        const comfortable = $.const(<Trace tracks={tracks} now={4n} density="comfortable" />);
        return (
            <Stack direction="column" gap="6">
                {condensed}
                {compact}
                {comfortable}
            </Stack>
        );
    }),
    inputs: [],
});

export const traceScales = example({
    keywords: ["Trace", "scale", "brand", "diverge", "categorical", "colour"],
    description: "The three colour encodings — sequential brand, diverging about each track's midpoint, and one hue per track",
    fn: East.function([], UIComponentType, ($) => {
        const tracks = [
            { name: "A", values: [12, 14, 13, 18, 20, 22] },
            { name: "B", values: [40, 38, 35, 30, 28, 25] },
            { name: "C", values: [5, 9, 7, 11, 8, 14] },
        ];
        const brand = $.const(<Trace tracks={tracks} now={4n} density="compact" scale="brand" />);
        const diverge = $.const(<Trace tracks={tracks} now={4n} density="compact" scale="diverge" />);
        const categorical = $.const(<Trace tracks={tracks} now={4n} density="compact" scale="categorical" />);
        return (
            <Stack direction="column" gap="6">
                {brand}
                {diverge}
                {categorical}
            </Stack>
        );
    }),
    inputs: [],
});

export const traceRagged = example({
    keywords: ["Trace", "ragged", "unequal", "lengths", "padding", "phantom", "row"],
    description: "Tracks of unequal length — the longer track is padded into its own row rather than overflowing into a stub-less phantom row",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Trace
                tracks={[
                    { name: "Bé", values: [12, 11, 10, 9, 8] },        // 5 steps
                    { name: "°C", values: [22, 23, 24, 25, 26, 27] },  // 6 steps — one longer
                ]}
                now={4n}
                future="ghost"
                density="compact"
            />
        );
    }),
    inputs: [],
});

export const traceLabelWidth = example({
    keywords: ["Trace", "labelWidth", "gutter", "label", "truncate", "width"],
    description: "A wider label gutter (labelWidth) so a per-track total folded into the name stays legible instead of truncating",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Trace
                tracks={[
                    { name: "R & R · 20", values: [12, 14, 13, 18, 20, 22] },
                    { name: "Pumpover · 8", values: [3, 5, 4, 6, 8, 7] },
                    { name: "Additions · 12", values: [8, 10, 9, 11, 12, 10] },
                ]}
                now={4n}
                density="compact"
                labelWidth="120px"
            />
        );
    }),
    inputs: [],
});

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
