/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, SegmentGroup, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

export const segmentGroupViewToggle = example({
    keywords: ["SegmentGroup", "Root", "Item", "toolbar", "toggle", "view"],
    description: "Summary / Demand / Coverage / Rotation plan / Unmet · 2 toolbar (shift-optimiser mockup)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <SegmentGroup
                value="summary"
                items={[
                    SegmentGroup.Item("summary", "Summary"),
                    SegmentGroup.Item("demand", "Demand"),
                    SegmentGroup.Item("coverage", "Coverage"),
                    SegmentGroup.Item("rotation", "Rotation plan"),
                    SegmentGroup.Item("unmet", <HStack gap="2" align="center"><Text>Unmet</Text><Badge colorPalette="danger" variant="subtle">2</Badge></HStack>),
                ]}
                size="sm"
            />
        );
    }),
    inputs: [],
});

export const segmentGroupSized = example({
    keywords: ["SegmentGroup", "Root", "Item", "size", "md"],
    description: "Medium-size time-range segment control",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <SegmentGroup
                value="1w"
                items={[
                    SegmentGroup.Item("1d", "1 day"),
                    SegmentGroup.Item("1w", "1 week"),
                    SegmentGroup.Item("1m", "1 month"),
                    SegmentGroup.Item("3m", "3 months"),
                ]}
                size="md"
                colorPalette="brand"
            />
        );
    }),
    inputs: [],
});

export const segmentGroupReactive = example({
    keywords: ["SegmentGroup", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive segment group wired through State.bind",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([StringType], "seg_view", "summary"));
            const view = $.let(bind.read());
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <SegmentGroup
                        value={view}
                        items={[
                            SegmentGroup.Item("summary", "Summary"),
                            SegmentGroup.Item("demand", "Demand"),
                            SegmentGroup.Item("coverage", "Coverage"),
                        ]}
                        onChange={onChange}
                        size="sm"
                    />
                    <Text color="fg.muted">{East.str`Active view: ${view}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const segmentGroupBranded = example({
    keywords: ["SegmentGroup", "style", "background", "activeBackground", "branded"],
    description: "Branded segment group with full colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <SegmentGroup
                value="graph"
                items={[
                    SegmentGroup.Item("table", "Table"),
                    SegmentGroup.Item("graph", "Graph"),
                    SegmentGroup.Item("map", "Map"),
                ]}
                size="sm"
                background="bg.canvas"
                borderColor="border.subtle"
                activeBackground="bg.inverse"
                activeColor="fg.inverse"
                inactiveColor="fg.muted"
            />
        );
    }),
    inputs: [],
});
