/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's kinds (#1500, `Flowchart Records Spec.md` §2, §3, R1–R4):
 * `Flowchart.states`, `transitions`, `lanes` and `decisions`. Each takes a
 * record of the app's and maps its fields to the Flowchart's roles, as the
 * Schematic's kinds do (`schematic/kinds.ts`): the Flowchart stores nothing in
 * a shape of its own, and no record of the app's holds a type of the
 * Flowchart's.
 *
 * - **A role is a field of the row where a gesture writes it or it names
 *   another row's key** (R2): a state's `label`, `lane` and `order`; a
 *   transition's `from`, `to` and `decision`; a lane's `label` and `order`; a
 *   decision's `queue`. Each is checked against the row's type when the code
 *   compiles — a field of another type is a type error naming the fields that
 *   fit — and again at build, in the kind's words. Every other role is an
 *   accessor over the row and its key, reified once and called per row: a
 *   state's `members`; a transition's `kind` and `evidence`; a decision's
 *   `label`, `letter`, `owner` and `outcomes`.
 * - **A gesture writes only its roles' fields** (R8): every other field of the
 *   row reads back as it was, and a new row takes a card's values, or its
 *   type's defaults.
 * - **How a kind is bound follows how it is read** (R3): a state or a
 *   transition `Record.bind(record)`, editable — read whole, or through its
 *   source of the slice with `entries: Data.bindPaged(record)` beside it —
 *   `Data.bind(record)`, read only and whole, or `Data.bindPaged(record)`
 *   alone, read only, through its source; a lane or a decision `Record.bind`
 *   or `Data.bind`, read whole. Every other form is refused, naming the one to
 *   use.
 *
 * A kind closes its record behind East functions over beast2 bytes (§3, "What
 * the payload carries") — its stored rows a read holds, each one's roles
 * beside its bytes; a drafted row's roles; a gesture's write and a new row;
 * the fields an author's card sets; the shared editing session over the
 * record with its patch door; the record read by key; its history, its form,
 * its own Details and the app's check — through the machinery the Schematic's
 * kinds share (`utils/record-kind.ts`), so the payload is one type whatever
 * the rows hold, and the renderer needs no row type.
 *
 * @packageDocumentation
 */

import {
    ArrayType, AsyncFunctionType, BlobType, East, Expr, FloatType, IntegerType, OptionType, PatchType, SetType, StringType,
    defaultValue, isTypeEqual, none, printType, some, variant,
    type BlockBuilder, type DictType, type EastType, type ExprType, type FunctionType, type StructType,
} from "@elaraai/east";
import { resolveRowSource, type FieldHints } from "@elaraai/east-ui/internal";
import { RecordOutcomeType } from "../bind/record.js";
import { fieldOf, type FieldName, type FieldsOf } from "../schedule/fields.js";
import { checkEntries, typeText } from "../schedule/window.js";
import {
    accessorRole, called, fieldTypeOf, kindSourceRows, kindWholeRows, readOf, recordSide, roleField, rowWith, rowsReadOf, storedRows, valuesTypeOf,
    type KindAccessor as Accessor, type KindBinding, type KindRowInspector as RowInspector, type RecordSide,
} from "../utils/record-kind.js";
import { isFlowchartDetails, type FlowchartDetails, type FlowchartDetailsSpec, type FlowchartTransitionDetailsSpec } from "./details.js";
import { checkedFlowchartTemplates, type FlowchartTemplates } from "./templates.js";
import {
    FlowchartDecisionEntryType, FlowchartDecisionKindType, FlowchartDecisionRolesType, FlowchartEvidenceType, FlowchartLaneEntryType,
    FlowchartLaneKindType, FlowchartLaneRolesType, FlowchartLaneWriteType, FlowchartLinkKindType, FlowchartStateEntryType, FlowchartStateKindType,
    FlowchartStateRolesType, FlowchartStateWriteType, FlowchartTemplateType, FlowchartTransitionEntryType, FlowchartTransitionKindType,
    FlowchartTransitionRolesType, FlowchartTransitionWriteType,
} from "./types.js";

// ============================================================================
// The row's fields, by role (R2)
// ============================================================================

/** Fields of R a name fits: a String, or an Option of one. */
export type FlowchartTextField<R extends StructType> = FieldsOf<R, StringType | OptionType<StringType>>;

/** Fields of R that name a row of another kind by its key: a String — or, `Optional`, an Option of one too: a transition's decision. */
export type FlowchartKeyField<R extends StructType, Optional extends boolean = false> =
    FieldsOf<R, Optional extends true ? StringType | OptionType<StringType> : StringType>;

/** Fields of R that name several states by their keys: a decision's queue, an Array or a Set of Strings. */
export type FlowchartKeysField<R extends StructType> = FieldsOf<R, ArrayType<StringType> | SetType<StringType>>;

/** Fields of R that place a row: a state's among its lane's, a Float; a lane's among the lanes, an Integer or a Float. */
export type FlowchartOrderField<R extends StructType, N extends EastType = FloatType> = FieldsOf<R, N>;

/** R with the fields its roles write left out: the values a card gives a new row. */
export type FlowchartValuesOf<R extends StructType, F extends string> = StructType<{ [K in Exclude<FieldName<R>, F>]: R["fields"][K] }>;

// ============================================================================
// How a kind's record is bound (R3)
// ============================================================================

/**
 * A state's or a transition's record, bound (R3): `Record.bind`'s or
 * `Data.bind`'s handle, read whole, or `Data.bindPaged`'s, read through its
 * source — each over a `Dict<String, R>`, its row type `R` inferred from the
 * handle.
 *
 * @typeParam R - The record's row type
 */
export type FlowchartBinding<R extends StructType> =
    | { readonly read: (...args: never[]) => ExprType<DictType<StringType, R>>; readonly binding: unknown }
    | { readonly page: (...args: never[]) => ExprType<OptionType<DictType<StringType, R>>>; readonly revision: unknown };

/**
 * A lane's or a decision's record, bound (R3): `Record.bind`'s or
 * `Data.bind`'s handle, read whole — a small record over a `Dict<String, R>`.
 *
 * @typeParam R - The record's row type
 */
export type FlowchartWholeBinding<R extends StructType> = { readonly read: (...args: never[]) => ExprType<DictType<StringType, R>>; readonly binding: unknown };

/**
 * Tells a kind's binding by its handle's East struct (`bind/sources.ts`'
 * rule): a `page` field is `Data.bindPaged`'s, a `mutate` field
 * `Record.bind`'s — checked for its patch door — and any other `Data.bind`'s.
 *
 * @param record - What the kind was given
 * @param where - The kind, as a refusal names it
 * @param noun - What its rows are, as a refusal names them (`states`)
 * @param whole - Whether the kind is read whole only: a lane or a decision
 * @returns The binding
 * @throws {Error} Naming the forms to use: anything but a binding of a record of structs keyed by String — a paged read
 *   for a kind read whole, one paging an index's window, and one naming no snapshot among them — and a `Record.bind`
 *   without its patch door
 */
function boundOf(record: unknown, where: string, noun: string, whole: boolean): KindBinding {
    const forms = whole
        ? "bind Record.bind(record) to edit them, or Data.bind(record) to read them"
        : "bind Record.bind(record) to edit them, Data.bind(record) to read them whole, or Data.bindPaged(record) to read them through their source";
    const refuse = (why: string): never => { throw new Error(`${where}: the ${noun} are a record of the app's${whole ? ", read whole" : ""}: ${forms}${why}`); };
    if (!(record instanceof Expr)) return refuse("");
    const type = Expr.type(record) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : undefined;
    if (fields === undefined) return refuse(` — and this is ${printType(type)}`);
    let form: KindBinding["form"];
    let recordType: EastType;
    if (fields["page"] !== undefined) {
        if (whole) return refuse(" — and this is Data.bindPaged(record), which reads a record through its source of the slice");
        form = "paged";
        if (fields["indexes"] !== undefined) {
            return refuse(` — and this paged read reads the record through its indexes: bind its own entries, Data.bindPaged(record), and name the indexed read ` +
                `as the ${noun}' source of the slice`);
        }
        const resolved = resolveRowSource(record, where);
        if (resolved.kind !== "paged") return refuse(" — and this paged read pages an index's window: bind the record's own entries, Data.bindPaged(record)");
        recordType = resolved.collectionType;
    } else {
        form = fields["mutate"] !== undefined ? "record" : "data";
        const read = fields["read"];
        if (read === undefined || read.type !== "Function" || read.inputs.length !== 0 || fields["binding"] === undefined) return refuse("");
        recordType = read.output as EastType;
    }
    if (recordType.type !== "Dict" || !isTypeEqual(recordType.key as EastType, StringType) || (recordType.value as EastType).type !== "Struct") {
        throw new Error(`${where}: the ${noun}' record holds its rows by String key, each a struct — and this one holds ${typeText(recordType)}`);
    }
    const rowType = recordType.value as StructType;
    // A paged read of the record's own entries, at the snapshot every read of it is at.
    if (form === "paged") checkEntries(record, StringType, rowType, `${where}: Data.bindPaged(record)`);
    if (form === "record") {
        // The patch door: the record's mutation.patch(), the mutation named `patch` taking the record's patch.
        const commit = fields["commit"];
        const door = commit?.type === "Struct" ? (commit.fields as Record<string, EastType>)["patch"] : undefined;
        if (door === undefined || !isTypeEqual(door, AsyncFunctionType([StringType, PatchType(recordType)], RecordOutcomeType))) {
            throw new Error(`${where}: the ${noun}' record is bound without its patch door — its record declares patch: mutation.patch(), ` +
                "which Save writes each change through");
        }
    }
    return { form, handle: record as ExprType<EastType>, rowType };
}

/**
 * Checks a kind's `entries` where it declares them (R3): for a record bound to
 * be edited, a paged read of its own entries.
 *
 * @param bound - The kind's binding
 * @param entries - What the kind was given
 * @param where - The kind, as a refusal names it
 * @param noun - What its rows are, as a refusal names them
 * @returns The paged read, checked; `undefined` for none
 * @throws {Error} When a read-only binding is given `entries`, or they are no paged read of the record's own entries
 */
function entriesOf(bound: KindBinding, entries: unknown, where: string, noun: string): ExprType<EastType> | undefined {
    if (entries === undefined) return undefined;
    if (bound.form !== "record") {
        throw new Error(`${where}: entries reads beside Record.bind: bind the ${noun} with Record.bind(record), ` +
            "or bind Data.bindPaged(record) alone to read them through their source, read only");
    }
    return checkEntries(entries, StringType, bound.rowType, `${where}: \`entries\``);
}

/**
 * A state's or a transition's reads, as its binding and its source of the
 * slice decide them (R3, R4): whole, or complete through its source; and the
 * record read by key.
 *
 * @param bound - The kind's binding
 * @param entries - Its `entries`, checked
 * @param part - Its source of the slice, named after it, when the slice has one
 * @param where - The kind, as a refusal names it
 * @param noun - The kind, as the slice's source is named after it
 * @param every - Whether, read through its source, it reads every row: under `narrowed="dim"` (R6)
 * @returns `()` → its rows, by key, and the paged read its rows are read by key through, if any
 * @throws {Error} Naming the form to use, for each binding its read does not take
 */
function readsOf(bound: KindBinding, entries: ExprType<EastType> | undefined, part: ExprType<StructType> | undefined, where: string,
    noun: "states" | "transitions", every: boolean) {
    const source = `give a source named ${noun}, Data.bindPaged(record, { indexes }) over the ${noun}' record`;
    if (part === undefined) {
        if (bound.form === "paged") {
            throw new Error(`${where}: Data.bindPaged(record) reads the ${noun} through their source of the slice: ${source} — ` +
                "or bind Data.bind(record) to read them whole");
        }
        if (entries !== undefined) throw new Error(`${where}: the ${noun} are read through their source of the slice: ${source}, or drop entries`);
        return { rows: kindWholeRows(bound.handle, bound.rowType), byKey: undefined };
    }
    if (bound.form === "data") {
        throw new Error(`${where}: Data.bind(record) reads the ${noun} whole, and the slice's source "${noun}" reads them through it — ` +
            "bind Data.bindPaged(record) to read them through their source, read only, or Record.bind(record) with entries: Data.bindPaged(record) to edit them");
    }
    if (bound.form === "record" && entries === undefined) {
        throw new Error(`${where}: the slice's source "${noun}" reads only its narrowing, and a row is read by its key — the inspector's, ` +
            `a gesture's original and Save's confirmation: give entries: Data.bindPaged(record) beside Record.bind, the ${noun}' record's own entries`);
    }
    return {
        rows: kindSourceRows(part, noun, bound.rowType, where, every, `name it "${noun}", over the ${noun}' own record`),
        byKey: bound.form === "paged" ? bound.handle : entries,
    };
}

// ============================================================================
// Shared parts
// ============================================================================

/** A role naming a String field, or an Option of one, checked. */
interface TextField {
    readonly field: string;
    readonly optional: boolean;
}

/**
 * Checks a text role: a String field, or an Option of one.
 *
 * @param rowType - The kind's row type
 * @param where - The kind, as a refusal names it
 * @param role - The role, as the refusal names it
 * @param name - What it was given
 * @returns The field, checked
 * @throws {Error} When it names no field of the row, or one of another type
 */
function textField(rowType: StructType, where: string, role: string, name: unknown): TextField {
    if (typeof name !== "string") throw new Error(`${where}: \`${role}\` names a String field of the row, or an Option of one`);
    const type = fieldTypeOf(rowType, where)(role, name);
    if (isTypeEqual(type, StringType)) return { field: name, optional: false };
    if (isTypeEqual(type, OptionType(StringType))) return { field: name, optional: true };
    throw new Error(`${where}: \`${role}\` names a String field, or an Option of one — "${name}" holds ${typeText(type)}`);
}

/** A text field's value as a String: an Option field holding none is empty. */
function textOf(row: unknown, text: TextField): ExprType<StringType> {
    const value = fieldOf(row, text.field);
    return text.optional
        ? (value as unknown as ExprType<OptionType<StringType>>).match({ none: (_$) => East.value("", StringType), some: (_$, t) => t })
        : value as unknown as ExprType<StringType>;
}

/** A String written to a text field: into an Option field, an empty one is none. */
function textValue(text: TextField, value: ExprType<StringType>): ExprType<EastType> {
    if (!text.optional) return value as ExprType<EastType>;
    return East.equal(value, "").ifElse(
        (_$) => East.value(none, OptionType(StringType)),
        (_$) => East.value(some(value), OptionType(StringType)),
    ) as unknown as ExprType<EastType>;
}

/**
 * A field written from a gesture's Option, `none` keeping it as it was.
 *
 * @param given - The gesture's value for the field
 * @param source - The row it is written over
 * @param field - The field
 * @param value - What a given value writes
 * @returns The field's value
 */
function kept<T extends EastType>(given: ExprType<OptionType<T>>, source: unknown, field: string,
    value: (v: ExprType<T>) => ExprType<EastType>): ExprType<EastType> {
    return (given as unknown as { match: (arms: object) => ExprType<EastType> }).match({
        none: (_$: unknown) => fieldOf(source, field),
        some: (_$: unknown, v: ExprType<T>) => value(v),
    });
}

/** Checks a kind's `name` or `icon`: a string when given, else its default. */
function wordOf(where: string, prop: "name" | "icon", given: unknown, otherwise: string): string {
    if (given === undefined) return otherwise;
    if (typeof given !== "string" || given === "") {
        throw new Error(`${where}: \`${prop}\` is ${prop === "name" ? "what one is called, a string" : "a Font Awesome solid icon's name"}`);
    }
    return given;
}

/** Each field's type default, for the fields a new row takes from a gesture rather than from a card's values. */
function defaultsOf(rowType: StructType, placed: readonly string[]): Record<string, ExprType<EastType>> {
    const fields = rowType.fields as Record<string, EastType>;
    return Object.fromEntries(placed.map((name) => [name, East.value(defaultValue(fields[name]!) as never, fields[name]!) as ExprType<EastType>]));
}

/**
 * A new row's source: a card's values, or the values' type defaults, with the
 * fields a drop writes at their type defaults — what a gesture then writes its
 * roles over.
 *
 * @param rowType - The record's row type
 * @param valuesType - The values' type: the row's fields less those `placed` names
 * @param placed - The fields a drop writes
 * @returns `(values)` → the row, from a card's values' bytes, if any
 */
function sourceOf(rowType: StructType, valuesType: StructType, placed: readonly string[]) {
    return East.function([OptionType(BlobType)], rowType, ($, values) => {
        const given = $.const(values.match({
            some: (_$2, bytes) => bytes.decodeBeast(valuesType, "v2") as ExprType<EastType>,
            none: (_$2) => East.value(defaultValue(valuesType) as never, valuesType) as ExprType<EastType>,
        }) as ExprType<EastType>);
        return rowWith(rowType, given, defaultsOf(rowType, placed)) as never;
    });
}

/** The key a Flowchart's declarations carry their sort under. */
export const FLOWCHART_DEF: unique symbol = Symbol("Flowchart.def");

/** The Flowchart's kinds, by the prop each fills. */
export type FlowchartKindSort = "states" | "transitions" | "lanes" | "decisions";

/** A kind, declared: what the Flowchart's `states`, `transitions`, `lanes` or `decisions` take. */
export interface FlowchartKindDeclaration<D extends FlowchartKindSort, W extends EastType> {
    /** What it is. */
    readonly [FLOWCHART_DEF]: D;
    /** Its record's row type. */
    readonly rowType: StructType;
    /** What one is called. */
    readonly name: string;
    /** How its record is bound. */
    readonly form: KindBinding["form"];
    /** Whether it has cards. */
    readonly hasTemplates: boolean;
    /** The slice's source its cards follow; `undefined` for none, or for a list naming none, which the Flowchart refuses. */
    readonly templatesSource: string | undefined;
    /**
     * The kind on the wire.
     *
     * @param part - Its source of the slice, the one named after it, when the slice has one: a state's or a transition's
     * @param every - Whether, read through its source, it reads every row — under `narrowed="dim"`, which draws what the
     *   narrowing leaves out as context (R6) — rather than what its narrowing holds
     * @returns The kind, closed
     * @throws {Error} When it is bound in a form its read does not take (R3), naming the form to use
     */
    build(part: ExprType<StructType> | undefined, every: boolean): ExprType<W>;
}

/** The states, declared. */
export interface FlowchartStates extends FlowchartKindDeclaration<"states", typeof FlowchartStateKindType> {
    /** Whether a state names its lane: the lanes are its columns. */
    readonly lane: boolean;
    /** Whether a read of its details shows in the inspector alone: refused beside `inspector={false}` (#1507). */
    readonly inspectorReads: boolean;
    /** Its details' row type and the rail's source whose picks weigh them (#1522); `undefined` for details none weighs, or none. */
    readonly weighedBy: { readonly source: string; readonly rowType: StructType } | undefined;
}

/** The transitions, declared. */
export interface FlowchartTransitions extends FlowchartKindDeclaration<"transitions", typeof FlowchartTransitionKindType> {
    /** Whether a transition names the decision that governs it. */
    readonly decision: boolean;
    /** Whether a read of its details shows in the inspector alone: refused beside `inspector={false}` (#1507). */
    readonly inspectorReads: boolean;
    /** Its details' row type and the rail's source whose picks weigh them (#1522); `undefined` for details none weighs, or none. */
    readonly weighedBy: { readonly source: string; readonly rowType: StructType } | undefined;
}

/** The lanes, declared. */
export type FlowchartLanes = FlowchartKindDeclaration<"lanes", typeof FlowchartLaneKindType>;

/** The decisions, declared. */
export type FlowchartDecisions = FlowchartKindDeclaration<"decisions", typeof FlowchartDecisionKindType>;

/**
 * Whether something is a Flowchart kind of the sort given.
 *
 * @param value - What a prop holds
 * @param sort - The sort the prop takes
 * @returns Whether it is one
 */
export function isFlowchartKind(value: unknown, sort: FlowchartKindSort): boolean {
    return typeof value === "object" && value !== null && FLOWCHART_DEF in value && (value as { [FLOWCHART_DEF]: string })[FLOWCHART_DEF] === sort;
}

/** A kind's roles, from its row and its key, as the record-kind machinery calls them. */
type RolesOf = ExprType<FunctionType<[EastType, StringType], EastType>>;

/**
 * A state's or a transition's details, checked where the kind declares them
 * (#1507, R21): `Flowchart.details`', and on a transition what its label draws.
 *
 * @param details - What the kind's `details` holds
 * @param where - The kind, as a refusal names it
 * @param noun - The kind's rows
 * @returns The details; `undefined` for none
 * @throws {Error} When they are not `Flowchart.details`', and on a transition, a tags or a histogram read on the canvas
 *   and lines past three
 */
function detailsOf(details: unknown, where: string, noun: "states" | "transitions"): FlowchartDetails<StructType, unknown, unknown> | undefined {
    if (details === undefined) return undefined;
    if (!isFlowchartDetails(details)) {
        throw new Error(`${where}: \`details\` takes Flowchart.details(binding, { details: [ … ] }) — the reads over the app's rows, keyed as the ${noun} are`);
    }
    details.check(noun, where);
    return details;
}

// ============================================================================
// Flowchart.states
// ============================================================================

/**
 * The states (R1, R2): a record of the app's, each row a state, its card on
 * the canvas.
 *
 * @typeParam R - The record's row type
 * @typeParam L - The `lane` field
 * @typeParam O - The `order` field
 */
export interface FlowchartStatesSpec<R extends StructType, L extends string, O extends string> extends RecordSide<R> {
    /** What one is called: in the inspector, Issues and the library; "State" unless given. */
    name?: string;
    /** Its Font Awesome solid icon; "square" unless given. */
    icon?: string;
    /** The field its card's name is: a String, or an Option of one. A rename writes it. */
    label: FlowchartTextField<R>;
    /** The String field naming its lane by the lane's key: a move across lanes writes it. Needs `lanes`. */
    lane?: L;
    /** The Float field placing it in its lane: a move between two cards writes the middle of theirs. Without it, the states stand by key. */
    order?: O;
    /** A class of interchangeable states: the ×N badge. */
    members?: Accessor<R, OptionType<IntegerType>>;
    /**
     * Its details (#1507): `Flowchart.details(binding, { details: [ … ] })` over the app's rows keyed as the states are,
     * drawn on each card and shown in full in the inspector, each read where its `show` says.
     */
    details?: FlowchartDetails<StructType, FlowchartDetailsSpec<StructType>, unknown>;
    /** The Steps tab's cards: `Flowchart.templates(rows, { name, values, source })`, each giving every field but `lane` and `order`. */
    templates?: FlowchartTemplates<FlowchartValuesOf<R, L | O>>;
    /** Hints for the inspector's form over the fields no role writes (`Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** Its own Details in the inspector, in place of its form. */
    inspector?: RowInspector<R>;
}

/**
 * Declares the states (see the module docs, R1–R3).
 *
 * @typeParam R - The record's row type
 * @typeParam L - The `lane` field
 * @typeParam O - The `order` field
 * @param binding - The app's record of states: `Record.bind(record)`, its record declaring `patch: mutation.patch()`, to edit
 *   them — read whole, or through the slice's `states` source with `entries: Data.bindPaged(record)` — or `Data.bind(record)`,
 *   read whole, or `Data.bindPaged(record)`, read through their source, to read them only
 * @param spec - What one is called, its icon, the fields its roles are, its accessors, and its cards, form, Details and check
 * @returns The states, for the Flowchart's `states`
 * @throws {Error} Naming the role or the binding (R2, R3): a role naming a field the row lacks, or one of another type;
 *   `label` and `lane` naming one field; an accessor returning another type; cards written in the code, or giving other
 *   fields than every field but `lane` and `order`; and a record that is no binding of a record of structs keyed by
 *   String, a `Record.bind` without its patch door, or `entries` beside a read-only binding
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Flowchart, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * // The depot's four records, each declaring its patch door: Save writes each through its own.
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
 *
 * const flowchartDepotEditing = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const states = $.let(Record.bind(depotStates));
 *         const transitions = $.let(Record.bind(depotTransitions));
 *         const lanes = $.let(Record.bind(depotLanes));
 *         const decisions = $.let(Record.bind(depotDecisions));
 *         return (
 *             <Box height="600px">
 *                 <Flowchart
 *                     states={Flowchart.states(states, {
 *                         label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
 *                         // The app's check on a drafted state: Save waits until it names its flow, and Issues says why.
 *                         ready: (s) => s.flow.equal("").ifElse(
 *                             () => variant("incomplete", [{ field: "flow", message: "Give the state its flow" }]),
 *                             () => variant("ready", null),
 *                         ),
 *                     })}
 *                     transitions={Flowchart.transitions(transitions, { from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind })}
 *                     lanes={Flowchart.lanes(lanes, { label: "label", order: "seq" })}
 *                     decisions={Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) })}
 *                     name="depotEditing"
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function flowchartStates<R extends StructType, L extends FlowchartKeyField<R> = never, O extends FlowchartOrderField<R> = never>(
    binding: FlowchartBinding<R>, spec: FlowchartStatesSpec<R, L, O>,
): FlowchartStates {
    const where = "Flowchart.states";
    const bound = boundOf(binding, where, "states", false);
    const rowType = bound.rowType;
    const role = roleField(rowType, where);
    const entries = entriesOf(bound, spec.entries, where, "states");
    const name = wordOf(where, "name", spec.name, "State");
    const icon = wordOf(where, "icon", spec.icon, "square");

    // The roles that are fields.
    const label = textField(rowType, where, "label", spec.label);
    const laneField = role("lane", spec.lane as string | undefined, StringType, "a String field holding its lane's key");
    const orderField = role("order", spec.order as string | undefined, FloatType, "a Float field, the state's place in its lane");
    if (laneField !== undefined && laneField === label.field) {
        throw new Error(`${where}: \`label\` and \`lane\` both name "${laneField}" — a state's name and its lane are two fields`);
    }
    // The role the app computes.
    const membersOf = accessorRole(rowType, where, "members", OptionType(IntegerType), "an Option of an Integer", spec.members);
    // Its details, read as the states are (#1507).
    const details = detailsOf(spec.details, where, "states");

    // The cards: every field but the lane and the order.
    const placed = [laneField, orderField].filter((field): field is string => field !== undefined);
    const ValuesType = valuesTypeOf(rowType, placed);
    const templates = checkedFlowchartTemplates(spec.templates, ValuesType, placed, where);

    // One state's roles, from its row and its key.
    const rolesOf = East.function([rowType, StringType], FlowchartStateRolesType, ($, row, key) => East.value({
        label: textOf(row, label),
        lane: laneField === undefined ? none : some(fieldOf(row, laneField)),
        order: orderField === undefined ? none : some(fieldOf(row, orderField)),
        members: called($, membersOf, row, key, (m) => m, none),
    } as never, FlowchartStateRolesType)) as unknown as RolesOf;

    // The row with a gesture's roles written over `source`, each where given, every other field as it was (R8).
    const written = (source: unknown, w: ExprType<typeof FlowchartStateWriteType>): Record<string, unknown> => ({
        [label.field]: kept(w.label, source, label.field, (t) => textValue(label, t)),
        ...(laneField === undefined ? {} : { [laneField]: kept(w.lane, source, laneField, (k) => k as ExprType<EastType>) }),
        ...(orderField === undefined ? {} : { [orderField]: kept(w.order, source, orderField, (o) => o as ExprType<EastType>) }),
    });
    const write = East.function([BlobType, FlowchartStateWriteType], OptionType(BlobType), ($, bytes, w) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        return East.value(some(East.Blob.encodeBeast(rowWith(rowType, row, written(row, w)), "v2")), OptionType(BlobType));
    });
    // A new state: its roles over a card's values, or its type's defaults.
    const source = sourceOf(rowType, ValuesType, placed);
    const create = East.function([FlowchartStateWriteType, OptionType(BlobType)], OptionType(BlobType), ($, w, values) => {
        const from = $.const(source);
        const row = $.const(from(values) as ExprType<EastType>);
        return East.value(some(East.Blob.encodeBeast(rowWith(rowType, row, written(row, w)), "v2")), OptionType(BlobType));
    });

    return {
        [FLOWCHART_DEF]: "states",
        rowType,
        name,
        form: bound.form,
        lane: laneField !== undefined,
        inspectorReads: details?.inspectorReads ?? false,
        weighedBy: details?.source === undefined ? undefined : { source: details.source, rowType: details.rowType },
        hasTemplates: templates !== undefined,
        templatesSource: templates?.source,
        build(part, every) {
            const { rows, byKey } = readsOf(bound, entries, part, where, "states", every);
            const side = recordSide(bound, entries, byKey, spec, [label.field, laneField, orderField], where);
            return East.value({
                ...side,
                name,
                icon,
                rows: storedRows(rows, rolesOf, FlowchartStateEntryType),
                // Rows a reader read by key through the states' source — a hidden end's, Find's — made stored states (R6, R17).
                rowsOf: rowsReadOf(rowType, rolesOf, FlowchartStateEntryType),
                read: readOf(rowType, rolesOf, FlowchartStateRolesType),
                write,
                create,
                templates: templates?.items ?? East.value([], ArrayType(FlowchartTemplateType)),
                templatesSource: templates?.source === undefined ? none : some(templates.source),
                // The field naming a state's lane: a conflict on it named by the lane's label (#1503).
                laneField: laneField === undefined ? none : some(laneField),
                // Its details, read as the states are: whole, or by the drawn rows' keys (#1507, R19).
                details: details === undefined ? none : some(details.build("states", where, part !== undefined)),
            } as never, FlowchartStateKindType) as ExprType<typeof FlowchartStateKindType>;
        },
    };
}

// ============================================================================
// Flowchart.transitions
// ============================================================================

/**
 * The transitions (R1, R2): a record of the app's, each row a transition
 * between two states.
 *
 * @typeParam R - The record's row type
 * @typeParam F - The `from` field
 * @typeParam T - The `to` field
 * @typeParam D - The `decision` field
 */
export interface FlowchartTransitionsSpec<R extends StructType, F extends string, T extends string, D extends string> extends RecordSide<R> {
    /** What one is called; "Transition" unless given. */
    name?: string;
    /** Its Font Awesome solid icon; "arrow-right" unless given. */
    icon?: string;
    /** The String field naming the state it leaves, by its key: Connect writes both ends. */
    from: F;
    /** The String field naming the state it enters. */
    to: T;
    /** The field naming the decision that governs it, by its key: a String, empty for none, or an Option of one. Needs `decisions`. */
    decision?: D;
    /** Planned or observed: planned unless given. */
    kind?: Accessor<R, typeof FlowchartLinkKindType>;
    /** The label's evidence line and the stroke's weight. */
    evidence?: Accessor<R, OptionType<typeof FlowchartEvidenceType>>;
    /**
     * Its details (#1507): `Flowchart.details(binding, { details: [ … ] })` over the app's rows keyed as the transitions
     * are, drawn as lines under each label's evidence — figures and lists, three lines at most — and shown in full in the
     * inspector; its tags and histograms show there alone, a type error otherwise, with its words.
     */
    details?: FlowchartDetails<StructType, FlowchartTransitionDetailsSpec>;
    /** The Transitions tab's cards: `Flowchart.templates(rows, { name, values, source })`, each giving every field but `from` and `to`. */
    templates?: FlowchartTemplates<FlowchartValuesOf<R, F | T>>;
    /** Hints for the inspector's form over the fields no role writes (`Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** Its own Details in the inspector, in place of its form. */
    inspector?: RowInspector<R>;
}

/** A transition's decision field, checked: a String, empty for none, or an Option of one. */
type DecisionField = TextField;

/**
 * Declares the transitions (see the module docs, R1–R3).
 *
 * @typeParam R - The record's row type
 * @typeParam F - The `from` field
 * @typeParam T - The `to` field
 * @typeParam D - The `decision` field
 * @param binding - The app's record of transitions, bound as `Flowchart.states`' is
 * @param spec - What one is called, its icon, its ends and its decision, its accessors, and its cards, form, Details and check
 * @returns The transitions, for the Flowchart's `transitions`
 * @throws {Error} Naming the role or the binding, as `Flowchart.states` does, and `from`, `to` and `decision` naming one field
 */
export function flowchartTransitions<R extends StructType, F extends FlowchartKeyField<R>, T extends FlowchartKeyField<R>, D extends FlowchartKeyField<R, true> = never>(
    binding: FlowchartBinding<R>, spec: FlowchartTransitionsSpec<R, F, T, D>,
): FlowchartTransitions {
    const where = "Flowchart.transitions";
    const bound = boundOf(binding, where, "transitions", false);
    const rowType = bound.rowType;
    const role = roleField(rowType, where);
    const entries = entriesOf(bound, spec.entries, where, "transitions");
    const name = wordOf(where, "name", spec.name, "Transition");
    const icon = wordOf(where, "icon", spec.icon, "arrow-right");

    // The ends, each a String field naming a state by its key, and the decision.
    const end = (prop: "from" | "to", given: unknown): string => {
        if (typeof given !== "string") throw new Error(`${where}: \`${prop}\` names the String field holding a state's key`);
        return role(prop, given, StringType, "a state by its key, a String field")!;
    };
    const fromField = end("from", spec.from);
    const toField = end("to", spec.to);
    if (fromField === toField) throw new Error(`${where}: \`from\` and \`to\` both name "${fromField}" — a transition's ends are two fields`);
    const decision: DecisionField | undefined = spec.decision === undefined ? undefined : textField(rowType, where, "decision", spec.decision);
    if (decision !== undefined && (decision.field === fromField || decision.field === toField)) {
        throw new Error(`${where}: \`decision\` and \`${decision.field === fromField ? "from" : "to"}\` both name "${decision.field}" — a transition's decision and its ends are three fields`);
    }
    // The roles the app computes.
    const kindOf = accessorRole(rowType, where, "kind", FlowchartLinkKindType, "a Flowchart.Types.Kind, planned or observed", spec.kind);
    const evidenceOf = accessorRole(rowType, where, "evidence", OptionType(FlowchartEvidenceType), "an Option of a Flowchart.Types.Evidence", spec.evidence);
    // Its details, read as the transitions are (#1507): what its label draws, checked.
    const details = detailsOf(spec.details, where, "transitions");

    // The cards: every field but the ends.
    const placed = [fromField, toField];
    const ValuesType = valuesTypeOf(rowType, placed);
    const templates = checkedFlowchartTemplates(spec.templates, ValuesType, placed, where);

    // One transition's roles, from its row and its key: a decision's String field, empty, names none.
    const rolesOf = East.function([rowType, StringType], FlowchartTransitionRolesType, ($, row, key) => {
        let named: unknown = none;
        if (decision !== undefined) {
            const held = $.const(fieldOf(row, decision.field));
            named = decision.optional ? held : East.equal(held as ExprType<StringType>, "").ifElse(
                (_$2) => East.value(none, OptionType(StringType)),
                (_$2) => East.value(some(held as ExprType<StringType>), OptionType(StringType)),
            );
        }
        return East.value({
            from: fieldOf(row, fromField),
            to: fieldOf(row, toField),
            decision: named,
            kind: called($, kindOf, row, key, (k) => k, East.value(variant("planned", null), FlowchartLinkKindType)),
            evidence: called($, evidenceOf, row, key, (e) => e, none),
        } as never, FlowchartTransitionRolesType);
    }) as unknown as RolesOf;

    // The row with a gesture's ends and decision written over `source`, each where given (R8): a decision cleared is
    // an empty String field, or an Option field holding none.
    const written = (source: unknown, w: ExprType<typeof FlowchartTransitionWriteType>): Record<string, unknown> => ({
        [fromField]: kept(w.from, source, fromField, (k) => k as ExprType<EastType>),
        [toField]: kept(w.to, source, toField, (k) => k as ExprType<EastType>),
        ...(decision === undefined ? {} : {
            [decision.field]: kept(w.decision, source, decision.field, (d) => decision.optional ? d as unknown as ExprType<EastType>
                : d.match({ none: (_$) => East.value("", StringType), some: (_$, k) => k }) as unknown as ExprType<EastType>),
        }),
    });
    const write = East.function([BlobType, FlowchartTransitionWriteType], OptionType(BlobType), ($, bytes, w) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        return East.value(some(East.Blob.encodeBeast(rowWith(rowType, row, written(row, w)), "v2")), OptionType(BlobType));
    });
    // A new transition — Connect — its ends over a card's values, or its type's defaults.
    const source = sourceOf(rowType, ValuesType, placed);
    const create = East.function([FlowchartTransitionWriteType, OptionType(BlobType)], OptionType(BlobType), ($, w, values) => {
        const from = $.const(source);
        const row = $.const(from(values) as ExprType<EastType>);
        return East.value(some(East.Blob.encodeBeast(rowWith(rowType, row, written(row, w)), "v2")), OptionType(BlobType));
    });

    return {
        [FLOWCHART_DEF]: "transitions",
        rowType,
        name,
        form: bound.form,
        decision: decision !== undefined,
        inspectorReads: details?.inspectorReads ?? false,
        weighedBy: details?.source === undefined ? undefined : { source: details.source, rowType: details.rowType },
        hasTemplates: templates !== undefined,
        templatesSource: templates?.source,
        build(part, every) {
            const { rows, byKey } = readsOf(bound, entries, part, where, "transitions", every);
            const side = recordSide(bound, entries, byKey, spec, [fromField, toField, decision?.field], where);
            return East.value({
                ...side,
                name,
                icon,
                rows: storedRows(rows, rolesOf, FlowchartTransitionEntryType),
                read: readOf(rowType, rolesOf, FlowchartTransitionRolesType),
                write,
                create,
                templates: templates?.items ?? East.value([], ArrayType(FlowchartTemplateType)),
                templatesSource: templates?.source === undefined ? none : some(templates.source),
                // The fields naming its ends and its decision: a conflict on one named by its state's label, or the decision's (#1503).
                fromField,
                toField,
                decisionField: decision === undefined ? none : some(decision.field),
                // Its details, read as the transitions are: whole, or by the drawn rows' keys (#1507, R19).
                details: details === undefined ? none : some(details.build("transitions", where, part !== undefined)),
            } as never, FlowchartTransitionKindType) as ExprType<typeof FlowchartTransitionKindType>;
        },
    };
}

// ============================================================================
// Flowchart.lanes
// ============================================================================

/**
 * The lanes (R1, R2, D5): a small record of the app's, read whole, each row a
 * column of the canvas.
 *
 * @typeParam R - The record's row type
 * @typeParam O - The `order` field
 */
export interface FlowchartLanesSpec<R extends StructType, O extends string> {
    /** What one is called; "Lane" unless given. */
    name?: string;
    /** The field its header is: a String, or an Option of one. + LANE and a rename write it. */
    label: FlowchartTextField<R>;
    /** The Integer or Float field placing it among the lanes: + LANE writes one past the last. Without it, the lanes stand by key. */
    order?: O;
    /** The Lanes tab's cards: `Flowchart.templates(rows, { name, values, source })`, each giving every field but `order`. */
    templates?: FlowchartTemplates<FlowchartValuesOf<R, O>>;
    /** Hints for the inspector's form over the fields no role writes (`Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** Its own Details in the inspector, in place of its form. */
    inspector?: RowInspector<R>;
}

/**
 * Declares the lanes (see the module docs, R1–R3, D5).
 *
 * @typeParam R - The record's row type
 * @typeParam O - The `order` field
 * @param binding - The app's record of lanes: `Record.bind(record)`, its record declaring `patch: mutation.patch()`, to edit
 *   them, or `Data.bind(record)` to read them — each read whole
 * @param spec - What one is called, the fields its header and its order are, and its cards, form and Details
 * @returns The lanes, for the Flowchart's `lanes`
 * @throws {Error} Naming the role or the binding, as `Flowchart.states` does: a paged read, and `entries`, among them —
 *   the lanes are read whole
 */
export function flowchartLanes<R extends StructType, O extends FlowchartOrderField<R, IntegerType | FloatType> = never>(
    binding: FlowchartWholeBinding<R>, spec: FlowchartLanesSpec<R, O>,
): FlowchartLanes {
    const where = "Flowchart.lanes";
    const bound = boundOf(binding, where, "lanes", true);
    const rowType = bound.rowType;
    if ((spec as { entries?: unknown }).entries !== undefined) throw new Error(`${where}: the lanes are read whole — leave entries out`);
    const name = wordOf(where, "name", spec.name, "Lane");
    const label = textField(rowType, where, "label", spec.label);
    // The order: a Float field, or an Integer one, which takes a whole order alone.
    let orderField: string | undefined;
    let integer = false;
    if (spec.order !== undefined) {
        if (typeof spec.order !== "string") throw new Error(`${where}: \`order\` names the Integer or Float field placing a lane among the lanes`);
        const type = fieldTypeOf(rowType, where)("order", spec.order);
        integer = isTypeEqual(type, IntegerType);
        if (!integer && !isTypeEqual(type, FloatType)) {
            throw new Error(`${where}: \`order\` names an Integer or a Float field, the lane's place among the lanes — "${spec.order}" holds ${typeText(type)}`);
        }
        orderField = spec.order;
    }

    // The cards: every field but the order.
    const placed = orderField === undefined ? [] : [orderField];
    const ValuesType = valuesTypeOf(rowType, placed);
    const templates = checkedFlowchartTemplates(spec.templates, ValuesType, placed, where);

    // One lane's roles, from its row and its key: an Integer order read as a Float.
    const rolesOf = East.function([rowType, StringType], FlowchartLaneRolesType, ($, row, _key) => {
        let order: unknown = none;
        if (orderField !== undefined) {
            const held = $.const(fieldOf(row, orderField));
            order = some(integer ? (held as unknown as ExprType<IntegerType>).toFloat() : held);
        }
        return East.value({ label: textOf(row, label), order } as never, FlowchartLaneRolesType);
    }) as unknown as RolesOf;

    // The row with a gesture's label and order written over `source`, each where given (R8); `none` for an order an
    // Integer field can't hold, between two whole numbers — the renderer moves the lanes after it on.
    const laned = ($: BlockBuilder<OptionType<BlobType>>, source: unknown, w: ExprType<typeof FlowchartLaneWriteType>) => {
        const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
        const fits = orderField === undefined || !integer ? East.value(true)
            : w.order.match({ none: (_$2) => East.value(true), some: (_$2, o) => East.equal(o.remainder(1.0).abs(), 0.0) });
        $.if(fits, ($2) => {
            const set: Record<string, unknown> = {
                [label.field]: kept(w.label, source, label.field, (t) => textValue(label, t)),
                ...(orderField === undefined ? {} : {
                    [orderField]: kept(w.order, source, orderField, (o) => (integer ? o.toInteger() : o) as ExprType<EastType>),
                }),
            };
            $2.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, source, set), "v2")), OptionType(BlobType)));
        });
        return result;
    };
    const write = East.function([BlobType, FlowchartLaneWriteType], OptionType(BlobType), ($, bytes, w) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        return laned($, row, w);
    });
    // A new lane — + LANE, or a card dropped between two lanes — over a card's values, or its type's defaults.
    const source = sourceOf(rowType, ValuesType, placed);
    const create = East.function([FlowchartLaneWriteType, OptionType(BlobType)], OptionType(BlobType), ($, w, values) => {
        const from = $.const(source);
        const row = $.const(from(values) as ExprType<EastType>);
        return laned($, row, w);
    });

    return {
        [FLOWCHART_DEF]: "lanes",
        rowType,
        name,
        form: bound.form,
        hasTemplates: templates !== undefined,
        templatesSource: templates?.source,
        build(_part, _every) {
            const side = recordSide(bound, undefined, undefined, spec as RecordSide<StructType>, [label.field, orderField], where);
            return East.value({
                ...side,
                name,
                icon: "table-columns",
                rows: storedRows(kindWholeRows(bound.handle, rowType), rolesOf, FlowchartLaneEntryType),
                read: readOf(rowType, rolesOf, FlowchartLaneRolesType),
                write,
                create,
                templates: templates?.items ?? East.value([], ArrayType(FlowchartTemplateType)),
                templatesSource: templates?.source === undefined ? none : some(templates.source),
            } as never, FlowchartLaneKindType) as ExprType<typeof FlowchartLaneKindType>;
        },
    };
}

// ============================================================================
// Flowchart.decisions
// ============================================================================

/**
 * The decisions (R1, R2): a small record of the app's, read whole, each row a
 * lettered diamond on the transitions that name it.
 *
 * @typeParam R - The record's row type
 */
export interface FlowchartDecisionsSpec<R extends StructType> {
    /** What one is called; "Decision" unless given. */
    name?: string;
    /** Its name. */
    label: Accessor<R, StringType>;
    /** The diamond's letter: the label's first unless given. */
    letter?: Accessor<R, OptionType<StringType>>;
    /** Who owns it. */
    owner?: Accessor<R, OptionType<StringType>>;
    /** Its outcomes' summary line. */
    outcomes?: Accessor<R, OptionType<StringType>>;
    /** The Array or Set of String field naming the states queued at it, by key: a state's Del takes its key out. */
    queue?: FlowchartKeysField<R>;
    /** Hints for the inspector's form over the fields no role writes (`Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** Its own Details in the inspector, in place of its form. */
    inspector?: RowInspector<R>;
}

/**
 * Declares the decisions (see the module docs, R1–R3).
 *
 * @typeParam R - The record's row type
 * @param binding - The app's record of decisions, bound as `Flowchart.lanes`' is
 * @param spec - What one is called, its accessors, its queue, and its form and Details
 * @returns The decisions, for the Flowchart's `decisions`
 * @throws {Error} Naming the role or the binding, as `Flowchart.lanes` does, and a `label` that is no accessor
 */
export function flowchartDecisions<R extends StructType>(binding: FlowchartWholeBinding<R>, spec: FlowchartDecisionsSpec<R>): FlowchartDecisions {
    const where = "Flowchart.decisions";
    const bound = boundOf(binding, where, "decisions", true);
    const rowType = bound.rowType;
    if ((spec as { entries?: unknown }).entries !== undefined) throw new Error(`${where}: the decisions are read whole — leave entries out`);
    const name = wordOf(where, "name", spec.name, "Decision");
    if (typeof spec.label !== "function") throw new Error(`${where}: \`label\` is an accessor giving a decision's name, (row, key) => …`);
    const labelOf = accessorRole(rowType, where, "label", StringType, "a String", spec.label)!;
    const letterOf = accessorRole(rowType, where, "letter", OptionType(StringType), "an Option of a String", spec.letter);
    const ownerOf = accessorRole(rowType, where, "owner", OptionType(StringType), "an Option of a String", spec.owner);
    const outcomesOf = accessorRole(rowType, where, "outcomes", OptionType(StringType), "an Option of a String", spec.outcomes);
    // The queue: an Array or a Set of String keys.
    let queue: { readonly field: string; readonly set: boolean } | undefined;
    if (spec.queue !== undefined) {
        if (typeof spec.queue !== "string") throw new Error(`${where}: \`queue\` names the Array or Set of String field holding the states queued at it, by key`);
        const type = fieldTypeOf(rowType, where)("queue", spec.queue);
        const set = isTypeEqual(type, SetType(StringType));
        if (!set && !isTypeEqual(type, ArrayType(StringType))) {
            throw new Error(`${where}: \`queue\` names an Array or a Set of String field, the states queued at it by key — "${spec.queue}" holds ${typeText(type)}`);
        }
        queue = { field: spec.queue, set };
    }

    // One decision's roles, from its row and its key: a Set queue in its order.
    const rolesOf = East.function([rowType, StringType], FlowchartDecisionRolesType, ($, row, key) => {
        let queued: unknown = East.value([], ArrayType(StringType));
        if (queue !== undefined) {
            const held = $.const(fieldOf(row, queue.field));
            queued = queue.set ? (held as unknown as ExprType<SetType<StringType>>).toArray((_$2, k) => k) : held;
        }
        return East.value({
            label: called($, labelOf, row, key, (l) => l, ""),
            letter: called($, letterOf, row, key, (l) => l, none),
            owner: called($, ownerOf, row, key, (o) => o, none),
            outcomes: called($, outcomesOf, row, key, (o) => o, none),
            queue: queued,
        } as never, FlowchartDecisionRolesType);
    }) as unknown as RolesOf;

    // A state's key taken out of the queue — a state's Del (R10): the row, or `none` where the key is not queued.
    const unqueue = queue === undefined ? undefined : East.function([BlobType, StringType], OptionType(BlobType), ($, bytes, key) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
        if (queue.set) {
            const held = $.let(fieldOf(row, queue.field) as unknown as ExprType<SetType<StringType>>);
            $.if(held.tryDelete(key), ($2) => {
                $2.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, row, { [queue.field]: held }), "v2")), OptionType(BlobType)));
            });
        } else {
            const held = $.const(fieldOf(row, queue.field) as unknown as ExprType<ArrayType<StringType>>);
            const left = $.const(held.filter((_$2, k) => East.equal(k, key).not()));
            $.if(left.size().equal(held.size()).not(), ($2) => {
                $2.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, row, { [queue.field]: left }), "v2")), OptionType(BlobType)));
            });
        }
        return result;
    });

    return {
        [FLOWCHART_DEF]: "decisions",
        rowType,
        name,
        form: bound.form,
        hasTemplates: false,
        templatesSource: undefined,
        build(_part, _every) {
            const side = recordSide(bound, undefined, undefined, spec as RecordSide<StructType>, [queue?.field], where);
            return East.value({
                ...side,
                name,
                icon: "diamond",
                rows: storedRows(kindWholeRows(bound.handle, rowType), rolesOf, FlowchartDecisionEntryType),
                read: readOf(rowType, rolesOf, FlowchartDecisionRolesType),
                unqueue: unqueue === undefined ? none : some(unqueue),
            } as never, FlowchartDecisionKindType) as ExprType<typeof FlowchartDecisionKindType>;
        },
    };
}
