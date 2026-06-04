/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<SegmentedMeter>` tag — multi-segment meter. Maps to `SegmentedMeter.Root`. */

import { SegmentedMeter as SegmentedMeterFactory, type SegmentedMeterOptions } from "../../display/segmented-meter/index.js";
import { leaf, type JsxTag } from "../combinators.js";

/** `<SegmentedMeter segments={[…]} max={100} thickness="sm" />` — segmented meter. Maps to `SegmentedMeter.Root`. */
export const SegmentedMeter: JsxTag<SegmentedMeterOptions & { segments: Parameters<typeof SegmentedMeterFactory.Root>[0] }> =
    leaf(SegmentedMeterFactory.Root, "segments");
