/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Blend>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Blend as BlendFactory,
    type BlendConfig,
    type RowElement,
} from "../../collections/blend/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<Blend>` — the assembly surface for blending / batching decisions: pull
 * amounts from many sources into one or more targets. Pairs with a
 * `<Library>`; one pattern, three render modes by target count — `single`
 * focus, `compare` with the derived diff table, `portfolio` horizontal
 * scroll. Declares the drag & drop **target** role (`add` from declared
 * Libraries, `remove` back — no intra-surface move). Renders bare; identity
 * chrome is host composition.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Blend, UIComponentType } from "@elaraai/east-ui";
 *
 * const bench = East.function([], UIComponentType, _$ => (
 *     <Blend
 *         id="bench"
 *         sources={["materials"]}
 *         targets={[{ key: "BLEND-318", name: "Blend 318", cap: 40000.0, cost: 3.42 }]}
 *         target={t => ({
 *             key: t.key, label: t.name, capacity: t.cap,
 *             objective: "min cost · Grade ≥ A · respect pins",
 *             allocations: [
 *                 Blend.allocation({ source: "LOT-204", amount: 16000.0 }),
 *                 Blend.allocation({ source: "LOT-219", amount: 10000.0, pinned: true }),
 *             ],
 *             metrics: [
 *                 Blend.metric({ key: "cost", label: "cost / unit", value: East.str`$${East.print(t.cost)}`, numeric: t.cost, model: "cost-v1.4" }),
 *             ],
 *         })}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Allocation states are typed `PlannerStateType` values
 * (`Blend.Types.State`); amounts edit in place while proposed. Desugars to
 * `Blend.Root(targets, config)`.
 */
function BlendTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { targets: T } & BlendConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    const { targets, ...config } = props;
    return BlendFactory.Root(targets, config as BlendConfig<RowElement<T>>);
}

export const Blend: typeof BlendTag & {
    allocation: typeof BlendFactory.allocation;
    metric: typeof BlendFactory.metric;
    Types: typeof BlendFactory.Types;
} = Object.assign(BlendTag, {
    allocation: BlendFactory.allocation,
    metric: BlendFactory.metric,
    Types: BlendFactory.Types,
});
