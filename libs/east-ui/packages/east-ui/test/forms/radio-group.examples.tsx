/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { RadioGroup, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const RADIO_GROUP_HORIZONTAL_DATA = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
];
const RADIO_GROUP_DISABLED_ITEM_DATA = [
    { value: "active", label: "Active" },
    { value: "pending", label: "Pending" },
    { value: "archived", label: "Archived", disabled: true },
];
const RADIO_GROUP_COLOUR_OVERRIDES_DATA = [
    { value: "low", label: "Low priority" },
    { value: "med", label: "Medium priority" },
    { value: "high", label: "High priority" },
];

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const radioGroupBasic = example({
    keywords: ["RadioGroup", "Root", "radio", "select", "single-select"],
    description: "Basic radio group with three options",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <RadioGroup
                value="yes"
                items={[
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                    { value: "maybe", label: "Maybe" },
                ]}
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// Reactive — picking an option writes to State and re-renders
// ============================================================================

export const radioGroupReactive = example({
    keywords: ["RadioGroup", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive radio group bound to State — picking an option writes to State and re-renders",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const choiceBind = $.let(State.bind([StringType], "radio_choice", "small"));
            const choice = $.let(choiceBind.read(), StringType);
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(choiceBind.write(next));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <RadioGroup
                        value={choice}
                        items={[
                            { value: "small", label: "Small" },
                            { value: "medium", label: "Medium" },
                            { value: "large", label: "Large" },
                        ]}
                        onChange={onChange}
                    />
                    <Text textStyle="body-sm" color="fg.muted">{East.str`Selected: ${choice}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// RadioGroup — orientation, disabled item, colour overrides (variant panel)
// ============================================================================

export const radioGroupVariants = example({
    keywords: ["RadioGroup", "orientation", "horizontal", "disabled", "item", "fillColor", "borderColor", "color", "override"],
    description: "RadioGroup variant panel — group horizontal (horizontal radio group layout), group disabled item (radio group with one disabled item), group colour overrides (radio group with explicit colour escape hatches for fill / border / label text)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">GROUP HORIZONTAL</Text>
                    <RadioGroup
                        value="small"
                        items={RADIO_GROUP_HORIZONTAL_DATA}
                        orientation="horizontal"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">GROUP DISABLED ITEM</Text>
                    <RadioGroup
                        value="active"
                        items={RADIO_GROUP_DISABLED_ITEM_DATA}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">GROUP COLOUR OVERRIDES</Text>
                    <RadioGroup
                        value="low"
                        items={RADIO_GROUP_COLOUR_OVERRIDES_DATA}
                        fillColor="blue.600"
                        borderColor="blue.300"
                        color="gray.700"
                    />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
