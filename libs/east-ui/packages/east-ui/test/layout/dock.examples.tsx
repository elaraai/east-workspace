/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Configurator, Dock, HStack, Planner, Reactive, SegmentGroup, Stack, Switch, Text, VStack } from "@elaraai/east-ui";

/**
 * The `<Dock>` chrome as one live configurator — an orientation axis (a
 * horizontal dock collapses its WIDTH to an icon rail beside the board; a
 * vertical dock collapses its HEIGHT to a bottom tray) plus collapsed / badge
 * switches. `collapsed` is the controlled form: the switch and the dock's own
 * chevron both write the same bind through `onCollapsedChange`, so either
 * control drives the other.
 */
export const dockVariants = example({
    keywords: ["Dock", "layout", "collapse", "rail", "expanded", "icon", "badge", "sidebar", "collapsed", "defaultCollapsed", "tooltip", "vertical", "orientation", "tray", "height", "side", "end", "controlled", "onCollapsedChange", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Dock configurator — an orientation axis plus collapsed / badge switches driving one live dock beside a reclaiming board; the chevron and the switch share one controlled bind",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // The orientation axis is just its variants — `getTag()` gives
                // the segment key AND its label.
                const orientations = $.const([
                    variant("horizontal", null), variant("vertical", null),
                ], ArrayType(Dock.Types.Orientation));

                const orientationBind = $.let(State.bind([StringType], "dock_orientation", "horizontal"));
                const collapsedBind   = $.let(State.bind([BooleanType], "dock_collapsed", false));
                const badgeBind       = $.let(State.bind([BooleanType], "dock_badge", true));

                const oKey        = $.let(orientationBind.read());
                const collapsedOn = $.let(collapsedBind.read());
                const badgeOn     = $.let(badgeBind.read());

                const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));
                const onCollapsedSw = $.const(East.function([BooleanType], NullType, ($, next) => { $(collapsedBind.write(next)); }));
                const onBadge       = $.const(East.function([BooleanType], NullType, ($, next) => { $(badgeBind.write(next)); }));
                // The dock's own chevron writes the same bind — the controlled
                // `collapsed` contract, with the switch as the second surface.
                const onCollapsed   = $.const(East.function([BooleanType], NullType, ($, next) => { $(collapsedBind.write(next)); }));

                // One prebuilt leaf per orientation × badge presence — the two
                // orientations differ structurally (an HStack sibling reclaims
                // width; a VStack sibling reclaims height), and `badge` is an
                // optional slot, so presence is composed at build time. The
                // controlled `collapsed` expression threads into every leaf.
                const preview = $.const(oKey.equal("horizontal").ifElse(
                    _$ => badgeOn.ifElse(
                        _$ => (
                            <Box height="220px" width="320px">
                                <HStack gap="3" width="100%" height="100%">
                                    <Dock icon="book" label="Bookings" badge="3" railSize="44px" expandedSize="200px"
                                          collapsed={collapsedOn} onCollapsedChange={onCollapsed}>
                                        <Stack gap="2" padding="3">
                                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Grade A — Batch 3</Text></Box>
                                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Grade B — Batch 7</Text></Box>
                                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Grade C — Batch 1</Text></Box>
                                        </Stack>
                                    </Dock>
                                    <Box flex="1" minWidth="0" padding="3" background="bg.subtle" borderRadius="md">
                                        <Text>Board reclaims the freed width</Text>
                                    </Box>
                                </HStack>
                            </Box>
                        ),
                        _$ => (
                            <Box height="220px" width="320px">
                                <HStack gap="3" width="100%" height="100%">
                                    <Dock icon="book" label="Bookings" railSize="44px" expandedSize="200px"
                                          collapsed={collapsedOn} onCollapsedChange={onCollapsed}>
                                        <Stack gap="2" padding="3">
                                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Grade A — Batch 3</Text></Box>
                                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Grade B — Batch 7</Text></Box>
                                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Grade C — Batch 1</Text></Box>
                                        </Stack>
                                    </Dock>
                                    <Box flex="1" minWidth="0" padding="3" background="bg.subtle" borderRadius="md">
                                        <Text>Board reclaims the freed width</Text>
                                    </Box>
                                </HStack>
                            </Box>
                        ),
                    ),
                    _$ => badgeOn.ifElse(
                        _$ => (
                            <Box height="240px" width="360px">
                                <VStack gap="3" width="100%" height="100%">
                                    <Box flex="1" minHeight="0" width="100%" padding="3" background="bg.subtle" borderRadius="md">
                                        <Text>Main board grows into the freed height</Text>
                                    </Box>
                                    <Dock icon="chart-line" label="Metrics" badge="3" orientation="vertical" side="end" expandedSize="120px"
                                          collapsed={collapsedOn} onCollapsedChange={onCollapsed}>
                                        <Box padding="3"><Text>KPI tray content</Text></Box>
                                    </Dock>
                                </VStack>
                            </Box>
                        ),
                        _$ => (
                            <Box height="240px" width="360px">
                                <VStack gap="3" width="100%" height="100%">
                                    <Box flex="1" minHeight="0" width="100%" padding="3" background="bg.subtle" borderRadius="md">
                                        <Text>Main board grows into the freed height</Text>
                                    </Box>
                                    <Dock icon="chart-line" label="Metrics" orientation="vertical" side="end" expandedSize="120px"
                                          collapsed={collapsedOn} onCollapsedChange={onCollapsed}>
                                        <Box padding="3"><Text>KPI tray content</Text></Box>
                                    </Dock>
                                </VStack>
                            </Box>
                        ),
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Orientation", oKey,
                                <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                    items={orientations.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the two switches report as
                            // the Rail / Badge spec rows below rather than as one
                            // value.
                            Configurator.Slot("Chrome",
                                <HStack gap="5" align="center">
                                    <Switch checked={collapsedOn} label="Collapsed" onChange={onCollapsedSw} />
                                    <Switch checked={badgeOn} label="Badge" onChange={onBadge} />
                                </HStack>),
                        ]}
                        preview={preview}
                        spec={[
                            Configurator.Spec("Rail", collapsedOn.ifElse(_$ => "44px icon rail", _$ => "expanded")),
                            Configurator.Spec("Badge", badgeOn.ifElse(_$ => "3", _$ => "none")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/**
 * The concrete driver (#325): a `<Dock>` source panel beside a `<Planner>` drop
 * target in an `<HStack>`. The dock holds a booking list and the Planner is the
 * schedule board; collapsing the dock reclaims horizontal space for the board
 * without covering it (in flow — never an overlay). The Planner sibling is
 * `flex="1" minWidth="0"` so it grows into the freed width.
 */
export const dockBesidePlanner = example({
    keywords: ["Dock", "layout", "Planner", "beside", "drag", "source", "drop", "target", "in-flow", "sidebar", "board"],
    description: "A Dock booking-source panel beside a Planner board — collapsing the dock frees width for the board without covering it",
    fn: East.function([], UIComponentType, ($) => {
        const tanks = $.const([
            { name: "Tank A", role: "Mix" },
            { name: "Tank B", role: "Fill" },
            { name: "Tank C", role: "Hold" },
        ], ArrayType(StructType({ name: StringType, role: StringType })));
        return (
            <Box height="260px" width="100%">
                <HStack gap="4" width="100%" height="100%">
                    <Dock icon="book" label="Bookings" badge="3" expandedSize="30%">
                        <Stack gap="2" padding="3">
                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Grade A — Batch 3</Text></Box>
                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Grade B — Batch 7</Text></Box>
                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Grade C — Batch 1</Text></Box>
                        </Stack>
                    </Dock>
                    <Box flex="1" minWidth="0">
                        <Planner.Point
                            data={tanks}
                            axis={Planner.axis.number({ range: { min: 0, max: 6 } })}
                            columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                            events={_r => [
                                Planner.event({ slot: Planner.at.number(2), label: "plan", state: "added" }),
                            ]}
                            now={Planner.at.number(3)}
                        />
                    </Box>
                </HStack>
            </Box>
        );
    }),
    inputs: [],
});

/**
 * Nested `<Dock>`s — a Dock inside another Dock, each with independent
 * collapsed state (keyed by its own structural storage key). The inner dock
 * starts collapsed to its rail.
 */
export const dockNested = example({
    keywords: ["Dock", "layout", "nested", "nestable", "independent", "state", "rail"],
    description: "Nested Docks — a Dock inside a Dock, each with independent collapsed state",
    fn: East.function([], UIComponentType, (_$) => (
        <Box height="260px" width="360px">
            <Dock icon="layer-group" label="Outer" expandedSize="100%">
                <Stack gap="2" padding="3" width="100%">
                    <Text>Outer content</Text>
                    <Box height="140px" width="100%">
                        <HStack gap="3" width="100%" height="100%">
                            <Dock icon="filter" label="Filters" defaultCollapsed>
                                <Box padding="3"><Text>Inner panel</Text></Box>
                            </Dock>
                            <Box flex="1" minWidth="0" padding="3" background="bg.subtle" borderRadius="md">
                                <Text>Inner board</Text>
                            </Box>
                        </HStack>
                    </Box>
                </Stack>
            </Dock>
        </Box>
    )),
    inputs: [],
});
