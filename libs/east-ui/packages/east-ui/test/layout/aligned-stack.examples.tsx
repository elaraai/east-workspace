/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, FloatType, StructType, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { AlignedStack, Box, Chart } from "@elaraai/east-ui";

/**
 * Two charts on the same day axis, stacked in an `<AlignedStack>` with a shared
 * `gutter`. Both plots inset their lane to `[left, W−right]` (the gutter), so
 * their x-axes line up pixel-for-pixel even though each derives different y-axis
 * widths on its own. (#147)
 */
export const alignedStackCharts = example({
    keywords: ["AlignedStack", "plotGutter", "gutter", "align", "Chart", "stack", "axis", "shared"],
    description: "Two stacked charts share one plot gutter so their x-axes line up on a common day axis",
    fn: East.function([], UIComponentType, ($) => {
        const temp = $.const([
            { day: 0.0, v: 22.0 }, { day: 2.0, v: 20.5 }, { day: 4.0, v: 18.0 }, { day: 6.0, v: 16.5 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        const rate = $.const([
            { day: 0.0, v: 1.2 }, { day: 2.0, v: 0.9 }, { day: 4.0, v: 0.6 }, { day: 6.0, v: 0.3 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "48px", right: "16px" }} gap="8px">
                <Box height="180px" width="100%">
                    <Chart
                        layers={Chart.Line(temp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "°C" }}
                        grid
                    />
                </Box>
                <Box height="180px" width="100%">
                    <Chart
                        layers={Chart.Line(rate, { x: r => r.day, y: r => r.v }, { color: "purple.solid" })}
                        x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "rate" }}
                        grid
                    />
                </Box>
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * `gutter="auto"` — AlignedStack measures the max gutter its children need and
 * imposes it on all (not yet wired in the renderer; imposes nothing for now).
 */
export const alignedStackAuto = example({
    keywords: ["AlignedStack", "gutter", "auto", "measure", "align"],
    description: "AlignedStack with gutter='auto' (measure-the-max mode)",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { day: 0.0, v: 10.0 }, { day: 3.0, v: 14.0 }, { day: 6.0, v: 9.0 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter="auto" gap="6px">
                <Box height="160px" width="100%">
                    <Chart layers={Chart.Line(rows, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })} grid />
                </Box>
            </AlignedStack>
        );
    }),
    inputs: [],
});
