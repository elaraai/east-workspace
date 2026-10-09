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
 * prop; the tag's forms, type by type; the frame's (#1245): the keys its
 * panes keep their state under, and no height of its own — the flowchart fills
 * the box it is given; the flows' (#1246): the Flows tab on the wire,
 * refused twice and over one flow, the keys the open flow and LR · TD are
 * kept under, and the editing session's Save over a record, a keyed batch
 * committed as one patch through the record's patch mutation; and the
 * editing's (#1247): over the host's flows, by name or one, the session's Save
 * handing the host's `onApply` one patch of its own value — by key, never the
 * whole value replaced — and every callback the flowchart took for an edit
 * refused, naming the remedy; and the library's (#1248): each tab on the wire
 * in the order `library` lists it, each data tab's cards from its own rows —
 * over an Array and over a Dict, apart from the flows and from the other tabs
 * — with what each card's drop sets, a tab listed twice refused, naming it,
 * and each data tab's other refusals; the drops' (#1249): the drop target
 * the flowchart's library's cards land on, under its name; and the
 * inspector's (#1250): on by default, `false` taking it away, a kind's own
 * Details crossing the wire over bytes — its `update` writing the edited row
 * back — the canvas carrying no hover card, and each hover prop and each
 * misuse of `inspector` refused at build, naming the remedy; and the
 * showcase's (#1251): the canvas carrying no density — it draws at one rhythm,
 * the user ruled on 2026-10-09 — and `density` refused at build.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, AsyncFunctionType, BooleanType, DictType, East, Expr, FunctionType, IntegerType, NullType, OptionType, PatchType, SortedMap,
    StringType, StructType, applyFor, compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, isTypeEqual, none, printFor, some, variant,
    type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Editing, Slice, UIComponentType } from "@elaraai/east-ui";
import { Text } from "@elaraai/east-ui/internal";
import { DatasetStatusType, RecordCommitInfoType } from "@elaraai/e3-types";
import e3 from "@elaraai/e3";
import {
    Flowchart as PublicFlowchart, Record, RecordBindHandleType, RecordBindingType, RecordErrorType, RecordMutateStatusType, RecordOutcomeType,
} from "@elaraai/e3-ui";
import { Flowchart, FlowchartCanvasType, FlowchartLibraryTabType, FlowchartPayloadType, flowchartKeys } from "@elaraai/e3-ui/internal";
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
        flowchartVariants: ex.flowchartVariants,
        flowchartLibrary: ex.flowchartLibrary,
        flowchartDepot: ex.flowchartDepot,
        flowchartHandover: ex.flowchartHandover,
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
        assert.deepEqual([payload.open, payload.name, payload.inspector, payload.readOnly, payload.library],
            [some("Returns"), some("depot"), some({ state: none, transition: none }), false, []]);
    });

    hostTest("over a record, the editing session's Apply commits its keyed batch as one patch through the record's patch mutation — a new flow's insert by name (#1246)", async () => {
        // A record whose patch write answers with the patch it was handed, printed, as the state it wrote.
        const printPatch = printFor(PatchType(FlowsType));
        const echoing = East.function([], RecordBindHandleType(FlowsType, { patch: [PatchType(FlowsType)] }), (_$) => ({
            read: East.function([], FlowsType, (_$2) => FLOWS),
            status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
            history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
            mutate: {
                pending: East.function([], BooleanType, (_$2) => false),
                status: East.function([], RecordMutateStatusType, (_$2) => variant("idle", null)),
                error: East.function([], OptionType(RecordErrorType), (_$2) => none),
                cancel: East.function([], NullType, (_$2) => null),
                patch: East.function([PatchType(FlowsType)], NullType, (_$2) => null),
            },
            commit: {
                patch: East.asyncFunction([StringType, PatchType(FlowsType)], RecordOutcomeType,
                    (_$2, requestId, patch) => variant("committed", { commitHash: requestId, stateHash: East.print(patch) })),
            },
            start: East.function([], NullType, (_$2) => null),
            binding: { name: "flows", mutations: ["patch"] },
        }) as never);
        const payload = carried(($) => PublicFlowchart({ record: $.let(echoing()) }));
        if (payload.source.type !== "record") assert.fail(`expected the record arm, got ${payload.source.type}`);
        // The session's batch: a new flow, one lane, inserted under its name.
        const night: Flow = { description: none, lanes: [{ key: "lane-1", label: some("Lane 1") }], states: [], links: [], triggers: [] };
        const ChangeSet = Editing.Types.ChangeSet(FlowType, StringType);
        const batch = encodeBeast2For(ChangeSet)({
            requestId: "r-1", base: variant("snapshot", new SortedMap([], compareFor(StringType))), label: "New flow",
            changes: [{ id: "Night shift", patch: diffFor(OptionType(FlowType))(none, some(night)), place: some(variant("keyOrder", null)) }],
        });
        const answer = await payload.source.value.apply(batch);
        const inserted = new SortedMap([["Night shift", variant("insert", night)]], compareFor(StringType));
        assert.deepEqual(answer, variant("applied", { revision: some(printPatch(variant("patch", inserted) as never)) }),
            "one commit through the patch door: the flow inserted by name, and nothing else");
    });

    hostTest("Flowchart.library.flows() is the Flows tab on the wire, over a record of flows and over the host's flows by name (#1246)", () => {
        const overRecord = carried(($) => PublicFlowchart({ record: $.let(flowsRecord()), library: [PublicFlowchart.library.flows()] }));
        const overData = carried((_$) => PublicFlowchart({ data: FLOWS, library: [PublicFlowchart.library.flows()] }));
        const noTab = carried((_$) => PublicFlowchart({ data: FLOWS, library: [] }));
        assert.deepEqual([overRecord.library, overData.library, noTab.library], [[variant("flows", null)], [variant("flows", null)], []]);
        assert.deepEqual(PublicFlowchart.library.flows(), { kind: "flows" });
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

    hostTest("the host's flows — a value, an expression or a bind handle — are the data arm's flows, with the session's Save when the host gives onApply", () => {
        const apply = East.asyncFunction([PatchType(FlowsType)], Editing.Types.ApplyResult, (_$) => variant("applied", { revision: none }));
        const asValue = carried((_$) => PublicFlowchart({ data: FLOWS, flow: "Inbound parcels" }));
        const asExpr = carried(($) => PublicFlowchart({ data: $.const(FLOWS, FlowsType), onApply: $.const(apply) }));
        const handle = East.function([], StructType({ read: FunctionType([], FlowsType) }), (_$) => ({ read: East.function([], FlowsType, (_$2) => FLOWS) }));
        const asHandle = carried(($) => PublicFlowchart({ data: $.let(handle()) }));
        for (const [form, payload, applies] of [["value", asValue, false], ["expression", asExpr, true], ["bind handle", asHandle, false]] as const) {
            if (payload.source.type !== "data" || payload.source.value.type !== "flows") assert.fail(`${form}: expected the data arm's flows`);
            assert.ok(flowsEqual(payload.source.value.value.value, FLOWS), `${form}: the flows`);
            assert.equal(payload.source.value.value.apply.type, applies ? "some" : "none", `${form}: the session's Save`);
        }
        assert.deepEqual(asValue.open, some("Inbound parcels"));
    });

    hostTest("over the host's flows by name, the session's Save hands the host's onApply one patch of the flows, by name — an update, an insert, a delete — never the whole value replaced (#1247, FB22)", async () => {
        // The host's commit answers with the patch it was handed, printed, as the revision.
        const printPatch = printFor(PatchType(FlowsType));
        const echo = East.asyncFunction([PatchType(FlowsType)], Editing.Types.ApplyResult,
            (_$, patch) => variant("applied", { revision: some(East.print(patch)) }));
        const payload = carried(($) => PublicFlowchart({ data: FLOWS, onApply: $.const(echo) }));
        if (payload.source.type !== "data" || payload.source.value.type !== "flows") assert.fail("expected the data arm's flows");
        const save = payload.source.value.value.apply;
        if (save.type !== "some") assert.fail("expected the session's Save");
        const ChangeSet = Editing.Types.ChangeSet(FlowType, StringType);
        const optionDiff = diffFor(OptionType(FlowType));
        /** The session's batch over one flow of the host's, as it stood, and as the drafts leave it. */
        const batchOf = (name: string, before: Flow | undefined, after: Flow | undefined) => encodeBeast2For(ChangeSet)({
            requestId: `r-${name}`, label: "Save",
            base: variant("snapshot", new SortedMap(before === undefined ? [] : [[name, before]], compareFor(StringType))),
            changes: [{ id: name, patch: optionDiff(before === undefined ? none : some(before), after === undefined ? none : some(after)), place: before === undefined ? some(variant("keyOrder", null)) : none }],
        });
        // What the host's commit is handed: the diff of its whole value, before the drafts and after — by name.
        const flowsDiff = diffFor(FlowsType);
        const applyFlows = applyFor(FlowsType);
        const hostAfter = (name: string, flow: Flow | undefined): Flows => {
            const after = new SortedMap(FLOWS, compareFor(StringType));
            if (flow === undefined) after.delete(name);
            else after.set(name, flow);
            return after;
        };

        // An update: the returns flow's lane renamed — its update by name, which reaches it alone.
        const renamed: Flow = { ...RETURNS_VALUE, lanes: [{ key: "counter", label: some("Front counter") }] };
        const update = flowsDiff(FLOWS, hostAfter("Returns", renamed));
        assert.deepEqual(await save.value(batchOf("Returns", RETURNS_VALUE, renamed)), variant("applied", { revision: some(printPatch(update)) }));
        assert.equal(update.type, "patch");
        assert.ok(flowsEqual(applyFlows(FLOWS, update), hostAfter("Returns", renamed)));

        // An insert: a new flow by name.
        const night: Flow = { description: none, lanes: [{ key: "lane-1", label: some("Lane 1") }], states: [], links: [], triggers: [] };
        const insert = flowsDiff(FLOWS, hostAfter("Night shift", night));
        assert.deepEqual(await save.value(batchOf("Night shift", undefined, night)), variant("applied", { revision: some(printPatch(insert)) }));

        // A delete: the flow by name — its one-flow snapshot emptied, whose own diff would replace the
        // host's whole value; the host's other flows stay.
        const removal = flowsDiff(FLOWS, hostAfter("Returns", undefined));
        assert.deepEqual(await save.value(batchOf("Returns", RETURNS_VALUE, undefined)), variant("applied", { revision: some(printPatch(removal)) }));
        assert.equal(removal.type, "patch");
        assert.deepEqual([...applyFlows(FLOWS, removal).keys()], ["Inbound parcels"]);
    });

    hostTest("over the host's one flow, the session's Save hands the host's onApply the flow's own patch; adding or removing the flow is refused (#1247, FB22)", async () => {
        const printPatch = printFor(PatchType(FlowType));
        const echo = East.asyncFunction([PatchType(FlowType)], Editing.Types.ApplyResult,
            (_$, patch) => variant("applied", { revision: some(East.print(patch)) }));
        const payload = carried(($) => PublicFlowchart({ data: INBOUND_VALUE, onApply: $.const(echo) }));
        if (payload.source.type !== "data" || payload.source.value.type !== "flow") assert.fail("expected the data arm's flow");
        const save = payload.source.value.value.apply;
        if (save.type !== "some") assert.fail("expected the session's Save");
        const ChangeSet = Editing.Types.ChangeSet(FlowType, StringType);
        const optionDiff = diffFor(OptionType(FlowType));
        // A state moved to another lane: the flow's patch, and nothing about its entry.
        const moved: Flow = { ...INBOUND_VALUE, states: [INBOUND_VALUE.states[0]!, { ...INBOUND_VALUE.states[1]!, lane: "intake" }] };
        const batch = encodeBeast2For(ChangeSet)({
            requestId: "r-one", label: "Move state", base: variant("snapshot", new SortedMap([["", INBOUND_VALUE]], compareFor(StringType))),
            changes: [{ id: "", patch: optionDiff(some(INBOUND_VALUE), some(moved)), place: none }],
        });
        const patch = diffFor(FlowType)(INBOUND_VALUE, moved);
        assert.deepEqual(await save.value(batch), variant("applied", { revision: some(printPatch(patch)) }));
        assert.ok(flowEqual(applyFor(FlowType)(INBOUND_VALUE, patch), moved));
        // One flow is changed in place: a batch removing it reaches no host.
        const removal = encodeBeast2For(ChangeSet)({
            requestId: "r-gone", label: "Delete", base: variant("snapshot", new SortedMap([["", INBOUND_VALUE]], compareFor(StringType))),
            changes: [{ id: "", patch: optionDiff(some(INBOUND_VALUE), none), place: none }],
        });
        assert.deepEqual(await save.value(removal), variant("rejected", [{ entry: "", row: none, field: none, message: "One flow is changed in place: Save never adds or removes it" }]));
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

    hostTest("the canvas carries today's options, none for every one left out — and no height: the flowchart fills its box (#1245); no hover card: the inspector shows what is selected (#1250); no density: it draws at one rhythm (#1251)", () => {
        assert.deepEqual(Object.keys(FlowchartCanvasType.fields).filter((field) => /height|hover|density/iu.test(field)), []);
        const payload = carried((_$) => PublicFlowchart({ data: INBOUND_VALUE }));
        const canvas = payload.canvas;
        for (const [field, value] of Object.entries(canvas)) assert.deepEqual(value, none, `canvas.${field} is none`);
        const given = carried(($) => PublicFlowchart({
            data: INBOUND_VALUE, orientation: "TD", legend: false, minimap: true,
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
            variant("states", { name: some("Steps"), icon: some("box"), cards: [{ key: "HLD", label: "Hold", meta: some("hold"), group: none,
                sets: { key: some("HLD"), label: some(some("Held")), lane: none, members: none, notes: none } }] }),
            variant("transitions", { name: none, icon: none, cards: [{ key: "obs", label: "Observed", meta: none, group: none,
                sets: { key: none, from: none, to: none, kind: some(some(variant("observed", null))), trigger: none, evidence: none } }] }),
            variant("tab", { name: "Owners", icon: none, lands: variant("decision", [{ key: "desk", label: "Customs desk", meta: none, group: none,
                sets: { key: none, label: none, letter: none, owner: some(some("customs-desk")), queue: none, outcomes: none } }]) }),
            variant("tab", { name: "Notes", icon: none, lands: variant("none", [{ key: "n1", label: "Read me", meta: none, group: none }]) }),
        ];
        const tabsType = ArrayType(FlowchartLibraryTabType);
        assert.ok(equalFor(tabsType)(decodeBeast2For(tabsType)(encodeBeast2For(tabsType)(tabs)), tabs));
    });

    hostTest("a flowchart keeps its frame's panes (#1245), its open flow, its library, LR · TD (#1246) and its drop target (#1249) under its name", () => {
        assert.deepEqual(flowchartKeys(undefined), {
            frame: "flowchart.frame", flow: "flowchart.flow", library: "flowchart.library", orientation: "flowchart.orientation", surface: "flowchart.surface",
        });
        assert.deepEqual(flowchartKeys("depot"), {
            frame: "flowchart.depot.frame", flow: "flowchart.depot.flow", library: "flowchart.library.depot", orientation: "flowchart.depot.orientation",
            surface: "flowchart.depot.surface",
        });
    });
});

// ============================================================================
// The inspector (#1250, FB44, FB45)
// ============================================================================

describe("the inspector (#1250, FB44, FB45)", () => {
    const StateType = Flowchart.Types.State;
    const LinkType = Flowchart.Types.Link;
    /** Each kind's Details its form: the pane with no author's own. */
    const FORMS = some({ state: none, transition: none });

    hostTest("is on by default — no prop, `true` and `{}` give the pane, each kind's Details its form — and `false` takes it away (FB44)", () => {
        const cases: [string, ($: BlockBuilder<UIComponentType>) => object, ValueTypeOf<typeof FlowchartPayloadType>["inspector"]][] = [
            ["no prop", (_$) => ({ data: FLOWS }), FORMS],
            ["true", (_$) => ({ data: FLOWS, inspector: true }), FORMS],
            ["{}", (_$) => ({ data: FLOWS, inspector: {} }), FORMS],
            ["false", (_$) => ({ data: FLOWS, inspector: false }), none],
            ["no prop, over a record", ($) => ({ record: $.let(flowsRecord()) }), FORMS],
            ["false, over a record", ($) => ({ record: $.let(flowsRecord()), inspector: false }), none],
        ];
        for (const [what, props, expected] of cases) {
            assert.deepEqual(carried(($) => PublicFlowchart(props($) as never)).inspector, expected, what);
        }
    });

    hostTest("a kind's own Details cross the wire over bytes: the state's is called with the state selected, its `update` writing the edited state back; the transition's Details stay its form (FB45)", () => {
        const payload = carried(($) => PublicFlowchart({
            data: FLOWS,
            inspector: {
                state: $.const(East.function([StateType, FunctionType([StateType], NullType)], UIComponentType, ($2, s, update) => {
                    const held = $2.const({ key: s.key, label: some("Held"), lane: s.lane, members: s.members, notes: s.notes }, StateType);
                    $2(update(held));
                    return Text.Root(s.key);
                })),
            },
        }));
        if (payload.inspector.type !== "some") assert.fail("the pane is on");
        const own = payload.inspector.value.state;
        if (own.type !== "some") assert.fail("the state's own Details ride the wire");
        assert.equal(payload.inspector.value.transition.type, "none", "a transition's Details are its form");
        const chutes = INBOUND_VALUE.states[1]!;
        const written: Uint8Array[] = [];
        const ui = own.value(encodeBeast2For(StateType)(chutes), (bytes: Uint8Array) => { written.push(bytes); return null; });
        const expected = East.compile(East.function([], UIComponentType, (_$) => Text.Root("CH*")), [])();
        assert.ok(equalFor(UIComponentType)(ui, expected), "the author's UI, over the state given");
        assert.equal(written.length, 1);
        assert.ok(equalFor(StateType)(decodeBeast2For(StateType)(written[0]!), { ...chutes, label: some("Held") }), "update wrote the edited state, as a state's bytes");
    });

    hostTest("a transition's own Details are called with the transition selected, and its `update` writes the edited transition back", () => {
        const payload = carried(($) => PublicFlowchart({
            data: FLOWS,
            inspector: {
                transition: $.const(East.function([LinkType, FunctionType([LinkType], NullType)], UIComponentType, ($2, l, update) => {
                    const observed = $2.const({ key: l.key, from: l.from, to: l.to, kind: some(variant("observed", null)), trigger: l.trigger, evidence: l.evidence }, LinkType);
                    $2(update(observed));
                    return Text.Root(l.to);
                })),
            },
        }));
        if (payload.inspector.type !== "some" || payload.inspector.value.transition.type !== "some") assert.fail("the transition's own Details ride the wire");
        assert.equal(payload.inspector.value.state.type, "none", "a state's Details are its form");
        const link = INBOUND_VALUE.links[1]!;
        const written: Uint8Array[] = [];
        payload.inspector.value.transition.value(encodeBeast2For(LinkType)(link), (bytes: Uint8Array) => { written.push(bytes); return null; });
        assert.ok(equalFor(LinkType)(decodeBeast2For(LinkType)(written[0]!), { ...link, kind: some(variant("observed", null)) }));
    });
});

// ============================================================================
// The library (#1248, §4.2, FB25–FB29): each tab's cards from its own rows
// ============================================================================

/** A step type: the state templates' row. */
const StepRow = StructType({ code: StringType, name: StringType, kind: StringType, slots: OptionType(IntegerType) });
type Step = ValueTypeOf<typeof StepRow>;
/** The step types, an Array: a key that repeats — the hold's — keeps its first card. */
const STEPS: Step[] = [
    { code: "HLD", name: "Held", kind: "Hold", slots: none },
    { code: "CH*", name: "Sort chutes", kind: "Sort", slots: some(14n) },
    { code: "HLD", name: "Held again", kind: "Hold", slots: none },
];
/** A transition type, by name: the transition templates' row. */
const MoveRow = StructType({ kind: Flowchart.Types.Kind, decision: OptionType(StringType) });
type Move = ValueTypeOf<typeof MoveRow>;
/** The transition types, a Dict: by name, in name order. */
const MOVES = new SortedMap<string, Move>([
    ["Routed", { kind: variant("planned", null), decision: some("route") }],
    ["Observed", { kind: variant("observed", null), decision: none }],
], compareFor(StringType));
/** A role that owns a decision: the author's tab's row. */
const OwnerRow = StructType({ role: StringType, desk: StringType });
const OWNERS: ValueTypeOf<typeof OwnerRow>[] = [{ role: "customs-desk", desk: "Hold bay" }, { role: "sort-planner", desk: "Sort hall" }];

type LibraryWire = ValueTypeOf<typeof FlowchartLibraryTabType>[];

/** The state templates' tab over its rows: each card's key its code, the line under it its code, grouped by its kind. */
function stepsTab(rows: Parameters<typeof PublicFlowchart.library.states<typeof StepRow>>[0]) {
    return PublicFlowchart.library.states(rows, {
        name: "Steps", icon: "box",
        key: (s) => s.code, label: (s) => s.name, meta: (s) => some(s.code), group: (s) => s.kind,
        drop: (s) => PublicFlowchart.patch(PublicFlowchart.Types.State, { key: s.code, label: some(s.name), members: s.slots }),
    });
}

/** The transition templates' tab over its rows, unnamed: each card keyed and labelled by the row's key. */
function movesTab(rows: Parameters<typeof PublicFlowchart.library.transitions<typeof MoveRow>>[0]) {
    return PublicFlowchart.library.transitions(rows, {
        key: (_m, name) => name, label: (_m, name) => name,
        drop: (m) => PublicFlowchart.patch(PublicFlowchart.Types.Link, { kind: some(m.kind), trigger: m.decision }),
    });
}

/** The author's Owners tab over its rows: a role dropped on a decision owns it. */
function ownersTab(rows: Parameters<typeof PublicFlowchart.library.tab<typeof OwnerRow>>[0]) {
    return PublicFlowchart.library.tab(rows, {
        name: "Owners", icon: "user-tie",
        key: (o) => o.role, label: (o) => o.role, meta: (o) => some(o.desk),
        drop: (o) => PublicFlowchart.patch(PublicFlowchart.Types.Trigger, { owner: some(o.role) }),
    });
}

/** The state templates' cards over STEPS: the hold's first row, then the chutes. */
const STEP_CARDS = [
    { key: "HLD", label: "Held", meta: some("HLD"), group: some("Hold"), sets: { key: some("HLD"), label: some(some("Held")), lane: none, members: some(none), notes: none } },
    { key: "CH*", label: "Sort chutes", meta: some("CH*"), group: some("Sort"), sets: { key: some("CH*"), label: some(some("Sort chutes")), lane: none, members: some(some(14n)), notes: none } },
];
/** The transition templates' cards over MOVES, in name order. */
const MOVE_CARDS = [
    { key: "Observed", label: "Observed", meta: none, group: none, sets: { key: none, from: none, to: none, kind: some(some(variant("observed", null))), trigger: some(none), evidence: none } },
    { key: "Routed", label: "Routed", meta: none, group: none, sets: { key: none, from: none, to: none, kind: some(some(variant("planned", null))), trigger: some(some("route")), evidence: none } },
];
/** The Owners tab's cards over OWNERS: each sets a decision's owner. */
const OWNER_CARDS = OWNERS.map((o) => ({
    key: o.role, label: o.role, meta: some(o.desk), group: none,
    sets: { key: none, label: none, letter: none, owner: some(some(o.role)), queue: none, outcomes: none },
}));

describe("the library (#1248, FB25–FB29)", () => {
    hostTest("each tab on the wire, in the order `library` lists it: the Flows tab, then each data tab's cards from its own rows — over an Array and over a Dict — each with what its drop sets", () => {
        const payload = carried(($) => PublicFlowchart({
            record: $.let(flowsRecord()),
            library: [
                PublicFlowchart.library.flows(),
                stepsTab($.const(STEPS, ArrayType(StepRow))),
                movesTab($.const(MOVES, DictType(StringType, MoveRow))),
                ownersTab($.const(OWNERS, ArrayType(OwnerRow))),
            ],
        }));
        const expected: LibraryWire = [
            variant("flows", null),
            // An Array: the hold's first row kept, its repeat folded; each card the state its drop seeds.
            variant("states", { name: some("Steps"), icon: some("box"), cards: STEP_CARDS }),
            // A Dict: keyed by its keys, in their order; unnamed, so the renderer names it.
            variant("transitions", { name: none, icon: none, cards: MOVE_CARDS }),
            // An author's tab whose drop is a decision's patch: its cards land on a decision.
            variant("tab", { name: "Owners", icon: some("user-tie"), lands: variant("decision", OWNER_CARDS) }),
        ];
        assert.deepEqual(payload.library, expected);
    });

    hostTest("an author's tab without a drop is read, never dragged; over an Array a row's key is its index, printed, and over a Dict its key", () => {
        const payload = carried(($) => PublicFlowchart({
            data: INBOUND_VALUE,
            library: [
                PublicFlowchart.library.tab($.const(OWNERS, ArrayType(OwnerRow)), { name: "Desks", key: (_o, i) => i, label: (o) => o.desk }),
                PublicFlowchart.library.tab($.const(MOVES, DictType(StringType, MoveRow)), { name: "Moves", key: (_m, name) => name, label: (_m, name) => name, group: (m) => m.decision.match({ some: () => "decided", none: () => "free" }) }),
            ],
        }));
        const expected: LibraryWire = [
            variant("tab", { name: "Desks", icon: none, lands: variant("none", [
                { key: "0", label: "Hold bay", meta: none, group: none },
                { key: "1", label: "Sort hall", meta: none, group: none },
            ]) }),
            variant("tab", { name: "Moves", icon: none, lands: variant("none", [
                { key: "Observed", label: "Observed", meta: none, group: some("free") },
                { key: "Routed", label: "Routed", meta: none, group: some("decided") },
            ]) }),
        ];
        assert.deepEqual(payload.library, expected);
    });

    hostTest("an author's drop lands where its patch's type says: a state, a transition, a lane's header or a decision's diamond", () => {
        const payload = carried(($) => {
            const rows = $.const(OWNERS, ArrayType(OwnerRow));
            const owners = (name: string, drop: (o: ExprType<typeof OwnerRow>) => unknown) =>
                PublicFlowchart.library.tab(rows, { name, key: (o) => o.role, label: (o) => o.role, drop: drop as never });
            return PublicFlowchart({
                data: INBOUND_VALUE,
                library: [
                    owners("On a state", (o) => PublicFlowchart.patch(PublicFlowchart.Types.State, { notes: some(o.desk) })),
                    owners("On a transition", (o) => PublicFlowchart.patch(PublicFlowchart.Types.Link, { trigger: some(o.role) })),
                    owners("On a lane", (o) => PublicFlowchart.patch(PublicFlowchart.Types.Lane, { label: some(o.desk) })),
                    owners("On a decision", (o) => PublicFlowchart.patch(PublicFlowchart.Types.Trigger, { owner: some(o.role) })),
                ],
            });
        });
        assert.deepEqual(payload.library.map((tab) => (tab.type === "tab" ? [tab.value.name, tab.value.lands.type, tab.value.lands.value.length] : tab.type)), [
            ["On a state", "state", 2], ["On a transition", "transition", 2], ["On a lane", "lane", 2], ["On a decision", "decision", 2],
        ]);
        const onLane = payload.library[2]!;
        if (onLane.type !== "tab" || onLane.value.lands.type !== "lane") assert.fail("expected the lane's cards");
        assert.deepEqual(onLane.value.lands.value[0], { key: "customs-desk", label: "customs-desk", meta: none, group: none, sets: { key: none, label: some(some("Hold bay")) } });
    });

    hostTest("each tab takes its own bound data — a record's rows, an input's — apart from the flows and from the other tabs (the user, 2026-10-08)", () => {
        // The step types and the owners are records of their own, bound beside the record of flows.
        const stepsRecord = boundRecord(DictType(StringType, StepRow), new SortedMap([["hold", STEPS[0]!], ["chutes", STEPS[1]!]], compareFor(StringType)), false);
        const ownersRecord = boundRecord(DictType(StringType, OwnerRow), new SortedMap([["customs", OWNERS[0]!]], compareFor(StringType)), false);
        const payload = carried(($) => {
            const flows = $.let(flowsRecord());
            const steps = $.let(stepsRecord());
            const owners = $.let(ownersRecord());
            return PublicFlowchart({
                record: flows,
                library: [PublicFlowchart.library.flows(), stepsTab(steps.read()), ownersTab(owners.read()), movesTab($.const(MOVES, DictType(StringType, MoveRow)))],
            });
        });
        const cardKeys = (tab: LibraryWire[number]) => {
            switch (tab.type) {
                case "flows": return [];
                case "states": return tab.value.cards.map((c) => c.key);
                case "transitions": return tab.value.cards.map((c) => c.key);
                case "tab": return tab.value.lands.value.map((c) => c.key);
            }
        };
        // Each tab's cards are its own rows', none of the flows' states, nor another tab's rows.
        assert.deepEqual(payload.library.map(cardKeys), [[], ["CH*", "HLD"], ["customs-desk"], ["Observed", "Routed"]]);
        const flowStates = new Set([...FLOWS.values()].flatMap((f) => f.states.map((s) => s.key)));
        assert.deepEqual(cardKeys(payload.library[1]!).filter((key) => flowStates.has(key)), ["CH*"], "a step type may share a code with a flow's state: its card is the row's");
        if (payload.library[1]!.type !== "states") assert.fail("expected the state templates");
        assert.deepEqual(payload.library[1]!.value.cards.map((c) => c.label), ["Sort chutes", "Held"], "the record's rows, by key: its labels, not the flow's");
        // The flows are the record's own, read where the renderer reads them.
        if (payload.source.type !== "record") assert.fail("expected the record arm");
        assert.ok(flowsEqual(payload.source.value.read(), FLOWS));
    });

    hostTest("a template tab left unnamed is named by the renderer; named, its name rides the wire (FB25)", () => {
        const payload = carried(($) => PublicFlowchart({
            data: FLOWS,
            library: [
                PublicFlowchart.library.states($.const(STEPS, ArrayType(StepRow)), { key: (s) => s.code, label: (s) => s.name,
                    drop: (s) => PublicFlowchart.patch(PublicFlowchart.Types.State, { key: s.code }) }),
                PublicFlowchart.library.transitions($.const(MOVES, DictType(StringType, MoveRow)), { name: "Retypes", key: (_m, n) => n, label: (_m, n) => n,
                    drop: (m) => PublicFlowchart.patch(PublicFlowchart.Types.Link, { kind: some(m.kind) }) }),
            ],
        }));
        assert.deepEqual(payload.library.map((tab) => (tab.type === "states" || tab.type === "transitions" ? [tab.type, tab.value.name, tab.value.icon] : [tab.type])), [
            ["states", none, none], ["transitions", some("Retypes"), none],
        ]);
    });

    hostTest("a template tab's cards and a one-flow flowchart: over one flow the library takes every tab but the Flows tab (FB16)", () => {
        const payload = carried(($) => PublicFlowchart({
            data: INBOUND_VALUE,
            library: [stepsTab($.const(STEPS, ArrayType(StepRow))), movesTab($.const(MOVES, DictType(StringType, MoveRow))), ownersTab($.const(OWNERS, ArrayType(OwnerRow)))],
        }));
        assert.deepEqual(payload.library.map((tab) => tab.type), ["states", "transitions", "tab"]);
    });

    for (const [field, sets] of [
        ["key", { key: some("moved") }],
        ["from", { from: "ARV" }],
        ["to", { to: "LDD" }],
    ] as const) {
        hostTest(`a transition card whose drop sets the transition's \`${field}\` is refused as the tab's cards are read, naming the tab, the card and the field (#1248, §4.4)`, () => {
            const refusal = new RegExp(`Flowchart: Flowchart\\.library\\.transitions\\(\\)'s card "Routed" sets a transition's \`${field}\` — a transition card retypes the transition it lands on, its kind, its decision and its other fields, never its key or its ends: leave \`key\`, \`from\` and \`to\` out of its Flowchart\\.patch`);
            assert.throws(() => carried(($) => PublicFlowchart({
                data: FLOWS,
                library: [PublicFlowchart.library.transitions($.const(MOVES, DictType(StringType, MoveRow)), {
                    key: (_m, name) => name, label: (_m, name) => name,
                    // The observed move retypes; the routed one, in name order the second, also rewires.
                    drop: (m) => m.decision.match({
                        some: () => PublicFlowchart.patch(PublicFlowchart.Types.Link, { kind: some(m.kind), ...sets } as never),
                        none: () => PublicFlowchart.patch(PublicFlowchart.Types.Link, { kind: some(m.kind) }),
                    }),
                })],
            })), refusal);
        });
    }
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
        ["`height`, which the box the flowchart fills sets (#1245)", (_$) => ({ data: INBOUND_VALUE, height: "560px" }),
            /^Error: Flowchart: `height` is not a prop — the flowchart fills the box it is given; give it a box of its own height: <Box height="560px"><Flowchart … \/><\/Box>$/],
        ["`maxHeight`, which the box the flowchart fills sets (#1245)", (_$) => ({ data: INBOUND_VALUE, maxHeight: "560px" }),
            /^Error: Flowchart: `maxHeight` is not a prop — the flowchart fills the box it is given/],
        ["`density` over the host's flow: the canvas draws at one rhythm (#1251, the user's ruling, 2026-10-09)", (_$) => ({ data: INBOUND_VALUE, density: "compact" }),
            /^Error: Flowchart: `density` is not a prop — the canvas draws at one rhythm, the spec's 116×40 state cards in their lanes; leave `density` out$/],
        ["`density` over a record: the canvas draws at one rhythm (#1251)", ($) => ({ record: $.let(flowsRecord()), density: "comfortable" }),
            /^Error: Flowchart: `density` is not a prop — the canvas draws at one rhythm, the spec's 116×40 state cards in their lanes; leave `density` out$/],
        ["the Flows tab over one flow (#1246, FB16)", (_$) => ({ data: INBOUND_VALUE, library: [Flowchart.library.flows()] }),
            /^Error: Flowchart: Flowchart\.library\.flows\(\) lists flows by name, and this `data` is one flow, Flowchart\.Types\.Flow — leave the Flows tab out of `library`, or pass the flows by name$/],
        ["the Flows tab listed twice (#1246)", ($) => ({ record: $.let(flowsRecord()), library: [Flowchart.library.flows(), Flowchart.library.flows()] }),
            /^Error: Flowchart: the library lists Flowchart\.library\.flows\(\) twice — each tab once$/],
        ["a `library` that is no list of Flowchart.library calls (#1246)", (_$) => ({ data: FLOWS, library: [{ kind: "rows" }] }),
            /^Error: Flowchart: `library` lists the library pane's tabs, each a Flowchart\.library\.\* call — library=\{\[Flowchart\.library\.flows\(\)\]\}$/],
        ["a template tab without the rows it reads, which no Flowchart.library call makes (#1248)", (_$) => ({ data: FLOWS, library: [{ kind: "states" }] }),
            /^Error: Flowchart: `library` lists the library pane's tabs, each a Flowchart\.library\.\* call — library=\{\[Flowchart\.library\.flows\(\)\]\}$/],
        ["the state templates listed twice, naming the tab (#1248, FB29)", ($) => ({ record: $.let(flowsRecord()), library: [stepsTab($.const(STEPS, ArrayType(StepRow))), stepsTab($.const([], ArrayType(StepRow)))] }),
            /^Error: Flowchart: the library lists Flowchart\.library\.states\(\) twice — each tab once$/],
        ["the transition templates listed twice, naming the tab (#1248, FB29)", ($) => ({ data: FLOWS, library: [movesTab($.const(MOVES, DictType(StringType, MoveRow))), movesTab($.const(MOVES, DictType(StringType, MoveRow)))] }),
            /^Error: Flowchart: the library lists Flowchart\.library\.transitions\(\) twice — each tab once$/],
        ["two of the author's tabs of one name, naming it (#1248, FB29)", ($) => ({ data: INBOUND_VALUE, library: [ownersTab($.const(OWNERS, ArrayType(OwnerRow))), ownersTab($.const([], ArrayType(OwnerRow)))] }),
            /^Error: Flowchart: the library lists two tabs named "Owners" — each tab's name is its own$/],
        ["a data tab's rows that are no collection (#1248, §4.4)", ($) => ({ data: FLOWS, library: [PublicFlowchart.library.states($.const(7n) as never, { key: () => "k", label: () => "l", drop: () => PublicFlowchart.patch(PublicFlowchart.Types.State, {}) })] }),
            /^Error: Flowchart: Flowchart\.library\.states\(\) reads its rows as an Array<T> or a Dict<String, T> — a value, or an expression such as a binding's read\(\), its own apart from the flows and the other tabs — and these are \.Integer$/],
        ["a data tab's rows by keys that are no String (#1248, §4.4)", ($) => ({ data: FLOWS, library: [PublicFlowchart.library.tab($.const(new SortedMap([[1n, "one"]], compareFor(IntegerType)), DictType(IntegerType, StringType)) as never, { name: "Numbers", key: () => "k", label: () => "l" })] }),
            /^Error: Flowchart: the "Numbers" tab reads its rows as an Array<T> or a Dict<String, T> — .* — and these are \.Dict/],
        ["a state template's drop over another row than a state (#1248, §4.4)", ($) => ({ data: FLOWS, library: [PublicFlowchart.library.states($.const(STEPS, ArrayType(StepRow)), { key: (s) => s.code, label: (s) => s.name, drop: (() => PublicFlowchart.patch(PublicFlowchart.Types.Lane, {})) as never })] }),
            /^Error: Flowchart: Flowchart\.library\.states\(\)'s `drop` returns the fields of the state a card adds — Flowchart\.patch\(Flowchart\.Types\.State, \{ … \}\) — and this one returns \.Struct/],
        ["a transition template's drop over another row than a transition (#1248, §4.4)", ($) => ({ data: FLOWS, library: [PublicFlowchart.library.transitions($.const(MOVES, DictType(StringType, MoveRow)), { key: (_m, n) => n, label: (_m, n) => n, drop: (() => PublicFlowchart.patch(PublicFlowchart.Types.State, {})) as never })] }),
            /^Error: Flowchart: Flowchart\.library\.transitions\(\)'s `drop` returns the fields a card sets on the transition it lands on — Flowchart\.patch\(Flowchart\.Types\.Link, \{ … \}\) — and this one returns \.Struct/],
        ["an author's drop over none of a flow's rows (#1248, §4.4)", ($) => ({ data: FLOWS, library: [PublicFlowchart.library.tab($.const(OWNERS, ArrayType(OwnerRow)), { name: "Jobs", key: (o) => o.role, label: (o) => o.role, drop: (o) => East.value({ task: some(o.role) }, StructType({ task: OptionType(StringType) })) })] }),
            /^Error: Flowchart: the "Jobs" tab's `drop` returns a patch over one of a flow's rows, its type naming what a card lands on — Flowchart\.patch\(Flowchart\.Types\.State, Link, Lane or Trigger, \{ … \}\) — and this one returns \.Struct/],
    ];
    // Every callback the flowchart took for an edit, and `linkMode`, over either source (#1247, FB24).
    const callbacks: [string, ($: BlockBuilder<NullType>) => unknown][] = [
        ["linkMode", (_$) => "connect"],
        ["onCreateLink", ($) => $.const(East.function([StructType({ from: StringType, to: StringType })], NullType, (_$2) => null))],
        ["onDeleteLink", ($) => $.const(East.function([StringType], NullType, (_$2) => null))],
        ["onAddLane", ($) => $.const(East.function([], NullType, (_$2) => null))],
        ["onRenameLane", ($) => $.const(East.function([StructType({ key: StringType, label: StringType })], NullType, (_$2) => null))],
        ["onDeleteLane", ($) => $.const(East.function([StringType], NullType, (_$2) => null))],
        ["onAddState", ($) => $.const(East.function([StructType({ lane: StringType, key: StringType, label: StringType })], NullType, (_$2) => null))],
        ["onEditState", ($) => $.const(East.function([StructType({ key: StringType, code: StringType, label: StringType })], NullType, (_$2) => null))],
        ["onMoveState", ($) => $.const(East.function([StructType({ key: StringType, lane: StringType })], NullType, (_$2) => null))],
    ];
    for (const [callback, given] of callbacks) {
        const refusal = new RegExp(`^Error: Flowchart: \`${callback}\` is not a prop — every gesture is a transaction of the flowchart's editing session, and Save commits them as one patch: over \`record\`, through its patch mutation; over \`data\`, through the host's \`onApply\`$`);
        refusals.push([`\`${callback}\` over a record — the session's gestures replace it (#1247, FB24)`, ($) => ({ record: $.let(flowsRecord()), [callback]: given($) }), refusal]);
        refusals.push([`\`${callback}\` over the host's flow — the session's gestures replace it (#1247, FB24)`, ($) => ({ data: INBOUND_VALUE, [callback]: given($) }), refusal]);
    }
    /** A refusal's exact words, as the pattern a test matches. */
    const exactly = (text: string): RegExp => new RegExp(`^Error: ${text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`);
    // Each hover card's builder, over either source (#1250, FB46): the hover cards went, and the inspector names the remedy.
    const hover = ($: BlockBuilder<NullType>) => $.const(East.function([StringType], UIComponentType, (_$2, key) => Text.Root(key)));
    const HOVER_REMEDIES = [
        ["stateHover", "give a state its own Details with inspector={{ state: East.function([Flowchart.Types.State, FunctionType([Flowchart.Types.State], NullType)], UIComponentType, ($, state, update) => …) }}"],
        ["linkHover", "give a transition its own Details with inspector={{ transition: East.function([Flowchart.Types.Link, FunctionType([Flowchart.Types.Link], NullType)], UIComponentType, ($, link, update) => …) }}"],
        ["triggerHover", "a decision's Details are its form — every field, and the transitions it governs"],
    ] as const;
    for (const [prop, remedy] of HOVER_REMEDIES) {
        const refusal = exactly(`Flowchart: \`${prop}\` is not a prop — the hover cards went, and the inspector, on by default, shows what is selected: ${remedy}`);
        refusals.push([`\`${prop}\` over a record — the inspector replaces it (#1250, FB46)`, ($) => ({ record: $.let(flowsRecord()), [prop]: hover($) }), refusal]);
        refusals.push([`\`${prop}\` over the host's flow — the inspector replaces it (#1250, FB46)`, ($) => ({ data: INBOUND_VALUE, [prop]: hover($) }), refusal]);
    }
    // `inspector` of another kind, a key it does not take, and a kind's own Details of another type (#1250, FB44, FB45).
    const ON_BY_DEFAULT = exactly("Flowchart: `inspector` is on by default — inspector={false} removes the pane, and inspector={{ state, transition }} gives a state or a transition its own Details, each an East function over the row and its writer");
    const own = <R extends typeof Flowchart.Types.State | typeof Flowchart.Types.Link>($: BlockBuilder<NullType>, row: R) =>
        $.const(East.function([row, FunctionType([row], NullType)], UIComponentType, (_$2) => Text.Root("own")));
    const ownState = exactly("Flowchart: `inspector.state` is a state's own Details — an East function over the state and its writer: East.function([Flowchart.Types.State, FunctionType([Flowchart.Types.State], NullType)], UIComponentType, ($, state, update) => …)");
    const ownTransition = exactly("Flowchart: `inspector.transition` is a transition's own Details — an East function over the transition and its writer: East.function([Flowchart.Types.Link, FunctionType([Flowchart.Types.Link], NullType)], UIComponentType, ($, link, update) => …)");
    refusals.push(
        ["an `inspector` that is a word (#1250)", (_$) => ({ data: INBOUND_VALUE, inspector: "on" }), ON_BY_DEFAULT],
        ["an `inspector` that is a function: a kind's own Details are given by kind (#1250)", ($) => ({ data: INBOUND_VALUE, inspector: own($, Flowchart.Types.State) }), ON_BY_DEFAULT],
        ["an `inspector` naming a kind it gives no own Details for (#1250)", ($) => ({ data: INBOUND_VALUE, inspector: { decision: own($, Flowchart.Types.State) } }),
            exactly("Flowchart: `inspector` gives a state or a transition its own Details — { state, transition } — and `decision` is neither: every other kind's Details are its form")],
        ["a state's own Details over a transition (#1250, FB45)", ($) => ({ data: INBOUND_VALUE, inspector: { state: own($, Flowchart.Types.Link) } }), ownState],
        ["a state's own Details that return no UI (#1250, FB45)", ($) => ({ data: INBOUND_VALUE, inspector: { state: $.const(East.function([Flowchart.Types.State, FunctionType([Flowchart.Types.State], NullType)], StringType, (_$2, s) => s.key)) } }), ownState],
        ["a transition's own Details over a state (#1250, FB45)", ($) => ({ record: $.let(flowsRecord()), inspector: { transition: own($, Flowchart.Types.State) } }), ownTransition],
    );
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
            PublicFlowchart({ record: flows, flow: "Returns", inspector: true, name: "depot", library: [PublicFlowchart.library.flows()] });
            PublicFlowchart({ data: FLOWS, flow: "Returns", onApply: applyFlows, slice, affordances: ["search"], library: [PublicFlowchart.library.flows()] });
            PublicFlowchart({ data: INBOUND_VALUE, onApply: applyFlow, library: [] });
            // @ts-expect-error — one flow has no Flows tab: there are no flows by name to list (#1246, FB16)
            PublicFlowchart({ data: INBOUND_VALUE, library: [PublicFlowchart.library.flows()] });
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
            // @ts-expect-error — the flowchart fills the box it is given: no height of its own (#1245)
            PublicFlowchart({ data: INBOUND_VALUE, height: "560px" });
            // @ts-expect-error — the canvas draws at one rhythm: no density (#1251)
            PublicFlowchart({ record: flows, density: "compact" });
            // @ts-expect-error — every gesture is the editing session's: no callback for an edit (#1247, FB24)
            PublicFlowchart({ record: flows, onAddState: $.const(East.function([StructType({ lane: StringType, key: StringType, label: StringType })], NullType, (_$2) => null)) });
            // @ts-expect-error — connecting is the session's whenever the flowchart edits: no link mode (#1247, FB24)
            PublicFlowchart({ data: INBOUND_VALUE, onApply: applyFlow, linkMode: "connect" });
            // The inspector (#1250): on by default, `false` taking it away, and a state's or a transition's own Details.
            PublicFlowchart({ data: INBOUND_VALUE, inspector: false });
            PublicFlowchart({ record: flows, inspector: {
                state: $.const(East.function([PublicFlowchart.Types.State, FunctionType([PublicFlowchart.Types.State], NullType)], UIComponentType, (_$2, s) => Text.Root(s.key))),
                transition: $.const(East.function([PublicFlowchart.Types.Link, FunctionType([PublicFlowchart.Types.Link], NullType)], UIComponentType, (_$2, l) => Text.Root(l.to))),
            } });
            // @ts-expect-error — the hover cards went: the inspector shows what is selected (#1250, FB46)
            PublicFlowchart({ data: INBOUND_VALUE, stateHover: $.const(East.function([StringType], UIComponentType, (_$2, key) => Text.Root(key))) });
            // @ts-expect-error — a kind's own Details are a state's or a transition's: a decision's are its form (#1250, FB45)
            PublicFlowchart({ data: INBOUND_VALUE, inspector: { decision: true } });
            // The library's data tabs (#1248): one flow takes every tab but the Flows tab.
            const steps = $.const(STEPS, ArrayType(StepRow));
            const moves = $.const(MOVES, DictType(StringType, MoveRow));
            const owners = $.const(OWNERS, ArrayType(OwnerRow));
            PublicFlowchart({ data: INBOUND_VALUE, library: [stepsTab(steps), movesTab(moves), ownersTab(owners)] });
            PublicFlowchart({ record: flows, library: [PublicFlowchart.library.flows(), stepsTab(steps), movesTab(moves), ownersTab(owners)] });
            // @ts-expect-error — a state template's drop is the fields of the state it adds (#1248)
            PublicFlowchart.library.states(steps, { key: (s) => s.code, label: (s) => s.name, drop: () => PublicFlowchart.patch(PublicFlowchart.Types.Link, {}) });
            // @ts-expect-error — a transition template's drop is the fields it sets on a transition (#1248)
            PublicFlowchart.library.transitions(moves, { key: (_m, n) => n, label: (_m, n) => n, drop: () => PublicFlowchart.patch(PublicFlowchart.Types.State, {}) });
            // @ts-expect-error — an author's tab is named: its name is its identity in `library` (#1248)
            PublicFlowchart.library.tab(owners, { key: (o) => o.role, label: (o) => o.role });
            // @ts-expect-error — a template's card is keyed (#1248)
            PublicFlowchart.library.states(steps, { label: (s) => s.name, drop: (s) => PublicFlowchart.patch(PublicFlowchart.Types.State, { key: s.code }) });
        });
    };
    assert.equal(typeof never, "function");
});
