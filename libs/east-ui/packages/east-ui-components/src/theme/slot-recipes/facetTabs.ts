/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `facetTabs` — the segmented facet toggle group on a decision-queue row
 * (the spec's slice-seg treatment: mono, joined, active segment solid
 * brand). Toggles swap which facet panel is open beneath the row; they are
 * visually distinct from the row's command buttons (`button` recipe).
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const facetTabsSlotRecipe = defineSlotRecipe({
    className: "elara-facet-tabs",
    slots: ["root", "tab"],
    base: {
        root: {
            display: "inline-flex",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "5px",
            overflow: "hidden",
            flexShrink: 0,
        },
        tab: {
            fontFamily: "mono",
            fontSize: "{fontSizes.2xs}",
            fontWeight: "medium",
            letterSpacing: "0.04em",
            lineHeight: "1.4",
            whiteSpace: "nowrap",
            paddingX: "{spacing.2.5}",
            paddingY: "{spacing.1.5}",
            border: 0,
            borderRightWidth: "1px",
            borderRightColor: "border.strong",
            background: "bg.canvas",
            color: "fg.subtle",
            cursor: "pointer",
            _last: { borderRightWidth: 0 },
            _hover: { background: "bg.muted", color: "fg" },
            "&[data-on]": {
                background: "accent.brand",
                color: "fg.inverse",
            },
            // Attention pulse while the judgement gate is closed.
            "&[data-pulse]:not([data-on])": {
                color: "fg.warning",
                animationName: "pulse",
                animationDuration: "1.8s",
                animationIterationCount: "infinite",
            },
        },
    },
});
