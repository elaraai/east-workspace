/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, some, none, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Configurator, Drawer, Reactive, SegmentGroup, Status, Text, VStack } from "@elaraai/east-ui";

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
// Drawer — live configurator over the placement + body axes
// ============================================================================

export const drawerVariants = example({
    keywords: ["Drawer", "Root", "placement", "start", "left", "navigation", "flush", "bodyPadding", "fillBody", "full-bleed", "padding", "fill-height", "scroll", "Reactive", "State", "onOpenChange", "interactive", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Drawer configurator — placement and body-preset axes driving one live drawer behind its trigger button; the aside counts onOpenChange opens",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const placements = $.const([
                    variant("start", null), variant("end", null),
                ], ArrayType(Drawer.Types.Placement));

                // A body preset is the flush / fillBody pair plus the inset
                // they override, so the axis is a struct. `flush` (zero
                // padding) + `fillBody` (definite-height flex column) let a
                // single height:100% child own its own scroll.
                const bodies = $.const([
                    { label: "default", flush: false, fillBody: false, bodyPadding: "16px 20px" },
                    { label: "flush",   flush: true,  fillBody: true,  bodyPadding: "0" },
                    { label: "inset",   flush: false, fillBody: false, bodyPadding: "8px 12px" },
                ], ArrayType(StructType({ label: StringType, flush: BooleanType, fillBody: BooleanType, bodyPadding: StringType })));

                const placementBind = $.let(State.bind([StringType], "drawer_placement", "end"));
                const bodyBind      = $.let(State.bind([StringType], "drawer_body", "default"));
                const openCountBind = $.let(State.bind([IntegerType], "drawer_open_count", 0n));

                const pKey = $.let(placementBind.read());
                const bKey = $.let(bodyBind.read());
                const openCount = $.let(openCountBind.read());

                const onPlacement = $.const(East.function([StringType], NullType, ($, next) => { $(placementBind.write(next)); }));
                const onBody      = $.const(East.function([StringType], NullType, ($, next) => { $(bodyBind.write(next)); }));
                const onOpenChange = $.const(East.function([BooleanType], NullType, ($, isOpen) => {
                    const cur = $.let(openCountBind.read());
                    $.if(isOpen, $ => {
                        $(openCountBind.write(cur.add(1n)));
                    });
                }));

                // Each selection is a lookup into the same array the control renders.
                const placement = $.let(placements.filter((_$, v) => v.getTag().equal(pKey)).get(0n));
                const body = $.let(bodies.filter((_$, o) => o.label.equal(bKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Placement", pKey,
                                <SegmentGroup value={pKey} onChange={onPlacement} size="sm"
                                    items={placements.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Body", bKey,
                                <SegmentGroup value={bKey} onChange={onBody} size="sm"
                                    items={bodies.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                        ]}
                        preview={
                            <Drawer
                                trigger={<Button>Open Drawer</Button>}
                                eyebrow="Rail · configurator"
                                title="Configured Drawer"
                                description={East.str`${pKey} placement · ${bKey} body`}
                                placement={placement}
                                size="md"
                                flush={body.flush}
                                fillBody={body.fillBody}
                                bodyPadding={body.bodyPadding}
                                onOpenChange={onOpenChange}
                            >
                                <Box height="100%" overflowY="auto">
                                    <VStack gap="2" align="stretch">
                                        <Text>The body follows the configured preset — flush zeroes the padding and fillBody makes this box own the panel scroll.</Text>
                                        <Text color="fg.muted">The inset preset swaps the default 16px 20px bodyPadding for 8px 12px.</Text>
                                        <Status label={<Text>{East.str`OPENED · ${East.print(openCount)} TIMES`}</Text>} value="info" />
                                    </VStack>
                                </Box>
                            </Drawer>
                        }
                        aside={{
                            label: "Opens · Reactive",
                            body: (
                                <Status label={<Text>{East.str`DRAWER OPENED · ${East.print(openCount)} TIMES`}</Text>} value="info" />
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Flush", body.flush.ifElse(_$ => "full-bleed", _$ => "padded")),
                            Configurator.Spec("Fill body", body.fillBody.ifElse(_$ => "child owns scroll", _$ => "panel scrolls")),
                            Configurator.Spec("Body padding", body.bodyPadding),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
