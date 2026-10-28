/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `DecisionQueue.change` (#1450, `Decision Queue Spec.md` §5.3): where each
 * kind of decision draws. A target names its surface, reads the rows its
 * change touches and draws them as their builder does; Apply writes the change
 * through the record's own patch door (Q1), so a record bound read only is
 * refused at build.
 *
 * Every target reads a change the same way: the keys of the rows its patch
 * names, and the rows it leaves from the rows it touches as they stand —
 * East's own `applyPatch`, whose conflict, a row another session moved since
 * the model read it, is the Stale mark (P21). This module holds that reading,
 * the target's declaration and the targets over a record no builder draws — a
 * record's fields, areas in zones, an option's projection; `builder-targets.ts`
 * holds the builders'.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DictType, East, FloatType, OptionType, PatchType, StringType, isTypeEqual, none, some, variant,
    type EastType, type ExprType, type FunctionType, type NullType, type StructType, type SubtypeExprOrValue, type VariantType,
} from "@elaraai/east";
import { Format } from "@elaraai/east-ui";
import { scheduleAccessor, scheduleAccessorOver, scheduleAccessorReturns } from "../schedule/accessor.js";
import { fieldOf, type FieldsOf } from "../schedule/fields.js";
import { scheduleIdOf, scheduleKeyOf, typeText } from "../schedule/window.js";
import { recordBound, recordEntries, recordSide, type RecordBinding, type RecordBound, type RecordSide } from "../utils/record-side.js";
import { DecisionPointType, DecisionTargetKindType, DecisionTargetType, DecisionZoneType } from "./types.js";

// ============================================================================
// The target
// ============================================================================

/** The key a target carries its sort under. */
const TARGET: unique symbol = Symbol("DecisionQueue.target");

/**
 * A target, declared: what the change role's `of` takes for a tag (§5.3).
 *
 * @typeParam D - The record its tags' patches are of, `DictType(K, R)`
 */
export interface DecisionQueueTarget<D extends EastType> {
    /** What it is. */
    readonly [TARGET]: true;
    /** The record its tags' patches are of. */
    readonly recordType: D;
    /** The option's row a projection reads its series from; `undefined` for a target that reads none. */
    readonly optionRow: StructType | undefined;
    /**
     * The target on the wire.
     *
     * @param tags - The tags it serves, in the variant's order
     * @param key - The key its own state is kept under, the queue's: what a builder's target narrows its `source` by
     * @returns The target, closed
     * @throws {Error} As its builder's tag refuses what it was given
     */
    build(tags: readonly string[], key: string): ExprType<typeof DecisionTargetType>;
}

/**
 * Whether something is a target, `DecisionQueue.change.*`'s.
 *
 * @param value - What the change role's `of` gave a tag
 * @returns Whether it is one
 */
export function isDecisionTarget(value: unknown): value is DecisionQueueTarget<EastType> {
    return typeof value === "object" && value !== null && TARGET in value;
}

/** What every target names (D10). */
export interface DecisionTargetNames {
    /** Its surface, the eyebrow's first word (`Roster`, `Pricing`). */
    name: string;
    /** Its Font Awesome solid icon (`users`, `tag`). */
    icon: string;
}

/** A record's patch, as a change's reads read it: the record whole before and after, or an operation per key. */
type RecordPatch = VariantType<{
    unchanged: NullType;
    replace: StructType<{ before: DictType<EastType, EastType>; after: DictType<EastType, EastType> }>;
    patch: DictType<EastType, EastType>;
}>;

/** The rows a change touches or leaves, by their keys' text: `none` for a row the record lacks, or one the change deletes. */
const ChangedRows = DictType(StringType, OptionType(BlobType));

/**
 * How a change reads against a record `Dict<K, R>` (see the module docs): the
 * keys of the rows its patch names, and the rows it leaves.
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @returns `touched`, `(bytes)` → the keys' text; `apply`, `(bytes, rows)` → the rows it leaves, `none` where it no
 *   longer applies to them
 */
function changeReads(keyType: EastType, rowType: StructType) {
    const recordType = DictType(keyType, rowType);
    const patchType = PatchType(recordType);
    const idOf = scheduleIdOf(keyType);
    const keyOf = scheduleKeyOf(keyType);
    const Ids = ArrayType(StringType);
    // The keys a patch names: a replace's rows before and after, or the key of each of its operations.
    const touched = East.function([BlobType], Ids, ($, bytes) => {
        const text = $.const(idOf);
        const patch = $.const(bytes.decodeBeast(patchType, "v2") as unknown as ExprType<RecordPatch>);
        const ids = $.let([], Ids);
        $.match(patch, {
            replace: ($2, both) => { $2.assign(ids, both.before.keys().union(both.after.keys()).toArray(($3, key) => text(key))); },
            patch: ($2, operations) => { $2.assign(ids, operations.keys().toArray(($3, key) => text(key))); },
        });
        return ids;
    });
    // The rows a patch leaves, from the rows it touches as they stand.
    const apply = East.function([BlobType, ChangedRows], OptionType(ChangedRows), ($, bytes, rows) => {
        const parse = $.const(keyOf);
        const patch = $.const(bytes.decodeBeast(patchType, "v2") as unknown as ExprType<RecordPatch>);
        // The rows as they stand, keyed as the record is: what the patch applies to.
        const standing = $.let(new Map(), DictType(keyType, rowType) as DictType<EastType, EastType>);
        $.for(rows, ($2, row, id) => {
            $2.match(row, { some: ($3, held) => { $3(standing.insert(parse(id), held.decodeBeast(rowType, "v2") as ExprType<EastType>)); } });
        });
        const result = $.let(none, OptionType(ChangedRows));
        $.try(($2) => {
            const after = $2.const(East.applyPatch(standing, patch as never) as unknown as ExprType<DictType<EastType, EastType>>);
            // Each row it touches, as it leaves it: none for one it deletes.
            $2.assign(result, some(rows.map(($3, _row, id) => after.tryGet(parse(id)).match({
                some: (_$4, row) => East.value(some(East.Blob.encodeBeast(row, "v2")), OptionType(BlobType)),
                none: (_$4) => East.value(none, OptionType(BlobType)),
            }))));
        }).catch(($2, _message) => {
            // It no longer applies to the rows as they stand — another session moved one since the model read it: the
            // Stale mark (P21).
            $2.assign(result, none);
        });
        return result;
    });
    return { touched, apply };
}

/**
 * A target's role read from its record's row and its key (§5.3), reified once
 * and held to its type, on the wire over the row's bytes and its key's text.
 *
 * @internal
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param where - The target, as a refusal names it
 * @param name - The role
 * @param out - The type it takes
 * @param takes - The type it takes, as the refusals say it
 * @param fn - The author's accessor, `(row, key) => …`
 * @param required - Whether the target needs it
 * @returns `(bytes, id)` → the role's value; `undefined` for a role not given
 * @throws {Error} Naming the role: one required and not given, one that is no function, or one returning another type
 */
export function decisionTargetRole<T extends EastType>(
    keyType: EastType, rowType: StructType, where: string, name: string, out: T, takes: string, fn: unknown, required: boolean,
): ExprType<FunctionType<[BlobType, StringType], T>> | undefined {
    if (fn === undefined) {
        if (required) throw new Error(`${where}: \`${name}\` is required — an East function reading ${takes} from the row`);
        return undefined;
    }
    if (typeof fn !== "function") {
        throw new Error(`${where}: \`${name}\` is an East function over the row and its key — ${name}: (row) => row.field — and it takes ${takes}`);
    }
    const read = scheduleAccessor(rowType, keyType, out as EastType, fn as (row: ExprType<EastType>, key: ExprType<EastType>) => SubtypeExprOrValue<EastType>,
        (returns) => `${where}: \`${name}\` returns ${returns} — it takes ${takes}`);
    const keyOf = scheduleKeyOf(keyType);
    return East.function([BlobType, StringType], out as EastType, ($, bytes, id) => {
        const role = $.const(read);
        const parse = $.const(keyOf);
        return role(bytes.decodeBeast(rowType, "v2") as ExprType<EastType>, parse(id)) as ExprType<EastType>;
    }) as unknown as ExprType<FunctionType<[BlobType, StringType], T>>;
}

/**
 * Declares a target (see the module docs): its names checked, how a change
 * reads against its record, and the build of where it draws.
 *
 * @internal
 * @typeParam D - The record its tags' patches are of
 * @param where - The target, as a refusal names it
 * @param names - What the author gave: its `name` and `icon` among the rest
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param locked - The Locked mark's read (`decisionTargetRole`); `undefined`, never locked
 * @param optionRow - The option's row a projection reads its series from; `undefined` for a target that reads none
 * @param kind - Where it draws, on the wire, given the key its own state is kept under
 * @returns The target
 * @throws {Error} When `name` or `icon` is no text
 */
export function decisionTarget<D extends EastType>(
    where: string,
    names: Partial<DecisionTargetNames> | undefined,
    keyType: EastType,
    rowType: StructType,
    locked: ExprType<FunctionType<[BlobType, StringType], BooleanType>> | undefined,
    optionRow: StructType | undefined,
    kind: (key: string) => ExprType<typeof DecisionTargetKindType>,
): DecisionQueueTarget<D> {
    const name = names?.name;
    const icon = names?.icon;
    if (typeof name !== "string" || name === "") {
        throw new Error(`${where}: \`name\` names the target's surface, the eyebrow's first word — name: "Roster"`);
    }
    if (typeof icon !== "string" || icon === "") {
        throw new Error(`${where}: \`icon\` names its Font Awesome solid icon — icon: "users"`);
    }
    const { touched, apply } = changeReads(keyType, rowType);
    return {
        [TARGET]: true,
        recordType: DictType(keyType, rowType) as unknown as D,
        optionRow,
        build(tags, key) {
            return East.value({
                tags: [...tags],
                name,
                icon,
                touched,
                apply,
                locked: locked === undefined ? none : some(locked),
                kind: kind(key),
            } as never, DecisionTargetType) as ExprType<typeof DecisionTargetType>;
        },
    };
}

// ============================================================================
// A record no builder draws
// ============================================================================

/** An accessor of a row and its key: what a target's read role is. */
type Accessor<R extends StructType, T extends EastType> = (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<T>;

/** East's value format: east-ui's `Format`. */
type TickFormat = typeof Format.Types.Tick;

/**
 * A record target's record, bound with its patch door: Apply writes a change
 * through it (Q1).
 *
 * @param binding - What the target was given
 * @param where - The target, as a refusal names it
 * @returns The binding
 * @throws {Error} As `recordBound` refuses, and for a record bound read only, naming the binding to use
 */
function editableOf(binding: unknown, where: string): RecordBound {
    const bound = recordBound(binding, where, "a target's record holds its rows by String key, each a struct");
    if (bound.form !== "record") {
        throw new Error(`${where}: the record is bound read only — Apply writes a change through its patch door: bind it ` +
            "Record.bind(record, [e3.mutation.patch(record)])");
    }
    return bound;
}

/**
 * A record read whole, each row as bytes.
 *
 * @param bound - The record's binding, `Record.bind`'s
 * @returns `()` → its rows, by key
 */
function wholeRows(bound: RecordBound): ExprType<FunctionType<[], OptionType<DictType<StringType, BlobType>>>> {
    const readAll = (bound.handle as unknown as Record<string, unknown>)["read"] as () => ExprType<DictType<StringType, EastType>>;
    return East.function([], OptionType(DictType(StringType, BlobType)), ($) => {
        const held = $.const(readAll());
        return East.value(some(held.map(($2, row) => East.Blob.encodeBeast(row, "v2"))), OptionType(DictType(StringType, BlobType)));
    });
}

/**
 * A record target's own (§5.3): its names, the row's words and figure, the
 * field it groups by, the Locked mark, and its form — east-ui's `Fields`
 * hints, a `ready` and an `inspector`, as an event kind takes them — which
 * Modify uses (D9).
 *
 * @typeParam R - The record's row type
 */
export interface DecisionRecordTargetConfig<R extends StructType> extends RecordSide<R>, DecisionTargetNames {
    /** A row's words in the preview (`r => r.region`); its key by default. */
    label?: Accessor<R, StringType>;
    /** A row's figure: with it and at most five rows, the mix — a row per key on a shared axis. */
    measure?: Accessor<R, FloatType>;
    /** The String field a row's group is: with it, the groups — a row per group, each one's size before → after. */
    group?: FieldsOf<R, StringType>;
    /** Whether a row is locked: the Locked mark. */
    locked?: Accessor<R, BooleanType>;
}

/**
 * Declares a target over a record no builder draws (§5.3): up to two rows'
 * changed fields; with `measure`, the mix; with `group`, the groups. Modify
 * edits a row in its own form — `fields`, `ready` and `inspector` — and Apply
 * writes the change through the record's patch door.
 *
 * @typeParam R - The record's row type, from the binding
 * @param binding - The record, `Record.bind(record, [e3.mutation.patch(record)])`, a `Dict<String, R>`
 * @param config - Its names, roles and form, and `entries` — `Data.bindPaged(record)` — to read the touched rows by key
 *   rather than the record whole
 * @returns The target, for the change role's `of`
 * @throws {Error} Naming what to give: a record bound read only or without its patch door, `entries` that are no paged
 *   read of its own entries, a role that is no function or returns another type, `group` naming no String field or
 *   given beside `entries`, `name` or `icon` no text, and the form's hints and inspector as an event kind refuses them
 *
 * @example
 * ```tsx
 * const priceList = $.let(Record.bind(listPrices, [listPricesPatch]));
 * const pricingChange = DecisionQueue.change.record(priceList, {
 *     name: "Pricing", icon: "tag", label: r => r.region,
 *     fields: { price: Fields.number({ label: "List price", unit: "$ / unit", min: 10.0, max: 12.5, step: 0.05 }) },
 * });
 * ```
 */
export function decisionQueueRecordTarget<R extends StructType>(
    binding: RecordBinding<R>, config: DecisionRecordTargetConfig<R>,
): DecisionQueueTarget<DictType<StringType, R>> {
    const where = "DecisionQueue.change.record";
    const given = (config ?? {}) as unknown as DecisionRecordTargetConfig<StructType>;
    const bound = editableOf(binding, where);
    const rowType = bound.rowType;
    const entries = recordEntries(bound, given.entries, where);
    const role = <T extends EastType>(name: string, out: T, takes: string, fn: unknown) =>
        decisionTargetRole(StringType, rowType, where, name, out, takes, fn, false);
    const label = role("label", StringType, "a String", given.label);
    const measure = role("measure", FloatType, "a Float", given.measure);
    const locked = role("locked", BooleanType, "a Boolean", given.locked);
    let group: { field: string; of: ExprType<FunctionType<[BlobType, StringType], StringType>> } | undefined;
    if (given.group !== undefined) {
        const field = given.group as string;
        const type = (rowType.fields as Record<string, EastType>)[field];
        if (type === undefined || !isTypeEqual(type, StringType)) {
            throw new Error(`${where}: \`group\` names a String field of the row, as a rail's fields do — and "${field}" ` +
                `${type === undefined ? "is no field of it" : `holds ${typeText(type)}`}`);
        }
        if (entries !== undefined) {
            throw new Error(`${where}: \`group\` counts each group's rows over the record read whole — leave \`entries\` out to read it whole`);
        }
        group = { field, of: East.function([BlobType, StringType], StringType, (_$, bytes) => fieldOf(bytes.decodeBeast(rowType, "v2"), field) as ExprType<StringType>) };
    }
    // Its form and its session: read by key through `entries`, or whole.
    const side = recordSide(bound, entries, entries, given, [], where);
    const rows = entries === undefined ? wholeRows(bound) : undefined;
    return decisionTarget(where, given, StringType, rowType, locked, undefined, () => East.value(variant("record", {
        ...side,
        rows: rows === undefined ? none : some(rows),
        label: label === undefined ? none : some(label),
        measure: measure === undefined ? none : some(measure),
        group: group === undefined ? none : some(group),
    }) as never, DecisionTargetKindType) as ExprType<typeof DecisionTargetKindType>);
}

// ============================================================================
// Areas in zones
// ============================================================================

/**
 * A zones target's own (§5.3): its names, each area's zone and place on the
 * grid, whether it is a depot, and the zones.
 *
 * @typeParam R - The record's row type
 */
export interface DecisionZonesTargetConfig<R extends StructType> extends DecisionTargetNames {
    /** The key of the zone an area is in, one of `zones`' keys. */
    zone: Accessor<R, StringType>;
    /** Its column on the grid. */
    x: Accessor<R, FloatType>;
    /** Its row on the grid. */
    y: Accessor<R, FloatType>;
    /** Whether it is a depot: drawn as a dot. */
    depot?: Accessor<R, BooleanType>;
    /** The zones, the app's list: each one's key, its name in the key and its fill, a theme colour token. */
    zones: SubtypeExprOrValue<ArrayType<typeof DecisionZoneType>>;
}

/**
 * Declares a target over areas on a grid, each in a zone (§5.3): every area
 * of the record as a tile by its `x` and `y`, filled by its zone, the changed
 * ones in their new zone's fill, and each zone's count before → after. No
 * builder draws zones; the record is read whole.
 *
 * @typeParam R - The record's row type, from the binding
 * @param binding - The areas, `Record.bind(record, [e3.mutation.patch(record)])`, a `Dict<String, R>`
 * @param config - Its names and roles, and the zones
 * @returns The target, for the change role's `of`
 * @throws {Error} Naming what to give: a record bound read only or without its patch door, a role left out, that is no
 *   function or returns another type, `zones` that are no list of zones, and `name` or `icon` no text
 *
 * @example
 * ```tsx
 * const areas = $.let(Record.bind(yardAreas, [yardAreasPatch]));
 * const layoutChange = DecisionQueue.change.zones(areas, {
 *     name: "Layout", icon: "map", zone: a => a.zone, x: a => a.column, y: a => a.row, depot: a => a.depot,
 *     zones: [
 *         { key: "fast", label: "Fast movers", color: Style.ColorToken("teal", "500") },
 *         { key: "bulk", label: "Bulk", color: Style.ColorToken("orange", "500") },
 *     ],
 * });
 * ```
 */
export function decisionQueueZonesTarget<R extends StructType>(
    binding: RecordBinding<R>, config: DecisionZonesTargetConfig<R>,
): DecisionQueueTarget<DictType<StringType, R>> {
    const where = "DecisionQueue.change.zones";
    const given = (config ?? {}) as Partial<DecisionZonesTargetConfig<StructType>>;
    const bound = editableOf(binding, where);
    const rowType = bound.rowType;
    const role = <T extends EastType>(name: string, out: T, takes: string, fn: unknown, required: boolean) =>
        decisionTargetRole(StringType, rowType, where, name, out, takes, fn, required)!;
    const zone = role("zone", StringType, "a String, the key of one of `zones`", given.zone, true);
    const x = role("x", FloatType, "a Float", given.x, true);
    const y = role("y", FloatType, "a Float", given.y, true);
    const depot = given.depot === undefined ? undefined : role("depot", BooleanType, "a Boolean", given.depot, false);
    const zonesWords = `${where}: \`zones\` is the app's list of zones — each { key, label, color }, color a theme colour token ` +
        "(Style.ColorToken(\"teal\", \"500\"))";
    if (given.zones === undefined) throw new Error(zonesWords);
    let zones: ExprType<ArrayType<typeof DecisionZoneType>>;
    try {
        zones = East.value(given.zones, ArrayType(DecisionZoneType));
    } catch (err) {
        throw new Error(`${zonesWords} — ${(err as Error).message}`);
    }
    const side = recordSide(bound, undefined, undefined, {}, [], where);
    const rows = wholeRows(bound);
    return decisionTarget(where, given, StringType, rowType, undefined, undefined, () => East.value(variant("zones", {
        ...side,
        rows,
        zone,
        x,
        y,
        depot: depot === undefined ? none : some(depot),
        zones,
    }) as never, DecisionTargetKindType) as ExprType<typeof DecisionTargetKindType>);
}

// ============================================================================
// An option's projection
// ============================================================================

/**
 * A projection target's own (§5.3): its names, the option's row type and the
 * series it gives, each point's place, the limit and how values print.
 *
 * @typeParam O - The option's row type
 * @typeParam P - A point of its series
 */
export interface DecisionProjectionTargetConfig<O extends StructType, P extends StructType> extends DecisionTargetNames {
    /** The option's row type — the options' of the cases whose tags this target serves: what `points` reads. */
    option: O;
    /** The series an option gives (`o => o.forecast`). */
    points: (option: ExprType<O>) => SubtypeExprOrValue<ArrayType<P>>;
    /** A point's place along the plot. */
    x: (point: ExprType<P>) => SubtypeExprOrValue<FloatType>;
    /** A point's place up the plot. */
    y: (point: ExprType<P>) => SubtypeExprOrValue<FloatType>;
    /** The limit: a dashed warn rule at `y` over its wash, `label` its words. */
    limit?: { y: number; label: string };
    /** How values print, east-ui's `Format`; plain numbers by default. */
    format?: SubtypeExprOrValue<TickFormat>;
}

/**
 * Declares a target that draws an option's own series (§5.3): a line per
 * option, the chosen one glowing, the option that changes nothing a dashed
 * ghost, and the limit a dashed rule. It reads nothing of the record; Apply
 * writes the change through the record's patch door.
 *
 * @typeParam R - The record's row type, from the binding
 * @typeParam O - The option's row type
 * @typeParam P - A point of its series
 * @param binding - The record its tags' patches are of, `Record.bind(record, [e3.mutation.patch(record)])`
 * @param config - Its names, the option's row type, the series' roles, the limit and the format
 * @returns The target, for the change role's `of`
 * @throws {Error} Naming what to give: a record bound read only or without its patch door, `option` no struct type,
 *   `points` returning no Array of structs, `x` or `y` left out or returning no Float, and `name` or `icon` no text
 *
 * @example
 * ```tsx
 * const orders = $.let(Record.bind(stockOrders, [stockOrdersPatch]));
 * const reorderChange = DecisionQueue.change.projection(orders, {
 *     name: "Stock", icon: "chart-line", option: OpsOption,
 *     points: o => o.forecast, x: p => p.week, y: p => p.units,
 *     limit: { y: 120.0, label: "Reorder point" },
 * });
 * ```
 */
export function decisionQueueProjectionTarget<R extends StructType, O extends StructType, P extends StructType>(
    binding: RecordBinding<R>, config: DecisionProjectionTargetConfig<O, P>,
): DecisionQueueTarget<DictType<StringType, R>> {
    const where = "DecisionQueue.change.projection";
    const given = (config ?? {}) as unknown as Partial<DecisionProjectionTargetConfig<StructType, StructType>>;
    const bound = editableOf(binding, where);
    const optionRow = given.option;
    if (optionRow === undefined || typeof optionRow !== "object" || optionRow.type !== "Struct") {
        throw new Error(`${where}: \`option\` is the option's row type — the struct the cases' options are, option: OpsOption — which \`points\` reads`);
    }
    if (typeof given.points !== "function") {
        throw new Error(`${where}: \`points\` is an East function over the option — points: (o) => o.forecast — and it takes an Array of the series' points`);
    }
    const points = given.points as (...args: ExprType<EastType>[]) => SubtypeExprOrValue<EastType>;
    const series = scheduleAccessorReturns([optionRow], points);
    if (series.type !== "Array" || (series.value as EastType).type !== "Struct") {
        throw new Error(`${where}: \`points\` returns ${typeText(series)} — it takes an Array of the series' points, each a struct`);
    }
    const pointType = series.value as StructType;
    const pointsOf = scheduleAccessorOver([optionRow], series, points, (returns) => `${where}: \`points\` returns ${returns}`);
    const placeOf = (name: "x" | "y") => {
        const fn = given[name];
        if (typeof fn !== "function") {
            throw new Error(`${where}: \`${name}\` is an East function over a point — ${name}: (p) => p.field — and it takes a Float`);
        }
        return scheduleAccessorOver([pointType], FloatType, fn as (...args: ExprType<EastType>[]) => SubtypeExprOrValue<FloatType>,
            (returns) => `${where}: \`${name}\` returns ${returns} — it takes a Float`);
    };
    const xOf = placeOf("x");
    const yOf = placeOf("y");
    const read = East.function([BlobType], ArrayType(DecisionPointType), ($, bytes) => {
        const pointsRead = $.const(pointsOf);
        const across = $.const(xOf);
        const up = $.const(yOf);
        const option = $.const(bytes.decodeBeast(optionRow, "v2") as ExprType<EastType>);
        const plotted = $.const(pointsRead(option) as unknown as ExprType<ArrayType<EastType>>);
        return plotted.map(($2, point) => East.value({ x: across(point), y: up(point) } as never, DecisionPointType));
    });
    const limit = given.limit;
    if (limit !== undefined && (typeof limit.y !== "number" || typeof limit.label !== "string")) {
        throw new Error(`${where}: \`limit\` is { y, label } — the rule's place up the plot, a number, and its words`);
    }
    const format = given.format === undefined ? undefined : East.value(given.format, Format.Types.Tick);
    const side = recordSide(bound, undefined, undefined, {}, [], where);
    return decisionTarget(where, given, StringType, bound.rowType, undefined, optionRow, () => East.value(variant("projection", {
        ...side,
        points: read,
        limit: limit === undefined ? none : some({ y: limit.y, label: limit.label }),
        format: format === undefined ? none : some(format),
    }) as never, DecisionTargetKindType) as ExprType<typeof DecisionTargetKindType>);
}
