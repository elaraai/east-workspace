/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Layout `<Grid>` tag — CSS grid of `Grid.Item` cells. Maps to `Grid.Root`. */

import { Grid as GridFactory } from "../../layout/grid/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Grid items={[Grid.Item(…)]} templateColumns="repeat(3, 1fr)" />` — CSS grid. Maps to `Grid.Root`. */
export const Grid: JsxTag<ValueProps<typeof GridFactory.Root, "items">> =
    leaf(GridFactory.Root, "items");
