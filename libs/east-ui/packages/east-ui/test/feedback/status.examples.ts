/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Status, Stack, Text, UIComponentType } from "@elaraai/east-ui";

export const statusBasic = example({
    keywords: ["Status", "Root", "value", "paired icon"],
    description: "Each StatusValue side-by-side with default paired icon",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Status.Root("Up to date", { value: "success" }),
            Status.Root("Stale", { value: "warning" }),
            Status.Root("Failed", { value: "danger" }),
            Status.Root("Info", { value: "info" }),
            Status.Root("Idle", { value: "neutral" }),
        ], { gap: "3" });
    }),
    inputs: [],
});

export const statusPulsing = example({
    keywords: ["Status", "pulsing", "danger", "recompute"],
    description: "Pulsing danger status for in-flight recompute",
    fn: East.function([], UIComponentType, (_$) => {
        return Status.Root("Recomputing", { value: "danger", pulsing: true });
    }),
    inputs: [],
});

export const statusRichLabel = example({
    keywords: ["Status", "rich label", "HStack", "secondary"],
    description: "Status with a rich label showing a timestamp alongside the primary label",
    fn: East.function([], UIComponentType, (_$) => {
        return Status.Root(
            Stack.HStack([
                Text.Root("Up to date"),
                Text.Root("· 14:32", { color: "fg.muted" }),
            ], { gap: "1" }),
            { value: "success" },
        );
    }),
    inputs: [],
});

export const statusCustomIcon = example({
    keywords: ["Status", "icon", "override"],
    description: "Status with an explicit icon override that skips the paired default",
    fn: East.function([], UIComponentType, (_$) => {
        return Status.Root("Shipping", {
            value: "info",
            icon: { prefix: "fas", name: "truck" },
        });
    }),
    inputs: [],
});
