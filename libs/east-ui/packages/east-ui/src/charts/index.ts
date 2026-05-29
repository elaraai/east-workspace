/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chart exports.
 *
 * @remarks
 * The high-level declarative chart API — `Chart.Root` / `Chart.Line` /
 * `Chart.Bar` / `Chart.Area` / `Chart.Scatter` / `Chart.Band` plus
 * `Chart.refLine` / `Chart.refBand` / `Chart.refDot` and `Chart.format.*` —
 * lives in `./chart/index.js` and is re-exported from the package barrel. The
 * low-level visx-primitive layer is `Chart.Spec` (`./spec`). `Sparkline` is a
 * standalone inline-trend component exported here.
 *
 * @packageDocumentation
 */

import { Sparkline } from "./sparkline/index.js";
export {
    SparklineType,
    SparklineChartType,
    type SparklineChartLiteral,
    type SparklineStyle,
} from "./sparkline/index.js";

export { Sparkline };
