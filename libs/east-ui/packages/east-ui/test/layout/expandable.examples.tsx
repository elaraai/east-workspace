/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Expandable, Reactive, Text, VStack } from "@elaraai/east-ui";

export const expandableRegion = example({
    keywords: ["Expandable", "expand", "fill", "window", "app container", "maximize", "takeover", "region", "layout"],
    description: "Expandable region — a floating control expands the region in place to fill the app container; Esc or the control collapses it",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Expandable label="Schedule">
                <Box padding="3" background="bg.surface">
                    <Text>Dense chart region — expand me</Text>
                </Box>
            </Expandable>
        );
    }),
    inputs: [],
});

export const expandableControlled = example({
    keywords: ["Expandable", "expanded", "onExpandedChange", "State", "Reactive", "controlled", "maximize", "fill window"],
    description: "State-driven Expandable — expanded is bound to State and onExpandedChange writes the toggle back, so the region restores its expansion on re-render",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const expandedBind = $.let(State.bind([BooleanType], "region_expanded", false));
            const expanded = $.let(expandedBind.read(), BooleanType);
            const onExpandedChange = $.const(East.function([BooleanType], NullType, ($, next) => {
                $(expandedBind.write(next));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Text>Throughput report</Text>
                    <Expandable expanded={expanded} onExpandedChange={onExpandedChange} label="Throughput chart">
                        <Box padding="3" background="bg.surface">
                            <Text>Dense chart region — expands to fill the window</Text>
                        </Box>
                    </Expandable>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
