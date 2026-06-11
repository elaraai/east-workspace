/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<MetricChip>` tag — see the export's JSDoc.
 */

import { MetricChip as MetricChipFactory } from "../../display/metric-chip/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * MetricChip — a compact pill for a single signed metric or delta (a +12.5%
 * change, a latency reading) where the sign carries meaning. The required
 * `tone` (positive / negative / neutral / info) sets the semantic colour;
 * `emphasis` chooses subtle / solid / outline weight; an optional `unit`
 * suffixes the value; colour slots are escape hatches ({@link MetricChipOptions}).
 * The value is the child.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { MetricChip, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const delta = East.function([], UIComponentType, _$ => (
 *     <MetricChip tone="positive" emphasis="subtle"><Text>+12.5%</Text></MetricChip>
 * ));
 * ```
 *
 * @remarks
 * Carries `MetricChip.Types` — the East data type and the style struct.
 * Desugars to `MetricChip.Root(value, options)`.
 */
export const MetricChip: JsxTag<ContentProps<typeof MetricChipFactory.Root>> & { Types: typeof MetricChipFactory.Types } =
    Object.assign(content(MetricChipFactory.Root), { Types: MetricChipFactory.Types });
