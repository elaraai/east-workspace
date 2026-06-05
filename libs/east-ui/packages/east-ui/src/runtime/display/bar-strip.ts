/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<BarStrip>` tag — see the export's JSDoc.
 */

import { BarStrip as BarStripFactory, type BarStripOptions } from "../../display/bar-strip/index.js";
import { leaf, type JsxTag } from "../combinators.js";

/**
 * BarStrip — a compact stack of labelled horizontal bars for a small ranked
 * breakdown (top contributors, category totals) where the relative magnitudes
 * matter more than precise axes. The `items` prop is a config array of
 * `{ label, value, tone? }` rows; `sort` orders them, `maxItems` clips the tail,
 * `thickness` sizes the bars, and `showValues` prints each magnitude
 * ({@link BarStripOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { BarStrip, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const breakdown = East.function([], UIComponentType, _$ => (
 *     <BarStrip
 *         items={[
 *             { label: <Text>Backend</Text>, value: 120.0, tone: "info" },
 *             { label: <Text>Frontend</Text>, value: 85.0, tone: "info" },
 *             { label: <Text>DevOps</Text>, value: 42.0, tone: "info" },
 *         ]}
 *         sort="desc"
 *         showValues={true}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `BarStrip.Types` — the East data type, the per-row item struct, and
 * the style struct. Desugars to `BarStrip.Root(items, options)`.
 */
export const BarStrip: JsxTag<BarStripOptions & { items: Parameters<typeof BarStripFactory.Root>[0] }> & { Types: typeof BarStripFactory.Types } =
    Object.assign(leaf(BarStripFactory.Root, "items"), { Types: BarStripFactory.Types });
