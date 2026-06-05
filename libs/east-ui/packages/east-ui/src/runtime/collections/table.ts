/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Table>` tag — see the export's JSDoc.
 */

import type { SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Table as TableFactory,
    type ColumnSpec,
    type DataFieldKeys,
    type TableOptions,
} from "../../collections/table/index.js";
import { hasKeys } from "../combinators.js";
import type { UIElement } from "../runtime.js";

/**
 * `<Table data={rows} columns={["name", "age"]} striped />` — schema-typed
 * table. Maps to `Table.Root`. `columns` is typed directly as `ColumnSpec<T>`
 * (not an inferred generic) so an object-form column map gets excess-property
 * checked — a key that is not a data field is a type error.
 */
function TableTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T; columns: ColumnSpec<T> } & TableOptions<DataFieldKeys<T>>,
): UIElement {
    const { data, columns, ...options } = props as { data: T; columns: ColumnSpec<T> } & Record<string, unknown>;
    return TableFactory.Root(
        data,
        columns,
        (hasKeys(options) ? options : undefined) as TableOptions<DataFieldKeys<T>>,
    );
}

/**
 * Schema-typed data table — renders an array of struct rows as columns. The
 * row type drives everything: `columns` is a key list or a per-key config map
 * ({@link ColumnSpec}, with `header` / `width` / `value` sort-key / `render`
 * cell renderer), and the remaining display props (striped, density, frozen
 * columns, row status, selection, pagination, expandable rows, footer rows,
 * column groups, interaction callbacks) are flat ({@link TableOptions}). Reach
 * for it whenever tabular records need sorting, selection, or rich cells.
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
