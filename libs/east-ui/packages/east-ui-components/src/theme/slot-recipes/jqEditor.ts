/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * jq editor slot recipe (#935) — the query builder's jq view, as the Query
 * Editor spec draws it: a gutter of line numbers beside the code, filling the
 * Query tab, and the problems panel under them. The view adds its slots —
 * the highlighting, the problems' marks and rows, the completions — with it
 * (#937).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const jqEditorSlotRecipe = defineSlotRecipe({
    className: "elara-jq-editor",
    slots: ["root", "editor", "gutter", "code", "problems"],
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
        /* The problems panel, under the code. */
        problems: {
            flexShrink: "0",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            fontSize: "xs",
        },
    },
});
