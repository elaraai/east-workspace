/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sheet>` tag — see the export's JSDoc.
 */

import type { SubtypeExprOrValue, ArrayType, DictType, StringType, StructType } from "@elaraai/east";
import type { PagedSource } from "../../contracts/source.js";
import {
    Sheet as SheetFactory,
    type SheetColumnSpec,
    type SheetOptions,
    type SheetGroupedOptions,
    type SheetEntriesOptions,
    type SheetEntryOf,
    type SheetBindHandle,
    type SheetLinesField,
    type SheetLineOf,
    type SheetNamespace,
} from "../../collections/sheet/index.js";
import type { DataRowType } from "../../collections/table/index.js";
import { hasKeys } from "../combinators.js";
import type { UIElement } from "../runtime.js";

/**
 * `<Sheet data={entries} id="id" group={Sheet.group(P, "lines", …)} columns={{ … }} />`
 * — GROUPED rows with LOOSE rows between the groups (#846): `data` holds
 * `Sheet.Types.Entry(P, "lines")` entries, each a group or a row of the
 * line type; `columns` are declared over the line type.
 */
function SheetTag<P extends StructType, F extends SheetLinesField<P>>(
    props: {
        data: NoInfer<SubtypeExprOrValue<ArrayType<SheetEntryOf<P, F>>> | SheetBindHandle<SheetEntryOf<P, F>> | PagedSource<ArrayType<SheetEntryOf<P, F>>> | PagedSource<DictType<StringType, SheetEntryOf<P, F>>>>;
        columns: SheetColumnSpec<SheetLineOf<P, F>>;
    } & SheetEntriesOptions<P, F>,
): UIElement;
/**
 * `<Sheet data={plans} id="id" group={Sheet.group(P, "lines", …)} columns={{ … }} />`
 * — GROUPED rows (#740): the rows are groups, `columns` are declared over
 * the line type the group's lines field holds.
 */
function SheetTag<T extends SubtypeExprOrValue<ArrayType<StructType>>, F extends SheetLinesField<DataRowType<T>>>(
    props: { data: T; columns: SheetColumnSpec<SheetLineOf<DataRowType<T>, F>> } & SheetGroupedOptions<DataRowType<T>, F>,
): UIElement;
/** GROUPED rows over a whole-value bind handle of groups. */
function SheetTag<P extends StructType, F extends SheetLinesField<P>>(
    props: { data: SheetBindHandle<P>; columns: SheetColumnSpec<SheetLineOf<P, F>> } & SheetGroupedOptions<P, F>,
): UIElement;
/** GROUPED rows over a paged source of groups. */
function SheetTag<P extends StructType, F extends SheetLinesField<P>>(
    props: { data: PagedSource<ArrayType<P>> | PagedSource<DictType<StringType, P>>; columns: SheetColumnSpec<SheetLineOf<P, F>> } & SheetGroupedOptions<P, F>,
): UIElement;
/**
 * `<Sheet data={rows} id="id" columns={{ … }} />` — the planning spreadsheet.
 * Maps to `Sheet.Root`. `columns` is typed as `SheetColumnSpec<R>` (a mapped
 * type over the row's fields), so a key that is not a data field, or a
 * column whose kind cannot sit on the field, is a type error.
 */
function SheetTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T; columns: SheetColumnSpec<DataRowType<T>> } & SheetOptions<DataRowType<T>>,
): UIElement;
/** The whole-value bind handle — `data={jobs}` builds the same IR as `data={jobs.read()}`. */
function SheetTag<R extends StructType>(
    props: { data: SheetBindHandle<R>; columns: SheetColumnSpec<R> } & SheetOptions<R>,
): UIElement;
/** The PAGED arm — a windowed source of the same rows, positional or keyed;
 *  the row type rides structurally in its `page` signature. */
function SheetTag<R extends StructType>(
    props: { data: PagedSource<ArrayType<R>> | PagedSource<DictType<StringType, R>>; columns: SheetColumnSpec<R> } & SheetOptions<R>,
): UIElement;
function SheetTag(
    props: { data: unknown; columns: unknown },
): UIElement {
    const { data, columns, ...options } = props as { data: unknown; columns: unknown } & Record<string, unknown>;
    return (SheetFactory.Root as (d: unknown, c: unknown, o?: unknown) => UIElement)(
        data,
        columns,
        hasKeys(options) ? options : undefined,
    );
}

// The tag IS the root, so `Root` is the one factory member it does not carry.
// Derived, never hand-listed: a member added to `SheetNamespace` rides the tag
// with no edit here (#862, as #814 did for the Plan).
const { Root: _root, ...authoring } = SheetFactory;

/**
 * The planning spreadsheet — rows are the host's records, columns are TYPED
 * (`Sheet.column.date` / `quantity` / `lookup` / `reference` / `enum` /
 * `set` / `link` / `stamped` / `custom` / `text` / `integer`, each taking the
 * row type first), a blank tail invites the next row, search runs through a
 * bound slice as a lens that keeps row numbers, and a copilot fills cells
 * and proposes whole rows from rules written as East functions
 * ({@link SheetOptions}). Not a `Table`: a Table displays and sorts; a Sheet
 * is typed, edited in place, padded with blank rows and completed by a
 * copilot.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, DateTimeType, East, FloatType, OptionType, StringType, StructType, none } from "@elaraai/east";
 * import { Reactive, Sheet, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const JobType = StructType({
 *             id:    StringType,
 *             start: OptionType(DateTimeType),   // none = blank cell
 *             task:  StringType,                 // "" = blank cell
 *             qty:   OptionType(FloatType),
 *         });
 *         const jobs = $.let(State.bind([ArrayType(JobType)], "sheet_basic_jobs", [
 *             { id: "j1", start: none, task: "Machining", qty: none },
 *         ]));
 *         return (
 *             <Sheet
 *                 data={jobs}
 *                 id="id"
 *                 columns={{
 *                     start: Sheet.column.date(JobType, { header: "Start", sub: "dd / mm / yyyy" }),
 *                     task:  Sheet.column.text(JobType, { header: "Task" }),
 *                     qty:   Sheet.column.quantity(JobType, { header: "Qty" }),   // no driver on this sheet — the two-argument form
 *                 }}
 *                 onUpdate={jobs.write}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries the factory namespace except `Root` (the tag is the root):
 * `Sheet.column.*` (the builders), `Sheet.register.members` / `.concat`,
 * `Sheet.driver`, `Sheet.link.arity` / `.check` / `.parse` / `.print`,
 * `Sheet.patch`, `Sheet.apply` (a checked batch applied to a collection),
 * `Sheet.group` / `Sheet.group.cell.*` (grouped rows, #740 — with loose rows
 * between the groups over `Sheet.Types.Entry` entries, #846), `Sheet.subRows`
 * / `Sheet.subRow` (sub rows, #844), and `Sheet.Types.*` (the closed wire
 * types plus the typed constructors, among them `DraftContext(R, D)` /
 * `Fill(T)` / `Patch(R)` / `Proposal(R)` / `CheckContext(R)` / `Draft(R)` /
 * `PatchEvent(E)` / `ChangeSet(E)` / `Entry(G, "rows")`). Desugars to
 * `Sheet.Root(data, columns, options)`.
 */
export const Sheet: typeof SheetTag & Omit<SheetNamespace, "Root"> = Object.assign(SheetTag, authoring);
