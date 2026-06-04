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

/** `<Table data={rows} columns={["name", "age"]} striped />` — schema-typed table. Maps to `Table.Root`. */
export function Table<
    T extends SubtypeExprOrValue<ArrayType<StructType>>,
    C extends ColumnSpec<T> = ColumnSpec<T>,
>(
    props: { data: T; columns: C } & TableOptions<DataFieldKeys<T>>,
): UIElement {
    const { data, columns, ...options } = props as { data: T; columns: C } & Record<string, unknown>;
    return TableFactory.Root(
        data,
        columns,
        (hasKeys(options) ? options : undefined) as TableOptions<DataFieldKeys<T>>,
    );
}
