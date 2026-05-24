/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Code recipe — inline `<code>` chip.
 *
 * Spec: mono / `0.92em` relative / bg gray.100 / 4 px radius /
 * padding `1px 5px`.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const codeRecipe = defineRecipe({
    className: "elara-code",
    base: {
        fontFamily: "mono",
        fontSize: "0.92em",
        background: "{colors.gray.100}",
        color: "fg",
        borderRadius: "{radii.sm}",
        paddingX: "5px",
        paddingY: "1px",
    },
    variants: {
        variant: {
            subtle:  { background: "{colors.gray.100}",  color: "fg" },
            outline: { background: "transparent", borderWidth: "1px", borderColor: "border.strong", color: "fg" },
            plain:   { background: "transparent", color: "fg" },
            surface: { background: "bg.muted", color: "fg" },
            solid:   { background: "{colors.brand.700}", color: "white" },
        },
    },
    defaultVariants: {
        variant: "subtle",
    },
});
