/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule.resources(source, config)` (#1218, `Calendar Spec.md` §4.2): one
 * resource kind — people, presses, sites — read from any `Dict<K, R>`, usually
 * a record's `read()`, or a window at a time from a paged read of one. A
 * schedule never writes them: their keys are what an event's resource field
 * holds. `build(slot)` is the kind as the Calendar takes it.
 *
 * A Plan takes no resource kinds (#1541, U1): its rows are its resources, laid
 * out by `Plan.series.resources` or a case of `Plan.series.kinds`, so the
 * options only a Plan read — `parent`, `sub`, `value`, `status`, `rollup`,
 * `collapsed` and `measures` — are refused by name, naming where each went.
 *
 * A kind given its resources as a paged read — `Data.bindPaged(record)`, told
 * from a `Dict` by its East type (#1199, #1424) — is paged on a Calendar: its
 * timeline's rows and its Resources view's columns come a window of resources
 * at a time, through the Calendar's `paged`, each resource as the Calendar
 * takes it (`calendarRow`), so its resources are never read whole, and the
 * kind on the wire lists none. A window comes in the resources' key order, so
 * a group, which gathers resources from anywhere in it, is refused beside one,
 * and the keys are Strings, as the Calendar seeks them.
 *
 * The builders over the app's own records read their resources through
 * accessors beside Plan's (#1367, `Builder Interfaces Spec.md` §4.2): the
 * Roster's people — a person's position, skills, contract hours, and whether
 * they are an agency's, a trainer or a trainee, and their usual shift — and
 * the Allocation's lanes (`offset`) and resources (`min`, `max`, `note`,
 * `hold`, `jobs`). Each accessor is reified once, held to the type it returns,
 * and the kind carries them all (`accessors`) for its builder to call per row.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DictType, East, FloatType, FunctionType, OptionType, SetType, StringType, isTypeEqual, none, printType,
    type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { TimeStepType } from "@elaraai/east-ui";
import { resolveRowSource } from "@elaraai/east-ui/internal";
import { AllocationJobType } from "../allocation/types.js";
import type { PagedValue } from "../bind/data.js";
import { scheduleAccessor } from "./accessor.js";
import { ScheduleResourceRowType, ScheduleResourcesType } from "./types.js";

/** The key a schedule's definitions carry their sort under. */
export const SCHEDULE_DEF: unique symbol = Symbol("Schedule.def");

/**
 * How a resource kind shows.
 *
 * @typeParam K - The kind's key type
 * @typeParam R - Its row type
 */
export interface ScheduleResourcesConfig<K extends EastType, R extends EastType> {
    /** The kind's name: its column and row headers, the timeline's group, the filter. */
    name: string;
    /** Its Font Awesome icon. */
    icon: string;
    /** A resource's name. */
    label: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** A resource's second line. */
    meta?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The group a resource sits under: the Roster's home group of a person, the Allocation's group of a resource. */
    group?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** The Roster's people: a person's default position, a key of its `positions`. */
    position?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** The Roster's people: the skills a person holds, keys of its `activities`. */
    skills?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<SetType<StringType>>;
    /** The Roster's people: a person's contracted weekly hours. */
    contract?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<FloatType>;
    /** The Roster's people: whether a person is a named agency worker. */
    agency?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<BooleanType>;
    /** The Roster's people: whether a person trains others. */
    trainer?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<BooleanType>;
    /** The Roster's people: whether a person needs a trainer beside them. */
    trainee?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<BooleanType>;
    /** The Roster's people: a person's usual shift, a key of its `shifts`, or none. */
    usual?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The Allocation's lanes: how far past each slot's start a lane's bins are booked (`variant("minutes", 15)`). */
    offset?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<TimeStepType>;
    /** The Allocation's resources: a resource's minimum, in the quantity's unit. The Allocation requires it. */
    min?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<FloatType>;
    /** The Allocation's resources: a resource's maximum, in the quantity's unit. The Allocation requires it. */
    max?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<FloatType>;
    /** The Allocation's resources: a line about a resource's next job. */
    note?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The Allocation's resources: how long a reservation on a resource is checked for, and held while it holds only reservations. */
    hold?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<TimeStepType>;
    /** The Allocation's resources: the other work on a resource. */
    jobs?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<ArrayType<AllocationJobType>>;
}

/** One of a resource kind's accessors, reified: an East function over a resource's row and its key, erased over both. */
export type ScheduleResourceAccessor<T extends EastType> = ExprType<FunctionType<[EastType, EastType], T>>;

/**
 * A resource kind's accessors, each reified once (#1367): what a builder over
 * the app's own records calls per row. One the kind was not given is
 * `undefined`.
 */
export interface ScheduleResourceAccessors {
    /** A resource's name. */
    readonly label: ScheduleResourceAccessor<StringType>;
    /** A resource's second line: `none` for a kind with no `meta`. */
    readonly meta: ScheduleResourceAccessor<OptionType<StringType>>;
    /** The group a resource sits under: a person's home group, a resource's group. */
    readonly group: ScheduleResourceAccessor<StringType> | undefined;
    /** The Roster's people: a person's default position. */
    readonly position: ScheduleResourceAccessor<StringType> | undefined;
    /** The Roster's people: the skills a person holds. */
    readonly skills: ScheduleResourceAccessor<SetType<StringType>> | undefined;
    /** The Roster's people: a person's contracted weekly hours. */
    readonly contract: ScheduleResourceAccessor<FloatType> | undefined;
    /** The Roster's people: whether a person is a named agency worker. */
    readonly agency: ScheduleResourceAccessor<BooleanType> | undefined;
    /** The Roster's people: whether a person trains others. */
    readonly trainer: ScheduleResourceAccessor<BooleanType> | undefined;
    /** The Roster's people: whether a person needs a trainer beside them. */
    readonly trainee: ScheduleResourceAccessor<BooleanType> | undefined;
    /** The Roster's people: a person's usual shift. */
    readonly usual: ScheduleResourceAccessor<OptionType<StringType>> | undefined;
    /** The Allocation's lanes: how far past each slot's start a lane's bins are booked. */
    readonly offset: ScheduleResourceAccessor<TimeStepType> | undefined;
    /** The Allocation's resources: a resource's minimum. */
    readonly min: ScheduleResourceAccessor<FloatType> | undefined;
    /** The Allocation's resources: a resource's maximum. */
    readonly max: ScheduleResourceAccessor<FloatType> | undefined;
    /** The Allocation's resources: a line about a resource's next job. */
    readonly note: ScheduleResourceAccessor<OptionType<StringType>> | undefined;
    /** The Allocation's resources: how long a reservation on a resource is held. */
    readonly hold: ScheduleResourceAccessor<TimeStepType> | undefined;
    /** The Allocation's resources: the other work on a resource. */
    readonly jobs: ScheduleResourceAccessor<ArrayType<AllocationJobType>> | undefined;
}

/**
 * A resource kind, declared: what a builder's `resources` takes, by slot.
 *
 * @typeParam K - The kind's key type
 * @typeParam R - Its row type
 */
export interface ScheduleResourceKind<K extends EastType, R extends EastType> {
    /** What it is. */
    readonly [SCHEDULE_DEF]: "resources";
    /** The kind's key type: what an event's resource field must hold. */
    readonly keyType: K;
    /** Its row type. */
    readonly rowType: R;
    /** Its name. */
    readonly name: string;
    /** Its Font Awesome icon: what a builder's library lists the kind with (#1195). */
    readonly icon: string;
    /** The paged read of the resources, its rows a window at a time (#1424); `undefined` when they are read whole. */
    readonly window: ExprType<EastType> | undefined;
    /**
     * The resources as the kind was given them, a `Dict` of `rowType` by
     * `keyType`; `undefined` for a kind paged a window at a time, whose
     * resources are never read whole. Its type is erased, as `window`'s is, so
     * a kind of any rows is one of any other.
     */
    readonly source: ExprType<DictType<EastType, EastType>> | undefined;
    /** One resource as the Calendar takes it, from its row and key: its key's text, its name and its second line (#1424). Erased, as `source` is. */
    readonly calendarRow: ExprType<FunctionType<[EastType, EastType], ScheduleResourceRowType>>;
    /** Its accessors, each reified once: what a builder over the app's own records calls per row (#1367). */
    readonly accessors: ScheduleResourceAccessors;
    /**
     * The kind on the wire, under its slot: the Calendar's.
     *
     * @param slot - The builder's slot name for it
     * @returns The kind, its rows resolved — none for a kind paged a window at a time (#1424), whose resources come
     *   through the Calendar's `paged`, so the kind on the wire never reads them whole
     */
    build(slot: string): ExprType<ScheduleResourcesType>;
}

/**
 * The options only a Plan read, gone with the Plan's resource kinds (#1541,
 * U1), each with where a Plan takes it now: on the resources series that
 * lays out its rows.
 */
const PLAN_OPTIONS: Readonly<Record<string, string>> = {
    parent: "a tree of them, `children`",
    sub: "`sub`",
    value: "`value`",
    status: "`status`",
    rollup: "`rollup`",
    collapsed: "`collapsed`",
    measures: "`series`, the read-only rows under each resource",
};

/**
 * Declares a resource kind (see the module docs).
 *
 * @typeParam K - The kind's key type
 * @typeParam R - Its row type
 * @param rows - The resources, keyed: usually a record's `read()`
 * @param config - Its name, its icon, each resource's label and second line, and Plan's options
 * @returns The kind, for a builder's `resources`
 * @throws {Error} When `rows` is not a `Dict`, or a paged read of one (#1424) keyed by anything but a String or
 *   beside `group`; a `window`, which is gone; an option only a Plan read, naming where a Plan takes it now (#1541);
 *   and an accessor returning another type than it takes, naming what it returns (#1367)
 * @example
 * ```tsx
 * import { DictType, East, StringType, StructType, some } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Calendar, Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const PressType = StructType({ name: StringType, hall: StringType });
 * const presses = e3.record("presses", DictType(StringType, PressType), { initial: new Map() });
 *
 * // Inside a builder's Reactive body: a row per press, its hall under its name.
 * const press = Schedule.resources(Record.bind(presses, []).read(), {
 *     name: "Presses", icon: "print", label: (p) => p.name, meta: (p) => some(p.hall),
 * });
 * ```
 */
export function scheduleResources<K extends EastType, R extends EastType>(
    rows: ExprType<DictType<K, R>>,
    config: ScheduleResourcesConfig<K, R>,
): ScheduleResourceKind<K, R>;
/**
 * Declares a resource kind paged a window at a time (#1199, see the module
 * docs): its resources a paged read of their record, keyed by String.
 *
 * @typeParam R - Its row type
 * @param rows - The resources, a window at a time: `Data.bindPaged(record)`
 * @param config - Its name, its icon, each resource's label and second line, and the builders' accessors but `group`
 * @returns The kind, for a builder's `resources`
 * @throws {Error} As the whole form does, naming the paged read
 */
export function scheduleResources<R extends EastType>(
    rows: PagedValue<DictType<StringType, R>>,
    config: ScheduleResourcesConfig<StringType, R>,
): ScheduleResourceKind<StringType, R>;
export function scheduleResources(rows: unknown, input: unknown): ScheduleResourceKind<EastType, EastType> {
    const config = input as ScheduleResourcesConfig<EastType, EastType>;
    const where = `Schedule.resources: "${config.name}"`;
    // The options only a Plan read (#1541, U1): a Plan's rows are its resources now, laid out by Plan.series.resources.
    for (const [prop, there] of Object.entries(PLAN_OPTIONS)) {
        if (prop in config) {
            throw new Error(`${where}: \`${prop}\` was the Plan's, and a Plan takes no resource kinds now (#1541) — its rows are its resources: ` +
                `lay them out with Plan.series.resources(Row, { key, title, label, … }), which takes ${there}`);
        }
    }
    // Removed before anything was released with it (#1199): the kind pages when its resources are a paged read.
    if ("window" in config) {
        throw new Error(`${where}: \`window\` is gone — a kind pages when its resources are a paged read: ` +
            "Schedule.resources(Data.bindPaged(record), { … }) in place of Schedule.resources(rows, { window: Data.bindPaged(record) })");
    }
    // A Dict, or a paged read of one, told apart by its East type — as the Plan's `data` is.
    const resolved = resolveRowSource(rows, where);
    const type = resolved.collectionType;
    let source: ExprType<EastType> | undefined;
    let window: ExprType<EastType> | undefined;
    if (resolved.kind === "inline") {
        if (type.type !== "Dict") {
            throw new Error(`${where}'s rows are keyed — a Dict, usually a record's read() — and these are a ${type.type}`);
        }
        source = resolved.rows;
    } else if (resolved.kind === "paged" && type.type === "Dict") {
        window = resolved.source as unknown as ExprType<EastType>;
    } else {
        throw new Error(`${where}: a paged kind reads its resources' own entries a window at a time — Data.bindPaged(record) over ` +
            `the resources' record, a Dict — and this read serves ${resolved.kind === "ordered" ? "an index's window, " : ""}${printType(type)}`);
    }
    const keyType = (type as DictType<EastType, EastType>).key;
    const rowType = (type as DictType<EastType, EastType>).value;
    const optString = OptionType(StringType);
    // Each accessor, one East function, called per row (`shared/reify.ts`'s rule), held to the type it returns (#1367).
    const accessor = <T extends EastType>(prop: string, out: T, what: string,
        fn: ((row: ExprType<EastType>, key: ExprType<EastType>) => SubtypeExprOrValue<NoInfer<T>>) | undefined) =>
        fn === undefined ? undefined
            : scheduleAccessor(rowType, keyType, out, fn, (returns) => `${where}: \`${prop}\` returns ${what} — and this one returns ${returns}`);
    const label = accessor("label", StringType, "a String, a resource's name", config.label)!;
    const meta = accessor("meta", optString, "an Option of a String, a resource's second line", config.meta ?? (() => East.value(none, optString)))!;
    // A String key is its own text; any other key as East prints it.
    const text = keyType.type === "String"
        ? East.function([StringType], StringType, (_$, key) => key)
        : East.function([keyType], StringType, (_$, key) => East.print(key));

    if (window !== undefined) {
        // A window comes in the resources' key order (#1424): the Calendar seeks a resource by its key as text, and a
        // group gathers resources from anywhere in the record.
        if (!isTypeEqual(keyType, StringType)) {
            throw new Error(`${where}: a paged kind's key search seeks a resource by its key, as text — key the resources by String, and these are keyed by ${printType(keyType)}`);
        }
        if (config.group !== undefined) {
            throw new Error(`${where}: a paged kind reads its resources a window at a time in their key order, and \`group\` ` +
                "gathers resources from anywhere in the record, which a window holds only its share of — read the resources whole, or leave `group` out");
        }
    }
    const groupOf = accessor("group", StringType, "a String, the group a resource sits under", config.group);
    // The builders' over the app's own records (#1367): the Roster's people, the Allocation's lanes and resources.
    const accessors: ScheduleResourceAccessors = {
        label,
        meta,
        group: groupOf,
        position: accessor("position", StringType, "a String, a person's default position", config.position),
        skills: accessor("skills", SetType(StringType), "a Set of String, the skills a person holds", config.skills),
        contract: accessor("contract", FloatType, "a Float, a person's contracted weekly hours", config.contract),
        agency: accessor("agency", BooleanType, "a Boolean, whether a person is a named agency worker", config.agency),
        trainer: accessor("trainer", BooleanType, "a Boolean, whether a person trains others", config.trainer),
        trainee: accessor("trainee", BooleanType, "a Boolean, whether a person needs a trainer beside them", config.trainee),
        usual: accessor("usual", optString, "an Option of a String, a person's usual shift", config.usual),
        offset: accessor("offset", TimeStepType, "a TimeStep, how far past each slot's start a lane's bins are booked", config.offset),
        min: accessor("min", FloatType, "a Float, a resource's minimum", config.min),
        max: accessor("max", FloatType, "a Float, a resource's maximum", config.max),
        note: accessor("note", optString, "an Option of a String, a line about a resource's next job", config.note),
        hold: accessor("hold", TimeStepType, "a TimeStep, how long a reservation on a resource is held", config.hold),
        jobs: accessor("jobs", ArrayType(AllocationJobType), "an Array of Allocation.Types.Job, the other work on a resource", config.jobs),
    };
    // One resource as the Calendar takes it (#1424): its key's text, its name and its second line.
    const calendarRow = East.function([rowType, keyType], ScheduleResourceRowType, ($, row, key) => {
        const keyText = $.const(text as ExprType<FunctionType<[EastType], StringType>>);
        const labelOf = $.const(label);
        const metaOf = $.const(meta);
        return East.value({ key: keyText(key), label: labelOf(row as never, key as never), meta: metaOf(row as never, key as never) }, ScheduleResourceRowType);
    });
    return {
        [SCHEDULE_DEF]: "resources",
        keyType,
        rowType,
        name: config.name,
        icon: config.icon,
        window,
        source: source as unknown as ExprType<DictType<EastType, EastType>> | undefined,
        calendarRow: calendarRow as unknown as ExprType<FunctionType<[EastType, EastType], ScheduleResourceRowType>>,
        accessors,
        build(slot: string): ExprType<ScheduleResourcesType> {
            return East.value({
                key: slot,
                name: config.name,
                icon: config.icon,
                // A paged kind's resources come a window at a time where the Calendar draws them (#1424): none here, so the
                // kind on the wire never reads them whole.
                rows: source === undefined
                    ? East.value([], ArrayType(ScheduleResourceRowType))
                    : (source as unknown as ExprType<DictType<EastType, EastType>>).toArray(($, row, key) => {
                        const make = $.const(calendarRow);
                        return make(row as never, key as never);
                    }),
            }, ScheduleResourcesType);
        },
    };
}
