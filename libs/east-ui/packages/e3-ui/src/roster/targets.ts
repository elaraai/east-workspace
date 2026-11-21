/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Roster.targets(record, config)` (#1368, `Builder Interfaces Spec.md`
 * §5.2): the staffing targets the Roster writes, the app's own record — a row
 * per slot, its fields mapped to the Roster's roles: the slot's day, group and
 * shift, the positions to fill, and the hours each activity needs. The app's
 * forecast fills it; the planner edits it.
 *
 * - **Roles.** Each names a field of the row: `day` a DateTime (a UTC
 *   midnight), `group` and `shift` Strings, `positions` an Integer, `hours` a
 *   `Dict<String, Float>`. An edit writes only those fields; every other field
 *   of the row reads back as it was.
 * - **Hours needed.** The app's own (#1678): `needed`, an East function of
 *   the row — drafts in place — and its shift's nominal hours. It is read,
 *   never written: an edit of the positions or the hours reads it again from
 *   the edited row. Without it, the sum of the row's `hours`. It is the slot's
 *   `Requirement.needed`, which `Roster.coverage` reads.
 * - **New rows.** A slot with no row has no target. A target edit on such a
 *   slot inserts one, keyed as its `key` builds from its row, or by the
 *   app's own rule, `newKey` — one of the two — or else by a key the Roster
 *   makes, a String one made up and an Integer one past the largest, its
 *   unmapped fields the targets' `values` of its roles (#1526) — or, without
 *   them, their type's default. A record keyed by any other type takes `key`
 *   or `newKey`. A target whose `key` reads a field an edit changes moves
 *   under the key it then builds.
 * - **Key field.** Where a target's row holds its key in a field too,
 *   `keyField` names it: a target the Roster inserts holds the key it minted
 *   there, and is saved with it; no role writes the field, and `key` never
 *   reads it.
 * - **Reads.** Through the Roster's slice, by its `targets` source — an
 *   interval index from the day to the day, its `range` the day field — and
 *   then `entries` reads one target by its key; or the record whole.
 * - **The inspector.** The app's own form for one target, `(row, update) =>
 *   UIComponentType`, in place of the Roster's.
 *
 * The targets are one session of the Roster's history (`session.ts`), as its
 * duties and its periods are: Save sends their changes through the record's
 * patch door as a request of their own.
 *
 * @packageDocumentation
 */

import {
    BlobType, DateTimeType, DictType, East, Expr, FloatType, IntegerType, NullType, OptionType, StringType, StructType, defaultValue, isTypeEqual, none,
    some, toEastTypeValue, type EastType, type ExprType, type FunctionType, type SetType, type SubtypeExprOrValue,
} from "@elaraai/east";
import type { UIComponentType } from "@elaraai/east-ui";
import type { RecordKeyField } from "../bind/record.js";
import { scheduleAccessor } from "../schedule/accessor.js";
import type { ScheduleAtField, ScheduleDictFloatField, ScheduleIntegerField, ScheduleRecordHandle, ScheduleStringField } from "../schedule/events.js";
import { scheduleRecordWindow, type ScheduleKindPart } from "../schedule/record-window.js";
import { scheduleRecordSession } from "../schedule/session.js";
import { scheduleNewValues, type ScheduleNewValues } from "../schedule/values.js";
import { checkEntries, typeText } from "../schedule/window.js";
import { checkMadeKeys, checkOneKeyRule, keyBuilderOf, newKeyOf, type KindKeyBuilder, type KindRowKeys } from "../utils/record-kind.js";
import { RowInspectorType, rowInspector } from "../utils/row-inspector.js";
import { RosterTargetEntryType, RosterTargetRolesType, RosterTargetsKindType } from "./types.js";

/**
 * The targets' roles over the app's row, by field name, and their reads.
 *
 * @typeParam R - The app's target row type
 * @typeParam K - The record's key type
 */
export interface RosterTargetsConfig<R extends StructType, K extends EastType = StringType> extends KindRowKeys<R, K> {
    /** The DateTime field holding the slot's day, a UTC midnight. */
    day: ScheduleAtField<R>;
    /** The String field naming the slot's group, a key of the Roster's `groups`. */
    group: ScheduleStringField<R>;
    /** The String field naming the slot's shift, a key of the Roster's `shifts`. */
    shift: ScheduleStringField<R>;
    /** The Integer field holding the positions to fill. */
    positions: ScheduleIntegerField<R>;
    /** The `Dict<String, Float>` field holding the hours each activity needs, by its key. */
    hours: ScheduleDictFloatField<R>;
    /**
     * The slot's hours needed (#1678): an East function of the target's row — drafts in place — and its shift's nominal
     * hours (`Roster.shifts`' `hours`), returning a Float. Read, never written: an edit of the positions or the hours
     * reads it again from the edited row. Omitted, the sum of the row's `hours`.
     */
    needed?: (row: ExprType<R>, shiftHours: ExprType<FloatType>) => SubtypeExprOrValue<FloatType>;
    /**
     * A new target's own fields — the row's fields no role maps — from its roles (`Roster.Types.NewTarget`): the slot
     * and what the planner set it to ask (#1526). Held at build to those fields, a field missing or extra refused, naming
     * it. Omitted, each its type's default.
     */
    values?: (target: ExprType<RosterTargetRolesType>) => ScheduleNewValues<R>;
    /**
     * The field of the row that holds the target's key, of the record's key type, for a record whose rows carry their
     * own. A target the Roster inserts holds the key it minted there, whatever `values` gives the field, and is saved with
     * it; a target the record holds already keeps what its field holds. No role names the field, and `key` never reads it.
     */
    keyField?: RecordKeyField<K, R>;
    /**
     * A new target's key, in the app's own scheme: an East function given the keys taken — every key the Roster knows
     * the record to hold, and every one its drafts hold — to one that is not. Without it the Roster makes one: a String
     * key made up, an Integer one past the largest.
     */
    newKey?: SubtypeExprOrValue<FunctionType<[SetType<K>], K>>;
    /**
     * A target's key, built from its row — `(cover) => East.str\`${cover.team}/${cover.shift}/${cover.day}\``: what the
     * Roster inserts a target under, and what a target moves to as an edit changes the fields it reads. Never beside
     * `newKey`.
     */
    key?: KindKeyBuilder<R, K>;
    /**
     * The app's own form for one target, in place of the Roster's — an East function over the row and a writer of the
     * edited row, `(row, update) => UIComponentType`, passed through untouched (never called at build).
     */
    inspector?: SubtypeExprOrValue<FunctionType<[R, FunctionType<[R], NullType>], UIComponentType>>;
    /**
     * A paged read of the record's own entries (`Data.bindPaged(record)`): one target read by its key, beside the
     * Roster's slice's `targets` source, which reads the week's. Required with that source; omitted without it.
     */
    entries?: unknown;
}

/** The key the targets' declaration carries what it is under. */
export const ROSTER_TARGETS: unique symbol = Symbol("Roster.targets");

/** The app's targets, declared: what the Roster's `targets` takes. */
export interface RosterTargets {
    /** What it is. */
    readonly [ROSTER_TARGETS]: true;
    /** The target's row type. */
    readonly rowType: StructType;
    /**
     * The record's name in the deployed package, as its binding carries it: the Roster edits it, so an optimiser that
     * reads it lists it in its `drafts` (east-workspace#1622).
     */
    readonly record: ExprType<StringType>;
    /**
     * The targets on the wire.
     *
     * @param part - The Roster's slice's `targets` source, bound in its payload, when the slice has one
     * @returns The targets, closed: their session, their reads, and each row's roles read and written
     * @throws {Error} When they are read through the slice without `entries`, or given `entries` without the slice's source
     */
    build(part?: ScheduleKindPart): ExprType<RosterTargetsKindType>;
}

/** A field of a struct as an East expression, by name. */
function fieldOf(row: unknown, name: string): ExprType<EastType> {
    return (row as Record<string, ExprType<EastType>>)[name]!;
}

/**
 * A target's hours needed, reified once (#1678): the app's `needed` of the row and its shift's nominal hours, or —
 * without it — the sum of the row's `hours`.
 *
 * @param rowType - The target's row type
 * @param hours - The field its `hours` role names
 * @param given - The app's `needed`; `undefined`, none
 * @param where - The declaration, as a refusal names it
 * @returns The East function `(row, shiftHours) → Float`
 * @throws {Error} When `needed` is no function, or is not one of the row and a Float returning a Float, naming it
 */
function targetsNeeded(rowType: EastType, hours: string, given: unknown, where: string): ExprType<FunctionType<[EastType, FloatType], FloatType>> {
    if (given === undefined) {
        return East.function([rowType, FloatType], FloatType, ($, row, _shiftHours) => {
            const sum = $.let(0.0, FloatType);
            $.for(fieldOf(row, hours) as ExprType<DictType<StringType, FloatType>>, ($2, needs) => { $2.assign(sum, sum.add(needs)); });
            return sum;
        }) as ExprType<FunctionType<[EastType, FloatType], FloatType>>;
    }
    const example = "(row, shiftHours) => row.heads.toFloat().multiply(shiftHours)";
    if (typeof given !== "function") {
        throw new Error(`${where}: \`needed\` is a function of the target's row and its shift's nominal hours, returning the slot's hours needed as a Float — ${example}`);
    }
    // The shared accessor's reification, the shift's nominal hours in its key's place.
    return scheduleAccessor(rowType, FloatType, FloatType, given as (row: ExprType<EastType>, shiftHours: ExprType<EastType>) => SubtypeExprOrValue<FloatType>,
        (returns) => `${where}: \`needed\` returns the slot's hours needed, a Float, from the target's row and its shift's nominal hours — ` +
            `and this one returns ${returns}: ${example}`) as unknown as ExprType<FunctionType<[EastType, FloatType], FloatType>>;
}

/**
 * Declares the app's targets (see the module docs).
 *
 * @typeParam R - The app's target row type
 * @typeParam K - The record's key type
 * @param record - The app's record of targets, `Record.bind(record), its record declaring patch: mutation.patch()`: a `Dict` of rows by key
 * @param config - The fields its roles name, the app's own form, and its read by key
 * @returns The targets, for the Roster's `targets`
 * @throws {Error} Naming the option: a record not bound with its patch mutation, or whose rows are no structs; a record
 *   keyed by neither String nor Integer, given neither `key` nor `newKey`; a role naming a field the row lacks, or a
 *   field of another type; two roles naming one field; a `needed` that is no function of the row and a Float returning a
 *   Float; a `values` giving other fields than the ones no role maps, or one of another type, naming it; a `keyField`
 *   that is no field of the row of the record's key type, or that a role names; a `newKey` that is no East function from
 *   a Set of the record's keys to one; a `key` that builds another type than the record's key, reads the field
 *   `keyField` names, or is given beside `newKey`; `entries` that is not a paged read of the record's own entries; and an
 *   `inspector` that is no East function `(row, update) => UIComponentType` over the row
 * @example
 * ```tsx
 * import { DateTimeType, DictType, FloatType, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { Record, Roster } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const Cover = StructType({ day: DateTimeType, team: StringType, shift: StringType, heads: IntegerType, hours: DictType(StringType, FloatType) });
 * const cover = e3.record("cover", DictType(StringType, Cover), {
 *     initial: new Map(),
 *     mutations: (mutation) => ({
 *         patch: mutation.patch(),
 *     }),
 * });
 *
 * // Inside the Roster's Reactive body: a target per slot, over the app's own rows — each slot needing its heads' shifts
 * // in hours, whatever part of them its skill hours name.
 * const targets = Roster.targets(Record.bind(cover), {
 *     day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours",
 *     needed: (row, shiftHours) => row.heads.toFloat().multiply(shiftHours),
 * });
 * ```
 */
export function rosterTargets<R extends StructType, K extends EastType = StringType>(record: ScheduleRecordHandle<K, R>, config: RosterTargetsConfig<R, K>): RosterTargets {
    const where = "Roster.targets";
    const c = config as unknown as {
        day: string; group: string; shift: string; positions: string; hours: string; needed?: unknown; values?: unknown; keyField?: string;
        newKey?: unknown; key?: unknown; inspector?: unknown; entries?: unknown;
    };
    const handleType = Expr.type(record as unknown as Expr) as EastType;
    const read = handleType.type === "Struct" ? (handleType.fields as Record<string, EastType>)["read"] : undefined;
    if (handleType.type !== "Struct" || read === undefined || read.type !== "Function"
        || (handleType.fields as Record<string, EastType>)["binding"] === undefined) {
        throw new Error(`${where}: \`record\` is the app's record of targets, bound with its patch mutation — Record.bind(record), its record declaring patch: mutation.patch()`);
    }
    const recordType = read.output as EastType;
    if (recordType.type !== "Dict") {
        throw new Error(`${where}: the app's record of targets holds its targets by key — a Dict of rows — and this record holds ${typeText(recordType)}`);
    }
    const keyType = recordType.key as EastType;
    const rowType = recordType.value as EastType;
    if (rowType.type !== "Struct") {
        throw new Error(`${where}: a target's row is a struct of the app's fields, its roles among them — and this record's rows are ${typeText(rowType)}`);
    }
    const fields = rowType.fields as Record<string, EastType>;
    // Each role a field of the row, of the role's type.
    const role = (prop: string, name: string | undefined, type: EastType, what: string): string => {
        if (typeof name !== "string") throw new Error(`${where}: \`${prop}\` names ${what} of the row`);
        const held = fields[name];
        if (held === undefined) throw new Error(`${where}: \`${prop}\` names "${name}", a field the row does not have (${Object.keys(fields).join(", ")})`);
        if (!isTypeEqual(held, type)) throw new Error(`${where}: \`${prop}\` names ${what} — "${name}" holds ${typeText(held)}`);
        return name;
    };
    const day = role("day", c.day, DateTimeType, "a DateTime field, the slot's day");
    const group = role("group", c.group, StringType, "a String field, the slot's group");
    const shift = role("shift", c.shift, StringType, "a String field, the slot's shift");
    const positions = role("positions", c.positions, IntegerType, "an Integer field, the positions to fill");
    const hours = role("hours", c.hours, DictType(StringType, FloatType), "a Dict of String to Float field, the hours each activity needs");
    // The Roster writes each role into a field of its own.
    const named = new Map<string, string>();
    for (const [prop, name] of [["day", day], ["group", group], ["shift", shift], ["positions", positions], ["hours", hours]] as const) {
        const prior = named.get(name);
        if (prior !== undefined) throw new Error(`${where}: \`${prior}\` and \`${prop}\` both name "${name}" — the Roster writes each of its roles into a field of its own`);
        named.set(name, prop);
    }
    // The slot's hours needed (#1678): the app's, of the row and its shift's nominal hours, or the sum of the row's hours.
    const neededOf = targetsNeeded(rowType, hours, c.needed, where);
    // A new target's own fields, the ones no role maps (#1526): the targets' `values` of its roles.
    const own = StructType(Object.entries(fields).filter(([name]) => !named.has(name)));
    const valuesOf = scheduleNewValues(RosterTargetRolesType, rowType, own, c.values, where);
    const inspector = c.inspector === undefined ? undefined : rowInspector(c.inspector, rowType,
        `${where}: \`inspector\` is the app's own form for one target — an East.function over the target's row and its writer: ` +
        "East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …), RowType the record's row");
    // The targets read by key, or whole; and their session, declared now, so a record bound without its patch door is refused here.
    const entries = c.entries === undefined ? undefined : checkEntries(c.entries, keyType, rowType, `${where}: \`entries\``);
    // Where its rows hold their own key in a field, the Roster keeps a target's key there: no role writes that field.
    const keyField = c.keyField;
    const writes = keyField === undefined ? undefined : named.get(keyField);
    if (writes !== undefined) {
        throw new Error(`${where}: \`keyField\` names "${keyField}", which \`${writes}\` writes — a target's key is kept in its key field by the Roster, and nothing else writes it`);
    }
    const session = scheduleRecordSession(record, keyType, rowType, entries, keyField === undefined ? undefined : { field: keyField, where });
    // A new target's key by the app's own rule, where it gives one — or built from its row: one of the two, or neither —
    // and else the Roster's, which makes a String key up and counts an Integer one on, and makes no key of another type.
    checkOneKeyRule(where, c);
    const newKey = c.newKey === undefined ? undefined : newKeyOf(keyType, where, c.newKey);
    const keyBuilt = keyBuilderOf(keyType, rowType, where, "a target", c.key, keyField);
    checkMadeKeys({ form: "record", keyType }, keyBuilt !== undefined || newKey !== undefined, where, "targets", "the Roster makes one");

    return {
        [ROSTER_TARGETS]: true,
        rowType,
        record: session.name,
        build(part?: ScheduleKindPart): ExprType<RosterTargetsKindType> {
            if (part === undefined && entries !== undefined) {
                throw new Error(`${where}: \`entries\` reads one target by its key beside the Roster's slice's \`targets\` source, which reads the week's — ` +
                    "give that source with it, or leave `entries` out to read the record whole");
            }
            if (part !== undefined && entries === undefined) {
                throw new Error(`${where}: the Roster's slice's \`targets\` source reads only the week's targets — and one target, its editing's, ` +
                    "is read by its key: give `entries` beside it, Data.bindPaged(record), the record's own entries");
            }
            // The week's targets through the slice's source — its interval index from the day to the day — or the record whole.
            const window = part === undefined ? undefined
                : scheduleRecordWindow(part, "targets", keyType, rowType, day, day, false, false, where);
            const { editing, entries: seam } = session.build();
            const Roles = RosterTargetRolesType;
            // A row's roles: the slot's day, group and shift, its positions and its hours.
            const rolesOf = East.function([rowType], Roles, (_$, row) => ({
                day: fieldOf(row, day) as ExprType<DateTimeType>, group: fieldOf(row, group) as ExprType<StringType>,
                shift: fieldOf(row, shift) as ExprType<StringType>, positions: fieldOf(row, positions) as ExprType<IntegerType>,
                hours: fieldOf(row, hours) as ExprType<DictType<StringType, FloatType>>,
            }));
            // The row with its roles written from `roles`, and every other field from `source`.
            const rowWith = (source: ExprType<EastType>, roles: ExprType<typeof Roles>): ExprType<EastType> =>
                East.value(Object.fromEntries(Object.keys(fields).map((f) => [f,
                    f === day ? roles.day
                        : f === group ? roles.group
                            : f === shift ? roles.shift
                                : f === positions ? roles.positions
                                    : f === hours ? roles.hours
                                        : fieldOf(source, f)])) as never, rowType) as ExprType<EastType>;
            const RowsType = OptionType(DictType(StringType, RosterTargetEntryType));
            // Erased as the record's own read is, so the record whole and a window of it are one type.
            const HeldType: DictType<EastType, EastType> = DictType(keyType, rowType);
            // The week's targets by their keys' text, each with its roles and its row.
            const rows = East.function([DateTimeType, DateTimeType], RowsType, ($, from, to) => {
                const roles = $.const(rolesOf);
                const text = $.const(session.idOf);
                const result = $.let(East.value(none, RowsType), RowsType);
                let held: ExprType<OptionType<DictType<EastType, EastType>>>;
                if (window === undefined) {
                    held = $.let(East.value(some(session.readAll()), OptionType(HeldType)));
                } else {
                    const read = $.const(window);
                    held = $.let(read(from, to));
                }
                $.match(held, {
                    some: ($2, all) => {
                        const out = $2.let(new Map(), DictType(StringType, RosterTargetEntryType));
                        $2.for(all, ($3, row, key) => {
                            const at = $3.const(fieldOf(row, day) as unknown as ExprType<DateTimeType>);
                            $3.if(East.greaterEqual(at, from).and(() => East.less(at, to)), ($4) => {
                                $4(out.insert(text(key as never), { roles: roles(row as never), row: East.Blob.encodeBeast(row, "v2") }));
                            });
                        });
                        $2.assign(result, East.value(some(out), RowsType));
                    },
                });
                return result;
            });
            const readRoles = East.function([BlobType], Roles, ($, bytes) => {
                const of = $.const(rolesOf);
                return of(bytes.decodeBeast(rowType, "v2") as never);
            });
            // A drafted row's hours needed, from its bytes and its shift's nominal hours (#1678).
            const readNeeded = East.function([BlobType, FloatType], FloatType, ($, bytes, shiftHours) => {
                const of = $.const(neededOf);
                return of(bytes.decodeBeast(rowType, "v2") as never, shiftHours);
            });
            const write = East.function([BlobType, Roles], BlobType, ($, bytes, roles) => {
                const row = $.const(bytes.decodeBeast(rowType, "v2"));
                return East.Blob.encodeBeast(rowWith(row as ExprType<EastType>, roles), "v2");
            });
            // A new target: its roles written, and every other field the targets' `values` of them — or, without them, its
            // type's default.
            const blank = East.value(defaultValue(rowType) as never, rowType) as ExprType<EastType>;
            const create = East.function([Roles], BlobType, ($, roles) => {
                let row: ExprType<EastType>;
                if (valuesOf === undefined) {
                    row = $.const(blank);
                } else {
                    const ownOf = $.const(valuesOf);
                    row = $.const(ownOf(roles as never));
                }
                return East.Blob.encodeBeast(rowWith(row, roles), "v2");
            });
            return East.value({
                editing,
                entries: seam,
                newKey: newKey === undefined ? none : some(newKey),
                rowKey: keyBuilt === undefined ? none : some(keyBuilt),
                rows,
                read: readRoles,
                needed: readNeeded,
                write,
                create,
                history: session.history,
                inspector: inspector === undefined ? East.value(none, OptionType(RowInspectorType)) : East.value(some(inspector), OptionType(RowInspectorType)),
                rowType: toEastTypeValue(rowType),
            } as never, RosterTargetsKindType);
        },
    };
}

/**
 * Whether a value is the app's targets, declared (`Roster.targets`): what the
 * Roster's `targets` checks before it takes one.
 *
 * @param value - What the app passed
 * @returns Whether it is the targets, declared
 * @internal
 */
export function isRosterTargets(value: unknown): value is RosterTargets {
    return typeof value === "object" && value !== null && (value as { [ROSTER_TARGETS]?: boolean })[ROSTER_TARGETS] === true;
}
