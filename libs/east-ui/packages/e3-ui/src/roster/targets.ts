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
 * - **New rows.** A slot with no row has no target. A target edit on such a
 *   slot inserts one, keyed by a key the Roster mints, its unmapped fields
 *   their type's default.
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
    BlobType, DateTimeType, DictType, East, Expr, FloatType, IntegerType, NullType, OptionType, StringType, defaultValue, isTypeEqual, none, some,
    toEastTypeValue, type EastType, type ExprType, type FunctionType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import type { UIComponentType } from "@elaraai/east-ui";
import type { ScheduleAtField, ScheduleDictFloatField, ScheduleIntegerField, ScheduleRecordHandle, ScheduleStringField } from "../schedule/events.js";
import { scheduleRecordWindow, type ScheduleKindPart } from "../schedule/record-window.js";
import { scheduleRecordSession } from "../schedule/session.js";
import { checkEntries, typeText } from "../schedule/window.js";
import { RowInspectorType, rowInspector } from "../utils/row-inspector.js";
import { RosterTargetEntryType, RosterTargetRolesType, RosterTargetsKindType } from "./types.js";

/**
 * The targets' roles over the app's row, by field name, and their reads.
 *
 * @typeParam R - The app's target row type
 */
export interface RosterTargetsConfig<R extends StructType> {
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
 * Declares the app's targets (see the module docs).
 *
 * @typeParam R - The app's target row type
 * @param record - The app's record of targets, `Record.bind(record, [e3.mutation.patch(record)])`: a `Dict` keyed by String
 * @param config - The fields its roles name, the app's own form, and its read by key
 * @returns The targets, for the Roster's `targets`
 * @throws {Error} Naming the option: a record not bound with its patch mutation, not keyed by String, or whose rows are no
 *   structs; a role naming a field the row lacks, or a field of another type; two roles naming one field; `entries`
 *   that is not a paged read of the record's own entries; and an `inspector` that is no East function `(row, update) =>
 *   UIComponentType` over the row
 * @example
 * ```tsx
 * import { DateTimeType, DictType, FloatType, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { Record, Roster } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const Cover = StructType({ day: DateTimeType, team: StringType, shift: StringType, heads: IntegerType, hours: DictType(StringType, FloatType) });
 * const cover = e3.record("cover", DictType(StringType, Cover), new Map());
 * const coverPatch = e3.mutation.patch(cover);
 *
 * // Inside the Roster's Reactive body: a target per slot, over the app's own rows.
 * const targets = Roster.targets(Record.bind(cover, [coverPatch]), { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" });
 * ```
 */
export function rosterTargets<R extends StructType>(record: ScheduleRecordHandle<StringType, R>, config: RosterTargetsConfig<R>): RosterTargets {
    const where = "Roster.targets";
    const c = config as unknown as {
        day: string; group: string; shift: string; positions: string; hours: string; inspector?: unknown; entries?: unknown;
    };
    const handleType = Expr.type(record as unknown as Expr) as EastType;
    const read = handleType.type === "Struct" ? (handleType.fields as Record<string, EastType>)["read"] : undefined;
    if (handleType.type !== "Struct" || read === undefined || read.type !== "Function"
        || (handleType.fields as Record<string, EastType>)["binding"] === undefined) {
        throw new Error(`${where}: \`record\` is the app's record of targets, bound with its patch mutation — Record.bind(record, [e3.mutation.patch(record)])`);
    }
    const recordType = read.output as EastType;
    if (recordType.type !== "Dict" || !isTypeEqual(recordType.key as EastType, StringType)) {
        throw new Error(`${where}: a target is keyed by a String — the Roster mints a new target's key — and this record holds ${typeText(recordType)}`);
    }
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
    const inspector = c.inspector === undefined ? undefined : rowInspector(c.inspector, rowType,
        `${where}: \`inspector\` is the app's own form for one target — an East.function over the target's row and its writer: ` +
        "East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …), RowType the record's row");
    // The targets read by key, or whole; and their session, declared now, so a record bound without its patch door is refused here.
    const entries = c.entries === undefined ? undefined : checkEntries(c.entries, StringType, rowType, `${where}: \`entries\``);
    const session = scheduleRecordSession(record, StringType, rowType, entries);

    return {
        [ROSTER_TARGETS]: true,
        rowType,
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
                : scheduleRecordWindow(part, "targets", StringType, rowType, day, day, false, false, where);
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
            const HeldType: DictType<EastType, EastType> = DictType(StringType as EastType, rowType);
            const rows = East.function([DateTimeType, DateTimeType], RowsType, ($, from, to) => {
                const roles = $.const(rolesOf);
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
                                $4(out.insert(key as ExprType<StringType>, { roles: roles(row as never), row: East.Blob.encodeBeast(row, "v2") }));
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
            const write = East.function([BlobType, Roles], BlobType, ($, bytes, roles) => {
                const row = $.const(bytes.decodeBeast(rowType, "v2"));
                return East.Blob.encodeBeast(rowWith(row as ExprType<EastType>, roles), "v2");
            });
            // A new target: its roles written, and every other field its type's default.
            const blank = East.value(defaultValue(rowType) as never, rowType) as ExprType<EastType>;
            const create = East.function([Roles], BlobType, ($, roles) => {
                const row = $.const(blank);
                return East.Blob.encodeBeast(rowWith(row as ExprType<EastType>, roles), "v2");
            });
            return East.value({
                editing,
                entries: seam,
                rows,
                read: readRoles,
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
