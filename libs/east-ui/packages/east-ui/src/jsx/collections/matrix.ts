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
export function Matrix<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & MatrixConfig<RowElement<T>>,
): UIElement {
    const { data, ...config } = props;
    return MatrixFactory.Root(data, config as MatrixConfig<RowElement<T>>);
}
