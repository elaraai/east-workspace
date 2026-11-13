/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart over records keyed by any key type (#1549): a bakery's line — its steps and its stations keyed by
 * number, each move keyed by the two steps it joins, its rules keyed by number — and a day's batches keyed by when each
 * went in, standing in the shifts they run in, each shift keyed by when it starts.
 *
 * - Each kind says its record's key type on the wire, and every key travels as its text: a String key as itself, any
 *   other as East prints it.
 * - A role naming another kind's row holds that kind's key: a kind's roles print it, and its writes read its text back
 *   at the field's type, refusing a text no key prints as.
 * - An accessor, a card and the details hear a key at its own type, the details keyed as their kind is.
 * - A row made with no card takes its own fields from its kind's `values` of what the gesture decided of it.
 * - A kind's `key` builds a new row's key from its row, held to the record's key type; an editable kind of rows whose key
 *   is never typed, keyed by neither String nor Integer, needs it.
 * - Each role is a field of a type a Dict may be keyed by, checked when the code compiles; where both kinds are known,
 *   the Flowchart checks it against the other kind's key type, refusing a mismatch by the role, the field, both kinds
 *   and both types.
 * - The rail's sources may be over records keyed by any type: a kind read through its source, its cards and a tab.
 *
 * e3-ui's specs read and write no e3: each record a kind reads is a handle as `Data.bind` gives one.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, printFor, printType, some, variant,
    type BlockBuilder, type ExprType,
} from "@elaraai/east";
import { Slice, UIComponentType } from "@elaraai/east-ui";
import { DatasetStatusType } from "@elaraai/e3-types";
import e3 from "@elaraai/e3";
import { Data, DataBindHandleType, Flowchart as PublicFlowchart, Record } from "@elaraai/e3-ui";
import { Flowchart, FlowchartPayloadType } from "@elaraai/e3-ui/internal";

// ============================================================================
// The bakery's records, and a day's batches
// ============================================================================

/** A step of the line: what its card calls it, its station by the station's number, its place there, and its note. */
const Step = StructType({ name: StringType, station: IntegerType, seq: FloatType, note: StringType });
/** A station, the line's column: its header, its place, and its crew. */
const Station = StructType({ label: StringType, seq: FloatType, crew: IntegerType });
/** A move's key: the two steps it joins. */
const MoveKey = StructType({ from: IntegerType, to: IntegerType });
/** A move between two steps, by their numbers, and the rule that governs it, by its number. */
const Move = StructType({ from: IntegerType, to: IntegerType, rule: OptionType(IntegerType), note: OptionType(StringType) });
/** A rule, and the steps queued at it by their numbers. */
const Rule = StructType({ name: StringType, queue: SetType(IntegerType) });
/** A rule whose queue names its steps by their names. */
const TaggedRule = StructType({ name: StringType, queue: SetType(StringType) });
/** A move whose rule is named by text, and whose count is a plain number: neither names a rule by its number. */
const Slip = StructType({ from: IntegerType, to: IntegerType, rule: StringType, count: IntegerType });
/** A crate of slots: a list is no key. */
const Crate = StructType({ name: StringType, slots: ArrayType(IntegerType) });
/** A step's card: its name, its group, and the fields a card dropped on a station gives the step. */
const StepCard = StructType({ name: StringType, group: StringType, values: StructType({ name: StringType, note: StringType }) });
/** What the line baked at each step: keyed as the steps are. */
const Yield = StructType({ loaves: IntegerType });
/** A bay of the line, placed among the bays by a whole number. */
const Bay = StructType({ label: StringType, seq: IntegerType, crew: IntegerType });
/** A batch, by the shift it runs in — by when the shift starts — and a shift, keyed by when it starts. */
const Batch = StructType({ name: StringType, shift: DateTimeType });
const Shift = StructType({ label: StringType });

const Steps = DictType(IntegerType, Step);
const Stations = DictType(IntegerType, Station);
const Moves = DictType(MoveKey, Move);
const Rules = DictType(IntegerType, Rule);
const Yields = DictType(IntegerType, Yield);
const Batches = DictType(DateTimeType, Batch);
const Shifts = DictType(DateTimeType, Shift);

/** The records the build-time checks bind, as an app declares them: each refusal is made where the surface is built. */
const lineSteps = e3.record("flowchart_keys_spec_steps", Steps, {
    initial: new Map(),
    indexes: (index) => ({ flowchart_keys_spec_steps_by_station: index.on(["station"]) }),
});
const namedSteps = e3.record("flowchart_keys_spec_named_steps", DictType(StringType, Step), { initial: new Map() });
const lineStations = e3.record("flowchart_keys_spec_stations", Stations, { initial: new Map() });
const namedStations = e3.record("flowchart_keys_spec_named_stations", DictType(StringType, Station), { initial: new Map() });
const lineMoves = e3.record("flowchart_keys_spec_moves", Moves, { initial: new SortedMap([], compareFor(MoveKey)) });
const editedMoves = e3.record("flowchart_keys_spec_edited_moves", Moves, {
    initial: new SortedMap([], compareFor(MoveKey)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
const slipMoves = e3.record("flowchart_keys_spec_slips", DictType(MoveKey, Slip), { initial: new SortedMap([], compareFor(MoveKey)) });
const lineRules = e3.record("flowchart_keys_spec_rules", Rules, { initial: new Map() });
const namedRules = e3.record("flowchart_keys_spec_named_rules", DictType(StringType, Rule), { initial: new Map() });
const taggedRules = e3.record("flowchart_keys_spec_tagged_rules", DictType(IntegerType, TaggedRule), { initial: new Map() });
const lineCrates = e3.record("flowchart_keys_spec_crates", DictType(IntegerType, Crate), { initial: new Map() });
const lineYields = e3.record("flowchart_keys_spec_yields", Yields, { initial: new Map() });
const namedYields = e3.record("flowchart_keys_spec_named_yields", DictType(StringType, Yield), { initial: new Map() });
const lineCards = e3.record("flowchart_keys_spec_cards", DictType(IntegerType, StepCard), {
    initial: new Map(),
    indexes: (index) => ({ flowchart_keys_spec_cards_by_group: index.on(["group"]) }),
});

const stepBytes = encodeBeast2For(Step);
const stepOf = decodeBeast2For(Step);
const stepEqual = equalFor(Step);
const moveBytes = encodeBeast2For(Move);
const moveOf = decodeBeast2For(Move);
const moveEqual = equalFor(Move);
const stationOf = decodeBeast2For(Station);
const stationEqual = equalFor(Station);
const ruleBytes = encodeBeast2For(Rule);
const ruleOf = decodeBeast2For(Rule);
const ruleEqual = equalFor(Rule);
const batchBytes = encodeBeast2For(Batch);
const batchOf = decodeBeast2For(Batch);
const batchEqual = equalFor(Batch);
const textsEqual = equalFor(ArrayType(StringType));
const optionText = equalFor(OptionType(StringType));
const optionFloat = equalFor(OptionType(FloatType));
const optionInteger = equalFor(OptionType(IntegerType));
const detailRowEqual = equalFor(Flowchart.Types.DetailRow);
const moveText = printFor(MoveKey);
const timeText = printFor(DateTimeType);

/** When the day's two shifts start, and when each batch went in. */
const EARLY = new Date("2026-11-07T05:00:00.000Z");
const LATE = new Date("2026-11-07T13:00:00.000Z");
const FIRST = new Date("2026-11-07T05:30:00.000Z");
const SECOND = new Date("2026-11-07T14:10:00.000Z");

/** Whether `build` throws an Error whose message is `message`, exactly. */
function refused(build: () => void, message: string): void {
    assert.throws(build, (error: unknown) => {
        assert.ok(error instanceof Error, "an Error");
        assert.equal(error.message, message);
        return true;
    });
}

// ============================================================================
// The bakery's line, through its carrier
// ============================================================================

describe("the bakery's line: each kind keyed by its own type, every key as its text (#1549)", () => {
    /** The bakery's Flowchart, built over handles as `Data.bind` gives them, and read back from its carrier's bytes. */
    const bakery = (() => {
        const ui = East.compile(East.function([], UIComponentType, ($) => {
            const stepRows = $.const(new SortedMap([
                [2n, { name: "Weigh", station: 1n, seq: 1, note: "" }],
                [9n, { name: "Proof", station: 1n, seq: 2, note: "" }],
                [10n, { name: "Mix", station: 2n, seq: 1, note: "By hand" }],
            ], compareFor(IntegerType)), Steps);
            const steps = $.let({
                read: East.function([], Steps, (_$2) => stepRows),
                write: East.function([Steps], NullType, (_$2) => null),
                writeAndStart: East.function([Steps], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Steps, (_$2) => stepRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "steps")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Steps));
            const yieldRows = $.const(new SortedMap([[2n, { loaves: 40n }], [10n, { loaves: 36n }]], compareFor(IntegerType)), Yields);
            const yields = $.let({
                read: East.function([], Yields, (_$2) => yieldRows),
                write: East.function([Yields], NullType, (_$2) => null),
                writeAndStart: East.function([Yields], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Yields, (_$2) => yieldRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "yields")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Yields));
            const moveRows = $.const(new SortedMap([
                [{ from: 2n, to: 9n }, { from: 2n, to: 9n, rule: some(1n), note: none }],
                [{ from: 9n, to: 10n }, { from: 9n, to: 10n, rule: none, note: some("Proofed") }],
            ], compareFor(MoveKey)), Moves);
            const moves = $.let({
                read: East.function([], Moves, (_$2) => moveRows),
                write: East.function([Moves], NullType, (_$2) => null),
                writeAndStart: East.function([Moves], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Moves, (_$2) => moveRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "moves")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Moves));
            const stationRows = $.const(new SortedMap([
                [1n, { label: "Bench", seq: 1, crew: 2n }],
                [2n, { label: "Oven", seq: 2, crew: 1n }],
            ], compareFor(IntegerType)), Stations);
            const stations = $.let({
                read: East.function([], Stations, (_$2) => stationRows),
                write: East.function([Stations], NullType, (_$2) => null),
                writeAndStart: East.function([Stations], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Stations, (_$2) => stationRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "stations")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Stations));
            const ruleRows = $.const(new SortedMap([[1n, { name: "Proof first", queue: new Set([9n, 10n]) }]], compareFor(IntegerType)), Rules);
            const rules = $.let({
                read: East.function([], Rules, (_$2) => ruleRows),
                write: East.function([Rules], NullType, (_$2) => null),
                writeAndStart: East.function([Rules], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Rules, (_$2) => ruleRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "rules")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Rules));
            return PublicFlowchart({
                states: Flowchart.states(steps, {
                    label: "name", lane: "station", order: "seq",
                    // The step's own number: an accessor hears its key at the record's key type.
                    members: (_step, key) => some(key),
                    // A step made with no card: its note says where it was added, from the station the gesture names.
                    values: (made) => ({ note: made.lane.match({ none: (_$2) => East.value("Added", StringType), some: (_$2, station) => East.str`Added at station ${station}` }) }),
                    details: Flowchart.details(yields, { details: [Flowchart.figure("loaves", { label: "Loaves" })] }),
                }),
                transitions: Flowchart.transitions(moves, {
                    from: "from", to: "to", decision: "rule",
                    // A move's key is the two steps it joins.
                    key: (move) => ({ from: move.from, to: move.to }),
                    // A move drawn on the canvas: its note names the step it was drawn from.
                    values: (made) => ({
                        note: made.from.match({
                            none: (_$2) => East.value(none, OptionType(StringType)),
                            some: (_$2, step) => East.value(some(East.str`Drawn from step ${step}`), OptionType(StringType)),
                        }),
                    }),
                }),
                lanes: Flowchart.lanes(stations, { label: "label", order: "seq", values: (_made) => ({ crew: 2n }) }),
                decisions: Flowchart.decisions(rules, { label: (rule) => rule.name, queue: "queue" }),
            });
        }), [])();
        if (ui.type !== "Extension") assert.fail(`expected the Flowchart extension, got the ${ui.type} arm`);
        return decodeBeast2For(FlowchartPayloadType)(ui.value.payload);
    })();

    test("each kind says its record's key type on the wire", () => {
        if (bakery.transitions.type !== "some" || bakery.lanes.type !== "some" || bakery.decisions.type !== "some") assert.fail("every kind crosses");
        assert.ok(isTypeEqual(fromEastTypeValue(bakery.states.keyType), IntegerType));
        assert.ok(isTypeEqual(fromEastTypeValue(bakery.transitions.value.keyType), MoveKey));
        assert.ok(isTypeEqual(fromEastTypeValue(bakery.lanes.value.keyType), IntegerType));
        assert.ok(isTypeEqual(fromEastTypeValue(bakery.decisions.value.keyType), IntegerType));
        // And the payload is one type whatever the keys: it crosses beast2 and back.
        const again = decodeBeast2For(FlowchartPayloadType)(encodeBeast2For(FlowchartPayloadType)(bakery));
        assert.ok(isTypeEqual(fromEastTypeValue(again.states.keyType), IntegerType));
    });

    test("the steps: each by its number's text, its station's number as its text, its accessor hearing its own number", () => {
        const rows = bakery.states.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        // Text order on the wire: the renderer orders them by their type.
        assert.ok(textsEqual([...rows.value.keys()], ["10", "2", "9"]));
        const proof = rows.value.get("9")!;
        assert.equal(proof.roles.label, "Proof");
        assert.ok(optionText(proof.roles.lane, some("1")));
        assert.ok(optionFloat(proof.roles.order, some(2)));
        assert.ok(optionInteger(proof.roles.members, some(9n)));
        assert.ok(stepEqual(stepOf(proof.row), { name: "Proof", station: 1n, seq: 2, note: "" }), "the row crosses whole");
        // A drafted step's roles, from its key's text.
        assert.ok(optionInteger(bakery.states.read(stepBytes({ name: "Shape", station: 2n, seq: 3, note: "" }), "41").members, some(41n)));
    });

    test("a step's write reads its station's text back at the station field's type, and refuses a text no station's key prints as", () => {
        const moved = bakery.states.write(stepBytes({ name: "Weigh", station: 1n, seq: 1, note: "" }), { label: none, lane: some("2"), order: some(1.5) });
        if (moved.type !== "some") assert.fail("a step moves to station 2");
        assert.ok(stepEqual(stepOf(moved.value), { name: "Weigh", station: 2n, seq: 1.5, note: "" }));
        assert.equal(bakery.states.write(stepBytes({ name: "Weigh", station: 1n, seq: 1, note: "" }), { label: none, lane: some("Oven"), order: none }).type, "none",
            "\"Oven\" is no station's number");
    });

    test("a new step: a card's values, or with none the kind's values of what the gesture decided", () => {
        const added = bakery.states.create({ label: some("Shape"), lane: some("2"), order: some(3) }, none);
        if (added.type !== "some") assert.fail("+ STATE makes a step");
        assert.ok(stepEqual(stepOf(added.value), { name: "Shape", station: 2n, seq: 3, note: "Added at station 2" }));
        assert.equal(bakery.states.create({ label: some("Shape"), lane: some("the oven"), order: some(3) }, none).type, "none", "a station named by no number's text");
    });

    test("the moves: each by its two ends as East prints them, its ends and its rule as their keys' text", () => {
        if (bakery.transitions.type !== "some") assert.fail("the moves cross");
        const rows = bakery.transitions.value.rows();
        if (rows.type !== "some") assert.fail("read whole");
        const weighToProof = moveText({ from: 2n, to: 9n });
        assert.equal(weighToProof, "(from=2, to=9)");
        assert.ok(textsEqual([...rows.value.keys()], [weighToProof, moveText({ from: 9n, to: 10n })]));
        const first = rows.value.get(weighToProof)!.roles;
        assert.equal(first.from, "2");
        assert.equal(first.to, "9");
        assert.ok(optionText(first.decision, some("1")));
        assert.equal(rows.value.get(moveText({ from: 9n, to: 10n }))!.roles.decision.type, "none");
    });

    test("a move's `key` builds a new move's key from its row, as East prints its two ends; the steps give none", () => {
        if (bakery.transitions.type !== "some") assert.fail("the moves cross");
        const rowKey = bakery.transitions.value.rowKey;
        if (rowKey.type !== "some") assert.fail("the moves give `key`");
        assert.equal(rowKey.value(moveBytes({ from: 10n, to: 2n, rule: none, note: none })), moveText({ from: 10n, to: 2n }));
        assert.equal(bakery.states.rowKey.type, "none", "an Integer key is one past the largest");
    });

    test("a move's write reads its ends and its rule back at their types; a rule's Del clears it; a text no key prints as is refused", () => {
        if (bakery.transitions.type !== "some") assert.fail("the moves cross");
        const moves = bakery.transitions.value;
        const weighToProof = { from: 2n, to: 9n, rule: some(1n), note: none };
        const retargeted = moves.write(moveBytes(weighToProof), { from: none, to: some("10"), decision: some(some("2")) });
        if (retargeted.type !== "some") assert.fail("a move takes its end and its rule");
        assert.ok(moveEqual(moveOf(retargeted.value), { from: 2n, to: 10n, rule: some(2n), note: none }));
        const cleared = moves.write(moveBytes(weighToProof), { from: none, to: none, decision: some(none) });
        if (cleared.type !== "some") assert.fail("a move's rule clears");
        assert.ok(moveEqual(moveOf(cleared.value), { ...weighToProof, rule: none }));
        assert.equal(moves.write(moveBytes(weighToProof), { from: none, to: some("ten"), decision: none }).type, "none", "\"ten\" is no step's number");
        assert.equal(moves.write(moveBytes(weighToProof), { from: none, to: none, decision: some(some("first")) }).type, "none", "\"first\" is no rule's number");
    });

    test("Connect: a new move's own fields from the kind's values of its ends", () => {
        if (bakery.transitions.type !== "some") assert.fail("the moves cross");
        const connected = bakery.transitions.value.create({ from: some("10"), to: some("2"), decision: none }, none);
        if (connected.type !== "some") assert.fail("Connect makes a move");
        assert.ok(moveEqual(moveOf(connected.value), { from: 10n, to: 2n, rule: none, note: some("Drawn from step 10") }));
    });

    test("the stations: by their numbers' text; + LANE's own fields from the kind's values", () => {
        if (bakery.lanes.type !== "some") assert.fail("the stations cross");
        const rows = bakery.lanes.value.rows();
        if (rows.type !== "some") assert.fail("read whole");
        assert.ok(textsEqual([...rows.value.keys()], ["1", "2"]));
        const added = bakery.lanes.value.create({ label: some("Cooling"), order: some(3) }, none);
        if (added.type !== "some") assert.fail("+ LANE makes a station");
        assert.ok(stationEqual(stationOf(added.value), { label: "Cooling", seq: 3, crew: 2n }));
    });

    test("the rules: their queues' steps as their numbers' text; a step's Del reads its number back, and refuses a text no step's number prints as", () => {
        if (bakery.decisions.type !== "some") assert.fail("the rules cross");
        const rules = bakery.decisions.value;
        const rows = rules.rows();
        if (rows.type !== "some") assert.fail("read whole");
        assert.ok(textsEqual(rows.value.get("1")!.roles.queue, ["9", "10"]), "in the Set's order, by number");
        if (rules.unqueue.type !== "some") assert.fail("a queue takes a step out");
        const rule = ruleBytes({ name: "Proof first", queue: new Set([9n, 10n]) });
        const out = rules.unqueue.value(rule, "10");
        if (out.type !== "some") assert.fail("step 10 was queued");
        assert.ok(ruleEqual(ruleOf(out.value), { name: "Proof first", queue: new Set([9n]) }));
        assert.equal(rules.unqueue.value(rule, "11").type, "none", "a step not queued: nothing to write");
        assert.equal(rules.unqueue.value(rule, "Mix").type, "none", "\"Mix\" is no step's number");
    });

    test("a step's number retyped moves it in each rule's queue, both numbers read back from their text; a step not queued, or a text no step's number prints as, writes nothing", () => {
        if (bakery.decisions.type !== "some") assert.fail("the rules cross");
        const rules = bakery.decisions.value;
        if (rules.requeue.type !== "some") assert.fail("a queue follows a step's new number");
        const rule = ruleBytes({ name: "Proof first", queue: new Set([9n, 10n]) });
        const out = rules.requeue.value(rule, "10", "12");
        if (out.type !== "some") assert.fail("step 10 was queued");
        assert.ok(ruleEqual(ruleOf(out.value), { name: "Proof first", queue: new Set([9n, 12n]) }));
        assert.equal(rules.requeue.value(rule, "11", "12").type, "none", "a step not queued: nothing to write");
        assert.equal(rules.requeue.value(rule, "10", "Mix").type, "none", "\"Mix\" is no step's number");
    });

    test("the details: keyed as the steps are, read whole by their numbers' text", () => {
        if (bakery.states.details.type !== "some") assert.fail("the steps' details cross");
        const details = bakery.states.details.value;
        if (details.rows.type !== "some") assert.fail("read whole, beside the steps read whole");
        const rows = details.rows.value();
        if (rows.type !== "some") assert.fail("the details' rows, by key");
        assert.ok(textsEqual([...rows.value.keys()], ["10", "2"]));
        assert.ok(detailRowEqual(details.values(rows.value.get("2")!), [variant("figure", some(40))]));
    });
});

describe("a step's cards: a record keyed by number, each card by its number's text (#1549)", () => {
    test("each card's key its number's text, its name hearing the number at its type", () => {
        const states = East.compile(East.function([], Flowchart.Types.StateKind, ($) => {
            const stepRows = $.const(new SortedMap([[9n, { name: "Proof", station: 1n, seq: 2, note: "" }]], compareFor(IntegerType)), Steps);
            const steps = $.let({
                read: East.function([], Steps, (_$2) => stepRows),
                write: East.function([Steps], NullType, (_$2) => null),
                writeAndStart: East.function([Steps], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Steps, (_$2) => stepRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "steps")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Steps));
            const cards = $.const(new SortedMap([
                [1n, { name: "Shape", group: "Bench", values: { name: "Shape", note: "From the card" } }],
            ], compareFor(IntegerType)), DictType(IntegerType, StepCard));
            return Flowchart.states(steps, {
                label: "name", lane: "station", order: "seq",
                templates: Flowchart.templates(cards, { name: (card, key) => East.str`${card.name} (card ${key.add(100n)})`, values: (card) => card.values, source: "stepCards" }),
            }).build(undefined, false);
        }), [])();
        assert.equal(states.templates.length, 1);
        const card = states.templates[0]!;
        assert.equal(card.key, "1");
        assert.equal(card.name, "Shape (card 101)");
        const dropped = states.create({ label: none, lane: some("1"), order: some(3) }, some(card.values));
        if (dropped.type !== "some") assert.fail("a card makes a step");
        assert.ok(stepEqual(stepOf(dropped.value), { name: "Shape", station: 1n, seq: 3, note: "From the card" }));
    });
});

describe("a day's batches keyed by when each went in, in the shifts keyed by when each starts (#1549)", () => {
    const day = (() => {
        const ui = East.compile(East.function([], UIComponentType, ($) => {
            const batchRows = $.const(new SortedMap([
                [FIRST, { name: "Sourdough", shift: EARLY }],
                [SECOND, { name: "Rye", shift: LATE }],
            ], compareFor(DateTimeType)), Batches);
            const batches = $.let({
                read: East.function([], Batches, (_$2) => batchRows),
                write: East.function([Batches], NullType, (_$2) => null),
                writeAndStart: East.function([Batches], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Batches, (_$2) => batchRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "batches")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Batches));
            const shiftRows = $.const(new SortedMap([[EARLY, { label: "Early" }], [LATE, { label: "Late" }]], compareFor(DateTimeType)), Shifts);
            const shifts = $.let({
                read: East.function([], Shifts, (_$2) => shiftRows),
                write: East.function([Shifts], NullType, (_$2) => null),
                writeAndStart: East.function([Shifts], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Shifts, (_$2) => shiftRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "shifts")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Shifts));
            return PublicFlowchart({
                states: Flowchart.states(batches, { label: "name", lane: "shift" }),
                lanes: Flowchart.lanes(shifts, { label: "label" }),
            });
        }), [])();
        if (ui.type !== "Extension") assert.fail(`expected the Flowchart extension, got the ${ui.type} arm`);
        return decodeBeast2For(FlowchartPayloadType)(ui.value.payload);
    })();

    test("each by when it went in, as East prints it, standing in its shift by when the shift starts", () => {
        assert.ok(isTypeEqual(fromEastTypeValue(day.states.keyType), DateTimeType));
        if (day.lanes.type !== "some") assert.fail("the shifts cross");
        assert.ok(isTypeEqual(fromEastTypeValue(day.lanes.value.keyType), DateTimeType));
        const rows = day.states.rows();
        if (rows.type !== "some") assert.fail("read whole");
        assert.ok(textsEqual([...rows.value.keys()], [timeText(FIRST), timeText(SECOND)]));
        assert.ok(optionText(rows.value.get(timeText(FIRST))!.roles.lane, some(timeText(EARLY))));
        const shifts = day.lanes.value.rows();
        if (shifts.type !== "some") assert.fail("read whole");
        assert.ok(textsEqual([...shifts.value.keys()], [timeText(EARLY), timeText(LATE)]));
    });

    test("a batch moved to the late shift: its shift read back from its text", () => {
        const moved = day.states.write(batchBytes({ name: "Sourdough", shift: EARLY }), { label: none, lane: some(timeText(LATE)), order: none });
        if (moved.type !== "some") assert.fail("a batch moves shifts");
        assert.ok(batchEqual(batchOf(moved.value), { name: "Sourdough", shift: LATE }));
    });
});

// ============================================================================
// Each role's key, checked
// ============================================================================

/** The roles' type checks at any key type: never called — `tsc` checks what each line says. */
function typeChecks($: BlockBuilder<UIComponentType>): void {
    const steps = $.let(Data.bind(lineSteps));
    const moves = $.let(Data.bind(lineMoves));
    const stations = $.let(Data.bind(lineStations));
    const rules = $.let(Data.bind(lineRules));
    const crates = $.let(Data.bind(lineCrates));
    // What fits: a lane of a type a Dict may be keyed by, the ends of one type, the rule an Option of a key, the queue
    // a Set of keys; and each accessor hears its row's key at the record's key type.
    PublicFlowchart.states(steps, { label: "name", lane: "station", order: "seq", members: (_step, key) => some(key) });
    PublicFlowchart.transitions(moves, {
        from: "from", to: "to", decision: "rule",
        evidence: (_move, key) => some({ volume: none, count: some(key.to.subtract(key.from)), measuredAt: none, unit: none }),
    });
    PublicFlowchart.lanes(stations, { label: "label", order: "seq" });
    PublicFlowchart.decisions(rules, { label: (rule, key) => East.str`${rule.name} ${key.add(1n)}`, queue: "queue" });
    // A new move's key, built from its row at the moves' key type.
    PublicFlowchart.transitions(moves, { from: "from", to: "to", key: (move) => ({ from: move.from, to: move.to }) });
    // @ts-expect-error — the moves are keyed by the two steps they join: one step's number is no move's key
    PublicFlowchart.transitions(moves, { from: "from", to: "to", key: (move) => move.from });
    // @ts-expect-error — `note` is an Option of a String and `from` an Integer: a transition's ends hold a state's key each, of one type
    PublicFlowchart.transitions(moves, { from: "from", to: "note" });
    // @ts-expect-error — `slots` is an Array: a state's lane holds its lane's key, of a type a Dict may be keyed by
    PublicFlowchart.states(crates, { label: "name", lane: "slots" });
    // @ts-expect-error — `name` is a String: a decision's queue is an Array or a Set of the states' keys
    PublicFlowchart.decisions(rules, { label: (rule) => rule.name, queue: "name" });
}

describe("a role naming another kind's row holds that kind's key (#1549)", () => {
    test("each role is a field of a type a Dict may be keyed by, checked when the code compiles", () => {
        assert.equal(typeof typeChecks, "function");
    });

    test("where both kinds are known, a mismatch is refused, naming the role, the field, both kinds and both types", () => {
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), { label: "name", lane: "station" }),
            lanes: Flowchart.lanes($.let(Data.bind(namedStations)), { label: "label" }),
        })), "Flowchart: a state's lane, \"station\", holds .Integer — and the lanes are keyed by .String: key the lanes by .Integer, or name a field holding .String");
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(namedSteps)), { label: "name" }),
            transitions: Flowchart.transitions($.let(Data.bind(lineMoves)), { from: "from", to: "to" }),
        })), "Flowchart: a transition's ends, \"from\" and \"to\", hold .Integer — and the states are keyed by .String: key the states by .Integer, or name fields holding .String");
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), { label: "name" }),
            transitions: Flowchart.transitions($.let(Data.bind(lineMoves)), { from: "from", to: "to", decision: "rule" }),
            decisions: Flowchart.decisions($.let(Data.bind(namedRules)), { label: (rule) => rule.name }),
        })), "Flowchart: a transition's decision, \"rule\", holds an Option of .Integer — and the decisions are keyed by .String: key the decisions by .Integer, " +
            "or name a field holding an Option of .String");
        // A String names a decision where the decisions are keyed by String alone.
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), { label: "name" }),
            transitions: Flowchart.transitions($.let(Data.bind(slipMoves)), { from: "from", to: "to", decision: "rule" }),
            decisions: Flowchart.decisions($.let(Data.bind(lineRules)), { label: (rule) => rule.name }),
        })), "Flowchart: a transition's decision, \"rule\", holds .String — and the decisions are keyed by .Integer: key the decisions by .String, " +
            "or name a field holding an Option of .Integer");
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), { label: "name" }),
            decisions: Flowchart.decisions($.let(Data.bind(taggedRules)), { label: (rule) => rule.name, queue: "queue" }),
        })), "Flowchart: a decision's queue, \"queue\", holds the states' keys as .String — and the states are keyed by .Integer: key the states by .String, " +
            "or name an Array or a Set field of .Integer");
    });

    test("within one declaration: a lane of a type no Dict is keyed by, and a decision of neither an Option of a key nor a String", () => {
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineCrates)), { label: "name", lane: "slots" } as never),
        })), `Flowchart.states: \`lane\` names the field holding its lane's key, of a type a Dict may be keyed by — "slots" holds ${printType(ArrayType(IntegerType))}`);
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), { label: "name" }),
            transitions: Flowchart.transitions($.let(Data.bind(slipMoves)), { from: "from", to: "to", decision: "count" } as never),
        })), "Flowchart.transitions: `decision` names an Option of a decision's key, or a String, empty for none — \"count\" holds .Integer");
    });

    test("a kind's details are keyed as the kind is: details keyed by another type are refused, naming both", () => {
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), {
                label: "name", details: Flowchart.details($.let(Data.bind(namedYields)), { details: [Flowchart.figure("loaves")] }),
            }),
        })), "Flowchart.states: the details' record is keyed by .String, and the states' by .Integer — key the details as the states are");
        // Keyed as the steps are, they build.
        East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), {
                label: "name", details: Flowchart.details($.let(Data.bind(lineYields)), { details: [Flowchart.figure("loaves")] }),
            }),
        }));
    });
});

// ============================================================================
// A new row's key
// ============================================================================

describe("a new row's key: a kind's `key` builds it from its row (#1549)", () => {
    test("a `key` building another type than the record's key is refused, naming both", () => {
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), { label: "name" }),
            transitions: Flowchart.transitions($.let(Data.bind(lineMoves)), { from: "from", to: "to", key: ((move: ExprType<typeof Move>) => move.from) as never }),
        })), `Flowchart.transitions: \`key\` builds a transition's key, of the record's key type ${printType(MoveKey)} — and this one builds .Integer`);
    });

    test("editable transitions keyed by neither String nor Integer need `key`: nothing else keys what Connect makes", () => {
        refused(() => East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), { label: "name" }),
            transitions: Flowchart.transitions($.let(Record.bind(editedMoves)), { from: "from", to: "to" }),
        })), `Flowchart.transitions: the transitions are keyed by ${printType(MoveKey)}, and Connect makes one with no key typed — give \`key\`, ` +
            "building one's key from its row, or key them by String or Integer");
        // Given `key`, they build; read only, they need none.
        East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), { label: "name" }),
            transitions: Flowchart.transitions($.let(Record.bind(editedMoves)), { from: "from", to: "to", key: (move) => ({ from: move.from, to: move.to }) }),
        }));
        East.function([], UIComponentType, ($) => PublicFlowchart({
            states: Flowchart.states($.let(Data.bind(lineSteps)), { label: "name" }),
            transitions: Flowchart.transitions($.let(Data.bind(lineMoves)), { from: "from", to: "to" }),
        }));
    });

    test("a new lane at an order its whole-number field can't hold is refused before the kind's values are asked", () => {
        const bays = East.compile(East.function([], Flowchart.Types.LaneKind, ($) => {
            const bayRows = $.const(new SortedMap([[1n, { label: "Bench", seq: 1n, crew: 2n }]], compareFor(IntegerType)), DictType(IntegerType, Bay));
            const handle = $.let({
                read: East.function([], DictType(IntegerType, Bay), (_$2) => bayRows),
                write: East.function([DictType(IntegerType, Bay)], NullType, (_$2) => null),
                writeAndStart: East.function([DictType(IntegerType, Bay)], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], DictType(IntegerType, Bay), (_$2) => bayRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "bays")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(DictType(IntegerType, Bay)));
            // The crew counts the new bay's label: a lane given none has no label to count, so asking would fail.
            return Flowchart.lanes(handle, { label: "label", order: "seq", values: (made) => ({ crew: made.label.unwrap().length() }) }).build(undefined, false);
        }), [])();
        assert.equal(bays.create({ label: none, order: some(0.5) }, none).type, "none", "no whole number: refused, the values never asked");
        const added = bays.create({ label: some("Oven"), order: some(2) }, none);
        if (added.type !== "some") assert.fail("a whole order makes a bay");
        assert.ok(equalFor(Bay)(decodeBeast2For(Bay)(added.value), { label: "Oven", seq: 2n, crew: 4n }));
    });
});

// ============================================================================
// The rail, over records keyed by any type
// ============================================================================

describe("the rail's sources may be over records keyed by any type, their shown keys their text (#1549)", () => {
    test("the steps read through their source, their cards and a tab following theirs, each over a record keyed by number", () => {
        East.function([], UIComponentType, ($) => {
            const slice = $.let(Slice.bindRecords("flowchart.keys.spec.rail", {
                states: { source: Data.bindPaged(lineSteps, { indexes: ["flowchart_keys_spec_steps_by_station"] }) },
                stepCards: { source: Data.bindPaged(lineCards, { indexes: ["flowchart_keys_spec_cards_by_group"] }), fields: { group: { label: "Group" } } },
            }));
            const cards = $.let(Data.bind(lineCards));
            return PublicFlowchart({
                slice: { slice },
                states: Flowchart.states($.let(Data.bindPaged(lineSteps)), {
                    label: "name", lane: "station", order: "seq",
                    templates: Flowchart.templates(cards.read(), { name: (card) => card.name, values: (card) => card.values, source: "stepCards" }),
                }),
                lanes: Flowchart.lanes($.let(Data.bind(lineStations)), { label: "label", order: "seq" }),
                library: [
                    PublicFlowchart.library.states(),
                    PublicFlowchart.library.tab(cards.read(), { name: "Cards", label: (card, key) => East.str`${card.name} ${key}`, source: "stepCards" }),
                ],
            });
        });
    });
});
