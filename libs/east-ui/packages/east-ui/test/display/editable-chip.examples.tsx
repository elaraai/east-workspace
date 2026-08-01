/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { EditableChip, Separator, Text, HStack, VStack, Stack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const editableChipBasic = example({
    keywords: ["EditableChip", "Root", "label"],
    description: "Basic editable chip with default trigger icon",
    fn: East.function([], UIComponentType, ($) => {
        return <EditableChip><Text>Service level · 85%</Text></EditableChip>;
    }),
    inputs: [],
});

// ============================================================================
// EditableChip — disabled, styled, densities (variant panel)
// ============================================================================

export const editableChipVariants = example({
    keywords: ["EditableChip", "Root", "disabled", "style", "colour", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "EditableChip variant panel — chip disabled (disabled editable chip), chip styled (editable chip with explicit colour slots), chip densities (the three densities stacked — chip height + font scale condensed → compact → comfortable, matching ChipRail)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<EditableChip density="condensed"><Text>Service level · 85%</Text></EditableChip>);
        const compact = $.const(<EditableChip density="compact"><Text>Service level · 85%</Text></EditableChip>);
        const comfortable = $.const(<EditableChip density="comfortable"><Text>Service level · 85%</Text></EditableChip>);
        return (
            <VStack gap="4" align="stretch">
                <Separator label="CHIP DISABLED" align="start" />
                <EditableChip disabled={true}><Text>Locked assumption</Text></EditableChip>
                <Separator label="CHIP STYLED" align="start" />
                <EditableChip background="blue.50" color="blue.700" borderColor="blue.200" triggerIconColor="blue.500">
                    <Text>Demand mix · balanced</Text>
                </EditableChip>
                <Separator label="CHIP DENSITIES" align="start" />
                <Stack direction="column" gap="6">
                    {condensed}
                    {compact}
                    {comfortable}
                </Stack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// EditableChip — onClick callback + scenario cycling (reactive panel)
// ============================================================================

export const editableChipReactive = example({
    keywords: ["EditableChip", "Root", "onClick", "callback", "Reactive", "State", "interactive"],
    description: "EditableChip reactive panel — chip with callback (editable chip with an onClick callback), chip reactive (reactive editable chip that cycles through three scenarios on click)",
    fn: East.function([], UIComponentType, ($) => {
        const onClick = $.const(East.function([], NullType, _ => {}));
        return (
            <VStack gap="4" align="stretch">
                <Separator label="CHIP WITH CALLBACK" align="start" />
                <EditableChip onClick={onClick}><Text>Scenario: Q4 forecast</Text></EditableChip>
                <Separator label="CHIP REACTIVE" align="start" />
                <Reactive>{$ => {
                    const scenarioIndex = $.let(State.bind([IntegerType], "scenarioIndex", 0n));
                    const index = $.let(scenarioIndex.read());
                    const scenarios = $.let(["Baseline", "Optimistic", "Stress"]);
                    const currentLabel = $.let(scenarios.get(index.remainder(3n)));
                    const cycle = $.const(East.function([], NullType, $ => {
                        const current = $.let(scenarioIndex.read());
                        $(scenarioIndex.write(current.add(1n)));
                    }));
                    return (
                        <HStack gap="2" align="center">
                            <Text>{"Scenario: "}</Text>
                            <EditableChip onClick={cycle}><Text>{currentLabel}</Text></EditableChip>
                        </HStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
