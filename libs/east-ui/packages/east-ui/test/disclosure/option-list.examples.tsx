/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { OptionList, Badge, Text, VStack, Reactive } from "@elaraai/east-ui/jsx";

export const optionListAlternatives = example({
    keywords: ["OptionList", "Root", "Option", "alternatives", "what-if"],
    description: "Alternatives list with impact trailing chips",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <OptionList
                options={[
                    OptionList.Option("alt-1", "Keep current plan", { description: "+£0 overtime, 2 unmet shifts", trailing: <Badge colorPalette="gray">baseline</Badge> }),
                    OptionList.Option("alt-2", "Shift batch to 06:00", { description: "+0.8h idle, −£312 overtime", trailing: <Badge colorPalette="green">−£312</Badge> }),
                    OptionList.Option("alt-3", "Add agency worker", { description: "+£480 variable cost, 0 unmet", trailing: <Badge colorPalette="red">+£480</Badge> }),
                ]}
                selectedId="alt-1"
            />
        );
    }),
    inputs: [],
});

export const optionListWhatIf = example({
    keywords: ["OptionList", "what-if", "disabled", "style"],
    description: "What-if list with one disabled option + colour slots",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <OptionList
                options={[
                    OptionList.Option("w-1", "Baseline demand"),
                    OptionList.Option("w-2", "+10% demand shock", { description: "Adds 420 units / shift" }),
                    OptionList.Option("w-3", "Outage on Line B", { description: "Not modelled yet", disabled: true }),
                ]}
                selectedId="w-1"
                selectedBackground="#eef2ff"
                itemHoverBackground="#f8fafc"
                borderColor="#e5e7eb"
            />
        );
    }),
    inputs: [],
});

export const optionListReactive = example({
    keywords: ["OptionList", "Reactive", "State", "onSelect", "interactive"],
    description: "Reactive option list that writes selection to state",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([StringType], "option_list_selected", "alt-1"));
            const selected = $.let(bind.read());
            const onSelect = $.const(East.function([StringType], NullType, ($, id) => {
                $(bind.write(id));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <OptionList
                        options={[
                            OptionList.Option("alt-1", "Keep current plan"),
                            OptionList.Option("alt-2", "Shift batch to 06:00"),
                            OptionList.Option("alt-3", "Add agency worker"),
                        ]}
                        selectedId={selected}
                        onSelect={onSelect}
                    />
                    <Text color="fg.muted">{East.str`Selected: ${selected}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
