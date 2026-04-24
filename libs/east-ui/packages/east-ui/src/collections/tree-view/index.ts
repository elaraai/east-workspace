/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    OptionType,
    StructType,
    ArrayType,
    StringType,
    BooleanType,
    FunctionType,
    NullType,
    RecursiveType,
    variant,
    some,
    none,
    VariantType,
} from "@elaraai/east";

import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";

import {
    TreeViewVariantType,
    TreeViewSizeType,
    TreeViewSelectionModeType,
    TreeViewStyleType,
    type TreeViewStyle,
} from "./types.js";
import { UIComponentType } from "../../component.js";
import {
    IconType,
    IconSizeType,
    IconVariantType,
    IconStyleType,
    type IconStyle,
} from "../../display/icon/types.js";
import { ColorSchemeType } from "../../style.js";

// Re-export style types
export {
    TreeViewVariantType,
    TreeViewSizeType,
    TreeViewSelectionModeType,
    TreeViewStyleType,
    type TreeViewStyle,
} from "./types.js";

// ============================================================================
// TreeNode Type (Recursive)
// ============================================================================

/**
 * Recursive type for tree nodes.
 *
 * @remarks
 * Each node has a value (unique identifier), label (display text),
 * optional indicator icon, and children.
 *
 * @property Item - Leaf node variant with value, label and indicator
 * @property Branch - Expandable node with value, label, indicator, children and disabled state
 */
export const TreeNodeType = RecursiveType(self => VariantType({
    Item: StructType({
        value: StringType,
        label: StringType,
        indicator: OptionType(IconType),
    }),
    Branch: StructType({
        value: StringType,
        label: StringType,
        indicator: OptionType(IconType),
        children: ArrayType(self),
        disabled: OptionType(BooleanType),
    }),
}));

/**
 * Type representing the tree node structure.
 */
export type TreeNodeType = typeof TreeNodeType;

// ============================================================================
// TreeNode Variant Types
// ============================================================================

/**
 * East StructType for a leaf tree node (Item).
 *
 * @remarks
 * Items are leaf nodes in the tree hierarchy that cannot have children.
 * Use {@link TreeView.Item} factory function to create Item nodes.
 *
 * @property value - Unique identifier for the node
 * @property label - Display text for the node
 * @property indicator - Optional icon to display before the label
 */
export const TreeItemNodeType = StructType({
    value: StringType,
    label: StringType,
    indicator: OptionType(IconType),
});

/**
 * Type alias for TreeItemNodeType.
 */
export type TreeItemNodeType = typeof TreeItemNodeType;

/**
 * East StructType for a branch tree node (Branch).
 *
 * @remarks
 * Branches are expandable nodes that can contain child nodes (Items or
 * other Branches). Use {@link TreeView.Branch} factory function to
 * create Branch nodes.
 *
 * @property value - Unique identifier for the node
 * @property label - Display text for the node
 * @property indicator - Optional icon to display before the label
 * @property children - Array of child nodes (Items or Branches)
 * @property disabled - Whether the branch is disabled
 */
export const TreeBranchNodeType = StructType({
    value: StringType,
    label: StringType,
    indicator: OptionType(IconType),
    children: ArrayType(TreeNodeType),
    disabled: OptionType(BooleanType),
});

/**
 * Type alias for TreeBranchNodeType.
 */
export type TreeBranchNodeType = typeof TreeBranchNodeType;

// ============================================================================
// TreeView Root Type
// ============================================================================

/**
 * Standalone East StructType mirror of the inline `TreeView` variant in
 * `component.ts`.
 *
 * @remarks
 * Per the §0.10 main/style type-shape convention, content (`nodes`),
 * labels (`label`), initial state (`defaultExpandedValue` /
 * `defaultSelectedValue`), config (`selectionMode`), wiring
 * (`animateContent`), and behaviour (callbacks) live on the main
 * struct; only visual fields live under `style`.
 *
 * @property nodes - Array of root-level tree nodes
 * @property label - Optional accessible label for the tree view
 * @property defaultExpandedValue - Initially expanded node values
 * @property defaultSelectedValue - Initially selected node values
 * @property selectionMode - Selection behaviour (single / multiple)
 * @property animateContent - Whether to animate expand/collapse transitions
 * @property onExpandedChange - Callback fired when the expanded node set changes
 * @property onSelectionChange - Callback fired when the selected node set changes
 * @property onFocusChange - Callback fired when the focused node changes
 * @property style - Optional visual style sub-struct
 */
export const TreeViewRootType: StructType<{
    nodes: ArrayType<TreeNodeType>,
    label: OptionType<StringType>,
    defaultExpandedValue: OptionType<ArrayType<StringType>>,
    defaultSelectedValue: OptionType<ArrayType<StringType>>,
    selectionMode: OptionType<TreeViewSelectionModeType>,
    animateContent: OptionType<BooleanType>,
    onExpandedChange: OptionType<FunctionType<[ArrayType<StringType>], NullType>>,
    onSelectionChange: OptionType<FunctionType<[ArrayType<StringType>], NullType>>,
    onFocusChange: OptionType<FunctionType<[OptionType<StringType>], NullType>>,
    style: OptionType<TreeViewStyleType>,
}> = StructType({
    nodes: ArrayType(TreeNodeType),
    label: OptionType(StringType),
    defaultExpandedValue: OptionType(ArrayType(StringType)),
    defaultSelectedValue: OptionType(ArrayType(StringType)),
    selectionMode: OptionType(TreeViewSelectionModeType),
    animateContent: OptionType(BooleanType),
    onExpandedChange: OptionType(FunctionType([ArrayType(StringType)], NullType)),
    onSelectionChange: OptionType(FunctionType([ArrayType(StringType)], NullType)),
    onFocusChange: OptionType(FunctionType([OptionType(StringType)], NullType)),
    style: OptionType(TreeViewStyleType),
});

/**
 * Type representing the tree view root structure.
 */
export type TreeViewRootType = typeof TreeViewRootType;

// ============================================================================
// TreeNode Factory helpers
// ============================================================================

/**
 * Indicator icon configuration for tree nodes.
 *
 * @remarks
 * Extends {@link IconStyle} so styling properties are at the top level
 * of the object.
 */
export interface TreeNodeIndicator extends IconStyle {
    /** Font Awesome icon prefix (e.g., "fas", "far", "fab"). */
    prefix: IconPrefix;
    /** Font Awesome icon name (e.g., "folder", "file", "file-code"). */
    name: IconName;
}

function buildIndicatorValue(indicator?: TreeNodeIndicator) {
    if (!indicator) return none;
    const hasStyle = !!(indicator.size || indicator.variant || indicator.color || indicator.colorPalette);

    return some(East.value({
        prefix: indicator.prefix,
        name: indicator.name,
        label: none,
        style: hasStyle
            ? some(East.value({
                size: indicator.size
                    ? some(typeof indicator.size === "string"
                        ? East.value(variant(indicator.size, null), IconSizeType)
                        : indicator.size)
                    : none,
                variant: indicator.variant
                    ? some(typeof indicator.variant === "string"
                        ? East.value(variant(indicator.variant, null), IconVariantType)
                        : indicator.variant)
                    : none,
                color: indicator.color ? some(indicator.color) : none,
                background: none,
                colorPalette: indicator.colorPalette
                    ? some(typeof indicator.colorPalette === "string"
                        ? East.value(variant(indicator.colorPalette, null), ColorSchemeType)
                        : indicator.colorPalette)
                    : none,
                opacity: none,
                borderRadius: none,
                overflow: none,
                overflowX: none,
                overflowY: none,
                width: none,
                height: none,
                minWidth: none,
                minHeight: none,
                maxWidth: none,
                maxHeight: none,
                padding: none,
                margin: none,
            }, IconStyleType))
            : none,
    }, IconType));
}

/**
 * Creates a leaf tree node (Item) with no children.
 *
 * @param value - Unique identifier for the node
 * @param label - Display text for the node
 * @param indicator - Optional indicator icon with prefix, name, and styling
 * @returns An East expression representing the tree item
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { TreeView, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return TreeView.Root([
 *         TreeView.Item("readme", "README.md", { prefix: "far", name: "file" }),
 *         TreeView.Item("index", "index.ts", { prefix: "fas", name: "file-code", color: "blue.500" }),
 *     ]);
 * });
 * ```
 */
function createTreeItem(
    value: SubtypeExprOrValue<StringType>,
    label: SubtypeExprOrValue<StringType>,
    indicator?: TreeNodeIndicator,
): ExprType<TreeNodeType> {
    return East.value(variant("Item", {
        value: value,
        label: label,
        indicator: buildIndicatorValue(indicator),
    }), TreeNodeType);
}

/**
 * Creates a branch tree node that can contain children.
 *
 * @param value - Unique identifier for the node
 * @param label - Display text for the node
 * @param children - Array of child nodes
 * @param indicator - Optional indicator icon with prefix, name, and styling
 * @param disabled - Whether the branch is disabled
 * @returns An East expression representing the tree branch
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { TreeView, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return TreeView.Root([
 *         TreeView.Branch("src", "src", [
 *             TreeView.Branch("components", "components", [
 *                 TreeView.Item("button", "Button.tsx"),
 *             ]),
 *             TreeView.Item("index", "index.ts"),
 *         ], { prefix: "fas", name: "folder", color: "yellow.500" }),
 *     ]);
 * });
 * ```
 */
function createTreeBranch(
    value: SubtypeExprOrValue<StringType>,
    label: SubtypeExprOrValue<StringType>,
    children: SubtypeExprOrValue<ArrayType<TreeNodeType>>,
    indicator?: TreeNodeIndicator,
    disabled?: SubtypeExprOrValue<BooleanType>,
): ExprType<TreeNodeType> {
    return East.value(variant("Branch", {
        value: value,
        label: label,
        indicator: buildIndicatorValue(indicator),
        children: children,
        disabled: disabled !== undefined ? some(disabled) : none,
    }), TreeNodeType);
}

// ============================================================================
// Helpers
// ============================================================================

function buildTreeViewStyle(options: TreeViewStyle | undefined): ExprType<TreeViewStyleType> | undefined {
    if (options === undefined) return undefined;
    const hasAny = options.size !== undefined
        || options.variant !== undefined
        || options.itemColor !== undefined
        || options.itemHoverBackground !== undefined
        || options.selectedBackground !== undefined
        || options.selectedColor !== undefined
        || options.caretColor !== undefined
        || options.connectorColor !== undefined;
    if (!hasAny) return undefined;

    const sizeValue = options.size !== undefined
        ? (typeof options.size === "string"
            ? East.value(variant(options.size, null), TreeViewSizeType)
            : options.size)
        : undefined;

    const variantValue = options.variant !== undefined
        ? (typeof options.variant === "string"
            ? East.value(variant(options.variant, null), TreeViewVariantType)
            : options.variant)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        variant: variantValue ? some(variantValue) : none,
        itemColor: options.itemColor !== undefined ? some(options.itemColor) : none,
        itemHoverBackground: options.itemHoverBackground !== undefined ? some(options.itemHoverBackground) : none,
        selectedBackground: options.selectedBackground !== undefined ? some(options.selectedBackground) : none,
        selectedColor: options.selectedColor !== undefined ? some(options.selectedColor) : none,
        caretColor: options.caretColor !== undefined ? some(options.caretColor) : none,
        connectorColor: options.connectorColor !== undefined ? some(options.connectorColor) : none,
    }, TreeViewStyleType);
}

// ============================================================================
// TreeView Root Factory
// ============================================================================

/**
 * Creates a TreeView component with nodes, config, behaviour and styling.
 *
 * @param nodes - Array of root-level tree nodes (Item or Branch)
 * @param options - Flat options bag covering main-struct (selection /
 * callbacks / initial state) and visual style fields; the factory
 * splits them internally.
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Per the §0.10 main/style type-shape convention, visual fields
 * (`size`, `variant`, colour overrides) populate the `style`
 * sub-struct; everything else (`selectionMode`, `animateContent`,
 * `defaultExpandedValue`, `label`, and the three callbacks) populates
 * the main `TreeView` variant.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { TreeView, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return TreeView.Root([
 *         TreeView.Branch("src", "src", [
 *             TreeView.Item("index", "index.ts"),
 *             TreeView.Item("utils", "utils.ts"),
 *         ]),
 *         TreeView.Item("package", "package.json"),
 *     ], {
 *         variant: "subtle",
 *         size: "sm",
 *         selectionMode: "single",
 *     });
 * });
 * ```
 */
function createTreeView(
    nodes: SubtypeExprOrValue<ArrayType<TreeNodeType>>,
    options?: TreeViewStyle,
): ExprType<UIComponentType> {
    const nodesExpr = East.value(nodes, ArrayType(TreeNodeType));

    const selectionModeValue = options?.selectionMode !== undefined
        ? (typeof options.selectionMode === "string"
            ? East.value(variant(options.selectionMode, null), TreeViewSelectionModeType)
            : options.selectionMode)
        : undefined;

    const styleValue = buildTreeViewStyle(options);

    return East.value(variant("TreeView", {
        nodes: nodesExpr,
        label: options?.label !== undefined ? some(options.label) : none,
        defaultExpandedValue: options?.defaultExpandedValue !== undefined ? some(options.defaultExpandedValue) : none,
        defaultSelectedValue: options?.defaultSelectedValue !== undefined ? some(options.defaultSelectedValue) : none,
        selectionMode: selectionModeValue ? some(selectionModeValue) : none,
        animateContent: options?.animateContent !== undefined ? some(options.animateContent) : none,
        onExpandedChange: options?.onExpandedChange !== undefined ? some(options.onExpandedChange) : none,
        onSelectionChange: options?.onSelectionChange !== undefined ? some(options.onSelectionChange) : none,
        onFocusChange: options?.onFocusChange !== undefined ? some(options.onFocusChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// TreeView Namespace Export
// ============================================================================

interface TreeViewNamespace {
    Root: typeof createTreeView;
    Item: typeof createTreeItem;
    Branch: typeof createTreeBranch;
    Types: {
        Root: typeof TreeViewRootType;
        Node: typeof TreeNodeType;
        ItemNode: typeof TreeItemNodeType;
        BranchNode: typeof TreeBranchNodeType;
        Style: typeof TreeViewStyleType;
        Variant: typeof TreeViewVariantType;
        Size: typeof TreeViewSizeType;
        SelectionMode: typeof TreeViewSelectionModeType;
    };
}

/**
 * TreeView — hierarchical data display with expand/collapse and selection.
 *
 * @remarks
 * Use `TreeView.Item` for leaf nodes and `TreeView.Branch` for
 * expandable nodes. Per §0.10, selection behaviour and callbacks live
 * on the main struct while visual styling lives under the `style`
 * sub-struct.
 */
export const TreeView: TreeViewNamespace = {
    /**
     * Creates a TreeView component with nodes, config, behaviour and styling.
     *
     * @param nodes - Array of root-level tree nodes (Item or Branch)
     * @param options - Flat options bag; factory splits into main + style
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { TreeView, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return TreeView.Root([
     *         TreeView.Branch("src", "src", [
     *             TreeView.Item("index", "index.ts"),
     *             TreeView.Item("utils", "utils.ts"),
     *         ]),
     *         TreeView.Item("package", "package.json"),
     *     ], {
     *         variant: "subtle",
     *         size: "sm",
     *     });
     * });
     * ```
     */
    Root: createTreeView,
    /**
     * Creates a leaf tree node (Item) with no children.
     *
     * @param value - Unique identifier for the node
     * @param label - Display text for the node
     * @param indicator - Optional indicator icon with prefix, name, and styling
     * @returns An East expression representing the tree item
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { TreeView, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return TreeView.Root([
     *         TreeView.Item("readme", "README.md", { prefix: "far", name: "file" }),
     *         TreeView.Item("index", "index.ts", { prefix: "fas", name: "file-code", color: "blue.500" }),
     *     ]);
     * });
     * ```
     */
    Item: createTreeItem,
    /**
     * Creates a branch tree node that can contain children.
     *
     * @param value - Unique identifier for the node
     * @param label - Display text for the node
     * @param children - Array of child nodes
     * @param indicator - Optional indicator icon with prefix, name, and styling
     * @param disabled - Whether the branch is disabled
     * @returns An East expression representing the tree branch
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { TreeView, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return TreeView.Root([
     *         TreeView.Branch("src", "src", [
     *             TreeView.Branch("components", "components", [
     *                 TreeView.Item("button", "Button.tsx"),
     *             ]),
     *             TreeView.Item("index", "index.ts"),
     *         ], { prefix: "fas", name: "folder", color: "yellow.500" }),
     *     ]);
     * });
     * ```
     */
    Branch: createTreeBranch,
    Types: {
        /**
         * Standalone East StructType mirror of the inline `TreeView`
         * variant in `component.ts`.
         *
         * @remarks
         * Per §0.10, main carries content / state / behaviour; `style`
         * carries visual fields only.
         *
         * @property nodes - Array of root-level tree nodes
         * @property label - Optional accessible label
         * @property defaultExpandedValue - Initially expanded node values
         * @property defaultSelectedValue - Initially selected node values
         * @property selectionMode - Selection behaviour (single / multiple)
         * @property animateContent - Whether to animate expand/collapse
         * @property onExpandedChange - Expanded-set change callback
         * @property onSelectionChange - Selection-set change callback
         * @property onFocusChange - Focus change callback
         * @property style - Optional visual style sub-struct
         */
        Root: TreeViewRootType,
        /**
         * Recursive East variant type for tree nodes.
         *
         * @remarks
         * Union of `Item` (leaf) and `Branch` (expandable with
         * children). Children are themselves `TreeNodeType`s.
         *
         * @property Item - Leaf node (value, label, indicator)
         * @property Branch - Expandable node with children + optional disabled flag
         */
        Node: TreeNodeType,
        /**
         * East StructType for a leaf tree node (Item).
         *
         * @remarks
         * Use {@link TreeView.Item} to create Item nodes.
         *
         * @property value - Unique identifier for the node
         * @property label - Display text for the node
         * @property indicator - Optional icon shown before the label
         */
        ItemNode: TreeItemNodeType,
        /**
         * East StructType for a branch tree node (Branch).
         *
         * @remarks
         * Use {@link TreeView.Branch} to create Branch nodes.
         *
         * @property value - Unique identifier for the node
         * @property label - Display text for the node
         * @property indicator - Optional icon shown before the label
         * @property children - Array of child nodes
         * @property disabled - Whether the branch is disabled
         */
        BranchNode: TreeBranchNodeType,
        /**
         * East StructType holding every visual field for a TreeView.
         *
         * @remarks
         * Visual-only per §0.10. Selection / wiring / callbacks live on
         * the main struct.
         *
         * @property size - Size preset (xs / sm / md)
         * @property variant - Visual variant (subtle / solid)
         * @property itemColor - Explicit text colour override for items
         * @property itemHoverBackground - Explicit hover background override
         * @property selectedBackground - Selected-node background override
         * @property selectedColor - Selected-node text-colour override
         * @property caretColor - Caret/chevron colour override
         * @property connectorColor - Hierarchy-connector colour override
         */
        Style: TreeViewStyleType,
        /**
         * East VariantType for the TreeView visual variant.
         *
         * @property subtle - Subtle background on hover / selection
         * @property solid - Solid background on hover / selection
         */
        Variant: TreeViewVariantType,
        /**
         * East VariantType for the TreeView size preset.
         *
         * @property xs - Extra small size
         * @property sm - Small size
         * @property md - Medium size (default)
         */
        Size: TreeViewSizeType,
        /**
         * East VariantType for the TreeView selection mode.
         *
         * @property single - Only one node selected at a time
         * @property multiple - Multiple nodes can be selected
         */
        SelectionMode: TreeViewSelectionModeType,
    },
};
