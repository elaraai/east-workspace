/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Collection `<TreeView>` tag — hierarchical tree. Maps to `TreeView.Root`. */

import { TreeView as TreeViewFactory } from "../../collections/tree-view/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<TreeView nodes={[TreeView.Item(…)]} />` — hierarchical tree. Maps to `TreeView.Root`. */
export const TreeView: JsxTag<ValueProps<typeof TreeViewFactory.Root, "nodes">> =
    leaf(TreeViewFactory.Root, "nodes");
