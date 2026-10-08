/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule.resources(rows, config)` (#1218, `Calendar Spec.md` §4.2): one
 * resource kind — people, presses, sites — read from any `Dict<K, R>`, usually
 * a record's `read()`. A schedule never writes them: their keys are what an
 * event's resource field holds.
 *
 * Plan's options sit beside the Calendar's (#1190, `Plan Builder Spec.md`
 * §4.2): the group strip a resource sits under, the resource of its kind it
 * nests under, its gutter (sub line, value slot and status dot), how a
 * parent's bands roll up and whether it starts folded, the read-only series
 * under each resource (`measures`), and a paged read of the resources
 * (`window`). The Calendar takes no notice of them: `build(slot)` is its kind,
 * and `buildPlan(slot)` Plan's.
 *
 * A kind given `window` (#1199, PB55) is paged on a Plan as a paged canvas
 * pages its blocks: its rows come a window of resources at a time as the
 * canvas scrolls, and the key search seeks a resource by its key. Its `rows`
 * are then never read — not where the Plan draws them, nor in the kind on the
 * wire, which lists none. A window comes in the resources' key order, so a
 * group strip or a parent, which gather resources from anywhere in it, are
 * refused beside one, and the keys are Strings, as the canvas seeks them.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DictType, East, Expr, OptionType, StringType, isTypeEqual, none, printType, some,
    type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { StatusValueType } from "@elaraai/east-ui";
import { resolveTag } from "@elaraai/east-ui/internal";
import { planSeriesFacts, type PlanSeriesValue } from "../plan/series.js";
import { PlanRollupType, type PlanAxisKindLiteral, type PlanRollupLiteral } from "../plan/types.js";
import { PlanResourceRowType, PlanResourcesType, ScheduleResourceRowType, ScheduleResourcesType } from "./types.js";

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
    /**
     * Plan: the resources a window at a time — `Data.bindPaged(record)` over
     * the resources' record, keyed by String (#1199, PB55): the rows come a
     * window at a time as the canvas scrolls, the key search seeks a resource
     * by its key, and `rows` is never read. Refused beside `group` or
     * `parent`, which gather resources from anywhere in the record.
     */
    window?: unknown;
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
     * `keyType` — read again where a Plan draws them (#1192). Its type is
     * erased, as `window`'s is, so a kind of any rows is one of any other.
     */
    readonly source: ExprType<DictType<EastType, EastType>>;
    /** Plan: one resource as Plan's builder takes it, from its row and key: its label, group, parent and gutter. Erased, as `source` is. */
    readonly planRow: ExprType<FunctionType<[EastType, EastType], PlanResourceRowType>>;
    /** Plan: whether the kind's resources sit under group strips (`group`). */
    readonly grouped: boolean;
    /** Plan: whether a resource may nest under another of its kind (`parent`). */
    readonly nested: boolean;
    /** Plan: how a parent's bands roll its children's events up. */
    readonly rollup: ExprType<PlanRollupType>;
    /**
     * The kind on the wire, under its slot: the Calendar's.
     *
     * @param slot - The builder's slot name for it
     * @returns The kind, its rows resolved
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

/**
 * Declares a resource kind (see the module docs).
 *
 * @typeParam K - The kind's key type
 * @typeParam R - Its row type
 * @param rows - The resources, keyed: usually a record's `read()`
 * @param config - Its name, its icon, each resource's label and second line, and Plan's options
 * @returns The kind, for a builder's `resources`
 * @throws {Error} When `rows` is not a `Dict`; a `rollup` that is not a way to roll up; a measure that is not a
 *   `Plan.series.heat`, `table` or `chart` over the resources' rows written in place, that nests, or whose key
 *   another measure has; and a `window` over another collection, over resources keyed by anything but a String, or
 *   beside `group` or `parent` (#1199)
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
): ScheduleResourceKind<K, R> {
    const where = `Schedule.resources: "${config.name}"`;
    const source = East.value(rows as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict") {
        throw new Error(`Schedule.resources: "${config.name}"'s rows are keyed — a Dict, usually a record's read() — and these are a ${type.type}`);
    }
    const keyType = type.key as K;
    const rowType = type.value as R;
    const optString = OptionType(StringType);
    // Each accessor, one East function, called per row (`shared/reify.ts`'s rule).
    const label = East.function([rowType, keyType], StringType, (_$, row, key) => config.label(row as ExprType<R>, key as ExprType<K>));
    const author = config.meta;
    const meta = East.function([rowType, keyType], optString, (_$, row, key) =>
        author === undefined ? East.value(none, optString) : author(row as ExprType<R>, key as ExprType<K>));
    // A String key is its own text; any other key as East prints it.
    const text = (keyType as EastType).type === "String"
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
    let window: ExprType<EastType> | undefined;
    if (config.window !== undefined) {
        window = East.value(config.window as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const windowType = Expr.type(window as unknown as Expr) as EastType;
        const page = windowType.type === "Struct" ? (windowType.fields as Record<string, EastType>)["page"] : undefined;
        const served = page !== undefined && page.type === "Function" && page.output.type === "Variant"
            ? (page.output.cases as Record<string, EastType>)["some"] : undefined;
        if (served === undefined || !isTypeEqual(served, collection)) {
            throw new Error(`${where}: \`window\` pages the resources — Data.bindPaged(record) over the resources' record — and this one serves ${served === undefined ? "no collection" : printType(served)}`);
        }
        // A window comes in the resources' key order (#1199): the canvas seeks a resource by its key as text,
        // and a group strip or a parent gathers resources from anywhere in the record.
        if (!isTypeEqual(keyType, StringType)) {
            throw new Error(`${where}: \`window\` pages the resources and the key search seeks one by its key, as text — key the resources by String, and these are keyed by ${printType(keyType)}`);
        }
        for (const prop of ["group", "parent"] as const) {
            if (config[prop] !== undefined) {
                throw new Error(`${where}: \`window\` pages the resources a window at a time in their key order, and \`${prop}\` ` +
                    `gathers resources from anywhere in the record, which a window holds only its share of — read the resources whole, or leave \`${prop}\` out`);
            }
        }
    }
    // Plan's accessors, each one East function, called per row.
    const accessor = <T extends EastType>(out: T, fn: ((row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<T>) | undefined) =>
        fn === undefined ? undefined : East.function([rowType, keyType], out, (_$, row, key) => fn(row as ExprType<R>, key as ExprType<K>));
    const groupOf = accessor(StringType, config.group);
    const parentOf = accessor(optString, config.parent);
    const subOf = accessor(optString, config.sub);
    const valueOf = accessor(optString, config.value);
    const statusOf = accessor(OptionType(StatusValueType), config.status);
    const collapsed = config.collapsed;
    const collapsedOf = typeof collapsed === "function" ? accessor(BooleanType, collapsed) : undefined;
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
    return {
        [SCHEDULE_DEF]: "resources",
        keyType,
        rowType,
        name: config.name,
        icon: config.icon,
        measures,
        window,
        source: source as unknown as ExprType<DictType<EastType, EastType>>,
        planRow: planRow as unknown as ExprType<FunctionType<[EastType, EastType], PlanResourceRowType>>,
        grouped: config.group !== undefined,
        nested: config.parent !== undefined,
        rollup,
        build(slot: string): ExprType<ScheduleResourcesType> {
            return East.value({
                key: slot,
                name: config.name,
                icon: config.icon,
                rows: (source as unknown as ExprType<DictType<EastType, EastType>>).toArray(($, row, key) => {
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
                // the kind on the wire never reads them whole.
                rows: window !== undefined
                    ? East.value([], ArrayType(PlanResourceRowType))
                    : (source as unknown as ExprType<DictType<EastType, EastType>>).toArray(($, row, key) => {
                        const resolve = $.const(planRow);
                        return resolve(row as never, key as never);
                    }),
            } as never, PlanResourcesType);
        },
    };
}
