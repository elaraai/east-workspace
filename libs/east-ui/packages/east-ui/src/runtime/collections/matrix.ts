/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Matrix>` tag — see the export's JSDoc.
 */

import type { SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Matrix as MatrixFactory,
    type MatrixConfig,
    type RowElement,
} from "../../collections/matrix/index.js";
import type { UIElement } from "../runtime.js";

/**
 * Maps `props` to `Matrix.Root(data, config)`, threading the data-row generic
 * `T` so the {@link MatrixConfig} closures (`rowKey` / `cell` / `groupBy` …)
 * infer their row parameter from the data schema.
 */
function MatrixTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & MatrixConfig<RowElement<T>>,
): UIElement {
    const { data, ...config } = props;
    return MatrixFactory.Root(data, config as MatrixConfig<RowElement<T>>);
}

/**
 * Heat-grid matrix — rows × columns where every cell is a stacked weight bar of
 * coloured segments. Use it for capacity / utilisation / allocation grids: each
 * row maps to a record, each column to an axis key, and the `cell` closure
 * builds the cell's segments from the row and column. The config closures
 * (`rowKey`, `rowHeader`, `rowSublabel`, `groupBy`, `cell`) and the display
 * options (`orientation`, `minLabelSize`, `legend`, interaction callbacks) live
 * on {@link MatrixConfig}. Segments can be drag-resizable and cells can carry
 * status markers and click popovers.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, FloatType } from "@elaraai/east";
 * import { Matrix, UIComponentType } from "@elaraai/east-ui";
 *
 * const utilisation = East.function([], UIComponentType, _$ => (
 *     <Matrix
 *         data={[
 *             { name: "Alice", booked: new Map([["mon", 0.45], ["tue", 0.70]]) },
 *             { name: "Bob", booked: new Map([["mon", 0.35], ["tue", 0.60]]) },
 *         ]}
 *         columns={[
 *             Matrix.column({ key: "mon", label: "Mon" }),
 *             Matrix.column({ key: "tue", label: "Tue" }),
 *         ]}
 *         rowKey={r => r.name}
 *         rowHeader="Resource"
 *         cell={(r, col) => Matrix.cell({ segments: [
 *             Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
 *             Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
 *         ] })}
 *         legend={[{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Matrix.column` (declare an x-axis column), `Matrix.cell` (assemble a
 * cell's segments / markers / popover), `Matrix.segment` (one weight band), and
 * `Matrix.marker` (a status-coloured corner ring), plus `Matrix.Types` for the
 * drag / click event types (`Matrix.Types.SegmentChangeEvent`,
 * `Matrix.Types.CellClickEvent`). Desugars to `Matrix.Root(data, config)`.
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
