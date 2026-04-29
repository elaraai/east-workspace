/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    ArrayType,
    BooleanType,
    FunctionType,
    OptionType,
    StructType,
    VariantType,
    StringType,
    NullType,
} from "@elaraai/east";

// ============================================================================
// TreeView Variant Types
// ============================================================================

/**
 * TreeView variant type for visual styling.
 *
 * @remarks
 * Create instances using string literals or the variant function.
 *
 * @property subtle - Subtle background on hover/selection
 * @property solid - Solid background on hover/selection
 */
export const TreeViewVariantType = VariantType({
    subtle: NullType,
    solid: NullType,
});

/**
 * Type representing tree view variant values.
 */
export type TreeViewVariantType = typeof TreeViewVariantType;

/**
 * String literal type for tree view variant values.
 */
export type TreeViewVariantLiteral = "subtle" | "solid";

// ============================================================================
// TreeView Size Types
// ============================================================================

/**
 * TreeView size type for controlling node sizing.
 *
 * @remarks
 * TreeView uses its own size type (xs, sm, md) rather than the shared SizeType.
 *
 * @property xs - Extra small size
 * @property sm - Small size
 * @property md - Medium size (default)
 */
export const TreeViewSizeType = VariantType({
    xs: NullType,
    sm: NullType,
    md: NullType,
});

/**
 * Type representing tree view size values.
 */
export type TreeViewSizeType = typeof TreeViewSizeType;

/**
 * String literal type for tree view size values.
 */
export type TreeViewSizeLiteral = "xs" | "sm" | "md";

// ============================================================================
// TreeView Selection Mode
// ============================================================================

/**
 * TreeView selection mode type.
 *
 * @remarks
 * Selection behaviour is a main-struct config value (not visual), so it
 * lives on the main `TreeView` variant rather than under `style`.
 *
 * @property single - Only one node can be selected at a time
 * @property multiple - Multiple nodes can be selected
 */
export const TreeViewSelectionModeType = VariantType({
    single: NullType,
    multiple: NullType,
});

/**
 * Type representing tree view selection mode values.
 */
export type TreeViewSelectionModeType = typeof TreeViewSelectionModeType;

/**
 * String literal type for tree view selection mode values.
 */
export type TreeViewSelectionModeLiteral = "single" | "multiple";

// ============================================================================
// TreeView Style Types
// ============================================================================

/**
 * Style type for the tree view root component.
 *
 * @remarks
 * Per the 0 main/style type-shape convention, style carries only
 * visual fields. Selection mode (`selectionMode`), animation wiring
 * (`animateContent`), and callbacks (`onExpandedChange` /
 * `onSelectionChange` / `onFocusChange`) live on the main `TreeView`
 * variant.
 *
 * All properties are optional and wrapped in {@link OptionType}.
 *
 * @property size - Tree view size preset (xs / sm / md)
 * @property variant - Visual variant (subtle or solid)
 * @property itemColor - Explicit text colour override for items
 * @property itemHoverBackground - Explicit hover background override
 * @property selectedBackground - Explicit background colour for the selected node
 * @property selectedColor - Explicit text colour for the selected node
 * @property caretColor - Explicit colour for the branch caret/chevron icon
 * @property connectorColor - Explicit colour for the hierarchy connector lines
 */
export const TreeViewStyleType = StructType({
    size: OptionType(TreeViewSizeType),
    variant: OptionType(TreeViewVariantType),
    itemColor: OptionType(StringType),
    itemHoverBackground: OptionType(StringType),
    selectedBackground: OptionType(StringType),
    selectedColor: OptionType(StringType),
    caretColor: OptionType(StringType),
    connectorColor: OptionType(StringType),
});

/**
 * Type representing the tree view style structure.
 */
export type TreeViewStyleType = typeof TreeViewStyleType;

/**
 * TypeScript interface for tree view construction options.
 *
 * @remarks
 * Flat options bag that the factory splits internally: content / state
 * / behaviour fields populate the main `TreeView` variant; visual
 * fields populate the nested `style` sub-struct.
 *
 * Accepts both static values and East expressions.
 *
 * @property size - Tree view size preset (xs / sm / md) — visual
 * @property variant - Visual variant (subtle or solid) — visual
 * @property selectionMode - Selection behaviour (single or multiple) — main
 * @property animateContent - Whether to animate expand/collapse — main
 * @property defaultExpandedValue - Initially expanded node values — main
 * @property defaultSelectedValue - Initially selected node values — main
 * @property label - Accessible label for the tree view — main
 * @property onExpandedChange - Callback for expanded nodes change — main
 * @property onSelectionChange - Callback for selected nodes change — main
 * @property onFocusChange - Callback for focused node change — main
 * @property itemColor - Explicit text colour override for items — visual
 * @property itemHoverBackground - Explicit hover background override — visual
 * @property selectedBackground - Selected-node background override — visual
 * @property selectedColor - Selected-node text-colour override — visual
 * @property caretColor - Caret/chevron colour override — visual
 * @property connectorColor - Hierarchy-connector colour override — visual
 */
export interface TreeViewStyle {
    /** Tree view size (xs, sm, md). */
    size?: SubtypeExprOrValue<TreeViewSizeType> | TreeViewSizeLiteral;
    /** Visual variant (subtle or solid). */
    variant?: SubtypeExprOrValue<TreeViewVariantType> | TreeViewVariantLiteral;
    /** Selection behaviour (single or multiple). */
    selectionMode?: SubtypeExprOrValue<TreeViewSelectionModeType> | TreeViewSelectionModeLiteral;
    /** Whether to animate expand/collapse transitions. */
    animateContent?: SubtypeExprOrValue<BooleanType>;
    /** Initially expanded node values. */
    defaultExpandedValue?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Initially selected node values. */
    defaultSelectedValue?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Accessible label for the tree view. */
    label?: SubtypeExprOrValue<StringType>;
    /** Callback fired when the set of expanded nodes changes. */
    onExpandedChange?: SubtypeExprOrValue<FunctionType<[ArrayType<StringType>], NullType>>;
    /** Callback fired when the set of selected nodes changes. */
    onSelectionChange?: SubtypeExprOrValue<FunctionType<[ArrayType<StringType>], NullType>>;
    /** Callback fired when the focused node changes. */
    onFocusChange?: SubtypeExprOrValue<FunctionType<[OptionType<StringType>], NullType>>;
    /** Explicit text colour override for items. */
    itemColor?: SubtypeExprOrValue<StringType>;
    /** Explicit hover background override. */
    itemHoverBackground?: SubtypeExprOrValue<StringType>;
    /** Selected-node background override. */
    selectedBackground?: SubtypeExprOrValue<StringType>;
    /** Selected-node text-colour override. */
    selectedColor?: SubtypeExprOrValue<StringType>;
    /** Caret/chevron colour override. */
    caretColor?: SubtypeExprOrValue<StringType>;
    /** Hierarchy-connector colour override. */
    connectorColor?: SubtypeExprOrValue<StringType>;
}
