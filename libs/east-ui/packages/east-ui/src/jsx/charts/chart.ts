/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chart `<Chart>` tag — composed multi-layer chart. Maps to `Chart.Root`.
 *
 * The layer / reference / format builders are attached to the tag, so a single
 * `Chart` import gives both `<Chart …/>` and `Chart.Line` / `Chart.refLine` /
 * `Chart.format` — no separate factory import.
 */

import { Chart as ChartFactory } from "../../charts/chart/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Layer / reference / format builders surfaced on the `<Chart>` tag (mirrors the `Chart` factory namespace). */
type ChartBuilders = {
    Line: typeof ChartFactory.Line;
    Bar: typeof ChartFactory.Bar;
    Area: typeof ChartFactory.Area;
    Scatter: typeof ChartFactory.Scatter;
    Band: typeof ChartFactory.Band;
    refLine: typeof ChartFactory.refLine;
    refBand: typeof ChartFactory.refBand;
    refDot: typeof ChartFactory.refDot;
    format: typeof ChartFactory.format;
    Spec: typeof ChartFactory.Spec;
};

/** `<Chart layers={[Chart.Line(…), Chart.Bar(…)]} x={{…}} y={{…}} />` — composed multi-layer chart. Maps to `Chart.Root`. */
export const Chart: JsxTag<ValueProps<typeof ChartFactory.Root, "layers">> & ChartBuilders =
    Object.assign(leaf(ChartFactory.Root, "layers"), {
        Line: ChartFactory.Line,
        Bar: ChartFactory.Bar,
        Area: ChartFactory.Area,
        Scatter: ChartFactory.Scatter,
        Band: ChartFactory.Band,
        refLine: ChartFactory.refLine,
        refBand: ChartFactory.refBand,
        refDot: ChartFactory.refDot,
        format: ChartFactory.format,
        Spec: ChartFactory.Spec,
    });
