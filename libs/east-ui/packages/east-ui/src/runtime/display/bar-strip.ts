/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<BarStrip>` tag — see the export's JSDoc.
 */

import { type ArrayType, type StructType, type SubtypeExprOrValue } from "@elaraai/east";
import {
    BarStrip as BarStripFactory,
    type BarStripDataOptions,
    type BarStripItem,
    type BarStripOptions,
    type RowElement,
} from "../../display/bar-strip/index.js";
import { hasKeys } from "../combinators.js";
import type { UIElement } from "./../runtime.js";

/**
 * BarStrip — a compact stack of labelled horizontal bars for a small ranked
 * breakdown (top contributors, category totals) where the relative magnitudes
 * matter more than precise axes. The bars are written as `items`, a config
 * array of `{ label, value, tone? }` rows — or mapped from data: `data`, an
 * East array of the host's rows, and `item`, which maps one row to a bar.
 * `sort` orders them, `maxItems` clips the tail, `thickness` sizes the bars,
 * and `showValues` prints each magnitude ({@link BarStripOptions}).
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
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, East, FloatType, StringType, StructType } from "@elaraai/east";
 * import { BarStrip, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * // Each region's revenue, summed from the sales rows: one bar a region.
 * const byRegion = East.function([], UIComponentType, $ => {
 *     const sales = $.const([
 *         { region: "North", revenue: 12.0 },
 *         { region: "South", revenue: 8.0 },
 *         { region: "North", revenue: 30.0 },
 *     ], ArrayType(StructType({ region: StringType, revenue: FloatType })));
 *     const regions = $.let(sales
 *         .groupSum(($, r) => r.region, ($, r) => r.revenue)
 *         .toArray(($, revenue, region) => ({ region, revenue })));
 *     return <BarStrip data={regions} item={r => ({ label: <Text>{r.region}</Text>, value: r.revenue, tone: "info" })} sort="desc" />;
 * });
 * ```
 *
 * @remarks
 * Carries `BarStrip.Types` — the East data type, the per-row item struct, and
 * the style struct. Desugars to `BarStrip.Root(items, options)`, or
 * `BarStrip.Root(data, { item, ...options })`.
 */
function BarStripTag(props: BarStripOptions & { items: BarStripItem[] }): UIElement;
function BarStripTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: BarStripDataOptions<RowElement<T>> & { data: T },
): UIElement;
function BarStripTag(
    props: (BarStripOptions & { items: BarStripItem[] }) | (BarStripDataOptions<never> & { data: SubtypeExprOrValue<ArrayType<StructType>> }),
): UIElement {
    if ("data" in props) {
        const { data, ...options } = props;
        return BarStripFactory.Root(data, options as unknown as BarStripDataOptions<StructType>);
    }
    const { items, ...options } = props;
    return BarStripFactory.Root(items, hasKeys(options) ? options : undefined);
}

export const BarStrip: typeof BarStripTag & { Types: typeof BarStripFactory.Types } =
    Object.assign(BarStripTag, { Types: BarStripFactory.Types });
