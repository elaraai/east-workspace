/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's kinds, payload and tag (#1500, #1501, `Flowchart Records
 * Spec.md` §3, R1–R4, R14): one flowchart over the app's records — its
 * states, and beside them its transitions, lanes and decisions.
 *
 * - Each role's check (R2): a type error, and past a cast the kind's words.
 * - Each binding a kind's read doesn't take refused, naming the form to use
 *   (R3), and the rail's sources (R4).
 * - Every prop the flows took refused, naming what replaces it.
 * - The kinds' closed functions over decoded bytes: each kind built over a
 *   handle as `Record.bind` or `Data.bind` gives one, called, and its rows,
 *   roles and writes read back at the record's own row type.
 * - The payload through the carrier's bytes; the library's tabs on the wire;
 *   and nothing of the Flow types left in the package.
 * - The details (#1507, R18–R21): each read's check a type error, and past a
 *   cast — or where only the built value shows it — the tag's words; the
 *   binding a kind's read takes; and the reads and a row's values, decoded.
 *
 * e3-ui's specs read and write no e3: the examples build and compile here, and
 * the renderer's tests draw them on e3-web.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, BooleanType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, SetType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, printType, some, variant,
    type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Slice, UIComponentType } from "@elaraai/east-ui";
import { EditingReadinessType } from "@elaraai/east-ui/internal";
import { DatasetStatusType, RecordCommitInfoType } from "@elaraai/e3-types";
import * as E3UI from "@elaraai/e3-ui";
import {
    Data, DataBindHandleType, DataPagedHandleType, Flowchart as PublicFlowchart, Record, RecordBindHandleType, RecordErrorType, RecordMutateStatusType,
    RecordOutcomeType,
} from "@elaraai/e3-ui";
import * as E3UIInternal from "@elaraai/e3-ui/internal";
import { Flowchart, FlowchartLibraryTabType, FlowchartPayloadType, buildFlowchartLibrary, flowchartKeys } from "@elaraai/e3-ui/internal";
import * as ex from "./flowchart.examples.js";

describeEast("Flowchart", (test) => {
    Assert.examples(test, {
        flowchartDwell: ex.flowchartDwell,
        flowchartDepot: ex.flowchartDepot,
        flowchartDepotEditing: ex.flowchartDepotEditing,
        flowchartDepotDimmed: ex.flowchartDepotDimmed,
        flowchartDepotPhone: ex.flowchartDepotPhone,
        flowchartDepotTopDown: ex.flowchartDepotTopDown,
        flowchartWording: ex.flowchartWording,
        flowchartFlagColors: ex.flowchartFlagColors,
        flowchartTicketMinutes: ex.flowchartTicketMinutes,
        flowchartTicketMinutesLinear: ex.flowchartTicketMinutesLinear,
        flowchartBakery: ex.flowchartBakery,
    });
}, { platformFns: TestImpl });

// ============================================================================
// Fixtures: the depot's rows, and handles as their bindings give them
// ============================================================================

type StateRow = ValueTypeOf<typeof ex.DepotState>;
type MoveRow = ValueTypeOf<typeof ex.DepotTransition>;
const ARV: StateRow = { name: "Arrived", phase: "intake", seq: 1, slots: none, flow: "Parcels" };
const CHUTES: StateRow = { name: "Sort chutes (class)", phase: "sort", seq: 1, slots: some(14n), flow: "Parcels" };
const STATES = new Map([["ARV", ARV], ["CH*", CHUTES]]);
const AT = new Date("2026-06-30T00:00:00Z");
const ROUTED: MoveRow = { src: "ARV", dst: "CH*", kind: variant("planned", null), trigger: some("route"), volume: some(17350), n: some(386n), at: some(AT), flow: "Parcels" };
const UNRESOLVED: MoveRow = { src: "CH*", dst: "DLV", kind: variant("observed", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" };
const MOVES = new Map([["l4", ROUTED], ["l10", UNRESOLVED]]);
const LANES = new Map([["intake", { label: "Intake", seq: 1 }], ["sort", { label: "Sort", seq: 2 }]]);
const DECISIONS = new Map([["route", { name: "route", owner: "sort-planner" }]]);
const OWNERS = new Map([["sp", { name: "sort-planner", desk: "Sort office" }], ["ns", { name: "night-supervisor", desk: "Night shift" }]]);

/** A stage, its order an Integer: a lane that takes a whole order alone. */
const Stage = StructType({ label: StringType, seq: IntegerType });
/** A rule with the states queued at it: an Array of keys, or a Set of them. */
const QueuedRule = StructType({ name: StringType, queue: ArrayType(StringType) });
const SetRule = StructType({ name: StringType, queue: SetType(StringType) });

/** A `Record.bind` handle over a record of `type`, as `Record.bind` gives one: its read answers `value`, bound with its patch door when `patch`. */
function recordHandle<T extends EastType>(type: T, value: ValueTypeOf<T>, name: string, patch = true) {
    const handleType = RecordBindHandleType(type, patch ? { patch: [PatchType(type)] } : {});
    return East.function([], handleType, (_$) => ({
        read: East.function([], type, (_$2) => value as never),
        status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
        history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
        mutate: {
            pending: East.function([], BooleanType, (_$2) => false),
            status: East.function([], RecordMutateStatusType, (_$2) => variant("idle", null)),
            error: East.function([], OptionType(RecordErrorType), (_$2) => none),
            cancel: East.function([], NullType, (_$2) => null),
            ...(patch ? { patch: East.function([PatchType(type)], NullType, (_$2) => null) } : {}),
        },
        commit: patch
            ? { patch: East.asyncFunction([StringType, PatchType(type)], RecordOutcomeType, (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })) }
            : {},
        start: East.function([], NullType, (_$2) => null),
        binding: { name, mutations: patch ? ["patch"] : [] },
    }) as never);
}

/** A `Data.bind` handle over a record of `type`, as `Data.bind` gives one: its read answers `value`. */
function dataHandle<T extends EastType>(type: T, value: ValueTypeOf<T>, name: string) {
    return East.function([], DataBindHandleType(type), (_$) => ({
        read: East.function([], type, (_$2) => value as never),
        write: East.function([type], NullType, (_$2) => null),
        writeAndStart: East.function([type], NullType, (_$2) => null),
        start: East.function([], NullType, (_$2) => null),
        source: East.function([], type, (_$2) => value as never),
        pending: East.function([], BooleanType, (_$2) => false),
        commit: East.function([], NullType, (_$2) => null),
        discard: East.function([], NullType, (_$2) => null),
        has: East.function([], BooleanType, (_$2) => true),
        status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
        binding: { source: [variant("field", "inputs"), variant("field", name)], patch: none, mode: variant("staged", null) },
    }) as never);
}

const statesRecord = recordHandle(DictType(StringType, ex.DepotState), STATES, "states");
const statesUnpatched = recordHandle(DictType(StringType, ex.DepotState), STATES, "states", false);
const statesData = dataHandle(DictType(StringType, ex.DepotState), STATES, "states");
const movesRecord = recordHandle(DictType(StringType, ex.DepotTransition), MOVES, "moves");
const lanesData = dataHandle(DictType(StringType, ex.DepotLane), LANES, "lanes");
const lanesRecord = recordHandle(DictType(StringType, ex.DepotLane), LANES, "lanes");
const stagesRecord = recordHandle(DictType(StringType, Stage), new Map([["open", { label: "Open", seq: 1n }]]), "stages");
const decisionsRecord = recordHandle(DictType(StringType, ex.DepotDecision), DECISIONS, "decisions");
const queuedRecord = recordHandle(DictType(StringType, QueuedRule), new Map([["route", { name: "route", queue: ["ARV", "CH*"] }]]), "rules");
const setRecord = recordHandle(DictType(StringType, SetRule), new Map([["route", { name: "route", queue: new Set(["ARV", "CH*"]) }]]), "rules");

/** The cards a kind lists: a record's rows, keyed by String. */
const STEP_CARDS = new Map([
    ["chutes", { name: "Sort chutes", group: "Sort", values: { name: "Sort chutes", slots: some(12n), flow: "Parcels" } }],
]);
const LANE_CARDS = new Map([["returns", { name: "Returns", group: "Lanes", values: { label: "Returns" } }]]);

/** The depot's states read through their source of the rail: a paged read of the states' record through its flow index, the flow offered. */
const statesSource = () => ({
    source: Data.bindPaged(ex.depotStates, { indexes: ["flowchart_states_by_flow"] }),
    fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] } },
});

/** Builds an East function as a surface does, making each check its build makes; what it refuses, it throws. */
function built(make: ($: BlockBuilder<UIComponentType>) => ExprType<UIComponentType>): void {
    East.function([], UIComponentType, ($) => make($));
}

/** The payload `<Flowchart>` carries, read back from the carrier's bytes. */
function carried(make: ($: BlockBuilder<UIComponentType>) => ExprType<UIComponentType>): ValueTypeOf<typeof FlowchartPayloadType> {
    const ui = East.compile(East.function([], UIComponentType, ($) => make($)), [])();
    if (ui.type !== "Extension") assert.fail(`expected the Flowchart extension, got the ${ui.type} arm`);
    assert.equal(ui.value.kind, "Flowchart");
    return decodeBeast2For(FlowchartPayloadType)(ui.value.payload);
}

/** A kind built over its handle and called: what the payload carries for it. */
function kindOf<T extends EastType>(kindType: T, make: ($: BlockBuilder<T>) => ExprType<T>): ValueTypeOf<T> {
    return East.compile(East.function([], kindType as EastType, ($) => make($ as never) as never), [])() as ValueTypeOf<T>;
}

/** Whether `build` throws an Error whose message is `message`, exactly. */
function refused(build: () => void, message: string): void {
    assert.throws(build, (error: unknown) => {
        assert.ok(error instanceof Error, "an Error");
        assert.equal(error.message, message);
        return true;
    });
}

const stateBytes = encodeBeast2For(ex.DepotState);
const stateOf = decodeBeast2For(ex.DepotState);
const stateEqual = equalFor(ex.DepotState);
const moveBytes = encodeBeast2For(ex.DepotTransition);
const moveOf = decodeBeast2For(ex.DepotTransition);
const moveEqual = equalFor(ex.DepotTransition);
const laneBytes = encodeBeast2For(ex.DepotLane);
const laneOf = decodeBeast2For(ex.DepotLane);
const laneEqual = equalFor(ex.DepotLane);
const vocabularyEqual = equalFor(FlowchartPayloadType.fields.vocabulary);
const optionString = equalFor(OptionType(StringType));
/** The canvas's `narrow`, as the payload carries it. */
const narrowEqual = equalFor(FlowchartPayloadType.fields.canvas.fields.narrow);
const optionFloat = equalFor(OptionType(FloatType));
const keysEqual = equalFor(ArrayType(StringType));
/** The rows a reader read of a record by key, as a kind's `rowsOf` takes them: an Array of `{ key, row }`, as bytes. */
const readOf = <R extends StructType>(row: R, read: { key: string; row: ValueTypeOf<R> }[]) => encodeBeast2For(ArrayType(StructType({ key: StringType, row })))(read as never);

// ============================================================================
// R2: each role a field of the app's row, checked
// ============================================================================

/** The roles' type checks (R2): never called — `tsc` checks what each line says. */
function typeChecks($: BlockBuilder<UIComponentType>): void {
    const states = $.let(Record.bind(ex.depotStates));
    const transitions = $.let(Record.bind(ex.depotTransitions));
    const lanes = $.let(Data.bind(ex.depotLanes));
    const decisions = $.let(Data.bind(ex.depotDecisions));
    const stages = $.let(stagesRecord());
    const rules = $.let(queuedRecord());
    // What fits, as the examples write it.
    PublicFlowchart.states(states, { label: "name", lane: "phase", order: "seq", members: (s) => s.slots });
    PublicFlowchart.transitions(transitions, { from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind });
    PublicFlowchart.lanes(stages, { label: "label", order: "seq" });
    PublicFlowchart.decisions(rules, { label: (r) => r.name, queue: "queue" });
    // @ts-expect-error — `slots` is an Option of an Integer: a state's label is a String field, or an Option of one
    PublicFlowchart.states(states, { label: "slots" });
    // @ts-expect-error — `volume` and `dst` hold two types: a transition's ends hold a state's key each, of one type
    PublicFlowchart.transitions(transitions, { from: "volume", to: "dst" });
    // @ts-expect-error — `name` is a String: a state's order is a Float field
    PublicFlowchart.states(states, { label: "name", order: "name" });
    // @ts-expect-error — `queue` is an Array: a state's lane holds its lane's key, of a type a Dict may be keyed by
    PublicFlowchart.states(rules, { label: "name", lane: "queue" });
    // @ts-expect-error — `label` is a String: a lane's order is an Integer or a Float field
    PublicFlowchart.lanes(lanes, { label: "label", order: "label" });
    // @ts-expect-error — `owner` is a String: a decision's queue is an Array or a Set of the states' keys
    PublicFlowchart.decisions(decisions, { label: (d) => d.name, queue: "owner" });
    // @ts-expect-error — `members` returns an Option of an Integer
    PublicFlowchart.states(states, { label: "name", members: (s) => s.name });
    // @ts-expect-error — the lanes are read whole: a paged read is no binding of theirs
    PublicFlowchart.lanes($.let(Data.bindPaged(ex.depotLanes)), { label: "label" });
    // @ts-expect-error — the Flowchart takes no `record`: its records are its kinds
    PublicFlowchart({ states: PublicFlowchart.states(states, { label: "name" }), record: states });
    // @ts-expect-error — nor `data`
    PublicFlowchart({ states: PublicFlowchart.states(states, { label: "name" }), data: states });
    // @ts-expect-error — `narrowed` is "hide" or "dim"
    PublicFlowchart({ states: PublicFlowchart.states(states, { label: "name" }), narrowed: "fade" });
    // @ts-expect-error — `inspector` is a switch: a kind's own Details is its kind's `inspector`
    PublicFlowchart({ states: PublicFlowchart.states(states, { label: "name" }), inspector: { state: true } });
}

describe("each role is a field of the app's row, named and checked (R2)", () => {
    hostTest("a role naming a field the row lacks, or one of another type, is a type error, and past a cast the kind's words", () => {
        assert.equal(typeof typeChecks, "function");
        const states = (spec: object) => () => built(($) => {
            const record = $.let(statesRecord());
            const lanes = $.let(lanesData());
            return PublicFlowchart({ states: Flowchart.states(record, spec as never), lanes: Flowchart.lanes(lanes, { label: "label" }) });
        });
        refused(states({ label: "title", lane: "phase" }),
            "Flowchart.states: `label` names \"title\", a field the row does not have (name, phase, seq, slots, flow)");
        refused(states({ label: "slots", lane: "phase" }),
            "Flowchart.states: `label` names a String field, or an Option of one — \"slots\" holds an Option of .Integer");
        refused(states({ label: "name", lane: "seq" }),
            "Flowchart: a state's lane, \"seq\", holds .Float — and the lanes are keyed by .String: key the lanes by .Float, or name a field holding .String");
        refused(states({ label: "name", lane: "phase", order: "flow" }),
            "Flowchart.states: `order` names a Float field, the state's place in its lane — \"flow\" holds .String");
        refused(states({ label: "phase", lane: "phase" }),
            "Flowchart.states: `label` and `lane` both name \"phase\" — a state's name and its lane are two fields");
        // Lanes keyed by Float would take "seq" as a lane: every move would write the order over it.
        refused(states({ label: "name", lane: "seq", order: "seq" }),
            "Flowchart.states: `lane` and `order` both name \"seq\" — a state's lane and its place in it are two fields");
        refused(states({ label: "name", lane: "phase", members: "slots" }),
            "Flowchart.states: `members` is an accessor, (row, key) => an Option of an Integer");
        refused(states({ label: "name", lane: "phase", name: "" }), "Flowchart.states: `name` is what one is called, a string");
        refused(states({ label: "name", lane: "phase", icon: 3 }), "Flowchart.states: `icon` is a Font Awesome solid icon's name");
    });

    hostTest("a transition's ends are two fields of one type, and its decision a third", () => {
        const transitions = (spec: object) => () => built(($) => {
            const states = $.let(statesRecord());
            const moves = $.let(movesRecord());
            const decisions = $.let(decisionsRecord());
            return PublicFlowchart({
                states: Flowchart.states(states, { label: "name" }),
                transitions: Flowchart.transitions(moves, spec as never),
                decisions: Flowchart.decisions(decisions, { label: (d) => d.name }),
            });
        });
        refused(transitions({ from: 1, to: "dst" }), "Flowchart.transitions: `from` names the field holding a state's key");
        refused(transitions({ from: "volume", to: "dst" }),
            "Flowchart.transitions: `from` and `to` each hold a state's key, of one type — \"volume\" holds an Option of .Float, and \"dst\" .String");
        refused(transitions({ from: "src", to: "src" }),
            "Flowchart.transitions: `from` and `to` both name \"src\" — a transition's ends are two fields");
        refused(transitions({ from: "src", to: "dst", decision: "dst" }),
            "Flowchart.transitions: `decision` and `to` both name \"dst\" — a transition's decision and its ends are three fields");
        refused(transitions({ from: "src", to: "dst", kind: "kind" }),
            "Flowchart.transitions: `kind` is an accessor, (row, key) => a Flowchart.Types.Kind, planned or observed");
    });

    hostTest("a lane's order is an Integer or a Float field; a decision's label an accessor and its queue an Array or a Set of keys", () => {
        const lanes = (spec: object) => () => built(($) => {
            const states = $.let(statesRecord());
            const record = $.let(lanesRecord());
            return PublicFlowchart({ states: Flowchart.states(states, { label: "name", lane: "phase" }), lanes: Flowchart.lanes(record, spec as never) });
        });
        refused(lanes({ label: "label", order: "label" }),
            "Flowchart.lanes: `order` names an Integer or a Float field, the lane's place among the lanes — \"label\" holds .String");
        refused(lanes({ label: "label", entries: true }), "Flowchart.lanes: the lanes are read whole — leave entries out");
        const decisions = (spec: object) => () => built(($) => {
            const states = $.let(statesRecord());
            const record = $.let(decisionsRecord());
            return PublicFlowchart({ states: Flowchart.states(states, { label: "name" }), decisions: Flowchart.decisions(record, spec as never) });
        });
        const named = (d: ExprType<typeof ex.DepotDecision>) => d.name;
        refused(decisions({ label: "name" }), "Flowchart.decisions: `label` is an accessor giving a decision's name, (row, key) => …");
        refused(decisions({ label: named, queue: "owner" }),
            "Flowchart.decisions: `queue` names an Array or a Set field, the states queued at it by key — \"owner\" holds .String");
        refused(decisions({ label: named, entries: true }), "Flowchart.decisions: the decisions are read whole — leave entries out");
    });
});

// ============================================================================
// R3: how a kind is bound follows how it is read
// ============================================================================

describe("a kind's binding follows its read: every other form is refused, naming the one to use (R3)", () => {
    const FORMS = "bind Record.bind(record) to edit them, Data.bind(record) to read them whole, or Data.bindPaged(record) to read them through their source";

    hostTest("the states are a binding of a record of the app's: a value, a read and a record bound without its patch door are refused", () => {
        refused(() => built((_$) => PublicFlowchart({ states: Flowchart.states(STATES as never, { label: "name" } as never) })),
            `Flowchart.states: the states are a record of the app's: ${FORMS}`);
        refused(() => built(($) => {
            const states = $.let(Data.bind(ex.depotStates));
            return PublicFlowchart({ states: Flowchart.states(states.read() as never, { label: "name" } as never) });
        }), `Flowchart.states: the states are a record of the app's: ${FORMS} — and this is ${printType(DictType(StringType, ex.DepotState))}`);
        refused(() => built(($) => {
            const states = $.let(statesUnpatched());
            return PublicFlowchart({ states: Flowchart.states(states, { label: "name" }) });
        }), "Flowchart.states: the states' record is bound without its patch door — its record declares patch: mutation.patch(), which Save writes each change through");
    });

    hostTest("entries read beside Record.bind alone, and through the states' source of the slice", () => {
        refused(() => built(($) => {
            const states = $.let(Data.bind(ex.depotStates));
            const entries = $.let(Data.bindPaged(ex.depotStates));
            return PublicFlowchart({ states: Flowchart.states(states, { label: "name", entries }) });
        }), "Flowchart.states: entries reads beside Record.bind: bind the states with Record.bind(record), or bind Data.bindPaged(record) alone to read them through their source, read only");
        refused(() => built(($) => {
            const states = $.let(Record.bind(ex.depotStates));
            const entries = $.let(Data.bindPaged(ex.depotStates));
            return PublicFlowchart({ states: Flowchart.states(states, { label: "name", entries }) });
        }), "Flowchart.states: the states are read through their source of the slice: give a source named states, Data.bindPaged(record, { indexes }) over the states' record, or drop entries");
    });

    hostTest("a read through the slice's source takes Data.bindPaged alone, or Record.bind with its entries", () => {
        const sliced = (bind: ($: BlockBuilder<UIComponentType>) => object) => () => built(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.spec.bindings", { states: statesSource() }));
            return PublicFlowchart({ slice: { slice }, ...bind($) } as never);
        });
        refused(sliced(($) => ({ states: Flowchart.states($.let(Data.bind(ex.depotStates)), { label: "name" }) })),
            "Flowchart.states: Data.bind(record) reads the states whole, and the slice's source \"states\" reads them through it — " +
            "bind Data.bindPaged(record) to read them through their source, read only, or Record.bind(record) with entries: Data.bindPaged(record) to edit them");
        refused(sliced(($) => ({ states: Flowchart.states($.let(Record.bind(ex.depotStates)), { label: "name" }) })),
            "Flowchart.states: the slice's source \"states\" reads only its narrowing, and a row is read by its key — the inspector's, " +
            "a gesture's original and Save's confirmation: give entries: Data.bindPaged(record) beside Record.bind, the states' record's own entries");
        refused(() => built(($) => PublicFlowchart({ states: Flowchart.states($.let(Data.bindPaged(ex.depotStates)), { label: "name" }) })),
            "Flowchart.states: Data.bindPaged(record) reads the states through their source of the slice: give a source named states, " +
            "Data.bindPaged(record, { indexes }) over the states' record — or bind Data.bind(record) to read them whole");
        refused(() => built(($) => {
            const indexed = $.let(Data.bindPaged(ex.depotStates, { indexes: ["flowchart_states_by_flow"] }));
            return PublicFlowchart({ states: Flowchart.states(indexed as never, { label: "name" } as never) });
        }), `Flowchart.states: the states are a record of the app's: ${FORMS} — and this paged read reads the record through its indexes: ` +
            "bind its own entries, Data.bindPaged(record), and name the indexed read as the states' source of the slice");
        // Each form it takes builds: Data.bindPaged alone, and Record.bind with its entries.
        built(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.spec.paged", { states: statesSource() }));
            return PublicFlowchart({ slice: { slice }, states: Flowchart.states($.let(Data.bindPaged(ex.depotStates)), { label: "name" }) });
        });
        built(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.spec.edited", { states: statesSource() }));
            const states = $.let(Record.bind(ex.depotStates));
            const entries = $.let(Data.bindPaged(ex.depotStates));
            return PublicFlowchart({ slice: { slice }, states: Flowchart.states(states, { label: "name", entries }) });
        });
    });

    hostTest("the lanes and the decisions are read whole: a paged read is refused", () => {
        const WHOLE = "a record of the app's, read whole: bind Record.bind(record) to edit them, or Data.bind(record) to read them" +
            " — and this is Data.bindPaged(record), which reads a record through its source of the slice";
        refused(() => built(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), { label: "name", lane: "phase" }),
            lanes: Flowchart.lanes($.let(Data.bindPaged(ex.depotLanes)) as never, { label: "label" } as never),
        })), `Flowchart.lanes: the lanes are ${WHOLE}`);
        refused(() => built(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), { label: "name" }),
            decisions: Flowchart.decisions($.let(Data.bindPaged(ex.depotDecisions)) as never, { label: (d: ExprType<typeof ex.DepotDecision>) => d.name } as never),
        })), `Flowchart.decisions: the decisions are ${WHOLE}`);
    });

    hostTest("a role naming another kind's key needs that kind, and the lanes need the states' lane", () => {
        refused(() => built(($) => PublicFlowchart({ states: Flowchart.states($.let(statesRecord()), { label: "name", lane: "phase" }) })),
            "Flowchart: a state's lane names a lane — give lanes={Flowchart.lanes(…)}, or drop lane");
        refused(() => built(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), { label: "name" }),
            lanes: Flowchart.lanes($.let(lanesData()), { label: "label" }),
        })), "Flowchart: the lanes are columns: give the states their lane — Flowchart.states(record, { label, lane })");
        refused(() => built(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), { label: "name" }),
            transitions: Flowchart.transitions($.let(movesRecord()), { from: "src", to: "dst", decision: "trigger" }),
        })), "Flowchart: a transition's decision names a decision — give decisions={Flowchart.decisions(…)}, or drop decision");
    });
});

// ============================================================================
// The props: each kind by its prop, and every prop the flows took refused
// ============================================================================

describe("<Flowchart>'s props: each kind by its prop, and every prop the flows took refused, naming what replaces it (R1)", () => {
    const tag = (props: object) => () => built(($) => PublicFlowchart({ states: Flowchart.states($.let(statesRecord()), { label: "name" }), ...props } as never));

    hostTest("the states are needed, and each kind goes in its own prop", () => {
        refused(() => built((_$) => PublicFlowchart({} as never)),
            "Flowchart: needs its states — states={Flowchart.states(record, { label, lane?, order? })}, over the app's record");
        refused(() => built(($) => PublicFlowchart({ states: Flowchart.transitions($.let(movesRecord()), { from: "src", to: "dst" }) } as never)),
            "Flowchart: `states` is Flowchart.states(record, { label, lane?, order? }) over the app's record — " +
            "and this is Flowchart.transitions(record, { from, to, decision? }): give it as `transitions`");
        refused(tag({ lanes: "lanes" }), "Flowchart: `lanes` is Flowchart.lanes(record, { label, order? }) over the app's record");
    });

    hostTest("the flows' props are gone, each refused with what replaces it", () => {
        const RECORDS = "the Flowchart takes no `record`, `data`, `flow` or `onApply` — its records are its kinds: " +
            "states={Flowchart.states(Record.bind(steps), { label, lane, order })}, transitions={Flowchart.transitions(Record.bind(moves), { from, to })}, " +
            "lanes={Flowchart.lanes(Data.bind(phases), { label })} and decisions={Flowchart.decisions(Data.bind(rules), { label })}";
        for (const prop of ["record", "data", "flow", "onApply"]) refused(tag({ [prop]: true }), `Flowchart: \`${prop}\` is gone — ${RECORDS}`);
        refused(tag({ links: true }), "Flowchart: `links` is gone — the transitions are `transitions`: transitions={Flowchart.transitions(record, { from, to })}");
        refused(tag({ triggers: true }), "Flowchart: `triggers` is gone — the decisions are `decisions`: decisions={Flowchart.decisions(record, { label })}");
        refused(tag({ window: true }), "Flowchart: `window` is gone — the states and the transitions read through their sources of the slice, `states` and `transitions` — " +
            "slice={{ slice: Slice.bindRecords(key, { states: { source: Data.bindPaged(steps, { indexes }) } }) }}");
        for (const prop of ["state", "link", "lane", "trigger"]) {
            refused(tag({ [prop]: true }), `Flowchart: \`${prop}\` is gone — a kind maps its record's fields to its roles — Flowchart.states(record, { label, lane, order }), ` +
                "Flowchart.transitions(record, { from, to, decision }), Flowchart.lanes(record, { label, order }) and Flowchart.decisions(record, { label })");
        }
        refused(tag({ height: "560px" }), "Flowchart: `height` is gone — the Flowchart fills the box it is given — give it a box of its own height: <Box height=\"560px\"><Flowchart … /></Box>");
        refused(tag({ density: "compact" }), "Flowchart: `density` is gone — the canvas draws at one rhythm — leave `density` out");
        refused(tag({ onAddState: true }), "Flowchart: `onAddState` is gone — every gesture is a transaction of the Flowchart's editing session, and Save writes each record " +
            "through its patch door — bind a kind with Record.bind(record), its record declaring patch: mutation.patch(), to edit it");
        refused(tag({ stateHover: true }), "Flowchart: `stateHover` is gone — the inspector shows what is selected, and a kind's own Details is its kind's `inspector`: " +
            "Flowchart.states(record, { …, inspector: East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …) })");
        refused(tag({ affordances: ["fields"] }), "Flowchart: `affordances` is gone — it moved into `slice`: slice={{ slice: Slice.bindRecords(key, { … }), affordances }}");
    });

    hostTest("a prop it doesn't take is refused, naming those it does — `id` among them, the Flowchart keeping its state apart by `name`", () => {
        refused(tag({ id: "depot" }), "Flowchart: `id` is not a prop of <Flowchart> — it takes states, transitions, lanes, decisions, slice, narrowed, library, inspector, " +
            "vocabulary, readOnly, name, orientation, freshness, minimap, legend, onSelectState, onSelectLink, onSelectTrigger, onTracePath, canConnect, narrow");
        refused(tag({ name: "" }), "Flowchart: `name` keeps the Flowchart's state apart — a string, needed only when one surface holds two");
        refused(tag({ narrowed: "fade" }), "Flowchart: `narrowed` is \"hide\" (the default), which leaves what the narrowing leaves out off the canvas, or \"dim\", which draws it as context");
        refused(tag({ inspector: { state: true } }), "Flowchart: `inspector` is true or false — on unless false — and a kind's own Details is its kind's `inspector`: " +
            "Flowchart.states(record, { …, inspector: East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …) })");
    });

    hostTest("`vocabulary` names a transition's kinds alone, a kind's noun its own `name` (#1516) — an empty word, a kind's noun and a word it has none of each refused", () => {
        refused(tag({ vocabulary: { planned: " " } }), "Flowchart: `vocabulary.planned` must not be empty — leave it out to keep \"Planned\"");
        refused(tag({ vocabulary: { state: "Stop" } }), "Flowchart: `vocabulary.state` is not one of its words — a kind's noun is its own `name`: Flowchart.states(record, { label, name })");
        refused(tag({ vocabulary: { transition: "Hop" } }), "Flowchart: `vocabulary.transition` is not one of its words — a kind's noun is its own `name`: Flowchart.transitions(record, { from, to, name })");
        refused(tag({ vocabulary: { flow: "Route" } }), "Flowchart: `vocabulary.flow` is not one of its words — it takes `planned` and `observed`, a transition's kinds, and a kind's noun is its own `name`");
        refused(tag({ vocabulary: "Designed" }), "Flowchart: `vocabulary` takes the app's words for a transition's kinds — vocabulary={{ planned?, observed? }}");
    });

    hostTest("the shared keys keep a named Flowchart's state apart", () => {
        assert.deepEqual(flowchartKeys(undefined), { frame: "flowchart.frame", library: "flowchart.library", orientation: "flowchart.orientation", surface: "flowchart.surface" });
        assert.deepEqual(flowchartKeys("depot"), { frame: "flowchart.depot.frame", library: "flowchart.library.depot", orientation: "flowchart.depot.orientation", surface: "flowchart.depot.surface" });
    });
});

// ============================================================================
// R4: the rail
// ============================================================================

describe("the rail is one Slice.bindRecords, its states and transitions sources each named after its kind (R4)", () => {
    hostTest("`slice` takes { slice }, and no brush", () => {
        refused(() => built(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.spec.shape", { states: statesSource() }));
            return PublicFlowchart({ slice, states: Flowchart.states($.let(Data.bindPaged(ex.depotStates)), { label: "name" }) } as never);
        }), "Flowchart: `slice` takes { slice } — slice={{ slice: Slice.bindRecords(key, { … }), affordances?, persist? }}, its sources `states` and `transitions` each named after the kind it narrows");
        refused(() => built(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.spec.brush", { states: statesSource() }));
            return PublicFlowchart({ slice: { slice, affordances: ["brush"] }, states: Flowchart.states($.let(Data.bindPaged(ex.depotStates)), { label: "name" }) });
        }), "Flowchart: `slice`'s affordances list \"brush\", and a flowchart has no continuous axis to brush along — mount fields, search, presets or summary");
    });

    hostTest("the lanes and the decisions are read whole: a source named after either is refused", () => {
        refused(() => built(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.spec.lanes", { lanes: statesSource() }));
            return PublicFlowchart({ slice: { slice }, states: Flowchart.states($.let(statesRecord()), { label: "name" }) });
        }), "Flowchart: the lanes are read whole: drop the lanes source");
        refused(() => built(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.spec.decisions", { decisions: statesSource() }));
            return PublicFlowchart({ slice: { slice }, states: Flowchart.states($.let(statesRecord()), { label: "name" }) });
        }), "Flowchart: the decisions are read whole: drop the decisions source");
    });

    hostTest("every other source is named by a list of cards, a tab or details: a source nothing names is refused", () => {
        refused(() => built(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.spec.stray", { states: statesSource(), extra: statesSource() }));
            return PublicFlowchart({ slice: { slice }, states: Flowchart.states($.let(Data.bindPaged(ex.depotStates)), { label: "name" }) });
        }), "Flowchart: `slice` narrows its states and its transitions, each by the source named after it, and the cards lists, tabs and details that name a source — " +
            "its source 'extra' is none of them; name the sources `states`");
    });
});

// ============================================================================
// A kind's cards (R14, D8)
// ============================================================================

describe("a kind's cards are a record's rows, following their own source of the rail (R14, D8)", () => {
    const steps = ($: BlockBuilder<UIComponentType>) => $.const(STEP_CARDS, DictType(StringType, ex.StepCard));

    hostTest("cards are Flowchart.templates' over a Dict of rows, their values every field but what a drop writes", () => {
        refused(() => built(($) => {
            const listed = $.const([...STEP_CARDS.values()], ArrayType(ex.StepCard));
            return PublicFlowchart({ states: Flowchart.states($.let(statesRecord()), {
                label: "name", templates: Flowchart.templates(listed as never, {
                    name: (c: ExprType<typeof ex.StepCard>) => c.name, values: (c: ExprType<typeof ex.StepCard>) => c.values, source: "stepCards",
                }) as never,
            }) });
        }), `Flowchart.templates: the cards are a record's rows — a Dict, Data.bind(record).read() — and these are ${printType(ArrayType(ex.StepCard))}`);
        refused(() => built(($) => PublicFlowchart({ states: Flowchart.states($.let(statesRecord()), {
            label: "name", templates: [{ name: "Sort chutes" }] as never,
        }) })), "Flowchart.states: `templates` are records — Flowchart.templates(cards.read(), { name, values, source }) over a record of the app's, its source one of the slice's");
        // The states' cards give every field but the lane and the order: these give a lane too.
        const WithLane = StructType({ name: StringType, phase: StringType, slots: OptionType(IntegerType), flow: StringType });
        refused(() => built(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), {
                label: "name", lane: "phase", order: "seq",
                templates: Flowchart.templates(steps($), {
                    name: (c) => c.name, values: (c) => East.value({ name: c.name, phase: "sort", slots: c.values.slots, flow: c.values.flow }, WithLane), source: "stepCards",
                }) as never,
            }),
            lanes: Flowchart.lanes($.let(lanesData()), { label: "label" }),
        })), `Flowchart.states: its cards' \`values\` give every field of the row but \`phase\` and \`seq\` — ${printType(StructType({ name: StringType, slots: OptionType(IntegerType), flow: StringType }))} ` +
            `— and these give ${printType(WithLane)}`);
    });

    hostTest("a list of cards names its source of the slice, and never a kind's own", () => {
        refused(() => built(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), {
                label: "name", lane: "phase", order: "seq",
                templates: Flowchart.templates(steps($), { name: (c) => c.name, values: (c) => c.values, source: "stepCards" }),
            }),
            lanes: Flowchart.lanes($.let(lanesData()), { label: "label" }),
        })), "Flowchart: templates are records now — bind them in Slice.bindRecords and name the source, Flowchart.templates(rows, { …, source }) " +
            "(it has no slice — 'stepCards' is not one of them)");
        refused(() => built(($) => {
            const slice = $.let(Slice.bindRecords("flowchart.spec.cards", { states: statesSource() }));
            return PublicFlowchart({ slice: { slice }, states: Flowchart.states($.let(Data.bindPaged(ex.depotStates)), {
                label: "name", lane: "phase", order: "seq",
                templates: Flowchart.templates(steps($), { name: (c) => c.name, values: (c) => c.values, source: "states" }),
            }), lanes: Flowchart.lanes($.let(lanesData()), { label: "label" }) });
        }), "Flowchart: the states' cards name the source 'states', which narrows the states — a kind's cards are a record of their own, and their own source of the slice");
    });
});

// ============================================================================
// The kinds' closed functions, over decoded bytes
// ============================================================================

describe("the states' closed functions, over decoded bytes (R1, R8)", () => {
    const states = kindOf(Flowchart.Types.StateKind, ($) => {
        const record = $.let(statesRecord());
        const cards = $.const(STEP_CARDS, DictType(StringType, ex.StepCard));
        return Flowchart.states(record, {
            label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
            templates: Flowchart.templates(cards, { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards" }),
            ready: (s) => s.flow.equal("").ifElse(
                () => variant("incomplete", [{ field: "flow", message: "Give the state its flow" }]),
                () => variant("ready", null),
            ),
        }).build(undefined, false);
    });

    hostTest("what one is called and its icon, unless given; editable through its patch door; its row type the record's", () => {
        assert.equal(states.name, "State");
        assert.equal(states.icon, "square");
        assert.equal(states.editable, true);
        assert.equal(states.editing.type, "some");
        assert.ok(isTypeEqual(fromEastTypeValue(states.rowType), ex.DepotState));
    });

    hostTest("its rows: each stored state's roles beside its own row, by key", () => {
        const rows = states.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(keysEqual([...rows.value.keys()], ["ARV", "CH*"]));
        const chutes = rows.value.get("CH*")!;
        assert.ok(stateEqual(stateOf(chutes.row), CHUTES), "the row crosses whole, its own fields among it");
        assert.equal(chutes.roles.label, "Sort chutes (class)");
        assert.ok(optionString(chutes.roles.lane, some("sort")));
        assert.ok(optionFloat(chutes.roles.order, some(1)));
        assert.ok(equalFor(OptionType(IntegerType))(chutes.roles.members, some(14n)));
        assert.equal(rows.value.get("ARV")!.roles.members.type, "none");
    });

    hostTest("a read by key, and rows a reader read by key made stored states", () => {
        const roles = states.read(stateBytes(ARV), "ARV");
        assert.equal(roles.label, "Arrived");
        assert.ok(optionString(roles.lane, some("intake")));
        const read = states.rowsOf(readOf(ex.DepotState, [{ key: "CH*", row: CHUTES }]));
        assert.ok(keysEqual([...read.keys()], ["CH*"]));
        assert.ok(stateEqual(stateOf(read.get("CH*")!.row), CHUTES));
    });

    hostTest("a gesture writes its roles' fields alone, every other field as it was (R8)", () => {
        const moved = states.write(stateBytes(ARV), { label: none, lane: some("sort"), order: some(1.5) });
        if (moved.type !== "some") assert.fail("a state takes a move");
        assert.ok(stateEqual(stateOf(moved.value), { ...ARV, phase: "sort", seq: 1.5 }));
        const renamed = states.write(stateBytes(CHUTES), { label: some("Chutes"), lane: none, order: none });
        if (renamed.type !== "some") assert.fail("a state takes a rename");
        assert.ok(stateEqual(stateOf(renamed.value), { ...CHUTES, name: "Chutes" }));
    });

    hostTest("a new state: its roles over a card's values, or over its type's defaults", () => {
        assert.equal(states.templates.length, 1);
        const card = states.templates[0]!;
        assert.equal(card.key, "chutes");
        assert.equal(card.name, "Sort chutes");
        assert.ok(optionString(card.group, some("Sort")));
        assert.ok(optionString(states.templatesSource, some("stepCards")));
        const dropped = states.create({ label: none, lane: some("sort"), order: some(3) }, some(card.values));
        if (dropped.type !== "some") assert.fail("a card makes a state");
        assert.ok(stateEqual(stateOf(dropped.value), { name: "Sort chutes", phase: "sort", seq: 3, slots: some(12n), flow: "Parcels" }));
        const added = states.create({ label: some("Weighed"), lane: some("intake"), order: some(3) }, none);
        if (added.type !== "some") assert.fail("+ STATE makes a state");
        assert.ok(stateEqual(stateOf(added.value), { name: "Weighed", phase: "intake", seq: 3, slots: none, flow: "" }));
    });

    hostTest("an author's card sets its fields; the form edits the fields no role writes; the app's ready checks a drafted state", () => {
        const set = states.set(stateBytes(ARV), [{ path: ["flow"], value: encodeBeast2For(StringType)("Returns") }]);
        if (set.type !== "some") assert.fail("flow is the state's");
        assert.ok(stateEqual(stateOf(set.value), { ...ARV, flow: "Returns" }));
        assert.equal(states.set(stateBytes(ARV), [{ path: ["desk"], value: encodeBeast2For(StringType)("Night shift") }]).type, "none", "a field the row lacks: nothing to write");
        assert.ok(keysEqual(states.fields.map((field) => field.path.join(".")), ["slots", "flow"]));
        if (states.ready.type !== "some") assert.fail("the app's check crosses");
        const [drafted, named] = states.ready.value([
            { id: "NEW", entry: stateBytes({ ...ARV, flow: "" }) },
            { id: "ARV", entry: stateBytes(ARV) },
        ]);
        assert.ok(equalFor(EditingReadinessType)(drafted!, variant("incomplete", [{ field: "flow", message: "Give the state its flow" }])));
        assert.ok(equalFor(EditingReadinessType)(named!, variant("ready", null)));
    });

    hostTest("bound with Data.bind, the states are read only", () => {
        const readOnly = kindOf(Flowchart.Types.StateKind, ($) => Flowchart.states($.let(statesData()), { label: "name" }).build(undefined, false));
        assert.equal(readOnly.editable, false);
        assert.equal(readOnly.editing.type, "none");
        assert.equal(readOnly.history.type, "none");
        assert.equal(readOnly.ready.type, "none");
    });
});

describe("the transitions', the lanes' and the decisions' closed functions, over decoded bytes (R1, R8)", () => {
    const transitions = kindOf(Flowchart.Types.TransitionKind, ($) => Flowchart.transitions($.let(movesRecord()), {
        from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind,
        evidence: (t) => some({ volume: t.volume, count: t.n, measuredAt: t.at, unit: some("parcels") }),
    }).build(undefined, false));

    hostTest("a transition's roles: its ends, its decision, its kind and its evidence", () => {
        assert.equal(transitions.name, "Transition");
        assert.equal(transitions.icon, "arrow-right");
        const rows = transitions.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const routed = rows.value.get("l4")!.roles;
        assert.equal(routed.from, "ARV");
        assert.equal(routed.to, "CH*");
        assert.ok(optionString(routed.decision, some("route")));
        assert.equal(routed.kind.type, "planned");
        assert.ok(equalFor(OptionType(Flowchart.Types.Evidence))(routed.evidence,
            some({ volume: some(17350), count: some(386n), measuredAt: some(AT), unit: some("parcels") })));
        assert.equal(rows.value.get("l10")!.roles.kind.type, "observed");
    });

    hostTest("unless given, a transition is planned with no evidence and no decision", () => {
        const plain = kindOf(Flowchart.Types.TransitionKind, ($) => Flowchart.transitions($.let(movesRecord()), { from: "src", to: "dst" }).build(undefined, false));
        const rows = plain.rows();
        if (rows.type !== "some") assert.fail("read whole");
        assert.equal(rows.value.get("l10")!.roles.kind.type, "planned");
        assert.equal(rows.value.get("l10")!.roles.evidence.type, "none");
        assert.equal(rows.value.get("l4")!.roles.decision.type, "none");
    });

    hostTest("Connect writes its ends; a decision's Del clears it; every other field as it was", () => {
        const reconnected = transitions.write(moveBytes(ROUTED), { from: none, to: some("SRD"), decision: none });
        if (reconnected.type !== "some") assert.fail("a transition takes its ends");
        assert.ok(moveEqual(moveOf(reconnected.value), { ...ROUTED, dst: "SRD" }));
        const cleared = transitions.write(moveBytes(ROUTED), { from: none, to: none, decision: some(none) });
        if (cleared.type !== "some") assert.fail("a transition's decision clears");
        assert.ok(moveEqual(moveOf(cleared.value), { ...ROUTED, trigger: none }));
        // Connect writes the ends alone: every other field is its type's default — `kind`'s the first of its cases in
        // East's order, which is by name.
        const connected = transitions.create({ from: some("ARV"), to: some("SCN"), decision: none }, none);
        if (connected.type !== "some") assert.fail("Connect makes a transition");
        assert.ok(moveEqual(moveOf(connected.value),
            { src: "ARV", dst: "SCN", kind: variant("observed", null), trigger: none, volume: none, n: none, at: none, flow: "" }));
    });

    hostTest("a lane's roles, its label and its order written, and a new lane over a card's values", () => {
        const lanes = kindOf(Flowchart.Types.LaneKind, ($) => {
            const cards = $.const(LANE_CARDS, DictType(StringType, ex.LaneCard));
            return Flowchart.lanes($.let(lanesRecord()), {
                label: "label", order: "seq",
                templates: Flowchart.templates(cards, { name: (c) => c.name, values: (c) => c.values, source: "laneCards" }),
            }).build(undefined, false);
        });
        assert.equal(lanes.name, "Lane");
        assert.equal(lanes.icon, "table-columns");
        const rows = lanes.rows();
        if (rows.type !== "some") assert.fail("read whole");
        assert.equal(rows.value.get("sort")!.roles.label, "Sort");
        assert.ok(optionFloat(rows.value.get("sort")!.roles.order, some(2)));
        const renamed = lanes.write(laneBytes({ label: "Sort", seq: 2 }), { label: some("Sortation"), order: none });
        if (renamed.type !== "some") assert.fail("a lane takes a rename");
        assert.ok(laneEqual(laneOf(renamed.value), { label: "Sortation", seq: 2 }));
        const added = lanes.create({ label: none, order: some(2.5) }, some(lanes.templates[0]!.values));
        if (added.type !== "some") assert.fail("a card makes a lane");
        assert.ok(laneEqual(laneOf(added.value), { label: "Returns", seq: 2.5 }));
    });

    hostTest("a lane's Integer order takes a whole order alone: between two whole numbers it writes nothing", () => {
        const stages = kindOf(Flowchart.Types.LaneKind, ($) => Flowchart.lanes($.let(stagesRecord()), { label: "label", order: "seq" }).build(undefined, false));
        const bytes = encodeBeast2For(Stage)({ label: "Open", seq: 1n });
        const rows = stages.rows();
        if (rows.type !== "some") assert.fail("read whole");
        assert.ok(optionFloat(rows.value.get("open")!.roles.order, some(1)), "an Integer order read as a Float");
        const whole = stages.write(bytes, { label: none, order: some(4) });
        if (whole.type !== "some") assert.fail("a whole order fits");
        assert.ok(equalFor(Stage)(decodeBeast2For(Stage)(whole.value), { label: "Open", seq: 4n }));
        assert.equal(stages.write(bytes, { label: none, order: some(1.5) }).type, "none");
        assert.equal(stages.create({ label: some("Close"), order: some(2.5) }, none).type, "none");
    });

    hostTest("a decision's roles; its queue takes a deleted state's key out, from an Array or a Set; with no queue, none", () => {
        const decisions = kindOf(Flowchart.Types.DecisionKind, ($) => Flowchart.decisions($.let(decisionsRecord()), {
            label: (d) => d.name, owner: (d) => some(d.owner),
        }).build(undefined, false));
        assert.equal(decisions.name, "Decision");
        assert.equal(decisions.icon, "diamond");
        const rows = decisions.rows();
        if (rows.type !== "some") assert.fail("read whole");
        const route = rows.value.get("route")!.roles;
        assert.equal(route.label, "route");
        assert.ok(optionString(route.owner, some("sort-planner")));
        assert.equal(route.letter.type, "none", "the renderer letters it by its label's first");
        assert.ok(keysEqual(route.queue, []));
        assert.equal(decisions.unqueue.type, "none");

        const queued = kindOf(Flowchart.Types.DecisionKind, ($) => Flowchart.decisions($.let(queuedRecord()), { label: (r) => r.name, queue: "queue" }).build(undefined, false));
        if (queued.unqueue.type !== "some") assert.fail("a queue takes a state out");
        const rule = encodeBeast2For(QueuedRule)({ name: "route", queue: ["ARV", "CH*"] });
        const out = queued.unqueue.value(rule, "ARV");
        if (out.type !== "some") assert.fail("ARV was queued");
        assert.ok(equalFor(QueuedRule)(decodeBeast2For(QueuedRule)(out.value), { name: "route", queue: ["CH*"] }));
        assert.equal(queued.unqueue.value(rule, "SRD").type, "none", "a key not queued: nothing to write");

        const setQueued = kindOf(Flowchart.Types.DecisionKind, ($) => Flowchart.decisions($.let(setRecord()), { label: (r) => r.name, queue: "queue" }).build(undefined, false));
        const setRows = setQueued.rows();
        if (setRows.type !== "some" || setQueued.unqueue.type !== "some") assert.fail("read whole, its queue a Set");
        assert.ok(keysEqual(setRows.value.get("route")!.roles.queue, ["ARV", "CH*"]));
        const fromSet = setQueued.unqueue.value(encodeBeast2For(SetRule)({ name: "route", queue: new Set(["ARV", "CH*"]) }), "CH*");
        if (fromSet.type !== "some") assert.fail("CH* was queued");
        assert.ok(equalFor(SetRule)(decodeBeast2For(SetRule)(fromSet.value), { name: "route", queue: new Set(["ARV"]) }));
    });
});

describe("the bakery's kinds, keyed as the bakery keys them (#1549)", () => {
    hostTest("each kind says its record's key type, and names its rows by their keys' text: the steps by number, the moves by their ends", () => {
        const steps = kindOf(Flowchart.Types.StateKind, ($) => Flowchart.states($.let(recordHandle(DictType(IntegerType, ex.BakeryStep),
            new Map([[10n, { name: "Mix", station: 1n, seq: 1, portion: variant("whole", null) }]]), "steps")()), { label: "name", order: "seq" }).build(undefined, false));
        assert.ok(isTypeEqual(fromEastTypeValue(steps.keyType), IntegerType));
        const stepRows = steps.rows();
        if (stepRows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(keysEqual([...stepRows.value.keys()], ["10"]), "a step's key as East prints it");
        const moves = kindOf(Flowchart.Types.TransitionKind, ($) => Flowchart.transitions($.let(recordHandle(DictType(ex.BakeryMoveKey, ex.BakeryMove),
            new SortedMap([[{ from: 10n, to: 20n }, { from: 10n, to: 20n, note: none }]], compareFor(ex.BakeryMoveKey)), "moves")()), {
            from: "from", to: "to", key: (move) => ({ from: move.from, to: move.to }),
        }).build(undefined, false));
        assert.ok(isTypeEqual(fromEastTypeValue(moves.keyType), ex.BakeryMoveKey));
        const moveRows = moves.rows();
        if (moveRows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(keysEqual([...moveRows.value.keys()], ["(from=10, to=20)"]), "a move's key as East prints its ends");
        const mixToProof = moveRows.value.get("(from=10, to=20)")!.roles;
        assert.ok(keysEqual([mixToProof.from, mixToProof.to], ["10", "20"]), "its ends as the steps' keys' text");
    });
});

// ============================================================================
// The payload, through its carrier
// ============================================================================

describe("<Flowchart>'s payload, through its carrier (R1)", () => {
    hostTest("the kinds it is given, each closed; the rest none; the inspector on, hiding what the narrowing leaves out, unnamed", () => {
        const payload = carried(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), { label: "name", lane: "phase", order: "seq" }),
            lanes: Flowchart.lanes($.let(lanesData()), { label: "label", order: "seq" }),
        }));
        assert.equal(payload.states.name, "State");
        assert.equal(payload.transitions.type, "none");
        assert.equal(payload.decisions.type, "none");
        if (payload.lanes.type !== "some") assert.fail("the lanes cross");
        assert.equal(payload.lanes.value.editable, false, "Data.bind: read only");
        assert.equal(payload.narrowed.type, "hide");
        assert.equal(payload.inspector, true);
        assert.ok(vocabularyEqual(payload.vocabulary, { planned: "Planned", observed: "Observed" }), "a transition's kinds in the Flowchart's own words");
        assert.equal(payload.readOnly, false);
        assert.equal(payload.name.type, "none");
        assert.equal(payload.slice.type, "none");
        assert.equal(payload.shown.size, 0);
        assert.equal(payload.library.length, 0);
        assert.equal(payload.canvas.orientation.type, "none");
        assert.ok(narrowEqual(payload.canvas.narrow, none));
    });

    hostTest("every kind, the inspector off, read only, dimmed and named; the canvas's options", () => {
        const payload = carried(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), { label: "name", lane: "phase", name: "Step", icon: "circle-nodes" }),
            transitions: Flowchart.transitions($.let(movesRecord()), { from: "src", to: "dst", decision: "trigger" }),
            lanes: Flowchart.lanes($.let(lanesData()), { label: "label" }),
            decisions: Flowchart.decisions($.let(decisionsRecord()), { label: (d) => d.name }),
            inspector: false, readOnly: true, narrowed: "dim", name: "depot", orientation: "TD", legend: true, narrow: { lanes: 1 },
            vocabulary: { planned: "Designed" },
        }));
        assert.equal(payload.states.name, "Step");
        assert.equal(payload.states.icon, "circle-nodes");
        assert.equal(payload.transitions.type, "some");
        assert.equal(payload.decisions.type, "some");
        assert.equal(payload.inspector, false);
        assert.ok(vocabularyEqual(payload.vocabulary, { planned: "Designed", observed: "Observed" }), "the app's word, and the default for the one it leaves out");
        assert.equal(payload.readOnly, true);
        assert.equal(payload.narrowed.type, "dim");
        assert.ok(optionString(payload.name, some("depot")));
        if (payload.canvas.orientation.type !== "some") assert.fail("the orientation crosses");
        assert.equal(payload.canvas.orientation.value.type, "TD");
        assert.ok(equalFor(OptionType(BooleanType))(payload.canvas.legend, some(true)));
        assert.ok(narrowEqual(payload.canvas.narrow, some({ lanes: some(1n) })));
        // Keyed by String, each kind says so: all a String-keyed Flowchart's payload gains (#1549).
        if (payload.transitions.type !== "some" || payload.lanes.type !== "some" || payload.decisions.type !== "some") assert.fail("every kind crosses");
        for (const keyType of [payload.states.keyType, payload.transitions.value.keyType, payload.lanes.value.keyType, payload.decisions.value.keyType]) {
            assert.ok(isTypeEqual(fromEastTypeValue(keyType), StringType));
        }
    });

    hostTest("the payload is one type whatever the rows hold: it crosses beast2 and back", () => {
        const payload = carried(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), { label: "name", lane: "phase", order: "seq" }),
            transitions: Flowchart.transitions($.let(movesRecord()), { from: "src", to: "dst" }),
            lanes: Flowchart.lanes($.let(stagesRecord()), { label: "label", order: "seq" }),
        }));
        const again = decodeBeast2For(FlowchartPayloadType)(encodeBeast2For(FlowchartPayloadType)(payload));
        assert.equal(again.states.name, payload.states.name);
        if (again.lanes.type !== "some") assert.fail("the lanes cross");
        assert.ok(isTypeEqual(fromEastTypeValue(again.lanes.value.rowType), Stage), "each kind carries its own row type");
    });
});

// ============================================================================
// The library's tabs (R14)
// ============================================================================

describe("the library's tabs (R14)", () => {
    /** The depot's kinds with their cards — the states', where `withCards` — each list following its source of the rail, and the library the test gives. */
    const depot = (library: ($: BlockBuilder<UIComponentType>) => unknown, withCards = true) => ($: BlockBuilder<UIComponentType>) => {
        const laneCardsSource = { source: Data.bindPaged(ex.laneCards, { indexes: ["flowchart_lane_cards_by_group"] }), fields: { group: { label: "Group" } } };
        const slice = withCards
            ? $.let(Slice.bindRecords("flowchart.spec.library", {
                stepCards: { source: Data.bindPaged(ex.stepCards, { indexes: ["flowchart_step_cards_by_group"] }), fields: { group: { label: "Group" } } },
                laneCards: laneCardsSource,
            }))
            : $.let(Slice.bindRecords("flowchart.spec.library.lanes", { laneCards: laneCardsSource }));
        const steps = $.const(STEP_CARDS, DictType(StringType, ex.StepCard));
        const laneRows = $.const(LANE_CARDS, DictType(StringType, ex.LaneCard));
        return PublicFlowchart({
            slice: { slice },
            states: Flowchart.states($.let(statesRecord()), {
                label: "name", lane: "phase", order: "seq",
                ...(withCards ? { templates: Flowchart.templates(steps, { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards" }) } : {}),
            }),
            lanes: Flowchart.lanes($.let(lanesRecord()), {
                label: "label", order: "seq",
                templates: Flowchart.templates(laneRows, { name: (c) => c.name, values: (c) => c.values, source: "laneCards" }),
            }),
            decisions: Flowchart.decisions($.let(decisionsRecord()), { label: (d) => d.name, owner: (d) => some(d.owner) }),
            library: library($) as never,
        });
    };
    const owners = ($: BlockBuilder<UIComponentType>) => $.const(OWNERS, DictType(StringType, ex.DecisionOwner));

    hostTest("each kind's tab, then an author's, in the order `library` lists them; an owner's card lands on a decision, setting its owner", () => {
        // The library's wire alone, built against the depot's kinds: a rail's sources are read only on e3, which e3-ui's specs never read.
        const tabs = East.compile(East.function([], ArrayType(FlowchartLibraryTabType), ($) => buildFlowchartLibrary([
            PublicFlowchart.library.states({ name: "Steps", icon: "shapes" }),
            PublicFlowchart.library.lanes(),
            PublicFlowchart.library.tab($.const(OWNERS, DictType(StringType, ex.DecisionOwner)), {
                name: "Owners", icon: "user-tie", label: (o) => o.name, meta: (o) => some(o.desk),
                drop: (o) => PublicFlowchart.patch(ex.DepotDecision, { owner: o.name }),
            }),
        ], {
            kinds: [
                { sort: "states", rowType: ex.DepotState, templates: true },
                { sort: "lanes", rowType: ex.DepotLane, templates: true },
                { sort: "decisions", rowType: ex.DepotDecision, templates: false },
            ],
            sources: [],
        })), [])();
        assert.ok(keysEqual(tabs.map((tab) => tab.type), ["states", "lanes", "tab"]));
        const tabEqual = equalFor(FlowchartLibraryTabType);
        assert.ok(tabEqual(tabs[0]!, variant("states", { name: some("Steps"), icon: some("shapes") })));
        assert.ok(tabEqual(tabs[1]!, variant("lanes", { name: none, icon: none })));
        const author = tabs[2]!;
        if (author.type !== "tab") assert.fail("the author's tab");
        assert.equal(author.value.name, "Owners");
        assert.ok(optionString(author.value.drop, some("decisions")), "its patch is over a decision's row: it lands on a decision");
        assert.equal(author.value.source.type, "none", "naming no source, it lists its rows whole");
        assert.ok(keysEqual(author.value.cards.map((card) => card.key), ["ns", "sp"]));
        const planner = author.value.cards[1]!;
        assert.equal(planner.label, "sort-planner");
        assert.ok(optionString(planner.meta, some("Sort office")));
        assert.equal(planner.sets.length, 1);
        assert.ok(keysEqual(planner.sets[0]!.path, ["owner"]));
        assert.equal(decodeBeast2For(StringType)(planner.sets[0]!.value), "sort-planner", "the owner it sets, as bytes at the field's type");
    });

    hostTest("the tabs build beside the kinds and the rail, each list following its source", () => {
        built(depot(($) => [
            PublicFlowchart.library.states(),
            PublicFlowchart.library.lanes({ name: "Columns" }),
            PublicFlowchart.library.tab(owners($), {
                name: "Owners", label: (o) => o.name, drop: (o) => PublicFlowchart.patch(ex.DepotDecision, { owner: o.name }),
            }),
        ]));
    });

    hostTest("each misuse refused, naming the change", () => {
        refused(() => built(depot(() => ["states"])),
            "Flowchart: `library` lists the library pane's tabs, in order, each a Flowchart.library.* call — states(), transitions(), lanes() or tab(rows, { … })");
        refused(() => built(depot(() => [PublicFlowchart.library.states(), PublicFlowchart.library.states()])),
            "Flowchart: the library lists Flowchart.library.states() twice — each tab once");
        refused(() => built(depot(() => [PublicFlowchart.library.transitions()])),
            "Flowchart: the library lists Flowchart.library.transitions(), and this Flowchart has no transitions — give transitions={Flowchart.transitions(record, { from, to, …, " +
            "templates: Flowchart.templates(cards.read(), { name, values, source }) })}");
        refused(() => built(depot(() => [PublicFlowchart.library.states()], false)),
            "Flowchart: the library lists Flowchart.library.states(), and the states have no cards — give them their cards: Flowchart.states(record, { label, …, " +
            "templates: Flowchart.templates(cards.read(), { name, values, source }) })");
        const tab = ($: BlockBuilder<UIComponentType>) => PublicFlowchart.library.tab(owners($), { name: "Owners", label: (o) => o.name });
        refused(() => built(depot(($) => [tab($), tab($)])), "Flowchart: the library lists two tabs named \"Owners\" — each tab's name is its own");
        refused(() => built(depot(($) => [PublicFlowchart.library.tab(owners($), {
            name: "Owners", label: (o) => o.name, drop: (o) => PublicFlowchart.patch(ex.DecisionOwner, { desk: o.desk }),
        })])), "Flowchart: the \"Owners\" tab's `drop` returns a patch over no kind's row type — build it with Flowchart.patch(RowType, { … }) " +
            "over the row type of the kind its cards land on (states, lanes, decisions)");
        refused(() => built(depot(($) => [PublicFlowchart.library.tab(owners($), { name: "Owners", label: (o) => o.name, source: "owners" })])),
            "Flowchart: the Owners tab's source 'owners' is not one of the slice's sources (stepCards, laneCards)");
        refused(() => built(depot(($) => [PublicFlowchart.library.tab($.const([...OWNERS.values()], ArrayType(ex.DecisionOwner)), {
            name: "Owners", label: (o) => o.name, source: "stepCards",
        })])), "Flowchart: the \"Owners\" tab follows the source 'stepCards' by its cards' keys, each a row's key in that record — " +
            "read its rows as that record's, a Dict, its binding's read(), never an Array keyed by index");
    });

    hostTest("a kind's tab takes at most its name and its icon: its cards are on the kind", () => {
        refused(() => PublicFlowchart.library.states({ label: "Steps" } as never),
            "Flowchart.library.states() lists the states' cards, which are on the kind — Flowchart.states(record, { label, …, " +
            "templates: Flowchart.templates(cards.read(), { name, values, source }) }) — and takes at most { name, icon } — `label` is neither");
        refused(() => PublicFlowchart.library.lanes({ name: "" }), "Flowchart.library.lanes(): `name` is the tab's name, a string");
        refused(() => PublicFlowchart.library.transitions({ icon: "" }), "Flowchart.library.transitions(): `icon` is a Font Awesome solid icon's name");
    });
});

// ============================================================================
// The details (#1507, R18–R21)
// ============================================================================

type EvidenceRow = ValueTypeOf<typeof ex.StateEvidence>;
type MoveEvidenceRow = ValueTypeOf<typeof ex.MoveEvidence>;
/** What the depot measured in its Hold state: the app's own row, keyed as the states are. */
const HELD: EvidenceRow = {
    flags: new Set(["Hazmat", "At risk", "Customs"]), equipment: new Set(["Scanner", "X-ray"]), shifts: new Set(["Early", "Late"]),
    parcels: 1080n, waiting: 70n,
    hours: [12n, 30n, 64n, 120n, 180n, 210n, 160n, 120n, 90n, 50n, 30n, 14n],
    service: new Map([["International", 539n], ["Standard", 335n], ["Priority", 130n], ["Economy", 76n]]),
    exceptions: new Map([["Missing documents", 412n], ["Duty unpaid", 236n]]),
    // No service's own figures: these details are read unweighed.
    byService: new Map(),
};
/** What it measured on the move out of Hold: keyed as the transitions are. */
const CLEARED: MoveEvidenceRow = {
    region: new Map([["Overseas", 727n], ["Metro", 141n]]),
    service: new Map([["International", 505n]]),
    origins: new Map([["Air hub", { parcels: 293n, late: 5n }], ["Rail yard", { parcels: 122n, late: 0n }]]),
};
/** The depot's bins, in hours: a quarter hour apiece at first, then hours, days and a week. */
const HOURS = [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24, 48, 96, 168];
/** A row of measures a figure reads: an Integer, an Option of one, and a Float. */
const Measures = StructType({ parcels: IntegerType, held: OptionType(IntegerType), share: FloatType });

const evidenceData = dataHandle(DictType(StringType, ex.StateEvidence), new Map([["HLD", HELD]]), "evidence");
const evidenceRecord = recordHandle(DictType(StringType, ex.StateEvidence), new Map([["HLD", HELD]]), "evidence");
const moveEvidenceData = dataHandle(DictType(StringType, ex.MoveEvidence), new Map([["l7", CLEARED]]), "moveEvidence");
const minutesData = dataHandle(DictType(StringType, ex.TicketMinutes), new Map([["NEW", { minutes: [140n, 96n, 120n, 64n, 30n, 22n, 9n, 4n, 2n, 1n, 0n, 0n] }]]), "minutes");
const measuresData = dataHandle(DictType(StringType, Measures), new Map([["HLD", { parcels: 1080n, held: some(70n), share: 0.5 }]]), "measures");
/** A Data.bindPaged handle over the evidence, as the paged binding gives one. */
const evidencePaged = East.function([], DataPagedHandleType(DictType(StringType, ex.StateEvidence)), (_$) => ({
    id: ".records.evidence",
    page: East.function([IntegerType, IntegerType], OptionType(DictType(StringType, ex.StateEvidence)), (_$2) => none),
    total: East.function([], OptionType(IntegerType), (_$2) => none),
    seek: none,
    revision: East.function([], OptionType(StringType), (_$2) => none),
    refresh: East.function([OptionType(StringType)], NullType, (_$2) => null),
}));
const evidenceBytes = encodeBeast2For(ex.StateEvidence);
const moveEvidenceBytes = encodeBeast2For(ex.MoveEvidence);
const minutesBytes = encodeBeast2For(ex.TicketMinutes);
const measuresBytes = encodeBeast2For(Measures);
const detailRowEqual = equalFor(Flowchart.Types.DetailRow);
const readsEqual = equalFor(Flowchart.Types.Details.fields.reads);
/** The tags' looks as the app keeps them: Flowchart.Types.TagColor rows, the first ranked first. */
const LOOKS = [
    { tag: "Hazmat", colorPalette: variant("danger", null), variant: variant("solid", null) },
    { tag: "At risk", colorPalette: variant("warning", null), variant: variant("subtle", null) },
] as const;

/** The details' type checks (R20, R21): never called — `tsc` checks what each line says. */
function detailsTypeChecks($: BlockBuilder<UIComponentType>): void {
    const states = $.let(Data.bind(ex.depotStates));
    const transitions = $.let(Data.bind(ex.depotTransitions));
    const stateRows = $.let(Data.bind(ex.stateEvidence));
    const moveRows = $.let(Data.bind(ex.moveEvidence));
    // What fits, as the examples write it: any mix of the four, each where its show says.
    PublicFlowchart.states(states, {
        label: "name",
        details: PublicFlowchart.details(stateRows, {
            details: [
                PublicFlowchart.figure("parcels", { label: "Parcels", unit: "parcels" }),
                PublicFlowchart.tags("flags", { label: "Flags", colors: { Hazmat: { colorPalette: "danger", variant: "solid" } }, legend: true }),
                PublicFlowchart.tags("shifts", { label: "Shifts", show: "inspector" }),
                PublicFlowchart.histogram("hours", { unit: "hours", label: "Time in state", bins: HOURS, ticks: [1, 12, 48, 168] }),
                PublicFlowchart.list("service", { label: "Service" }),
            ],
        }),
    });
    PublicFlowchart.transitions(transitions, {
        from: "src", to: "dst",
        details: PublicFlowchart.details(moveRows, {
            details: [
                PublicFlowchart.list("region", { label: "Region", top: 1 }),
                PublicFlowchart.list("origins", { label: "Origin", show: "inspector" }, (item) => ({ value: item.parcels })),
            ],
        }),
    });
    // A transition's tags and histograms in the inspector alone: its label draws lines.
    PublicFlowchart.transitions(transitions, { from: "src", to: "dst", details: PublicFlowchart.details(stateRows, { details: [PublicFlowchart.histogram("hours", { unit: "hours", bins: HOURS, show: "inspector" })] }) });
    // @ts-expect-error — `service` is keyed by a String: a histogram reads a Dict from a duration to its count — "hours" fits
    PublicFlowchart.details(stateRows, { details: [PublicFlowchart.histogram("service", { unit: "hours" })] });
    // @ts-expect-error — `hours` is an Array of counts: beside one, the bins are required
    PublicFlowchart.details(stateRows, { details: [PublicFlowchart.histogram("hours", { unit: "hours" })] });
    // @ts-expect-error — `service` is a Dict: tags read an Array or a Set of strings — "flags", "equipment", "shifts" fit
    PublicFlowchart.details(stateRows, { details: [PublicFlowchart.tags("service", { label: "Service" })] });
    // @ts-expect-error — `parcels` is an Integer: a list reads a Dict from an item's name
    PublicFlowchart.details(stateRows, { details: [PublicFlowchart.list("parcels")] });
    // @ts-expect-error — `top` is 1, 2 or 3: the inspector lists every item
    PublicFlowchart.details(moveRows, { details: [PublicFlowchart.list("region", { top: 5 })] });
    // @ts-expect-error — `colorPalette` is one of east-ui's colour schemes
    PublicFlowchart.details(stateRows, { details: [PublicFlowchart.tags("flags", { colors: { Hazmat: { colorPalette: "crimson" } } })] });
    // @ts-expect-error — "Only tags on the canvas go in the legend — show them on the canvas, or drop legend"
    PublicFlowchart.details(stateRows, { details: [PublicFlowchart.tags("shifts", { legend: true, show: "inspector" })] });
    // @ts-expect-error — "A transition's label draws lines: a figure or a list — give the histogram show: "inspector""
    PublicFlowchart.transitions(transitions, { from: "src", to: "dst", details: PublicFlowchart.details(stateRows, { details: [PublicFlowchart.histogram("hours", { unit: "hours", bins: HOURS })] }) });
    // @ts-expect-error — "… give the tags show: "inspector""
    PublicFlowchart.transitions(transitions, { from: "src", to: "dst", details: PublicFlowchart.details(stateRows, { details: [PublicFlowchart.tags("flags")] }) });
}

describe("the details: named, typed reads over the app's rows, read only and read as their kind is (R18–R21)", () => {
    /** The depot's states read whole, with the details given; what the tag builds, and what it refuses. */
    const whole = (details: ($: BlockBuilder<UIComponentType>) => unknown, props: object = {}) => () => built(($) => PublicFlowchart({
        states: Flowchart.states($.let(statesRecord()), { label: "name", details: details($) as never }),
        ...props,
    } as never));
    /** The depot's states read through their source of the slice, with the details given. */
    const sourced = (details: ($: BlockBuilder<UIComponentType>) => unknown) => () => built(($) => {
        const slice = $.let(Slice.bindRecords("flowchart.spec.details", { states: statesSource() }));
        return PublicFlowchart({ slice: { slice }, states: Flowchart.states($.let(Data.bindPaged(ex.depotStates)), { label: "name", details: details($) as never }) });
    });
    /** The depot's transitions with the details given, beside its states. */
    const moved = (details: ($: BlockBuilder<UIComponentType>) => unknown) => () => built(($) => PublicFlowchart({
        states: Flowchart.states($.let(statesRecord()), { label: "name" }),
        transitions: Flowchart.transitions($.let(movesRecord()), { from: "src", to: "dst", details: details($) as never }),
    }));
    const parcels = ($: BlockBuilder<UIComponentType>) => Flowchart.details($.let(evidenceData()), { details: [Flowchart.figure("parcels")] });

    hostTest("each read's misfit is a type error naming what fits, and the words where a type error would not say why", () => {
        assert.equal(typeof detailsTypeChecks, "function");
    });

    hostTest("the details are read only, and read as their kind is: whole beside a kind read whole, by key beside one read through its source (R18, R19)", () => {
        const READ_ONLY = "Flowchart.details: details are read only: bind them with Data.bind(record), or Data.bindPaged(record) beside a kind read through its source";
        refused(whole(($) => Flowchart.details($.let(evidenceRecord()), { details: [Flowchart.figure("parcels")] })), READ_ONLY);
        refused(whole(($) => Flowchart.details($.let(evidenceData()).read() as never, { details: [Flowchart.figure("parcels")] } as never)),
            `${READ_ONLY} — and this is ${printType(DictType(StringType, ex.StateEvidence))}`);
        refused(sourced(parcels),
            "Flowchart.states: the states are read through their source, so their details are read by key: bind them with Data.bindPaged(record)");
        refused(whole(($) => Flowchart.details($.let(evidencePaged()), { details: [Flowchart.figure("parcels")] })),
            "Flowchart.states: the states are read whole, so their details are read whole: bind them with Data.bind(record)");
        // Each form it takes builds: Data.bind beside a kind read whole, and Data.bindPaged beside one read through its source.
        whole(parcels)();
        sourced(($) => Flowchart.details($.let(Data.bindPaged(ex.stateEvidence)), { details: [Flowchart.figure("parcels")] }))();
    });

    hostTest("a kind's details are Flowchart.details', and every element of their array a read (R21)", () => {
        refused(whole(() => ({ details: [] })),
            "Flowchart.states: `details` takes Flowchart.details(binding, { details: [ … ] }) — the reads over the app's rows, keyed as the states are");
        refused(whole(($) => Flowchart.details($.let(evidenceData()), { details: [Flowchart.figure("parcels"), "waiting"] } as never)),
            "Flowchart.details: `details` holds reads — Flowchart.figure, .histogram, .list or .tags — and the 2nd is none");
    });

    hostTest("past a cast, a read naming a field the row lacks, or one of another type, names the fields that fit (R20)", () => {
        const read = (make: () => unknown) => whole(($) => Flowchart.details($.let(evidenceData()), { details: [make()] } as never));
        refused(read(() => Flowchart.figure("dwell" as never)),
            "Flowchart.figure: \"dwell\" is no field of the details' row (flags, equipment, shifts, parcels, waiting, hours, service, exceptions, byService)");
        refused(read(() => Flowchart.histogram("service" as never, { unit: "hours" } as never)),
            `Flowchart.histogram: "service" holds ${printType(DictType(StringType, IntegerType))} — a histogram reads a Dict from a duration to its count, both numbers, ` +
            "or an Array of counts beside its bins: \"hours\"");
        refused(read(() => Flowchart.tags("service" as never)),
            `Flowchart.tags: "service" holds ${printType(DictType(StringType, IntegerType))} — tags read an Array or a Set of strings: "flags", "equipment", "shifts"`);
        refused(read(() => Flowchart.histogram("hours", { unit: "hours" } as never)),
            "Flowchart.histogram: \"hours\" is an Array of counts — give the bins it counts in, bins: [0, …]");
        refused(() => built(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), { label: "name" }),
            transitions: Flowchart.transitions($.let(movesRecord()), {
                from: "src", to: "dst", details: Flowchart.details($.let(moveEvidenceData()), { details: [Flowchart.list("origins", { label: "Origin" })] }),
            }),
        })), "Flowchart.list: \"origins\" holds structs — give a draw, (item) => ({ value: item.parcels })");
    });

    hostTest("what only the read shows is refused as it is made: the bins' order, the looks, the lines and the legend", () => {
        refused(() => Flowchart.histogram("hours", { unit: "hours", bins: [0, 12, 4] }), "Flowchart.histogram: the bins' edges ascend — 12, then 4");
        refused(() => Flowchart.tags("flags", { colors: { Hazmat: { colorPalette: "crimson" } } } as never),
            "Flowchart.tags: \"Hazmat\"'s colorPalette is one of east-ui's colour schemes — \"danger\", \"red\", \"brand\", … — and this is \"crimson\"");
        refused(() => Flowchart.list("region", { top: 5 } as never), "Flowchart.list: `top` is 1, 2 or 3 — the inspector lists every item");
        refused(() => Flowchart.tags("shifts", { legend: true, show: "inspector" }),
            "Flowchart.tags: only tags on the canvas go in the legend — show them on the canvas, or drop legend");
    });

    hostTest("a transition's label draws figures and lists, three lines at most under its evidence (R21)", () => {
        refused(moved(($) => Flowchart.details($.let(evidenceData()), { details: [Flowchart.histogram("hours", { unit: "hours", bins: HOURS })] } as never)),
            "Flowchart.transitions: a transition's label draws lines: a figure or a list — give the histogram show: \"inspector\"");
        refused(moved(($) => Flowchart.details($.let(evidenceData()), { details: [Flowchart.tags("flags")] } as never)),
            "Flowchart.transitions: a transition's label draws lines: a figure or a list — give the tags show: \"inspector\"");
        refused(moved(($) => Flowchart.details($.let(moveEvidenceData()), {
            details: [Flowchart.list("region", { top: 2 }), Flowchart.list("service", { top: 2 })],
        })), "Flowchart.transitions: a transition's label draws three lines at most under its evidence, and these draw 4 — give one show: \"inspector\", or lower its top");
        // Three lines fit, and a read in the inspector alone draws none.
        moved(($) => Flowchart.details($.let(moveEvidenceData()), {
            details: [Flowchart.list("region", { top: 2 }), Flowchart.list("service"), Flowchart.list("origins", { show: "inspector" }, (o) => ({ value: o.parcels }))],
        }))();
    });

    hostTest("a read shown in the inspector alone needs the inspector's pane", () => {
        const shifts = ($: BlockBuilder<UIComponentType>) => Flowchart.details($.let(evidenceData()), { details: [Flowchart.tags("shifts", { show: "inspector" })] });
        refused(whole(shifts, { inspector: false }), "Flowchart: the inspector's reads have no pane — drop inspector={false}, or show them on the canvas");
        whole(shifts)();
        whole(($) => Flowchart.details($.let(evidenceData()), { details: [Flowchart.tags("shifts", { show: "canvas" })] }), { inspector: false })();
    });

    hostTest("the tag colour example's reads cross: the app's looks, first defined first shown, and the legend; a row's tags (R30, R31)", () => {
        const details = kindOf(Flowchart.Types.Details, ($) => {
            const looks = $.const(LOOKS as never, ArrayType(Flowchart.Types.TagColor));
            return Flowchart.details($.let(evidenceData()), {
                details: [
                    Flowchart.tags("flags", { label: "Flags", colors: looks, legend: true }),
                    // A literal: each tag's look as a Tag takes it, subtle unless given.
                    Flowchart.tags("equipment", { colors: { "X-ray": { colorPalette: "brand", variant: "outline" }, Scanner: { colorPalette: "neutral" } } }),
                ],
            }).build("states", "Flowchart.states", false);
        });
        assert.ok(readsEqual(details.reads, [
            { show: variant("all", null), read: variant("tags", { label: "Flags", colors: [...LOOKS], legend: true }) },
            { show: variant("all", null), read: variant("tags", {
                label: "equipment",
                colors: [
                    { tag: "X-ray", colorPalette: variant("brand", null), variant: variant("outline", null) },
                    { tag: "Scanner", colorPalette: variant("neutral", null), variant: variant("subtle", null) },
                ],
                legend: false,
            }) },
        ]));
        if (details.rows.type !== "some") assert.fail("read whole beside a kind read whole");
        const rows = details.rows.value();
        if (rows.type !== "some") assert.fail("the details' rows, by key");
        assert.ok(keysEqual([...rows.value.keys()], ["HLD"]));
        assert.equal(details.paged.type, "none");
        // A Set's tags in its order; the renderer draws them in the order their looks are defined.
        assert.ok(detailRowEqual(details.values(rows.value.get("HLD")!), [
            variant("tags", ["At risk", "Customs", "Hazmat"]),
            variant("tags", ["Scanner", "X-ray"]),
        ]));
    });

    hostTest("the bins example's reads cross: the app's bins, its scale and its ticks; each count at its bin's edge (R26–R28)", () => {
        const details = kindOf(Flowchart.Types.Details, ($) => Flowchart.details($.let(minutesData()), {
            details: [Flowchart.histogram("minutes", {
                unit: "minutes", label: "Time in state", counts: "tickets",
                bins: [0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440], scale: "band",
                ticks: [5, 60, { at: 480, label: "a shift" }, { at: 1440, label: "a day" }],
            })],
        }).build("states", "Flowchart.states", false));
        const bins = [0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440];
        assert.ok(readsEqual(details.reads, [{
            show: variant("all", null),
            read: variant("histogram", {
                label: "Time in state", unit: variant("minutes", null), counts: some("tickets"), bins: some(bins), scale: variant("band", null),
                ticks: some([{ at: 5, label: none }, { at: 60, label: none }, { at: 480, label: some("a shift") }, { at: 1440, label: some("a day") }]),
            }),
        }]));
        const counts = [140n, 96n, 120n, 64n, 30n, 22n, 9n, 4n, 2n, 1n, 0n, 0n];
        assert.ok(detailRowEqual(details.values(minutesBytes({ minutes: counts })),
            [variant("histogram", counts.map((count, i) => ({ from: bins[i]!, count: Number(count) })))]));
        // The same bins drawn to scale, as the to-scale example draws them: the scale crosses as the app gives it.
        const toScale = kindOf(Flowchart.Types.Details, ($) => Flowchart.details($.let(minutesData()), {
            details: [Flowchart.histogram("minutes", { unit: "minutes", label: "Time in state", counts: "tickets", bins, scale: "linear" })],
        }).build("states", "Flowchart.states", false));
        assert.ok(readsEqual(toScale.reads, [{
            show: variant("all", null),
            read: variant("histogram", {
                label: "Time in state", unit: variant("minutes", null), counts: some("tickets"), bins: some(bins), scale: variant("linear", null), ticks: none,
            }),
        }]));
        // Another number of counts than bins: each at NaN, which no bin holds — the renderer lists the row in Issues and draws its bars absent.
        assert.ok(detailRowEqual(details.values(minutesBytes({ minutes: [3n, 4n] })),
            [variant("histogram", [{ from: NaN, count: 3 }, { from: NaN, count: 4 }])]));
        assert.ok(detailRowEqual(details.values(minutesBytes({ minutes: [] })), [variant("histogram", [{ from: NaN, count: 0 }])]));
    });

    hostTest("a figure reads a number or an Option of one, as a Float; a list a Dict, through its draw for structs; labels and lines unless given", () => {
        const figures = kindOf(Flowchart.Types.Details, ($) => Flowchart.details($.let(measuresData()), {
            details: [Flowchart.figure("parcels", { label: "Parcels", unit: "parcels" }), Flowchart.figure("held"), Flowchart.figure("share", { show: "canvas" })],
        }).build("states", "Flowchart.states", false));
        assert.ok(readsEqual(figures.reads, [
            { show: variant("all", null), read: variant("figure", { label: "Parcels", unit: some("parcels") }) },
            { show: variant("all", null), read: variant("figure", { label: "held", unit: none }) },
            { show: variant("canvas", null), read: variant("figure", { label: "share", unit: none }) },
        ]));
        assert.ok(detailRowEqual(figures.values(measuresBytes({ parcels: 1080n, held: some(70n), share: 0.5 })),
            [variant("figure", some(1080)), variant("figure", some(70)), variant("figure", some(0.5))]));
        assert.ok(detailRowEqual(figures.values(measuresBytes({ parcels: 0n, held: none, share: 0 })),
            [variant("figure", some(0)), variant("figure", none), variant("figure", some(0))]));

        const lists = (noun: "states" | "transitions") => kindOf(Flowchart.Types.Details, ($) => Flowchart.details($.let(moveEvidenceData()), {
            details: [
                Flowchart.list("region", { label: "Region", unit: "parcels" }),
                Flowchart.list("origins", { label: "Origin", show: "inspector" }, (o) => ({
                    value: o.parcels,
                    note: East.equal(o.late, 0n).ifElse((_$) => East.value(none, OptionType(StringType)), (_$) => East.value(some(East.str`${o.late} late`), OptionType(StringType))),
                })),
            ],
        }).build(noun, `Flowchart.${noun}`, false));
        const onCard = lists("states");
        const onLabel = lists("transitions");
        assert.ok(readsEqual(onCard.reads, [
            { show: variant("all", null), read: variant("list", { label: "Region", unit: some("parcels"), top: 2n }) },
            { show: variant("inspector", null), read: variant("list", { label: "Origin", unit: none, top: 2n }) },
        ]), "a card draws a list's top 2 unless given");
        assert.ok(readsEqual(onLabel.reads, [
            { show: variant("all", null), read: variant("list", { label: "Region", unit: some("parcels"), top: 1n }) },
            { show: variant("inspector", null), read: variant("list", { label: "Origin", unit: none, top: 1n }) },
        ]), "a label its top 1");
        assert.ok(detailRowEqual(onCard.values(moveEvidenceBytes(CLEARED)), [
            variant("list", [{ name: "Metro", value: 141, note: none }, { name: "Overseas", value: 727, note: none }]),
            variant("list", [{ name: "Air hub", value: 293, note: some("5 late") }, { name: "Rail yard", value: 122, note: none }]),
        ]));
    });

    hostTest("the payload carries each kind's details: their reads and their rows read as the kind is; a kind without them, none (R19)", () => {
        const payload = carried(($) => PublicFlowchart({
            states: Flowchart.states($.let(statesRecord()), {
                label: "name", details: Flowchart.details($.let(evidenceData()), { details: [Flowchart.figure("parcels"), Flowchart.list("service")] }),
            }),
            transitions: Flowchart.transitions($.let(movesRecord()), { from: "src", to: "dst" }),
        }));
        if (payload.states.details.type !== "some") assert.fail("the states' details cross");
        assert.equal(payload.states.details.value.reads.length, 2);
        assert.equal(payload.states.details.value.rows.type, "some", "read whole, beside the states read whole");
        if (payload.transitions.type !== "some") assert.fail("the transitions cross");
        assert.equal(payload.transitions.value.details.type, "none", "no details: today's labels");
        // By key beside a kind read through its source: the paged read named, every drawn key asked of it in one request.
        const paged = kindOf(Flowchart.Types.Details, ($) => Flowchart.details($.let(evidencePaged()), { details: [Flowchart.figure("parcels")] })
            .build("states", "Flowchart.states", true));
        assert.equal(paged.rows.type, "none");
        assert.ok(optionString(paged.paged, some(".records.evidence")));
        assert.ok(detailRowEqual(paged.values(evidenceBytes(HELD)), [variant("figure", some(1080))]));
    });

    hostTest("the reads and the tags' look are on the public namespace", () => {
        for (const member of ["details", "figure", "histogram", "list", "tags"] as const) assert.equal(typeof PublicFlowchart[member], "function", `Flowchart.${member}`);
        assert.ok(isTypeEqual(PublicFlowchart.Types.TagColor, Flowchart.Types.TagColor));
    });
});

// ============================================================================
// The Flow types are gone (R1)
// ============================================================================

describe("nothing of the Flow types is left in the package (R1)", () => {
    hostTest("no export, member or type of the flows", () => {
        const FLOWS = /^Flowchart(Flows?|State|Link|Lane|Trigger|Source|Data|Window|Apply|Over|Values?)(Type)?$|^FlowchartFlowsTab$|^FlowchartOneFlowLibraryTab$/;
        assert.ok(keysEqual(Object.keys(E3UI).filter((name) => FLOWS.test(name)), []));
        assert.ok(keysEqual(Object.keys(E3UIInternal).filter((name) => FLOWS.test(name)), []));
        for (const member of ["over", "values", "value"]) assert.equal(member in PublicFlowchart, false, `Flowchart.${member} is gone`);
        for (const type of ["Flows", "Flow", "State", "Link", "Lane", "Trigger"]) {
            assert.equal(type in PublicFlowchart.Types, false, `Flowchart.Types.${type} is gone`);
            assert.equal(type in Flowchart.Types, false, `the internal Flowchart.Types.${type} is gone`);
        }
        assert.ok(keysEqual(Object.keys(PublicFlowchart.library).sort(), ["lanes", "states", "tab", "transitions"]), "no Flows tab");
    });
});
