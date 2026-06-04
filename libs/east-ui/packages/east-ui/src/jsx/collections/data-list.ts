/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Collection `<DataList>` tag — key/value detail list. Maps to `DataList.Root`. */

import { DataList as DataListFactory } from "../../collections/data-list/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<DataList items={[DataList.Item(…)]} />` — key/value detail list. Maps to `DataList.Root`. */
export const DataList: JsxTag<ValueProps<typeof DataListFactory.Root, "items">> =
    leaf(DataListFactory.Root, "items");
