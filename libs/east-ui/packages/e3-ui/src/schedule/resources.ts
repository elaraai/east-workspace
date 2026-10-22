/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule.resources(source, config)` (#1218, `Calendar Spec.md` §4.2): one
 * resource kind — people, presses, sites — read from any `Dict<K, R>`, usually
 * a record's `read()`, or a window at a time from a paged read of one. A
 * schedule never writes them: their keys are what an event's resource field
 * holds.
 *
 * Plan's options sit beside the Calendar's (#1190, `Plan Builder Spec.md`
 * §4.2): the group strip a resource sits under, the resource of its kind it
 * nests under, its gutter (sub line, value slot and status dot), how a
 * parent's bands roll up and whether it starts folded, and the read-only
 * series under each resource (`measures`). The Calendar takes no notice of
 * them: `build(slot)` is its kind, and `buildPlan(slot)` Plan's.
 *
 * A kind given its resources as a paged read — `Data.bindPaged(record)`, told
 * from a `Dict` by its East type, as the Plan's `data` is (#1199, PB55) — is
 * paged on a Plan as a paged canvas pages its blocks: its rows come a window
 * of resources at a time as the canvas scrolls, the key search seeks a
 * resource by its key, and one resource is read by its key — its name where an
 * event names it — so its resources are never read whole, and the kind on the
 * wire lists none. A window comes in the resources' key order, so a group
 * strip or a parent, which gather resources from anywhere in it, are refused
 * beside one, and the keys are Strings, as the canvas seeks them. The Calendar
 * reads a kind's resources whole, and refuses a paged one.
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
    ArrayType, BooleanType, DictType, East, FloatType, FunctionType, OptionType, SetType, StringType, isTypeEqual, none, printType, some,
    type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { StatusValueType, TimeStepType } from "@elaraai/east-ui";
import { resolveRowSource, resolveTag } from "@elaraai/east-ui/internal";
import { AllocationJobType } from "../allocation/types.js";
import type { PagedValue } from "../bind/data.js";
import { planSeriesFacts, type PlanSeriesValue } from "../plan/series.js";
import { PlanRollupType, type PlanAxisKindLiteral, type PlanRollupLiteral } from "../plan/types.js";
import { scheduleAccessor } from "./accessor.js";
import { PlanResourceRowType, PlanResourcesType, ScheduleResourceRowType, ScheduleResourcesType } from "./types.js";
import { scheduleEntryByKey } from "./window.js";

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
    /** Plan: the group strip a resource sits under (a hall), which the grain folds to its summary. */
    group?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** Plan: the key's text of the resource of its kind it nests under, whose bands roll its events up; `none` at the top. */
    parent?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** Plan: the gutter's sub line. */
    sub?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** Plan: the gutter's value slot. */
    value?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** Plan: the gutter's status dot. */
    status?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StatusValueType>>;
    /** Plan: how a parent's bands roll its children's events up, as `Plan.series.span`'s (`"union"`, the default). */
    rollup?: SubtypeExprOrValue<PlanRollupType> | PlanRollupLiteral;
    /** Plan: whether a resource with resources under it starts folded — a constant, or per resource. */
    collapsed?: boolean | ((row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<BooleanType>);
    /** Plan: the read-only rows under each resource, in order — `Plan.series.heat`, `table` or `chart` over the resources' rows. */
    measures?: readonly PlanSeriesValue<PlanAxisKindLiteral>[];
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
    /** Plan: the read-only series under each resource, in order. */
    readonly measures: readonly PlanSeriesValue<PlanAxisKindLiteral>[];
    /** Plan: the paged read of the resources, its rows a window at a time (#1199); `undefined` when they are read whole. */
    readonly window: ExprType<EastType> | undefined;
    /**
     * Plan: the resources as the kind was given them, a `Dict` of `rowType` by
     * `keyType` — read again where a Plan draws them (#1192); `undefined` for a
     * kind paged a window at a time (#1199), whose resources are never read
     * whole. Its type is erased, as `window`'s is, so a kind of any rows is one
     * of any other.
     */
    readonly source: ExprType<DictType<EastType, EastType>> | undefined;
    /** Plan: one resource as Plan's builder takes it, from its row and key: its label, group, parent and gutter. Erased, as `source` is. */
    readonly planRow: ExprType<FunctionType<[EastType, EastType], PlanResourceRowType>>;
    /** Plan: whether the kind's resources sit under group strips (`group`). */
    readonly grouped: boolean;
    /** Plan: whether a resource may nest under another of its kind (`parent`). */
    readonly nested: boolean;
    /** Plan: how a parent's bands roll its children's events up. */
    readonly rollup: ExprType<PlanRollupType>;
    /** Its accessors, each reified once: what a builder over the app's own records calls per row (#1367). */
    readonly accessors: ScheduleResourceAccessors;
    /**
     * The kind on the wire, under its slot: the Calendar's.
     *
     * @param slot - The builder's slot name for it
     * @returns The kind, its rows resolved
     * @throws {Error} For a kind paged a window at a time (#1199): the Calendar reads its resources whole
     */
    build(slot: string): ExprType<ScheduleResourcesType>;
    /**
     * The kind on the wire as Plan's builder takes it, under its slot.
     *
     * @param slot - The builder's slot name for it
     * @returns The kind, its rows resolved with their groups, parents and gutters
     */
    buildPlan(slot: string): ExprType<PlanResourcesType>;
}

/** The ways a parent rolls up. */
const ROLLUPS: readonly string[] = ["union", "byStatus", "sum"];

/** The kinds of series a measure may be. */
const MEASURES: readonly string[] = ["heat", "table", "chart"];

/** One of a paged kind's resources read by its key's text, as the kind on the wire carries it (#1199). */
const ByKeyType = OptionType(OptionType(PlanResourceRowType));

/** The read of one of a paged kind's resources by its key's text. */
const ByKeyFunctionType = FunctionType([StringType], ByKeyType);

/**
 * Declares a resource kind (see the module docs).
 *
 * @typeParam K - The kind's key type
 * @typeParam R - Its row type
 * @param rows - The resources, keyed: usually a record's `read()`
 * @param config - Its name, its icon, each resource's label and second line, and Plan's options
 * @returns The kind, for a builder's `resources`
 * @throws {Error} When `rows` is not a `Dict`, or a paged read of one (#1199) keyed by anything but a String or
 *   beside `group` or `parent`; a `window`, which is gone; a `rollup` that is not a way to roll up; a measure that
 *   is not a `Plan.series.heat`, `table` or `chart` over the resources' rows written in place, that nests, or whose
 *   key another measure has; and an accessor returning another type than it takes, naming what it returns (#1367)
 * @example
 * ```tsx
 * import { DictType, East, StringType, StructType, some } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Calendar, Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const PressType = StructType({ name: StringType, hall: StringType });
 * const presses = e3.record("presses", DictType(StringType, PressType), new Map());
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
 * @param config - Its name, its icon, each resource's label and second line, and Plan's options but `group` and `parent`
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

    // Plan's: how a parent rolls up, its measures, and the paged read.
    if (typeof config.rollup === "string" && !ROLLUPS.includes(config.rollup)) {
        throw new Error(`${where}: \`rollup\` is "union", "byStatus" or "sum" — and it is "${config.rollup}"`);
    }
    const rollup = resolveTag(config.rollup ?? "union", PlanRollupType);
    const measures = config.measures ?? [];
    const collection = DictType(keyType, rowType);
    const keys = new Set<string>();
    // The measures' keys, in the order the kind lists them.
    const measureKeys: string[] = [];
    measures.forEach((series, i) => {
        const at = `${where}: measures[${i}]`;
        let facts;
        try {
            facts = planSeriesFacts(series, collection, `${where} › measures[${i}]`);
        } catch (err) {
            throw new Error(`${at} is a series over the resources' rows — ${err instanceof Error ? err.message : String(err)}`);
        }
        if (facts === undefined) {
            throw new Error(`${at} is a Plan.series.heat, table or chart written in place — a series bound or stored elsewhere cannot be laid out under each resource`);
        }
        const named = `${facts.arm} "${facts.title}"`;
        if (!MEASURES.includes(facts.arm)) {
            throw new Error(`${at} is a ${named} series — a measure is a heat, table or chart series over the resources' rows`);
        }
        if (facts.nests) {
            throw new Error(`${at}, ${named}, declares \`children\` — a measure is one row under each resource`);
        }
        if (keys.has(facts.key)) {
            throw new Error(`${at}, ${named}, repeats the key "${facts.key}" — a measure row's id is its series' key and its resource's path, so each measure has a key of its own`);
        }
        keys.add(facts.key);
        measureKeys.push(facts.key);
    });
    if (window !== undefined) {
        // A window comes in the resources' key order (#1199): the canvas seeks a resource by its key as text,
        // and a group strip or a parent gathers resources from anywhere in the record.
        if (!isTypeEqual(keyType, StringType)) {
            throw new Error(`${where}: a paged kind's key search seeks a resource by its key, as text — key the resources by String, and these are keyed by ${printType(keyType)}`);
        }
        for (const prop of ["group", "parent"] as const) {
            if (config[prop] !== undefined) {
                throw new Error(`${where}: a paged kind reads its resources a window at a time in their key order, and \`${prop}\` ` +
                    `gathers resources from anywhere in the record, which a window holds only its share of — read the resources whole, or leave \`${prop}\` out`);
            }
        }
    }
    // Plan's accessors.
    const groupOf = accessor("group", StringType, "a String, the group a resource sits under", config.group);
    const parentOf = accessor("parent", optString, "an Option of a String, the key's text of the resource it nests under", config.parent);
    const subOf = accessor("sub", optString, "an Option of a String, the gutter's sub line", config.sub);
    const valueOf = accessor("value", optString, "an Option of a String, the gutter's value slot", config.value);
    const statusOf = accessor("status", OptionType(StatusValueType), "an Option of a StatusValue, the gutter's status dot", config.status);
    const collapsed = config.collapsed;
    const collapsedOf = typeof collapsed === "function" ? accessor("collapsed", BooleanType, "a Boolean, whether a resource starts folded", collapsed) : undefined;
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
    // One resource as Plan's builder takes it.
    const planRow = East.function([rowType, keyType], PlanResourceRowType, ($, row, key) => {
        const keyText = $.const(text as ExprType<FunctionType<[EastType], StringType>>);
        const labelOf = $.const(label);
        const metaOf = $.const(meta);
        // An accessor's value for this row, or `otherwise` when the kind has no such accessor.
        const call = (fn: unknown, otherwise: unknown, wrap?: (value: ExprType<EastType>) => unknown): unknown => {
            if (fn === undefined) return otherwise;
            const bound = $.const(fn as ExprType<FunctionType<[EastType, EastType], EastType>>);
            const value = bound(row as never, key as never) as ExprType<EastType>;
            return wrap === undefined ? value : wrap(value);
        };
        return East.value({
            key: keyText(key),
            label: labelOf(row as never, key as never),
            meta: metaOf(row as never, key as never),
            group: call(groupOf, none, (g) => some(g)),
            parent: call(parentOf, none),
            sub: call(subOf, none),
            value: call(valueOf, none),
            status: call(statusOf, none),
            collapsed: collapsedOf !== undefined ? call(collapsedOf, false) : collapsed === true,
        } as never, PlanResourceRowType);
    });
    // A paged kind's resource by its key's text (#1199): its window's key search, then a one-row page.
    const byKey = window === undefined ? undefined : (() => {
        const find = scheduleEntryByKey(window, keyType, rowType);
        return East.function([StringType], ByKeyType, ($, key) => {
            const read = $.const(find);
            const resolve = $.const(planRow);
            const result = $.let(none, ByKeyType);
            $.match(read(key), {
                held: ($2, row) => { $2.assign(result, some(some(resolve(row as never, key as never)))); },
                absent: ($2) => { $2.assign(result, some(none)); },
            });
            return result;
        });
    })();
    return {
        [SCHEDULE_DEF]: "resources",
        keyType,
        rowType,
        name: config.name,
        icon: config.icon,
        measures,
        window,
        source: source as unknown as ExprType<DictType<EastType, EastType>> | undefined,
        planRow: planRow as unknown as ExprType<FunctionType<[EastType, EastType], PlanResourceRowType>>,
        grouped: config.group !== undefined,
        nested: config.parent !== undefined,
        rollup,
        accessors,
        build(slot: string): ExprType<ScheduleResourcesType> {
            // The Calendar reads a kind's resources whole, and pages none.
            if (source === undefined) {
                throw new Error(`${where}: the Calendar reads a resource kind's resources whole, and this one's are a paged read — ` +
                    "give it the resources as a Dict, usually a record's read()");
            }
            const all = source as unknown as ExprType<DictType<EastType, EastType>>;
            return East.value({
                key: slot,
                name: config.name,
                icon: config.icon,
                rows: all.toArray(($, row, key) => {
                    const labelOf = $.const(label);
                    const metaOf = $.const(meta);
                    const keyText = $.const(text as ExprType<FunctionType<[EastType], StringType>>);
                    return East.value({ key: keyText(key), label: labelOf(row as never, key as never), meta: metaOf(row as never, key as never) }, ScheduleResourceRowType);
                }),
            }, ScheduleResourcesType);
        },
        buildPlan(slot: string): ExprType<PlanResourcesType> {
            return East.value({
                key: slot,
                name: config.name,
                icon: config.icon,
                rollup,
                measures: measureKeys,
                // A paged kind's rows come a window at a time where the Plan draws them (#1199): none here, so
                // the kind on the wire never reads them whole; one is read by its key where it is named.
                rows: source === undefined
                    ? East.value([], ArrayType(PlanResourceRowType))
                    : (source as unknown as ExprType<DictType<EastType, EastType>>).toArray(($, row, key) => {
                        const resolve = $.const(planRow);
                        return resolve(row as never, key as never);
                    }),
                byKey: byKey === undefined ? East.value(none, OptionType(ByKeyFunctionType)) : East.value(some(byKey), OptionType(ByKeyFunctionType)),
            } as never, PlanResourcesType);
        },
    };
}
