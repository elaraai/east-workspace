/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    type ExprType,
    East,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { OverflowType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import {
    CodeBlockType,
    CodeBlockVisualStyleType,
    CodeLanguageType,
    type CodeBlockStyle,
    type CodeLanguage,
} from "./types.js";

// Re-export types
export {
    CodeBlockType,
    CodeBlockVisualStyleType,
    CodeLanguageType,
    type CodeBlockStyle,
    type CodeLanguage,
} from "./types.js";

// ============================================================================
// CodeBlock Component
// ============================================================================

/**
 * Creates a CodeBlock component for displaying code with syntax highlighting.
 *
 * @param code - The code content to display
 * @param style - Optional configuration: language / showLineNumbers /
 *                highlightLines / showCopyButton / wordWrap / title land on
 *                the main struct; every visual field wraps into `style`.
 * @returns An East expression representing the code block component
 */
function createCodeBlock(
    code: SubtypeExprOrValue<StringType>,
    style?: CodeBlockStyle
): ExprType<UIComponentType> {
    const languageValue = style?.language !== undefined
        ? (typeof style.language === "string"
            ? East.value(variant(style.language as CodeLanguage, null), CodeLanguageType)
            : style.language)
        : undefined;

    const showLineNumbersValue = style?.showLineNumbers !== undefined ? style.showLineNumbers : undefined;
    const showCopyButtonValue = style?.showCopyButton !== undefined ? style.showCopyButton : undefined;

    const styleValue = style ? buildCodeBlockVisualStyle(style) : undefined;

    return East.value(variant("CodeBlock", {
        code: code,
        language: languageValue !== undefined ? variant("some", languageValue) : variant("none", null),
        showLineNumbers: showLineNumbersValue !== undefined ? variant("some", showLineNumbersValue) : variant("none", null),
        highlightLines: style?.highlightLines ? variant("some", style.highlightLines) : variant("none", null),
        showCopyButton: showCopyButtonValue !== undefined ? variant("some", showCopyButtonValue) : variant("none", null),
        wordWrap: style?.wordWrap !== undefined ? variant("some", style.wordWrap) : variant("none", null),
        title: style?.title ? variant("some", style.title) : variant("none", null),
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

function buildCodeBlockVisualStyle(
    style: CodeBlockStyle,
): ExprType<CodeBlockVisualStyleType> {
    const overflowValue = style.overflow
        ? (typeof style.overflow === "string"
            ? East.value(variant(style.overflow, null), OverflowType)
            : style.overflow)
        : undefined;

    const overflowXValue = style.overflowX
        ? (typeof style.overflowX === "string"
            ? East.value(variant(style.overflowX, null), OverflowType)
            : style.overflowX)
        : undefined;

    const overflowYValue = style.overflowY
        ? (typeof style.overflowY === "string"
            ? East.value(variant(style.overflowY, null), OverflowType)
            : style.overflowY)
        : undefined;

    const paddingValue = style.padding
        ? (typeof style.padding === "string"
            ? East.value({
                top: some(style.padding),
                right: some(style.padding),
                bottom: some(style.padding),
                left: some(style.padding),
            }, PaddingType)
            : style.padding)
        : undefined;

    const marginValue = style.margin
        ? (typeof style.margin === "string"
            ? East.value({
                top: some(style.margin),
                right: some(style.margin),
                bottom: some(style.margin),
                left: some(style.margin),
            }, MarginType)
            : style.margin)
        : undefined;

    return East.value({
        background: style.background ? some(style.background) : none,
        borderColor: style.borderColor ? some(style.borderColor) : none,
        headerBackground: style.headerBackground ? some(style.headerBackground) : none,
        lineNumberColor: style.lineNumberColor ? some(style.lineNumberColor) : none,
        highlightBackground: style.highlightBackground ? some(style.highlightBackground) : none,
        maxHeight: style.maxHeight ? some(style.maxHeight) : none,
        overflow: overflowValue ? some(overflowValue) : none,
        overflowX: overflowXValue ? some(overflowXValue) : none,
        overflowY: overflowYValue ? some(overflowYValue) : none,
        width: style.width ? some(style.width) : none,
        height: style.height ? some(style.height) : none,
        minWidth: style.minWidth ? some(style.minWidth) : none,
        minHeight: style.minHeight ? some(style.minHeight) : none,
        maxWidth: style.maxWidth ? some(style.maxWidth) : none,
        padding: paddingValue ? some(paddingValue) : none,
        margin: marginValue ? some(marginValue) : none,
        opacity: style.opacity !== undefined ? some(style.opacity) : none,
    }, CodeBlockVisualStyleType);
}

/**
 * CodeBlock component for displaying code blocks with syntax highlighting.
 *
 * @remarks
 * Use `CodeBlock.Root(code, style)` to create code blocks with optional
 * syntax highlighting, line numbers, and line highlighting. `language`,
 * `showLineNumbers`, `highlightLines`, `showCopyButton`, `wordWrap`, and
 * `title` live on the main struct (content + wiring flags); every visual
 * field (dimensions, overflow, colour slots, padding, margin, opacity)
 * wraps into the `style` sub-struct per the type-shape convention.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { CodeBlock, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return CodeBlock.Root(
 *         `function hello() {\n  console.log("Hello!");\n}`,
 *         {
 *             language: "typescript",
 *             showLineNumbers: true,
 *             highlightLines: [2n],
 *         }
 *     );
 * });
 * ```
 */
export const CodeBlock = {
    Root: createCodeBlock,
    Types: {
        CodeBlock: CodeBlockType,
        Language: CodeLanguageType,
        Style: CodeBlockVisualStyleType,
    },
} as const;
