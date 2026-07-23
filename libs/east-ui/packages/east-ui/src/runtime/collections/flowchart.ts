/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Flowchart>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Flowchart as FlowchartFactory,
    type FlowchartConfig,
    type FlowchartLaneLiteral,
    type RowElement,
} from "../../collections/flowchart/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<Flowchart>` — a self-contained state-transition flowchart: states as
 * nodes in ordered phase lanes, H/V-routed transition arrows, optional
 * per-link decision triggers (lettered diamonds) and evidence-weighted
 * strokes — all from flat data tables. Hover cards, the selection
 * inspector and the pointer-highlight grammar are built-in surfaces
 * derived from core + declared fields; view lenses are saved slice
 * cohorts, never props.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Flowchart, UIComponentType } from "@elaraai/east-ui";
 *
 * const flow = East.function([], UIComponentType, _$ => (
 *     <Flowchart
 *         states={[
 *             { code: "RMI", name: "Raw intake", phase: "prep" },
 *             { code: "CUT", name: "Cut blanks", phase: "prep" },
 *             { code: "ASM", name: "Assembled", phase: "build" },
 *         ]}
 *         state={s => ({ key: s.code, label: s.name, lane: s.phase })}
 *         links={[{ src: "RMI", dst: "CUT" }, { src: "CUT", dst: "ASM" }]}
 *         link={l => ({ from: l.src, to: l.dst })}
 *         lanes={[{ key: "prep", label: "Prep" }, { key: "build", label: "Build" }]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Interaction is opt-in per channel: selection (`onSelectState`,
 * `onSelectLink`, `onSelectTrigger`), path tracing (`onTracePath`),
 * link authoring (`linkMode`, `onCreateLink`, `onDeleteLink`,
 * `canConnect`) and the bound slice (`slice`, `affordances`). With no
 * callbacks bound it is a read-only picture. Desugars to
 * `Flowchart.Root(states, config)`.
 */
function FlowchartTag<
    S extends SubtypeExprOrValue<ArrayType<StructType>>,
    L extends SubtypeExprOrValue<ArrayType<StructType>>,
    N extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    T extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    props: { states: S } & FlowchartConfig<RowElement<S>, RowElement<L>, RowElement<N>, RowElement<T>>
        & { links: L; lanes: N | readonly FlowchartLaneLiteral[]; triggers?: T },
): ExprType<UIComponentType> {
    const { states, ...config } = props;
    return FlowchartFactory.Root(states, config as never);
}

export const Flowchart: typeof FlowchartTag & {
    Types: typeof FlowchartFactory.Types;
} = Object.assign(FlowchartTag, {
    Types: FlowchartFactory.Types,
});
