/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<MetricChip tone={…}>` tag — labelled metric pill; the value is its child. Maps to `MetricChip.Root`. */

import { MetricChip as MetricChipFactory } from "../../display/metric-chip/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<MetricChip tone={…}>` — labelled metric pill (required `tone`); the value is its child. Maps to `MetricChip.Root`. */
export const MetricChip: JsxTag<ContentProps<typeof MetricChipFactory.Root>> = content(MetricChipFactory.Root);
