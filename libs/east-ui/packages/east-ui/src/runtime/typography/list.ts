/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<List>` tag — ordered / unordered list. Maps to `List.Root`. */

import { List as ListFactory } from "../../typography/list/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<List items={[List.Item("…")]} variant="unordered" />` — list. Maps to `List.Root`. */
export const List: JsxTag<ValueProps<typeof ListFactory.Root, "items">> =
    leaf(ListFactory.Root, "items");
