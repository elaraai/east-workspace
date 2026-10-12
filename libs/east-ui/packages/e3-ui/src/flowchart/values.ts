/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Flowchart.value` and `Flowchart.values` (#1244, `Flowchart Builder Spec.md`
 * §4.3, §4.4): the flows a solution ships, written as literals — flows by
 * name, a record's value, or one flow, the value of the host's dataset — each
 * filled where the literal leaves a field out and checked when the package
 * builds, as `Query.value` checks the saved queries a solution ships.
 *
 * @packageDocumentation
 */

import { SortedMap, StringType, compareFor, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { FlowchartFlowType, type FlowchartFlowsType } from "./types.js";

/** String shorthand for a transition's kind (`Flowchart.Types.Kind`): `"planned"` draws solid, `"observed"` dashed. */
export type FlowchartLinkKindLiteral = "planned" | "observed";

/**
 * One lane of a flow, as a literal writes it.
 *
 * @property key - Its identity, which states name
 * @property label - Its band's header; left out, the key, uppercased
 */
export interface FlowchartLaneInput {
    /** Its identity, which states name. */
    readonly key: string;
    /** Its band's header; left out, the key, uppercased. */
    readonly label?: string;
}

/**
 * One state of a flow, as a literal writes it.
 *
 * @property key - Its short code: its identity, which transitions and decisions name
 * @property label - The name under its code
 * @property lane - The lane it is in, which the flow must have
 * @property members - A state class's count of members: the ×N badge
 * @property notes - Notes shown on hover
 */
export interface FlowchartStateInput {
    /** Its short code: its identity, which transitions and decisions name. */
    readonly key: string;
    /** The name under its code. */
    readonly label?: string;
    /** The lane it is in, which the flow must have. */
    readonly lane: string;
    /** A state class's count of members: the ×N badge. */
    readonly members?: bigint;
    /** Notes shown on hover. */
    readonly notes?: string;
}

/**
 * The evidence behind a transition, as a literal writes it.
 *
 * @property volume - The volume measured across it: its stroke's weight and its badge
 * @property count - The events behind it
 * @property measuredAt - When it was measured
 * @property unit - The volume's unit, printed on its badge
 */
export interface FlowchartEvidenceInput {
    /** The volume measured across it: its stroke's weight and its badge. */
    readonly volume?: number;
    /** The events behind it. */
    readonly count?: bigint;
    /** When it was measured. */
    readonly measuredAt?: Date;
    /** The volume's unit, printed on its badge. */
    readonly unit?: string;
}

/**
 * One transition of a flow, as a literal writes it.
 *
 * @property key - Its identity; left out, the renderer derives one from its ends
 * @property from - The state it leaves
 * @property to - The state it enters; one the flow does not have draws as the unresolved ghost
 * @property kind - `"planned"` (solid, the default) or `"observed"` (dashed)
 * @property trigger - The decision that governs it, which the flow must have
 * @property evidence - The evidence behind it
 */
export interface FlowchartLinkInput {
    /** Its identity; left out, the renderer derives one from its ends. */
    readonly key?: string;
    /** The state it leaves. */
    readonly from: string;
    /** The state it enters; one the flow does not have draws as the unresolved ghost. */
    readonly to: string;
    /** `"planned"` (solid, the default) or `"observed"` (dashed). */
    readonly kind?: FlowchartLinkKindLiteral;
    /** The decision that governs it, which the flow must have. */
    readonly trigger?: string;
    /** The evidence behind it. */
    readonly evidence?: FlowchartEvidenceInput;
}

/**
 * One decision of a flow, as a literal writes it.
 *
 * @property key - Its identity, which transitions name
 * @property label - Its name
 * @property letter - Its diamond's letter; left out, its name's first
 * @property owner - Who decides it
 * @property queue - The states queued at it
 * @property outcomes - A line on what it decides
 */
export interface FlowchartTriggerInput {
    /** Its identity, which transitions name. */
    readonly key: string;
    /** Its name. */
    readonly label: string;
    /** Its diamond's letter; left out, its name's first. */
    readonly letter?: string;
    /** Who decides it. */
    readonly owner?: string;
    /** The states queued at it. */
    readonly queue?: readonly string[];
    /** A line on what it decides. */
    readonly outcomes?: string;
}

/**
 * One flow, as a literal writes it — what `Flowchart.value` takes, and each
 * flow `Flowchart.values` takes by name.
 *
 * @property description - One sentence about it: the line its card in the Flows tab shows
 * @property lanes - Its lanes, in band order
 * @property states - Its states
 * @property links - Its transitions
 * @property triggers - Its decisions; left out, none
 */
export interface FlowchartFlowInput {
    /** One sentence about it: the line its card in the Flows tab shows. */
    readonly description?: string;
    /** Its lanes, in band order. */
    readonly lanes: readonly FlowchartLaneInput[];
    /** Its states. */
    readonly states: readonly FlowchartStateInput[];
    /** Its transitions. */
    readonly links: readonly FlowchartLinkInput[];
    /** Its decisions; left out, none. */
    readonly triggers?: readonly FlowchartTriggerInput[];
}

/** One flow's value. */
type FlowValue = ValueTypeOf<typeof FlowchartFlowType>;

/** An optional literal field as an `Option`. */
function optional<T>(field: T | undefined): option<T> {
    return field === undefined ? none : some(field);
}

/** The keys a flow's rows of one kind carry, each once: the second of a key is refused, naming it. */
function keysOnce(keys: readonly string[], where: string, rows: string, row: string): Set<string> {
    const seen = new Set<string>();
    for (const key of keys) {
        if (seen.has(key)) {
            throw new Error(`${where}: two ${rows} are keyed "${key}" — a ${row}'s key is its identity in the flow, so give each ${row} its own`);
        }
        seen.add(key);
    }
    return seen;
}

/**
 * One flow's value from its literal: checked, and filled where the literal
 * leaves a field out.
 *
 * @param flow - The literal
 * @param where - Who is asking, and of which flow: what a refusal opens with
 * @returns The flow's value
 * @throws {Error} When two lanes, states, links or decisions of the flow share a key, a state names a lane the flow does not have, or a link names a decision it does not have
 */
function flowValue(flow: FlowchartFlowInput, where: string): FlowValue {
    const triggers = flow.triggers ?? [];
    const lanes = keysOnce(flow.lanes.map((l) => l.key), where, "lanes", "lane");
    keysOnce(flow.states.map((s) => s.key), where, "states", "state");
    keysOnce(flow.links.flatMap((l) => (l.key === undefined ? [] : [l.key])), where, "links", "link");
    const decisions = keysOnce(triggers.map((t) => t.key), where, "decisions", "decision");
    for (const state of flow.states) {
        if (!lanes.has(state.lane)) {
            throw new Error(`${where}: the state "${state.key}" names the lane "${state.lane}", which the flow has none of — add it to \`lanes\`, or name a lane the flow has`);
        }
    }
    // A link naming a state the flow does not have is kept: it draws as the
    // unresolved ghost, and the Issues tab lists it.
    for (const link of flow.links) {
        if (link.trigger !== undefined && !decisions.has(link.trigger)) {
            throw new Error(`${where}: the link "${link.from}" → "${link.to}" names the decision "${link.trigger}", which the flow has none of — add it to \`triggers\`, or leave the link's \`trigger\` out`);
        }
    }
    return {
        description: optional(flow.description),
        lanes: flow.lanes.map((l) => ({ key: l.key, label: optional(l.label) })),
        states: flow.states.map((s) => ({
            key: s.key, label: optional(s.label), lane: s.lane, members: optional(s.members), notes: optional(s.notes),
        })),
        links: flow.links.map((l) => ({
            key: optional(l.key),
            from: l.from,
            to: l.to,
            kind: l.kind === undefined ? none : some(variant(l.kind, null)),
            trigger: optional(l.trigger),
            evidence: l.evidence === undefined ? none : some({
                volume: optional(l.evidence.volume),
                count: optional(l.evidence.count),
                measuredAt: optional(l.evidence.measuredAt),
                unit: optional(l.evidence.unit),
            }),
        })),
        triggers: triggers.map((t) => ({
            key: t.key, label: t.label, letter: optional(t.letter), owner: optional(t.owner),
            queue: t.queue === undefined ? none : some([...t.queue]), outcomes: optional(t.outcomes),
        })),
    };
}

/**
 * One flow's value — what an app with a single flow declares its input of one
 * flow with, which it hands the flowchart as `data` — written as a literal and
 * checked when the package builds. A record always holds flows by name, so a
 * lone flow in a record is `Flowchart.values` with one entry.
 *
 * @remarks
 * - **Filled**: a literal leaves out what it does not need — the flow's
 *   `description`, a state's `label`, `members` and `notes`, a link's `key`,
 *   `kind`, `trigger` and `evidence`, a lane's `label`, a decision's `letter`,
 *   `owner`, `queue` and `outcomes`, and `triggers` — and each is `none`, or
 *   empty.
 * - **Checked**: a flow whose rows would not draw or commit fails the build —
 *   two lanes, states, links or decisions of one key, a state naming a lane
 *   the flow does not have, a link naming a decision it does not have. A link
 *   naming a state the flow does not have is kept: it draws as the unresolved
 *   ghost.
 *
 * @param flow - The flow, as a literal ({@link FlowchartFlowInput})
 * @returns The flow: a value of `Flowchart.Types.Flow`
 * @throws {Error} When two lanes, states, links or decisions share a key, a
 *   state names a lane the flow does not have, or a link names a decision it
 *   does not have — naming the row and the remedy
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East, variant } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Flowchart } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const handoverFlow = e3.input("flowchart_handover", Flowchart.Types.Flow, variant("value", Flowchart.value({
 *     description: "From the last scan to the driver's signature",
 *     lanes: [{ key: "load", label: "Load" }, { key: "road", label: "Road" }, { key: "door", label: "Door" }],
 *     states: [
 *         { key: "LDD", label: "Loaded", lane: "load" },
 *         { key: "DSP", label: "Dispatched", lane: "road" },
 *         { key: "DLV", label: "Delivered", lane: "door" },
 *         { key: "RTN", label: "Returned", lane: "door" },
 *     ],
 *     links: [
 *         { from: "LDD", to: "DSP" },
 *         { from: "DSP", to: "DLV", trigger: "attempt" },
 *         { from: "DSP", to: "RTN", kind: "observed", trigger: "attempt" },
 *     ],
 *     triggers: [{ key: "attempt", label: "attempt", owner: "driver" }],
 * })));
 *
 * const flowchart = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const handover = $.let(Data.bind(handoverFlow));
 *         return (
 *             <Box height="500px">
 *                 <Flowchart data={handover} orientation="TD" inspector={false} name="handover" />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function flowchartValue(flow: FlowchartFlowInput): FlowValue {
    return flowValue(flow, "Flowchart.value");
}

/**
 * A record of flows' value, by name — what an app declares its record of
 * flows with — each flow written as a literal and checked when the package
 * builds, as `Flowchart.value` checks one: a record's value, as `Query.value`
 * is one.
 *
 * @param flows - The flows, each its name to its literal ({@link FlowchartFlowInput})
 * @returns The flows by name: a value of the record's type, `Flowchart.Types.Flows`
 * @throws {Error} When a flow does not check, naming the flow, the row and the
 *   remedy, as `Flowchart.value` does
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Flowchart, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const depotFlows = e3.record("flowchart_depot_flows", Flowchart.Types.Flows, Flowchart.values({
 *     "Inbound parcels": {
 *         description: "From the trailer to the van",
 *         lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "load", label: "Load" }],
 *         states: [
 *             { key: "ARV", label: "Arrived", lane: "intake" },
 *             { key: "SCN", label: "Scanned", lane: "intake" },
 *             { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n },
 *             { key: "LDD", label: "Loaded", lane: "load" },
 *         ],
 *         links: [
 *             { from: "ARV", to: "SCN" },
 *             { from: "SCN", to: "CH*", trigger: "route" },
 *             { from: "CH*", to: "LDD" },
 *             { from: "SCN", to: "SCN", kind: "observed" },
 *         ],
 *         triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
 *     },
 *     "Returns": {
 *         description: "From the counter back to the sender",
 *         lanes: [{ key: "counter", label: "Counter" }, { key: "check", label: "Check" }, { key: "out", label: "Out" }],
 *         states: [
 *             { key: "RCV", label: "Received", lane: "counter" },
 *             { key: "INS", label: "Inspected", lane: "check" },
 *             { key: "RSD", label: "Resent", lane: "out" },
 *         ],
 *         links: [{ from: "RCV", to: "INS" }, { from: "INS", to: "RSD" }, { from: "INS", to: "BIN", kind: "observed" }],
 *     },
 * }));
 * export const depotFlowsPatch = e3.mutation.patch(depotFlows);
 *
 * const flowchart = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
 *         return (
 *             <Box height="500px">
 *                 <Flowchart record={flows} flow="Inbound parcels" library={[Flowchart.library.flows()]} />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function flowchartValues(flows: Readonly<Record<string, FlowchartFlowInput>>): ValueTypeOf<FlowchartFlowsType> {
    const byName = new SortedMap<string, FlowValue>([], compareFor(StringType));
    for (const [name, flow] of Object.entries(flows)) {
        byName.set(name, flowValue(flow, `Flowchart.values: "${name}"`));
    }
    return byName;
}
