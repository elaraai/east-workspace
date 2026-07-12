/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, StringType, StructType, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Box, Dock, HStack, Planner, Stack, Text, VStack } from "@elaraai/east-ui";

/**
 * A horizontal `<Dock>` expanded — its header carries the `icon`, `label`, and
 * `badge`, a collapse chevron on the right, and the children below. Reach for
 * it when a source panel (a booking library, a filter rail) should be able to
 * tuck away beside the board it feeds.
 */
export const dockExpanded = example({
    keywords: ["Dock", "layout", "collapse", "rail", "expanded", "icon", "badge", "sidebar"],
    description: "A horizontal Dock expanded — icon + label + badge header over its content, with a collapse chevron",
    fn: East.function([], UIComponentType, (_$) => (
        <Box height="220px" width="320px">
            <Dock icon="book" label="Bookings" badge="3" expandedSize="100%">
                <Stack gap="2" padding="3">
                    <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Cabernet — Block 3</Text></Box>
                    <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Shiraz — Block 7</Text></Box>
                    <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Merlot — Block 1</Text></Box>
                </Stack>
            </Dock>
        </Box>
    )),
    inputs: [],
});

/**
 * The same Dock collapsed (`defaultCollapsed`) — it shrinks to the `railSize`
 * icon rail: the `icon`, an expand chevron, and the `badge`, with `label` as
 * the rail's tooltip. The kept-mounted body is hidden, preserving its state.
 */
export const dockCollapsedRail = example({
    keywords: ["Dock", "layout", "collapsed", "rail", "icon", "badge", "defaultCollapsed", "tooltip"],
    description: "A horizontal Dock collapsed to its icon rail — icon + expand chevron + badge, label as tooltip",
    fn: East.function([], UIComponentType, (_$) => (
        <Box height="220px" width="320px">
            <HStack gap="3" width="100%" height="100%">
                <Dock icon="book" label="Bookings" badge="3" railSize="44px" defaultCollapsed>
                    <Stack gap="2" padding="3">
                        <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Cabernet — Block 3</Text></Box>
                    </Stack>
                </Dock>
                <Box flex="1" minWidth="0" padding="3" background="bg.subtle" borderRadius="md">
                    <Text>Board reclaims the freed width</Text>
                </Box>
            </HStack>
        </Box>
    )),
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
            { name: "Tank A", role: "Ferment" },
            { name: "Tank B", role: "Crush" },
            { name: "Tank C", role: "Press" },
        ], ArrayType(StructType({ name: StringType, role: StringType })));
        return (
            <Box height="260px" width="100%">
                <HStack gap="4" width="100%" height="100%">
                    <Dock icon="book" label="Bookings" badge="3" expandedSize="30%">
                        <Stack gap="2" padding="3">
                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Cabernet — Block 3</Text></Box>
                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Shiraz — Block 7</Text></Box>
                            <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Merlot — Block 1</Text></Box>
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
 * A vertical `<Dock>` — it collapses its HEIGHT to a horizontal tray rail
 * instead of its width. Same header / rail chrome, pinned to the `end` (bottom)
 * edge so the chevron points down when collapsed.
 */
export const dockVertical = example({
    keywords: ["Dock", "layout", "vertical", "orientation", "tray", "collapse", "height", "side", "end"],
    description: "A vertical Dock — collapses its height to a horizontal tray rail, pinned to the bottom edge",
    fn: East.function([], UIComponentType, (_$) => (
        <Box height="240px" width="360px">
            <VStack gap="3" width="100%" height="100%">
                <Box flex="1" minHeight="0" width="100%" padding="3" background="bg.subtle" borderRadius="md">
                    <Text>Main board grows into the freed height</Text>
                </Box>
                <Dock icon="chart-line" label="Metrics" orientation="vertical" side="end" expandedSize="120px">
                    <Box padding="3"><Text>KPI tray content</Text></Box>
                </Dock>
            </VStack>
        </Box>
    )),
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
