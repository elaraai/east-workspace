/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Collection `<Table>` tag — schema-typed data table. Maps to `Table.Root`.
 *
 * Unlike the combinator-built tags, Table is a hand-written generic tag: it
 * must thread the data-row generic `T` through so `columns` and the style
 * `valueFormat` / sort keys stay inferred from the data schema. `data` and
 * `columns` are flat props; the remaining `TableOptions` fields spread in.
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
 * `<Table data={rows} columns={…} />` — schema-typed table. Maps to
 * `Table.Root`. `Table.Types` is carried through for the event / render-context
 * types (`Table.Types.CellRenderContext`, `Table.Types.RowClickEvent`, …).
 */
export const Table: typeof TableTag & { Types: typeof TableFactory.Types } =
    Object.assign(TableTag, { Types: TableFactory.Types });
