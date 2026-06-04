/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Chart `<Chart>` tag — composed multi-layer chart. Maps to `Chart.Root`. */

import { Chart as ChartFactory } from "../../charts/chart/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Chart layers={[Chart.Line(…), Chart.Bar(…)]} x={{…}} y={{…}} />` — composed multi-layer chart. Maps to `Chart.Root`. */
export const Chart: JsxTag<ValueProps<typeof ChartFactory.Root, "layers">> =
    leaf(ChartFactory.Root, "layers");
