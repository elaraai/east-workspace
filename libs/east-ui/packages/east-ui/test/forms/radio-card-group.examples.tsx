/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { RadioCardGroup, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const RADIO_CARD_GROUP_HORIZONTAL_DATA = [
    { value: "monthly", label: "Monthly", description: "$49 / mo" },
    { value: "yearly", label: "Yearly", description: "$490 / yr (save 16%)" },
];
const RADIO_CARD_GROUP_DISABLED_ITEM_DATA = [
    { value: "active", label: "Active", description: "Available now" },
    { value: "queued", label: "Queued", description: "Pending review" },
    { value: "archived", label: "Archived", description: "Read-only", disabled: true },
];
const RADIO_CARD_GROUP_COLOUR_OVERRIDES_DATA = [
    { value: "low", label: "Low priority", description: "Resolved within 7 days" },
    { value: "med", label: "Medium priority", description: "Resolved within 2 days" },
    { value: "high", label: "High priority", description: "Resolved same day" },
];

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const radioCardGroupBasic = example({
    keywords: ["RadioCardGroup", "Root", "card", "radio", "select"],
    description: "Pricing-tier card group with description per option",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <RadioCardGroup
                value="team"
                items={[
                    { value: "starter", label: "Starter", description: "Up to 5 users" },
                    { value: "team", label: "Team", description: "Up to 50 users" },
                    { value: "business", label: "Business", description: "Unlimited" },
                ]}
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// Reactive — picking a card writes to State and re-renders
// ============================================================================

export const radioCardGroupReactive = example({
    keywords: ["RadioCardGroup", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive radio cards bound to State — picking a card writes to State and re-renders the selected-value indicator below",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const planBind = $.let(State.bind([StringType], "plan_choice", "team"));
            const plan = $.let(planBind.read(), StringType);
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(planBind.write(next));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <RadioCardGroup
                        value={plan}
                        items={[
                            { value: "starter", label: "Starter", description: "Up to 5 users" },
                            { value: "team", label: "Team", description: "Up to 50 users" },
                            { value: "business", label: "Business", description: "Unlimited" },
                        ]}
                        onChange={onChange}
                    />
                    <Text textStyle="body-sm" color="fg.muted">{East.str`Selected plan: ${plan}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// RadioCardGroup — orientation, disabled card, colour overrides (variant panel)
// ============================================================================

export const radioCardGroupVariants = example({
    keywords: ["RadioCardGroup", "horizontal", "orientation", "disabled", "item", "selectedBorderColor", "selectedCardBackground", "override"],
    description: "RadioCardGroup variant panel — card group horizontal (horizontal radio cards laid out as a row), card group disabled item (card group with one disabled card), card group colour overrides (card group with explicit colour escape hatches for selected card border / background and description text)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CARD GROUP HORIZONTAL</Text>
                    <RadioCardGroup
                        value="monthly"
                        items={RADIO_CARD_GROUP_HORIZONTAL_DATA}
                        orientation="horizontal"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CARD GROUP DISABLED ITEM</Text>
                    <RadioCardGroup
                        value="active"
                        items={RADIO_CARD_GROUP_DISABLED_ITEM_DATA}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CARD GROUP COLOUR OVERRIDES</Text>
                    <RadioCardGroup
                        value="med"
                        items={RADIO_CARD_GROUP_COLOUR_OVERRIDES_DATA}
                        selectedCardBackground="blue.50"
                        selectedBorderColor="blue.500"
                        descriptionColor="gray.600"
                    />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
