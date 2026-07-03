/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { EditableChip, Text, HStack, Stack, Reactive } from "@elaraai/east-ui";

export const editableChipBasic = example({
    keywords: ["EditableChip", "Root", "label"],
    description: "Basic editable chip with default trigger icon",
    fn: East.function([], UIComponentType, ($) => {
        return <EditableChip><Text>Service level · 85%</Text></EditableChip>;
    }),
    inputs: [],
});

export const editableChipWithCallback = example({
    keywords: ["EditableChip", "Root", "onClick", "callback"],
    description: "Editable chip with an onClick callback",
    fn: East.function([], UIComponentType, ($) => {
        const onClick = $.const(East.function([], NullType, _ => {}));
        return <EditableChip onClick={onClick}><Text>Scenario: Q4 forecast</Text></EditableChip>;
    }),
    inputs: [],
});

export const editableChipDisabled = example({
    keywords: ["EditableChip", "Root", "disabled"],
    description: "Disabled editable chip",
    fn: East.function([], UIComponentType, ($) => {
        return <EditableChip disabled={true}><Text>Locked assumption</Text></EditableChip>;
    }),
    inputs: [],
});

export const editableChipStyled = example({
    keywords: ["EditableChip", "Root", "style", "colour"],
    description: "Editable chip with explicit colour slots",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <EditableChip background="blue.50" color="blue.700" borderColor="blue.200" triggerIconColor="blue.500">
                <Text>Demand mix · balanced</Text>
            </EditableChip>
        );
    }),
    inputs: [],
});

export const editableChipDensities = example({
    keywords: ["EditableChip", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "The three densities stacked — chip height + font scale condensed → compact → comfortable (matching ChipRail)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<EditableChip density="condensed"><Text>Service level · 85%</Text></EditableChip>);
        const compact = $.const(<EditableChip density="compact"><Text>Service level · 85%</Text></EditableChip>);
        const comfortable = $.const(<EditableChip density="comfortable"><Text>Service level · 85%</Text></EditableChip>);
        return (
            <Stack direction="column" gap="6">
                {condensed}
                {compact}
                {comfortable}
            </Stack>
        );
    }),
    inputs: [],
});

export const editableChipReactive = example({
    keywords: ["EditableChip", "Reactive", "State", "onClick", "interactive"],
    description: "Reactive editable chip that cycles through three scenarios on click",
    fn: East.function([], UIComponentType, (_$) => (
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
    )),
    inputs: [],
});
