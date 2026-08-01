/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { IconButton, Reactive, Separator, VStack, Stat } from "@elaraai/east-ui";

export const iconButtonBasic = example({
    keywords: ["IconButton", "Root", "label", "aria-label", "close"],
    description: "Icon-only close affordance with required aria-label",
    fn: East.function([], UIComponentType, (_$) => {
        return <IconButton prefix="fas" name="xmark" label="Close" variant="ghost" />;
    }),
    inputs: [],
});

// ============================================================================
// Variants — static enumeration panel (consolidation epic #455).
// ============================================================================

export const iconButtonVariants = example({
    keywords: ["IconButton", "Root", "loading", "loadingIcon", "spinner", "style", "color", "background", "borderColor", "branded", "badge", "count", "notification", "attention", "pulse", "ring", "dot", "onClick", "Reactive", "State", "counter", "interactive"],
    description: "IconButton variant panel — button loading (custom spinner icon swap), button coloured (branded hex colour escape hatches), button badge and attention (count, 99+ cap, dot-only badges plus pulse/ring attention animations), button on click reactive (reactive counter increments on click)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="BUTTON LOADING" align="start" />
                <IconButton
                    prefix="fas"
                    name="rotate"
                    label="Refresh"
                    loading
                    loadingIcon={{ prefix: "fas", name: "spinner" }}
                    variant="subtle"
                    colorPalette="blue"
                />
                <Separator label="BUTTON COLOURED" align="start" />
                <IconButton
                    prefix="fas"
                    name="rocket"
                    label="Deploy"
                    color="#ffffff"
                    background="#1a2234"
                    borderColor="#3d5cff"
                    hoverBackground="#25345a"
                    size="md"
                />
                <Separator label="BUTTON BADGE AND ATTENTION" align="start" />
                <VStack gap="4">
                    <IconButton prefix="fas" name="bell" label="Alerts" variant="ghost" badge="3" />
                    <IconButton prefix="fas" name="bell" label="Many alerts" variant="ghost" badge="99+" badgeColorPalette="orange" />
                    <IconButton prefix="fas" name="inbox" label="Unread" variant="ghost" badge="" />
                    <IconButton prefix="fas" name="bell" label="Pulsing alerts" variant="subtle" colorPalette="red" badge="5" attention="pulse" />
                    <IconButton prefix="fas" name="circle-exclamation" label="Attention" variant="solid" colorPalette="blue" attention="ring" />
                </VStack>
                <Separator label="BUTTON ON CLICK REACTIVE" align="start" />
                <Reactive>{$ => {
                        const counter = $.let(State.bind([IntegerType], "icon_button_counter", 0n));
                        const count = $.let(counter.read());
                        const increment = $.const(East.function([], NullType, $ => {
                            const current = $.let(counter.read());
                            $(counter.write(current.add(1n)));
                        }));
                        return (
                            <VStack gap="3" align="flex-start">
                                <Stat label="Clicks" value={East.print(count)} />
                                <IconButton prefix="fas" name="plus" label="Increment" onClick={increment} variant="solid" colorPalette="blue" />
                            </VStack>
                        );
                    }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
