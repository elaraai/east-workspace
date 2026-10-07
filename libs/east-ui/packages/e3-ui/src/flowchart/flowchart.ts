/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Flowchart>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import type { UIComponentType } from "@elaraai/east-ui";
import {
    createFlowchartRoot,
    type FlowchartConfig,
    type FlowchartLaneLiteral,
    type RowElement,
} from "./root.js";

/**
 * `<Flowchart>` — a self-contained state-transition flowchart (see the
 * namespace's docs on `Flowchart`): states as nodes in ordered phase lanes,
 * H/V-routed transition arrows, optional per-link decision triggers
 * (lettered diamonds) and evidence-weighted strokes — all from flat data
 * tables. Hover cards, the selection inspector and the pointer-highlight
 * grammar are built-in surfaces derived from core + declared fields; view
 * lenses are saved slice cohorts, never props.
 *
 * @remarks
 * Interaction is opt-in per channel: selection (`onSelectState`,
 * `onSelectLink`, `onSelectTrigger`), path tracing (`onTracePath`),
 * link authoring (`linkMode`, `onCreateLink`, `onDeleteLink`,
 * `canConnect`) and the bound slice (`slice`, `affordances`). With no
 * callbacks bound it is a read-only picture. Desugars to
 * `Flowchart.Root(states, config)` (`@elaraai/e3-ui/internal`), which
 * returns the flowchart's root through the `Flowchart` carrier.
 *
 * @typeParam S - The states-table input
 * @typeParam L - The links-table input
 * @typeParam N - The lanes-table input
 * @typeParam T - The triggers-table input
 * @param props - The `states`, `links` and `lanes` tables (required), the
 *   `triggers` table, and the rest of the configuration ({@link FlowchartConfig})
 * @returns The flowchart — the `Flowchart` carrier over its root
 */
export function FlowchartTag<
    S extends SubtypeExprOrValue<ArrayType<StructType>>,
    L extends SubtypeExprOrValue<ArrayType<StructType>>,
    N extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    T extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    props: { states: S } & FlowchartConfig<RowElement<S>, RowElement<L>, RowElement<N>, RowElement<T>>
        & { links: L; lanes: N | readonly FlowchartLaneLiteral[]; triggers?: T },
): ExprType<UIComponentType> {
    const { states, ...config } = props;
    return createFlowchartRoot(states, config as never);
}

/** The type of `<Flowchart>` as a tag. */
export type FlowchartTagType = typeof FlowchartTag;
