/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lists the Roster reads over the app's own rows (#1368, `Builder
 * Interfaces Spec.md` §5.2): its shifts, groups, positions, activities and
 * proposals, each from a keyed record of the app's — usually its `read()` —
 * through accessors, none of which writes the record. Each accessor is
 * reified once and called per row (`shared/reify.ts`' rule), held to the type
 * it returns; one returning another type is refused, naming the accessor and
 * what it returns. The rows come in their `order`, lowest first, then in key
 * order; with no `order`, in key order. Each row's key is its record's key.
 *
 * `Roster.shifts`, `groups`, `positions` and `proposals` are declarations the
 * Roster's props take, which say what they are; `Roster.activities` is the
 * activities themselves, which the app's own tasks may read too.
 *
 * @packageDocumentation
 */

import {
    BooleanType, DateTimeType, East, FloatType, IntegerType, OptionType, StringType, none,
    type ArrayType, type DictType, type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { scheduleAccessor } from "../schedule/accessor.js";
import { ScheduleClockType } from "../schedule/types.js";
import { keyedRows, orderedRows as ordered } from "../utils/keyed-rows.js";
import { RosterGroupType, RosterPositionType, RosterProposalType, RosterShiftType, RosterSkillType } from "./types.js";

/** The key a Roster list's declaration carries what it is under. */
export const ROSTER_LIST: unique symbol = Symbol("Roster.list");

/**
 * A list, declared: what the Roster's `shifts`, `groups`, `positions` or
 * `proposals` takes.
 *
 * @typeParam K - What it is
 * @typeParam T - Its rows' type
 */
export interface RosterList<K extends "shifts" | "groups" | "positions" | "proposals", T extends EastType> {
    /** What it is. */
    readonly [ROSTER_LIST]: K;
    /** Its rows, resolved, in their order. */
    readonly rows: ExprType<ArrayType<T>>;
}

/** The shifts, declared: `Roster.shifts(rows, …)`. */
export type RosterShifts = RosterList<"shifts", RosterShiftType>;
/** The groups, declared: `Roster.groups(rows, …)`. */
export type RosterGroups = RosterList<"groups", RosterGroupType>;
/** The positions, declared: `Roster.positions(rows, …)`. */
export type RosterPositions = RosterList<"positions", RosterPositionType>;
/** The proposals, declared: `Roster.proposals(rows, …)`. */
export type RosterProposals = RosterList<"proposals", RosterProposalType>;

/** One of a list's accessors, over a row of the app's and its key. */
type Accessor<R extends EastType, T extends EastType> = (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<T>;

/**
 * Accessors adapting the app's shift rows to the Roster's shifts.
 * @typeParam R - The app's shift row type
 */
export interface RosterShiftsConfig<R extends EastType> {
    /** Display name. */
    label: Accessor<R, StringType>;
    /** Short code in the week layout. */
    code: Accessor<R, StringType>;
    /** When it starts each day, in UTC: a `Schedule.Types.Clock`. */
    start: Accessor<R, ScheduleClockType>;
    /** Its hours: what a new duty runs, and a skill holder's capacity. */
    hours: Accessor<R, FloatType>;
    /** Where it shows among the shifts, lowest first; shifts of one order show in key order. */
    order?: Accessor<R, IntegerType>;
}

/**
 * Accessors adapting the app's group rows to the Roster's groups.
 * @typeParam R - The app's group row type
 */
export interface RosterGroupsConfig<R extends EastType> {
    /** Display name. */
    label: Accessor<R, StringType>;
    /** Where it shows among the groups, lowest first; groups of one order show in key order. */
    order?: Accessor<R, IntegerType>;
}

/**
 * Accessors adapting the app's position rows to the Roster's positions.
 * @typeParam R - The app's position row type
 */
export interface RosterPositionsConfig<R extends EastType> {
    /** Display name. */
    label: Accessor<R, StringType>;
    /** Chip badge. */
    code: Accessor<R, StringType>;
    /** Whether the position satisfies the lead rule. */
    lead: Accessor<R, BooleanType>;
    /** Where it shows among the positions, lowest first; positions of one order show in key order. */
    order?: Accessor<R, IntegerType>;
}

/**
 * Accessors adapting the app's activity rows to the Roster's activities.
 * @typeParam A - The app's activity row type
 * @property label - Display name
 * @property code - Short code on assignment chips; empty when absent
 * @property group - The group whose skill it is; none, a duty every group shares, when absent
 * @property order - Where it shows among the activities, lowest first; the record's key order when absent
 */
export interface RosterActivitiesConfig<A extends EastType> {
    /** Display name. */
    label: Accessor<A, StringType>;
    /** Short code on assignment chips; empty by default. */
    code?: Accessor<A, StringType>;
    /** The group whose skill it is; none, a duty of every group, by default. */
    group?: Accessor<A, OptionType<StringType>>;
    /**
     * Where it shows among the activities, lowest first: a group's skills in the Activities tab, in a slot's coverage
     * lines and in the inspector. Activities of one order show in key order; with no order, every activity does.
     */
    order?: Accessor<A, IntegerType>;
}

/**
 * Accessors adapting the app's suggestion rows to the Roster's proposals: a
 * person suggested for a slot.
 * @typeParam R - The app's suggestion row type
 */
export interface RosterProposalsConfig<R extends EastType> {
    /** The person suggested: a key of the `people` resource kind. */
    person: Accessor<R, StringType>;
    /** The day suggested, a UTC midnight. */
    day: Accessor<R, DateTimeType>;
    /** The group suggested. */
    group: Accessor<R, StringType>;
    /** The shift suggested. */
    shift: Accessor<R, StringType>;
    /** Why, as the planner reads it. */
    reason: Accessor<R, StringType>;
}

/** An accessor reified over a list's rows, held to the type it returns, refused in the list's words. */
function accessorOf<T extends EastType>(where: string, rowType: EastType, prop: string, out: T, what: string,
    fn: Accessor<EastType, T> | undefined): ExprType<FunctionType<[EastType, StringType], T>> | undefined {
    if (fn === undefined) return undefined;
    return scheduleAccessor(rowType, StringType, out, fn as never,
        (returns) => `${where}: \`${prop}\` returns ${what} — and this one returns ${returns}`) as unknown as ExprType<FunctionType<[EastType, StringType], T>>;
}

/**
 * Reads the app's shift rows as the Roster's shifts (see the module docs).
 *
 * @typeParam R - The app's shift row type
 * @param rows - The shifts by String key, usually `Data.bind(record).read()`
 * @param config - The label, code, start and hours accessors, and an optional order
 * @returns The shifts, declared, for the Roster's `shifts`
 * @throws {Error} When the rows are not a Dict keyed by String, or an accessor returns another type than it takes, naming what it returns
 */
export function rosterShifts<R extends EastType>(rows: ExprType<DictType<StringType, R>>, config: RosterShiftsConfig<R>): RosterShifts {
    const where = "Roster.shifts";
    const { rows: held, rowType } = keyedRows(where, "shifts", rows);
    const c = config as unknown as RosterShiftsConfig<EastType>;
    const label = accessorOf(where, rowType, "label", StringType, "a String, a shift's name", c.label)!;
    const code = accessorOf(where, rowType, "code", StringType, "a String, a shift's code", c.code)!;
    const start = accessorOf(where, rowType, "start", ScheduleClockType, "a Schedule.Types.Clock, when a shift starts in UTC", c.start)!;
    const hours = accessorOf(where, rowType, "hours", FloatType, "a Float, a shift's hours", c.hours)!;
    const order = accessorOf(where, rowType, "order", IntegerType, "an Integer, where a shift shows", c.order);
    const item = East.function([rowType, StringType], RosterShiftType, ($, row, key) => {
        const labelOf = $.const(label);
        const codeOf = $.const(code);
        const startOf = $.const(start);
        const hoursOf = $.const(hours);
        return { key, label: labelOf(row as never, key), code: codeOf(row as never, key), start: startOf(row as never, key), hours: hoursOf(row as never, key) };
    }) as unknown as ExprType<FunctionType<[EastType, StringType], RosterShiftType>>;
    return { [ROSTER_LIST]: "shifts", rows: ordered(held, rowType, RosterShiftType, item, order) };
}

/**
 * Reads the app's group rows as the Roster's groups (see the module docs).
 *
 * @typeParam R - The app's group row type
 * @param rows - The groups by String key, usually `Data.bind(record).read()`
 * @param config - The label accessor, and an optional order
 * @returns The groups, declared, for the Roster's `groups`
 * @throws {Error} When the rows are not a Dict keyed by String, or an accessor returns another type than it takes, naming what it returns
 */
export function rosterGroups<R extends EastType>(rows: ExprType<DictType<StringType, R>>, config: RosterGroupsConfig<R>): RosterGroups {
    const where = "Roster.groups";
    const { rows: held, rowType } = keyedRows(where, "groups", rows);
    const c = config as unknown as RosterGroupsConfig<EastType>;
    const label = accessorOf(where, rowType, "label", StringType, "a String, a group's name", c.label)!;
    const order = accessorOf(where, rowType, "order", IntegerType, "an Integer, where a group shows", c.order);
    const item = East.function([rowType, StringType], RosterGroupType, ($, row, key) => {
        const labelOf = $.const(label);
        return { key, label: labelOf(row as never, key) };
    }) as unknown as ExprType<FunctionType<[EastType, StringType], RosterGroupType>>;
    return { [ROSTER_LIST]: "groups", rows: ordered(held, rowType, RosterGroupType, item, order) };
}

/**
 * Reads the app's position rows as the Roster's positions (see the module
 * docs).
 *
 * @typeParam R - The app's position row type
 * @param rows - The positions by String key, usually `Data.bind(record).read()`
 * @param config - The label, code and lead accessors, and an optional order
 * @returns The positions, declared, for the Roster's `positions`
 * @throws {Error} When the rows are not a Dict keyed by String, or an accessor returns another type than it takes, naming what it returns
 */
export function rosterPositions<R extends EastType>(rows: ExprType<DictType<StringType, R>>, config: RosterPositionsConfig<R>): RosterPositions {
    const where = "Roster.positions";
    const { rows: held, rowType } = keyedRows(where, "positions", rows);
    const c = config as unknown as RosterPositionsConfig<EastType>;
    const label = accessorOf(where, rowType, "label", StringType, "a String, a position's name", c.label)!;
    const code = accessorOf(where, rowType, "code", StringType, "a String, a position's badge", c.code)!;
    const lead = accessorOf(where, rowType, "lead", BooleanType, "a Boolean, whether a position satisfies the lead rule", c.lead)!;
    const order = accessorOf(where, rowType, "order", IntegerType, "an Integer, where a position shows", c.order);
    const item = East.function([rowType, StringType], RosterPositionType, ($, row, key) => {
        const labelOf = $.const(label);
        const codeOf = $.const(code);
        const leadOf = $.const(lead);
        return { key, label: labelOf(row as never, key), code: codeOf(row as never, key), lead: leadOf(row as never, key) };
    }) as unknown as ExprType<FunctionType<[EastType, StringType], RosterPositionType>>;
    return { [ROSTER_LIST]: "positions", rows: ordered(held, rowType, RosterPositionType, item, order) };
}

/**
 * Reads the app's activity rows as the Roster's activities — each group's
 * skills and the duties of none — without changing their identity or
 * ownership (#1342, see the module docs).
 *
 * @typeParam A - The app's activity row type, commonly `Roster.Types.Activity`
 * @param rows - Activities by String key, commonly `Data.bind(record).read()`
 * @param config - The label accessor, and optional code, group and order ones
 * @returns Resolved activities carrying their original record keys, in their order, else in the record's key order
 * @remarks A group's skills are the activities of that group. Coverage and checks read every activity, whatever the slice shows; the Activities tab and the activity choices follow the slice's `activities` source.
 * @throws {Error} When the rows are not a Dict keyed by String, or an accessor returns another type than it takes, naming what it returns
 */
export function rosterActivities<A extends EastType>(rows: ExprType<DictType<StringType, A>>, config: RosterActivitiesConfig<A>): ExprType<ArrayType<RosterSkillType>> {
    const where = "Roster.activities";
    const { rows: held, rowType } = keyedRows(where, "activities", rows);
    const c = config as unknown as RosterActivitiesConfig<EastType>;
    const label = accessorOf(where, rowType, "label", StringType, "a String, an activity's name", c.label)!;
    const code = accessorOf(where, rowType, "code", StringType, "a String, an activity's code", c.code);
    const group = accessorOf(where, rowType, "group", OptionType(StringType), "an Option of a String, the group whose skill it is", c.group);
    const order = accessorOf(where, rowType, "order", IntegerType, "an Integer, where an activity shows", c.order);
    const item = East.function([rowType, StringType], RosterSkillType, ($, row, key) => {
        const labelOf = $.const(label);
        const codeOf = code === undefined ? undefined : $.const(code);
        const groupOf = group === undefined ? undefined : $.const(group);
        return {
            key, label: labelOf(row as never, key),
            code: codeOf === undefined ? "" : codeOf(row as never, key),
            group: groupOf === undefined ? East.value(none, OptionType(StringType)) : groupOf(row as never, key),
        };
    }) as unknown as ExprType<FunctionType<[EastType, StringType], RosterSkillType>>;
    return ordered(held, rowType, RosterSkillType, item, order);
}

/**
 * Reads the app's suggestion rows as the Roster's proposals: a person
 * suggested for a slot, which a planner accepts as a duty or rejects (see the
 * module docs).
 *
 * @typeParam R - The app's suggestion row type
 * @param rows - The suggestions by String key, usually `Data.bind(record).read()`
 * @param config - The person, day, group, shift and reason accessors
 * @returns The proposals, declared, for the Roster's `proposals`, each keyed by its row's key, in key order
 * @remarks A rejection keeps the proposal's key in its week's dismissed set (`Schedule.periods`' `dismissed`).
 * @throws {Error} When the rows are not a Dict keyed by String, or an accessor returns another type than it takes, naming what it returns
 */
export function rosterProposals<R extends EastType>(rows: ExprType<DictType<StringType, R>>, config: RosterProposalsConfig<R>): RosterProposals {
    const where = "Roster.proposals";
    const { rows: held, rowType } = keyedRows(where, "proposals", rows);
    const c = config as unknown as RosterProposalsConfig<EastType>;
    const person = accessorOf(where, rowType, "person", StringType, "a String, the key of the person suggested", c.person)!;
    const day = accessorOf(where, rowType, "day", DateTimeType, "a DateTime, the day suggested", c.day)!;
    const group = accessorOf(where, rowType, "group", StringType, "a String, the group suggested", c.group)!;
    const shift = accessorOf(where, rowType, "shift", StringType, "a String, the shift suggested", c.shift)!;
    const reason = accessorOf(where, rowType, "reason", StringType, "a String, why", c.reason)!;
    const item = East.function([rowType, StringType], RosterProposalType, ($, row, key) => {
        const personOf = $.const(person);
        const dayOf = $.const(day);
        const groupOf = $.const(group);
        const shiftOf = $.const(shift);
        const reasonOf = $.const(reason);
        return {
            key, day: dayOf(row as never, key), group: groupOf(row as never, key), shift: shiftOf(row as never, key),
            person: personOf(row as never, key), reason: reasonOf(row as never, key),
        };
    }) as unknown as ExprType<FunctionType<[EastType, StringType], RosterProposalType>>;
    return { [ROSTER_LIST]: "proposals", rows: ordered(held, rowType, RosterProposalType, item, undefined) };
}

/**
 * Whether a value is a Roster list of the kind given: what a Roster's prop
 * checks before it takes one.
 *
 * @param value - What the app passed
 * @param kind - The list's kind
 * @returns Whether it is that list, declared
 * @internal
 */
export function isRosterList<K extends "shifts" | "groups" | "positions" | "proposals">(value: unknown, kind: K): value is RosterList<K, EastType> {
    return typeof value === "object" && value !== null && (value as { [ROSTER_LIST]?: string })[ROSTER_LIST] === kind;
}
