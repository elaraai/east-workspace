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
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const BuilderPart = StructType({ id: StringType, code: StringType, name: StringType, materials: ArrayType(StringType), station: OptionType(StringType) });
 * export const BuilderBooking = VariantType({
 *     labour:    StructType({ team: StringType, people: IntegerType, hours: FloatType }),
 *     equipment: StructType({ resource: StringType }),
 * });
 * export const BuilderStep = StructType({ task: StringType, qty: OptionType(FloatType), parts: ArrayType(BuilderPart), bookings: ArrayType(BuilderBooking) });
 * export const BuilderBatch = StructType({ id: StringType, name: StringType, steps: ArrayType(BuilderStep) });
 * export const BuilderDay = StructType({ batches: ArrayType(BuilderBatch) });
 * export const sheetBuilderDays = e3.record("sheet_builder_days", DictType(StringType, BuilderDay), new Map([
 *     ["2026-10-12", { batches: [
 *         { id: "B-101", name: "Doors, oak", steps: [
 *             { task: "Cut doors", qty: some(12.0), parts: [
 *                 { id: "B-101-1", code: "CUT", name: "Cut the door blanks", materials: ["Oak veneered board × 6"], station: some("S101") },
 *             ], bookings: [variant("labour", { team: "Cutting", people: 1n, hours: 3.0 })] },
 *             { task: "Band doors", qty: some(48.0), parts: [], bookings: [variant("equipment", { resource: "Edge bander E201" })] },
 *             { task: "Spray doors", qty: some(12.0), parts: [
 *                 { id: "B-101-3", code: "SPR", name: "Seal and lacquer", materials: ["Sealer", "Matt lacquer"], station: none },
 *             ], bookings: [] },
 *         ] },
 *         { id: "B-102", name: "Carcasses, birch", steps: [
 *             { task: "Cut carcasses", qty: some(8.0), parts: [], bookings: [] },
 *             { task: "Drill carcasses", qty: some(8.0), parts: [], bookings: [variant("labour", { team: "Machining", people: 2n, hours: 2.5 })] },
 *         ] },
 *         { id: "B-103", name: "Shelves, ash", steps: [
 *             { task: "Cut shelves", qty: some(20.0), parts: [], bookings: [] },
 *             { task: "Sand shelves", qty: some(20.0), parts: [], bookings: [] },
 *         ] },
 *     ] }],
 * ]));
 * export const sheetBuilderDaysPatch = e3.mutation.patch(sheetBuilderDays);
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const days = $.let(Record.bind(sheetBuilderDays, [sheetBuilderDaysPatch]));
 *         // The steps a finishing batch starts with: the batch template's lines.
 *         const finishing = $.let([
 *             { task: "Sand", qty: none, parts: [], bookings: [] },
 *             { task: "Seal", qty: none, parts: [], bookings: [] },
 *             { task: "Spray", qty: none, parts: [], bookings: [] },
 *         ], ArrayType(BuilderStep));
 *         // A batch needs a name before Apply.
 *         const readyBatch = $.const(East.function([Sheet.Types.DraftGroup(BuilderBatch, "steps")], Sheet.Types.Readiness, ($, batch) => {
 *             $.if(batch.name.hasTag("value").and(() => batch.name.unwrap("value").length().equal(0n)), $ => {
 *                 $.return(East.value(variant("incomplete", [{ field: "name", message: "Name the batch" }]), Sheet.Types.Readiness));
 *             });
 *             return East.value(variant("ready", null), Sheet.Types.Readiness);
 *         }));
 *         const newStep = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(BuilderStep), () => Sheet.patch(BuilderStep, { qty: none, parts: [], bookings: [] })));
 *         const newBatch = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(BuilderBatch), () => Sheet.patch(BuilderBatch, { steps: [] })));
 *         return (
 *             <Box height="560px">
 *                 <Sheet.Builder
 *                     record={days}
 *                     entry={{ key: "2026-10-12", rows: "batches", id: "id" }}
 *                     group={Sheet.group(BuilderBatch, "steps", { title: "name", noun: { singular: "batch", plural: "batches" } })}
 *                     id="batches"
 *                     columns={{
 *                         task: Sheet.column.text(BuilderStep, { header: "Step", width: "240px" }),
 *                         qty:  Sheet.column.quantity(BuilderStep, { header: "Qty", width: "96px" }),
 *                     }}
 *                     subRows={Sheet.subRows(BuilderStep, {
 *                         parts: (p) => Sheet.subRow({
 *                             code:   p.code,
 *                             name:   p.name,
 *                             chips:  p.materials,
 *                             facets: { station: p.station },   // a none drops out
 *                             id:     p.id,
 *                         }),
 *                         bookings: (b) => b.match({
 *                             labour:    (_$2, l) => Sheet.subRow({ code: "LABOUR", name: East.str`${l.team} · ${l.people} people · ${l.hours} hours` }),
 *                             equipment: (_$2, e) => Sheet.subRow({ code: "EQUIPMENT", name: e.resource }),
 *                         }),
 *                     })}
 *                     // The sub rows show a step's parts and bookings; its form leaves them out.
 *                     fields={{ parts: Sheet.field.hidden(), bookings: Sheet.field.hidden() }}
 *                     templates={{
 *                         groups: [{ key: "finishing", name: "Finishing batch", group: "Batches",
 *                                    values: Sheet.patch(BuilderBatch, { name: "Finishing", steps: finishing }) }],
 *                         rows:   [{ key: "sand", name: "Sand", group: "Steps", values: Sheet.patch(BuilderStep, { task: "Sand", qty: none }) },
 *                                  { key: "seal", name: "Seal", group: "Steps", values: Sheet.patch(BuilderStep, { task: "Seal", qty: none }) }],
 *                     }}
 *                     library={[Sheet.library.rows(), Sheet.library.columns()]}
 *                     ready={{ group: readyBatch }}
 *                     newRow={newStep}
 *                     newGroup={newBatch}
 *                 />
 *             </Box>
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
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const BuilderPart = StructType({ id: StringType, code: StringType, name: StringType, materials: ArrayType(StringType), station: OptionType(StringType) });
 * export const BuilderBooking = VariantType({
 *     labour:    StructType({ team: StringType, people: IntegerType, hours: FloatType }),
 *     equipment: StructType({ resource: StringType }),
 * });
 * export const BuilderStep = StructType({ task: StringType, qty: OptionType(FloatType), parts: ArrayType(BuilderPart), bookings: ArrayType(BuilderBooking) });
 * export const BuilderBatch = StructType({ id: StringType, name: StringType, steps: ArrayType(BuilderStep) });
 * export const BuilderDay = StructType({ batches: ArrayType(BuilderBatch) });
 * export const sheetBuilderDays = e3.record("sheet_builder_days", DictType(StringType, BuilderDay), new Map([
 *     ["2026-10-12", { batches: [
 *         { id: "B-101", name: "Doors, oak", steps: [
 *             { task: "Cut doors", qty: some(12.0), parts: [
 *                 { id: "B-101-1", code: "CUT", name: "Cut the door blanks", materials: ["Oak veneered board × 6"], station: some("S101") },
 *             ], bookings: [variant("labour", { team: "Cutting", people: 1n, hours: 3.0 })] },
 *             { task: "Band doors", qty: some(48.0), parts: [], bookings: [variant("equipment", { resource: "Edge bander E201" })] },
 *             { task: "Spray doors", qty: some(12.0), parts: [
 *                 { id: "B-101-3", code: "SPR", name: "Seal and lacquer", materials: ["Sealer", "Matt lacquer"], station: none },
 *             ], bookings: [] },
 *         ] },
 *         { id: "B-102", name: "Carcasses, birch", steps: [
 *             { task: "Cut carcasses", qty: some(8.0), parts: [], bookings: [] },
 *             { task: "Drill carcasses", qty: some(8.0), parts: [], bookings: [variant("labour", { team: "Machining", people: 2n, hours: 2.5 })] },
 *         ] },
 *         { id: "B-103", name: "Shelves, ash", steps: [
 *             { task: "Cut shelves", qty: some(20.0), parts: [], bookings: [] },
 *             { task: "Sand shelves", qty: some(20.0), parts: [], bookings: [] },
 *         ] },
 *     ] }],
 * ]));
 * export const sheetBuilderDaysPatch = e3.mutation.patch(sheetBuilderDays);
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const days = $.let(Record.bind(sheetBuilderDays, [sheetBuilderDaysPatch]));
 *         // The steps a finishing batch starts with: the batch template's lines.
 *         const finishing = $.let([
 *             { task: "Sand", qty: none, parts: [], bookings: [] },
 *             { task: "Seal", qty: none, parts: [], bookings: [] },
 *             { task: "Spray", qty: none, parts: [], bookings: [] },
 *         ], ArrayType(BuilderStep));
 *         // A batch needs a name before Apply.
 *         const readyBatch = $.const(East.function([Sheet.Types.DraftGroup(BuilderBatch, "steps")], Sheet.Types.Readiness, ($, batch) => {
 *             $.if(batch.name.hasTag("value").and(() => batch.name.unwrap("value").length().equal(0n)), $ => {
 *                 $.return(East.value(variant("incomplete", [{ field: "name", message: "Name the batch" }]), Sheet.Types.Readiness));
 *             });
 *             return East.value(variant("ready", null), Sheet.Types.Readiness);
 *         }));
 *         const newStep = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(BuilderStep), () => Sheet.patch(BuilderStep, { qty: none, parts: [], bookings: [] })));
 *         const newBatch = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(BuilderBatch), () => Sheet.patch(BuilderBatch, { steps: [] })));
 *         return (
 *             <Box height="560px">
 *                 <Sheet.Builder
 *                     record={days}
 *                     entry={{ key: "2026-10-12", rows: "batches", id: "id" }}
 *                     group={Sheet.group(BuilderBatch, "steps", { title: "name", noun: { singular: "batch", plural: "batches" } })}
 *                     id="batches"
 *                     columns={{
 *                         task: Sheet.column.text(BuilderStep, { header: "Step", width: "240px" }),
 *                         qty:  Sheet.column.quantity(BuilderStep, { header: "Qty", width: "96px" }),
 *                     }}
 *                     subRows={Sheet.subRows(BuilderStep, {
 *                         parts: (p) => Sheet.subRow({
 *                             code:   p.code,
 *                             name:   p.name,
 *                             chips:  p.materials,
 *                             facets: { station: p.station },   // a none drops out
 *                             id:     p.id,
 *                         }),
 *                         bookings: (b) => b.match({
 *                             labour:    (_$2, l) => Sheet.subRow({ code: "LABOUR", name: East.str`${l.team} · ${l.people} people · ${l.hours} hours` }),
 *                             equipment: (_$2, e) => Sheet.subRow({ code: "EQUIPMENT", name: e.resource }),
 *                         }),
 *                     })}
 *                     // The sub rows show a step's parts and bookings; its form leaves them out.
 *                     fields={{ parts: Sheet.field.hidden(), bookings: Sheet.field.hidden() }}
 *                     templates={{
 *                         groups: [{ key: "finishing", name: "Finishing batch", group: "Batches",
 *                                    values: Sheet.patch(BuilderBatch, { name: "Finishing", steps: finishing }) }],
 *                         rows:   [{ key: "sand", name: "Sand", group: "Steps", values: Sheet.patch(BuilderStep, { task: "Sand", qty: none }) },
 *                                  { key: "seal", name: "Seal", group: "Steps", values: Sheet.patch(BuilderStep, { task: "Seal", qty: none }) }],
 *                     }}
 *                     library={[Sheet.library.rows(), Sheet.library.columns()]}
 *                     ready={{ group: readyBatch }}
 *                     newRow={newStep}
 *                     newGroup={newBatch}
 *                 />
 *             </Box>
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
