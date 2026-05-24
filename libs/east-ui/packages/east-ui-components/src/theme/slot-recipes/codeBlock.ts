/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * CodeBlock slot recipe — multi-line code surface (mono, dark or light).
 *
 * Default is light surface with mono content. The showcase already uses
 * a dark variant; consumers can pass `colorScheme: "dark"` via Chakra's
 * adapter `meta` to render in the dark theme.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const codeBlockSlotRecipe = defineSlotRecipe({
    className: "elara-code-block",
    slots: [
        "root", "content", "code", "header", "title",
        "copyTrigger", "copyIndicator", "overlay", "control",
    ],
    base: {
        root: {
            background: "bg.subtle",
            borderRadius: "{radii.md}",
            borderWidth: "1px",
            borderColor: "border.subtle",
            overflow: "hidden",
            fontFamily: "mono",
            fontSize: "12px",
            position: "relative",
        },
        content: { overflow: "auto", padding: "{spacing.3}" },
        code: { fontFamily: "mono", fontVariantNumeric: "tabular-nums" },
        header: {
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            background: "bg.canvas",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
        },
        title: { textStyle: "caption.eyebrow" },
        copyTrigger: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "{spacing.1}",
            borderRadius: "{radii.sm}",
            background: "transparent",
            color: "fg.muted",
            cursor: "pointer",
            _hover: { color: "fg", background: "bg.subtle" },
        },
    },
});
