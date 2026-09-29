/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Layout>` tag — see the export's JSDoc. */

import {
    Layout as LayoutFactory,
    type LayoutConfig,
    type LayoutData,
    type LayoutRowOf,
} from "../../collections/layout/index.js";
import type { UIElement } from "../runtime.js";

/**
 * `<Layout>` — the host's rows as tiles, in rows on a 12-column grid: the
 * Studio's canvas, a published page, and (`variant="wireframe"`) the page
 * library's thumbnails. `data` is an `Array` or a `Dict` of rows, inline or a
 * bound handle; `cell` maps one row to its tile with `Layout.cell`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, East, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { Layout, Stat, UIComponentType } from "@elaraai/east-ui";
 *
 * const Tile = StructType({ id: StringType, row: StringType, span: IntegerType, label: StringType, value: IntegerType });
 *
 * const page = East.function([], UIComponentType, ($) => {
 *     const tiles = $.const([
 *         { id: "orders", row: "kpis", span: 6n, label: "Orders", value: 128n },
 *         { id: "returns", row: "kpis", span: 6n, label: "Returns", value: 4n },
 *     ], ArrayType(Tile));
 *     return <Layout data={tiles} width="1440px"
 *         cell={t => Layout.cell({ key: t.id, row: t.row, span: t.span, content: <Stat label={t.label} value={t.value} /> })} />;
 * });
 * ```
 *
 * @remarks
 * Carries `Layout.cell` and `Layout.Types`. Desugars to `Layout.Root(data, config)`.
 */
function LayoutTag<T extends LayoutData>(props: { data: T } & LayoutConfig<LayoutRowOf<T>>): UIElement {
    const { data, ...config } = props;
    return LayoutFactory.Root(data, config);
}

// The tag IS the root, so `Root` is the one factory member it does not carry.
const { Root: _root, ...authoring } = LayoutFactory;

/** The callable `<Layout>` tag, carrying `Layout.cell` and `Layout.Types`. */
export const Layout = Object.assign(LayoutTag, authoring);
