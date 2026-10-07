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

import { StatusValueType } from "@elaraai/east-ui";
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
 * @property kind - The member kind (`"machine"`, `"bay"`, `"family"`)
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
 * fold, first occurrence wins — a countable-by-attribute kind (`"CNC router"`
 * from every machine of that family) declares one member per distinct value.
 *
 * @typeParam T - The data's element type
 * @param data - The rows — an `Array<T>` or a `Dict<String, T>` value or expression
 * @param config - The accessors ({@link SheetMembersConfig})
 * @returns The members, as an expression
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DateTimeType, East, FloatType, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Box, Format, Reactive, Slice, State, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const StressJob = StructType({
 *     id: StringType, start: OptionType(DateTimeType), activity: StringType, notes: StringType,
 *     stations: Sheet.Types.Link, status: StringType, qty: OptionType(FloatType),
 * });
 * export const sheetStressJobCount = e3.input("sheet_stress_job_count", IntegerType, variant("value", 2000n));
 * export const generateStressJobs = East.function([IntegerType], ArrayType(StressJob), ($, count) => {
 *     const activities = $.const(["Routing", "Spraying", "Wrapping", "Set-up", "Maintenance"], ArrayType(StringType));
 *     const words = $.const(["PLANNED", "RELEASED", "COMPLETE"], ArrayType(StringType));
 *     const codes = $.const(["R2140", "R2141", "R2145", "P3210", "A7301"], ArrayType(StringType));
 *     const first = $.const(new Date("2026-01-05T00:00:00Z"), DateTimeType);
 *     const noMembers = $.const([], ArrayType(Sheet.Types.Member));
 *     const blank = $.const(none, OptionType(FloatType));
 *     return East.Array.generate(count, StressJob, (_$, i) => ({
 *         id: East.str`S${i}`,
 *         start: some(first.addDays(i.divide(4n))),
 *         activity: activities.get(i.remainder(5n)),
 *         notes: i.remainder(7n).equal(0n).ifElse((_$2) => "urgent — inspect before delivery", (_$2) => East.str`batch ${i.add(100n)}`),
 *         // Routing runs name a count of routers; the rest a machine by code.
 *         stations: i.remainder(5n).equal(0n).ifElse(
 *             (_$2) => East.value({ from: noMembers, to: [variant("counted", { n: i.remainder(3n).add(2n), key: "CNC router" })] }, Sheet.Types.Link),
 *             (_$2) => East.value({ from: noMembers, to: [variant("identified", { key: codes.get(i.remainder(5n)) })] }, Sheet.Types.Link)),
 *         status: words.get(i.remainder(3n)),
 *         qty: i.remainder(11n).equal(0n).ifElse((_$2) => blank, (_$2) => East.value(some(i.multiply(7n).toFloat().add(50.0)), OptionType(FloatType))),
 *     }));
 * });
 * export const sheetStressJobs = e3.task("sheet_stress_jobs", [sheetStressJobCount], generateStressJobs);
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const MachineType = StructType({ code: StringType, family: StringType });
 *         // Two thousand jobs an e3 task generates — made where data is made.
 *         const jobs = $.let(Data.bind(sheetStressJobs));
 *         const count = $.let(jobs.read().length());
 *         const machines = $.const([
 *             { code: "R2140", family: "CNC router" }, { code: "R2141", family: "CNC router" }, { code: "R2145", family: "CNC router" },
 *             { code: "P3210", family: "4-side planer" }, { code: "A7301", family: "assembly bench" },
 *         ], ArrayType(MachineType));
 *         // The work centres are searched through their display form — `3 x CNC router`, `A7301` — not their `.east` text.
 *         const cfg = $.const(Slice.config(StressJob, {
 *             fields: {
 *                 activity: { label: "Activity", hints: ["Routing", "Spraying", "Wrapping", "Set-up", "Maintenance"] },
 *                 notes:    { label: "Notes" },
 *                 stations: { label: "Work centres", text: r => Sheet.link.print(r.stations) },
 *                 status:   { label: "Status" },
 *             },
 *             searchFieldIds: ["activity", "notes", "stations"],
 *         }));
 *         const slice = $.let(Slice.bind([StressJob], "sheet_stress_slice", cfg, Slice.state(), jobs.read(), none));
 *         const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet_stress_views", [
 *             { id: "spraying", name: "SPRAYING", narrowing: Slice.state({ search: some("spraying") }), context: 1n, reveals: [], folds: new Map() },
 *             { id: "routers", name: "ROUTERS", narrowing: Slice.state({ search: some("router") }), context: 0n, reveals: [], folds: new Map() },
 *             { id: "urgent", name: "URGENT", narrowing: Slice.state({ search: some("urgent") }), context: 0n, reveals: [], folds: new Map() },
 *         ]));
 *         return (
 *             <Box height="480px">
 *                 <Sheet
 *                     data={jobs}
 *                     id="id"
 *                     name="stress"
 *                     registers={{
 *                         stations: Sheet.register.concat([
 *                             Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code, meta: m => some(m.family) }),
 *                             Sheet.register.members(machines, { kind: "family", key: m => m.family, label: m => m.family, meta: _m => some("family") }),
 *                         ]),
 *                     }}
 *                     columns={{
 *                         start:    Sheet.column.date(StressJob, { header: "Start", width: "96px" }),
 *                         activity: Sheet.column.text(StressJob, { header: "Activity", width: "160px" }),
 *                         notes:    Sheet.column.text(StressJob, { header: "Notes", sub: "free text", width: "240px" }),
 *                         stations: Sheet.column.set(StressJob, "stations", { header: "Work centres", sub: "3 x router · machine", width: "220px",
 *                                       members: [{ kind: "machine", identified: true }, { kind: "family", countable: true, resolvesTo: "machine" }] }),
 *                         status:   Sheet.column.text(StressJob, { header: "Status", width: "120px" }),
 *                         qty:      Sheet.column.quantity(StressJob, { header: "Qty", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }) }),
 *                     }}
 *                     slice={slice} affordances={["search", "filter"]}
 *                     views={views} activeView={some("spraying")}
 *                     readOnly
 *                     footer={[{ text: East.str`${count} rows · virtualised` }]}
 *                 />
 *             </Box>
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
    // The data is an Array or a Dict whatever the cast above says: widen to
    // read its real East type.
    const t = Expr.type(expr) as EastType;
    if (t.type !== "Array" && t.type !== "Dict") {
        throw new Error(`Sheet.register.members: data must be an Array or a Dict<String, T> — got a ${t.type}`);
    }
    if (t.type === "Dict" && (t.key as EastType).type !== "String") {
        throw new Error("Sheet.register.members: a keyed register must be a Dict<String, T> — its keys ride to the accessors as the second argument");
    }
    const elem: EastType = t.value;
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
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Box, Format, Reactive, Slice, State, StatusValueType, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Record, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const WorkshopActivity = StructType({
 *     name: StringType, uom: StringType, days: IntegerType, rate: FloatType, family: StringType, sides: Sheet.Types.Sides,
 * });
 * export const WorkshopMachine = StructType({ family: StringType, bay: StringType });
 * export const WorkshopStatus = StructType({ word: StringType, tone: StatusValueType });
 * export const WorkshopOperation = StructType({
 *     activity:   StringType,                    // the driver: an activity's name
 *     start:      OptionType(DateTimeType),
 *     end:        OptionType(DateTimeType),
 *     qty:        OptionType(FloatType),         // in the activity's unit
 *     machines:   Sheet.Types.Link,              // work centres, from → to
 *     notes:      StringType,
 *     created_by: StringType,                    // no column: the inspector shows it
 * });
 * export const WorkshopOrder = StructType({
 *     name:     StringType,
 *     customer: StringType,
 *     due:      OptionType(DateTimeType),
 *     status:   StringType,                      // a word of the statuses register
 *     ops:      ArrayType(WorkshopOperation),
 * });
 * export const sheetWorkshopActivities = e3.input("sheet_workshop_activities", ArrayType(WorkshopActivity), variant("value", [
 *     { name: "Panel cutting", uom: "panels", days: 1n, rate: 12.0, family: "beam saw", sides: variant("both", null) },
 *     { name: "Edge banding", uom: "metres", days: 1n, rate: 60.0, family: "edge bander", sides: variant("both", null) },
 *     { name: "CNC routing", uom: "panels", days: 2n, rate: 6.0, family: "CNC router", sides: variant("both", null) },
 *     { name: "Drilling", uom: "panels", days: 1n, rate: 10.0, family: "CNC router", sides: variant("both", null) },
 *     { name: "Sanding", uom: "panels", days: 1n, rate: 20.0, family: "", sides: variant("in", null) },
 *     { name: "Assembly", uom: "units", days: 2n, rate: 2.0, family: "assembly bench", sides: variant("both", null) },
 *     { name: "Spray finish", uom: "doors", days: 3n, rate: 8.0, family: "spray booth", sides: variant("both", null) },
 *     { name: "Wrapping", uom: "units", days: 1n, rate: 10.0, family: "", sides: variant("in", null) },
 *     { name: "Delivery", uom: "loads", days: 1n, rate: 1.0, family: "", sides: variant("from", null) },
 * ]));
 * export const sheetWorkshopMachines = e3.record("sheet_workshop_machines", DictType(StringType, WorkshopMachine), new Map([
 *     ["S101", { family: "beam saw", bay: "Bay 1" }],
 *     ["S102", { family: "beam saw", bay: "Bay 1" }],
 *     ["S103", { family: "beam saw", bay: "Bay 1" }],
 *     ["E201", { family: "edge bander", bay: "Bay 2" }],
 *     ["E202", { family: "edge bander", bay: "Bay 2" }],
 *     ["R301", { family: "CNC router", bay: "Bay 3" }],
 *     ["R302", { family: "CNC router", bay: "Bay 3" }],
 *     ["R303", { family: "CNC router", bay: "Bay 3" }],
 *     ["F401", { family: "spray booth", bay: "Bay 4" }],
 *     ["F402", { family: "spray booth", bay: "Bay 4" }],
 *     ["A701", { family: "assembly bench", bay: "Bay 7" }],
 *     ["A702", { family: "assembly bench", bay: "Bay 7" }],
 * ]));
 * export const sheetWorkshopOrders = e3.record("sheet_workshop_orders", DictType(StringType, WorkshopOrder), new Map([
 *     ["WO-2201", { name: "WO-2201 · Kitchen, oak", customer: "Quillfeather Interiors", due: some(new Date("2026-10-23T00:00:00Z")), status: "RELEASED", ops: [
 *         { activity: "Panel cutting", start: some(new Date("2026-10-12T00:00:00Z")), end: some(new Date("2026-10-13T00:00:00Z")), qty: some(48.0),
 *           machines: { from: [variant("identified", { key: "S101" })], to: [variant("identified", { key: "E201" })] }, notes: "Oak veneered board", created_by: "planner" },
 *         { activity: "Edge banding", start: some(new Date("2026-10-14T00:00:00Z")), end: some(new Date("2026-10-15T00:00:00Z")), qty: some(120.0),
 *           machines: { from: [variant("identified", { key: "E201" })], to: [variant("identified", { key: "R301" })] }, notes: "", created_by: "planner" },
 *         { activity: "CNC routing", start: some(new Date("2026-10-15T00:00:00Z")), end: some(new Date("2026-10-17T00:00:00Z")), qty: some(48.0),
 *           machines: { from: [variant("identified", { key: "R301" })], to: [variant("identified", { key: "A701" })] }, notes: "Hinge cups and handle slots", created_by: "planner" },
 *         { activity: "Assembly", start: none, end: none, qty: some(12.0),
 *           machines: { from: [], to: [variant("identified", { key: "A701" })] }, notes: "Twelve carcasses", created_by: "planner" },
 *         { activity: "Spray finish", start: none, end: none, qty: some(24.0),
 *           machines: { from: [], to: [variant("identified", { key: "F401" })] }, notes: "Matt lacquer", created_by: "planner" },
 *     ] }],
 *     ["WO-2202", { name: "WO-2202 · Wardrobes, ash", customer: "Marrowby Lettings", due: some(new Date("2026-10-30T00:00:00Z")), status: "PLANNED", ops: [
 *         { activity: "Panel cutting", start: some(new Date("2026-10-13T00:00:00Z")), end: some(new Date("2026-10-14T00:00:00Z")), qty: some(36.0),
 *           machines: { from: [variant("identified", { key: "S102" })], to: [variant("identified", { key: "E202" })] }, notes: "", created_by: "planner" },
 *         { activity: "Edge banding", start: none, end: none, qty: some(90.0),
 *           machines: { from: [variant("identified", { key: "E202" })], to: [] }, notes: "", created_by: "planner" },
 *         { activity: "Drilling", start: none, end: none, qty: some(36.0),
 *           machines: { from: [], to: [variant("identified", { key: "R302" })] }, notes: "Hinge and shelf pins", created_by: "planner" },
 *         { activity: "Assembly", start: none, end: none, qty: some(6.0),
 *           machines: { from: [], to: [variant("identified", { key: "A702" })] }, notes: "", created_by: "planner" },
 *     ] }],
 *     ["WO-2203", { name: "WO-2203 · Vanity unit, walnut", customer: "Tallowmere Homes", due: some(new Date("2026-11-02T00:00:00Z")), status: "PLANNED", ops: [
 *         { activity: "Panel cutting", start: none, end: none, qty: some(12.0),
 *           machines: { from: [], to: [variant("identified", { key: "S101" })] }, notes: "", created_by: "planner" },
 *         { activity: "CNC routing", start: none, end: none, qty: some(12.0),
 *           machines: { from: [], to: [variant("counted", { n: 1n, key: "CNC router" })] }, notes: "Basin cut-out", created_by: "planner" },
 *         { activity: "Spray finish", start: none, end: none, qty: some(4.0),
 *           machines: { from: [], to: [variant("identified", { key: "F402" })] }, notes: "", created_by: "planner" },
 *         { activity: "Assembly", start: none, end: none, qty: some(2.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *     ] }],
 *     ["WO-2204", { name: "WO-2204 · Shelving, birch", customer: "Pebblecombe School", due: some(new Date("2026-10-20T00:00:00Z")), status: "ON HOLD", ops: [
 *         { activity: "Panel cutting", start: none, end: none, qty: some(60.0),
 *           machines: { from: [], to: [variant("counted", { n: 2n, key: "beam saw" })] }, notes: "Awaiting board delivery", created_by: "planner" },
 *         { activity: "Edge banding", start: none, end: none, qty: some(150.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *         { activity: "Sanding", start: none, end: none, qty: some(60.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *     ] }],
 *     ["WO-2205", { name: "WO-2205 · Office fit-out, maple", customer: "", due: none, status: "PLANNED", ops: [
 *         { activity: "Panel cutting", start: none, end: none, qty: some(80.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *         { activity: "CNC routing", start: none, end: none, qty: some(40.0),
 *           machines: { from: [], to: [] }, notes: "Cable ports", created_by: "planner" },
 *         { activity: "Assembly", start: none, end: none, qty: some(10.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *         { activity: "Wrapping", start: none, end: none, qty: some(10.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *         { activity: "Delivery", start: none, end: none, qty: some(2.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *     ] }],
 *     ["WO-2206", { name: "WO-2206 · Kitchen, painted", customer: "Orrisdale Cottages", due: some(new Date("2026-11-06T00:00:00Z")), status: "PLANNED", ops: [
 *         { activity: "Panel cutting", start: none, end: none, qty: some(30.0),
 *           machines: { from: [], to: [variant("identified", { key: "S103" })] }, notes: "", created_by: "planner" },
 *         { activity: "Edge banding", start: none, end: none, qty: some(70.0),
 *           machines: { from: [], to: [variant("counted", { n: 1n, key: "edge bander" })] }, notes: "", created_by: "planner" },
 *         { activity: "Spray finish", start: none, end: none, qty: some(18.0),
 *           machines: { from: [], to: [variant("identified", { key: "F401" })] }, notes: "Primer, then two coats", created_by: "planner" },
 *         { activity: "Assembly", start: none, end: none, qty: some(8.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *         { activity: "Wrapping", start: none, end: none, qty: some(8.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *         { activity: "Delivery", start: none, end: none, qty: some(1.0),
 *           machines: { from: [], to: [] }, notes: "", created_by: "planner" },
 *     ] }],
 * ]));
 * export const sheetWorkshopOrdersPatch = e3.mutation.patch(sheetWorkshopOrders);
 * const workshopRecommend = East.asyncPlatform(
 *     "sheet_workshop_recommend",
 *     [Sheet.Types.DraftContext(WorkshopOrder, "ops", WorkshopActivity)],
 *     ArrayType(Sheet.Types.Proposal(WorkshopOperation)),
 *     { optional: true },
 * );
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const orders     = $.let(Record.bind(sheetWorkshopOrders, [sheetWorkshopOrdersPatch]));
 *         const machines   = $.let(Record.bind(sheetWorkshopMachines, []));
 *         const activities = $.let(Data.bind(sheetWorkshopActivities));
 *         const views      = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet.workshop.views", []));
 *         const statuses   = $.let([
 *             { word: "PLANNED",  tone: variant("neutral", null) },
 *             { word: "RELEASED", tone: variant("info", null) },
 *             { word: "ON HOLD",  tone: variant("warning", null) },
 *         ], ArrayType(WorkshopStatus));
 *         const BayType = StructType({ name: StringType, aliases: ArrayType(StringType) });
 *         const bays = $.let([
 *             { name: "Bay 1", aliases: ["b1", "saw bay"] },
 *             { name: "Bay 2", aliases: ["b2", "banding bay"] },
 *             { name: "Bay 3", aliases: ["b3", "router bay"] },
 *             { name: "Bay 4", aliases: ["b4", "spray bay"] },
 *             { name: "Bay 7", aliases: ["b7", "assembly bay"] },
 *         ], ArrayType(BayType));
 *         // Every operation of every order: what the slice searches and filters — the work centres by their display text.
 *         const operations = $.let(orders.read().toArray((_$, o) => o.ops).flatMap((_$, ops) => ops));
 *         const slice = $.let(Slice.bind([WorkshopOperation], "sheet_workshop",
 *             Slice.config(WorkshopOperation, {
 *                 fields: {
 *                     activity: { label: "Activity", hints: ["Panel cutting", "Edge banding", "CNC routing", "Drilling", "Sanding", "Assembly", "Spray finish", "Wrapping", "Delivery"] },
 *                     notes:    { label: "Notes" },
 *                     machines: { label: "Work centres", text: o => Sheet.link.print(o.machines) },
 *                 },
 *                 searchFieldIds: ["activity", "notes", "machines"],
 *             }),
 *             Slice.state(), operations, none));
 *         const Ctx = Sheet.Types.DraftContext(WorkshopOrder, "ops", WorkshopActivity);
 *         const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
 *         const FloatFill = OptionType(Sheet.Types.Fill(FloatType));
 *         const TextFill = OptionType(Sheet.Types.Fill(StringType));
 *         const LinkFill = OptionType(Sheet.Types.Fill(Sheet.Types.Link));
 *         const Counted = OptionType(Sheet.Types.Counted);
 *         const Proposals = ArrayType(Sheet.Types.Proposal(WorkshopOperation));
 *         // derive — End = start + the activity's days.
 *         const endFromStart = $.const(East.function([Ctx], DateFill, ($, ctx) => {
 *             const noFill = $.const(none, DateFill);
 *             return ctx.row.start.match({
 *                 value: (_$, supplied) => supplied.match({
 *                     none: () => noFill,
 *                     some: (_$, start) => ctx.driver.match({
 *                         none: () => noFill,
 *                         some: (_$, a) => some({ value: start.addDays(a.days), meta: East.str`+${a.days}d · ${a.name}` }),
 *                     }),
 *                 }),
 *             }, () => noFill);
 *         }));
 *         // sequence — the day after the last dated line above; else next Monday.
 *         const nextSlot = $.const(East.function([Ctx], DateFill, ($, ctx) => {
 *             const dated = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.start.hasTag("value").and(() => r.start.unwrap("value").hasTag("some"))));
 *             return dated.length().greater(0n).ifElse(
 *                 ($2) => {
 *                     const last = $2.let(dated.get(dated.length().subtract(1n)));
 *                     return East.value(some({ value: last.start.unwrap("value").unwrap("some").addDays(1n), meta: "the day after the line above" }), DateFill);
 *                 },
 *                 ($2) => {
 *                     const daysToMonday = $2.let(East.value(8n, IntegerType).subtract(ctx.today.getDayOfWeek()).remainder(7n));
 *                     const monday = $2.let(ctx.today.addDays(daysToMonday.equal(0n).ifElse((_$) => 7n, (_$) => daysToMonday)));
 *                     return East.value(some({ value: monday, meta: "next Monday" }), DateFill);
 *                 });
 *         }));
 *         // history — the quantity of the last like operation in the order.
 *         const lastQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
 *             const noFill = $.const(none, FloatFill);
 *             return ctx.row.activity.match({
 *                 value: ($, activity) => {
 *                     const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) =>
 *                         r.activity.hasTag("value").and(() => r.activity.unwrap("value").equal(activity))
 *                             .and(() => r.qty.hasTag("value")).and(() => r.qty.unwrap("value").hasTag("some"))));
 *                     return similar.size().equal(0n).ifElse(() => noFill, ($) => {
 *                         const row = $.let(similar.get(similar.size().subtract(1n)));
 *                         return some({ value: row.qty.unwrap("value").unwrap("some"), meta: "the last like operation's quantity" });
 *                     });
 *                 },
 *             }, () => noFill);
 *         }));
 *         // default — a shift's worth at the activity's rate.
 *         const shiftQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
 *             const noFill = $.const(none, FloatFill);
 *             return ctx.driver.match({
 *                 none: (_$) => noFill,
 *                 some: (_$, a) => East.value(some({ value: a.rate.multiply(8.0), meta: East.str`${a.rate}/h × 8 h` }), FloatFill),
 *             });
 *         }));
 *         // phrase — the notes, from the supplied quantity and the activity's unit.
 *         const phrase = $.const(East.function([Ctx], TextFill, ($, ctx) => {
 *             const noFill = $.const(none, TextFill);
 *             return ctx.row.qty.hasTag("value").and(() => ctx.row.qty.unwrap("value").hasTag("some")).ifElse(($) => {
 *                 const qty = $.const(ctx.row.qty.unwrap("value").unwrap("some"));
 *                 return ctx.driver.match({
 *                     none: (_$) => noFill,
 *                     some: (_$, a) => East.value(some({ value: East.str`${qty} ${a.uom} · ${a.name}`, meta: "phrasing from the supplied activity and quantity" }), TextFill),
 *                 });
 *             }, () => noFill);
 *         }));
 *         // The arity rule — one machine of the activity's family for every sixty units.
 *         const impliedMachines = $.const(East.function([Ctx], Counted, ($, ctx) => {
 *             const noCount = $.const(none, Counted);
 *             $.if(ctx.row.qty.hasTag("value").not(), ($) => { $.return(noCount); });
 *             const supplied = $.const(ctx.row.qty.unwrap("value"));
 *             $.if(supplied.hasTag("some").not(), ($) => { $.return(noCount); });
 *             const qty = $.const(supplied.unwrap("some"));
 *             // ⌈qty ÷ 60⌉ by hand — `toInteger` refuses a fraction.
 *             const share = $.let(qty.divide(60.0));
 *             const frac = $.let(share.remainder(1.0));
 *             const needed = $.let(frac.equal(0.0).ifElse((_$) => share, (_$) => share.subtract(frac).add(1.0)).toInteger());
 *             return ctx.driver.match({
 *                 none: (_$) => noCount,
 *                 some: (_$, a) => a.family.equal("").or(() => qty.greater(0.0).not()).ifElse(
 *                     (_$2) => noCount,
 *                     (_$2) => East.value(some({ n: needed, key: a.family }), Counted)),
 *             });
 *         }));
 *         // capacity — the machines the quantity implies, counted.
 *         const capacity = $.const(East.function([Ctx], LinkFill, ($, ctx) => {
 *             const noFill = $.const(none, LinkFill);
 *             const noMembers = $.const([], ArrayType(Sheet.Types.Member));
 *             const implied = $.const(impliedMachines);
 *             return implied(ctx).match({
 *                 none: (_$) => noFill,
 *                 some: (_$, c) => East.value(some({ value: { from: [variant("counted", { n: c.n, key: c.key })], to: noMembers }, meta: "capacity · from the quantity" }), LinkFill),
 *             });
 *         }));
 *         // history — the work centres of the last like operation in the order.
 *         const lastMachines = $.const(East.function([Ctx], LinkFill, ($, ctx) => {
 *             const noFill = $.const(none, LinkFill);
 *             return ctx.row.activity.match({
 *                 value: ($, activity) => {
 *                     const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) =>
 *                         r.activity.hasTag("value").and(() => r.activity.unwrap("value").equal(activity)).and(() => r.machines.hasTag("value"))));
 *                     return similar.size().equal(0n).ifElse(() => noFill, ($) => {
 *                         const link = $.let(similar.get(similar.size().subtract(1n)).machines.unwrap("value"));
 *                         return link.from.size().add(link.to.size()).equal(0n).ifElse(
 *                             () => noFill, () => some({ value: link, meta: "the work centres of the last like operation" }));
 *                     });
 *                 },
 *             }, () => noFill);
 *         }));
 *         // A member check — a machine on the From half runs the operation, so it is of the activity's family.
 *         const familyOf = $.let(activities.read().toDict((_$, a) => a.name, (_$, a) => a.family));
 *         const machineDict = $.let(machines.read());
 *         const familyFits = $.const(East.function([Sheet.Types.CheckContext(WorkshopOrder, "ops")], OptionType(StringType), ($, c) => {
 *             const noFlag = $.const(none, OptionType(StringType));
 *             return c.half.match({
 *                 to: (_$) => noFlag,
 *                 from: (_$) => c.member.match({
 *                     identified: (_$2, m) => c.row.activity.match({
 *                         value: (_$3, activity) => familyOf.has(activity)
 *                             .and(() => familyOf.get(activity).equal("").not())
 *                             .and(() => machineDict.has(m.key))
 *                             .and(() => machineDict.get(m.key).family.equal(familyOf.get(activity)).not())
 *                             .ifElse(
 *                                 (_$4) => East.value(some(East.str`${m.key} is a ${machineDict.get(m.key).family}, not a ${familyOf.get(activity)}`), OptionType(StringType)),
 *                                 (_$4) => noFlag),
 *                     }, (_$3) => noFlag),
 *                 }, (_$2) => noFlag),
 *             });
 *         }));
 *         // A pattern — panels cut are banded, then routed.
 *         const followUps = $.const(East.function([Ctx], Proposals, ($, ctx) => {
 *             const empty = $.const([], Proposals);
 *             return ctx.row.activity.hasTag("value")
 *                 .and(() => ctx.row.activity.unwrap("value").equal("Panel cutting"))
 *                 .and(() => ctx.row.end.hasTag("value"))
 *                 .and(() => ctx.row.end.unwrap("value").hasTag("some")).ifElse(($) => {
 *                     const end = $.const(ctx.row.end.unwrap("value").unwrap("some"));
 *                     return $.const([
 *                         { patch: Sheet.patch(WorkshopOperation, { activity: "Edge banding", start: some(end), end: some(end.addDays(1n)), notes: "Band the cut panels" }), meta: "edge banding after the cut" },
 *                         { patch: Sheet.patch(WorkshopOperation, { activity: "CNC routing", start: some(end.addDays(1n)), end: some(end.addDays(3n)), notes: "Route the banded panels" }), meta: "routing · end +1…+3 d" },
 *                     ], Proposals);
 *                 }, () => empty);
 *         }));
 *         // Learned from the order — what followed this activity in it, after how long.
 *         const lastFollower = $.const(East.function([Ctx], Proposals, ($, ctx) => {
 *             const empty = $.const([], Proposals);
 *             return ctx.row.activity.hasTag("value")
 *                 .and(() => ctx.row.start.hasTag("value"))
 *                 .and(() => ctx.row.start.unwrap("value").hasTag("some")).ifElse(($) => {
 *                     const activity = $.const(ctx.row.activity.unwrap("value"));
 *                     const start = $.const(ctx.row.start.unwrap("value").unwrap("some"));
 *                     const dated = $.const(ctx.rows.filter((_$, r) => r.start.hasTag("value")
 *                         .and(() => r.start.unwrap("value").hasTag("some"))
 *                         .and(() => r.activity.hasTag("value"))));
 *                     const upper = $.const(dated.size().greater(1n).ifElse(() => dated.size().subtract(1n), () => 0n));
 *                     const pairs = $.const(East.Array.range(0n, upper).filter((_$, i) =>
 *                         dated.get(i).activity.unwrap("value").equal(activity)
 *                             .and(() => dated.get(i.add(1n)).activity.unwrap("value").equal(activity).not())));
 *                     return pairs.size().equal(0n).ifElse(() => empty, ($) => {
 *                         const index = $.const(pairs.get(pairs.size().subtract(1n)));
 *                         const from = $.const(dated.get(index));
 *                         const next = $.const(dated.get(index.add(1n)));
 *                         const gap = $.const(next.start.unwrap("value").unwrap("some").toEpochMilliseconds()
 *                             .subtract(from.start.unwrap("value").unwrap("some").toEpochMilliseconds()));
 *                         return $.const([{ patch: Sheet.patch(WorkshopOperation, { activity: next.activity.unwrap("value"), start: some(start.addMilliseconds(gap)) }),
 *                             meta: "follower learned from the order" }], Proposals);
 *                     });
 *                 }, () => empty);
 *         }));
 *         // A model — an ASYNC proposer; the strip shows a pending chip, and a newer context cancels the wait.
 *         const modelProposals = $.const(East.asyncFunction([Ctx], Proposals, ($, ctx) => {
 *             const result = $.let([], Proposals);
 *             $.try(($) => { $.assign(result, workshopRecommend(ctx)); }).catch(($, message) => {
 *                 // The showcase has no model behind it; any other failure still reaches the sheet's provider diagnostic.
 *                 $.if(message.notEqual("Platform function 'sheet_workshop_recommend' is not available"), ($) => { $.error(message); });
 *             });
 *             return result;
 *         }));
 *         // The operations each kind of order starts with: the group templates' lines.
 *         const kitchen = $.let([
 *             { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *             { activity: "Edge banding",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *             { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *             { activity: "Spray finish",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *         ], ArrayType(WorkshopOperation));
 *         const wardrobe = $.let([
 *             { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *             { activity: "Edge banding",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *             { activity: "Drilling",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *             { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *         ], ArrayType(WorkshopOperation));
 *         const vanity = $.let([
 *             { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *             { activity: "CNC routing",   start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *             { activity: "Spray finish",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *             { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
 *         ], ArrayType(WorkshopOperation));
 *         // A new operation's and a new order's defaults, and the check every order passes before Save.
 *         const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(WorkshopOperation), () =>
 *             Sheet.patch(WorkshopOperation, { start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "planner" })));
 *         const newGroup = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(WorkshopOrder), () =>
 *             Sheet.patch(WorkshopOrder, { status: "PLANNED", due: none, ops: [] })));
 *         const readyOrder = $.const(East.function([Sheet.Types.DraftGroup(WorkshopOrder, "ops")], Sheet.Types.Readiness, ($, order) => {
 *             $.if(order.customer.hasTag("value").and(() => order.customer.unwrap("value").length().equal(0n)), $ => {
 *                 $.return(East.value(variant("incomplete", [{ field: "customer", message: "Name the customer" }]), Sheet.Types.Readiness));
 *             });
 *             return East.value(variant("ready", null), Sheet.Types.Readiness);
 *         }));
 *         return (
 *             <Box height="760px">
 *                 <Sheet
 *                     record={orders}
 *                     group={Sheet.group(WorkshopOrder, "ops", {
 *                         title: "name", sub: o => o.customer, noun: { singular: "order", plural: "orders" },
 *                         cells: { activity: Sheet.group.cell.enum(WorkshopOrder, "statuses", "status"),
 *                                  end:      Sheet.group.cell.date(WorkshopOrder, "due") },
 *                     })}
 *                     driver={Sheet.driver("activity", activities.read(), { key: a => a.name, label: a => a.name, meta: a => some(a.uom) })}
 *                     registers={{
 *                         machines: Sheet.register.concat([
 *                             // A Dict's key rides as the accessors' second argument.
 *                             Sheet.register.members(machines.read(), { kind: "machine", key: (_m, code) => code, label: (_m, code) => code,
 *                                 meta: m => some(m.family), parent: m => some(m.bay) }),
 *                             Sheet.register.members(bays, { kind: "bay", key: b => b.name, label: b => b.name, aliases: b => b.aliases,
 *                                 meta: _b => some("bay") }),
 *                             // Every machine names a family — duplicate keys fold, the first wins.
 *                             Sheet.register.members(machines.read(), { kind: "family", key: m => m.family, label: m => m.family,
 *                                 meta: _m => some("family") }),
 *                         ]),
 *                         statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.word, tone: s => some(s.tone) }),
 *                     }}
 *                     columns={{
 *                         activity: Sheet.column.lookup(WorkshopOperation, { header: "Activity", width: "160px" }),
 *                         start:    Sheet.column.date(WorkshopOperation, { header: "Start", width: "96px", fill: [nextSlot] }),
 *                         end:      Sheet.column.date(WorkshopOperation, { header: "End", sub: "start + days", width: "96px",
 *                                       base: "start", fill: [endFromStart] }),
 *                         qty:      Sheet.column.quantity(WorkshopOperation, WorkshopActivity, { header: "Qty", sub: "unit per activity",
 *                                       width: "104px", uom: a => a.uom, format: Format.Number({ maximumFractionDigits: 0n }), fill: [lastQuantity, shiftQuantity] }),
 *                         machines: Sheet.column.link(WorkshopOperation, WorkshopActivity, "machines", {
 *                                       header: "Work centres", sub: "from → to · 2 x edge bander", width: "300px",
 *                                       members: [{ kind: "machine", identified: true },
 *                                                 { kind: "bay", countable: true, resolvesTo: "machine" },
 *                                                 { kind: "family", countable: true, resolvesTo: "machine" }],
 *                                       multiple: { forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" },
 *                                       sides: { value: a => a.sides, locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
 *                                       arity: Sheet.link.arity("from", impliedMachines),
 *                                       check: [Sheet.link.check.exists(), familyFits],
 *                                       fill: [lastMachines, capacity] }),
 *                         notes:    Sheet.column.text(WorkshopOperation, { header: "Notes", width: "240px", fill: [phrase] }),
 *                     }}
 *                     suggest={{ ahead: 2n, triggers: ["activity", "start", "end", "qty", "notes", "machines"],
 *                                propose: [followUps, modelProposals, lastFollower] }}
 *                     // The inspector pane: every field of an operation; created_by, which no column shows, read only.
 *                     inspector
 *                     fields={{ created_by: Sheet.field.readonly() }}
 *                     templates={{
 *                         groups: [
 *                             { key: "kitchen", name: "Kitchen order", group: "Orders",
 *                               values: Sheet.patch(WorkshopOrder, { status: "PLANNED", due: none, ops: kitchen }) },
 *                             { key: "wardrobe", name: "Wardrobe order", group: "Orders",
 *                               values: Sheet.patch(WorkshopOrder, { status: "PLANNED", due: none, ops: wardrobe }) },
 *                             { key: "vanity", name: "Vanity unit", group: "Orders",
 *                               values: Sheet.patch(WorkshopOrder, { status: "PLANNED", due: none, ops: vanity }) },
 *                         ],
 *                         rows: [
 *                             { key: "cut", name: "Panel cutting", group: "Operations",
 *                               values: Sheet.patch(WorkshopOperation, { activity: "Panel cutting",
 *                                   machines: { from: [], to: [variant("counted", { n: 1n, key: "beam saw" })] } }) },
 *                             { key: "edge", name: "Edge banding", group: "Operations",
 *                               values: Sheet.patch(WorkshopOperation, { activity: "Edge banding",
 *                                   machines: { from: [], to: [variant("counted", { n: 1n, key: "edge bander" })] } }) },
 *                             { key: "route", name: "CNC routing", group: "Operations",
 *                               values: Sheet.patch(WorkshopOperation, { activity: "CNC routing",
 *                                   machines: { from: [], to: [variant("counted", { n: 1n, key: "CNC router" })] } }) },
 *                             { key: "sand", name: "Sanding", group: "Operations",
 *                               values: Sheet.patch(WorkshopOperation, { activity: "Sanding" }) },
 *                             { key: "spray", name: "Spray finish", group: "Operations",
 *                               values: Sheet.patch(WorkshopOperation, { activity: "Spray finish",
 *                                   machines: { from: [], to: [variant("counted", { n: 1n, key: "spray booth" })] } }) },
 *                             { key: "assemble", name: "Assembly", group: "Operations",
 *                               values: Sheet.patch(WorkshopOperation, { activity: "Assembly" }) },
 *                             { key: "wrap", name: "Wrapping", group: "Dispatch",
 *                               values: Sheet.patch(WorkshopOperation, { activity: "Wrapping" }) },
 *                             { key: "deliver", name: "Delivery", group: "Dispatch",
 *                               values: Sheet.patch(WorkshopOperation, { activity: "Delivery" }) },
 *                         ],
 *                     }}
 *                     library={[
 *                         Sheet.library.rows(),
 *                         // The statuses an order takes: a card dropped on an order's band sets its status.
 *                         Sheet.library.tab(statuses, { name: "Statuses", icon: "flag",
 *                             key: s => s.word, label: s => s.word, drop: s => Sheet.patch(WorkshopOrder, { status: s.word }) }),
 *                         Sheet.library.columns(),
 *                     ]}
 *                     newRow={newRow}
 *                     newGroup={newGroup}
 *                     ready={{ group: readyOrder }}
 *                     slice={slice} affordances={["search", "filter"]}
 *                     views={views}
 *                     footer={[{ text: East.str`${operations.size()} operations` }]}
 *                     name="workshop"
 *                 />
 *             </Box>
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
    const t = Expr.type(expr) as EastType;
    if (t.type !== "Array" || (t.value as EastType).type !== "Struct") {
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
