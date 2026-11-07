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
 *   row reads back as it was, and a new row takes a card's values — with no
 *   card, its kind's `values` of what the gesture decided of it (#1549) — or
 *   its type's defaults.
 * - **A new row's key** (#1549): a state's, a transition's and a lane's `key`
 *   builds it from the row, held at build to the record's key type, and the
 *   row moves with it as an edit changes what it reads. Without one the
 *   renderer makes a String key up and counts an Integer one on from the
 *   largest. A transition's key is never typed, so an editable kind keyed by
 *   any other type is refused without `key`.
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
 * A kind's record may be keyed by any type a Dict takes (#1549), and a role
 * naming another kind's row holds that kind's key: a state's lane the lanes'
 * key, a transition's ends the states', its decision an Option of the
 * decisions' — or, where they are keyed by String, a String, empty for none —
 * and a decision's queue an Array or a Set of the states'. Each is checked
 * when the code compiles to be a field of a type a Dict may be keyed by, the
 * two ends of one type, and `<Flowchart>` checks each against the other kind's
 * key type. On the wire a key is its text, a String key as itself and any
 * other as East prints it: a kind's roles print the fields holding keys, and
 * its writes read a key's text back at the field's type, refusing a text no
 * key prints as.
 *
 * @packageDocumentation
 */

import {
    ArrayType, AsyncFunctionType, BlobType, East, Expr, FloatType, IntegerType, OptionType, PatchType, SetType, StringType,
    defaultValue, isImmutableType, isTypeEqual, none, printType, some, toEastTypeValue, variant,
    type BlockBuilder, type DictType, type EastType, type ExprType, type FunctionType, type ImmutableType, type StructType,
} from "@elaraai/east";
import { resolveRowSource, type FieldHints } from "@elaraai/east-ui/internal";
import { RecordOutcomeType } from "../bind/record.js";
import { fieldOf, type FieldName, type FieldsOf } from "../schedule/fields.js";
import { scheduleNewValues, type ScheduleNewValues } from "../schedule/values.js";
import { checkEntries, keyOfText, keyTextOf, optionOf, typeText } from "../schedule/window.js";
import {
    accessorRole, called, checkMadeKeys, fieldTypeOf, keyBuilderOf, kindSourceRows, kindWholeRows, readOf, recordSide, roleField, rowWith, rowsReadOf,
    storedRows, valuesTypeOf,
    type KindAccessor as Accessor, type KindBinding, type KindKeyBuilder, type KindRowInspector as RowInspector, type RecordSide,
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

/**
 * Fields of R that name a row of another kind by its key (#1549): a field of a type a Dict may be keyed by — the other
 * kind's key type, which `<Flowchart>` checks — or, `Optional`, an Option of one, or a String, empty for none: a
 * transition's decision.
 */
export type FlowchartKeyField<R extends StructType, Optional extends boolean = false> =
    FieldsOf<R, Optional extends true ? StringType | OptionType<ImmutableType> : ImmutableType>;

/** Fields of R that name several states by their keys: a decision's queue, an Array or a Set of the states' keys. */
export type FlowchartKeysField<R extends StructType> = FieldsOf<R, ArrayType<ImmutableType> | SetType<ImmutableType>>;

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
 * source — each over a `Dict<K, R>`, its row type `R` and its key type `K` —
 * any type a Dict may be keyed by (#1549) — inferred from the handle.
 *
 * @typeParam R - The record's row type
 * @typeParam K - The record's key type
 */
export type FlowchartBinding<R extends StructType, K extends EastType = StringType> =
    | { readonly read: (...args: never[]) => ExprType<DictType<K, R>>; readonly binding: unknown }
    | { readonly page: (...args: never[]) => ExprType<OptionType<DictType<K, R>>>; readonly revision: unknown };

/**
 * A lane's or a decision's record, bound (R3): `Record.bind`'s or
 * `Data.bind`'s handle, read whole — a small record over a `Dict<K, R>`.
 *
 * @typeParam R - The record's row type
 * @typeParam K - The record's key type
 */
export type FlowchartWholeBinding<R extends StructType, K extends EastType = StringType> =
    { readonly read: (...args: never[]) => ExprType<DictType<K, R>>; readonly binding: unknown };

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
 * @throws {Error} Naming the forms to use: anything but a binding of a record of structs — a paged read for a kind read
 *   whole, one paging an index's window, and one naming no snapshot among them — and a `Record.bind` without its patch
 *   door
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
    if (recordType.type !== "Dict" || (recordType.value as EastType).type !== "Struct") {
        throw new Error(`${where}: the ${noun}' record holds its rows by key, each a struct — and this one holds ${typeText(recordType)}`);
    }
    const rowType = recordType.value as StructType;
    // A paged read of the record's own entries, at the snapshot every read of it is at.
    if (form === "paged") checkEntries(record, recordType.key as EastType, rowType, `${where}: Data.bindPaged(record)`);
    if (form === "record") {
        // The patch door: the record's mutation.patch(), the mutation named `patch` taking the record's patch.
        const commit = fields["commit"];
        const door = commit?.type === "Struct" ? (commit.fields as Record<string, EastType>)["patch"] : undefined;
        if (door === undefined || !isTypeEqual(door, AsyncFunctionType([StringType, PatchType(recordType)], RecordOutcomeType))) {
            throw new Error(`${where}: the ${noun}' record is bound without its patch door — its record declares patch: mutation.patch(), ` +
                "which Save writes each change through");
        }
    }
    return { form, handle: record as ExprType<EastType>, keyType: recordType.key as EastType, rowType };
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
    return checkEntries(entries, bound.keyType, bound.rowType, `${where}: \`entries\``);
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
        return { rows: kindWholeRows(bound.handle, bound.keyType, bound.rowType), byKey: undefined };
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
        rows: kindSourceRows(part, noun, bound.keyType, bound.rowType, where, every, `name it "${noun}", over the ${noun}' own record`),
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
 * A role naming another kind's row by its key (#1549): its field, and what the
 * field holds, which `<Flowchart>` checks against the other kind's key type.
 */
export interface FlowchartKeyRole {
    /** The field. */
    readonly field: string;
    /**
     * What it holds: the key — or, a transition's decision, the field's own type, an Option of a key or a String,
     * empty for none; or, a decision's queue, each key it queues.
     */
    readonly type: EastType;
}

/**
 * Checks a role naming another kind's row by its key: a field of a type a
 * Dict may be keyed by.
 *
 * @param rowType - The kind's row type
 * @param where - The kind, as a refusal names it
 * @param role - The role, as the refusal names it
 * @param name - What it was given
 * @param whose - What it holds, as the refusal says it (`its lane's key`)
 * @returns The field, and the key's type
 * @throws {Error} When it names no field of the row, or one of a type no Dict is keyed by
 */
function keyRole(rowType: StructType, where: string, role: string, name: unknown, whose: string): FlowchartKeyRole {
    if (typeof name !== "string") throw new Error(`${where}: \`${role}\` names the field holding ${whose}`);
    const type = fieldTypeOf(rowType, where)(role, name);
    if (!isImmutableType(type)) {
        throw new Error(`${where}: \`${role}\` names the field holding ${whose}, of a type a Dict may be keyed by — "${name}" holds ${typeText(type)}`);
    }
    return { field: name, type };
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
 * A new row's source — what a gesture then writes its roles over: a card's
 * values, the fields a drop writes at their type defaults; with no card, the
 * kind's `values` of what the gesture decided of the row (#1549), the fields
 * its roles write at their type defaults; without `values`, the row's type
 * defaults.
 *
 * @param rowType - The record's row type
 * @param made - What a gesture decides of a new row: the kind's write
 * @param valuesType - A card's values' type: the row's fields less those `placed` names
 * @param placed - The fields a drop writes
 * @param roles - The fields the kind's roles write, which `values` leaves out
 * @param valuesOf - The kind's `values`, reified; `undefined` for none
 * @returns `(made, values)` → the row, from what the gesture decided and a card's values' bytes, if any
 */
function sourceOf(rowType: StructType, made: StructType, valuesType: StructType, placed: readonly string[], roles: readonly string[],
    valuesOf: ExprType<FunctionType<[EastType], StructType>> | undefined) {
    return East.function([made, OptionType(BlobType)], rowType, ($, decided, values) => {
        const ownOf = valuesOf === undefined ? undefined : $.const(valuesOf);
        return values.match({
            some: ($2, bytes) => {
                const given = $2.const(bytes.decodeBeast(valuesType, "v2") as ExprType<EastType>);
                return rowWith(rowType, given, defaultsOf(rowType, placed));
            },
            none: ($2) => {
                if (ownOf === undefined) return East.value(defaultValue(rowType) as never, rowType) as ExprType<EastType>;
                const own = $2.const(ownOf(decided as never) as ExprType<EastType>);
                return rowWith(rowType, own, defaultsOf(rowType, roles));
            },
        }) as never;
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
    /** Its record's key type (#1549). */
    readonly keyType: EastType;
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
    /** The field naming a state's lane, and the lanes' key it holds; `undefined` for states that name none. The lanes are its columns. */
    readonly lane: FlowchartKeyRole | undefined;
    /** Whether a read of its details shows in the inspector alone: refused beside `inspector={false}` (#1507). */
    readonly inspectorReads: boolean;
    /** Its details' row type and the rail's source whose picks weigh them (#1522); `undefined` for details none weighs, or none. */
    readonly weighedBy: { readonly source: string; readonly rowType: StructType } | undefined;
}

/** The transitions, declared. */
export interface FlowchartTransitions extends FlowchartKindDeclaration<"transitions", typeof FlowchartTransitionKindType> {
    /** The fields naming a transition's ends, and the states' key they hold. */
    readonly ends: { readonly from: string; readonly to: string; readonly type: EastType };
    /**
     * The field naming the decision that governs a transition, and its type — an Option of the decisions' key, or a
     * String, empty for none; `undefined` for transitions that name none.
     */
    readonly decision: FlowchartKeyRole | undefined;
    /** Whether a read of its details shows in the inspector alone: refused beside `inspector={false}` (#1507). */
    readonly inspectorReads: boolean;
    /** Its details' row type and the rail's source whose picks weigh them (#1522); `undefined` for details none weighs, or none. */
    readonly weighedBy: { readonly source: string; readonly rowType: StructType } | undefined;
}

/** The lanes, declared. */
export type FlowchartLanes = FlowchartKindDeclaration<"lanes", typeof FlowchartLaneKindType>;

/** The decisions, declared. */
export interface FlowchartDecisions extends FlowchartKindDeclaration<"decisions", typeof FlowchartDecisionKindType> {
    /** The field naming the states queued at a decision, and the states' key each holds; `undefined` for decisions with no queue. */
    readonly queue: FlowchartKeyRole | undefined;
}

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

/** A kind's roles, from its row and its key at the record's key type, as the record-kind machinery calls them. */
type RolesOf = ExprType<FunctionType<[EastType, EastType], EastType>>;

/**
 * A state's or a transition's details, checked where the kind declares them
 * (#1507, R21): `Flowchart.details`', and on a transition what its label draws.
 *
 * @param details - What the kind's `details` holds
 * @param where - The kind, as a refusal names it
 * @param noun - The kind's rows
 * @param keyType - The kind's key type, which its details' record is keyed by (#1549)
 * @returns The details; `undefined` for none
 * @throws {Error} When they are not `Flowchart.details`', or their record is keyed by another type than the kind's,
 *   naming both; and on a transition, a tags or a histogram read on the canvas and lines past three
 */
function detailsOf(details: unknown, where: string, noun: "states" | "transitions", keyType: EastType): FlowchartDetails<StructType, unknown, unknown> | undefined {
    if (details === undefined) return undefined;
    if (!isFlowchartDetails(details)) {
        throw new Error(`${where}: \`details\` takes Flowchart.details(binding, { details: [ … ] }) — the reads over the app's rows, keyed as the ${noun} are`);
    }
    if (!isTypeEqual(details.keyType, keyType)) {
        throw new Error(`${where}: the details' record is keyed by ${typeText(details.keyType)}, and the ${noun}' by ${typeText(keyType)} — ` +
            `key the details as the ${noun} are`);
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
 * @typeParam K - The record's key type
 */
export interface FlowchartStatesSpec<R extends StructType, L extends string, O extends string, K extends EastType = StringType> extends RecordSide<R, K> {
    /** What one is called: in the inspector, Issues and the library; "State" unless given. */
    name?: string;
    /** Its Font Awesome solid icon; "square" unless given. */
    icon?: string;
    /** The field its card's name is: a String, or an Option of one. A rename writes it. */
    label: FlowchartTextField<R>;
    /** The field naming its lane by the lane's key, of the type the lanes are keyed by: a move across lanes writes it. Needs `lanes`. */
    lane?: L;
    /** The Float field placing it in its lane: a move between two cards writes the middle of theirs. Without it, the states stand by key. */
    order?: O;
    /** A class of interchangeable states: the ×N badge. */
    members?: Accessor<R, OptionType<IntegerType>, K>;
    /**
     * Its details (#1507): `Flowchart.details(binding, { details: [ … ] })` over the app's rows keyed as the states are,
     * drawn on each card and shown in full in the inspector, each read where its `show` says.
     */
    details?: FlowchartDetails<StructType, FlowchartDetailsSpec<StructType>, unknown>;
    /** The Steps tab's cards: `Flowchart.templates(rows, { name, values, source })`, each giving every field but `lane` and `order`. */
    templates?: FlowchartTemplates<FlowchartValuesOf<R, L | O>>;
    /**
     * A state made with no card — the "+ STATE" ghost's — its own fields: every field but `label`, `lane` and `order`,
     * from what the gesture decided of it (`Flowchart.Types.StateWrite`, #1549). Held at build to those fields, a field
     * missing or extra refused, naming it. Omitted, each its type's default; a card's values win wherever a card is
     * dropped.
     */
    values?: (made: ExprType<typeof FlowchartStateWriteType>) => ScheduleNewValues<R>;
    /**
     * A new state's key, built from its row (#1549): what a drop, Duplicate and "+ STATE" make one under, and what a
     * state moves to as an edit changes the fields it reads — refused when another state holds it. Omitted, a String
     * key is made up, an Integer one is one past the largest, and any other the viewer types in the inspector.
     */
    key?: KindKeyBuilder<R, K>;
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
 * @typeParam K - The record's key type: any a Dict may be keyed by (#1549)
 * @param binding - The app's record of states: `Record.bind(record)`, its record declaring `patch: mutation.patch()`, to edit
 *   them — read whole, or through the slice's `states` source with `entries: Data.bindPaged(record)` — or `Data.bind(record)`,
 *   read whole, or `Data.bindPaged(record)`, read through their source, to read them only
 * @param spec - What one is called, its icon, the fields its roles are, its accessors, and its cards, `values`, form,
 *   Details and check
 * @returns The states, for the Flowchart's `states`
 * @throws {Error} Naming the role or the binding (R2, R3): a role naming a field the row lacks, or one of another type —
 *   a `lane` of a type no Dict is keyed by among them; `label` and `lane` naming one field; an accessor returning
 *   another type; cards written in the code, or giving other fields than every field but `lane` and `order`; a
 *   `values` giving other fields than every field but `label`, `lane` and `order`, or one of another type, naming it;
 *   a `key` building another type than the states' key, naming both; details keyed by another type than the states;
 *   and a record that is no binding of a record of structs, a `Record.bind` without its patch door, or `entries`
 *   beside a read-only binding
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
export function flowchartStates<R extends StructType, L extends FlowchartKeyField<R> = never, O extends FlowchartOrderField<R> = never,
    K extends EastType = StringType>(binding: FlowchartBinding<R, K>, spec: FlowchartStatesSpec<R, L, O, K>): FlowchartStates {
    const where = "Flowchart.states";
    const bound = boundOf(binding, where, "states", false);
    const rowType = bound.rowType;
    const role = roleField(rowType, where);
    const entries = entriesOf(bound, spec.entries, where, "states");
    const name = wordOf(where, "name", spec.name, "State");
    const icon = wordOf(where, "icon", spec.icon, "square");

    // The roles that are fields: the lane a field of the lanes' key, which `<Flowchart>` checks against theirs (#1549).
    const label = textField(rowType, where, "label", spec.label);
    const lane = spec.lane === undefined ? undefined : keyRole(rowType, where, "lane", spec.lane, "its lane's key");
    const laneField = lane?.field;
    const orderField = role("order", spec.order as string | undefined, FloatType, "a Float field, the state's place in its lane");
    if (laneField !== undefined && laneField === label.field) {
        throw new Error(`${where}: \`label\` and \`lane\` both name "${laneField}" — a state's name and its lane are two fields`);
    }
    // The role the app computes.
    const membersOf = accessorRole(bound.keyType, rowType, where, "members", OptionType(IntegerType), "an Option of an Integer", spec.members);
    // Its details, read as the states are and keyed as they are (#1507, #1549).
    const details = detailsOf(spec.details, where, "states", bound.keyType);

    // The cards: every field but the lane and the order.
    const placed = [laneField, orderField].filter((field): field is string => field !== undefined);
    const ValuesType = valuesTypeOf(rowType, placed);
    const templates = checkedFlowchartTemplates(spec.templates, ValuesType, placed, where);
    // A state made with no card: its own fields, every field no role writes, from what the gesture decided of it (#1549).
    const roles = [label.field, ...placed];
    const valuesOf = scheduleNewValues(FlowchartStateWriteType, rowType, valuesTypeOf(rowType, roles), spec.values, where);
    // A new state's key, built from its row (#1549).
    const keyBuilt = keyBuilderOf(bound.keyType, rowType, where, "a state", spec.key);

    // A lane's key as its text, and its text read back at the lane field's type (#1549).
    const laneText = lane === undefined ? undefined : keyTextOf(lane.type);
    const laneKey = lane === undefined ? undefined : keyOfText(lane.type);

    // One state's roles, from its row and its key: its lane's key as its text.
    const rolesOf = East.function([rowType, bound.keyType], FlowchartStateRolesType, ($, row, key) => {
        const text = laneText === undefined ? undefined : $.const(laneText);
        return East.value({
            label: textOf(row, label),
            lane: text === undefined ? none : some(text(fieldOf(row, laneField!))),
            order: orderField === undefined ? none : some(fieldOf(row, orderField)),
            members: called($, membersOf, row, key, (m) => m, none),
        } as never, FlowchartStateRolesType);
    }) as unknown as RolesOf;

    // The row with a gesture's roles written over `source`, each where given, every other field as it was (R8): its
    // lane's key read back from its text — `none`, the write refused, for a text no lane's key prints as (#1549).
    const writtenOver = ($: BlockBuilder<OptionType<BlobType>>, source: ExprType<EastType>, w: ExprType<typeof FlowchartStateWriteType>) => {
        const keyOf = laneKey === undefined ? undefined : $.const(laneKey);
        const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
        $.try(($2) => {
            const set: Record<string, unknown> = {
                [label.field]: kept(w.label, source, label.field, (t) => textValue(label, t)),
                ...(keyOf === undefined ? {} : { [laneField!]: kept(w.lane, source, laneField!, (k) => keyOf(k)) }),
                ...(orderField === undefined ? {} : { [orderField]: kept(w.order, source, orderField, (o) => o as ExprType<EastType>) }),
            };
            $2.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, source, set), "v2")), OptionType(BlobType)));
        }).catch((_$2) => {});
        return result;
    };
    const write = East.function([BlobType, FlowchartStateWriteType], OptionType(BlobType), ($, bytes, w) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        return writtenOver($, row, w);
    });
    // A new state: its roles over a card's values, or over the kind's `values` of what the gesture decided, or over its
    // type's defaults.
    const source = sourceOf(rowType, FlowchartStateWriteType, ValuesType, placed, roles, valuesOf);
    const create = East.function([FlowchartStateWriteType, OptionType(BlobType)], OptionType(BlobType), ($, w, values) => {
        const start = $.const(source);
        const row = $.const(start(w, values) as ExprType<EastType>);
        return writtenOver($, row, w);
    });

    return {
        [FLOWCHART_DEF]: "states",
        rowType,
        keyType: bound.keyType,
        name,
        form: bound.form,
        lane,
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
                rows: storedRows(rows, bound.keyType, rolesOf, FlowchartStateEntryType),
                // Rows a reader read by key through the states' source — a hidden end's, Find's — made stored states (R6, R17).
                rowsOf: rowsReadOf(bound.keyType, rowType, rolesOf, FlowchartStateEntryType),
                read: readOf(bound.keyType, rowType, rolesOf, FlowchartStateRolesType),
                write,
                create,
                templates: templates?.items ?? East.value([], ArrayType(FlowchartTemplateType)),
                templatesSource: templates?.source === undefined ? none : some(templates.source),
                // The field naming a state's lane: a conflict on it named by the lane's label (#1503).
                laneField: laneField === undefined ? none : some(laneField),
                // Its details, read as the states are: whole, or by the drawn rows' keys (#1507, R19).
                details: details === undefined ? none : some(details.build("states", where, part !== undefined)),
                // A new state's key, from its row (#1549).
                rowKey: keyBuilt === undefined ? none : some(keyBuilt),
                // Its record's key type: what each key's text is printed from and read back at (#1549).
                keyType: toEastTypeValue(bound.keyType),
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
 * @typeParam K - The record's key type
 */
export interface FlowchartTransitionsSpec<R extends StructType, F extends string, T extends string, D extends string, K extends EastType = StringType>
    extends RecordSide<R, K> {
    /** What one is called; "Transition" unless given. */
    name?: string;
    /** Its Font Awesome solid icon; "arrow-right" unless given. */
    icon?: string;
    /** The field naming the state it leaves, by its key, of the type the states are keyed by: Connect writes both ends. */
    from: F;
    /** The field naming the state it enters: of `from`'s type. */
    to: T;
    /**
     * The field naming the decision that governs it, by its key: an Option of the decisions' key — or, where they are
     * keyed by String, a String, empty for none. Needs `decisions`.
     */
    decision?: D;
    /** Planned or observed: planned unless given. */
    kind?: Accessor<R, typeof FlowchartLinkKindType, K>;
    /** The label's evidence line and the stroke's weight. */
    evidence?: Accessor<R, OptionType<typeof FlowchartEvidenceType>, K>;
    /**
     * Its details (#1507): `Flowchart.details(binding, { details: [ … ] })` over the app's rows keyed as the transitions
     * are, drawn as lines under each label's evidence — figures and lists, three lines at most — and shown in full in the
     * inspector; its tags and histograms show there alone, a type error otherwise, with its words.
     */
    details?: FlowchartDetails<StructType, FlowchartTransitionDetailsSpec>;
    /** The Transitions tab's cards: `Flowchart.templates(rows, { name, values, source })`, each giving every field but `from` and `to`. */
    templates?: FlowchartTemplates<FlowchartValuesOf<R, F | T>>;
    /**
     * A transition made with no card — Connect's — its own fields: every field but `from`, `to` and `decision`, from
     * what the gesture decided of it (`Flowchart.Types.TransitionWrite`, #1549). Held at build to those fields, a field
     * missing or extra refused, naming it. Omitted, each its type's default; a card's values win wherever a card is
     * dropped.
     */
    values?: (made: ExprType<typeof FlowchartTransitionWriteType>) => ScheduleNewValues<R>;
    /**
     * A new transition's key, built from its row (#1549) — `(move) => ({ from: move.from, to: move.to })`: what Connect
     * makes one under, and what a transition moves to as an edit of its ends changes the fields it reads — refused when
     * another transition holds it. Omitted, a String key is made up and an Integer one is one past the largest; an
     * editable kind keyed by any other type needs it.
     */
    key?: KindKeyBuilder<R, K>;
    /** Hints for the inspector's form over the fields no role writes (`Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** Its own Details in the inspector, in place of its form. */
    inspector?: RowInspector<R>;
}

/** A transition's decision field, checked: an Option of a decision's key, or a String, empty for none. */
interface DecisionField extends FlowchartKeyRole {
    /** Whether the field is an Option of a key; a String field's empty text names none. */
    readonly optional: boolean;
    /** The key it holds: the Option's, or the String's. */
    readonly key: EastType;
}

/**
 * Checks a transition's `decision`: an Option of a key — the decisions',
 * which `<Flowchart>` checks (#1549) — or a String, empty for none.
 *
 * @param rowType - The kind's row type
 * @param where - The kind, as a refusal names it
 * @param name - What it was given
 * @returns The field, checked; `undefined` for none
 * @throws {Error} When it names no field of the row, or one holding neither an Option of a type a Dict may be keyed by
 *   nor a String
 */
function decisionOf(rowType: StructType, where: string, name: unknown): DecisionField | undefined {
    if (name === undefined) return undefined;
    const words = "an Option of a decision's key, or a String, empty for none";
    if (typeof name !== "string") throw new Error(`${where}: \`decision\` names the field holding the decision that governs it — ${words}`);
    const type = fieldTypeOf(rowType, where)("decision", name);
    const inner = optionOf(type);
    if (inner !== undefined && isImmutableType(inner)) return { field: name, type, optional: true, key: inner };
    if (isTypeEqual(type, StringType)) return { field: name, type, optional: false, key: StringType };
    throw new Error(`${where}: \`decision\` names ${words} — "${name}" holds ${typeText(type)}`);
}

/**
 * Declares the transitions (see the module docs, R1–R3).
 *
 * @typeParam R - The record's row type
 * @typeParam F - The `from` field
 * @typeParam T - The `to` field: of `from`'s type
 * @typeParam D - The `decision` field
 * @typeParam K - The record's key type: any a Dict may be keyed by (#1549)
 * @param binding - The app's record of transitions, bound as `Flowchart.states`' is
 * @param spec - What one is called, its icon, its ends and its decision, its accessors, and its cards, `values`, form,
 *   Details and check
 * @returns The transitions, for the Flowchart's `transitions`
 * @throws {Error} Naming the role or the binding, as `Flowchart.states` does: `from` and `to` of a type no Dict is keyed
 *   by, or of two types; a `decision` holding neither an Option of a key nor a String; `from`, `to` and `decision`
 *   naming one field; a `key` building another type than the transitions' key, naming both; and an editable record
 *   keyed by neither String nor Integer given no `key`, whose new transitions nothing would key
 */
export function flowchartTransitions<R extends StructType, F extends FlowchartKeyField<R>, T extends FieldsOf<R, R["fields"][F & keyof R["fields"]]>,
    D extends FlowchartKeyField<R, true> = never, K extends EastType = StringType>(
    binding: FlowchartBinding<R, K>, spec: FlowchartTransitionsSpec<R, F, T, D, K>,
): FlowchartTransitions {
    const where = "Flowchart.transitions";
    const bound = boundOf(binding, where, "transitions", false);
    const rowType = bound.rowType;
    const entries = entriesOf(bound, spec.entries, where, "transitions");
    const name = wordOf(where, "name", spec.name, "Transition");
    const icon = wordOf(where, "icon", spec.icon, "arrow-right");

    // The ends, each a field naming a state by its key, the two of one type — the states' key, which `<Flowchart>`
    // checks against theirs (#1549) — and the decision.
    const from = keyRole(rowType, where, "from", spec.from, "a state's key");
    const to = keyRole(rowType, where, "to", spec.to, "a state's key");
    const fromField = from.field;
    const toField = to.field;
    if (fromField === toField) throw new Error(`${where}: \`from\` and \`to\` both name "${fromField}" — a transition's ends are two fields`);
    if (!isTypeEqual(from.type, to.type)) {
        throw new Error(`${where}: \`from\` and \`to\` each hold a state's key, of one type — "${fromField}" holds ${typeText(from.type)}, ` +
            `and "${toField}" ${typeText(to.type)}`);
    }
    const decision = decisionOf(rowType, where, spec.decision);
    if (decision !== undefined && (decision.field === fromField || decision.field === toField)) {
        throw new Error(`${where}: \`decision\` and \`${decision.field === fromField ? "from" : "to"}\` both name "${decision.field}" — a transition's decision and its ends are three fields`);
    }
    // The roles the app computes.
    const kindOf = accessorRole(bound.keyType, rowType, where, "kind", FlowchartLinkKindType, "a Flowchart.Types.Kind, planned or observed", spec.kind);
    const evidenceOf = accessorRole(bound.keyType, rowType, where, "evidence", OptionType(FlowchartEvidenceType), "an Option of a Flowchart.Types.Evidence", spec.evidence);
    // Its details, read as the transitions are and keyed as they are (#1507, #1549): what its label draws, checked.
    const details = detailsOf(spec.details, where, "transitions", bound.keyType);

    // The cards: every field but the ends.
    const placed = [fromField, toField];
    const ValuesType = valuesTypeOf(rowType, placed);
    const templates = checkedFlowchartTemplates(spec.templates, ValuesType, placed, where);
    // A transition made with no card: its own fields, every field no role writes, from what the gesture decided of it (#1549).
    const roles = decision === undefined ? placed : [...placed, decision.field];
    const valuesOf = scheduleNewValues(FlowchartTransitionWriteType, rowType, valuesTypeOf(rowType, roles), spec.values, where);
    // A new transition's key, built from its row — never typed, so an editable kind keyed by another type needs it (#1549).
    const keyBuilt = keyBuilderOf(bound.keyType, rowType, where, "a transition", spec.key);
    checkMadeKeys(bound, keyBuilt, where, "transitions", "Connect makes one");

    // A state's key as its text and read back at the ends' type; a decision's at its key's (#1549).
    const endText = keyTextOf(from.type);
    const endKey = keyOfText(from.type);
    const decisionText = decision === undefined ? undefined : keyTextOf(decision.key);
    const decisionKey = decision === undefined ? undefined : keyOfText(decision.key);

    // One transition's roles, from its row and its key: the keys its ends and its decision hold as their text — a
    // decision's String field, empty, names none.
    const rolesOf = East.function([rowType, bound.keyType], FlowchartTransitionRolesType, ($, row, key) => {
        const end = $.const(endText);
        let named: unknown = none;
        if (decision !== undefined) {
            const held = $.const(fieldOf(row, decision.field));
            if (decision.optional) {
                const text = $.const(decisionText!);
                named = (held as unknown as ExprType<OptionType<EastType>>).match({
                    none: (_$2) => East.value(none, OptionType(StringType)),
                    some: (_$2, k) => East.value(some(text(k)), OptionType(StringType)),
                });
            } else {
                named = East.equal(held as ExprType<StringType>, "").ifElse(
                    (_$2) => East.value(none, OptionType(StringType)),
                    (_$2) => East.value(some(held as ExprType<StringType>), OptionType(StringType)),
                );
            }
        }
        return East.value({
            from: end(fieldOf(row, fromField)),
            to: end(fieldOf(row, toField)),
            decision: named,
            kind: called($, kindOf, row, key, (k) => k, East.value(variant("planned", null), FlowchartLinkKindType)),
            evidence: called($, evidenceOf, row, key, (e) => e, none),
        } as never, FlowchartTransitionRolesType);
    }) as unknown as RolesOf;

    // The row with a gesture's ends and decision written over `source`, each where given (R8): each key read back from
    // its text — `none`, the write refused, for a text no key prints as (#1549) — and a decision cleared an empty String
    // field, or an Option field holding none.
    const writtenOver = ($: BlockBuilder<OptionType<BlobType>>, source: ExprType<EastType>, w: ExprType<typeof FlowchartTransitionWriteType>) => {
        const end = $.const(endKey);
        const keyOf = decisionKey === undefined ? undefined : $.const(decisionKey);
        const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
        $.try(($2) => {
            const set: Record<string, unknown> = {
                [fromField]: kept(w.from, source, fromField, (k) => end(k)),
                [toField]: kept(w.to, source, toField, (k) => end(k)),
                ...(decision === undefined ? {} : {
                    [decision.field]: kept(w.decision, source, decision.field, (d) => (decision.optional
                        ? d.match({
                            none: (_$3) => East.value(none, OptionType(decision.key)),
                            some: (_$3, k) => East.value(some(keyOf!(k)), OptionType(decision.key)),
                        })
                        : d.match({ none: (_$3) => East.value("", StringType), some: (_$3, k) => k })) as unknown as ExprType<EastType>),
                }),
            };
            $2.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, source, set), "v2")), OptionType(BlobType)));
        }).catch((_$2) => {});
        return result;
    };
    const write = East.function([BlobType, FlowchartTransitionWriteType], OptionType(BlobType), ($, bytes, w) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        return writtenOver($, row, w);
    });
    // A new transition — Connect — its ends over a card's values, or over the kind's `values` of what the gesture
    // decided, or over its type's defaults.
    const source = sourceOf(rowType, FlowchartTransitionWriteType, ValuesType, placed, roles, valuesOf);
    const create = East.function([FlowchartTransitionWriteType, OptionType(BlobType)], OptionType(BlobType), ($, w, values) => {
        const start = $.const(source);
        const row = $.const(start(w, values) as ExprType<EastType>);
        return writtenOver($, row, w);
    });

    return {
        [FLOWCHART_DEF]: "transitions",
        rowType,
        keyType: bound.keyType,
        name,
        form: bound.form,
        ends: { from: fromField, to: toField, type: from.type },
        decision: decision === undefined ? undefined : { field: decision.field, type: decision.type },
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
                rows: storedRows(rows, bound.keyType, rolesOf, FlowchartTransitionEntryType),
                read: readOf(bound.keyType, rowType, rolesOf, FlowchartTransitionRolesType),
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
                // A new transition's key, from its row (#1549).
                rowKey: keyBuilt === undefined ? none : some(keyBuilt),
                // Its record's key type (#1549).
                keyType: toEastTypeValue(bound.keyType),
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
 * @typeParam K - The record's key type
 */
export interface FlowchartLanesSpec<R extends StructType, O extends string, K extends EastType = StringType> {
    /** What one is called; "Lane" unless given. */
    name?: string;
    /** The field its header is: a String, or an Option of one. + LANE and a rename write it. */
    label: FlowchartTextField<R>;
    /** The Integer or Float field placing it among the lanes: + LANE writes one past the last. Without it, the lanes stand by key. */
    order?: O;
    /** The Lanes tab's cards: `Flowchart.templates(rows, { name, values, source })`, each giving every field but `order`. */
    templates?: FlowchartTemplates<FlowchartValuesOf<R, O>>;
    /**
     * A lane made with no card — + LANE's — its own fields: every field but `label` and `order`, from what the gesture
     * decided of it (`Flowchart.Types.LaneWrite`, #1549). Held at build to those fields, a field missing or extra
     * refused, naming it. Omitted, each its type's default; a card's values win wherever a card is dropped.
     */
    values?: (made: ExprType<typeof FlowchartLaneWriteType>) => ScheduleNewValues<R>;
    /**
     * A new lane's key, built from its row (#1549): what + LANE and a card dropped on the band row make one under, and
     * what a lane moves to as an edit changes the fields it reads — refused when another lane holds it. Omitted, a String
     * key is made up, an Integer one is one past the largest, and any other the viewer types in the inspector.
     */
    key?: KindKeyBuilder<R, K>;
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
 * @typeParam K - The record's key type: any a Dict may be keyed by (#1549)
 * @param binding - The app's record of lanes: `Record.bind(record)`, its record declaring `patch: mutation.patch()`, to edit
 *   them, or `Data.bind(record)` to read them — each read whole
 * @param spec - What one is called, the fields its header and its order are, and its cards, `values`, `key`, form and
 *   Details
 * @returns The lanes, for the Flowchart's `lanes`
 * @throws {Error} Naming the role or the binding, as `Flowchart.states` does: a paged read, and `entries`, among them —
 *   the lanes are read whole — a `values` giving other fields than every field but `label` and `order`, or one of
 *   another type, naming it, and a `key` building another type than the lanes' key, naming both
 */
export function flowchartLanes<R extends StructType, O extends FlowchartOrderField<R, IntegerType | FloatType> = never, K extends EastType = StringType>(
    binding: FlowchartWholeBinding<R, K>, spec: FlowchartLanesSpec<R, O, K>,
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
    // A lane made with no card: its own fields, every field no role writes, from what the gesture decided of it (#1549).
    const roles = [label.field, ...placed];
    const valuesOf = scheduleNewValues(FlowchartLaneWriteType, rowType, valuesTypeOf(rowType, roles), spec.values, where);
    // A new lane's key, built from its row (#1549).
    const keyBuilt = keyBuilderOf(bound.keyType, rowType, where, "a lane", spec.key);

    // One lane's roles, from its row and its key: an Integer order read as a Float.
    const rolesOf = East.function([rowType, bound.keyType], FlowchartLaneRolesType, ($, row, _key) => {
        let order: unknown = none;
        if (orderField !== undefined) {
            const held = $.const(fieldOf(row, orderField));
            order = some(integer ? (held as unknown as ExprType<IntegerType>).toFloat() : held);
        }
        return East.value({ label: textOf(row, label), order } as never, FlowchartLaneRolesType);
    }) as unknown as RolesOf;

    // The row with a gesture's label and order written over its source, each where given (R8); `none` for an order an
    // Integer field can't hold, between two whole numbers — the renderer moves the lanes after it on. The source is read
    // once the order fits, so a new lane refused for its order never asks the kind's `values` (#1549).
    const laned = ($: BlockBuilder<OptionType<BlobType>>, w: ExprType<typeof FlowchartLaneWriteType>,
        sourceIn: ($2: { const: (value: unknown) => unknown }) => unknown) => {
        const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
        const fits = orderField === undefined || !integer ? East.value(true)
            : w.order.match({ none: (_$2) => East.value(true), some: (_$2, o) => East.equal(o.remainder(1.0).abs(), 0.0) });
        $.if(fits, ($2) => {
            const source = sourceIn($2);
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
    const write = East.function([BlobType, FlowchartLaneWriteType], OptionType(BlobType), ($, bytes, w) => laned($, w, ($2) => {
        const row = $2.const(bytes.decodeBeast(rowType, "v2"));
        return row;
    }));
    // A new lane — + LANE, or a card dropped between two lanes — over a card's values, or over the kind's `values` of what
    // the gesture decided, or over its type's defaults.
    const source = sourceOf(rowType, FlowchartLaneWriteType, ValuesType, placed, roles, valuesOf);
    const create = East.function([FlowchartLaneWriteType, OptionType(BlobType)], OptionType(BlobType), ($, w, values) => laned($, w, ($2) => {
        const start = $2.const(source) as (made: unknown, card: unknown) => ExprType<EastType>;
        const row = $2.const(start(w, values));
        return row;
    }));

    return {
        [FLOWCHART_DEF]: "lanes",
        rowType,
        keyType: bound.keyType,
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
                rows: storedRows(kindWholeRows(bound.handle, bound.keyType, rowType), bound.keyType, rolesOf, FlowchartLaneEntryType),
                read: readOf(bound.keyType, rowType, rolesOf, FlowchartLaneRolesType),
                write,
                create,
                templates: templates?.items ?? East.value([], ArrayType(FlowchartTemplateType)),
                templatesSource: templates?.source === undefined ? none : some(templates.source),
                // A new lane's key, from its row (#1549).
                rowKey: keyBuilt === undefined ? none : some(keyBuilt),
                // Its record's key type (#1549).
                keyType: toEastTypeValue(bound.keyType),
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
 * @typeParam K - The record's key type
 */
export interface FlowchartDecisionsSpec<R extends StructType, K extends EastType = StringType> {
    /** What one is called; "Decision" unless given. */
    name?: string;
    /** Its name. */
    label: Accessor<R, StringType, K>;
    /** The diamond's letter: the label's first unless given. */
    letter?: Accessor<R, OptionType<StringType>, K>;
    /** Who owns it. */
    owner?: Accessor<R, OptionType<StringType>, K>;
    /** Its outcomes' summary line. */
    outcomes?: Accessor<R, OptionType<StringType>, K>;
    /** The Array or Set field naming the states queued at it, by key — of the type the states are keyed by: a state's Del takes its key out. */
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
 * @typeParam K - The record's key type: any a Dict may be keyed by (#1549)
 * @param binding - The app's record of decisions, bound as `Flowchart.lanes`' is
 * @param spec - What one is called, its accessors, its queue, and its form and Details
 * @returns The decisions, for the Flowchart's `decisions`
 * @throws {Error} Naming the role or the binding, as `Flowchart.lanes` does: a `label` that is no accessor, and a `queue`
 *   holding neither an Array nor a Set of a type a Dict may be keyed by
 */
export function flowchartDecisions<R extends StructType, K extends EastType = StringType>(
    binding: FlowchartWholeBinding<R, K>, spec: FlowchartDecisionsSpec<R, K>,
): FlowchartDecisions {
    const where = "Flowchart.decisions";
    const bound = boundOf(binding, where, "decisions", true);
    const rowType = bound.rowType;
    if ((spec as { entries?: unknown }).entries !== undefined) throw new Error(`${where}: the decisions are read whole — leave entries out`);
    const name = wordOf(where, "name", spec.name, "Decision");
    if (typeof spec.label !== "function") throw new Error(`${where}: \`label\` is an accessor giving a decision's name, (row, key) => …`);
    const labelOf = accessorRole(bound.keyType, rowType, where, "label", StringType, "a String", spec.label)!;
    const letterOf = accessorRole(bound.keyType, rowType, where, "letter", OptionType(StringType), "an Option of a String", spec.letter);
    const ownerOf = accessorRole(bound.keyType, rowType, where, "owner", OptionType(StringType), "an Option of a String", spec.owner);
    const outcomesOf = accessorRole(bound.keyType, rowType, where, "outcomes", OptionType(StringType), "an Option of a String", spec.outcomes);
    // The queue: an Array or a Set of the states' keys, which `<Flowchart>` checks against theirs (#1549).
    let queue: { readonly field: string; readonly set: boolean; readonly key: EastType } | undefined;
    if (spec.queue !== undefined) {
        if (typeof spec.queue !== "string") throw new Error(`${where}: \`queue\` names the Array or Set field holding the states queued at it, by key`);
        const type = fieldTypeOf(rowType, where)("queue", spec.queue);
        const key = type.type === "Set" ? type.key as EastType : type.type === "Array" ? type.value as EastType : undefined;
        if (key === undefined || !isImmutableType(key)) {
            throw new Error(`${where}: \`queue\` names an Array or a Set field, the states queued at it by key — "${spec.queue}" holds ${typeText(type)}`);
        }
        queue = { field: spec.queue, set: type.type === "Set", key };
    }
    // A queued state's key as its text, and its text read back at the queue's key type (#1549).
    const queueText = queue === undefined ? undefined : keyTextOf(queue.key);
    const queueKey = queue === undefined ? undefined : keyOfText(queue.key);

    // One decision's roles, from its row and its key: its queue's keys as their text, a Set's in its order.
    const rolesOf = East.function([rowType, bound.keyType], FlowchartDecisionRolesType, ($, row, key) => {
        let queued: unknown = East.value([], ArrayType(StringType));
        if (queue !== undefined) {
            const text = $.const(queueText!);
            const held = $.const(fieldOf(row, queue.field));
            queued = queue.set
                ? (held as unknown as ExprType<SetType<EastType>>).toArray((_$2, k) => text(k))
                : (held as unknown as ExprType<ArrayType<EastType>>).map((_$2, k) => text(k));
        }
        return East.value({
            label: called($, labelOf, row, key, (l) => l, ""),
            letter: called($, letterOf, row, key, (l) => l, none),
            owner: called($, ownerOf, row, key, (o) => o, none),
            outcomes: called($, outcomesOf, row, key, (o) => o, none),
            queue: queued,
        } as never, FlowchartDecisionRolesType);
    }) as unknown as RolesOf;

    // A state's key, read back from its text at the queue's key type, taken out of the queue — a state's Del (R10): the
    // row, or `none` where the key is not queued, or its text is no key's (#1549).
    const unqueue = queue === undefined ? undefined : East.function([BlobType, StringType], OptionType(BlobType), ($, bytes, id) => {
        const parse = $.const(queueKey!);
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
        $.try(($2) => {
            const key = $2.const(parse(id));
            if (queue.set) {
                const held = $2.let(fieldOf(row, queue.field) as unknown as ExprType<SetType<EastType>>);
                $2.if(held.tryDelete(key as never), ($3) => {
                    $3.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, row, { [queue.field]: held }), "v2")), OptionType(BlobType)));
                });
            } else {
                const held = $2.const(fieldOf(row, queue.field) as unknown as ExprType<ArrayType<EastType>>);
                const left = $2.const(held.filter((_$3, k) => East.equal(k as never, key as never).not()));
                $2.if(left.size().equal(held.size()).not(), ($3) => {
                    $3.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, row, { [queue.field]: left }), "v2")), OptionType(BlobType)));
                });
            }
        }).catch((_$2) => {});
        return result;
    });

    return {
        [FLOWCHART_DEF]: "decisions",
        rowType,
        keyType: bound.keyType,
        name,
        form: bound.form,
        queue: queue === undefined ? undefined : { field: queue.field, type: queue.key },
        hasTemplates: false,
        templatesSource: undefined,
        build(_part, _every) {
            const side = recordSide(bound, undefined, undefined, spec as RecordSide<StructType>, [queue?.field], where);
            return East.value({
                ...side,
                name,
                icon: "diamond",
                rows: storedRows(kindWholeRows(bound.handle, bound.keyType, rowType), bound.keyType, rolesOf, FlowchartDecisionEntryType),
                read: readOf(bound.keyType, rowType, rolesOf, FlowchartDecisionRolesType),
                unqueue: unqueue === undefined ? none : some(unqueue),
                // Its record's key type (#1549).
                keyType: toEastTypeValue(bound.keyType),
            } as never, FlowchartDecisionKindType) as ExprType<typeof FlowchartDecisionKindType>;
        },
    };
}
