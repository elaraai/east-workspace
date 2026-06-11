/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Grid>` tag — see the export's JSDoc.
 */

import { Grid as GridFactory } from "../../layout/grid/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Cell builder + types surfaced on the `<Grid>` tag (mirrors the `Grid` factory namespace). */
type GridBuilders = {
    Item: typeof GridFactory.Item;
    Types: typeof GridFactory.Types;
};

/**
 * A two-dimensional CSS grid — lay cells out across explicit columns and rows.
 * Reach for it for dashboards, galleries, and named-area page shells where
 * content needs to align on both axes; for one-dimensional flow use
 * {@link Flex} or {@link VStack} / {@link HStack}. Cells are passed as `items`
 * (each built with `Grid.Item(content, style?)`), and the track definitions
 * (`templateColumns`/`templateRows`/`templateAreas`), `gap`/`columnGap`/
 * `rowGap`, `autoFlow`, and cell alignment are flat props ({@link GridStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Grid, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const gallery = East.function([], UIComponentType, _$ => (
 *     <Grid
 *         items={[
 *             Grid.Item(<Box padding="3" background="gray.200"><Text>Full Width Header</Text></Box>, { colSpan: "3" }),
 *             Grid.Item(<Box padding="2" background="gray.100"><Text>Col 1</Text></Box>),
 *             Grid.Item(<Box padding="2" background="gray.100"><Text>Col 2</Text></Box>),
 *             Grid.Item(<Box padding="2" background="gray.100"><Text>Col 3</Text></Box>),
 *         ]}
 *         templateColumns="repeat(3, 1fr)"
 *         gap="3"
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries the `Grid.Item(content, style?)` cell builder ({@link GridItemStyle}
 * controls `colSpan`/`rowSpan`/`area`) and `Grid.Types` — the East data type,
 * the style structs, and the auto-flow enum. Desugars to `Grid.Root(items,
 * options)`.
 */
export const Grid: JsxTag<ValueProps<typeof GridFactory.Root, "items">> & GridBuilders =
    Object.assign(leaf(GridFactory.Root, "items"), {
        Item: GridFactory.Item,
        Types: GridFactory.Types,
    });
