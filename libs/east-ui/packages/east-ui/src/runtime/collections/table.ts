/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Table>` tag — see the export's JSDoc.
 */

import type { ArrayType, ExprType, RecursiveType, StructType } from "@elaraai/east";
import type { PagedSource } from "../../contracts/source.js";
import {
    Table as TableFactory,
    type ColumnSpec,
    type DataFieldKeys,
    type DataRowType,
    type TableData,
    type TableOptions,
    type TableRowNode,
} from "../../collections/table/index.js";
import { hasKeys } from "../combinators.js";
import type { UIElement } from "../runtime.js";

/** A paged source's row as its accessors receive it — the struct, or a recursive row's node (#954). */
type PagedRowType<R> = TableRowNode<R> extends StructType ? TableRowNode<R> : StructType;

/**
 * `<Table data={rows} columns={["name", "age"]} striped />` — schema-typed
 * table. Maps to `Table.Root`. `columns` is typed directly as `ColumnSpec<T>`
 * (not an inferred generic) so an object-form column map gets excess-property
 * checked — a key that is not a data field is a type error. Recursive rows
 * nest with `tree` (#954), their accessors reading each row's node.
 */
function TableTag<T extends TableData>(
    props: { data: T; columns: ColumnSpec<T> } & TableOptions<DataFieldKeys<T>, DataRowType<T>>,
): UIElement;
/** The PAGED arm (#576) — `data` is a windowed source of the same rows; the
 *  row type rides structurally in its `page` signature, so `columns` is checked
 *  against it exactly as for an inline array. A source of recursive rows pages
 *  its top-level rows, each with its subtree (#954). */
function TableTag<R extends StructType | RecursiveType<StructType>>(
    props: { data: PagedSource<ArrayType<R>>; columns: ColumnSpec<ExprType<ArrayType<R>>> }
        & TableOptions<Extract<keyof PagedRowType<R>["fields"], string>, PagedRowType<R>>,
): UIElement;
function TableTag(
    props: { data: unknown; columns: unknown },
): UIElement {
    const { data, columns, ...options } = props as { data: unknown; columns: unknown } & Record<string, unknown>;
    return (TableFactory.Root as (d: unknown, c: unknown, o?: unknown) => UIElement)(
        data,
        columns,
        hasKeys(options) ? options : undefined,
    );
}

/**
 * Schema-typed data table — renders an array of struct rows as columns. The
 * row type drives everything: `columns` is a key list or a per-key config map
 * ({@link ColumnSpec}, with `header` / `width` / `value` sort-key / `render`
 * cell renderer / `aggregate` subtotal), and the remaining display props
 * (striped, density, frozen columns, row status, selection, pagination,
 * expandable rows, footer rows, column groups, interaction callbacks) are flat
 * ({@link TableOptions}). Rows nest to any depth with `tree={{ children }}`
 * (#954): a parent draws its own cells and, in an `aggregate` column, its
 * children's subtotal. Reach for it whenever tabular records need sorting,
 * selection, or rich cells.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Badge, Table, UIComponentType } from "@elaraai/east-ui";
 *
 * const users = East.function([], UIComponentType, _$ => (
 *     <Table
 *         variant="line"
 *         striped={true}
 *         data={[
 *             { name: "Alice", email: "alice@example.com", status: "Active" },
 *             { name: "Bob", email: "bob@example.com", status: "Active" },
 *         ]}
 *         columns={{
 *             name: { header: "Name" },
 *             email: { header: "Email" },
 *             status: {
 *                 header: "Status",
 *                 render: East.function([Table.Types.CellRenderContext], UIComponentType, (_$2, ctx) => (
 *                     <Badge variant="solid" colorPalette="blue">{ctx.cellValue.match({ String: (_$3, v) => v }, _$3 => "")}</Badge>
 *                 )),
 *             },
 *         }}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Table.Types` — the cell `render` callback takes a
 * `Table.Types.CellRenderContext` (row index, cell value, sort state), and the
 * interaction callbacks consume the matching event types
 * (`Table.Types.RowClickEvent`, `Table.Types.CellClickEvent`,
 * `Table.Types.RowSelectionEvent`, `Table.Types.SortEvent`, …). Desugars to
 * `Table.Root(data, columns, options)`.
 */
export const Table: typeof TableTag & { Types: typeof TableFactory.Types } =
    Object.assign(TableTag, { Types: TableFactory.Types });
