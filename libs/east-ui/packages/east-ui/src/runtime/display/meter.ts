/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Meter>` tag — see the export's JSDoc.
 */

import { Meter as MeterFactory } from "../../display/meter/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Meter — a single-value gauge for a bounded quantity such as utilisation,
 * uptime, or progress toward a target. The required `value` is the prop; `max`
 * sets the scale (default 100), `tone` picks a semantic colour, `thickness`
 * sizes the bar, an optional `label` annotates it, and `fillColor`/`trackColor`
 * are explicit-slot escape hatches ({@link MeterOptions}). Use it to show one
 * reading; reach for `<SegmentedMeter>` to split a total into parts.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Meter, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const uptime = East.function([], UIComponentType, _$ => (
 *     <Meter value={85.0} tone="success" label={<Text>Uptime</Text>} />
 * ));
 * ```
 *
 * @remarks
 * Carries `Meter.Types` — the East data type and the style struct. Desugars to
 * `Meter.Root(value, options)`.
 */
export const Meter: JsxTag<ValueProps<typeof MeterFactory.Root, "value">> & { Types: typeof MeterFactory.Types } =
    Object.assign(leaf(MeterFactory.Root, "value"), { Types: MeterFactory.Types });
