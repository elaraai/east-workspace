/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { CopyButton, UIComponentType } from "@elaraai/east-ui";

export const copyButtonBasic = example({
    keywords: ["CopyButton", "Root", "icon-only", "clipboard"],
    description: "Icon-only copy affordance (aria-label 'Copy to clipboard')",
    fn: East.function([], UIComponentType, (_$) => {
        return CopyButton.Root("super-secret-api-key");
    }),
    inputs: [],
});

export const copyButtonLabelled = example({
    keywords: ["CopyButton", "Root", "label", "timeout"],
    description: "Labelled copy button with a custom 1.5s \"Copied!\" timeout",
    fn: East.function([], UIComponentType, (_$) => {
        return CopyButton.Root("https://elara.ai/share/abc123", {
            label: "Copy link",
            timeout: "1500",
            style: { variant: "outline", colorPalette: "blue" },
        });
    }),
    inputs: [],
});

export const copyButtonBranded = example({
    keywords: ["CopyButton", "Root", "style", "color", "background", "successColor", "branded"],
    description: "Branded copy button with full colour escape hatches including successColor",
    fn: East.function([], UIComponentType, (_$) => {
        return CopyButton.Root("elaraai_sk_live_xxxxxxxx", {
            label: "Copy API key",
            style: {
                variant: "solid",
                color: "#ffffff",
                background: "#1a2234",
                borderColor: "#3d5cff",
                hoverBackground: "#25345a",
                successColor: "#2e7d32",
            },
        });
    }),
    inputs: [],
});
