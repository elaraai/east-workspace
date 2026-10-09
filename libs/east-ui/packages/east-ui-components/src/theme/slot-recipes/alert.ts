/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Alert slot recipe — merged over Chakra's own. Its indicator holds a Font
 * Awesome icon (#1263) — the status's paired icon — in the 1em square Chakra's
 * indicator is: Chakra sizes its height, `--fa-width` its width, never Font
 * Awesome 7's fixed 1.25em.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const alertSlotRecipe = defineSlotRecipe({
    className: "elara-alert",
    slots: ["title", "description", "root", "indicator", "content"],
    base: {
        indicator: {
            "--fa-width": "1em",
        },
    },
});
