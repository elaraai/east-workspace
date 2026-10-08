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
 *   the editing session over the flows (#1246), its Save: the session's keyed
 *   batch committed through the patch mutation by `Record.onApply(record, {
 *   keyed: true })`. A record always holds flows by name (ruled 2026-10-07:
 *   e3's patch mutation writes only keyed records), so a lone flow is a
 *   one-entry record, or the host's;
 * - `data`, the host's flows by name or one flow — a value, an expression or a
 *   bind handle — the value's type picking the arm. Given the host's
 *   `onApply`, the arm carries the session's Save through it (#1247): the
 *   session's batch restated as one patch of the host's value, which the
 *   host's `onApply` takes and answers.
 *
 * The flowchart takes no callback for an edit (#1247, FB24): every gesture is
 * one transaction of its editing session, and each callback it took before is
 * refused when the surface is built, naming the remedy.
 *
 * Its library's tabs are the `Flowchart.library.*` calls `library` lists, on
 * the wire in that order: `library.ts` builds each — the Flows tab, and the
 * template and author's tabs, each card read from the tab's own rows — and
 * makes the library's refusals (#1248).
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    AsyncFunctionType,
    BlobType,
    BooleanType,
    DictType,
    East,
    Expr,
    FunctionType,
    OptionType,
    PatchType,
    StringType,
    StructType,
    VariantType,
    dictPatchOpsType,
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
import { FlowchartLibraryTabType, buildLibrary } from "./library.js";
import { FlowchartFlowType, FlowchartFlowsType } from "./types.js";

// ============================================================================
// Where the flows come from
// ============================================================================

/** A record's commits, newest first: who changed it last, and when. */
export const FlowchartHistoryType = FunctionType([], OptionType(ArrayType(RecordCommitInfoType)));

/** Type representing {@link FlowchartHistoryType}. */
export type FlowchartHistoryType = typeof FlowchartHistoryType;

/**
 * The editing session's Save (#1246, #1247, FB22): the session's keyed batch —
 * the open flow's insert, update or delete by name — as the session hands it,
 * bytes of `Editing.Types.ChangeSet(Flowchart.Types.Flow, String)`, sent as
 * one commit and answered as the session's Save is: over a record, one patch
 * through its patch mutation by `Record.onApply(record, { keyed: true })`;
 * over the host's flows or flow, one patch of that value through the host's
 * `onApply`.
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

/** The host's commit of its flows' edits: one patch of the flows, as a record's would be, answered as the editing session's Save is. */
export const FlowchartFlowsApplyType = AsyncFunctionType([PatchType(FlowchartFlowsType)], Editing.Types.ApplyResult);

/** Type representing {@link FlowchartFlowsApplyType}. */
export type FlowchartFlowsApplyType = typeof FlowchartFlowsApplyType;

/** The host's commit of its one flow's edits: one patch of the flow, answered as the editing session's Save is. */
export const FlowchartFlowApplyType = AsyncFunctionType([PatchType(FlowchartFlowType)], Editing.Types.ApplyResult);

/** Type representing {@link FlowchartFlowApplyType}. */
export type FlowchartFlowApplyType = typeof FlowchartFlowApplyType;

/**
 * The host's flows: its value, of either type, and — when the host takes the
 * flowchart's edits — the session's Save through the host's `onApply` (#1247,
 * FB22), which hands the host one patch of its own value's type.
 *
 * @property flows - Flows by name
 * @property flow - One flow
 */
export const FlowchartDataType = VariantType({
    flows: StructType({ value: FlowchartFlowsType, apply: OptionType(FlowchartSessionApplyType) }),
    flow: StructType({ value: FlowchartFlowType, apply: OptionType(FlowchartSessionApplyType) }),
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

/** The callbacks the flowchart took for its edits before each gesture was a transaction of its editing session (#1247, FB24). */
const EDIT_CALLBACKS = ["linkMode", "onCreateLink", "onDeleteLink", "onAddLane", "onRenameLane", "onDeleteLane", "onAddState", "onEditState", "onMoveState"] as const;

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

/**
 * The data arm: the host's flows, of either type, and — when the host takes
 * the edits — the session's Save through its `onApply` (#1247, FB22). The
 * session's batch is keyed by name, as over a record: over flows by name it is
 * restated as one patch of the flows, each change the open flow's insert,
 * update or delete by name, as `Record.onApply(record, { keyed: true })`
 * restates it for a record — never the whole value replaced, so the host's
 * other flows stay as they are; over one flow, its one change is the flow's
 * own patch. The host's `onApply` answers the session.
 */
function dataArm(data: unknown, onApply: unknown): FlowchartArm {
    const value = dataValue(data);
    const type = Expr.type(value as unknown as Expr) as EastType;
    const many = isTypeEqual(type, FlowchartFlowsType);
    if (!many && !isTypeEqual(type, FlowchartFlowType)) {
        throw new Error(`Flowchart: \`data\` is Flowchart.Types.Flows, flows by name, or Flowchart.Types.Flow, one flow — a value, an expression or a bind handle of either; Flowchart.over builds one flow from an app's tables — and this is ${printType(type)}`);
    }
    if (onApply === undefined) return { many, source: variant("data", variant(many ? "flows" : "flow", { value, apply: none })) };
    // The host's commit, its patch opaque here, as in `Record.onApply`; its runtime type is exact.
    const host = applyOf(onApply, many ? FlowchartFlowsApplyType : FlowchartFlowApplyType, many ? "Flowchart.Types.Flows" : "Flowchart.Types.Flow") as
        ExprType<AsyncFunctionType<[EastType], typeof Editing.Types.ApplyResult>>;
    const batchType = Editing.Types.ChangeSet(FlowchartFlowType, StringType);
    const apply = many
        ? East.asyncFunction([BlobType], Editing.Types.ApplyResult, ($, blob) => {
            const commit = $.const(host);
            const batch = $.const(blob.decodeBeast(batchType, "v2"));
            // Each change is its flow's insert, update or delete, by name: the
            // batch's own values and patches, carrying what the flow was when
            // the edit began.
            const ops = $.let(new Map(), DictType(StringType, dictPatchOpsType(FlowchartFlowType)));
            $.for(batch.changes, ($, change) => {
                $.match(change.patch, {
                    replace: ($, swap) => {
                        $.match(swap.after, {
                            some: ($, after) => {
                                $.match(swap.before, {
                                    none: ($) => { $(ops.insert(change.id, variant("insert", after))); },
                                    some: ($, before) => { $(ops.insert(change.id, variant("update", East.diff(before, after)))); },
                                });
                            },
                            none: ($) => {
                                $.match(swap.before, { some: ($, before) => { $(ops.insert(change.id, variant("delete", before))); } });
                            },
                        });
                    },
                    patch: ($, entry) => {
                        $.match(entry, { some: ($, update) => { $(ops.insert(change.id, variant("update", update))); } });
                    },
                });
            });
            return commit(variant("patch", ops));
        })
        : East.asyncFunction([BlobType], Editing.Types.ApplyResult, ($, blob) => {
            const commit = $.const(host);
            const batch = $.const(blob.decodeBeast(batchType, "v2"));
            // One flow is one entry, changed in place: its change is the flow's own patch.
            const result = $.let(variant("rejected", [{ entry: "", row: none, field: none,
                message: "One flow is changed in place: Save never adds or removes it" }]), Editing.Types.ApplyResult);
            $.for(batch.changes, ($, change) => {
                $.match(change.patch, {
                    replace: ($, swap) => {
                        $.match(swap.before, {
                            some: ($, before) => {
                                $.match(swap.after, { some: ($, after) => { $.assign(result, commit(East.diff(before, after))); } });
                            },
                        });
                    },
                    patch: ($, entry) => {
                        $.match(entry, { some: ($, update) => { $.assign(result, commit(update)); } });
                    },
                });
            });
            return result;
        });
    return { many, source: variant("data", variant(many ? "flows" : "flow", { value, apply: some(apply) })) };
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
 *   flowchart fills sets; a callback for an edit, or `linkMode`, which the
 *   editing session's gestures replace; and each of the library's refusals
 *   (`library.ts`'s `buildLibrary`): a tab listed twice, the Flows tab over
 *   one flow, a data tab's rows of neither an Array nor a `Dict<String, T>`,
 *   and a `drop` of another type than its tab's
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
    for (const callback of EDIT_CALLBACKS) {
        if (callback in canvas) {
            throw new Error(`Flowchart: \`${callback}\` is not a prop — every gesture is a transaction of the flowchart's editing session, and Save commits them as one patch: over \`record\`, through its patch mutation; over \`data\`, through the host's \`onApply\``);
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
