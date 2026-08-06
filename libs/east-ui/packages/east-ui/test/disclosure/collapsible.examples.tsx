/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Collapsible, Configurator, HStack, Reactive, Switch, Text } from "@elaraai/east-ui";

export const collapsibleWhy = example({
    keywords: ["Collapsible", "Root", "why", "show more", "inline drawer"],
    description: "Inline 'Why?' drawer revealing rationale text",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Collapsible trigger={<Text color="link">Why did we recommend this?</Text>} defaultOpen={false}>
                <Box padding="3" background="bg.subtle" borderRadius="md">
                    <Text color="fg.muted">Stage 1 was delayed ~6h due to setpoint drift since 02:00. Redirecting feedstock to Stage 2 reduces unmet demand at the cost of 1.2% yield.</Text>
                </Box>
            </Collapsible>
        );
    }),
    inputs: [],
});

export const collapsibleVariants = example({
    keywords: ["Collapsible", "Root", "defaultOpen", "expanded", "background", "borderColor", "branded", "Reactive", "State", "onOpenChange", "interactive", "Switch", "Configurator", "configurator"],
    description: "Collapsible configurator — default-open and branded switches on one live collapsible; the spec reads the open state via onOpenChange",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const defaultOpenBind = $.let(State.bind([BooleanType], "collapsible_defaultopen", true));
            const openBind = $.let(State.bind([BooleanType], "collapsible_open", false));

            const defaultOpenOn = $.let(defaultOpenBind.read());
            const isOpen = $.let(openBind.read());

            const onDefaultOpen = $.const(East.function([BooleanType], NullType, ($, next) => { $(defaultOpenBind.write(next)); }));
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, open) => {
                $(openBind.write(open));
            }));

            // The colour hatches are presence-typed, so the branded switch
            // picks between two collapsibles; defaultOpen + tracking stay live.
            // ONE collapsible — recipe colouring; the overrides live in
            // their own example.
            const preview = $.const(
                <Collapsible trigger="Details" defaultOpen={defaultOpenOn} onOpenChange={onOpenChange}>
                    <Text>This content starts expanded when defaultOpen is on.</Text>
                </Collapsible>,
            );

            return (
                <Configurator
                    controls={[
                        Configurator.Slot("State",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={defaultOpenOn} label="Default open" onChange={onDefaultOpen} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Open", isOpen.ifElse(_$ => "yes", _$ => "no")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** Raw colour overrides on a static collapsible. */
export const collapsibleCustomColours = example({
    keywords: ["Collapsible", "background", "borderColor", "triggerColor", "contentColor", "override", "custom"],
    description: "Colour overrides — canvas background and brand border on a static collapsible",
    fn: East.function([], UIComponentType, (_$) => (
        <Collapsible
            trigger="Branded trigger"
            defaultOpen={true}
            background="bg.canvas"
            borderColor="border.brand"
            triggerColor="fg.default"
            contentColor="fg.default"
        >
            <Box padding="3"><Text>Branded content</Text></Box>
        </Collapsible>
    )),
    inputs: [],
});
