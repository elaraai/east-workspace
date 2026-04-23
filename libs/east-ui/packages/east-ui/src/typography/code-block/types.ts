/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    FloatType,
    OptionType,
    StringType,
    StructType,
    BooleanType,
    ArrayType,
    IntegerType,
    VariantType,
    NullType,
} from "@elaraai/east";

import { OverflowType } from "../../style.js";
import type { OverflowLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Language Type
// ============================================================================

/**
 * Programming language variant type for syntax highlighting.
 *
 * @remarks
 * These languages are pre-registered with the syntax highlighter.
 * Create instances using `variant("typescript", null)` or the string shorthand.
 *
 * @property typescript - TypeScript language
 * @property javascript - JavaScript language
 * @property json - JSON format
 * @property html - HTML markup
 * @property css - CSS styles
 * @property python - Python language
 * @property rust - Rust language
 * @property go - Go language
 * @property sql - SQL queries
 * @property bash - Bash/shell scripts
 * @property markdown - Markdown text
 * @property yaml - YAML configuration
 * @property xml - XML markup
 * @property diff - Unified-diff (patch) syntax highlighting
 * @property plaintext - Plain text (no highlighting)
 */
export const CodeLanguageType = VariantType({
    typescript: NullType,
    javascript: NullType,
    json: NullType,
    html: NullType,
    css: NullType,
    python: NullType,
    rust: NullType,
    go: NullType,
    sql: NullType,
    bash: NullType,
    markdown: NullType,
    yaml: NullType,
    xml: NullType,
    diff: NullType,
    plaintext: NullType,
});

export type CodeLanguageType = typeof CodeLanguageType;

/** String literal union for language shortcuts */
export type CodeLanguage =
    | "typescript"
    | "javascript"
    | "json"
    | "html"
    | "css"
    | "python"
    | "rust"
    | "go"
    | "sql"
    | "bash"
    | "markdown"
    | "yaml"
    | "xml"
    | "diff"
    | "plaintext";

// ============================================================================
// CodeBlock Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the CodeBlock component.
 *
 * Holds colour slots (background / borderColor / headerBackground /
 * lineNumberColor / highlightBackground) and layout / sizing / opacity.
 * Consumed via `CodeBlockType.style`.
 */
export const CodeBlockVisualStyleType = StructType({
    // Colour slots
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    headerBackground: OptionType(StringType),
    lineNumberColor: OptionType(StringType),
    highlightBackground: OptionType(StringType),
    // Layout / sizing
    maxHeight: OptionType(StringType),
    overflow: OptionType(OverflowType),
    overflowX: OptionType(OverflowType),
    overflowY: OptionType(OverflowType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    minWidth: OptionType(StringType),
    minHeight: OptionType(StringType),
    maxWidth: OptionType(StringType),
    padding: OptionType(PaddingType),
    margin: OptionType(MarginType),
    // Opacity
    opacity: OptionType(FloatType),
});

export type CodeBlockVisualStyleType = typeof CodeBlockVisualStyleType;

// ============================================================================
// CodeBlock Type
// ============================================================================

/**
 * The concrete East type for CodeBlock component data.
 *
 * @property code - The code content to display
 * @property language - Programming language for syntax highlighting
 * @property showLineNumbers - Whether to show line numbers (wiring flag)
 * @property highlightLines - Line numbers to highlight
 * @property showCopyButton - Whether to show copy-to-clipboard button (wiring flag)
 * @property wordWrap - Whether to enable word wrapping (wiring flag)
 * @property title - Optional title displayed in the header (e.g., filename)
 * @property style - Visual-presentation sub-struct
 */
export const CodeBlockType = StructType({
    code: StringType,
    language: OptionType(CodeLanguageType),
    showLineNumbers: OptionType(BooleanType),
    highlightLines: OptionType(ArrayType(IntegerType)),
    showCopyButton: OptionType(BooleanType),
    wordWrap: OptionType(BooleanType),
    title: OptionType(StringType),
    style: OptionType(CodeBlockVisualStyleType),
});

export type CodeBlockType = typeof CodeBlockType;

// ============================================================================
// CodeBlock Style (TS interface)
// ============================================================================

/**
 * Style / configuration for CodeBlock components.
 *
 * Flat at the factory boundary for ergonomics; the IR separates
 * content / config (language, showLineNumbers, highlightLines, showCopyButton,
 * wordWrap, title) from visual-presentation fields (maxHeight, dimensions,
 * overflow, colour slots, padding, margin, opacity) — the visual fields wrap
 * into `CodeBlockType.style`.
 */
export type CodeBlockStyle = {
    /** Programming language for syntax highlighting */
    language?: SubtypeExprOrValue<CodeLanguageType> | CodeLanguage;
    /** Whether to show line numbers */
    showLineNumbers?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Line numbers to highlight */
    highlightLines?: SubtypeExprOrValue<ArrayType<IntegerType>>;
    /** Whether to show copy-to-clipboard button */
    showCopyButton?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Whether to enable word wrapping */
    wordWrap?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional title displayed in the header (e.g., filename) */
    title?: SubtypeExprOrValue<StringType>;
    /** Surface background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Header-row background colour */
    headerBackground?: SubtypeExprOrValue<StringType>;
    /** Line-number gutter colour */
    lineNumberColor?: SubtypeExprOrValue<StringType>;
    /** Highlight-row background colour */
    highlightBackground?: SubtypeExprOrValue<StringType>;
    /** Maximum height with scroll (e.g., "400px") */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Overflow behavior */
    overflow?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Horizontal overflow */
    overflowX?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Vertical overflow */
    overflowY?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Width */
    width?: SubtypeExprOrValue<StringType>;
    /** Height */
    height?: SubtypeExprOrValue<StringType>;
    /** Min width */
    minWidth?: SubtypeExprOrValue<StringType>;
    /** Min height */
    minHeight?: SubtypeExprOrValue<StringType>;
    /** Max width */
    maxWidth?: SubtypeExprOrValue<StringType>;
    /** Padding configuration */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin configuration */
    margin?: SubtypeExprOrValue<MarginType> | string;
    /** CSS opacity (0-1) */
    opacity?: SubtypeExprOrValue<FloatType>;
};
