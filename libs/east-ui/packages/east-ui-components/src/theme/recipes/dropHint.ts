/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * DropHint recipe (#267) — the shared "this empty region accepts drops"
 * affordance: a dashed outline + quiet mono hint, consistent with the
 * `data-drop-valid` stage vocabulary (dashed = ephemeral). Lifted from the
 * Blend `dropArea` slot so every DnD target shares one definition.
 */

import { defineRecipe } from "@chakra-ui/react";

export const dropHintRecipe = defineRecipe({
    className: "elara-drop-hint",
    base: {
        borderWidth: "1px",
        borderStyle: "dashed",
        borderColor: "border.strong",
        borderRadius: "{radii.sm}",
        paddingY: "{spacing.2}",
        paddingX: "{spacing.3}",
        textAlign: "center",
        fontFamily: "mono",
        fontSize: "10px",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "fg.subtle",
    },
});
