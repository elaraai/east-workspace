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
    type SheetBindHandle,
} from "../../collections/sheet/index.js";
import type { DataRowType } from "../../collections/table/index.js";
import { hasKeys } from "../combinators.js";
import type { UIElement } from "../runtime.js";

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
 * import { East, ArrayType, DateTimeType, FloatType, OptionType, StringType, StructType, none } from "@elaraai/east";
 * import { Reactive, Sheet, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const JobType = StructType({ id: StringType, start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType) });
 *
 * const jobs = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const rows = $.let(State.bind([ArrayType(JobType)], "jobs", [{ id: "j1", start: none, task: "Transfer", qty: none }]));
 *         return (
 *             <Sheet
 *                 data={rows.read()}
 *                 id="id"
 *                 columns={{
 *                     start: Sheet.column.date(JobType, { header: "Start", sub: "d/m · fri · +3d" }),
 *                     task:  Sheet.column.text(JobType, { header: "Task" }),
 *                     qty:   Sheet.column.quantity(JobType, { header: "Qty" }),
 *                 }}
 *                 onUpdate={rows.write}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries the whole authoring namespace — `Sheet.column.*` (the builders),
 * `Sheet.register.members` / `.concat`, `Sheet.driver`, `Sheet.link.arity` /
 * `.check` / `.parse` / `.print`, `Sheet.patch`, and `Sheet.Types.*` (the
 * closed wire types plus the typed constructors `Context(R, D)` / `Fill(T)` /
 * `Patch(R)` / `Proposal(R)` / `Edit(R)` / `CheckContext(R)`). Desugars to
 * `Sheet.Root(data, columns, options)`.
 */
export const Sheet: typeof SheetTag & {
    column: typeof SheetFactory.column;
    register: typeof SheetFactory.register;
    driver: typeof SheetFactory.driver;
    link: typeof SheetFactory.link;
    patch: typeof SheetFactory.patch;
    Types: typeof SheetFactory.Types;
} = Object.assign(SheetTag, {
    column: SheetFactory.column,
    register: SheetFactory.register,
    driver: SheetFactory.driver,
    link: SheetFactory.link,
    patch: SheetFactory.patch,
    Types: SheetFactory.Types,
});
