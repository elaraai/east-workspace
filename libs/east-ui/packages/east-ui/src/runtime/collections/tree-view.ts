/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<TreeView>` tag — see the export's JSDoc.
 */

import { TreeView as TreeViewFactory } from "../../collections/tree-view/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Node + type builders carried alongside the `<TreeView>` tag. */
type TreeViewBuilders = {
    Item: typeof TreeViewFactory.Item;
    Branch: typeof TreeViewFactory.Branch;
    Types: typeof TreeViewFactory.Types;
};

/**
 * Hierarchical tree — collapsible nodes for file trees, org charts, category
 * navigation, and any nested structure. The `nodes` prop is the tree: build it
 * with the carried `TreeView.Item` (a leaf) and `TreeView.Branch` (an
 * expandable parent), each taking an id, a label, and an optional icon. The
 * remaining display props (`variant`, `size`, `selectionMode`,
 * `defaultExpandedValue`, colour overrides, selection / expansion / focus
 * callbacks) are flat ({@link TreeViewStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { TreeView, UIComponentType } from "@elaraai/east-ui";
 *
 * const fileTree = East.function([], UIComponentType, _$ => (
 *     <TreeView nodes={[
 *         TreeView.Branch("src", "src", [
 *             TreeView.Item("src-index", "index.ts"),
 *             TreeView.Item("src-utils", "utils.ts"),
 *         ]),
 *         TreeView.Item("package-json", "package.json"),
 *     ]} />
 * ));
 * ```
 *
 * @remarks
 * Carries `TreeView.Item` (leaf node), `TreeView.Branch` (expandable node), and
 * `TreeView.Types` for the node / event IR types. Desugars to
 * `TreeView.Root(nodes, options)`.
 */
export const TreeView: JsxTag<ValueProps<typeof TreeViewFactory.Root, "nodes">> & TreeViewBuilders =
    Object.assign(leaf(TreeViewFactory.Root, "nodes"), {
        Item: TreeViewFactory.Item,
        Branch: TreeViewFactory.Branch,
        Types: TreeViewFactory.Types,
    });
