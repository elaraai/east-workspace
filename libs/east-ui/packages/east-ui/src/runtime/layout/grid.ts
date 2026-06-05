/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Layout `<Grid>` tag — CSS grid of `Grid.Item` cells. Maps to `Grid.Root`.
 *
 * The `Item` cell builder is attached to the tag, so a single `Grid` import
 * gives both `<Grid …/>` and `Grid.Item(…)` — no separate factory import.
 */

import { Grid as GridFactory } from "../../layout/grid/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Cell builder + types surfaced on the `<Grid>` tag (mirrors the `Grid` factory namespace). */
type GridBuilders = {
    Item: typeof GridFactory.Item;
    Types: typeof GridFactory.Types;
};

/** `<Grid items={[Grid.Item(…)]} templateColumns="repeat(3, 1fr)" />` — CSS grid. Maps to `Grid.Root`. */
export const Grid: JsxTag<ValueProps<typeof GridFactory.Root, "items">> & GridBuilders =
    Object.assign(leaf(GridFactory.Root, "items"), {
        Item: GridFactory.Item,
        Types: GridFactory.Types,
    });
