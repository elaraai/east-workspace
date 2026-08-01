/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, IntegerType, NullType, example, some, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Drawer, Reactive, Separator, Status, Text, VStack } from "@elaraai/east-ui";

export const drawerBasic = example({
    keywords: ["Drawer", "Root", "placement", "end", "right", "eyebrow", "basic"],
    description: "Slide-in panel from right with the surface-header eyebrow",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Drawer trigger={<Button>Open Drawer</Button>} eyebrow="Rail · detail" title="Drawer Title" description="Slide-in panel" placement="end" size="md">
                <VStack gap="4">
                    <Text>This is a drawer panel that slides in from the side.</Text>
                    <Text color="fg.muted">Great for navigation, settings, or detailed content.</Text>
                </VStack>
            </Drawer>
        );
    }),
    inputs: [],
});

export const drawerProgrammatic = example({
    keywords: ["Drawer", "open", "programmatic", "onClick"],
    description: "Drawer.open() without trigger — defaults to brand-d primary button",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Button
                variant="solid"
                onClick={East.function([], NullType, $ => {
                    $(Drawer.open(East.value({
                        body: [
                            <VStack gap="4">
                                <Text>This drawer was opened programmatically using Drawer.open().</Text>
                                <Text color="fg.muted">Great for navigation, notifications, or dynamic content.</Text>
                            </VStack>,
                        ],
                        eyebrow: some("Rail · programmatic"),
                        title: some("Programmatic Drawer"),
                        description: some("Opened via Drawer.open()"),
                        style: none,
                    }, Drawer.Types.OpenInput)));
                })}
            >Open Drawer Programmatically</Button>
        );
    }),
    inputs: [],
});

export const drawerStackedNested = example({
    keywords: ["Drawer", "open", "stacked", "stackIcon", "nested", "stack", "rail", "programmatic", "pop", "drill"],
    description: "Programmatic nested drawers with stacked:true — each drawer's body opens the next, and every ancestor collapses to a labeled icon rail you can click to pop back to it (#328)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Button
                variant="solid"
                onClick={East.function([], NullType, $ => {
                    $(Drawer.open(East.value({
                        body: [
                            <VStack gap="4" align="flex-start">
                                <Text>Reactor B4418 — detail. Drill into its decisions from here.</Text>
                                <Button
                                    variant="outline"
                                    onClick={East.function([], NullType, $ => {
                                        $(Drawer.open(East.value({
                                            body: [
                                                <VStack gap="4" align="flex-start">
                                                    <Text>Decisions queue for B4418.</Text>
                                                    <Button
                                                        variant="outline"
                                                        onClick={East.function([], NullType, $ => {
                                                            $(Drawer.open(East.value({
                                                                body: [<Text>Adjust setpoint — the deepest drawer.</Text>],
                                                                eyebrow: some("Decision"),
                                                                title: some("Adjust setpoint"),
                                                                description: none,
                                                                style: none,
                                                            }, Drawer.Types.OpenInput)));
                                                        })}
                                                    >Open decision detail</Button>
                                                </VStack>,
                                            ],
                                            eyebrow: some("Notifications"),
                                            title: some("Decisions"),
                                            description: none,
                                            // Collapses to a "bell" rail when the detail drawer opens on top.
                                            style: some(East.value({
                                                size: none, placement: none, contained: none,
                                                onOpenChange: none, onExitComplete: none, bodyPadding: none,
                                                flush: none, fillBody: none, stacked: some(true), stackIcon: some("bell"),
                                            }, Drawer.Types.Style)),
                                        }, Drawer.Types.OpenInput)));
                                    })}
                                >Open decisions</Button>
                            </VStack>,
                        ],
                        eyebrow: some("Reactor"),
                        title: some("B4418"),
                        description: none,
                        // Collapses to a "flask" rail while any deeper drawer is open.
                        style: some(East.value({
                            size: none, placement: none, contained: none,
                            onOpenChange: none, onExitComplete: none, bodyPadding: none,
                            flush: none, fillBody: none, stacked: some(true), stackIcon: some("flask"),
                        }, Drawer.Types.Style)),
                    }, Drawer.Types.OpenInput)));
                })}
            >Open B4418</Button>
        );
    }),
    inputs: [],
});

// ============================================================================
// Variants — static enumeration panel + interactive row (consolidation #455).
// ============================================================================

export const drawerVariants = example({
    keywords: ["Drawer", "Root", "placement", "start", "left", "navigation", "flush", "bodyPadding", "fillBody", "full-bleed", "padding", "fill-height", "scroll", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Drawer variant panel — left (slide-in panel from left), flush (full-bleed fill-height body via flush + fillBody so a single child owns its own scroll, plus a custom bodyPadding inset), interactive (onOpenChange callback)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="LEFT" align="start" />
                <Drawer trigger={<Button variant="outline">Open Navigation</Button>} title="Navigation" placement="start">
                    <VStack gap="1" align="stretch">
                        <Button variant="ghost" size="sm">Overview</Button>
                        <Button variant="ghost" size="sm">Projects</Button>
                        <Button variant="ghost" size="sm">Team</Button>
                        <Button variant="ghost" size="sm">Settings</Button>
                    </VStack>
                </Drawer>
                <Separator label="FLUSH" align="start" />
                <VStack gap="2" align="flex-start">
                    <Drawer trigger={<Button>Open Full-bleed Drawer</Button>} eyebrow="Rail · data" title="Full-bleed body" placement="end" size="md" flush fillBody>
                        <Box height="100%" overflowY="auto">
                            <VStack gap="2" align="stretch">
                                <Text>This body is flush (zero padding) and fills the panel height.</Text>
                                <Text color="fg.muted">A single height:100% child owns its scrollbar instead of the whole panel scrolling.</Text>
                            </VStack>
                        </Box>
                    </Drawer>
                    <Drawer trigger={<Button variant="outline">Open Custom-inset Drawer</Button>} title="Custom inset" placement="end" size="md" bodyPadding="8px 12px">
                        <Text>This body uses a custom bodyPadding of 8px 12px instead of the default 16px 20px.</Text>
                    </Drawer>
                </VStack>
                <Separator label="INTERACTIVE" align="start" />
                <Reactive>{$ => {
                    const openCountBind = $.let(State.bind([IntegerType], "drawer_open_count", 0n));
                    const onOpenChange = $.const(East.function([BooleanType], NullType, ($, isOpen) => {
                        const openCount = $.let(openCountBind.read());
                        $.if(isOpen, $ => {
                            $(openCountBind.write(openCount.add(1n)));
                        });
                    }));
                    const openCount = $.let(openCountBind.read());
                    return (
                        <VStack gap="3" align="flex-start">
                            <Drawer trigger={<Button>Open Drawer</Button>} title="Interactive Drawer" placement="end" onOpenChange={onOpenChange}>
                                <VStack gap="4">
                                    <Text>This drawer counts how many times it’s been opened.</Text>
                                    <Status label={<Text>{East.str`OPENED · ${East.print(openCount)} TIMES`}</Text>} value="info" />
                                </VStack>
                            </Drawer>
                            <Status label={<Text>{East.str`DRAWER OPENED · ${East.print(openCount)} TIMES`}</Text>} value="info" />
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
