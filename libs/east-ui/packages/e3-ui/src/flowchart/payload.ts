/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flowchart's payload (#1244, `Flowchart Builder Spec.md` §4.1, §4.4,
 * §5.2): what `<Flowchart>` hands the renderer through its `Flowchart`
 * carrier — its canvas, where its flows come from, the flow it opens first,
 * its library's tabs, its inspector, whether it is read only, and its name —
 * and every refusal of its props, made when the surface is built.
 *
 * Its flows come from one of two sources:
 * - `record`, an e3 record of `Flowchart.Types.Flows` — flows by name — bound
 *   with its patch mutation. The handle crosses the payload as the query
 *   builder's does: its `read`, its `history` and its patch write — and, for
 *   the editing session over the flows (#1246), its Apply: the session's keyed
 *   batch committed through the patch mutation by `Record.onApply(record, {
 *   keyed: true })`. A record always holds flows by name (ruled 2026-10-07:
 *   e3's patch mutation writes only keyed records), so a lone flow is a
 *   one-entry record, or the host's;
 * - `data`, the host's flows by name or one flow — a value, an expression or a
 *   bind handle — the value's type picking the arm, with the host's `onApply`
 *   when its edits are committed.
 *
 * Its library's tabs are the `Flowchart.library.*` calls `library` lists
 * (`library.ts`), on the wire in that order.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    AsyncFunctionType,
    BlobType,
    BooleanType,
    East,
    Expr,
    FunctionType,
    NullType,
    OptionType,
    PatchType,
    StringType,
    StructType,
    VariantType,
    isTypeEqual,
    isValueOf,
    none,
    printType,
    some,
    variant,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type ValueTypeOf,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { EastUI, Editing } from "@elaraai/east-ui";
import { Record as RecordBind, RecordOutcomeType } from "../bind/record.js";
import { buildCanvas, FlowchartCanvasType, type FlowchartCanvasOptions, type FlowchartSliceOptions } from "./canvas.js";
import type { FlowchartLibraryTab } from "./library.js";
import { FlowchartPatchTypeFor } from "./patch.js";
import {
    FlowchartFlowType,
    FlowchartFlowsType,
    FlowchartLaneType,
    FlowchartLinkType,
    FlowchartStateType,
    FlowchartTriggerType,
} from "./types.js";

// ============================================================================
// The library's tabs on the wire
// ============================================================================

/**
 * A card a library tab lists that drops nothing: an author's card read, never
 * dragged.
 *
 * @property key - Its identity in its tab
 * @property label - Its title
 * @property meta - A line under its title
 * @property group - The group its tab lists it under
 */
export const FlowchartCardType = StructType({
    key: StringType,
    label: StringType,
    meta: OptionType(StringType),
    group: OptionType(StringType),
});

/** Type representing {@link FlowchartCardType}. */
export type FlowchartCardType = typeof FlowchartCardType;

/**
 * A state template's card: what it shows, and the fields of the state it
 * adds, over a state's defaults — the `Flowchart.patch(Flowchart.Types.State, …)`
 * its drop returns.
 */
export const FlowchartStateCardType = StructType({
    ...FlowchartCardType.fields,
    sets: FlowchartPatchTypeFor(FlowchartStateType),
});

/** Type representing {@link FlowchartStateCardType}. */
export type FlowchartStateCardType = typeof FlowchartStateCardType;

/**
 * A transition template's card: what it shows, and the fields it sets on the
 * transition it lands on — the `Flowchart.patch(Flowchart.Types.Link, …)` its
 * drop returns.
 */
export const FlowchartTransitionCardType = StructType({
    ...FlowchartCardType.fields,
    sets: FlowchartPatchTypeFor(FlowchartLinkType),
});

/** Type representing {@link FlowchartTransitionCardType}. */
export type FlowchartTransitionCardType = typeof FlowchartTransitionCardType;

/** An author's card that lands on a lane's header, and the lane's fields it sets. */
export const FlowchartLaneCardType = StructType({
    ...FlowchartCardType.fields,
    sets: FlowchartPatchTypeFor(FlowchartLaneType),
});

/** Type representing {@link FlowchartLaneCardType}. */
export type FlowchartLaneCardType = typeof FlowchartLaneCardType;

/** An author's card that lands on a decision's diamond, and the decision's fields it sets. */
export const FlowchartDecisionCardType = StructType({
    ...FlowchartCardType.fields,
    sets: FlowchartPatchTypeFor(FlowchartTriggerType),
});

/** Type representing {@link FlowchartDecisionCardType}. */
export type FlowchartDecisionCardType = typeof FlowchartDecisionCardType;

/**
 * An author's tab's cards, by what they land on — the type of the patch its
 * `drop` returns — each card with the fields it sets there.
 *
 * @property none - The tab declares no `drop`: its cards are read, never dragged
 * @property state - Its cards land on a state
 * @property transition - Its cards land on a transition
 * @property lane - Its cards land on a lane's header
 * @property decision - Its cards land on a decision's diamond
 */
export const FlowchartLandsType = VariantType({
    none: ArrayType(FlowchartCardType),
    state: ArrayType(FlowchartStateCardType),
    transition: ArrayType(FlowchartTransitionCardType),
    lane: ArrayType(FlowchartLaneCardType),
    decision: ArrayType(FlowchartDecisionCardType),
});

/** Type representing {@link FlowchartLandsType}. */
export type FlowchartLandsType = typeof FlowchartLandsType;

/**
 * One tab of the library pane, as `library` lists it (`Flowchart Builder
 * Spec.md` §4.2).
 *
 * @remarks
 * A card crosses the closed payload as the fields its drop sets, typed by the
 * row it lands on — a flow's rows are the flowchart's own types.
 *
 * @property flows - Every flow in the record; a click opens one
 * @property states - State templates from bound rows: its name, its icon and its cards
 * @property transitions - Transition templates from bound rows: its name, its icon and its cards
 * @property tab - The author's own cards: its name, its icon, and its cards by what they land on
 */
export const FlowchartLibraryTabType = VariantType({
    flows: NullType,
    states: StructType({ name: StringType, icon: OptionType(StringType), cards: ArrayType(FlowchartStateCardType) }),
    transitions: StructType({ name: StringType, icon: OptionType(StringType), cards: ArrayType(FlowchartTransitionCardType) }),
    tab: StructType({ name: StringType, icon: OptionType(StringType), lands: FlowchartLandsType }),
});

/** Type representing {@link FlowchartLibraryTabType}. */
export type FlowchartLibraryTabType = typeof FlowchartLibraryTabType;

// ============================================================================
// Where the flows come from
// ============================================================================

/** A record's commits, newest first: who changed it last, and when. */
export const FlowchartHistoryType = FunctionType([], OptionType(ArrayType(RecordCommitInfoType)));

/** Type representing {@link FlowchartHistoryType}. */
export type FlowchartHistoryType = typeof FlowchartHistoryType;

/**
 * The editing session's Apply over a record of flows (#1246, FB14): the
 * session's keyed batch — a flow's insert, update or delete by name — as the
 * session hands it, bytes of `Editing.Types.ChangeSet(Flowchart.Types.Flow,
 * String)`, committed as one patch through the record's patch mutation by
 * `Record.onApply(record, { keyed: true })`, and answered as the session's
 * Apply is.
 */
export const FlowchartSessionApplyType = AsyncFunctionType([BlobType], Editing.Types.ApplyResult);

/** Type representing {@link FlowchartSessionApplyType}. */
export type FlowchartSessionApplyType = typeof FlowchartSessionApplyType;

/**
 * A record of flows by name, bound with its patch mutation — what the
 * renderer reads the flows from and commits to, as the query builder's
 * `QueriesHandleType` is the saved queries record's.
 *
 * @property read - The record's flows
 * @property history - Its commits, newest first
 * @property commit - Its patch write, awaited: a request id and the patch, answered by the outcome
 * @property apply - The editing session's Apply through that patch write ({@link FlowchartSessionApplyType})
 */
export const FlowchartFlowsHandleType = StructType({
    read: FunctionType([], FlowchartFlowsType),
    history: FlowchartHistoryType,
    commit: StructType({ patch: AsyncFunctionType([StringType, PatchType(FlowchartFlowsType)], RecordOutcomeType) }),
    apply: FlowchartSessionApplyType,
});

/** Type representing {@link FlowchartFlowsHandleType}. */
export type FlowchartFlowsHandleType = typeof FlowchartFlowsHandleType;

/** The host's commit of its flows' edits: one patch of the flows, as a record's would be, answered as the editing session's Apply is. */
export const FlowchartFlowsApplyType = AsyncFunctionType([PatchType(FlowchartFlowsType)], Editing.Types.ApplyResult);

/** Type representing {@link FlowchartFlowsApplyType}. */
export type FlowchartFlowsApplyType = typeof FlowchartFlowsApplyType;

/** The host's commit of its one flow's edits: one patch of the flow, as a record's would be. */
export const FlowchartFlowApplyType = AsyncFunctionType([PatchType(FlowchartFlowType)], Editing.Types.ApplyResult);

/** Type representing {@link FlowchartFlowApplyType}. */
export type FlowchartFlowApplyType = typeof FlowchartFlowApplyType;

/**
 * The host's flows: its value, of either type, and its commit when it takes
 * the flowchart's edits — each arm's `onApply` takes its own value's patch.
 *
 * @property flows - Flows by name
 * @property flow - One flow
 */
export const FlowchartDataType = VariantType({
    flows: StructType({ value: FlowchartFlowsType, onApply: OptionType(FlowchartFlowsApplyType) }),
    flow: StructType({ value: FlowchartFlowType, onApply: OptionType(FlowchartFlowApplyType) }),
});

/** Type representing {@link FlowchartDataType}. */
export type FlowchartDataType = typeof FlowchartDataType;

/**
 * Where a flowchart's flows come from.
 *
 * @property record - A record of flows by name, bound with its patch mutation
 * @property data - The host's flows by name, or one flow: the arm its value's type picked
 */
export const FlowchartSourceType = VariantType({
    record: FlowchartFlowsHandleType,
    data: FlowchartDataType,
});

/** Type representing {@link FlowchartSourceType}. */
export type FlowchartSourceType = typeof FlowchartSourceType;

// ============================================================================
// The payload
// ============================================================================

/**
 * The `Flowchart` renderer's payload: the flowchart's interface.
 *
 * @property canvas - What the canvas draws its flow with ({@link FlowchartCanvasType})
 * @property source - Where the flows come from: a record of flows by name, or the host's flows or flow
 * @property open - Over many flows, the one opened first
 * @property library - The library pane's tabs, in the order `library` lists them; none, no library pane
 * @property inspector - Whether the flowchart has its inspector pane
 * @property readOnly - No gesture edits, no drop lands, the inspector edits nothing
 * @property name - Names the flowchart, when a surface holds two
 */
export const FlowchartPayloadType = StructType({
    canvas: FlowchartCanvasType,
    source: FlowchartSourceType,
    open: OptionType(StringType),
    library: ArrayType(FlowchartLibraryTabType),
    inspector: BooleanType,
    readOnly: BooleanType,
    name: OptionType(StringType),
});

/** Type representing the `Flowchart` renderer's payload. */
export type FlowchartPayloadType = typeof FlowchartPayloadType;

/**
 * The `Flowchart` carrier: `<Flowchart>` builds a {@link FlowchartPayloadType}
 * and returns it through this {@link EastUI.component}. The React renderer
 * registers against it in `@elaraai/e3-ui-components` via
 * `implementUIComponent`.
 */
export const FlowchartComponent = EastUI.component("Flowchart", FlowchartPayloadType, { optional: true });

// ============================================================================
// The flowchart's shared keys
// ============================================================================

/**
 * The names a flowchart keeps its viewer's state under, by its `name`: its
 * frame's panes — their open tab and collapsed state (#1245) — the flow open
 * in it, its library's id, and LR · TD (#1246).
 *
 * @remarks
 * As the Plan's `planKeys` and the Sheet's `sheetKeys`: two flowcharts on one
 * surface keep apart only when each is named, and two of one name open one
 * flow together, and turn together, as the query builder's open query is
 * shared by its id.
 *
 * @param name - The flowchart's name, when a surface holds more than one; omitted, the one flowchart
 * @returns The keys
 */
export function flowchartKeys(name: string | undefined): {
    /** The frame's storage key: each pane's open tab and collapsed state. */
    frame: string;
    /** The open flow's UI store key: the name of the flow open in the flowchart, so a remount opens it again (FB12). */
    flow: string;
    /** The library's id: what its tabs' cards are drawn from. */
    library: string;
    /** LR · TD's UI store key: the orientation the viewer picked, so a remount keeps it (FB43). */
    orientation: string;
} {
    const suffix = name === undefined ? "" : `.${name}`;
    return {
        frame: `flowchart${suffix}.frame`,
        flow: `flowchart${suffix}.flow`,
        library: `flowchart.library${suffix}`,
        orientation: `flowchart${suffix}.orientation`,
    };
}

// ============================================================================
// <Flowchart>'s props
// ============================================================================

/**
 * A record of flows by name bound with its patch mutation, as the flowchart
 * reads it — what `Record.bind(record, [e3.mutation.patch(record)])` returns
 * for a record of `Flowchart.Types.Flows`.
 */
export interface FlowchartRecordHandle {
    /** The record's flows. */
    read: (...args: never[]) => ExprType<FlowchartFlowsType>;
    /** The record's commits. */
    history: unknown;
    /** The record's writes, awaited. */
    commit: unknown;
    /** The record's binding. */
    binding: unknown;
}

/**
 * A whole-value bind handle (`Data.bind`, `State.bind`) over the host's flows
 * — `data={handle}` builds the flowchart over `handle.read()`.
 *
 * @typeParam T - The value's type: `Flowchart.Types.Flows` or `Flowchart.Types.Flow`
 */
export interface FlowchartBindHandle<T extends EastType> {
    /** The handle's read. */
    read: (...args: never[]) => ExprType<T>;
}

/**
 * What every `<Flowchart>` takes beside its flows: the canvas's options, its
 * inspector, read only and its name.
 */
export interface FlowchartCommon extends FlowchartCanvasOptions {
    /** The inspector pane: given, the flowchart has one; left out, none. */
    inspector?: true;
    /** No gesture edits, no drop lands, the inspector edits nothing; selection and hover stay. */
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Names the flowchart — needed only when one surface holds two. */
    name?: string;
}

/** The props, erased — what the implementation reads. */
type FlowchartAnyProps = {
    record?: unknown;
    data?: unknown;
    onApply?: unknown;
    flow?: SubtypeExprOrValue<StringType>;
    library?: unknown;
    slice?: FlowchartSliceOptions["slice"];
    affordances?: FlowchartSliceOptions["affordances"];
    inspector?: unknown;
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    name?: string;
} & Record<string, unknown>;

/** The tables and row mappers the flowchart took before it held flows, which `Flowchart.over` takes now. */
const TABLES = ["states", "links", "lanes", "triggers", "state", "link", "lane", "trigger"] as const;

/** The sizes the flowchart took before it filled the box it is given (#1245). */
const SIZES = ["height", "maxHeight"] as const;

/** The refusal of a record not bound with its patch mutation. */
const UNBOUND = "Flowchart: `record` is an e3 record bound with its patch mutation — Record.bind(record, [e3.mutation.patch(record)])";

/** The arm the flows' type picked, and whether it holds many flows. */
interface FlowchartArm {
    /** The payload's `source`. */
    readonly source: unknown;
    /** Whether the source holds flows by name, rather than one flow. */
    readonly many: boolean;
}

/** A field of a struct type, or `undefined`. */
function fieldOf(type: EastType | undefined, name: string): EastType | undefined {
    return type?.type === "Struct" ? (type.fields as Record<string, EastType>)[name] : undefined;
}

/**
 * The record arm: a `Record.bind` handle over flows by name, bound with its
 * patch mutation, crossing the payload as its read, its history, its patch
 * write and the editing session's Apply through it. A record of one flow is
 * refused: e3's patch mutation writes only keyed records (ruled 2026-10-07),
 * so a lone flow is a one-entry record, or the host's `data`.
 */
function recordArm(record: unknown): FlowchartArm {
    if (!(record instanceof Expr)) throw new Error(UNBOUND);
    const type = Expr.type(record) as EastType;
    const read = fieldOf(type, "read");
    if (read === undefined || read.type !== "Function" || read.inputs.length !== 0
        || fieldOf(type, "history")?.type !== "Function" || fieldOf(type, "binding") === undefined) {
        throw new Error(UNBOUND);
    }
    const recordType = read.output as EastType;
    if (isTypeEqual(recordType, FlowchartFlowType)) {
        throw new Error("Flowchart: `record` holds flows by name, Flowchart.Types.Flows — e3's patch mutation writes only keyed records — and this record holds one flow: make it a record of flows with one entry (Flowchart.values({ [name]: flow })), or pass the flow as `data`");
    }
    if (!isTypeEqual(recordType, FlowchartFlowsType)) {
        throw new Error(`Flowchart: \`record\` holds flows by name, Flowchart.Types.Flows — declare it with that type — and this record holds ${printType(recordType)}`);
    }
    // The patch door: e3.mutation.patch's, the mutation named `patch` taking
    // the record's patch.
    const door = fieldOf(fieldOf(type, "commit"), "patch");
    if (door === undefined || !isTypeEqual(door, AsyncFunctionType([StringType, PatchType(FlowchartFlowsType)], RecordOutcomeType))) {
        throw new Error(`${UNBOUND}, and this binding ${door === undefined ? "has no `patch`" : "has a `patch` that takes another patch than the record's"}`);
    }
    const handle = record as unknown as { read: unknown; history: unknown; commit: { patch: unknown } };
    // The session's Apply (#1246): its keyed batch, decoded at its own type
    // and committed as it is — each flow's insert, update or delete by name —
    // through the patch door, by Record.onApply's keyed form.
    const keyed = RecordBind.onApply(record as never, { keyed: true }) as unknown as ExprType<AsyncFunctionType<[EastType], typeof Editing.Types.ApplyResult>>;
    const batchType = Editing.Types.ChangeSet(FlowchartFlowType, StringType);
    const apply = East.asyncFunction([BlobType], Editing.Types.ApplyResult, ($, blob) => {
        const commit = $.const(keyed);
        return commit(blob.decodeBeast(batchType, "v2"));
    });
    return {
        many: true,
        source: variant("record", { read: handle.read, history: handle.history, commit: { patch: handle.commit.patch }, apply }),
    };
}

/** The host's flows as an expression: an expression, a bind handle's read, or a value of either type. */
function dataValue(data: unknown): ExprType<EastType> {
    if (data instanceof Expr) {
        const read = fieldOf(Expr.type(data) as EastType, "read");
        return read !== undefined && read.type === "Function" && read.inputs.length === 0
            ? (data as unknown as { read: () => ExprType<EastType> }).read()
            : data as ExprType<EastType>;
    }
    if (isValueOf(data, FlowchartFlowsType)) return East.value(data as ValueTypeOf<FlowchartFlowsType>, FlowchartFlowsType) as unknown as ExprType<EastType>;
    if (isValueOf(data, FlowchartFlowType)) return East.value(data as ValueTypeOf<FlowchartFlowType>, FlowchartFlowType) as unknown as ExprType<EastType>;
    throw new Error("Flowchart: `data` is Flowchart.Types.Flows, flows by name, or Flowchart.Types.Flow, one flow — a value, an expression or a bind handle of either; Flowchart.over builds one flow from an app's tables — and this value is neither");
}

/** The host's `onApply`, checked against the patch of its flows' type. */
function applyOf(onApply: unknown, applyType: EastType, value: string): ExprType<EastType> {
    const apply = (onApply instanceof Expr ? onApply : East.value(onApply as SubtypeExprOrValue<EastType>, applyType)) as ExprType<EastType>;
    const type = Expr.type(apply as unknown as Expr) as EastType;
    if (!isTypeEqual(type, applyType)) {
        throw new Error(`Flowchart: \`onApply\` commits \`data\`'s edits, one patch of the value at a time — an East.asyncFunction from PatchType(${value}) to Editing.Types.ApplyResult — and this one is ${printType(type)}`);
    }
    return apply;
}

/** The data arm: the host's flows, of either type, with its commit when it takes the edits. */
function dataArm(data: unknown, onApply: unknown): FlowchartArm {
    const value = dataValue(data);
    const type = Expr.type(value as unknown as Expr) as EastType;
    const many = isTypeEqual(type, FlowchartFlowsType);
    if (!many && !isTypeEqual(type, FlowchartFlowType)) {
        throw new Error(`Flowchart: \`data\` is Flowchart.Types.Flows, flows by name, or Flowchart.Types.Flow, one flow — a value, an expression or a bind handle of either; Flowchart.over builds one flow from an app's tables — and this is ${printType(type)}`);
    }
    const apply = onApply === undefined
        ? none
        : some(applyOf(onApply, many ? FlowchartFlowsApplyType : FlowchartFlowApplyType, many ? "Flowchart.Types.Flows" : "Flowchart.Types.Flow"));
    return { many, source: variant("data", variant(many ? "flows" : "flow", { value, onApply: apply })) };
}

/** How a tab names itself in a refusal. */
function tabName(tab: FlowchartLibraryTab): string {
    return `Flowchart.library.${tab.kind}()`;
}

/**
 * The library pane on the wire (`Flowchart Builder Spec.md` §4.2, FB16): its
 * tabs in the order `library` lists them; none when it is left out.
 *
 * @param library - The tabs, each a `Flowchart.library.*` call
 * @param many - Whether the flowchart holds flows by name, rather than one flow
 * @returns The tabs on the wire
 * @throws {Error} Naming the tab and the remedy: a `library` that is no list
 *   of `Flowchart.library.*` calls, a tab listed twice, and the Flows tab over
 *   one flow
 */
function buildLibrary(library: unknown, many: boolean): ValueTypeOf<FlowchartLibraryTabType>[] {
    if (library === undefined) return [];
    const LIST = "Flowchart: `library` lists the library pane's tabs, each a Flowchart.library.* call — library={[Flowchart.library.flows()]}";
    if (!Array.isArray(library)) throw new Error(LIST);
    const seen = new Set<string>();
    return (library as unknown[]).map((given): ValueTypeOf<FlowchartLibraryTabType> => {
        const tab = given as FlowchartLibraryTab | null | undefined;
        if (tab === null || tab === undefined || tab.kind !== "flows") throw new Error(LIST);
        if (seen.has(tab.kind)) throw new Error(`Flowchart: the library lists ${tabName(tab)} twice — each tab once`);
        seen.add(tab.kind);
        if (!many) {
            throw new Error(`Flowchart: ${tabName(tab)} lists flows by name, and this \`data\` is one flow, Flowchart.Types.Flow — leave the Flows tab out of \`library\`, or pass the flows by name`);
        }
        return variant("flows", null);
    });
}

/**
 * Creates the flowchart's payload alone — what `<Flowchart>` returns through
 * the `Flowchart` carrier — for the tests and the renderer's fixtures, which
 * read it whole.
 *
 * @param props - The flowchart's props, as `<Flowchart>` takes them
 * @returns An East expression of {@link FlowchartPayloadType}
 * @throws {Error} Naming the prop and the remedy: flows from both `record` and
 *   `data`, or from neither; `onApply`, `slice` or `affordances` over a
 *   record; `flow` over one flow; a record of one flow, or of another type
 *   than `Flowchart.Types.Flows`, or not bound with its patch mutation; `data`
 *   of neither flow type; an `onApply` that does not take the patch of
 *   `data`'s type; `"brush"` among the affordances; a table or row mapper,
 *   which `Flowchart.over` takes; `height` or `maxHeight`, which the box the
 *   flowchart fills sets; and a `library` that lists a tab twice, or the Flows
 *   tab over one flow
 * @internal
 */
export function createFlowchartPayload(props: object): ExprType<FlowchartPayloadType> {
    const { record, data, onApply, flow, library, slice, affordances, inspector, readOnly, name, ...canvas } = props as FlowchartAnyProps;
    for (const table of TABLES) {
        if (table in canvas) {
            throw new Error(`Flowchart: \`${table}\` is one of the tables, or the row mappers, Flowchart.over builds a flow from — pass data={Flowchart.over(states, { … })}, or bind a record of flows as \`record\``);
        }
    }
    for (const size of SIZES) {
        if (size in canvas) {
            throw new Error(`Flowchart: \`${size}\` is not a prop — the flowchart fills the box it is given; give it a box of its own height: <Box height="560px"><Flowchart … /></Box>`);
        }
    }
    if (record !== undefined && data !== undefined) {
        throw new Error("Flowchart: takes its flows from `record` or from `data`, never both");
    }
    if (record === undefined && data === undefined) {
        throw new Error("Flowchart: needs its flows — `record`, an e3 record of Flowchart.Types.Flows bound with its patch mutation, or `data`: flows by name or one flow, as a value, an expression or a bind handle");
    }
    let arm: FlowchartArm;
    if (record !== undefined) {
        if (onApply !== undefined) {
            throw new Error("Flowchart: `onApply` commits `data`'s edits — a flowchart over `record` commits through the record's patch mutation; leave `onApply` out");
        }
        for (const [prop, given] of [["slice", slice], ["affordances", affordances]] as const) {
            if (given !== undefined) {
                throw new Error(`Flowchart: \`${prop}\` narrows the transitions a host builds its flow from, and a record's flows are the record's — pass the host's flow as data={Flowchart.over(states, { links: Slice.rows(…), … })}, or leave \`${prop}\` out`);
            }
        }
        arm = recordArm(record);
    } else {
        arm = dataArm(data, onApply);
    }
    if (flow !== undefined && !arm.many) {
        throw new Error("Flowchart: `flow` opens one of many flows first, and this `data` is one flow, Flowchart.Types.Flow — leave `flow` out");
    }
    const tabs = buildLibrary(library, arm.many);
    return East.value({
        canvas: buildCanvas(canvas as FlowchartCanvasOptions, {
            ...(slice === undefined ? {} : { slice }),
            ...(affordances === undefined ? {} : { affordances }),
        }),
        source: arm.source,
        open: flow === undefined ? none : some(flow),
        library: tabs,
        inspector: inspector === true,
        readOnly: readOnly ?? false,
        name: name === undefined ? none : some(name),
    } as never, FlowchartPayloadType);
}
