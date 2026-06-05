/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<SegmentedMeter>` tag — see the export's JSDoc.
 */

import { SegmentedMeter as SegmentedMeterFactory, type SegmentedMeterOptions } from "../../display/segmented-meter/index.js";
import { leaf, type JsxTag } from "../combinators.js";

/**
 * SegmentedMeter — a single bar split into proportional, individually-toned
 * segments, for showing how a total divides into parts (fresh/stale/broken,
 * assigned/unassigned). The `segments` prop is a config array of
 * `{ value, tone? | color?, label? }`; `max` sets the scale so any shortfall
 * shows as residual empty track, `thickness` sizes the bar, `labels` places
 * captions inside/outside/none, and `caption`/`trackColor` finish it
 * ({@link SegmentedMeterOptions}). Use `<Meter>` for a single reading.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { SegmentedMeter, UIComponentType } from "@elaraai/east-ui";
 *
 * const freshness = East.function([], UIComponentType, _$ => (
 *     <SegmentedMeter segments={[
 *         { value: 40, tone: "success", label: "Fresh" },
 *         { value: 35, tone: "warning", label: "Stale" },
 *         { value: 25, tone: "danger", label: "Broken" },
 *     ]} />
 * ));
 * ```
 *
 * @remarks
 * Carries `SegmentedMeter.Types` — the East data type, the per-segment struct,
 * and the style struct. Desugars to `SegmentedMeter.Root(segments, options)`.
 */
export const SegmentedMeter: JsxTag<SegmentedMeterOptions & { segments: Parameters<typeof SegmentedMeterFactory.Root>[0] }> & { Types: typeof SegmentedMeterFactory.Types } =
    Object.assign(leaf(SegmentedMeterFactory.Root, "segments"), { Types: SegmentedMeterFactory.Types });
