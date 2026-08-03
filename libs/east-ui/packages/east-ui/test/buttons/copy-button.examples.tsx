/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { CopyButton } from "@elaraai/east-ui";

export const copyButtonBasic = example({
    keywords: ["CopyButton", "Root", "icon-only", "clipboard"],
    description: "Icon-only copy affordance (aria-label 'Copy to clipboard')",
    fn: East.function([], UIComponentType, (_$) => {
        return <CopyButton>super-secret-api-key</CopyButton>;
    }),
    inputs: [],
});

export const copyButtonLabelled = example({
    keywords: ["CopyButton", "Root", "label", "timeout"],
    description: "Labelled copy button with a custom 1.5s \"Copied!\" timeout",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <CopyButton label="Copy link" timeout="1500" variant="outline" colorPalette="brand">
                https://elara.ai/share/abc123
            </CopyButton>
        );
    }),
    inputs: [],
});

export const copyButtonBranded = example({
    keywords: ["CopyButton", "Root", "style", "color", "background", "successColor", "branded"],
    description: "Branded copy button with full colour escape hatches including successColor",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <CopyButton
                label="Copy API key"
                variant="solid"
                color="fg.inverse"
                background="bg.inverse"
                borderColor="border.brand"
                hoverBackground="bg.inverse"
                successColor="fg.success"
            >
                elaraai_sk_live_xxxxxxxx
            </CopyButton>
        );
    }),
    inputs: [],
});
