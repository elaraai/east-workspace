/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.register` and `Sheet.driver` — registers are the grammar's
 * vocabulary, projected from the host's rows through accessors reified once
 * (Plan's `derive` move, `Sheet Spec.md` §3.3). There is no attribute bag:
 * a value another declaration needs is read off a TYPED row by an accessor.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    ArrayType,
    DictType,
    FunctionType,
    OptionType,
    SetType,
    StringType,
    StructType,
    none,
} from "@elaraai/east";

import { StatusValueType } from "../../feedback/status/types.js";
import { SheetRegisterMemberType } from "./types.js";
import { SheetRegisterMembersType } from "./link.js";

/** A built register — its members, as an expression. What `Sheet.register.*` returns and `registers={…}` takes. */
export type SheetRegisterValue = ExprType<ArrayType<SheetRegisterMemberType>>;

/**
 * The accessors `Sheet.register.members` reifies over one data ENTRY — its
 * value and its key (`(_v, k) => k` is the normal spelling over a `Dict`;
 * over an `Array` the key is the index, printed).
 *
 * @typeParam T - The data's element type
 * @property kind - The member kind (`"machine"`, `"line"`, `"family"`)
 * @property key - What the grammar resolves — accessor
 * @property label - What a chip prints — accessor
 * @property aliases - Alternative spellings — accessor returning the field's array
 * @property meta - Chip meta — accessor returning the field's `Option`
 * @property parent - The parent key — accessor returning the field's `Option`
 * @property tone - An `enum` member's valence — accessor returning the field's `Option`
 */
export interface SheetMembersConfig<T extends EastType> {
    /** The member kind. */
    kind: string;
    /** What the grammar resolves. */
    key: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** What a chip prints. */
    label: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** Alternative spellings the grammar also resolves. */
    aliases?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<ArrayType<StringType>>;
    /** Chip meta — return the field's `Option`. */
    meta?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The parent key — return the field's `Option`. */
    parent?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The valence dot — return the field's `Option`. */
    tone?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StatusValueType>>;
}

/** Fold duplicate keys, keeping the FIRST occurrence in declaration order. */
const dedupeMembers = East.function([SheetRegisterMembersType], SheetRegisterMembersType, ($, ms) => {
    const out = $.let([], SheetRegisterMembersType);
    const seen = $.let(new Set<string>(), SetType(StringType));
    $.for(ms, ($2, m, _i, _label) => {
        $2.if(seen.has(m.key).not(), ($3) => {
            $3(seen.insert(m.key));
            $3(out.pushLast(m));
        });
    });
    return out;
});

/**
 * Projects the host's rows into register members — `Sheet.register.members`.
 *
 * @remarks
 * The accessors are reified ONCE into a describe function which the map
 * then CALLS (`shared/reify.ts`, `EAST_UI_PROP_PATTERNS.md`). Duplicate keys
 * fold, first occurrence wins — a countable-by-attribute kind (`"CNC lathe"`
 * from every machine of that family) declares one member per distinct value.
 *
 * @typeParam T - The data's element type
 * @param data - The rows — an `Array<T>` or a `Dict<String, T>` value or expression
 * @param config - The accessors ({@link SheetMembersConfig})
 * @returns The members, as an expression
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Reactive, Sheet, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const JobType = StructType({
 *             id: StringType, activity: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType),
 *             qty: OptionType(FloatType), machines: Sheet.Types.Link,
 *         });
 *         const ActivityType = StructType({ name: StringType, uom: StringType, days: IntegerType });
 *         const MachineType = StructType({ code: StringType, family: StringType, line: StringType });
 *         const LineType = StructType({ name: StringType, aliases: ArrayType(StringType) });
 *         const activities = $.const([
 *             { name: "Machining", uom: "pcs", days: 4n },
 *             { name: "Inspection", uom: "lots", days: 1n },
 *         ], ArrayType(ActivityType));
 *         const machines = $.const([
 *             { code: "M2140", family: "CNC lathe", line: "L2" },
 *             { code: "M2141", family: "CNC lathe", line: "L2" },
 *             { code: "M3210", family: "5-axis mill", line: "L3" },
 *         ], ArrayType(MachineType));
 *         const lines = $.const(new Map([
 *             ["L2", { name: "Line 2", aliases: ["l2", "line 2"] }],
 *             ["L3", { name: "Line 3", aliases: ["l3", "line 3"] }],
 *         ]), DictType(StringType, LineType));
 *         const jobs = $.let(State.bind([ArrayType(JobType)], "sheet_registers_jobs", [
 *             { id: "j1", activity: "Machining", start: some(new Date("2026-02-16T00:00:00Z")), end: none, qty: some(1200.0),
 *               machines: { from: [], to: [variant("counted", { n: 2n, key: "CNC lathe" })] } },
 *         ]));
 *         // The driver's row reaches a fill typed: End = Start + the activity's days.
 *         const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
 *         const endFromStart = $.const(East.function([Sheet.Types.DraftContext(JobType, ActivityType)], DateFill, ($, ctx) => {
 *             const noFill = $.const(none, DateFill);
 *             return ctx.row.start.match({
 *                 value: (_$, supplied) => supplied.match({
 *                     none: () => noFill,
 *                     some: (_$, start) => ctx.driver.match({
 *                         none: () => noFill,
 *                         some: (_$, d) => some({ value: start.addDays(d.days), meta: East.str`+${d.days}d · ${d.name}` }),
 *                     }),
 *                 }),
 *             }, () => noFill);
 *         }));
 *         const newJob = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(JobType), () => Sheet.patch(JobType, { machines: { from: [], to: [] } })));
 *         return (
 *             <Sheet
 *                 data={jobs}
 *                 id="id"
 *                 driver={Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name, meta: a => some(a.uom) })}
 *                 registers={{
 *                     machines: Sheet.register.concat([
 *                         Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code,
 *                             meta: m => some(m.family), parent: m => some(m.line) }),
 *                         // A Dict's key rides as the accessors' second argument.
 *                         Sheet.register.members(lines, { kind: "line", key: (_l, code) => code, label: l => l.name, aliases: l => l.aliases }),
 *                         // Both lathes name one family — duplicate keys fold, the first wins.
 *                         Sheet.register.members(machines, { kind: "family", key: m => m.family, label: m => m.family, meta: _m => some("family") }),
 *                     ]),
 *                 }}
 *                 columns={{
 *                     activity: Sheet.column.lookup(JobType, { header: "Activity", width: "140px" }),
 *                     start:    Sheet.column.date(JobType, { header: "Start", width: "96px" }),
 *                     end:      Sheet.column.date(JobType, { header: "End", sub: "start + days", width: "96px", base: "start", fill: [endFromStart] }),
 *                     qty:      Sheet.column.quantity(JobType, ActivityType, { header: "Qty", sub: "uom per activity", width: "112px", uom: d => d.uom }),
 *                     machines: Sheet.column.set(JobType, "machines", { header: "Machines", sub: "M2140 · 2 x lathe · line 2", width: "240px",
 *                                   members: [{ kind: "machine", identified: true }, { kind: "line", countable: true, resolvesTo: "machine" },
 *                                             { kind: "family", countable: true, resolvesTo: "machine" }] }),
 *                 }}
 *                 newRow={newJob}
 *                 onUpdate={jobs.write}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function createMembers<T extends EastType>(
    data: SubtypeExprOrValue<ArrayType<T>> | SubtypeExprOrValue<DictType<StringType, T>>,
    config: SheetMembersConfig<T>,
): SheetRegisterValue {
    const expr = East.value(data as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    const t = Expr.type(expr) as { type: string; value?: EastType; key?: EastType };
    if (t.type !== "Array" && t.type !== "Dict") {
        throw new Error(`Sheet.register.members: data must be an Array or a Dict<String, T> — got a ${t.type}`);
    }
    if (t.type === "Dict" && (t.key as { type: string }).type !== "String") {
        throw new Error("Sheet.register.members: a keyed register must be a Dict<String, T> — its keys ride to the accessors as the second argument");
    }
    const elem = t.value as EastType;
    const cfg = config as unknown as SheetMembersConfig<EastType>;
    const describe = East.function([elem, StringType], SheetRegisterMemberType, (_$, v, k) => ({
        key:     cfg.key(v, k),
        label:   cfg.label(v, k),
        kind:    cfg.kind,
        aliases: cfg.aliases !== undefined ? cfg.aliases(v, k) : East.value([], ArrayType(StringType)),
        meta:    cfg.meta !== undefined ? cfg.meta(v, k) : East.value(none, OptionType(StringType)),
        parent:  cfg.parent !== undefined ? cfg.parent(v, k) : East.value(none, OptionType(StringType)),
        tone:    cfg.tone !== undefined ? cfg.tone(v, k) : East.value(none, OptionType(StatusValueType)),
    }));
    const list = t.type === "Dict"
        ? (expr as unknown as ExprType<DictType<StringType, EastType>>).toArray((_$, v, k) => describe(v, k))
        : expr.map((_$, v, i) => describe(v, East.print(i)));
    return dedupeMembers(list as ExprType<ArrayType<SheetRegisterMemberType>>);
}

/**
 * Joins member sets of different kinds into one register — `Sheet.register.concat`.
 *
 * @param parts - The member sets, in order
 * @returns The concatenated members
 */
export function concatMembers(parts: SheetRegisterValue[]): SheetRegisterValue {
    if (parts.length === 0) return East.value([], SheetRegisterMembersType);
    return parts.slice(1).reduce<SheetRegisterValue>(
        (acc, p) => acc.concat(p) as SheetRegisterValue,
        parts[0] as SheetRegisterValue,
    );
}

/**
 * The accessors `Sheet.driver` reifies over one driver row.
 *
 * @typeParam D - The driver's row type
 */
export interface SheetDriverConfig<D extends StructType> {
    /** The member key — what the driver column's cell stores. */
    key: (row: ExprType<D>) => SubtypeExprOrValue<StringType>;
    /** What a chip / candidate prints. */
    label: (row: ExprType<D>) => SubtypeExprOrValue<StringType>;
    /** Alternative spellings. */
    aliases?: (row: ExprType<D>) => SubtypeExprOrValue<ArrayType<StringType>>;
    /** Chip meta — return the field's `Option`. */
    meta?: (row: ExprType<D>) => SubtypeExprOrValue<OptionType<StringType>>;
}

/**
 * The driver declaration — the column, its data, the row type `D` every
 * driver-reading accessor is typed by, and the reified key lookup.
 *
 * @remarks
 * The typed parts (`rowType`, `data`, `keyFn`) never reach the IR: the root
 * applies a column's `uom` / `sides` accessors over `data` and the bridge
 * folds `data` into the `ctx.driver` lookup. Only `column` and `members`
 * ride ({@link SheetDriverType}).
 *
 */
export interface SheetDriverValue {
    /** The driver column's key — must be a `lookup` column on a `String` field. */
    readonly column: string;
    /** The driver's row type (erased here; the builders that read the driver's row take it explicitly). */
    readonly rowType: StructType;
    /** The driver rows. */
    readonly data: ExprType<ArrayType<StructType>>;
    /** The reified key accessor. */
    readonly keyFn: ExprType<FunctionType<[StructType], StringType>>;
    /** The driver's register members. */
    readonly members: SheetRegisterValue;
}

/**
 * Declares the driver — `Sheet.driver(column, data, { key, label })`: the
 * `lookup` column whose member decides what the row does, with its data,
 * so `D` reaches every `uom` / `sides` accessor and `ctx.driver` (§3.3).
 *
 * @typeParam D - The driver's row type (inferred from `data`)
 * @param column - The driver column's key
 * @param data - The driver rows — an `Array<D>` value or expression
 * @param config - The accessors ({@link SheetDriverConfig})
 * @returns The driver declaration the `driver` prop takes
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Reactive, Sheet, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const JobType = StructType({
 *             id: StringType, activity: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType),
 *             qty: OptionType(FloatType), machines: Sheet.Types.Link,
 *         });
 *         const ActivityType = StructType({ name: StringType, uom: StringType, days: IntegerType });
 *         const MachineType = StructType({ code: StringType, family: StringType, line: StringType });
 *         const LineType = StructType({ name: StringType, aliases: ArrayType(StringType) });
 *         const activities = $.const([
 *             { name: "Machining", uom: "pcs", days: 4n },
 *             { name: "Inspection", uom: "lots", days: 1n },
 *         ], ArrayType(ActivityType));
 *         const machines = $.const([
 *             { code: "M2140", family: "CNC lathe", line: "L2" },
 *             { code: "M2141", family: "CNC lathe", line: "L2" },
 *             { code: "M3210", family: "5-axis mill", line: "L3" },
 *         ], ArrayType(MachineType));
 *         const lines = $.const(new Map([
 *             ["L2", { name: "Line 2", aliases: ["l2", "line 2"] }],
 *             ["L3", { name: "Line 3", aliases: ["l3", "line 3"] }],
 *         ]), DictType(StringType, LineType));
 *         const jobs = $.let(State.bind([ArrayType(JobType)], "sheet_registers_jobs", [
 *             { id: "j1", activity: "Machining", start: some(new Date("2026-02-16T00:00:00Z")), end: none, qty: some(1200.0),
 *               machines: { from: [], to: [variant("counted", { n: 2n, key: "CNC lathe" })] } },
 *         ]));
 *         // The driver's row reaches a fill typed: End = Start + the activity's days.
 *         const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
 *         const endFromStart = $.const(East.function([Sheet.Types.DraftContext(JobType, ActivityType)], DateFill, ($, ctx) => {
 *             const noFill = $.const(none, DateFill);
 *             return ctx.row.start.match({
 *                 value: (_$, supplied) => supplied.match({
 *                     none: () => noFill,
 *                     some: (_$, start) => ctx.driver.match({
 *                         none: () => noFill,
 *                         some: (_$, d) => some({ value: start.addDays(d.days), meta: East.str`+${d.days}d · ${d.name}` }),
 *                     }),
 *                 }),
 *             }, () => noFill);
 *         }));
 *         const newJob = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(JobType), () => Sheet.patch(JobType, { machines: { from: [], to: [] } })));
 *         return (
 *             <Sheet
 *                 data={jobs}
 *                 id="id"
 *                 driver={Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name, meta: a => some(a.uom) })}
 *                 registers={{
 *                     machines: Sheet.register.concat([
 *                         Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code,
 *                             meta: m => some(m.family), parent: m => some(m.line) }),
 *                         // A Dict's key rides as the accessors' second argument.
 *                         Sheet.register.members(lines, { kind: "line", key: (_l, code) => code, label: l => l.name, aliases: l => l.aliases }),
 *                         // Both lathes name one family — duplicate keys fold, the first wins.
 *                         Sheet.register.members(machines, { kind: "family", key: m => m.family, label: m => m.family, meta: _m => some("family") }),
 *                     ]),
 *                 }}
 *                 columns={{
 *                     activity: Sheet.column.lookup(JobType, { header: "Activity", width: "140px" }),
 *                     start:    Sheet.column.date(JobType, { header: "Start", width: "96px" }),
 *                     end:      Sheet.column.date(JobType, { header: "End", sub: "start + days", width: "96px", base: "start", fill: [endFromStart] }),
 *                     qty:      Sheet.column.quantity(JobType, ActivityType, { header: "Qty", sub: "uom per activity", width: "112px", uom: d => d.uom }),
 *                     machines: Sheet.column.set(JobType, "machines", { header: "Machines", sub: "M2140 · 2 x lathe · line 2", width: "240px",
 *                                   members: [{ kind: "machine", identified: true }, { kind: "line", countable: true, resolvesTo: "machine" },
 *                                             { kind: "family", countable: true, resolvesTo: "machine" }] }),
 *                 }}
 *                 newRow={newJob}
 *                 onUpdate={jobs.write}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function createDriver<D extends StructType>(
    column: string,
    data: SubtypeExprOrValue<ArrayType<D>>,
    config: SheetDriverConfig<D>,
): SheetDriverValue {
    const expr = East.value(data as SubtypeExprOrValue<ArrayType<StructType>>) as ExprType<ArrayType<StructType>>;
    const t = Expr.type(expr) as { type: string; value?: EastType };
    if (t.type !== "Array" || (t.value as { type?: string }).type !== "Struct") {
        throw new Error(`Sheet.driver("${column}"): data must be an Array of structs — got a ${t.type}`);
    }
    const rowType = t.value as StructType;
    const cfg = config as unknown as SheetDriverConfig<StructType>;
    const keyFn = East.function([rowType], StringType, (_$, d) => cfg.key(d));
    const members = createMembers(expr, {
        kind:  column,
        key:   (d) => keyFn(d),
        label: (d) => cfg.label(d),
        ...(cfg.aliases !== undefined ? { aliases: (d: ExprType<StructType>) => cfg.aliases!(d) } : {}),
        ...(cfg.meta !== undefined ? { meta: (d: ExprType<StructType>) => cfg.meta!(d) } : {}),
    });
    return { column, rowType, data: expr, keyFn, members };
}
