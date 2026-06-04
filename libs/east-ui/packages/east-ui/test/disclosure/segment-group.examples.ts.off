/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, StringType, example } from "@elaraai/east";
import { Badge, Reactive, SegmentGroup, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const segmentGroupViewToggle = example({
    keywords: ["SegmentGroup", "Root", "Item", "toolbar", "toggle", "view"],
    description: "Summary / Demand / Coverage / Rotation plan / Unmet · 2 toolbar (shift-optimiser mockup)",
    fn: East.function([], UIComponentType, (_$) => {
        return SegmentGroup.Root("summary", [
            SegmentGroup.Item("summary", "Summary"),
            SegmentGroup.Item("demand", "Demand"),
            SegmentGroup.Item("coverage", "Coverage"),
            SegmentGroup.Item("rotation", "Rotation plan"),
            SegmentGroup.Item(
                "unmet",
                Stack.HStack([
                    Text.Root("Unmet"),
                    Badge.Root("2", { colorPalette: "red", variant: "subtle" }),
                ], { gap: "2", align: "center" }),
            ),
        ], { style: { size: "sm" } });
    }),
    inputs: [],
});

export const segmentGroupSized = example({
    keywords: ["SegmentGroup", "Root", "Item", "size", "md"],
    description: "Medium-size time-range segment control",
    fn: East.function([], UIComponentType, (_$) => {
        return SegmentGroup.Root("1w", [
            SegmentGroup.Item("1d", "1 day"),
            SegmentGroup.Item("1w", "1 week"),
            SegmentGroup.Item("1m", "1 month"),
            SegmentGroup.Item("3m", "3 months"),
        ], { style: { size: "md", colorPalette: "blue" } });
    }),
    inputs: [],
});

export const segmentGroupReactive = example({
    keywords: ["SegmentGroup", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive segment group wired through State.bind",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([StringType], "seg_view", "summary"));
            const view = $.let(bind.read());
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return Stack.VStack([
                SegmentGroup.Root(view, [
                    SegmentGroup.Item("summary", "Summary"),
                    SegmentGroup.Item("demand", "Demand"),
                    SegmentGroup.Item("coverage", "Coverage"),
                ], { onChange, style: { size: "sm" } }),
                Text.Root(East.str`Active view: ${view}`, { color: "fg.muted" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const segmentGroupBranded = example({
    keywords: ["SegmentGroup", "style", "background", "activeBackground", "branded"],
    description: "Branded segment group with full colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return SegmentGroup.Root("graph", [
            SegmentGroup.Item("table", "Table"),
            SegmentGroup.Item("graph", "Graph"),
            SegmentGroup.Item("map", "Map"),
        ], {
            style: {
                size: "sm",
                background: "#f9fafb",
                borderColor: "#e5e7eb",
                activeBackground: "#1a2234",
                activeColor: "#ffffff",
                inactiveColor: "#6b7280",
            },
        });
    }),
    inputs: [],
});
