/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * NativeSelect slot recipe — merged over Chakra's own. Its chevron is Font
 * Awesome's (#1263), in the 1em square Chakra's icon took: Chakra sizes its
 * height, `--fa-width` its width, never Font Awesome 7's fixed 1.25em.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const nativeSelectSlotRecipe = defineSlotRecipe({
    className: "elara-native-select",
    slots: ["root", "field", "indicator"],
    base: {
        indicator: {
            "--fa-width": "1em",
        },
    },
});
