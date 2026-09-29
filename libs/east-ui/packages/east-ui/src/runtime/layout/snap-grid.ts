/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<SnapGrid>` tag — see the export's JSDoc. */

import {
    SnapGrid as SnapGridFactory,
    type SnapGridConfig,
    type SnapGridData,
    type SnapGridRowOf,
} from "../../layout/snap-grid/index.js";
import type { UIElement } from "../runtime.js";

/**
 * `<SnapGrid>` — the host's rows as tiles, in rows on a 12-column grid: the
 * Studio's canvas, a published page, and (`variant="wireframe"`) the page
 * library's thumbnails. `data` is an `Array` or a `Dict` of rows, inline or a
 * bound handle; `cell` maps one row to its tile with `SnapGrid.cell`. With
 * `edit` and `editing` over an `Array`, it is the builder's canvas: tiles
 * move, resize, drop and go as drafts of the shared editing session.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, East, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { SnapGrid, Stat, UIComponentType } from "@elaraai/east-ui";
 *
 * const Tile = StructType({ id: StringType, row: StringType, span: IntegerType, label: StringType, value: IntegerType });
 *
 * const page = East.function([], UIComponentType, ($) => {
 *     const tiles = $.const([
 *         { id: "orders", row: "kpis", span: 6n, label: "Orders", value: 128n },
 *         { id: "returns", row: "kpis", span: 6n, label: "Returns", value: 4n },
 *     ], ArrayType(Tile));
 *     return <SnapGrid data={tiles} width="1440px"
 *         cell={t => SnapGrid.cell({ key: t.id, row: t.row, span: t.span, content: <Stat label={t.label} value={t.value} /> })} />;
 * });
 * ```
 *
 * @remarks
 * Carries `SnapGrid.cell`, `SnapGrid.uiState`, `SnapGrid.viewState` and `SnapGrid.Types`. Desugars to `SnapGrid.Root(data, config)`.
 */
function SnapGridTag<T extends SnapGridData>(props: { data: T } & SnapGridConfig<SnapGridRowOf<T>>): UIElement {
    const { data, ...config } = props;
    return SnapGridFactory.Root(data, config);
}

// The tag IS the root, so `Root` is the one factory member it does not carry.
const { Root: _root, ...authoring } = SnapGridFactory;

/** The callable `<SnapGrid>` tag, carrying `SnapGrid.cell`, `SnapGrid.uiState`, `SnapGrid.viewState` and `SnapGrid.Types`. */
export const SnapGrid = Object.assign(SnapGridTag, authoring);
