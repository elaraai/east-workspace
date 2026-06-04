/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Collection `<Matrix>` tag — schema-typed cell matrix. Maps to `Matrix.Root`.
 *
 * Generic like `<Table>`: threads the data-row generic `T` so the config
 * closures (`rowKey` / `cell` / `rowValue` / `groupBy` …) stay inferred from
 * the data schema. `data` is a flat prop; the `MatrixConfig` fields spread in.
 */

import type { SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Matrix as MatrixFactory,
    type MatrixConfig,
    type RowElement,
} from "../../collections/matrix/index.js";
import type { UIElement } from "../runtime.js";

/** `<Matrix data={rows} columns={[…]} rowKey={r => r.name} cell={(r, col) => …} />` — schema-typed matrix. Maps to `Matrix.Root`. */
function MatrixTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & MatrixConfig<RowElement<T>>,
): UIElement {
    const { data, ...config } = props;
    return MatrixFactory.Root(data, config as MatrixConfig<RowElement<T>>);
}

/**
 * `<Matrix data={rows} … />` — schema-typed matrix. Maps to `Matrix.Root`. The
 * `Matrix.column` (x-axis) / `Matrix.segment` / `Matrix.cell` / `Matrix.marker`
 * builders and `Matrix.Types` are carried through so a single import wires the
 * whole grid.
 */
export const Matrix: typeof MatrixTag & {
    column: typeof MatrixFactory.column;
    segment: typeof MatrixFactory.segment;
    cell: typeof MatrixFactory.cell;
    marker: typeof MatrixFactory.marker;
    Types: typeof MatrixFactory.Types;
} = Object.assign(MatrixTag, {
    column: MatrixFactory.column,
    segment: MatrixFactory.segment,
    cell: MatrixFactory.cell,
    marker: MatrixFactory.marker,
    Types: MatrixFactory.Types,
});
