/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * jq editor slot recipe (#935, #936) — the query builder's jq view, as the
 * Query Editor spec draws it: a gutter of line numbers beside the code,
 * filling the Query tab, and the problems panel under them. The code is a
 * text field (`input`), mono and unwrapped, which the highlighting lies
 * under; the view adds its slots — the highlighting, the problems' marks and
 * rows, the completions — with it (#937).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const jqEditorSlotRecipe = defineSlotRecipe({
    className: "elara-jq-editor",
    slots: ["root", "editor", "gutter", "code", "input", "problems"],
    base: {
        root: {
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
        },
        /* The gutter and the code, side by side, scrolling together. */
        editor: {
            flex: "1",
            minHeight: "0",
            display: "flex",
            overflow: "auto",
            fontFamily: "mono",
            fontSize: "sm",
            lineHeight: "1.6",
        },
        gutter: {
            flexShrink: "0",
            paddingX: "{spacing.2}",
            textAlign: "end",
            color: "fg.subtle",
            userSelect: "none",
        },
        code: {
            position: "relative",
            flex: "1",
            minWidth: "0",
            whiteSpace: "pre",
        },
        /* The code's text field: the code's whole area, unframed, unwrapped. */
        input: {
            display: "block",
            width: "100%",
            height: "100%",
            minHeight: "0",
            margin: "0",
            paddingY: "{spacing.3}",
            paddingX: "{spacing.4}",
            border: "0",
            outline: "none",
            resize: "none",
            background: "transparent",
            color: "fg",
            fontFamily: "inherit",
            fontSize: "inherit",
            lineHeight: "inherit",
            whiteSpace: "pre",
            overflowWrap: "normal",
            overflow: "auto",
            tabSize: "2",
        },
        /* The problems panel, under the code. */
        problems: {
            flexShrink: "0",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            fontSize: "xs",
        },
    },
});
