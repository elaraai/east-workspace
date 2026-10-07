/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's types and payload (#1244, `Flowchart Builder Spec.md` §4,
 * §5, FB4–FB6): the flow and the record of flows; `Flowchart.value` and
 * `Flowchart.values`, filling a literal and refusing what would not draw or
 * commit; `Flowchart.over`, one flow from an app's tables through their
 * mappers; `Flowchart.patch`; where the flows come from — a record of flows
 * by name, or the host's flows or flow, `data`'s type picking its arm — read
 * back through the `Flowchart` carrier's beast2 bytes; a record of one flow
 * refused, as the user ruled (2026-10-07: e3's patch mutation writes only
 * keyed records); every refusal of §4.4 this child owns, each naming its
 * prop; and the tag's forms, type by type.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, AsyncFunctionType, BooleanType, DictType, East, Expr, FunctionType, IntegerType, NullType, OptionType, PatchType, SortedMap,
    StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, isTypeEqual, none, some, variant,
    type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Editing, Slice, UIComponentType } from "@elaraai/east-ui";
import { DatasetStatusType, RecordCommitInfoType } from "@elaraai/e3-types";
import e3 from "@elaraai/e3";
import {
    Flowchart as PublicFlowchart, Record, RecordBindHandleType, RecordBindingType, RecordErrorType, RecordMutateStatusType, RecordOutcomeType,
} from "@elaraai/e3-ui";
import { Flowchart, FlowchartLibraryTabType, FlowchartPayloadType } from "@elaraai/e3-ui/internal";
import * as ex from "./flowchart.examples.js";

type Flow = ValueTypeOf<typeof Flowchart.Types.Flow>;
type Flows = ValueTypeOf<typeof Flowchart.Types.Flows>;
type Payload = ValueTypeOf<typeof FlowchartPayloadType>;

const FlowType = Flowchart.Types.Flow;
const FlowsType = Flowchart.Types.Flows;
const flowEqual = equalFor(FlowType);
const flowsEqual = equalFor(FlowsType);

describeEast("Flowchart", (test) => {
    Assert.examples(test, {
        flowchartFlows: ex.flowchartFlows,
        flowchartHandover: ex.flowchartHandover,
        flowchartMinimal: ex.flowchartMinimal,
        flowchartDepot: ex.flowchartDepot,
        flowchartBuilder: ex.flowchartBuilder,
        flowchartDetail: ex.flowchartDetail,
    });
}, { platformFns: TestImpl });

// ============================================================================
// Fixtures
// ============================================================================

/** The inbound flow, as a literal writes it: every optional field given somewhere. */
const INBOUND = {
    description: "From the trailer to the van",
    lanes: [{ key: "intake", label: "Intake" }, { key: "sort" }],
    states: [
        { key: "ARV", label: "Arrived", lane: "intake" },
        { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n, notes: "One per postcode area" },
    ],
    links: [
        { key: "a-c", from: "ARV", to: "CH*", kind: "observed", trigger: "route",
          evidence: { volume: 17350.0, count: 386n, measuredAt: new Date("2026-06-30T00:00:00Z"), unit: "parcels" } },
        { from: "CH*", to: "LDD" },
    ],
    triggers: [{ key: "route", label: "route", letter: "R", owner: "sort-planner", queue: ["ARV"], outcomes: "CH* (×12 chutes)" }],
} as const satisfies Parameters<typeof Flowchart.value>[0];

/** The inbound flow's value, written out field by field. */
const INBOUND_VALUE: Flow = {
    description: some("From the trailer to the van"),
    lanes: [{ key: "intake", label: some("Intake") }, { key: "sort", label: none }],
    states: [
        { key: "ARV", label: some("Arrived"), lane: "intake", members: none, notes: none },
        { key: "CH*", label: some("Sort chutes"), lane: "sort", members: some(12n), notes: some("One per postcode area") },
    ],
    links: [
        {
            key: some("a-c"), from: "ARV", to: "CH*", kind: some(variant("observed", null)), trigger: some("route"),
            evidence: some({ volume: some(17350.0), count: some(386n), measuredAt: some(new Date("2026-06-30T00:00:00Z")), unit: some("parcels") }),
        },
        { key: none, from: "CH*", to: "LDD", kind: none, trigger: none, evidence: none },
    ],
    triggers: [{ key: "route", label: "route", letter: some("R"), owner: some("sort-planner"), queue: some(["ARV"]), outcomes: some("CH* (×12 chutes)") }],
};

/** The returns flow: the least a literal writes. */
const RETURNS = {
    lanes: [{ key: "counter" }],
    states: [{ key: "RCV", lane: "counter" }],
    links: [],
} as const satisfies Parameters<typeof Flowchart.value>[0];

const RETURNS_VALUE: Flow = {
    description: none,
    lanes: [{ key: "counter", label: none }],
    states: [{ key: "RCV", label: none, lane: "counter", members: none, notes: none }],
    links: [],
    triggers: [],
};

const FLOWS: Flows = Flowchart.values({ "Returns": RETURNS, "Inbound parcels": INBOUND });

/** Run `build` inside a block, as a flowchart's factory runs. */
function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
    let out: T | undefined;
    East.function([], NullType, ($) => { out = build($); });
    return out!;
}

/**
 * A `Record.bind` handle over a record of `type`, as the record runtime gives
 * one: its read answers `value`, and with `patch` it is bound with its patch
 * mutation.
 */
function boundRecord<T extends EastType>(type: T, value: ValueTypeOf<T>, patch: boolean) {
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
        binding: { name: "flows", mutations: patch ? ["patch"] : [] },
    }) as never);
}

const flowsRecord = boundRecord(FlowsType, FLOWS, true);
const unpatchedFlows = boundRecord(FlowsType, FLOWS, false);
/** A record of one flow, bound with a mutation named `patch` of the flow's patch: refused, a record holding flows by name. */
const flowRecord = boundRecord(FlowType, INBOUND_VALUE, true);

/** A record of flows whose mutation named `patch` takes something other than the record's patch: one flow's. */
const WrongDoorHandle = StructType({
    read: FunctionType([], FlowsType),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    commit: StructType({ patch: AsyncFunctionType([StringType, PatchType(FlowType)], RecordOutcomeType) }),
    binding: RecordBindingType,
});
const wrongDoorFlows = East.function([], WrongDoorHandle, (_$) => ({
    read: East.function([], FlowsType, (_$2) => FLOWS),
    history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
    commit: { patch: East.asyncFunction([StringType, PatchType(FlowType)], RecordOutcomeType, (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })) },
    binding: { name: "flows", mutations: ["patch"] },
}));
const JobType = StructType({ task: StringType });
const jobsRecord = boundRecord(DictType(StringType, JobType), new Map(), true);

/** The payload `<Flowchart>` carries, read back from the carrier's bytes. */
function carried(build: ($: BlockBuilder<UIComponentType>) => ExprType<UIComponentType>): Payload {
    const ui = East.compile(East.function([], UIComponentType, ($) => build($)), [])();
    if (ui.type !== "Extension") assert.fail(`expected the Flowchart extension, got the ${ui.type} arm`);
    assert.equal(ui.value.kind, "Flowchart");
    return decodeBeast2For(FlowchartPayloadType)(ui.value.payload);
}

/** The host's flow from its tables, as an app's rows and mappers give it. */
const STATE_ROWS = [
    { code: "ARV", name: "Arrived", phase: "intake", slots: none },
    { code: "CH*", name: "Sort chutes", phase: "sort", slots: some(12n) },
];
const LINK_ROWS = [
    { id: "a-c", src: "ARV", dst: "CH*", observed: true, decision: some("route"), parcels: some(17350.0), n: some(386n), at: new Date("2026-06-30T00:00:00Z") },
    { id: "c-l", src: "CH*", dst: "LDD", observed: false, decision: none, parcels: none, n: none, at: new Date("2026-06-30T00:00:00Z") },
];
const TRIGGER_ROWS = [{ id: "route", name: "route", who: "sort-planner" }];

// ============================================================================
// The types (FB4)
// ============================================================================

describe("the flow types (§5.1)", () => {
    hostTest("a flow is { description, lanes, states, links, triggers } of the row types, and a record of flows is a Dict of flows by name", () => {
        assert.ok(isTypeEqual(Flowchart.Types.Flow, StructType({
            description: OptionType(StringType),
            lanes: ArrayType(Flowchart.Types.Lane),
            states: ArrayType(Flowchart.Types.State),
            links: ArrayType(Flowchart.Types.Link),
            triggers: ArrayType(Flowchart.Types.Trigger),
        })));
        assert.ok(isTypeEqual(Flowchart.Types.Flows, DictType(StringType, Flowchart.Types.Flow)));
        assert.equal(PublicFlowchart.Types.Flow, Flowchart.Types.Flow, "the public namespace carries the same type");
    });

    hostTest("the row types keep their names and their types", () => {
        assert.ok(isTypeEqual(Flowchart.Types.State, StructType({
            key: StringType, label: OptionType(StringType), lane: StringType, members: OptionType(IntegerType), notes: OptionType(StringType),
        })));
        assert.ok(isTypeEqual(Flowchart.Types.Lane, StructType({ key: StringType, label: OptionType(StringType) })));
    });
});

// ============================================================================
// Flowchart.value and Flowchart.values (FB4, §4.4)
// ============================================================================

describe("Flowchart.value and Flowchart.values (§4.3)", () => {
    hostTest("value fills what a literal leaves out and keeps what it writes", () => {
        assert.ok(flowEqual(Flowchart.value(INBOUND), INBOUND_VALUE), "every field the literal writes, filled where it does not");
        assert.ok(flowEqual(Flowchart.value(RETURNS), RETURNS_VALUE), "the least literal: none and empty everywhere else");
    });

    hostTest("values holds each flow by name, in name order, as value builds it", () => {
        assert.ok(flowsEqual(FLOWS, new SortedMap([["Inbound parcels", INBOUND_VALUE], ["Returns", RETURNS_VALUE]], compareFor(StringType))));
        assert.deepEqual([...FLOWS.keys()], ["Inbound parcels", "Returns"]);
    });

    hostTest("a link naming a state the flow does not have is kept — it draws as the unresolved ghost — and links without a key never clash", () => {
        const flow = Flowchart.value({
            lanes: [{ key: "intake" }], states: [{ key: "ARV", lane: "intake" }],
            links: [{ from: "ARV", to: "GONE" }, { from: "ARV", to: "GONE" }],
        });
        assert.deepEqual(flow.links.map((l) => l.to), ["GONE", "GONE"]);
    });

    const refusals: [string, Parameters<typeof Flowchart.value>[0], RegExp][] = [
        ["two lanes of one key", { lanes: [{ key: "a" }, { key: "a" }], states: [], links: [] },
            /^Error: Flowchart\.value: two lanes are keyed "a" — a lane's key is its identity in the flow, so give each lane its own$/],
        ["two states of one key", { lanes: [{ key: "a" }], states: [{ key: "S", lane: "a" }, { key: "S", lane: "a" }], links: [] },
            /^Error: Flowchart\.value: two states are keyed "S" — a state's key is its identity in the flow, so give each state its own$/],
        ["two links of one key", { lanes: [], states: [], links: [{ key: "k", from: "A", to: "B" }, { key: "k", from: "B", to: "C" }] },
            /^Error: Flowchart\.value: two links are keyed "k" — a link's key is its identity in the flow, so give each link its own$/],
        ["two decisions of one key", { lanes: [], states: [], links: [], triggers: [{ key: "r", label: "route" }, { key: "r", label: "rest" }] },
            /^Error: Flowchart\.value: two decisions are keyed "r" — a decision's key is its identity in the flow, so give each decision its own$/],
        ["a state naming no lane the flow has", { lanes: [{ key: "a" }], states: [{ key: "S", lane: "b" }], links: [] },
            /^Error: Flowchart\.value: the state "S" names the lane "b", which the flow has none of — add it to `lanes`, or name a lane the flow has$/],
        ["a link naming a decision the flow does not have", { lanes: [], states: [], links: [{ from: "A", to: "B", trigger: "route" }], triggers: [{ key: "customs", label: "customs" }] },
            /^Error: Flowchart\.value: the link "A" → "B" names the decision "route", which the flow has none of — add it to `triggers`, or leave the link's `trigger` out$/],
    ];
    for (const [what, flow, refusal] of refusals) {
        hostTest(`value refuses ${what}, naming it and the remedy`, () => {
            assert.throws(() => Flowchart.value(flow), refusal);
        });
    }

    hostTest("values refuses what value refuses, naming the flow", () => {
        assert.throws(() => Flowchart.values({ "Inbound parcels": INBOUND, "Returns": { lanes: [{ key: "a" }], states: [{ key: "S", lane: "b" }], links: [] } }),
            /^Error: Flowchart\.values: "Returns": the state "S" names the lane "b", which the flow has none of/);
    });
});

// ============================================================================
// Flowchart.over (FB4)
// ============================================================================

describe("Flowchart.over (§4.3)", () => {
    hostTest("builds one flow from the app's tables through their mappers, as the literal of the same flow is", () => {
        const built = East.compile(East.function([], FlowType, ($) => {
            const states = $.const(STATE_ROWS);
            const links = $.const(LINK_ROWS);
            const triggers = $.const(TRIGGER_ROWS);
            return Flowchart.over(states, {
                state: (s) => ({ key: s.code, label: s.name, lane: s.phase, members: s.slots }),
                links,
                link: (l) => ({
                    key: l.id, from: l.src, to: l.dst,
                    kind: l.observed.ifElse(() => variant("observed", null), () => variant("planned", null)),
                    trigger: l.decision,
                    evidence: { volume: l.parcels, count: l.n, measuredAt: some(l.at), unit: "parcels" },
                }),
                lanes: [{ key: "intake", label: "Intake" }, { key: "sort" }],
                triggers,
                trigger: (t) => ({ key: t.id, label: t.name, owner: t.who }),
            });
        }), [])();
        const expected = Flowchart.value({
            lanes: [{ key: "intake", label: "Intake" }, { key: "sort" }],
            states: [{ key: "ARV", label: "Arrived", lane: "intake" }, { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n }],
            links: [
                { key: "a-c", from: "ARV", to: "CH*", kind: "observed", trigger: "route",
                  evidence: { volume: 17350.0, count: 386n, measuredAt: new Date("2026-06-30T00:00:00Z"), unit: "parcels" } },
                { key: "c-l", from: "CH*", to: "LDD", kind: "planned", evidence: { measuredAt: new Date("2026-06-30T00:00:00Z"), unit: "parcels" } },
            ],
            triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
        });
        assert.ok(flowEqual(built, expected));
    });

    hostTest("takes rows already of the flowchart's types as they are, and no triggers as none", () => {
        const flow = Flowchart.value(INBOUND);
        const built = East.compile(East.function([], FlowType, ($) => {
            const states = $.const(flow.states, ArrayType(Flowchart.Types.State));
            return Flowchart.over(states, {
                links: $.const(flow.links, ArrayType(Flowchart.Types.Link)),
                lanes: $.const(flow.lanes, ArrayType(Flowchart.Types.Lane)),
                triggers: $.const(flow.triggers, ArrayType(Flowchart.Types.Trigger)),
            });
        }), [])();
        assert.ok(flowEqual(built, { ...flow, description: none }), "the same rows; a flow from tables has no description");
        const bare = East.compile(East.function([], FlowType, ($) => Flowchart.over($.const(flow.states, ArrayType(Flowchart.Types.State)), {
            links: [], lanes: [{ key: "intake" }],
        })), [])();
        assert.deepEqual([bare.triggers, bare.lanes], [[], [{ key: "intake", label: none }]]);
    });

    hostTest("a mapper's kind may be the literal \"planned\" or \"observed\"", () => {
        const built = East.compile(East.function([], FlowType, ($) => Flowchart.over($.const(STATE_ROWS), {
            state: (s) => ({ key: s.code, lane: s.phase }),
            links: $.const(LINK_ROWS),
            link: (l) => ({ from: l.src, to: l.dst, kind: "observed" }),
            lanes: [{ key: "intake" }, { key: "sort" }],
        })), [])();
        assert.deepEqual(built.links.map((l) => l.kind), [some(variant("observed", null)), some(variant("observed", null))]);
    });
});

// ============================================================================
// Flowchart.patch (FB4)
// ============================================================================

describe("Flowchart.patch (§4.3)", () => {
    hostTest("a patch over a row is every field an Option: the fields it sets some, the rest none", () => {
        const StatePatch = Flowchart.Types.Patch(Flowchart.Types.State);
        assert.ok(isTypeEqual(StatePatch, StructType({
            key: OptionType(StringType), label: OptionType(OptionType(StringType)), lane: OptionType(StringType),
            members: OptionType(OptionType(IntegerType)), notes: OptionType(OptionType(StringType)),
        })));
        const patch = East.compile(East.function([], StatePatch, (_$) =>
            Flowchart.patch(Flowchart.Types.State, { key: "HLD", label: some("Held"), members: none })), [])();
        assert.ok(equalFor(StatePatch)(patch, { key: some("HLD"), label: some(some("Held")), lane: none, members: some(none), notes: none }));
        const LinkPatch = Flowchart.Types.Patch(Flowchart.Types.Link);
        const retype = East.compile(East.function([], LinkPatch, (_$) =>
            Flowchart.patch(Flowchart.Types.Link, { kind: some(variant("observed", null)) })), [])();
        assert.deepEqual(retype.kind, some(some(variant("observed", null))));
        assert.deepEqual([retype.key, retype.from, retype.to, retype.trigger], [none, none, none, none]);
    });

    hostTest("a patch is over one of a flow's rows: another type is refused, naming the four", () => {
        const Job = StructType({ task: StringType });
        assert.throws(() => inBlock((_$) => Flowchart.patch(Job as never, {})),
            /^Error: Flowchart\.patch: patches one of a flow's rows — Flowchart\.Types\.State, Flowchart\.Types\.Link, Flowchart\.Types\.Lane, Flowchart\.Types\.Trigger — and this is \.Struct/);
        assert.throws(() => Flowchart.Types.Patch(Job as never), /^Error: Flowchart\.Types\.Patch: patches one of a flow's rows/);
    });
});

// ============================================================================
// The payload, and the arm the source's type picks (FB5, FB6)
// ============================================================================

describe("the payload (FB6)", () => {
    hostTest("the payload is FlowchartPayloadType, on the Flowchart carrier", () => {
        inBlock(($) => {
            const flows = $.let(flowsRecord());
            const payload = Flowchart.Payload({ record: flows });
            assert.ok(isTypeEqual(Expr.type(payload as unknown as Expr) as EastType, FlowchartPayloadType));
        });
        assert.equal(Flowchart.Component.name, "Flowchart");
    });

    hostTest("a record of flows is the record arm: its read, history and patch write cross the payload, and `flow` opens first", () => {
        const payload = carried(($) => PublicFlowchart({ record: $.let(flowsRecord()), flow: "Returns", name: "depot", inspector: true }));
        if (payload.source.type !== "record") assert.fail(`expected the record arm, got ${payload.source.type}`);
        assert.ok(flowsEqual(payload.source.value.read(), FLOWS), "the record's read, called where the renderer calls it");
        assert.deepEqual(payload.source.value.history(), none);
        assert.deepEqual([payload.open, payload.name, payload.inspector, payload.readOnly, payload.library], [some("Returns"), some("depot"), true, false, []]);
    });

    hostTest("an e3 record of flows binds with e3.mutation.patch; e3 gives a record of one flow none, so a record always holds flows by name", () => {
        const flows = e3.record("flowchart_spec_flows", FlowsType, FLOWS);
        const one = e3.record("flowchart_spec_one", FlowType, INBOUND_VALUE);
        inBlock(($) => {
            const payload = Flowchart.Payload({ record: $.let(Record.bind(flows, [e3.mutation.patch(flows)])) });
            assert.ok(isTypeEqual(Expr.type(payload as unknown as Expr) as EastType, FlowchartPayloadType));
        });
        // The ruling's reason: e3 writes a patch by key.
        assert.throws(() => e3.mutation.patch(one), /writes a delta addressed by key, so it needs a Dict or Set record/);
        assert.throws(() => inBlock(($) => Flowchart.Payload({ record: $.let(Record.bind(one, [])) })),
            /^Error: Flowchart: `record` holds flows by name, Flowchart\.Types\.Flows — e3's patch mutation writes only keyed records — and this record holds one flow/);
    });

    hostTest("a lone flow is a record of flows with one entry: the canvas's first by name", () => {
        const payload = carried(($) => PublicFlowchart({ record: $.let(boundRecord(FlowsType, Flowchart.values({ "Hand-over": RETURNS }), true)()), readOnly: true }));
        if (payload.source.type !== "record") assert.fail(`expected the record arm, got ${payload.source.type}`);
        assert.deepEqual([...payload.source.value.read().keys()], ["Hand-over"]);
        assert.deepEqual([payload.open, payload.readOnly], [none, true]);
    });

    hostTest("the host's flows — a value, an expression or a bind handle — are the data arm's flows, with its onApply", () => {
        const apply = East.asyncFunction([PatchType(FlowsType)], Editing.Types.ApplyResult, (_$) => variant("applied", { revision: none }));
        const asValue = carried((_$) => PublicFlowchart({ data: FLOWS, flow: "Inbound parcels" }));
        const asExpr = carried(($) => PublicFlowchart({ data: $.const(FLOWS, FlowsType), onApply: $.const(apply) }));
        const handle = East.function([], StructType({ read: FunctionType([], FlowsType) }), (_$) => ({ read: East.function([], FlowsType, (_$2) => FLOWS) }));
        const asHandle = carried(($) => PublicFlowchart({ data: $.let(handle()) }));
        for (const [form, payload, applies] of [["value", asValue, false], ["expression", asExpr, true], ["bind handle", asHandle, false]] as const) {
            if (payload.source.type !== "data" || payload.source.value.type !== "flows") assert.fail(`${form}: expected the data arm's flows`);
            assert.ok(flowsEqual(payload.source.value.value.value, FLOWS), `${form}: the flows`);
            assert.equal(payload.source.value.value.onApply.type, applies ? "some" : "none", `${form}: its onApply`);
        }
        assert.deepEqual(asValue.open, some("Inbound parcels"));
    });

    hostTest("the host's one flow — Flowchart.over's expression, or a value — is the data arm's flow", () => {
        const fromTables = carried(($) => PublicFlowchart({
            data: Flowchart.over($.const(STATE_ROWS), {
                state: (s) => ({ key: s.code, lane: s.phase }), links: $.const(LINK_ROWS), link: (l) => ({ from: l.src, to: l.dst }), lanes: [{ key: "intake" }, { key: "sort" }],
            }),
        }));
        const asValue = carried((_$) => PublicFlowchart({ data: INBOUND_VALUE }));
        for (const [form, payload] of [["Flowchart.over", fromTables], ["value", asValue]] as const) {
            if (payload.source.type !== "data" || payload.source.value.type !== "flow") assert.fail(`${form}: expected the data arm's flow`);
        }
        if (asValue.source.type === "data" && asValue.source.value.type === "flow") assert.ok(flowEqual(asValue.source.value.value.value, INBOUND_VALUE));
        if (fromTables.source.type === "data" && fromTables.source.value.type === "flow") {
            assert.deepEqual(fromTables.source.value.value.value.states.map((s) => s.key), ["ARV", "CH*"]);
        }
    });

    hostTest("the canvas carries today's options, none for every one left out", () => {
        const payload = carried((_$) => PublicFlowchart({ data: INBOUND_VALUE }));
        const canvas = payload.canvas;
        for (const [field, value] of Object.entries(canvas)) assert.deepEqual(value, none, `canvas.${field} is none`);
        const given = carried(($) => PublicFlowchart({
            data: INBOUND_VALUE, orientation: "TD", legend: false, minimap: true, density: "compact",
            freshness: { label: "scans-2026.09" }, onSelectState: $.const(East.function([StringType], NullType, (_$2) => null)),
        }));
        assert.deepEqual([given.canvas.orientation, given.canvas.legend, given.canvas.minimap, given.canvas.freshness],
            [some(variant("TD", null)), some(false), some(true), some({ label: "scans-2026.09", date: none })]);
        assert.equal(given.canvas.onSelectState.type, "some");
    });

    hostTest("the payload round-trips through beast2 — the carrier's bytes decode to what Flowchart.Payload builds, and a library tab's wire encodes and decodes", () => {
        const decoded = carried((_$) => PublicFlowchart({ data: FLOWS, flow: "Returns", name: "depot" }));
        const built = East.compile(East.function([], FlowchartPayloadType, (_$) => Flowchart.Payload({ data: FLOWS, flow: "Returns", name: "depot" })), [])();
        assert.ok(equalFor(FlowchartPayloadType)(decoded, built), "the carrier's payload is the one Flowchart.Payload builds");
        const again = decodeBeast2For(FlowchartPayloadType)(encodeBeast2For(FlowchartPayloadType)(decoded));
        assert.ok(equalFor(FlowchartPayloadType)(again, decoded));
        const tabs: ValueTypeOf<typeof FlowchartLibraryTabType>[] = [
            variant("flows", null),
            variant("states", { name: "Steps", icon: some("box"), cards: [{ key: "HLD", label: "Hold", meta: some("hold"), group: none,
                sets: { key: some("HLD"), label: some(some("Held")), lane: none, members: none, notes: none } }] }),
            variant("transitions", { name: "Transitions", icon: none, cards: [{ key: "obs", label: "Observed", meta: none, group: none,
                sets: { key: none, from: none, to: none, kind: some(some(variant("observed", null))), trigger: none, evidence: none } }] }),
            variant("tab", { name: "Owners", icon: none, lands: variant("decision", [{ key: "desk", label: "Customs desk", meta: none, group: none,
                sets: { key: none, label: none, letter: none, owner: some(some("customs-desk")), queue: none, outcomes: none } }]) }),
            variant("tab", { name: "Notes", icon: none, lands: variant("none", [{ key: "n1", label: "Read me", meta: none, group: none }]) }),
        ];
        const tabsType = ArrayType(FlowchartLibraryTabType);
        assert.ok(equalFor(tabsType)(decodeBeast2For(tabsType)(encodeBeast2For(tabsType)(tabs)), tabs));
    });
});

// ============================================================================
// §4.4: every refusal this child owns, at build, naming its prop and remedy
// ============================================================================

describe("refused when the surface is built (§4.4, FB5)", () => {
    /** Build a flowchart in a block, as a surface's body builds one. */
    const build = (props: ($: BlockBuilder<NullType>) => object) => () => inBlock(($) => Flowchart.Payload(props($)));

    const refusals: [string, ($: BlockBuilder<NullType>) => object, RegExp][] = [
        ["flows from both `record` and `data`", ($) => ({ record: $.let(flowsRecord()), data: FLOWS }),
            /^Error: Flowchart: takes its flows from `record` or from `data`, never both$/],
        ["flows from neither", (_$) => ({ legend: false }),
            /^Error: Flowchart: needs its flows — `record`, an e3 record of Flowchart\.Types\.Flows bound with its patch mutation, or `data`: flows by name or one flow/],
        ["`onApply` over a record", ($) => ({ record: $.let(flowsRecord()), onApply: East.asyncFunction([PatchType(FlowsType)], Editing.Types.ApplyResult, (_$2) => variant("applied", { revision: none })) }),
            /^Error: Flowchart: `onApply` commits `data`'s edits — a flowchart over `record` commits through the record's patch mutation; leave `onApply` out$/],
        ["`flow` over the host's one flow", (_$) => ({ data: INBOUND_VALUE, flow: "Inbound parcels" }),
            /^Error: Flowchart: `flow` opens one of many flows first, and this `data` is one flow, Flowchart\.Types\.Flow — leave `flow` out$/],
        ["`slice` over a record", ($) => ({ record: $.let(flowsRecord()), slice: $.let(depotSlice($)) }),
            /^Error: Flowchart: `slice` narrows the transitions a host builds its flow from, and a record's flows are the record's — pass the host's flow as data=\{Flowchart\.over/],
        ["`affordances` over a record", ($) => ({ record: $.let(flowsRecord()), affordances: ["filter"] }),
            /^Error: Flowchart: `affordances` narrows the transitions a host builds its flow from/],
        ["a record of one flow, with the remedy: a record of flows with one entry, or `data`", ($) => ({ record: $.let(flowRecord()) }),
            /^Error: Flowchart: `record` holds flows by name, Flowchart\.Types\.Flows — e3's patch mutation writes only keyed records — and this record holds one flow: make it a record of flows with one entry \(Flowchart\.values\(\{ \[name\]: flow \}\)\), or pass the flow as `data`$/],
        ["a record of another type", ($) => ({ record: $.let(jobsRecord()) }),
            /^Error: Flowchart: `record` holds flows by name, Flowchart\.Types\.Flows — declare it with that type — and this record holds \.Dict/],
        ["a record not bound with its patch mutation", ($) => ({ record: $.let(unpatchedFlows()) }),
            /^Error: Flowchart: `record` is an e3 record bound with its patch mutation — Record\.bind\(record, \[e3\.mutation\.patch\(record\)\]\), and this binding has no `patch`$/],
        ["a record whose `patch` takes another patch than the record's", ($) => ({ record: $.let(wrongDoorFlows()) }),
            /^Error: Flowchart: `record` is an e3 record bound with its patch mutation — Record\.bind\(record, \[e3\.mutation\.patch\(record\)\]\), and this binding has a `patch` that takes another patch than the record's$/],
        ["a `record` that is no bound record", (_$) => ({ record: FLOWS }),
            /^Error: Flowchart: `record` is an e3 record bound with its patch mutation — Record\.bind\(record, \[e3\.mutation\.patch\(record\)\]\)$/],
        ["\"brush\" among the affordances", ($) => ({ data: INBOUND_VALUE, slice: $.let(depotSlice($)), affordances: ["filter", "brush"] }),
            /^Error: Flowchart: `affordances` lists "brush", and a flowchart has no continuous axis to brush along/],
        ["`data` of neither flow type", ($) => ({ data: $.const([{ code: "ARV" }]) }),
            /^Error: Flowchart: `data` is Flowchart\.Types\.Flows, flows by name, or Flowchart\.Types\.Flow, one flow — a value, an expression or a bind handle of either; Flowchart\.over builds one flow from an app's tables — and this is \.Array/],
        ["a `data` value of neither flow type", (_$) => ({ data: [{ code: "ARV" }] }),
            /^Error: Flowchart: `data` is .* — and this value is neither$/],
        ["an `onApply` over another patch", ($) => ({ data: INBOUND_VALUE, onApply: $.const(East.asyncFunction([PatchType(FlowsType)], Editing.Types.ApplyResult, (_$2) => variant("applied", { revision: none }))) }),
            /^Error: Flowchart: `onApply` commits `data`'s edits, one patch of the value at a time — an East\.asyncFunction from PatchType\(Flowchart\.Types\.Flow\) to Editing\.Types\.ApplyResult — and this one is/],
        ["a table, which Flowchart.over takes", (_$) => ({ data: INBOUND_VALUE, states: STATE_ROWS }),
            /^Error: Flowchart: `states` is one of the tables, or the row mappers, Flowchart\.over builds a flow from — pass data=\{Flowchart\.over\(states, \{ … \}\)\}/],
        ["a row mapper, which Flowchart.over takes", (_$) => ({ data: INBOUND_VALUE, link: () => ({}) }),
            /^Error: Flowchart: `link` is one of the tables, or the row mappers, Flowchart\.over builds a flow from/],
    ];
    for (const [what, props, refusal] of refusals) {
        hostTest(`refuses ${what}`, () => {
            assert.throws(build(props), refusal);
        });
    }
});

/** A slice over the depot's transitions — what a host narrows the links it builds its flow from with. */
function depotSlice(_$: BlockBuilder<NullType>) {
    const LinkRow = StructType({ src: StringType, dst: StringType });
    const cfg = Slice.config(LinkRow, { fields: { src: { label: "From" } } });
    return Slice.bind([LinkRow], "flowchart.spec.slice", cfg, Slice.state({}), [{ src: "ARV", dst: "SCN" }], none);
}

// ============================================================================
// The tag's forms (FB5): each arm's props, type by type
// ============================================================================

hostTest("the tag's forms type each arm's props — a prop another arm takes fails to compile", () => {
    // Type-level: the build never runs. A form that accepted one of these
    // would fail the build on its unused directive.
    const never = (): void => {
        inBlock(($) => {
            const flows = $.let(flowsRecord());
            const one = $.let(flowRecord());
            const jobs = $.let(jobsRecord());
            const slice = $.let(depotSlice($));
            const applyFlows = $.const(East.asyncFunction([PatchType(FlowsType)], Editing.Types.ApplyResult, (_$2) => variant("applied", { revision: none })));
            const applyFlow = $.const(East.asyncFunction([PatchType(FlowType)], Editing.Types.ApplyResult, (_$2) => variant("applied", { revision: none })));
            // Each form, as it is written.
            PublicFlowchart({ record: flows, flow: "Returns", inspector: true, name: "depot" });
            PublicFlowchart({ data: FLOWS, flow: "Returns", onApply: applyFlows, slice, affordances: ["search"] });
            PublicFlowchart({ data: INBOUND_VALUE, onApply: applyFlow });
            // @ts-expect-error — a record holds flows by name: a lone flow is a record of one entry, or `data`
            PublicFlowchart({ record: one });
            // @ts-expect-error — a record commits through its patch mutation, never the host's onApply
            PublicFlowchart({ record: flows, onApply: applyFlows });
            // @ts-expect-error — a record's flows are the record's: no slice narrows them
            PublicFlowchart({ record: flows, slice });
            // @ts-expect-error — a record of jobs is no record of flows
            PublicFlowchart({ record: jobs });
            // @ts-expect-error — the host's one flow has no `flow` to open
            PublicFlowchart({ data: INBOUND_VALUE, flow: "Returns" });
            // @ts-expect-error — one flow's onApply takes the flow's patch, never the flows'
            PublicFlowchart({ data: INBOUND_VALUE, onApply: applyFlows });
            // @ts-expect-error — the flows come from one source
            PublicFlowchart({ record: flows, data: FLOWS });
            // @ts-expect-error — the tables are Flowchart.over's
            PublicFlowchart({ data: INBOUND_VALUE, states: STATE_ROWS });
        });
    };
    assert.equal(typeof never, "function");
});
