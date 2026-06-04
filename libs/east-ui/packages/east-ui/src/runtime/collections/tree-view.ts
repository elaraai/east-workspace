/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Collection `<TreeView>` tag — hierarchical tree. Maps to `TreeView.Root`. */

import { TreeView as TreeViewFactory } from "../../collections/tree-view/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Node + type builders carried alongside the `<TreeView>` tag. */
type TreeViewBuilders = {
    Item: typeof TreeViewFactory.Item;
    Branch: typeof TreeViewFactory.Branch;
    Types: typeof TreeViewFactory.Types;
};

/**
 * `<TreeView nodes={[TreeView.Item(…)]} />` — hierarchical tree. Maps to
 * `TreeView.Root`. Build the `nodes` array with the carried `TreeView.Item`
 * (leaf) and `TreeView.Branch` (expandable) builders.
 */
export const TreeView: JsxTag<ValueProps<typeof TreeViewFactory.Root, "nodes">> & TreeViewBuilders =
    Object.assign(leaf(TreeViewFactory.Root, "nodes"), {
        Item: TreeViewFactory.Item,
        Branch: TreeViewFactory.Branch,
        Types: TreeViewFactory.Types,
    });
