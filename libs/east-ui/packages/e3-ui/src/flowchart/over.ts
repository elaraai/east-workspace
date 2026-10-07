/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Flowchart.over(states, { … })` (#1244, `Flowchart Builder Spec.md` §3.4,
 * §4.3): one flow built from an app's own tables — its states, its
 * transitions, its lanes and its decisions — through the row mappers the
 * flowchart took its tables with before it held flows. A flow computed from
 * the app's data — transitions mined from scans, narrowed by a slice — is
 * shown this way, as `<Flowchart data={Flowchart.over(…)}>`, as `Plan.over`
 * lays rows out over a dataset.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    DateTimeType,
    East,
    Expr,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    variant,
    type ExprType,
    type FloatType,
    type SubtypeExprOrValue,
    type TypeOf,
} from "@elaraai/east";
import { mapRows } from "@elaraai/east-ui/internal";
import {
    FlowchartEvidenceType,
    FlowchartFlowType,
    FlowchartLaneType,
    FlowchartLinkKindType,
    FlowchartLinkType,
    FlowchartStateType,
    FlowchartTriggerType,
} from "./types.js";
import type { FlowchartLinkKindLiteral } from "./values.js";

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

// ============================================================================
// Row fields
// ============================================================================

/**
 * Fields the `state` mapper returns — one state node, before defaults.
 */
export interface FlowchartStateFields {
    /** Short mono code — the node identity ("IND"). */
    key: SubtypeExprOrValue<StringType>;
    /** Optional display label under the code. */
    label?: SubtypeExprOrValue<StringType>;
    /** The lane (ordered phase) this state belongs to. */
    lane: SubtypeExprOrValue<StringType>;
    /** Optional state-class member count → the ×N badge (an Option so per-row absence is expressible). */
    members?: SubtypeExprOrValue<OptionType<IntegerType>>;
    /** Optional free-text notes surfaced on hover / inspector. */
    notes?: SubtypeExprOrValue<StringType>;
}

/**
 * Evidence fields the `link` mapper may return — all optional, per-row
 * absence via each field's Option.
 */
export interface FlowchartEvidenceFields {
    /** Total measured volume behind the arrow (drives stroke weight + badge). */
    volume?: SubtypeExprOrValue<OptionType<FloatType>>;
    /** Event count behind the arrow (e.g. cage moves). */
    count?: SubtypeExprOrValue<OptionType<IntegerType>>;
    /** When the evidence was measured. */
    measuredAt?: SubtypeExprOrValue<OptionType<DateTimeType>>;
    /** Volume unit suffix for badges ("parcels"). */
    unit?: SubtypeExprOrValue<StringType>;
}

/**
 * Fields the `link` mapper returns — one transition, before defaults.
 */
export interface FlowchartLinkFields {
    /** Optional stable identity (selection / delete events); default derived from endpoints. */
    key?: SubtypeExprOrValue<StringType>;
    /** Source state key. */
    from: SubtypeExprOrValue<StringType>;
    /** Target state key. */
    to: SubtypeExprOrValue<StringType>;
    /** Optional kind — "planned" (default, solid) | "observed" (dashed). */
    kind?: SubtypeExprOrValue<FlowchartLinkKindType> | FlowchartLinkKindLiteral;
    /** Optional decision trigger key (0..1 per link) → the lettered diamond. */
    trigger?: SubtypeExprOrValue<OptionType<StringType>>;
    /** Optional imported evidence (weight, badges, provenance). */
    evidence?: FlowchartEvidenceFields;
}

/**
 * Fields the `lane` mapper returns — one ordered phase band.
 */
export interface FlowchartLaneFields {
    /** Lane identity referenced by states. */
    key: SubtypeExprOrValue<StringType>;
    /** Optional band header label (defaults to the key, uppercased). */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * Fields the `trigger` mapper returns — one decision trigger.
 */
export interface FlowchartTriggerFields {
    /** Trigger identity referenced by links. */
    key: SubtypeExprOrValue<StringType>;
    /** Decision name ("route"). */
    label: SubtypeExprOrValue<StringType>;
    /** Optional diamond letter (default: first letter of the label). */
    letter?: SubtypeExprOrValue<StringType>;
    /** Optional owning role / system ("sort-planner"). */
    owner?: SubtypeExprOrValue<StringType>;
    /** Optional state keys queued at the decision. */
    queue?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Optional outcome summary line ("CH* (×14 chutes)"). */
    outcomes?: SubtypeExprOrValue<StringType>;
}

/**
 * A literal lanes input — plain `{ key, label? }` entries in band order.
 */
export type FlowchartLaneLiteral = { key: string; label?: string };

/**
 * The tables beside the states `Flowchart.over` builds a flow from, and the
 * row mappers that read them.
 *
 * @typeParam S - The states-table row struct
 * @typeParam L - The links-table row struct
 * @typeParam N - The lanes-table row struct
 * @typeParam T - The triggers-table row struct
 */
export interface FlowchartTables<
    S extends StructType = StructType,
    L extends StructType = StructType,
    N extends StructType = StructType,
    T extends StructType = StructType,
> {
    /** Row mapper from a state row to node fields — omit when rows are already `Flowchart.Types.State`. */
    state?: (row: ExprType<S>) => FlowchartStateFields | ExprType<FlowchartStateType>;
    /** Row mapper from a link row to transition fields — omit when rows are already `Flowchart.Types.Link`. */
    link?: (row: ExprType<L>) => FlowchartLinkFields | ExprType<FlowchartLinkType>;
    /** Row mapper from a lane row to band fields — omit for literal `{ key, label? }` arrays or `Flowchart.Types.Lane` rows. */
    lane?: (row: ExprType<N>) => FlowchartLaneFields | ExprType<FlowchartLaneType>;
    /** Optional decision-trigger rows; links reference them by key. */
    triggers?: SubtypeExprOrValue<ArrayType<StructType>>;
    /** Row mapper from a trigger row — omit when rows are already `Flowchart.Types.Trigger`. */
    trigger?: (row: ExprType<T>) => FlowchartTriggerFields | ExprType<FlowchartTriggerType>;
}

// ============================================================================
// Flowchart.over
// ============================================================================

/** Resolves a kind literal / value into the option envelope. */
function kindOption(
    kind: SubtypeExprOrValue<FlowchartLinkKindType> | FlowchartLinkKindLiteral | undefined,
): ExprType<OptionType<FlowchartLinkKindType>> {
    if (kind === undefined) return East.value(none, OptionType(FlowchartLinkKindType));
    if (typeof kind === "string") return East.value(some(variant(kind, null)), OptionType(FlowchartLinkKindType));
    return East.value(some(kind), OptionType(FlowchartLinkKindType));
}

/**
 * Builds one flow from an app's own tables — its states, its transitions, its
 * lanes and, optionally, its decisions — each read through its row mapper, or
 * taken as it is when its rows are already the flowchart's own type.
 *
 * @remarks
 * The flow has no `description`. Show it with
 * `<Flowchart data={Flowchart.over(…)}>`, read only, or with the host's
 * `onApply`; narrow it with a slice by feeding the transitions through
 * `Slice.rows`, and give the flowchart that `slice`.
 *
 * @typeParam S - The states-table input
 * @typeParam L - The links-table input
 * @typeParam N - The lanes-table input
 * @typeParam T - The triggers-table input
 * @param states - The state rows
 * @param tables - The `links` and `lanes` tables (required), the `triggers`
 *   table, and each table's row mapper: `state`, `link`, `lane`, `trigger`
 *   ({@link FlowchartTables})
 * @returns An East expression of `Flowchart.Types.Flow`
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East, variant } from "@elaraai/east";
 * import { UIComponentType } from "@elaraai/east-ui";
 * import { Flowchart } from "@elaraai/e3-ui";
 *
 * const flowchart = East.function([], UIComponentType, ($) => {
 *     const states = $.const([
 *         { code: "ARV", name: "Arrived", phase: "intake" },
 *         { code: "SCN", name: "Scanned", phase: "intake" },
 *         { code: "SRT", name: "Sorting", phase: "sort" },
 *         { code: "SRD", name: "Sorted", phase: "sort" },
 *         { code: "LDD", name: "Loaded", phase: "dispatch" },
 *         { code: "DSP", name: "Dispatched", phase: "dispatch" },
 *     ]);
 *     const planned = variant("planned", null);
 *     const observed = variant("observed", null);
 *     const links = $.const([
 *         { src: "ARV", dst: "SCN", kind: planned },
 *         { src: "SCN", dst: "SRT", kind: planned },
 *         { src: "SRT", dst: "SRD", kind: planned },
 *         { src: "SRD", dst: "LDD", kind: planned },
 *         { src: "LDD", dst: "DSP", kind: observed },
 *     ]);
 *     return (
 *         <Flowchart
 *             data={Flowchart.over(states, {
 *                 state: s => ({ key: s.code, label: s.name, lane: s.phase }),
 *                 links, link: l => ({ from: l.src, to: l.dst, kind: l.kind }),
 *                 lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "dispatch", label: "Dispatch" }],
 *             })}
 *         />
 *     );
 * });
 * ```
 */
export function flowchartOver<
    S extends SubtypeExprOrValue<ArrayType<StructType>>,
    L extends SubtypeExprOrValue<ArrayType<StructType>>,
    N extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    T extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    states: S,
    tables: FlowchartTables<RowElement<S>, RowElement<L>, RowElement<N>, RowElement<T>>
        & { links: L; lanes: N | readonly FlowchartLaneLiteral[]; triggers?: T },
): ExprType<FlowchartFlowType> {
    const config = tables as unknown as FlowchartTables & {
        links: SubtypeExprOrValue<ArrayType<StructType>>;
        lanes: SubtypeExprOrValue<ArrayType<StructType>> | readonly FlowchartLaneLiteral[];
    };
    const stateMapper = config.state;
    const resolvedStates = stateMapper === undefined
        ? East.value(states as SubtypeExprOrValue<ArrayType<FlowchartStateType>>, ArrayType(FlowchartStateType))
        : mapRows(East.value(states) as ExprType<ArrayType<StructType>>, FlowchartStateType, (row) => {
            const r = stateMapper(row);
            if (r instanceof Expr) return East.value(r, FlowchartStateType);
            return East.value({
                key: r.key,
                label: r.label !== undefined ? some(r.label) : none,
                lane: r.lane,
                members: r.members !== undefined ? r.members : none,
                notes: r.notes !== undefined ? some(r.notes) : none,
            }, FlowchartStateType);
        });

    const linkMapper = config.link;
    const resolvedLinks = linkMapper === undefined
        ? East.value(config.links as SubtypeExprOrValue<ArrayType<FlowchartLinkType>>, ArrayType(FlowchartLinkType))
        : mapRows(East.value(config.links) as ExprType<ArrayType<StructType>>, FlowchartLinkType, (row) => {
            const r = linkMapper(row);
            if (r instanceof Expr) return East.value(r, FlowchartLinkType);
            return East.value({
                key: r.key !== undefined ? some(r.key) : none,
                from: r.from,
                to: r.to,
                kind: kindOption(r.kind),
                trigger: r.trigger !== undefined ? r.trigger : none,
                evidence: r.evidence !== undefined
                    ? some(East.value({
                        volume: r.evidence.volume !== undefined ? r.evidence.volume : none,
                        count: r.evidence.count !== undefined ? r.evidence.count : none,
                        measuredAt: r.evidence.measuredAt !== undefined ? r.evidence.measuredAt : none,
                        unit: r.evidence.unit !== undefined ? some(r.evidence.unit) : none,
                    }, FlowchartEvidenceType))
                    : none,
            }, FlowchartLinkType);
        });

    const laneMapper = config.lane;
    const lanes = config.lanes;
    const resolvedLanes = laneMapper !== undefined
        ? mapRows(East.value(lanes as SubtypeExprOrValue<ArrayType<StructType>>) as ExprType<ArrayType<StructType>>, FlowchartLaneType, (row) => {
            const r = laneMapper(row);
            if (r instanceof Expr) return East.value(r, FlowchartLaneType);
            return East.value({
                key: r.key,
                label: r.label !== undefined ? some(r.label) : none,
            }, FlowchartLaneType);
        })
        : Array.isArray(lanes)
            ? East.value(
                (lanes as unknown as readonly FlowchartLaneLiteral[]).map(l => ({
                    key: l.key,
                    label: l.label !== undefined ? some(l.label) : none,
                })),
                ArrayType(FlowchartLaneType))
            : East.value(lanes as SubtypeExprOrValue<ArrayType<FlowchartLaneType>>, ArrayType(FlowchartLaneType));

    const triggerMapper = config.trigger;
    const resolvedTriggers = config.triggers === undefined
        ? East.value([], ArrayType(FlowchartTriggerType))
        : triggerMapper === undefined
            ? East.value(config.triggers as SubtypeExprOrValue<ArrayType<FlowchartTriggerType>>, ArrayType(FlowchartTriggerType))
            : mapRows(East.value(config.triggers) as ExprType<ArrayType<StructType>>, FlowchartTriggerType, (row) => {
                const r = triggerMapper(row);
                if (r instanceof Expr) return East.value(r, FlowchartTriggerType);
                return East.value({
                    key: r.key,
                    label: r.label,
                    letter: r.letter !== undefined ? some(r.letter) : none,
                    owner: r.owner !== undefined ? some(r.owner) : none,
                    queue: r.queue !== undefined ? some(East.value(r.queue, ArrayType(StringType))) : none,
                    outcomes: r.outcomes !== undefined ? some(r.outcomes) : none,
                }, FlowchartTriggerType);
            });

    return East.value({
        description: none,
        lanes: resolvedLanes,
        states: resolvedStates,
        links: resolvedLinks,
        triggers: resolvedTriggers,
    }, FlowchartFlowType);
}
