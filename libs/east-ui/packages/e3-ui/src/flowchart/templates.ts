/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Flowchart.templates(rows, spec)` (#1501, `Flowchart Records Spec.md` R14,
 * D8): the cards a kind's library tab lists. Cards are records (#1340,
 * ruling 9), as the Schematic's are: the rows are a record of the app's, read
 * whole through `Data.bind(record).read()`, and each card is one of its rows,
 * its key the record's key. A list names its source of the Flowchart's
 * `Slice.bindRecords`, whose shown keys narrow its cards.
 *
 * - A state's card gives every field of the row but its lane and its order:
 *   dropped on a lane, it adds a state there.
 * - A transition's gives every field but its ends: dropped on a transition,
 *   it gives it its values, its ends kept.
 * - A lane's gives every field but its order: dropped between two lanes, or at
 *   the band row's tail, it adds a lane there.
 *
 * Each accessor is reified once and called per row.
 *
 * @packageDocumentation
 */

import {
    ArrayType, East, Expr, OptionType, StringType, isTypeEqual, none, printType,
    type DictType, type EastType, type ExprType, type FunctionType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { FlowchartTemplateType } from "./types.js";

/** Identifies a list of cards read from a record. */
export const FLOWCHART_TEMPLATES: unique symbol = Symbol("Flowchart.templates");

/**
 * A kind's cards, read from a record (see the module docs).
 *
 * @typeParam V - The values' type: the row's fields less what a drop writes
 */
export interface FlowchartTemplates<V extends StructType> {
    /** Identifies the declaration. */
    readonly [FLOWCHART_TEMPLATES]: true;
    /** The type of each card's values. */
    readonly valuesType: V;
    /** The cards, each its values encoded at their own type. */
    readonly items: ExprType<ArrayType<FlowchartTemplateType>>;
    /** The Flowchart's `Slice.bindRecords` source over the cards' record, whose shown keys narrow them. */
    readonly source: string | undefined;
}

/**
 * How each row of a cards record shows, and what it makes.
 *
 * @typeParam C - The cards record's row type
 * @typeParam V - The values' type
 */
export interface FlowchartTemplatesSpec<C extends EastType, V extends StructType> {
    /** The card's name. */
    name: (row: ExprType<C>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** The tab's group it sits under. */
    group?: (row: ExprType<C>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /**
     * Every field of the row the card makes but what a drop writes: a state's every field but its lane and its order,
     * a transition's every field but its ends, a lane's every field but its order.
     */
    values: (row: ExprType<C>, key: ExprType<StringType>) => ExprType<V>;
    /**
     * The Flowchart's `Slice.bindRecords` source over the cards' record (`stepCards`): its shown keys narrow the cards,
     * each card's key its record's key. A list naming no source of the slice is refused, naming the change.
     */
    source: string;
}

/**
 * Declares a kind's cards over a record's rows (see the module docs).
 *
 * @typeParam C - The cards record's row type
 * @typeParam V - The values' struct type
 * @param rows - The cards, keyed by String: a record's rows, `Data.bind(record).read()`
 * @param spec - Each card's name and group, its values, and its source of the slice
 * @returns The cards, which a kind's `templates` takes
 * @throws {Error} When the rows are not a Dict keyed by String, or `values` returns no struct
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Box, Fields, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Flowchart, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * // The depot's four records, and the records of the cards its library lists: each list of cards follows its own
 * // source of the rail, as the states and the transitions follow theirs.
 * export const DepotState = StructType({
 *     name: StringType,                         // what its card calls it
 *     phase: StringType,                        // the lane it stands in, by the lane's key
 *     seq: FloatType,                           // its place in its lane
 *     slots: OptionType(IntegerType),           // a class of interchangeable states: the ×N badge
 *     flow: StringType,                         // the flow it belongs to: one record holds the depot's flows
 * });
 * export const DepotTransition = StructType({
 *     src: StringType,                          // the state it leaves, by its key
 *     dst: StringType,                          // the state it enters
 *     kind: VariantType({ planned: NullType, observed: NullType }),
 *     trigger: OptionType(StringType),          // the decision that governs it, by its key
 *     volume: OptionType(FloatType),            // the parcels measured on it
 *     n: OptionType(IntegerType),               // the moves behind them
 *     at: OptionType(DateTimeType),             // when they were measured
 *     flow: StringType,
 * });
 * export const DepotLane = StructType({ label: StringType, seq: FloatType });
 * export const DepotDecision = StructType({ name: StringType, owner: StringType });
 * export const depotStates = e3.record("flowchart_depot_states", DictType(StringType, DepotState), {
 *     initial: new Map([
 *         ["ARV", { name: "Arrived", phase: "intake", seq: 1, slots: none, flow: "Parcels" }],
 *         ["SCN", { name: "Scanned", phase: "intake", seq: 2, slots: none, flow: "Parcels" }],
 *         ["IND", { name: "Inducted", phase: "induct", seq: 1, slots: none, flow: "Parcels" }],
 *         ["LBL", { name: "Relabelled", phase: "induct", seq: 2, slots: none, flow: "Parcels" }],
 *         ["CH*", { name: "Sort chutes (class)", phase: "sort", seq: 1, slots: some(14n), flow: "Parcels" }],
 *         ["SRD", { name: "Sorted", phase: "sort", seq: 2, slots: none, flow: "Parcels" }],
 *         ["HLD", { name: "Held", phase: "hold", seq: 1, slots: none, flow: "Parcels" }],
 *         ["CLR", { name: "Cleared", phase: "hold", seq: 2, slots: none, flow: "Parcels" }],
 *         ["LDD", { name: "Loaded", phase: "dispatch", seq: 1, slots: none, flow: "Parcels" }],
 *         ["DSP", { name: "Dispatched", phase: "dispatch", seq: 2, slots: none, flow: "Parcels" }],
 *         // The returns flow's states, beside the parcels'.
 *         ["RCV", { name: "Received", phase: "intake", seq: 3, slots: none, flow: "Returns" }],
 *         ["INS", { name: "Inspected", phase: "hold", seq: 3, slots: none, flow: "Returns" }],
 *         ["RSD", { name: "Resent", phase: "dispatch", seq: 3, slots: none, flow: "Returns" }],
 *     ]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 *     indexes: (index) => ({
 *         flowchart_states_by_flow: index.on(["flow"]),
 *         flowchart_states_by_lane: index.on(["flow", "phase"]),
 *     }),
 * });
 * export const depotTransitions = e3.record("flowchart_depot_transitions", DictType(StringType, DepotTransition), {
 *     initial: new Map([
 *         ["l1", { src: "ARV", dst: "SCN", kind: variant("planned", null), trigger: none, volume: some(18460), n: some(412n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l2", { src: "SCN", dst: "IND", kind: variant("planned", null), trigger: none, volume: some(18390), n: some(409n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         // In place: parcels inducted again, counted but not weighed.
 *         ["l3", { src: "IND", dst: "IND", kind: variant("observed", null), trigger: none, volume: none, n: some(2n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l4", { src: "IND", dst: "CH*", kind: variant("planned", null), trigger: some("route"), volume: some(17350), n: some(386n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l5", { src: "CH*", dst: "SRD", kind: variant("planned", null), trigger: none, volume: some(18210), n: some(405n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l6", { src: "SRD", dst: "HLD", kind: variant("planned", null), trigger: none, volume: some(8420), n: some(188n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l7", { src: "HLD", dst: "CLR", kind: variant("planned", null), trigger: some("customs"), volume: some(8350), n: some(186n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l8", { src: "CLR", dst: "LDD", kind: variant("planned", null), trigger: none, volume: some(8240), n: some(183n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l9", { src: "LDD", dst: "DSP", kind: variant("planned", null), trigger: none, volume: some(17030), n: some(378n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         // Its far end names a state no row is keyed by: drawn as a ghost, and listed in Issues.
 *         ["l10", { src: "DSP", dst: "DLV", kind: variant("planned", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" }],
 *         // Observed, not planned: parcels relabelled before they are sorted.
 *         ["l11", { src: "IND", dst: "LBL", kind: variant("observed", null), trigger: none, volume: some(980), n: some(22n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l12", { src: "LBL", dst: "CH*", kind: variant("observed", null), trigger: none, volume: some(975), n: some(22n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l13", { src: "SRD", dst: "LDD", kind: variant("planned", null), trigger: none, volume: some(8790), n: some(195n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["r1", { src: "RCV", dst: "INS", kind: variant("planned", null), trigger: none, volume: some(640), n: some(15n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Returns" }],
 *         ["r2", { src: "INS", dst: "RSD", kind: variant("planned", null), trigger: none, volume: some(610), n: some(14n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Returns" }],
 *     ]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 *     indexes: (index) => ({
 *         flowchart_transitions_by_flow: index.on(["flow"]),
 *     }),
 * });
 * export const depotLanes = e3.record("flowchart_depot_lanes", DictType(StringType, DepotLane), {
 *     initial: new Map([
 *         ["intake", { label: "Intake", seq: 1 }], ["induct", { label: "Induct", seq: 2 }], ["sort", { label: "Sort", seq: 3 }],
 *         ["hold", { label: "Hold", seq: 4 }], ["dispatch", { label: "Dispatch", seq: 5 }],
 *     ]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 * });
 * export const depotDecisions = e3.record("flowchart_depot_decisions", DictType(StringType, DepotDecision), {
 *     initial: new Map([["route", { name: "route", owner: "sort-planner" }], ["customs", { name: "customs", owner: "customs-desk" }]]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 * });
 * export const StepCard = StructType({
 *     name: StringType,
 *     group: StringType,
 *     values: StructType({ name: StringType, slots: OptionType(IntegerType), flow: StringType }),
 * });
 * export const MoveCard = StructType({
 *     name: StringType,
 *     group: StringType,
 *     values: StructType({
 *         kind: VariantType({ planned: NullType, observed: NullType }), trigger: OptionType(StringType),
 *         volume: OptionType(FloatType), n: OptionType(IntegerType), at: OptionType(DateTimeType), flow: StringType,
 *     }),
 * });
 * export const stepCards = e3.record("flowchart_step_cards", DictType(StringType, StepCard), {
 *     initial: new Map([
 *         ["scan", { name: "Scan point", group: "Intake", values: { name: "Scan point", slots: none, flow: "Parcels" } }],
 *         ["chutes", { name: "Sort chutes", group: "Sort", values: { name: "Sort chutes", slots: some(12n), flow: "Parcels" } }],
 *         ["desk", { name: "Exception desk", group: "Hold", values: { name: "Exception desk", slots: none, flow: "Parcels" } }],
 *     ]),
 *     indexes: (index) => ({ flowchart_step_cards_by_group: index.on(["group"]) }),
 * });
 * export const moveCards = e3.record("flowchart_move_cards", DictType(StringType, MoveCard), {
 *     initial: new Map([
 *         ["planned", { name: "Planned", group: "Kinds",
 *             values: { kind: variant("planned", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" } }],
 *         ["reroute", { name: "Observed reroute", group: "Kinds",
 *             values: { kind: variant("observed", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" } }],
 *         ["routed", { name: "Routed by the sort plan", group: "Decisions",
 *             values: { kind: variant("planned", null), trigger: some("route"), volume: none, n: none, at: none, flow: "Parcels" } }],
 *     ]),
 *     indexes: (index) => ({ flowchart_move_cards_by_group: index.on(["group"]) }),
 * });
 * export const LaneCard = StructType({ name: StringType, group: StringType, values: StructType({ label: StringType }) });
 * export const laneCards = e3.record("flowchart_lane_cards", DictType(StringType, LaneCard), {
 *     initial: new Map([
 *         ["returns", { name: "Returns", group: "Lanes", values: { label: "Returns" } }],
 *         ["check", { name: "Quality check", group: "Lanes", values: { label: "Quality check" } }],
 *     ]),
 *     indexes: (index) => ({ flowchart_lane_cards_by_group: index.on(["group"]) }),
 * });
 * export const DecisionOwner = StructType({ name: StringType, desk: StringType });
 * export const decisionOwners = e3.input("flowchart_decision_owners", DictType(StringType, DecisionOwner), variant("value", new Map([
 *     ["sp", { name: "sort-planner", desk: "Sort office" }],
 *     ["cd", { name: "customs-desk", desk: "Customs" }],
 *     ["ns", { name: "night-supervisor", desk: "Night shift" }],
 * ])));
 *
 * const flowchartDepot = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         // The states and the transitions: editable through their patch doors, read through their sources of the rail.
 *         const states = $.let(Record.bind(depotStates));
 *         const stateEntries = $.let(Data.bindPaged(depotStates));
 *         const transitions = $.let(Record.bind(depotTransitions));
 *         const transitionEntries = $.let(Data.bindPaged(depotTransitions));
 *         // The lanes and the decisions: small records, read whole.
 *         const lanes = $.let(Record.bind(depotLanes));
 *         const decisions = $.let(Record.bind(depotDecisions));
 *         const steps = $.let(Data.bind(stepCards));
 *         const moves = $.let(Data.bind(moveCards));
 *         const laneRows = $.let(Data.bind(laneCards));
 *         const owners = $.let(Data.bind(decisionOwners));
 *         // One rail: the states and the transitions by their flow — the states by their lane too — and each list of
 *         // cards by its group. The flowchart opens on the parcels' flow; a preset picks a flow for both at once.
 *         const slice = $.let(Slice.bindRecords("flowchart.depot", {
 *             states: {
 *                 source: Data.bindPaged(depotStates, { indexes: ["flowchart_states_by_flow", "flowchart_states_by_lane"] }),
 *                 icon: { prefix: "fas", name: "circle-nodes" },
 *                 fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] }, phase: { label: "Lane" } },
 *                 initial: { flow: ["Parcels"] },
 *             },
 *             transitions: {
 *                 source: Data.bindPaged(depotTransitions, { indexes: ["flowchart_transitions_by_flow"] }),
 *                 icon: { prefix: "fas", name: "arrow-right-long" },
 *                 fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] } },
 *                 initial: { flow: ["Parcels"] },
 *             },
 *             stepCards: { source: Data.bindPaged(stepCards, { indexes: ["flowchart_step_cards_by_group"] }), fields: { group: { label: "Group" } } },
 *             moveCards: { source: Data.bindPaged(moveCards, { indexes: ["flowchart_move_cards_by_group"] }), fields: { group: { label: "Group" } } },
 *             laneCards: { source: Data.bindPaged(laneCards, { indexes: ["flowchart_lane_cards_by_group"] }), fields: { group: { label: "Group" } } },
 *         }, { presets: [
 *             { id: "parcels", name: "Parcels", where: { states: { flow: ["Parcels"] }, transitions: { flow: ["Parcels"] } } },
 *             { id: "returns", name: "Returns", where: { states: { flow: ["Returns"] }, transitions: { flow: ["Returns"] } } },
 *         ] }));
 *         return (
 *             <Box height="640px">
 *                 <Flowchart
 *                     slice={{ slice }}
 *                     states={Flowchart.states(states, {
 *                         name: "State", icon: "circle-nodes", entries: stateEntries,
 *                         label: "name", lane: "phase", order: "seq",
 *                         members: (s) => s.slots,
 *                         // the Steps tab's cards: a card dropped on a lane adds a state there, from its values
 *                         templates: Flowchart.templates(steps.read(), {
 *                             name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards",
 *                         }),
 *                     })}
 *                     transitions={Flowchart.transitions(transitions, {
 *                         name: "Transition", icon: "arrow-right-long", entries: transitionEntries,
 *                         from: "src", to: "dst", decision: "trigger",
 *                         kind: (t) => t.kind,
 *                         evidence: (t) => some({ volume: t.volume, count: t.n, measuredAt: t.at, unit: some("parcels") }),
 *                         // Evidence shows them, so the form leaves them out.
 *                         fields: { volume: Fields.hidden(), n: Fields.hidden(), at: Fields.hidden() },
 *                         // the Transitions tab's cards: a card dropped on a transition gives it its values
 *                         templates: Flowchart.templates(moves.read(), {
 *                             name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "moveCards",
 *                         }),
 *                     })}
 *                     lanes={Flowchart.lanes(lanes, {
 *                         label: "label", order: "seq",
 *                         // the Lanes tab's cards: one dropped between two lanes adds a lane there, from its values
 *                         templates: Flowchart.templates(laneRows.read(), {
 *                             name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "laneCards",
 *                         }),
 *                     })}
 *                     decisions={Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) })}
 *                     library={[
 *                         Flowchart.library.states(),             // Steps: the states' cards, by group
 *                         Flowchart.library.transitions(),        // Transitions: the transitions' cards
 *                         Flowchart.library.lanes(),              // Lanes: the lanes' cards
 *                         Flowchart.library.tab(owners.read(), {
 *                             name: "Owners", icon: "user-tie", label: (o) => o.name, meta: (o) => some(o.desk),
 *                             // its patch is over a decision's row: dropped on a diamond, the card sets the decision's owner
 *                             drop: (o) => Flowchart.patch(DepotDecision, { owner: o.name }),
 *                         }),
 *                     ]}
 *                     freshness={{ label: "evidence-2026.06", date: new Date("2026-06-30T00:00:00Z") }}
 *                     name="depot"
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function flowchartTemplates<C extends EastType, V extends StructType>(
    rows: SubtypeExprOrValue<DictType<StringType, C>>, spec: FlowchartTemplatesSpec<C, V>,
): FlowchartTemplates<V> {
    const source = East.value(rows) as ExprType<DictType<StringType, C>>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict" || !isTypeEqual(type.key as EastType, StringType)) {
        throw new Error(`Flowchart.templates: the cards are a record's rows, keyed by String — a Dict, Data.bind(record).read() — and these are ${printType(type)}`);
    }
    const rowType = type.value as C;
    const values = East.function([rowType, StringType], undefined, (_$, row, key) => spec.values(row, key));
    const valuesType = (Expr.type(values as unknown as Expr) as FunctionType).output as V;
    if (valuesType.type !== "Struct") {
        throw new Error("Flowchart.templates: `values` returns a struct, every field of the row the card makes but what a drop writes");
    }
    const describe = East.function([rowType, StringType], FlowchartTemplateType, ($, row, key) => {
        const initial = $.const(values);
        return {
            key,
            name: spec.name(row, key),
            group: spec.group === undefined ? East.value(none, OptionType(StringType)) : spec.group(row, key),
            values: East.Blob.encodeBeast(initial(row as never, key) as ExprType<EastType>, "v2"),
        };
    });
    const items = source.toArray(($, row, key) => {
        const card = $.const(describe);
        return card(row as never, key);
    });
    return { [FLOWCHART_TEMPLATES]: true, valuesType, items, source: spec.source };
}

/**
 * Whether a kind's `templates` is a list of cards over a record.
 *
 * @param templates - What a kind was given
 * @returns Whether it is `Flowchart.templates`'
 */
export function isFlowchartTemplates(templates: unknown): templates is FlowchartTemplates<StructType> {
    return typeof templates === "object" && templates !== null && FLOWCHART_TEMPLATES in templates;
}

/**
 * Checks a kind's cards: `Flowchart.templates`', never a list written in the
 * code, their values of the type a drop of the kind takes.
 *
 * @param templates - What the kind was given
 * @param expected - The row's fields less what a drop writes
 * @param placed - The fields a drop writes, which the values leave out
 * @param where - The kind, as a refusal names it
 * @returns The cards on the wire, and the source they follow; `undefined` for a kind with no cards
 * @throws {Error} When they are not `Flowchart.templates`', or their values are of another type, naming both
 */
export function checkedFlowchartTemplates(templates: unknown, expected: StructType, placed: readonly string[], where: string):
    { readonly items: ExprType<ArrayType<FlowchartTemplateType>>; readonly source: string | undefined } | undefined {
    if (templates === undefined) return undefined;
    if (!isFlowchartTemplates(templates)) {
        throw new Error(`${where}: \`templates\` are records — Flowchart.templates(cards.read(), { name, values, source }) over a record of the app's, ` +
            "its source one of the slice's");
    }
    if (!isTypeEqual(templates.valuesType, expected)) {
        const named = placed.map((field) => `\`${field}\``);
        const but = named.length === 0 ? "" : ` but ${named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`}`;
        throw new Error(`${where}: its cards' \`values\` give every field of the row${but} — ${printType(expected)} — and these give ${printType(templates.valuesType)}`);
    }
    return { items: templates.items, source: templates.source };
}
