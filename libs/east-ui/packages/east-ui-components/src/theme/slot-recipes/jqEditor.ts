/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * jq editor slot recipe (#937) — the query builder's jq view, as the Query
 * Editor spec draws it (§4.8): the code area, a grid of the gutter and the
 * code, scrolling as one and as wide as its longest line; the problems panel
 * under it; and the completions, under the caret.
 *
 * - **The gutter**: a `line` per line of the code — its `dot` (`data-severity`
 *   `error`, `warning` or `note`: the worst problem starting on it) and its
 *   number.
 * - **The code**: the `highlight` layer of `codeLine`s of `token`s, behind the
 *   `input`, a text field whose text is transparent. A token's `data-kind` is
 *   east's lexer's (`keyword`, `builtin`, `field`, `variable`, `string`,
 *   `number`, `pipe`, `operator`, `punctuation`, `comment`, `format`,
 *   `identifier`, `other`), its `data-mark` the problem it is part of (`error`
 *   and `warning` wavy, `note` dotted) and `data-active` the range the panel
 *   went to. `measure` is the hidden run of characters the character's width
 *   is measured by.
 * - **The completions**: over the `popover` recipe's `content` and `footer`
 *   and the `combobox` recipe's `item`, a `completion` is its `glyph`, its
 *   `completionLabel` and its `completionDetail` (`data-warn`: a field only one
 *   case has); the footer is the active one's `completionDoc` and the keys.
 * - **The problems panel**: its `summary` — the `status` recipe's dot and word,
 *   and the `hint` — then the `problemList` of `problem`s (`data-severity`),
 *   each a `problemGo` button of its `problemHead` (`problemCode`,
 *   `problemAt`) and `problemMessage`, and its `problemFixes`.
 *
 * The renderer sets the data attributes; its one inline style is the
 * completions' measured position.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** A line of code, and of the gutter. */
const LINE = "20px";
/** The code's size. */
const CODE = "12.5px";
/** The mock's second ink — numbers. */
const INK_2 = { base: "brand.700", _dark: "gray.300" } as const;
/** The mock's fifth ink — line numbers and a note's dot. */
const INK_5 = { base: "gray.400", _dark: "gray.600" } as const;

/** The code's type: mono, ligatures off, one line per line. */
const codeType = {
    fontFamily: "mono",
    fontSize: CODE,
    fontWeight: "normal",
    lineHeight: LINE,
    fontVariantLigatures: "none",
    whiteSpace: "pre",
} as const;

export const jqEditorSlotRecipe = defineSlotRecipe({
    className: "elara-jq-editor",
    slots: [
        "root", "editor", "content", "gutter", "line", "dot", "code", "highlight", "codeLine", "token", "input", "measure",
        "completions", "completionList", "completion", "glyph", "completionLabel", "completionDetail", "completionFooter",
        "completionDoc", "completionKeys",
        "problems", "summary", "hint", "problemList", "problem", "problemDot", "problemGo", "problemHead", "problemCode",
        "problemAt", "problemMessage", "problemFixes",
    ],
    base: {
        root: {
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            background: "bg.surface",
        },
        /* The code area: the gutter and the code scroll together. */
        editor: {
            flex: "1",
            minHeight: "0",
            overflow: "auto",
        },
        /* As wide as the longest line, and at least the area; at least as tall. */
        content: {
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            width: "max-content",
            minWidth: "100%",
            minHeight: "100%",
        },
        gutter: {
            minWidth: "44px",
            paddingBlock: "{spacing.3}",
            background: "bg.panel",
            borderInlineEndWidth: "1px",
            borderInlineEndColor: "border.subtle",
            userSelect: "none",
        },
        line: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "6px",
            height: LINE,
            paddingInlineEnd: "10px",
            paddingInlineStart: "{spacing.2}",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "medium",
            lineHeight: LINE,
            fontVariantNumeric: "tabular-nums",
            color: INK_5,
        },
        dot: {
            width: "6px",
            height: "6px",
            borderRadius: "{radii.full}",
            flexShrink: "0",
            "&[data-severity=error]": { background: "fg.danger" },
            "&[data-severity=warning]": { background: "fg.warning" },
            "&[data-severity=note]": { background: INK_5 },
        },
        code: {
            position: "relative",
            minWidth: "0",
        },
        /* The highlighting: behind the text field, never pointed at. */
        highlight: {
            ...codeType,
            paddingBlock: "{spacing.3}",
            paddingInline: "{spacing.4}",
            color: "fg",
            pointerEvents: "none",
        },
        codeLine: {
            height: LINE,
            whiteSpace: "pre",
        },
        token: {
            "&[data-kind=keyword]": { color: "brand.fg", fontWeight: "semibold" },
            "&[data-kind=variable]": { color: "brand.fg", fontWeight: "medium" },
            "&[data-kind=builtin], &[data-kind=format]": { color: "brand.solid", fontWeight: "medium" },
            "&[data-kind=field], &[data-kind=identifier]": { color: "fg" },
            "&[data-kind=string]": { color: "fg.muted" },
            "&[data-kind=comment]": { color: "fg.subtle" },
            "&[data-kind=number]": { color: INK_2, fontWeight: "medium" },
            "&[data-kind=pipe]": { color: "fg.subtle", fontWeight: "semibold" },
            "&[data-kind=operator], &[data-kind=punctuation]": { color: "fg.subtle" },
            "&[data-kind=other]": { color: "fg.danger" },
            "&[data-mark]": {
                textDecorationLine: "underline",
                textDecorationThickness: "1px",
                textUnderlineOffset: "4px",
            },
            "&[data-mark=error]": { textDecorationStyle: "wavy", textDecorationColor: "fg.danger" },
            "&[data-mark=warning]": { textDecorationStyle: "wavy", textDecorationColor: "fg.warning" },
            "&[data-mark=note]": { textDecorationStyle: "dotted", textDecorationColor: "fg.subtle" },
            "&[data-active]": { background: "bg.brand.subtle" },
        },
        /* The text field in front: the code's whole area, its text transparent
         * over the highlighting, unframed and unwrapped, never scrolling itself. */
        input: {
            ...codeType,
            position: "absolute",
            inset: "0",
            display: "block",
            width: "100%",
            height: "100%",
            margin: "0",
            paddingBlock: "{spacing.3}",
            paddingInline: "{spacing.4}",
            border: "0",
            outline: "none",
            resize: "none",
            overflow: "hidden",
            overflowWrap: "normal",
            background: "transparent",
            color: "transparent",
            WebkitTextFillColor: "transparent",
            caretColor: "fg",
            tabSize: "2",
        },
        /* Fifty characters, out of sight: their width over fifty is a character's. */
        measure: {
            ...codeType,
            position: "absolute",
            top: "0",
            insetInlineStart: "0",
            visibility: "hidden",
            pointerEvents: "none",
        },
        /* Over the popover's content: under the caret, in the code's coordinates. */
        completions: {
            position: "absolute",
            zIndex: "1",
            width: "360px",
            minWidth: "0",
            padding: "0",
            overflow: "hidden",
        },
        /* The completions scroll, the active one kept in view. */
        completionList: {
            position: "relative",
            maxHeight: "232px",
            overflowY: "auto",
            padding: "{spacing.1}",
        },
        /* Over the combobox's item. */
        completion: {
            height: "30px",
            gap: "10px",
            paddingBlock: "0",
            paddingInline: "{spacing.2}",
            borderRadius: "{radii.sm}",
            _highlighted: { background: "bg.brand.subtle" },
        },
        glyph: {
            width: "16px",
            flexShrink: "0",
            textAlign: "center",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.04em",
            lineHeight: "1",
            color: "fg.subtle",
        },
        completionLabel: {
            fontFamily: "mono",
            fontSize: CODE,
            fontWeight: "medium",
            lineHeight: "1",
            color: "fg",
            whiteSpace: "nowrap",
        },
        completionDetail: {
            marginInlineStart: "auto",
            minWidth: "0",
            fontFamily: "mono",
            fontSize: "11px",
            lineHeight: "1",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "&[data-warn]": { color: "fg.warning" },
        },
        /* Over the popover's footer: the active completion's doc, and the keys. */
        completionFooter: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minHeight: "30px",
            paddingBlock: "6px",
            paddingInline: "{spacing.3}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            background: "bg.panel",
            fontSize: "xs",
            lineHeight: "1.4",
            color: "fg.muted",
        },
        completionDoc: {
            flex: "1",
            minWidth: "0",
        },
        completionKeys: {
            flexShrink: "0",
        },
        /* The problems panel, under the code. */
        problems: {
            flexShrink: "0",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        summary: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            height: "32px",
            paddingInline: "{spacing.4}",
        },
        hint: {
            marginInlineStart: "auto",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "medium",
            letterSpacing: "0.08em",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        problemList: {
            maxHeight: "150px",
            overflowY: "auto",
        },
        problem: {
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            paddingBlock: "7px",
            paddingInline: "{spacing.4}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            fontSize: "{fontSizes.control}",
            lineHeight: "1.45",
            _hover: { background: "bg.panel" },
        },
        /* Over the status recipe's indicator: level with the first line. */
        problemDot: {
            marginTop: "6px",
        },
        problemGo: {
            flex: "1",
            minWidth: "0",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            padding: "0",
            border: "0",
            background: "transparent",
            textAlign: "start",
            font: "inherit",
            color: "fg",
            cursor: "pointer",
            _disabled: { cursor: "default" },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" },
        },
        problemHead: {
            display: "flex",
            alignItems: "baseline",
            gap: "{spacing.2}",
        },
        problemCode: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            lineHeight: "1",
            "&[data-severity=error]": { color: "fg.danger" },
            "&[data-severity=warning]": { color: "fg.warning" },
            "&[data-severity=note]": { color: "fg.subtle" },
        },
        problemAt: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "medium",
            lineHeight: "1",
            color: "fg.subtle",
        },
        problemMessage: {
            fontFamily: "mono",
            fontSize: "xs",
            color: INK_2,
            textWrap: "pretty",
        },
        problemFixes: {
            display: "flex",
            gap: "{spacing.1}",
            flexShrink: "0",
        },
    },
});
