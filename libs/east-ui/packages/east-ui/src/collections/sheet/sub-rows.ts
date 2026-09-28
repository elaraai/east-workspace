/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.subRows` and `Sheet.subRow` — sub rows (#844,
 * `libs/east-ui/docs/proposals/Sheet Sub Rows - DX Proposal.md`): read-only
 * rows under a line (or a flat row) that share none of the sheet's columns.
 *
 * `Sheet.subRows(R, { field: (item, row) => Sheet.subRow({ … }) })` is keyed
 * like `columns`: each key names an `Array<T>` field of the type the columns
 * are built over, and its mapper turns one element into a sub row. Key order
 * is display order. The builder only CAPTURES; the root compiles each mapper
 * once and the bridge calls it inside the row projection (`bridge.ts`).
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
    OptionType,
    StringType,
    type StructType,
    some,
    none,
} from "@elaraai/east";

import { SheetFacetType, SheetSubRowType } from "./types.js";
import type { SheetFieldKey } from "./columns.js";

/**
 * The keys of a row struct whose field is an `Array` — what a sub-row source
 * may name.
 *
 * @typeParam R - The type the columns are built over
 */
export type SheetArrayField<R extends StructType> = {
    [K in SheetFieldKey<R>]: R["fields"][K] extends ArrayType<EastType> ? K : never
}[SheetFieldKey<R>];

/**
 * The element type one of those fields holds — a struct, a variant, a string…
 *
 * @typeParam R - The type the columns are built over
 * @typeParam K - The array field
 */
export type SheetElementOf<R extends StructType, K extends SheetArrayField<R>> =
    R["fields"][K] extends ArrayType<infer T extends EastType> ? T : never;

/**
 * The sub-row sources — keyed by `R`'s array fields; each value maps one
 * element (and, when it needs it, the row) to a sub row.
 *
 * @typeParam R - The type the columns are built over
 */
export type SheetSubRowSources<R extends StructType> = {
    [K in SheetArrayField<R>]?: (item: ExprType<SheetElementOf<R, K>>, row: ExprType<R>) => SubtypeExprOrValue<SheetSubRowType>
};

/**
 * What `Sheet.subRows` returns and the `subRows` prop takes — it captures
 * only, like a group declaration.
 *
 * @typeParam R - The type the columns are built over
 */
export interface SheetSubRowsValue<R extends StructType> {
    /** The type the sources were declared over — checked against the columns' at build time. */
    readonly rowType: R;
    /** The sources, in display order. */
    readonly sources: SheetSubRowSources<R>;
}

/**
 * Declares where a sheet's sub rows come from — `Sheet.subRows(R, { … })`.
 *
 * @typeParam R - The type the columns are built over (a grouped sheet: the line type)
 * @param rowType - The row type value
 * @param sources - Array field → mapper to a sub row, in display order
 * @returns The declaration the `subRows` prop takes
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, East, FloatType, IntegerType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Reactive, Sheet, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const OperationType = StructType({
 *             id: StringType, code: StringType, name: StringType, materials: ArrayType(StringType),
 *             station: OptionType(StringType), by: OptionType(StringType),
 *         });
 *         const BookingType = VariantType({
 *             space:     StructType({ area: StringType, units: IntegerType }),
 *             labour:    StructType({ team: StringType, people: IntegerType, hours: FloatType }),
 *             equipment: StructType({ resource: StringType }),
 *         });
 *         const JobType = StructType({
 *             task: StringType, qty: OptionType(FloatType), notes: StringType,
 *             operations: ArrayType(OperationType),   // no column — shown as sub rows
 *             bookings: ArrayType(BookingType),       // no column — shown as sub rows
 *         });
 *         const OrderType = StructType({ id: StringType, name: StringType, jobs: ArrayType(JobType) });
 *         const orders = $.let(State.bind([ArrayType(OrderType)], "sheet_subrows_orders", [
 *             { id: "wo-1042", name: "WO-1042 · Frames", jobs: [
 *                 { task: "Assemble frames", qty: some(40.0), notes: "Two benches", operations: [
 *                     { id: "WO-1042-1", code: "CUT", name: "Cut rails to length", materials: ["Rail stock × 80"], station: some("Saw 2"), by: none },
 *                     { id: "WO-1042-2", code: "ASM", name: "Assemble frame", materials: ["M6 bolts × 12", "Frame kit"], station: some("Bench 7"), by: some("Assembly") },
 *                 ], bookings: [
 *                     variant("labour", { team: "Assembly", people: 2n, hours: 12.0 }),
 *                     variant("equipment", { resource: "Torque driver" }),
 *                 ] },
 *                 { task: "Inspect frames", qty: some(40.0), notes: "", operations: [], bookings: [
 *                     variant("space", { area: "Test bay", units: 2n }),
 *                 ] },
 *             ] },
 *             { id: "wo-1043", name: "WO-1043 · Housings", jobs: [
 *                 { task: "Paint housings", qty: some(250.0), notes: "Primer first", operations: [
 *                     { id: "WO-1043-1", code: "PNT", name: "Prime and paint", materials: ["Primer", "Topcoat"], station: none, by: none },
 *                 ], bookings: [] },
 *             ] },
 *         ]));
 *         return (
 *             <Sheet
 *                 data={orders}
 *                 id="id"
 *                 group={Sheet.group(OrderType, "jobs", { title: "name", noun: { singular: "order", plural: "orders" } })}
 *                 columns={{
 *                     task:  Sheet.column.text(JobType, { header: "Task", width: "220px" }),
 *                     qty:   Sheet.column.quantity(JobType, { header: "Qty", width: "96px" }),
 *                     notes: Sheet.column.text(JobType, { header: "Notes", width: "240px" }),
 *                 }}
 *                 subRows={Sheet.subRows(JobType, {
 *                     operations: (op) => Sheet.subRow({
 *                         code:   op.code,
 *                         name:   op.name,
 *                         chips:  op.materials,
 *                         facets: { station: op.station, by: op.by },   // a none drops out
 *                         id:     op.id,
 *                     }),
 *                     bookings: (b) => b.match({
 *                         space:     (_$2, s) => Sheet.subRow({ code: "CLAIM", name: East.str`${s.area} · ${s.units} units` }),
 *                         labour:    (_$2, l) => Sheet.subRow({ code: "LABOUR", name: East.str`${l.team} · ${l.people} people · ${l.hours} person-hours` }),
 *                         equipment: (_$2, e) => Sheet.subRow({ code: "EQUIPMENT", name: e.resource }),
 *                     }),
 *                 })}
 *                 newRow={East.function([Sheet.Types.NewRow], Sheet.Types.Patch(JobType), () => Sheet.patch(JobType, { notes: "", operations: [], bookings: [] }))}
 *                 newGroup={East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(OrderType), () => Sheet.patch(OrderType, { jobs: [] }))}
 *                 onUpdate={orders.write}
 *                 style={{ height: "420px" }}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function createSubRows<R extends StructType>(rowType: R, sources: SheetSubRowSources<R>): SheetSubRowsValue<R> {
    return { rowType, sources };
}

/**
 * The literal-record input of `Sheet.subRow({ … })`.
 *
 * @property code - The lead's code; an `Option` becomes its value or `""`
 * @property name - The lead's words
 * @property chips - The detail's parameter chips
 * @property facets - Label → value, in display order; a `none` value drops the facet
 * @property id - The record the sub row traces to; an `Option` becomes its value or `""`
 */
export interface SheetSubRowInput {
    /** The lead's code. */
    code?: SubtypeExprOrValue<StringType | OptionType<StringType>>;
    /** The lead's words. */
    name: SubtypeExprOrValue<StringType>;
    /** The detail's parameter chips. */
    chips?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Label → value; a `none` value drops the facet. */
    facets?: Record<string, SubtypeExprOrValue<StringType | OptionType<StringType>>>;
    /** The record the sub row traces to. */
    id?: SubtypeExprOrValue<StringType | OptionType<StringType>>;
}

/** A `String` or `Option<String>` input as an `Option<String>` expression, its shape read once at build time. */
function optionalText(v: SubtypeExprOrValue<StringType | OptionType<StringType>>): ExprType<OptionType<StringType>> {
    if (typeof v === "string") return East.value(some(v), OptionType(StringType));
    if (v instanceof Expr) {
        if (Expr.type(v as Expr<EastType>) === StringType) {
            return East.value(some(v as ExprType<StringType>), OptionType(StringType));
        }
        return v as ExprType<OptionType<StringType>>;
    }
    return East.value(v as SubtypeExprOrValue<OptionType<StringType>>, OptionType(StringType));
}

/** A `String` or `Option<String>` input as display text, `""` for none. */
function textOrBlank(v: SubtypeExprOrValue<StringType | OptionType<StringType>> | undefined): ExprType<StringType> {
    if (v === undefined) return East.value("", StringType);
    return optionalText(v).match({ some: (_$, s) => s, none: (_$) => "" });
}

/**
 * Builds one sub row — `Sheet.subRow({ code?, name, chips?, facets?, id? })`.
 * What is left out is filled in: `code` and `id` become `""`, `chips` and
 * `facets` `[]`; a facet whose value is `none` drops out.
 *
 * @param input - The sub row's fields ({@link SheetSubRowInput})
 * @returns An expression of `Sheet.Types.SubRow`
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, East, FloatType, IntegerType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Reactive, Sheet, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const OperationType = StructType({
 *             id: StringType, code: StringType, name: StringType, materials: ArrayType(StringType),
 *             station: OptionType(StringType), by: OptionType(StringType),
 *         });
 *         const BookingType = VariantType({
 *             space:     StructType({ area: StringType, units: IntegerType }),
 *             labour:    StructType({ team: StringType, people: IntegerType, hours: FloatType }),
 *             equipment: StructType({ resource: StringType }),
 *         });
 *         const JobType = StructType({
 *             task: StringType, qty: OptionType(FloatType), notes: StringType,
 *             operations: ArrayType(OperationType),   // no column — shown as sub rows
 *             bookings: ArrayType(BookingType),       // no column — shown as sub rows
 *         });
 *         const OrderType = StructType({ id: StringType, name: StringType, jobs: ArrayType(JobType) });
 *         const orders = $.let(State.bind([ArrayType(OrderType)], "sheet_subrows_orders", [
 *             { id: "wo-1042", name: "WO-1042 · Frames", jobs: [
 *                 { task: "Assemble frames", qty: some(40.0), notes: "Two benches", operations: [
 *                     { id: "WO-1042-1", code: "CUT", name: "Cut rails to length", materials: ["Rail stock × 80"], station: some("Saw 2"), by: none },
 *                     { id: "WO-1042-2", code: "ASM", name: "Assemble frame", materials: ["M6 bolts × 12", "Frame kit"], station: some("Bench 7"), by: some("Assembly") },
 *                 ], bookings: [
 *                     variant("labour", { team: "Assembly", people: 2n, hours: 12.0 }),
 *                     variant("equipment", { resource: "Torque driver" }),
 *                 ] },
 *                 { task: "Inspect frames", qty: some(40.0), notes: "", operations: [], bookings: [
 *                     variant("space", { area: "Test bay", units: 2n }),
 *                 ] },
 *             ] },
 *             { id: "wo-1043", name: "WO-1043 · Housings", jobs: [
 *                 { task: "Paint housings", qty: some(250.0), notes: "Primer first", operations: [
 *                     { id: "WO-1043-1", code: "PNT", name: "Prime and paint", materials: ["Primer", "Topcoat"], station: none, by: none },
 *                 ], bookings: [] },
 *             ] },
 *         ]));
 *         return (
 *             <Sheet
 *                 data={orders}
 *                 id="id"
 *                 group={Sheet.group(OrderType, "jobs", { title: "name", noun: { singular: "order", plural: "orders" } })}
 *                 columns={{
 *                     task:  Sheet.column.text(JobType, { header: "Task", width: "220px" }),
 *                     qty:   Sheet.column.quantity(JobType, { header: "Qty", width: "96px" }),
 *                     notes: Sheet.column.text(JobType, { header: "Notes", width: "240px" }),
 *                 }}
 *                 subRows={Sheet.subRows(JobType, {
 *                     operations: (op) => Sheet.subRow({
 *                         code:   op.code,
 *                         name:   op.name,
 *                         chips:  op.materials,
 *                         facets: { station: op.station, by: op.by },   // a none drops out
 *                         id:     op.id,
 *                     }),
 *                     bookings: (b) => b.match({
 *                         space:     (_$2, s) => Sheet.subRow({ code: "CLAIM", name: East.str`${s.area} · ${s.units} units` }),
 *                         labour:    (_$2, l) => Sheet.subRow({ code: "LABOUR", name: East.str`${l.team} · ${l.people} people · ${l.hours} person-hours` }),
 *                         equipment: (_$2, e) => Sheet.subRow({ code: "EQUIPMENT", name: e.resource }),
 *                     }),
 *                 })}
 *                 newRow={East.function([Sheet.Types.NewRow], Sheet.Types.Patch(JobType), () => Sheet.patch(JobType, { notes: "", operations: [], bookings: [] }))}
 *                 newGroup={East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(OrderType), () => Sheet.patch(OrderType, { jobs: [] }))}
 *                 onUpdate={orders.write}
 *                 style={{ height: "420px" }}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function createSubRow(input: SheetSubRowInput): ExprType<SheetSubRowType> {
    const facets = Object.entries(input.facets ?? {}).map(([label, value]) =>
        optionalText(value).match({
            some: (_$, v) => East.value(some({ label, value: v }), OptionType(SheetFacetType)),
            none: (_$) => East.value(none, OptionType(SheetFacetType)),
        }));
    return East.value({
        code:   textOrBlank(input.code),
        name:   input.name,
        chips:  input.chips ?? East.value([], ArrayType(StringType)),
        facets: East.value(facets, ArrayType(OptionType(SheetFacetType))).filterMap((_$, f) => f),
        id:     textOrBlank(input.id),
    }, SheetSubRowType);
}
