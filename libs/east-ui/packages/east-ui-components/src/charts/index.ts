/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chart renderers. `EastVisxChart` renders the unified visx-primitive chart
 * tree (the `VisxChart` arm backing `Chart.*` and `Slice.Chart.*`); `Sparkline`
 * is the standalone inline-trend renderer.
 */
export { EastChakraSparkline, type EastChakraSparklineProps } from "./sparkline/index.js";
export { EastVisxChart, type EastVisxChartProps } from "./spec/index.js";
