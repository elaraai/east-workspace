/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's kinds (#1386, #1401, `Schematic Builder Spec.md` §1, §4.1–§4.5):
 * `Schematic.items`, `zones`, `links`, `nets` and `details`. Each takes the
 * app's own record and maps its fields to the Schematic's roles, as Schedule's
 * kinds do (#1365): the Schematic stores nothing in a shape of its own.
 *
 * - **A role is a field of the app's row, named** (SC1). Its type is checked
 *   against the role when the code compiles, and again at build: a field the
 *   row lacks, or one of another type, is refused, naming the role, the field
 *   and the field's type. A role the app computes — a sub-label, a meter, a
 *   tone — is an accessor `(row, key) => …`, reified once and called per row.
 *   So is a role whose value is one of the Schematic's own types — a
 *   footprint, a zone's shape, a pattern, a style: the accessor builds it with
 *   the shape helpers from the row's own fields, so the app's record holds
 *   only its own types (D35).
 * - **A gesture writes only the fields its roles map** (SC2): a move writes
 *   an item's `x` and `y`, a Connect a link's `from` and `to`, a net's Shift
 *   session its `sources` and `destinations`, and every other field of the row
 *   reads back as it was.
 * - **A new row's other fields** are a template's values; a link or a net
 *   drawn with no template of its kind selected takes its kind's `values` of
 *   its ends or its sides (#1526), held at build to every field but those, or
 *   each field's default without them.
 * - **Geometry is drawn about its entity's anchor** (D22, SC35): a footprint
 *   needs the item's box, `width` and `height`, or it is refused.
 * - **How a kind is bound follows how it is read** (§1, rule 4; SC33):
 *   editable bound `Record.bind(record), its record declaring patch: mutation.patch()` — read
 *   whole, or through its source of the slice with `entries:
 *   Data.bindPaged(record)` beside it — and read only bound `Data.bind(record)`,
 *   read whole, or `Data.bindPaged(record)`, read through its source. Every
 *   other form is refused, naming the one to use. A kind's details are bound
 *   as their kind is read.
 *
 * A kind closes the record behind East functions over beast2 bytes (§4.8): its
 * stored rows a read holds, each one's roles beside its bytes; a drafted row's
 * roles; a gesture's write and a new row; the fields an author's card sets,
 * any field at any depth (#1390); the shared editing session over the
 * record with its patch door; the record read by key; its history, its form,
 * its own inspector and the app's check. So the payload is one type whatever
 * the rows hold, and the renderer needs no row type.
 *
 * A kind's record may be keyed by any type a Dict takes (#1549), and a role
 * naming an item holds the key of the item slot it names: a link's end a
 * field of that slot's key type — or a variant whose cases each hold the key
 * of the slot they name — and a net's side a Set or an Array of it. Each is
 * checked when the code compiles to be of a type a Dict may be keyed by, and
 * `<Schematic>` checks each against its slot's key type. On the wire a key is
 * its text, a String key as itself and any other as East prints it: a
 * reference holds it so, and a write reads it back at the field's type,
 * refusing a text no key prints as.
 *
 * @packageDocumentation
 */

import {
    ArrayType, AsyncFunctionType, BlobType, DictType, East, Expr, FloatType, OptionType, PatchType, SetType, StringType, StructType,
    defaultValue, isImmutableType, isTypeEqual, none, printType, some, toEastTypeValue, variant,
    type EastType, type ExprType, type FunctionType, type ImmutableType, type SubtypeExprOrValue, type VariantType,
} from "@elaraai/east";
import { resolveRowSource, type FieldHints } from "@elaraai/east-ui/internal";
import { RecordOutcomeType } from "../bind/record.js";
import type { ScheduleStatusCasesOf, ScheduleStatusField } from "../schedule/events.js";
import { checkKeyField, fieldOf, keyFieldRef, keyFieldSlots, keyFieldValue, type FieldName, type FieldsOf, type KeyField } from "../schedule/fields.js";
import { scheduleNewValues, type ScheduleNewValues } from "../schedule/values.js";
import { checkEntries, optionOf, typeText } from "../schedule/window.js";
import {
    accessorRole, called, fieldTypeOf, kindSourceRows, kindWholeRows, readOf, recordSide, roleField, rowWith, rowsReadOf, storedRows, valuesTypeOf,
    type KindAccessor as Accessor, type KindBinding, type KindRowInspector as RowInspector, type RecordSide,
} from "../utils/record-kind.js";
import { checkedSchematicTemplates, isSchematicTemplates, type SchematicTemplates } from "./templates.js";
import {
    SchematicDetailsEntryType, SchematicDetailsRolesType, SchematicKindDetailsType, SchematicEndsType, SchematicGeometryType, SchematicItemEntryType,
    SchematicItemKindType, SchematicItemType, SchematicLinkEntryType, SchematicLinkKindType, SchematicLinkStyleType, SchematicLinkType,
    SchematicMeterType, SchematicNetEntryType, SchematicNetKindType, SchematicNetType, SchematicPointType, SchematicRefType, SchematicRouteType,
    SchematicSidesType, SchematicStatusCasesFor, SchematicStatusType, SchematicTemplateType, SchematicToneType, SchematicZoneEntryType,
    SchematicZoneKindType, SchematicZonePatternType, SchematicZoneType,
} from "./types.js";
import type { SchematicKindPart } from "./window.js";

// ============================================================================
// The row's fields, by type
// ============================================================================

/** A String field of the row: a label, a layer. */
export type SchematicStringField<R extends StructType> = FieldsOf<R, StringType>;

/** A Float field of the row: a box's side, a zone's corner. */
export type SchematicFloatField<R extends StructType> = FieldsOf<R, FloatType>;

/** A Float field, or an Option of one: an item's `x` and `y`, whose Options give its kind a backlog. */
export type SchematicPlaceField<R extends StructType> = FieldsOf<R, FloatType | OptionType<FloatType>>;

/** An `Array` of `{ x, y }` Floats field (`Schematic.Types.Point`): a link's or a net's waypoints, the app's own points. */
export type SchematicViaField<R extends StructType> = FieldsOf<R, ArrayType<SchematicPointType>>;

/**
 * A Set or an Array field of items' keys: a net's side — each of the type its item slot is keyed by, which
 * `<Schematic>` checks (#1549).
 */
export type SchematicMembersField<R extends StructType> = FieldsOf<R, SetType<ImmutableType> | ArrayType<ImmutableType>>;

/** Whether a variant's cases are an Option's. */
type IsOption<C> = "none" extends keyof C ? ("some" extends keyof C ? true : false) : false;

/**
 * A field naming a link's end (#1549): a field of a type a Dict may be keyed
 * by, holding a key of one item slot, or a variant holding a key of the item
 * slot its case names — never an Option: a link has both its ends.
 */
export type SchematicEndField<R extends StructType> = {
    [F in FieldName<R>]: R["fields"][F] extends VariantType<infer C> ? (IsOption<C> extends true ? never : F)
        : R["fields"][F] extends ImmutableType ? F : never
}[FieldName<R>];

/**
 * What a link's end's `of` takes (#1549): the item slot its field holds keys of — or, for a variant field, a slot per
 * case, each case holding a key of the slot it names. It decides the end's shape: a variant field naming one slot holds
 * that slot's keys whole.
 */
export type SchematicEndOf<T> = T extends VariantType<infer C> ? string | { readonly [K in keyof C]: string } : string;

/** The status a variant field shows: the field, and a Status per case. */
export interface SchematicStatusConfig<R extends StructType, SF extends string> {
    /** The status field: a variant, not an Option. */
    field: SF;
    /** One Status per case: its words, its tone and whether it is an open ring. */
    cases: SubtypeExprOrValue<ScheduleStatusCasesOf<R["fields"][SF]>>;
}

/** A template's values: the row's fields less those a drop places. */
export type SchematicValuesOf<R extends StructType, Placed extends string> = StructType<{ [F in Exclude<FieldName<R>, Placed>]: R["fields"][F] }>;

// ============================================================================
// How a kind's record is bound (§1, rule 4)
// ============================================================================

/**
 * What a kind's record is, bound (§1, rule 4): `Record.bind`'s or
 * `Data.bind`'s handle, read whole, or `Data.bindPaged`'s, read by key — each
 * over a `Dict<K, R>`, its row type `R` and its key type `K` — any type a Dict
 * may be keyed by (#1549) — inferred from the handle.
 *
 * @typeParam R - The record's row type
 * @typeParam K - The record's key type
 */
export type SchematicRecord<R extends StructType, K extends EastType = StringType> =
    | { readonly read: (...args: never[]) => ExprType<DictType<K, R>>; readonly binding: unknown }
    | { readonly page: (...args: never[]) => ExprType<OptionType<DictType<K, R>>>; readonly revision: unknown };

/** The binding forms, as the refusals name them. */
const FORMS = "Record.bind(record), its record declaring patch: mutation.patch() to edit it, or Data.bind(record) or Data.bindPaged(record) to read it only";

/**
 * Tells a kind's binding by its handle's East struct (`bind/sources.ts`'
 * rule): a `page` field is `Data.bindPaged`'s, a `mutate` field
 * `Record.bind`'s — checked for its patch door — and any other `Data.bind`'s.
 *
 * @param record - What the kind was given
 * @param where - The kind, as a refusal names it
 * @returns The binding
 * @throws {Error} Naming the forms to use: anything but a binding of a record of structs, a paged read of an index's
 *   window or one naming no snapshot, and a `Record.bind` without its patch door
 */
function boundOf(record: unknown, where: string): KindBinding {
    const refuse = (why: string): never => { throw new Error(`${where}: \`record\` is the app's record, bound — ${FORMS}${why}`); };
    if (!(record instanceof Expr)) return refuse("");
    const type = Expr.type(record) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : undefined;
    if (fields === undefined) return refuse(` — and this is ${printType(type)}`);
    let form: KindBinding["form"];
    let recordType: EastType | undefined;
    if (fields["page"] !== undefined) {
        form = "paged";
        if (fields["indexes"] !== undefined) {
            return refuse(" — and this paged read serves the record's indexes: bind its own entries, Data.bindPaged(record), and name the indexed read " +
                "as the kind's source of the slice");
        }
        const resolved = resolveRowSource(record, where);
        if (resolved.kind !== "paged") {
            return refuse(" — and this paged read serves an index's window: bind the record's own entries, Data.bindPaged(record)");
        }
        recordType = resolved.collectionType;
    } else {
        form = fields["mutate"] !== undefined ? "record" : "data";
        const read = fields["read"];
        if (read === undefined || read.type !== "Function" || read.inputs.length !== 0 || fields["binding"] === undefined) return refuse("");
        recordType = read.output as EastType;
    }
    if (recordType.type !== "Dict" || (recordType.value as EastType).type !== "Struct") {
        throw new Error(`${where}: a Schematic kind's record holds its entities by key, each a struct — and this one holds ${typeText(recordType)}`);
    }
    const rowType = recordType.value as StructType;
    if (form === "paged") {
        // A paged read of the record's own entries, at the snapshot every read of it is at, keyed as the record is.
        checkEntries(record, recordType.key as EastType, rowType, `${where}: \`record\``);
    }
    if (form === "record") {
        // The patch door: the record's mutation.patch(), the mutation named `patch` taking the record's patch.
        const commit = fields["commit"];
        const door = commit?.type === "Struct" ? (commit.fields as Record<string, EastType>)["patch"] : undefined;
        if (door === undefined || !isTypeEqual(door, AsyncFunctionType([StringType, PatchType(recordType)], RecordOutcomeType))) {
            throw new Error(`${where}: \`record\` is bound without its patch door — ${FORMS}`);
        }
    }
    return { form, handle: record as ExprType<EastType>, keyType: recordType.key as EastType, rowType };
}

/**
 * A kind's reads, as its binding and its source of the slice decide them
 * (SC33): whole, or through its source; and the record read by key.
 *
 * @param bound - The kind's binding
 * @param entries - Its `entries`, checked
 * @param slot - Its slot
 * @param part - Its source of the slice, when the slice names one after its slot
 * @param where - The kind, as a refusal names it
 * @param every - Whether, read through its source, it reads every row: under `narrowed="dim"` (§10.3)
 * @returns `()` → its rows, by key, and the paged read its rows are read by key through, if any
 * @throws {Error} Naming the form to use, for each binding its read does not take
 */
function readsOf(bound: KindBinding, entries: ExprType<EastType> | undefined, slot: string, part: SchematicKindPart | undefined, where: string, every: boolean) {
    if (part === undefined) {
        if (bound.form === "paged") {
            throw new Error(`${where}: a paged binding has no whole read — read it through its source of the slice, slot "${slot}": ` +
                `slice={{ slice: Slice.bindRecords(key, { ${slot}: { source: Data.bindPaged(record, { indexes }) } }) }} — or bind Data.bind(record) to read it whole`);
        }
        if (entries !== undefined) {
            throw new Error(`${where}: \`entries\` reads the record by key beside its source of the slice — name one "${slot}", ` +
                `or leave \`entries\` out: a kind read whole reads its rows from the record`);
        }
        return { rows: kindWholeRows(bound.handle, bound.keyType, bound.rowType), byKey: undefined };
    }
    if (bound.form === "data") {
        throw new Error(`${where}: Data.bind(record) reads the record whole, which a source of the slice exists to avoid — ` +
            `bind it Data.bindPaged(record) to read it through its source "${slot}", or Record.bind(record), its record declaring patch: mutation.patch() with entries to edit it`);
    }
    if (bound.form === "record" && entries === undefined) {
        throw new Error(`${where}: the slice's source "${slot}" reads only its narrowing — and a row is read by its key, the inspector's, a gesture's ` +
            "original and Save's confirmation: give `entries: Data.bindPaged(record)` beside it, the record's own entries");
    }
    return { rows: kindSourceRows(part, slot, bound.keyType, bound.rowType, where, every, "name it after this kind's slot, over the kind's own record"), byKey: bound.form === "paged" ? bound.handle : entries };
}

/**
 * Checks a kind's `entries` where it declares them: for a record bound to be
 * edited, a paged read of its own entries.
 *
 * @param bound - The kind's binding
 * @param entries - What the kind was given
 * @param where - The kind, as a refusal names it
 * @returns The paged read, checked; `undefined` for none
 * @throws {Error} When a read-only binding is given `entries`, or they are no paged read of the record's own entries
 */
function entriesOf(bound: KindBinding, entries: unknown, where: string): ExprType<EastType> | undefined {
    if (entries === undefined) return undefined;
    if (bound.form !== "record") {
        throw new Error(`${where}: \`entries\` reads an editable record by key — a kind bound ${bound.form === "data" ? "Data.bind" : "Data.bindPaged"} ` +
            `${bound.form === "data" ? "is read whole" : "reads by key through its own binding"}: leave \`entries\` out`);
    }
    return checkEntries(entries, bound.keyType, bound.rowType, `${where}: \`entries\``);
}

// ============================================================================
// Shared parts
// ============================================================================

/** The status a variant field shows, checked: its cases and their table. */
interface Status {
    readonly field: string;
    readonly cases: readonly string[];
    readonly table: ExprType<EastType>;
}

/** Checks a `status` role: a variant field every row holds, a Status per case. */
function statusOf(rowType: StructType, where: string, config: { field: string; cases: unknown } | undefined): Status | undefined {
    if (config === undefined) return undefined;
    const type = fieldTypeOf(rowType, where)("status.field", config.field);
    if (type.type !== "Variant" || optionOf(type) !== undefined) {
        throw new Error(`${where}: \`status.field\` names a variant field every row holds, a Status per case — "${config.field}" holds ${typeText(type)}`);
    }
    return {
        field: config.field,
        cases: Object.keys(type.cases as Record<string, EastType>),
        table: East.value(config.cases as SubtypeExprOrValue<EastType>, SchematicStatusCasesFor(type as VariantType)) as ExprType<EastType>,
    };
}

/** The status a row shows, by its case: the table's Status for it, the table bound once in the block. */
function statusShown($: { const: (value: unknown) => unknown }, status: Status | undefined, row: unknown): ExprType<OptionType<typeof SchematicStatusType>> {
    if (status === undefined) return East.value(none, OptionType(SchematicStatusType)) as ExprType<OptionType<typeof SchematicStatusType>>;
    const table = $.const(status.table);
    return (fieldOf(row, status.field) as unknown as { match: (arms: object) => ExprType<EastType> }).match(Object.fromEntries(status.cases.map((c) =>
        [c, (_$: unknown) => East.value(some(fieldOf(table, c)) as never, OptionType(SchematicStatusType))]))) as unknown as ExprType<OptionType<typeof SchematicStatusType>>;
}

/**
 * A shape role, an accessor over the row's own fields (D35): refused when it
 * names a field, as the Schematic's own type would then live in the app's row.
 *
 * @param keyType - The kind's key type: the key the accessor hears
 * @param rowType - The kind's row type
 * @param where - The kind, as a refusal names it
 * @param role - `footprint` or `geometry`
 * @param fn - What the kind was given
 * @returns The accessor, reified; `undefined` when not given
 * @throws {Error} When it names a field, is no function, or returns another type, naming the accessor to write
 */
function shapeRole(keyType: EastType, rowType: StructType, where: string, role: "footprint" | "geometry", fn: unknown) {
    const example = role === "footprint" ? "footprint: (unit) => some(Schematic.circle(unit.radius))" : "geometry: (area) => some(Schematic.polygon(area.corners))";
    if (typeof fn === "string") {
        throw new Error(`${where}: \`${role}\` is an accessor over the row's own fields, built with Schematic.circle, polygon, polyline or rect — ` +
            `${example}: a role naming "${fn}", a field that holds Schematic.Types.Geometry, is gone, so the app's record keeps its own types`);
    }
    return accessorRole(keyType, rowType, where, role, OptionType(SchematicGeometryType),
        `an Option of a Schematic.Types.Geometry, built with Schematic.circle, polygon, polyline or rect (${example})`, fn);
}

/** The card roles a kind's details may give: refused when the kind gives them too. */
const CARD_ROLES = ["status", "meter", "metric", "sublabel"] as const;

// ============================================================================
// Schematic.details
// ============================================================================

/** The key a Schematic's declarations carry their sort under. */
export const SCHEMATIC_DEF: unique symbol = Symbol("Schematic.def");

/**
 * A kind's details (§4.5): a record of the app's keyed as its kind is, which
 * the inspector shows beside the row and the cards on screen draw.
 *
 * @typeParam R - The details record's row type
 * @typeParam SF - Its status field, when it gives one
 * @typeParam K - The details record's key type: its kind's
 */
export interface SchematicDetailsConfig<R extends StructType, SF extends string = never, K extends EastType = StringType> {
    /** A variant field shown as the card's status, a Status per case. */
    status?: SchematicStatusConfig<R, SF>;
    /** The card's bar. */
    meter?: Accessor<R, typeof SchematicMeterType, K>;
    /** The card's figure. */
    metric?: Accessor<R, OptionType<StringType>, K>;
    /** The card's second line. */
    sublabel?: Accessor<R, StringType, K>;
    /** Hints for the inspector's form over the details row (`Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** The details' own Details in the inspector, in place of their form. */
    inspector?: RowInspector<R>;
    /** A paged read of the details record's own entries, when they are editable and their kind is read through its source. */
    entries?: unknown;
}

/** A kind's details, declared: what a kind's `details` takes. */
export interface SchematicDetails {
    /** What it is. */
    readonly [SCHEMATIC_DEF]: "details";
    /** The card roles it gives: refused when its kind gives them too. */
    readonly roles: readonly string[];
    /** The details record's key type: its kind's, which the kind checks (#1549). */
    readonly keyType: EastType;
    /**
     * The details on the wire, beside their kind.
     *
     * @param kind - The kind, as a refusal names it
     * @param throughSource - Whether the kind is read through its source of the slice
     * @returns The details, closed
     * @throws {Error} When they are bound in a form their kind's read does not take (SC33), naming the form to use
     */
    build(kind: string, throughSource: boolean): ExprType<typeof SchematicKindDetailsType>;
}

/**
 * Declares a kind's details (§4.5): a record of the app's keyed as its kind
 * is — a rack's power, a cooling unit's alarm — which the inspector shows
 * beside the row and the cards on screen draw: its status, its bar, its figure
 * and its second line. A kind's row with no details row shows none, and its
 * card draws no bar.
 *
 * @typeParam R - The details record's row type
 * @typeParam SF - Its status field
 * @typeParam K - The details record's key type: its kind's, any a Dict may be keyed by (#1549)
 * @param record - The details record, keyed as its kind is and bound as its kind is read: read whole beside a kind read
 *   whole — `Data.bind(record)`, or `Record.bind(record)`; by key beside a kind read through its source —
 *   `Data.bindPaged(record)`, or `Record.bind(record)` with `entries`
 * @param config - Its card roles, its form, its own Details and its `entries`
 * @returns The details, for a kind's `details`
 * @throws {Error} Naming the role or the binding: a role naming a field the row lacks or of another type, an accessor
 *   returning another type, and a record that is no binding of a record of structs
 */
export function schematicDetails<R extends StructType, SF extends ScheduleStatusField<R> = never, K extends EastType = StringType>(
    record: SchematicRecord<R, K>, config: SchematicDetailsConfig<R, SF, K>,
): SchematicDetails {
    const where = "Schematic.details";
    const bound = boundOf(record, where);
    const rowType = bound.rowType;
    const entries = entriesOf(bound, config.entries, where);
    const status = statusOf(rowType, where, config.status as { field: string; cases: unknown } | undefined);
    const meter = accessorRole(bound.keyType, rowType, where, "meter", SchematicMeterType, "a Schematic.Types.Meter, { value, max }", config.meter);
    const metric = accessorRole(bound.keyType, rowType, where, "metric", OptionType(StringType), "an Option of a String", config.metric);
    const sublabel = accessorRole(bound.keyType, rowType, where, "sublabel", StringType, "a String", config.sublabel);
    const rolesOf = East.function([rowType, bound.keyType], SchematicDetailsRolesType, ($, row, key) => East.value({
        status: statusShown($, status, row),
        meter: called($, meter, row, key, (m) => some(m), none),
        metric: called($, metric, row, key, (m) => m, none),
        sublabel: called($, sublabel, row, key, (s) => some(s), none),
    } as never, SchematicDetailsRolesType)) as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>;
    return {
        [SCHEMATIC_DEF]: "details",
        roles: CARD_ROLES.filter((role) => (config as Record<string, unknown>)[role] !== undefined),
        keyType: bound.keyType,
        build(kind, throughSource) {
            const at = `${where} of ${kind}`;
            if (!throughSource) {
                if (bound.form === "paged") {
                    throw new Error(`${at}: beside a kind read whole, its details are read whole — bind them Data.bind(record), ` +
                        "or Record.bind(record), its record declaring patch: mutation.patch() to edit them");
                }
                if (entries !== undefined) {
                    throw new Error(`${at}: \`entries\` reads the details by key beside a kind read through its source — this kind is read whole, ` +
                        "and its details with it: leave `entries` out");
                }
            } else {
                if (bound.form === "data") {
                    throw new Error(`${at}: beside a kind read through its source, its details are read by key — bind them Data.bindPaged(record), ` +
                        "or Record.bind(record), its record declaring patch: mutation.patch() with entries: Data.bindPaged(record) to edit them");
                }
                if (bound.form === "record" && entries === undefined) {
                    throw new Error(`${at}: beside a kind read through its source, its details are read by key — give \`entries: Data.bindPaged(record)\` ` +
                        "beside Record.bind, the details record's own entries");
                }
            }
            const byKey = throughSource ? (bound.form === "paged" ? bound.handle : entries) : undefined;
            const side = recordSide(bound, entries, byKey, config, [], at);
            return East.value({
                ...side,
                rows: throughSource ? none : some(storedRows(kindWholeRows(bound.handle, bound.keyType, rowType), bound.keyType, rolesOf, SchematicDetailsEntryType)),
                rowsOf: rowsReadOf(bound.keyType, rowType, rolesOf, SchematicDetailsEntryType),
                // The paged read the details are read by key through: a reader asks a window's cards' rows of it, in one request (#1393).
                paged: byKey === undefined ? none : some(fieldOf(byKey, "id")),
                read: readOf(bound.keyType, rowType, rolesOf, SchematicDetailsRolesType),
                // The card roles they give: what a card keeps the place of while its details row is read (#1398).
                roles: { status: status !== undefined, meter: meter !== undefined, metric: metric !== undefined, sublabel: sublabel !== undefined },
            } as never, SchematicKindDetailsType) as ExprType<typeof SchematicKindDetailsType>;
        },
    };
}

/** Whether a kind's `details` is `Schematic.details`'. */
function isDetails(details: unknown): details is SchematicDetails {
    return typeof details === "object" && details !== null && SCHEMATIC_DEF in details && (details as SchematicDetails)[SCHEMATIC_DEF] === "details";
}

/**
 * Checks a kind's details: `Schematic.details`', keyed as the kind is (#1549), and no card role given in both places.
 *
 * @param details - What the kind's `details` holds
 * @param given - The card roles the kind gives itself
 * @param where - The kind, as a refusal names it
 * @param keyType - The kind's key type, which its details' record is keyed by
 * @returns The details; `undefined` for none
 * @throws {Error} When they are not `Schematic.details`', their record is keyed by another type than the kind's, naming
 *   both, or they give a card role the kind gives too
 */
function detailsOf(details: unknown, given: readonly string[], where: string, keyType: EastType): SchematicDetails | undefined {
    if (details === undefined) return undefined;
    if (!isDetails(details)) throw new Error(`${where}: \`details\` is Schematic.details(record, { status, meter, metric, sublabel }) over a record of the app's keyed as the kind is`);
    if (!isTypeEqual(details.keyType, keyType)) {
        throw new Error(`${where}: the details' record is keyed by ${typeText(details.keyType)}, and the kind's by ${typeText(keyType)} — key the details as the kind is`);
    }
    const both = details.roles.filter((role) => given.includes(role));
    if (both.length > 0) {
        throw new Error(`${where}: \`${both[0]}\` is given here and by the kind's details — a card draws one; give it in one place`);
    }
    return details;
}

/** Checks a kind's templates: a templates record's, `Schematic.templates`', never a list written in the code. */
function templatesOf(templates: unknown, where: string): SchematicTemplates<StructType> | undefined {
    if (templates === undefined) return undefined;
    if (!isSchematicTemplates(templates)) {
        throw new Error(`${where}: templates are records — Schematic.templates(templates.read(), { name, values, source }) over a record of the app's, ` +
            "its source one of the slice's");
    }
    return templates;
}

// ============================================================================
// Schematic.items
// ============================================================================

/**
 * One kind of placed item (§4.1): racks, cooling units, power distribution
 * units.
 *
 * @typeParam R - The record's row type
 * @typeParam X - The `x` field
 * @typeParam Y - The `y` field
 * @typeParam SF - The status field, when it has one
 * @typeParam K - The record's key type
 */
export interface SchematicItemsConfig<R extends StructType, X extends string, Y extends string, SF extends string = never, K extends EastType = StringType>
    extends RecordSide<R, K> {
    /** The kind's name: in the library, the inspector and the rail. */
    name: string;
    /** Its Font Awesome solid icon, and its cards' — or an accessor giving each card's. */
    icon: string | Accessor<R, StringType, K>;
    /** The Float field an item's centre's x is — or an Option of one, with `y` too, giving the kind a backlog. */
    x: X;
    /** The field its centre's y is: of `x`'s type. */
    y: Y;
    /** The String field, or an accessor, its card's name is. */
    label: SchematicStringField<R> | Accessor<R, StringType, K>;
    /** The Float field its box's width is, about its centre: its card's width, and the bounds its footprint lies in. */
    width?: SchematicFloatField<R>;
    /** The Float field its box's height is. */
    height?: SchematicFloatField<R>;
    /**
     * Its footprint, drawn about its centre: an accessor building it from the row's own fields with `Schematic.circle`,
     * `polygon`, `polyline` or `rect` — `(unit) => some(Schematic.circle(unit.radius))`. Needs `width` and `height`.
     */
    footprint?: Accessor<R, OptionType<typeof SchematicGeometryType>, K>;
    /** The String field naming the layer it is on. */
    layer?: SchematicStringField<R>;
    /** Its card's second line. */
    sublabel?: Accessor<R, StringType, K>;
    /** Its card's figure. */
    metric?: Accessor<R, OptionType<StringType>, K>;
    /** Its card's bar. */
    meter?: Accessor<R, typeof SchematicMeterType, K>;
    /** A variant field shown as its status, a Status per case. */
    status?: SchematicStatusConfig<R, SF>;
    /** An override of its status colour. */
    tone?: Accessor<R, OptionType<typeof SchematicToneType>, K>;
    /** An override of its status colour: a theme colour token (`status.warn`, `heat.3`). */
    color?: Accessor<R, OptionType<StringType>, K>;
    /** Its footprint's stroke. */
    weight?: Accessor<R, OptionType<FloatType>, K>;
    /** Its footprint's fill. */
    fillOpacity?: Accessor<R, OptionType<FloatType>, K>;
    /** Its details: a record keyed as this one is. */
    details?: SchematicDetails;
    /** Its templates: `Schematic.templates(rows, { name, values, source })`, each giving every field but `x` and `y`. */
    templates?: SchematicTemplates<SchematicValuesOf<R, X | Y>>;
    /** Hints for the inspector's form over the fields no role writes (`Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** Its own Details in the inspector, in place of its form. */
    inspector?: RowInspector<R>;
}

/** A kind, declared: what the Schematic's `items`, `zones`, `links` or `nets` take, by slot. */
interface KindDeclaration<D extends string, W extends EastType> {
    /** What it is. */
    readonly [SCHEMATIC_DEF]: D;
    /** Its record's row type. */
    readonly rowType: StructType;
    /** Its record's key type (#1549): what a link's end or a net's side naming its items is checked against. */
    readonly keyType: EastType;
    /** Its name. */
    readonly name: string;
    /** Whether it has templates. */
    readonly hasTemplates: boolean;
    /** The slice's source its templates list names; `undefined` for none, or for a list naming none, which the Schematic refuses. */
    readonly templatesSource: string | undefined;
    /**
     * The kind on the wire, under its slot.
     *
     * @param slot - The Schematic's slot name for it
     * @param part - Its source of the slice, the one named after its slot, when the slice has one
     * @param every - Whether, read through its source, it reads every row — under `narrowed="dim"`, which draws what the
     *   narrowing leaves out as context (§10.3) — rather than what its narrowing holds
     * @returns The kind, closed
     * @throws {Error} When it is bound in a form its read does not take (SC33), naming the form to use, or its own
     *   Details are of another type than its row's
     */
    build(slot: string, part?: SchematicKindPart, every?: boolean): ExprType<W>;
}

/** An item kind, declared. */
export interface SchematicItems extends KindDeclaration<"items", typeof SchematicItemKindType> {
    /** Whether its `x` and `y` are Options: its rows with no position are its backlog. */
    readonly backlog: boolean;
}

/**
 * Declares an item kind (see the module docs and §4.1).
 *
 * @typeParam R - The record's row type
 * @typeParam X - The `x` field
 * @typeParam Y - The `y` field
 * @typeParam SF - The status field, when it has one
 * @typeParam K - The record's key type: any a Dict may be keyed by (#1549)
 * @param record - The app's record of items: `Record.bind(record), its record declaring patch: mutation.patch()` to edit it, or `Data.bind(record)`
 *   or `Data.bindPaged(record)` to read it only (§1, rule 4)
 * @param config - Its name and icon, the fields its roles are, its accessors, and its details, templates, form, Details and check
 * @returns The kind, for the Schematic's `items`, by slot
 * @throws {Error} Naming the role or the binding (SC1, SC33, SC35): a role naming a field the row lacks, or one of another
 *   type; `x` and `y` of different types; an accessor returning another type; a `footprint` naming a field rather than
 *   an accessor building the shape (D35), or without `width` and `height`; a status, a meter, a metric or a second line
 *   given both here and by its details; details keyed by another type than the kind, naming both; templates written in
 *   the code, or giving other fields than every field but `x` and `y`; and a record that is no binding of a record of
 *   structs, a `Record.bind` without its patch door, or `entries` beside a read-only binding
 */
export function schematicItems<R extends StructType, X extends SchematicPlaceField<R>, Y extends SchematicPlaceField<R>, SF extends ScheduleStatusField<R> = never,
    K extends EastType = StringType>(record: SchematicRecord<R, K>, config: SchematicItemsConfig<R, X, Y, SF, K>): SchematicItems {
    const where = `Schematic.items: "${config.name}"`;
    const bound = boundOf(record, where);
    const rowType = bound.rowType;
    const typeOf = fieldTypeOf(rowType, where);
    const role = roleField(rowType, where);
    const entries = entriesOf(bound, config.entries, where);
    if (typeof config.icon !== "string" && typeof config.icon !== "function") throw new Error(`${where}: \`icon\` is a Font Awesome solid icon's name, or an accessor giving each card's`);

    // The centre: Float fields, or both Options of Float, which give the kind a backlog.
    const xType = typeOf("x", config.x);
    const yType = typeOf("y", config.y);
    const isPlace = (t: EastType) => isTypeEqual(t, FloatType) || isTypeEqual(t, OptionType(FloatType));
    for (const [prop, name, type] of [["x", config.x, xType], ["y", config.y, yType]] as const) {
        if (!isPlace(type)) throw new Error(`${where}: \`${prop}\` names a Float field, or an Option of one — "${name}" holds ${typeText(type)}`);
    }
    if (!isTypeEqual(xType, yType)) {
        throw new Error(`${where}: \`x\` and \`y\` are both Float fields, or both Options of Float — "${config.x}" holds ${typeText(xType)} and "${config.y}" ${typeText(yType)}`);
    }
    if ((config.x as string) === (config.y as string)) throw new Error(`${where}: \`x\` and \`y\` both name "${config.x}" — an item's centre is two fields`);
    const backlog = optionOf(xType) !== undefined;

    // The roles that are fields.
    const labelField = typeof config.label === "string" ? role("label", config.label, StringType, "a String field") : undefined;
    const labelOf = typeof config.label === "function" ? accessorRole(bound.keyType, rowType, where, "label", StringType, "a String", config.label) : undefined;
    if (labelField === undefined && labelOf === undefined) throw new Error(`${where}: \`label\` names a String field, or is an accessor giving a String`);
    const widthField = role("width", config.width, FloatType, "a Float field");
    const heightField = role("height", config.height, FloatType, "a Float field");
    const footprintOf = shapeRole(bound.keyType, rowType, where, "footprint", (config as { footprint?: unknown }).footprint);
    // Geometry is drawn about the item's centre, inside its box (D22, SC35): a footprint needs the box.
    if (footprintOf !== undefined && (widthField === undefined || heightField === undefined)) {
        throw new Error(`${where}: \`footprint\` is drawn about the item's centre, inside its box — give \`width\` and \`height\` with it, the box's Float fields`);
    }
    const layerField = role("layer", config.layer, StringType, "a String field");
    const status = statusOf(rowType, where, config.status as { field: string; cases: unknown } | undefined);

    // The roles the app computes.
    const iconOf = typeof config.icon === "function" ? accessorRole(bound.keyType, rowType, where, "icon", StringType, "a String, a Font Awesome solid icon's name", config.icon) : undefined;
    const sublabelOf = accessorRole(bound.keyType, rowType, where, "sublabel", StringType, "a String", config.sublabel);
    const metricOf = accessorRole(bound.keyType, rowType, where, "metric", OptionType(StringType), "an Option of a String", config.metric);
    const meterOf = accessorRole(bound.keyType, rowType, where, "meter", SchematicMeterType, "a Schematic.Types.Meter, { value, max }", config.meter);
    const toneOf = accessorRole(bound.keyType, rowType, where, "tone", OptionType(SchematicToneType), "an Option of a Schematic.Types.Tone", config.tone);
    const colorOf = accessorRole(bound.keyType, rowType, where, "color", OptionType(StringType), "an Option of a String, a theme colour token", config.color);
    const weightOf = accessorRole(bound.keyType, rowType, where, "weight", OptionType(FloatType), "an Option of a Float", config.weight);
    const fillOf = accessorRole(bound.keyType, rowType, where, "fillOpacity", OptionType(FloatType), "an Option of a Float", config.fillOpacity);
    const details = detailsOf(config.details, CARD_ROLES.filter((r) => (config as unknown as Record<string, unknown>)[r] !== undefined), where, bound.keyType);

    // The templates: every field but the centre.
    const ValuesType = valuesTypeOf(rowType, [config.x, config.y]);
    const templates = templatesOf(config.templates, where);
    const templateRows = templates === undefined ? East.value([], ArrayType(SchematicTemplateType))
        : checkedSchematicTemplates(templates, ValuesType, `\`${config.x}\` and \`${config.y}\``, where);

    // One item's roles, from its row and its key.
    const rolesOf = East.function([rowType, bound.keyType], SchematicItemType, ($, row, key) => {
        const PointOption = OptionType(SchematicPointType);
        let position: unknown;
        if (backlog) {
            const xs = fieldOf(row, config.x) as unknown as ExprType<OptionType<FloatType>>;
            const ys = fieldOf(row, config.y) as unknown as ExprType<OptionType<FloatType>>;
            position = $.let(xs.match({
                none: (_$2) => East.value(none, PointOption),
                some: (_$2, x) => ys.match({
                    none: (_$3) => East.value(none, PointOption),
                    some: (_$3, y) => East.value(some({ x, y }), PointOption),
                }),
            }), PointOption);
        } else {
            position = East.value(some({ x: fieldOf(row, config.x), y: fieldOf(row, config.y) }) as never, PointOption);
        }
        const label = labelField !== undefined ? fieldOf(row, labelField) : called($, labelOf, row, key, (l) => l, "");
        const icon = typeof config.icon === "string" ? some(config.icon) : called($, iconOf, row, key, (i) => some(i), none);
        return East.value({
            position,
            label,
            width: widthField === undefined ? none : some(fieldOf(row, widthField)),
            height: heightField === undefined ? none : some(fieldOf(row, heightField)),
            footprint: called($, footprintOf, row, key, (f) => f, none),
            layer: layerField === undefined ? none : some(fieldOf(row, layerField)),
            icon,
            sublabel: called($, sublabelOf, row, key, (s) => some(s), none),
            metric: called($, metricOf, row, key, (m) => m, none),
            meter: called($, meterOf, row, key, (m) => some(m), none),
            status: statusShown($, status, row),
            tone: called($, toneOf, row, key, (t) => t, none),
            color: called($, colorOf, row, key, (c) => c, none),
            weight: called($, weightOf, row, key, (w) => w, none),
            fillOpacity: called($, fillOf, row, key, (f) => f, none),
        } as never, SchematicItemType);
    }) as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>;

    // A row with its centre written from a position, every other field from `source`: none, a backlog kind's row
    // unplaced; `none` for no position on a kind with no backlog.
    const placed = (source: unknown, position: ExprType<OptionType<typeof SchematicPointType>>) => {
        const at = (x: unknown, y: unknown) => East.value(some(East.Blob.encodeBeast(rowWith(rowType, source, { [config.x]: x, [config.y]: y }), "v2")), OptionType(BlobType));
        if (backlog) {
            return position.match({
                none: (_$2) => at(East.value(none, OptionType(FloatType)), East.value(none, OptionType(FloatType))),
                some: (_$2, p) => at(East.value(some(p.x), OptionType(FloatType)), East.value(some(p.y), OptionType(FloatType))),
            });
        }
        return position.match({
            none: (_$2) => East.value(none, OptionType(BlobType)),
            some: (_$2, p) => at(p.x, p.y),
        });
    };
    // The row with its centre written — none, unplaced — and every other field as it was (SC2).
    const write = East.function([BlobType, OptionType(SchematicPointType)], OptionType(BlobType), ($, bytes, position) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        return placed(row, position) as never;
    });
    // A new row at a position, every other field from a template's values, or its type's default.
    const blank = East.value(defaultValue(ValuesType) as never, ValuesType) as ExprType<EastType>;
    const create = East.function([OptionType(SchematicPointType), OptionType(BlobType)], OptionType(BlobType), ($, position, values) => {
        const given = $.const(values.match({
            some: (_$2, bytes) => bytes.decodeBeast(ValuesType, "v2") as ExprType<EastType>,
            none: (_$2) => blank,
        }) as ExprType<EastType>);
        return placed(given, position) as never;
    });

    return {
        [SCHEMATIC_DEF]: "items",
        rowType,
        keyType: bound.keyType,
        name: config.name,
        backlog,
        hasTemplates: templates !== undefined,
        templatesSource: templates?.source,
        build(slot, part, every = false) {
            const { rows, byKey } = readsOf(bound, entries, slot, part, where, every);
            const side = recordSide(bound, entries, byKey, config,
                [config.x, config.y, labelField, widthField, heightField, layerField, status?.field], where);
            return East.value({
                ...side,
                key: slot,
                name: config.name,
                icon: typeof config.icon === "string" ? config.icon : "",
                details: details === undefined ? none : some(details.build(slot, part !== undefined)),
                backlog,
                status: status === undefined ? [] : status.cases.map((c) => ({ case: c, status: fieldOf(status.table, c) })),
                rows: storedRows(rows, bound.keyType, rolesOf, SchematicItemEntryType),
                rowsOf: rowsReadOf(bound.keyType, rowType, rolesOf, SchematicItemEntryType),
                // The paged read the kind's rows are read by key through: a reader asks the far ends of the links and nets
                // touching its window of it, all of a window's in one request, whether or not its source joins its rows (#1393).
                paged: byKey === undefined ? none : some(fieldOf(byKey, "id")),
                box: {
                    x: config.x, y: config.y,
                    width: widthField === undefined ? none : some(widthField), height: heightField === undefined ? none : some(heightField),
                },
                read: readOf(bound.keyType, rowType, rolesOf, SchematicItemType),
                write,
                create,
                templates: templateRows,
                templatesSource: templates?.source === undefined ? none : some(templates.source),
                // Its record's key type: what each key's text is printed from and read back at (#1549).
                keyType: toEastTypeValue(bound.keyType),
            } as never, SchematicItemKindType) as ExprType<typeof SchematicItemKindType>;
        },
    };
}

// ============================================================================
// Schematic.zones
// ============================================================================

/**
 * One kind of zone (§4.2): halls, cages, aisles — drawn under the items,
 * outlined or hatched. Zones take no gesture on the canvas: their fields are
 * edited through the inspector, when the kind is bound with its patch door.
 *
 * @typeParam R - The record's row type
 * @typeParam K - The record's key type
 */
export interface SchematicZonesConfig<R extends StructType, K extends EastType = StringType> extends RecordSide<R, K> {
    /** The kind's name. */
    name: string;
    /** Its Font Awesome solid icon. */
    icon: string;
    /** The Float field its box's left edge is. */
    x: SchematicFloatField<R>;
    /** The Float field its box's top edge is. */
    y: SchematicFloatField<R>;
    /** The Float field its box's width is. */
    width: SchematicFloatField<R>;
    /** The Float field its box's height is. */
    height: SchematicFloatField<R>;
    /** The String field, or an accessor, the eyebrow on its boundary is. */
    label: SchematicStringField<R> | Accessor<R, StringType, K>;
    /** Outline (the default) or hatch: a hatched zone is an annotation, holding no items and taking no tap. */
    pattern?: Accessor<R, typeof SchematicZonePatternType, K>;
    /**
     * Its drawn shape, about its box's centre: an accessor building it from the row's own fields with `Schematic.circle`,
     * `polygon`, `polyline` or `rect` — `(area) => some(Schematic.polygon(area.corners))`.
     */
    geometry?: Accessor<R, OptionType<typeof SchematicGeometryType>, K>;
    /** The String field naming the layer it is on. */
    layer?: SchematicStringField<R>;
    /** An override of its pattern's tone. */
    tone?: Accessor<R, OptionType<typeof SchematicToneType>, K>;
    /** An override of its pattern's tone: a theme colour token. */
    color?: Accessor<R, OptionType<StringType>, K>;
    /** Its fill. */
    fillOpacity?: Accessor<R, OptionType<FloatType>, K>;
    /** Its stroke. */
    weight?: Accessor<R, OptionType<FloatType>, K>;
    /** Its details: a record keyed as this one is. */
    details?: SchematicDetails;
    /** Hints for the inspector's form over the fields no role writes. */
    fields?: FieldHints<R["fields"]>;
    /** Its own Details in the inspector, in place of its form. */
    inspector?: RowInspector<R>;
}

/** A zone kind, declared. */
export type SchematicZones = KindDeclaration<"zones", typeof SchematicZoneKindType>;

/**
 * Declares a zone kind (§4.2).
 *
 * @typeParam R - The record's row type
 * @typeParam K - The record's key type: any a Dict may be keyed by (#1549)
 * @param record - The app's record of zones, bound as §1, rule 4 says
 * @param config - Its name and icon, the fields its box and label are, its pattern and shape, and its details, form, Details and check
 * @returns The kind, for the Schematic's `zones`, by slot
 * @throws {Error} Naming the role or the binding, as `Schematic.items` does, and a `geometry` naming a field rather than an
 *   accessor building the shape (D35)
 */
export function schematicZones<R extends StructType, K extends EastType = StringType>(record: SchematicRecord<R, K>, config: SchematicZonesConfig<R, K>): SchematicZones {
    const where = `Schematic.zones: "${config.name}"`;
    const bound = boundOf(record, where);
    const rowType = bound.rowType;
    const role = roleField(rowType, where);
    const entries = entriesOf(bound, config.entries, where);
    if (typeof config.icon !== "string") throw new Error(`${where}: \`icon\` is a Font Awesome solid icon's name`);
    if ("templates" in config) throw new Error(`${where}: zones take no templates — a zone is added through its record, and edited in the inspector`);
    const xField = role("x", config.x, FloatType, "a Float field")!;
    const yField = role("y", config.y, FloatType, "a Float field")!;
    const widthField = role("width", config.width, FloatType, "a Float field")!;
    const heightField = role("height", config.height, FloatType, "a Float field")!;
    for (const [prop, name] of [["x", xField], ["y", yField], ["width", widthField], ["height", heightField]] as const) {
        if (name === undefined) throw new Error(`${where}: \`${prop}\` names a Float field of the zone's box`);
    }
    const labelField = typeof config.label === "string" ? role("label", config.label, StringType, "a String field") : undefined;
    const labelOf = typeof config.label === "function" ? accessorRole(bound.keyType, rowType, where, "label", StringType, "a String", config.label) : undefined;
    if (labelField === undefined && labelOf === undefined) throw new Error(`${where}: \`label\` names a String field, or is an accessor giving a String`);
    const geometryOf = shapeRole(bound.keyType, rowType, where, "geometry", (config as { geometry?: unknown }).geometry);
    const layerField = role("layer", config.layer, StringType, "a String field");
    const patternOf = accessorRole(bound.keyType, rowType, where, "pattern", SchematicZonePatternType, "a Schematic.Types.ZonePattern", config.pattern);
    const toneOf = accessorRole(bound.keyType, rowType, where, "tone", OptionType(SchematicToneType), "an Option of a Schematic.Types.Tone", config.tone);
    const colorOf = accessorRole(bound.keyType, rowType, where, "color", OptionType(StringType), "an Option of a String, a theme colour token", config.color);
    const fillOf = accessorRole(bound.keyType, rowType, where, "fillOpacity", OptionType(FloatType), "an Option of a Float", config.fillOpacity);
    const weightOf = accessorRole(bound.keyType, rowType, where, "weight", OptionType(FloatType), "an Option of a Float", config.weight);
    const details = detailsOf(config.details, [], where, bound.keyType);
    const outline = East.value(variant("outline", { tone: none }), SchematicZonePatternType);

    const rolesOf = East.function([rowType, bound.keyType], SchematicZoneType, ($, row, key) => East.value({
        x: fieldOf(row, xField), y: fieldOf(row, yField), width: fieldOf(row, widthField), height: fieldOf(row, heightField),
        label: labelField !== undefined ? fieldOf(row, labelField) : called($, labelOf, row, key, (l) => l, ""),
        pattern: called($, patternOf, row, key, (p) => p, outline),
        geometry: called($, geometryOf, row, key, (g) => g, none),
        layer: layerField === undefined ? none : some(fieldOf(row, layerField)),
        tone: called($, toneOf, row, key, (t) => t, none),
        color: called($, colorOf, row, key, (c) => c, none),
        fillOpacity: called($, fillOf, row, key, (f) => f, none),
        weight: called($, weightOf, row, key, (w) => w, none),
    } as never, SchematicZoneType)) as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>;

    return {
        [SCHEMATIC_DEF]: "zones",
        rowType,
        keyType: bound.keyType,
        name: config.name,
        hasTemplates: false,
        templatesSource: undefined,
        build(slot, part, every = false) {
            const { rows, byKey } = readsOf(bound, entries, slot, part, where, every);
            const side = recordSide(bound, entries, byKey, config,
                [xField, yField, widthField, heightField, labelField, layerField], where);
            return East.value({
                ...side,
                key: slot,
                name: config.name,
                icon: config.icon,
                details: details === undefined ? none : some(details.build(slot, part !== undefined)),
                rows: storedRows(rows, bound.keyType, rolesOf, SchematicZoneEntryType),
                rowsOf: rowsReadOf(bound.keyType, rowType, rolesOf, SchematicZoneEntryType),
                box: { x: xField, y: yField, width: some(widthField), height: some(heightField) },
                read: readOf(bound.keyType, rowType, rolesOf, SchematicZoneType),
                // Its record's key type (#1549).
                keyType: toEastTypeValue(bound.keyType),
            } as never, SchematicZoneKindType) as ExprType<typeof SchematicZoneKindType>;
        },
    };
}

// ============================================================================
// Schematic.links
// ============================================================================

/**
 * A role naming items by their keys (#1549): a link's end, or a net's side —
 * its field, and for each item slot it holds keys of, the key it holds, which
 * `<Schematic>` checks against that slot's key type.
 */
export interface SchematicKeyRole {
    /** The field. */
    readonly field: string;
    /**
     * Each item slot it holds keys of, in order: the slot, the key's type — the field's own, a case's, or a side's
     * element — and the case holding it, for an end with a slot per case.
     */
    readonly slots: readonly { readonly slot: string; readonly key: EastType; readonly case: string | undefined }[];
}

/**
 * A link's end: the field holding the key of the item it joins, and the item
 * slot those keys are of — or, for a variant field, a slot per case.
 *
 * @typeParam R - The record's row type
 * @typeParam F - The field
 */
export interface SchematicEnd<R extends StructType, F extends string> {
    /** The field: one holding an item slot's key, or a variant holding one per case (#1549). */
    field: F;
    /** The item slot its keys are of — or, for a variant field, one per case. */
    of: SchematicEndOf<R["fields"][F]>;
}

/**
 * One kind of link (§4.3): fibre runs, power feeds, each between two items.
 *
 * @typeParam R - The record's row type
 * @typeParam FF - The `from` field
 * @typeParam TF - The `to` field
 * @typeParam K - The record's key type
 */
export interface SchematicLinksConfig<R extends StructType, FF extends string, TF extends string, K extends EastType = StringType> extends RecordSide<R, K> {
    /** The kind's name: in the Connect tool's menu, the library and the inspector. */
    name: string;
    /** Its Font Awesome solid icon. */
    icon: string;
    /** The item it runs from. */
    from: SchematicEnd<R, FF>;
    /** The item it runs to. */
    to: SchematicEnd<R, TF>;
    /** The field its waypoints are: an `Array` of `{ x, y }` Floats, the app's own points. */
    via?: SchematicViaField<R>;
    /** Its caption, on a knockout at its path's middle (#1403). */
    label?: Accessor<R, OptionType<StringType>, K>;
    /** The figure after its label. */
    metric?: Accessor<R, OptionType<StringType>, K>;
    /** Solid (the default) or dashed, its tone and its weight. */
    style?: Accessor<R, typeof SchematicLinkStyleType, K>;
    /** Orthogonal (the default) or direct. */
    route?: Accessor<R, typeof SchematicRouteType, K>;
    /** The String field naming the layer it is on. */
    layer?: SchematicStringField<R>;
    /** Its details: a record keyed as this one is. */
    details?: SchematicDetails;
    /** Its templates, each giving every field but `from` and `to`: dropped on a link, one retypes it. */
    templates?: SchematicTemplates<SchematicValuesOf<R, FF | TF>>;
    /**
     * A link drawn with no template of the kind selected: its own fields — every field but `from` and `to`, as a
     * template gives them — from its ends (`Schematic.Types.Ends`, #1526). Held at build to those fields, a field missing
     * or extra refused, naming it. Omitted, each its type's default.
     */
    values?: (ends: ExprType<SchematicEndsType>) => ScheduleNewValues<R>;
    /** Hints for the inspector's form over the fields no role writes. */
    fields?: FieldHints<R["fields"]>;
    /** Its own Details in the inspector, in place of its form. */
    inspector?: RowInspector<R>;
}

/** A link kind, declared. */
export interface SchematicLinks extends KindDeclaration<"links", typeof SchematicLinkKindType> {
    /** Each end's field, and the item slots it holds keys of, each with the key it holds (#1549). */
    readonly ends: { readonly from: SchematicKeyRole; readonly to: SchematicKeyRole };
}

/** A link's or a net's drawing roles: shared by both. */
interface EdgeRoles {
    readonly viaField: string | undefined;
    readonly layerField: string | undefined;
    readonly labelOf: ExprType<FunctionType<[EastType, EastType], OptionType<StringType>>> | undefined;
    readonly metricOf: ExprType<FunctionType<[EastType, EastType], OptionType<StringType>>> | undefined;
    readonly styleOf: ExprType<FunctionType<[EastType, EastType], typeof SchematicLinkStyleType>> | undefined;
    readonly routeOf: ExprType<FunctionType<[EastType, EastType], typeof SchematicRouteType>> | undefined;
}

/** Checks a link's or a net's drawing roles. */
function edgeRoles(keyType: EastType, rowType: StructType, where: string, config: {
    via?: string; layer?: string; label?: unknown; metric?: unknown; style?: unknown; route?: unknown;
}): EdgeRoles {
    const role = roleField(rowType, where);
    return {
        viaField: role("via", config.via, ArrayType(SchematicPointType), "an Array of { x, y } Floats field"),
        layerField: role("layer", config.layer, StringType, "a String field"),
        labelOf: accessorRole(keyType, rowType, where, "label", OptionType(StringType), "an Option of a String", config.label),
        metricOf: accessorRole(keyType, rowType, where, "metric", OptionType(StringType), "an Option of a String", config.metric),
        styleOf: accessorRole(keyType, rowType, where, "style", SchematicLinkStyleType, "a Schematic.Types.LinkStyle", config.style),
        routeOf: accessorRole(keyType, rowType, where, "route", SchematicRouteType, "a Schematic.Types.Route", config.route),
    };
}

/** A link's or a net's drawing roles, for a row. */
function edgeShown($: { const: (value: unknown) => unknown }, edge: EdgeRoles, row: unknown, key: unknown) {
    return {
        via: edge.viaField === undefined ? East.value([], ArrayType(SchematicPointType)) : fieldOf(row, edge.viaField),
        label: called($, edge.labelOf, row, key, (l) => l, none),
        metric: called($, edge.metricOf, row, key, (m) => m, none),
        style: called($, edge.styleOf, row, key, (s) => s, East.value(variant("solid", { tone: none, weight: none }), SchematicLinkStyleType)),
        route: called($, edge.routeOf, row, key, (r) => r, East.value(variant("orthogonal", { corner: none }), SchematicRouteType)),
        layer: edge.layerField === undefined ? none : some(fieldOf(row, edge.layerField)),
    };
}

/**
 * Declares a link kind (§4.3).
 *
 * @typeParam R - The record's row type
 * @typeParam FF - The `from` field
 * @typeParam TF - The `to` field
 * @typeParam K - The record's key type: any a Dict may be keyed by (#1549)
 * @param record - The app's record of links, bound as §1, rule 4 says
 * @param config - Its name and icon, its ends, its drawing roles, and its details, templates, form, Details and check
 * @returns The kind, for the Schematic's `links`, by slot
 * @throws {Error} Naming the role or the binding, as `Schematic.items` does: an end of a type no Dict is keyed by — an
 *   Option among them, a link having both its ends — or whose `of` names no item slot, or for a variant field neither
 *   one nor a slot per case; `from` and `to` naming one field; and a `values` giving other fields than every field but
 *   its ends, or one of another type, naming it
 */
export function schematicLinks<R extends StructType, FF extends SchematicEndField<R>, TF extends SchematicEndField<R>, K extends EastType = StringType>(
    record: SchematicRecord<R, K>, config: SchematicLinksConfig<R, FF, TF, K>,
): SchematicLinks {
    const where = `Schematic.links: "${config.name}"`;
    const bound = boundOf(record, where);
    const rowType = bound.rowType;
    const fields = rowType.fields as Record<string, EastType>;
    const typeOf = fieldTypeOf(rowType, where);
    const entries = entriesOf(bound, config.entries, where);
    if (typeof config.icon !== "string") throw new Error(`${where}: \`icon\` is a Font Awesome solid icon's name`);
    const end = (prop: "from" | "to", given: { field: string; of: unknown } | undefined): KeyField => {
        if (given === undefined || typeof given.field !== "string") throw new Error(`${where}: \`${prop}\` is { field, of } — the field holding an item's key, and the item slot it holds keys of`);
        const checked = checkKeyField(given.field, typeOf(`${prop}.field`, given.field), given.of, { where, prop, noun: "item" });
        if (checked.optional) {
            throw new Error(`${where}: a link has both its ends — \`${prop}.field\` names a field holding an item's key, or a variant holding one per case, ` +
                `never an Option — and "${given.field}" holds ${typeText(fields[given.field]!)}`);
        }
        return checked;
    };
    const from = end("from", config.from as { field: string; of: unknown });
    const to = end("to", config.to as { field: string; of: unknown });
    if (from.field === to.field) throw new Error(`${where}: \`from\` and \`to\` both name "${from.field}" — a link's ends are two fields`);
    // Each end as `<Schematic>` checks it against its slots' key types (#1549): the key it holds of each — the field's
    // own, or its case's.
    const roleOf = (checked: KeyField): SchematicKeyRole => ({
        field: checked.field,
        slots: checked.shape === "key" ? [{ slot: checked.of, key: checked.key, case: undefined }]
            : checked.cases.map((c) => ({ slot: checked.of[c]!, key: checked.keys[c]!, case: c })),
    });
    const edge = edgeRoles(bound.keyType, rowType, where, config as never);
    const details = detailsOf(config.details, [], where, bound.keyType);
    const ValuesType = valuesTypeOf(rowType, [from.field, to.field]);
    const templates = templatesOf(config.templates, where);
    const templateRows = templates === undefined ? East.value([], ArrayType(SchematicTemplateType))
        : checkedSchematicTemplates(templates, ValuesType, `\`${from.field}\` and \`${to.field}\``, where);
    const valuesOf = scheduleNewValues(SchematicEndsType, rowType, ValuesType, config.values, where);
    const fromRef = keyFieldRef(from, rowType);
    const toRef = keyFieldRef(to, rowType);
    const fromValue = keyFieldValue(from, fields[from.field]!);
    const toValue = keyFieldValue(to, fields[to.field]!);

    const rolesOf = East.function([rowType, bound.keyType], SchematicLinkType, ($, row, key) => {
        const fromOf = $.const(fromRef);
        const toOf = $.const(toRef);
        return East.value({
            from: fromOf(row as never).unwrap(),
            to: toOf(row as never).unwrap(),
            ...edgeShown($, edge, row, key),
        } as never, SchematicLinkType);
    }) as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>;

    // A row with its ends written from `ends`, every other field from `source`; `none` for an end of a slot the field holds no keys of.
    const ended = ($: { const: (value: unknown) => unknown; let: (value: unknown, type?: EastType) => unknown; match: (value: unknown, arms: object) => void },
        source: unknown, ends: ExprType<typeof SchematicEndsType>) => {
        const fromOf = $.const(fromValue) as (ref: unknown) => ExprType<OptionType<EastType>>;
        const toOf = $.const(toValue) as (ref: unknown) => ExprType<OptionType<EastType>>;
        const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType)) as ExprType<OptionType<BlobType>> & { __assign?: never };
        $.match(fromOf(some(ends.from)), {
            some: ($2: { match: (value: unknown, arms: object) => void }, f: ExprType<EastType>) => {
                $2.match(toOf(some(ends.to)), {
                    some: ($3: { assign: (target: unknown, value: unknown) => void }, t: ExprType<EastType>) => {
                        $3.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, source, { [from.field]: f, [to.field]: t }), "v2")), OptionType(BlobType)));
                    },
                });
            },
        });
        return result;
    };
    const write = East.function([BlobType, SchematicEndsType], OptionType(BlobType), ($, bytes, ends) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        return ended($ as never, row, ends) as never;
    });
    // A new link between two items, every other field from a template's values — or, with none selected, the kind's
    // `values` of its ends, or its type's default.
    const blank = East.value(defaultValue(ValuesType) as never, ValuesType) as ExprType<EastType>;
    const create = East.function([SchematicEndsType, OptionType(BlobType)], OptionType(BlobType), ($, ends, values) => {
        const ownOf = valuesOf === undefined ? undefined : $.const(valuesOf);
        const given = $.const(values.match({
            some: (_$2, bytes) => bytes.decodeBeast(ValuesType, "v2") as ExprType<EastType>,
            none: (_$2) => ownOf === undefined ? blank : ownOf(ends as never) as ExprType<EastType>,
        }) as ExprType<EastType>);
        return ended($ as never, given, ends) as never;
    });

    return {
        [SCHEMATIC_DEF]: "links",
        rowType,
        keyType: bound.keyType,
        name: config.name,
        ends: { from: roleOf(from), to: roleOf(to) },
        hasTemplates: templates !== undefined,
        templatesSource: templates?.source,
        build(slot, part, every = false) {
            const { rows, byKey } = readsOf(bound, entries, slot, part, where, every);
            const side = recordSide(bound, entries, byKey, config,
                [from.field, to.field, edge.viaField, edge.layerField], where);
            return East.value({
                ...side,
                key: slot,
                name: config.name,
                icon: config.icon,
                details: details === undefined ? none : some(details.build(slot, part !== undefined)),
                ends: { from: keyFieldSlots(from), to: keyFieldSlots(to) },
                rows: storedRows(rows, bound.keyType, rolesOf, SchematicLinkEntryType),
                read: readOf(bound.keyType, rowType, rolesOf, SchematicLinkType),
                write,
                create,
                templates: templateRows,
                templatesSource: templates?.source === undefined ? none : some(templates.source),
                // Its record's key type (#1549).
                keyType: toEastTypeValue(bound.keyType),
            } as never, SchematicLinkKindType) as ExprType<typeof SchematicLinkKindType>;
        },
    };
}

// ============================================================================
// Schematic.nets
// ============================================================================

/**
 * A net's side: the Set or Array field holding its items' keys, and the item
 * slot those keys are of.
 *
 * @typeParam R - The record's row type
 */
export interface SchematicSide<R extends StructType> {
    /** The field: a Set or an Array of its item slot's keys (#1549). */
    field: SchematicMembersField<R>;
    /** The item slot its keys are of. */
    of: string;
}

/**
 * One kind of net (§4.4): a trunk joining many items to many, as a power
 * distribution unit feeds a row of racks.
 *
 * @typeParam R - The record's row type
 * @typeParam SRC - The `sources` field
 * @typeParam DST - The `destinations` field
 * @typeParam K - The record's key type
 */
export interface SchematicNetsConfig<R extends StructType, SRC extends string, DST extends string, K extends EastType = StringType> extends RecordSide<R, K> {
    /** The kind's name. */
    name: string;
    /** Its Font Awesome solid icon. */
    icon: string;
    /** Its feeding side. */
    sources: { field: SRC; of: string };
    /** Its fed side. */
    destinations: { field: DST; of: string };
    /** The field its trunk's waypoints are: an `Array` of `{ x, y }` Floats, the app's own points. */
    via?: SchematicViaField<R>;
    /** Its caption, on a knockout at its trunk's middle (#1403). */
    label?: Accessor<R, OptionType<StringType>, K>;
    /** The figure after its label. */
    metric?: Accessor<R, OptionType<StringType>, K>;
    /** Solid (the default) or dashed, its tone and its weight. */
    style?: Accessor<R, typeof SchematicLinkStyleType, K>;
    /** Its trunk: orthogonal (the default) or direct. */
    route?: Accessor<R, typeof SchematicRouteType, K>;
    /** The String field naming the layer it is on. */
    layer?: SchematicStringField<R>;
    /** Its details: a record keyed as this one is. */
    details?: SchematicDetails;
    /** Its templates, each giving every field but its sides. */
    templates?: SchematicTemplates<SchematicValuesOf<R, SRC | DST>>;
    /**
     * A net drawn with no template of the kind selected: its own fields — every field but its sides, as a template
     * gives them — from its sides (`Schematic.Types.Sides`, #1526). Held at build to those fields, as a link kind's are.
     * Omitted, each its type's default.
     */
    values?: (sides: ExprType<SchematicSidesType>) => ScheduleNewValues<R>;
    /** Hints for the inspector's form over the fields no role writes. */
    fields?: FieldHints<R["fields"]>;
    /** Its own Details in the inspector, in place of its form. */
    inspector?: RowInspector<R>;
}

/** A net kind, declared. */
export interface SchematicNets extends KindDeclaration<"nets", typeof SchematicNetKindType> {
    /** Each side's field, and the item slot it holds keys of, with the key it holds (#1549). */
    readonly sides: { readonly sources: SchematicKeyRole; readonly destinations: SchematicKeyRole };
}

/**
 * Declares a net kind (§4.4).
 *
 * @typeParam R - The record's row type
 * @typeParam SRC - The `sources` field
 * @typeParam DST - The `destinations` field
 * @typeParam K - The record's key type: any a Dict may be keyed by (#1549)
 * @param record - The app's record of nets, bound as §1, rule 4 says
 * @param config - Its name and icon, its sides, its drawing roles, and its details, templates, form, Details and check
 * @returns The kind, for the Schematic's `nets`, by slot
 * @throws {Error} Naming the role or the binding, as `Schematic.items` does: a side of neither a Set nor an Array of a
 *   type a Dict may be keyed by, whose `of` names no item slot; both sides naming one field; and a `values` giving
 *   other fields than every field but its sides, or one of another type, naming it
 */
export function schematicNets<R extends StructType, SRC extends SchematicMembersField<R>, DST extends SchematicMembersField<R>, K extends EastType = StringType>(
    record: SchematicRecord<R, K>, config: SchematicNetsConfig<R, SRC, DST, K>,
): SchematicNets {
    const where = `Schematic.nets: "${config.name}"`;
    const bound = boundOf(record, where);
    const rowType = bound.rowType;
    const fields = rowType.fields as Record<string, EastType>;
    const typeOf = fieldTypeOf(rowType, where);
    const entries = entriesOf(bound, config.entries, where);
    if (typeof config.icon !== "string") throw new Error(`${where}: \`icon\` is a Font Awesome solid icon's name`);
    const side = (prop: "sources" | "destinations", given: { field: string; of: string } | undefined) => {
        if (given === undefined || typeof given.field !== "string") throw new Error(`${where}: \`${prop}\` is { field, of } — a Set or an Array field of items' keys, and the item slot they are keys of`);
        const type = typeOf(`${prop}.field`, given.field);
        // Its items' keys, each of a type a Dict may be keyed by: its slot's, which `<Schematic>` checks (#1549).
        const key = type.type === "Set" ? type.key as EastType : type.type === "Array" ? type.value as EastType : undefined;
        if (key === undefined || !isImmutableType(key)) {
            throw new Error(`${where}: \`${prop}.field\` names a Set or an Array field of its items' keys, of a type a Dict may be keyed by — "${given.field}" holds ${typeText(type)}`);
        }
        if (typeof given.of !== "string" || given.of === "") throw new Error(`${where}: \`${prop}.of\` names the item slot "${given.field}" holds keys of`);
        return { field: given.field, of: given.of, set: type.type === "Set", key };
    };
    const sources = side("sources", config.sources);
    const destinations = side("destinations", config.destinations);
    if (sources.field === destinations.field) throw new Error(`${where}: \`sources\` and \`destinations\` both name "${sources.field}" — a net's sides are two fields`);
    const edge = edgeRoles(bound.keyType, rowType, where, config as never);
    const details = detailsOf(config.details, [], where, bound.keyType);
    const ValuesType = valuesTypeOf(rowType, [sources.field, destinations.field]);
    const templates = templatesOf(config.templates, where);
    const templateRows = templates === undefined ? East.value([], ArrayType(SchematicTemplateType))
        : checkedSchematicTemplates(templates, ValuesType, `\`${sources.field}\` and \`${destinations.field}\``, where);
    const valuesOf = scheduleNewValues(SchematicSidesType, rowType, ValuesType, config.values, where);

    // A side's members, as references to the items of its slot: each key its text, a String key as itself and any other
    // as East prints it (#1549).
    const membersOf = (s: typeof sources, row: unknown) => {
        const held = fieldOf(row, s.field);
        const ref = (key: ExprType<EastType>) => East.value({ kind: s.of, key: s.key.type === "String" ? key : East.print(key) } as never, SchematicRefType);
        return s.set
            ? (held as unknown as ExprType<SetType<EastType>>).toArray((_$, key) => ref(key))
            : (held as unknown as ExprType<ArrayType<EastType>>).map((_$, key) => ref(key));
    };
    const rolesOf = East.function([rowType, bound.keyType], SchematicNetType, ($, row, key) => East.value({
        sources: membersOf(sources, row),
        destinations: membersOf(destinations, row),
        ...edgeShown($, edge, row, key),
    } as never, SchematicNetType)) as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>;

    // A side's field value from its members; `none` when one is of another slot, or — keyed by another type than String —
    // its key's text is no key's (#1549).
    const sideValue = (s: typeof sources) => East.function([ArrayType(SchematicRefType)], OptionType(fields[s.field]!), ($, refs) => {
        const Held = OptionType(fields[s.field]!);
        const taken = $.let(true);
        $.for(refs, ($2, r) => { $2.if(r.kind.notEquals(s.of), ($3) => { $3.assign(taken, false); }); });
        if (s.key.type === "String") {
            const value = s.set ? refs.toSet((_$2, r) => r.key) : refs.map((_$2, r) => r.key);
            return taken.ifElse((_$2) => East.value(some(value) as never, Held), (_$2) => East.value(none, Held));
        }
        // Each key read back from its text at the side's key type.
        const result = $.let(East.value(none, Held), Held);
        $.if(taken, ($2) => {
            $2.try(($3) => {
                const value = $3.const((s.set
                    ? refs.toSet((_$4, r) => r.key.parse(s.key) as never)
                    : refs.map((_$4, r) => r.key.parse(s.key) as never)) as unknown as ExprType<EastType>);
                $3.assign(result, East.value(some(value) as never, Held));
            }).catch((_$3) => {});
        });
        return result;
    });
    const sourcesValue = sideValue(sources);
    const destinationsValue = sideValue(destinations);
    // A row with its sides written from `sides`, every other field from `source`; `none` for a member of another slot.
    const sided = ($: { const: (value: unknown) => unknown; let: (value: unknown, type?: EastType) => unknown; match: (value: unknown, arms: object) => void },
        source: unknown, sidesOf: ExprType<typeof SchematicSidesType>) => {
        const srcOf = $.const(sourcesValue) as (refs: unknown) => ExprType<OptionType<EastType>>;
        const dstOf = $.const(destinationsValue) as (refs: unknown) => ExprType<OptionType<EastType>>;
        const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
        $.match(srcOf(sidesOf.sources), {
            some: ($2: { match: (value: unknown, arms: object) => void }, s: ExprType<EastType>) => {
                $2.match(dstOf(sidesOf.destinations), {
                    some: ($3: { assign: (target: unknown, value: unknown) => void }, d: ExprType<EastType>) => {
                        $3.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, source, { [sources.field]: s, [destinations.field]: d }), "v2")), OptionType(BlobType)));
                    },
                });
            },
        });
        return result;
    };
    const write = East.function([BlobType, SchematicSidesType], OptionType(BlobType), ($, bytes, sidesOf) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        return sided($ as never, row, sidesOf) as never;
    });
    // A new net, every other field from a template's values — or, with none selected, the kind's `values` of its sides,
    // or its type's default.
    const blank = East.value(defaultValue(ValuesType) as never, ValuesType) as ExprType<EastType>;
    const create = East.function([SchematicSidesType, OptionType(BlobType)], OptionType(BlobType), ($, sidesOf, values) => {
        const ownOf = valuesOf === undefined ? undefined : $.const(valuesOf);
        const given = $.const(values.match({
            some: (_$2, bytes) => bytes.decodeBeast(ValuesType, "v2") as ExprType<EastType>,
            none: (_$2) => ownOf === undefined ? blank : ownOf(sidesOf as never) as ExprType<EastType>,
        }) as ExprType<EastType>);
        return sided($ as never, given, sidesOf) as never;
    });

    return {
        [SCHEMATIC_DEF]: "nets",
        rowType,
        keyType: bound.keyType,
        name: config.name,
        // Each side as `<Schematic>` checks it against its slot's key type (#1549).
        sides: {
            sources: { field: sources.field, slots: [{ slot: sources.of, key: sources.key, case: undefined }] },
            destinations: { field: destinations.field, slots: [{ slot: destinations.of, key: destinations.key, case: undefined }] },
        },
        hasTemplates: templates !== undefined,
        templatesSource: templates?.source,
        build(slot, part, every = false) {
            const { rows, byKey } = readsOf(bound, entries, slot, part, where, every);
            const sideOf = recordSide(bound, entries, byKey, config,
                [sources.field, destinations.field, edge.viaField, edge.layerField], where);
            return East.value({
                ...sideOf,
                key: slot,
                name: config.name,
                icon: config.icon,
                details: details === undefined ? none : some(details.build(slot, part !== undefined)),
                sides: { sources: sources.of, destinations: destinations.of },
                rows: storedRows(rows, bound.keyType, rolesOf, SchematicNetEntryType),
                read: readOf(bound.keyType, rowType, rolesOf, SchematicNetType),
                write,
                create,
                templates: templateRows,
                templatesSource: templates?.source === undefined ? none : some(templates.source),
                // Its record's key type (#1549).
                keyType: toEastTypeValue(bound.keyType),
            } as never, SchematicNetKindType) as ExprType<typeof SchematicNetKindType>;
        },
    };
}

/**
 * Whether something is a Schematic kind of the sort given.
 *
 * @param value - What a slot holds
 * @param sort - The sort the slot takes
 * @returns Whether it is one
 */
export function isSchematicKind(value: unknown, sort: "items" | "zones" | "links" | "nets"): boolean {
    return typeof value === "object" && value !== null && SCHEMATIC_DEF in value && (value as { [SCHEMATIC_DEF]: string })[SCHEMATIC_DEF] === sort;
}
