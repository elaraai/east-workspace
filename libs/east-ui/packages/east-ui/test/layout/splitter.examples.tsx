/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, FloatType, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Splitter, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const splitterBasic = example({
    keywords: ["Splitter", "Root", "Panel", "orientation", "horizontal", "basic"],
    description: "Two panels with horizontal split",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box height="150px">
                <Splitter
                    panels={[
                        Splitter.Panel(<Box padding="4" background="blue.50"><Text>Left Panel</Text></Box>, { id: "left" }),
                        Splitter.Panel(<Box padding="4" background="green.50"><Text>Right Panel</Text></Box>, { id: "right" }),
                    ]}
                    defaultSize={[50, 50]}
                    orientation="horizontal"
                />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Splitter — orientation, panel counts, constraints (variant panel)
// ============================================================================

export const splitterVariants = example({
    keywords: ["Splitter", "Root", "Panel", "orientation", "vertical", "three", "sidebar", "main", "minSize", "maxSize", "constraints", "asymmetric", "70/30", "editor", "terminal"],
    description: "Splitter variant panel — vertical (top and bottom panels), three panel (sidebar, main, and details), constrained (panel with min/max sizes), asymmetric (asymmetric default sizes), editor (code editor with terminal)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">VERTICAL</Text>
                    <Box height="200px">
                        <Splitter
                            panels={[
                                Splitter.Panel(<Box padding="4" background="purple.50"><Text>Top Panel</Text></Box>, { id: "top" }),
                                Splitter.Panel(<Box padding="4" background="orange.50"><Text>Bottom Panel</Text></Box>, { id: "bottom" }),
                            ]}
                            defaultSize={[40, 60]}
                            orientation="vertical"
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">THREE PANEL</Text>
                    <Box height="150px">
                        <Splitter
                            panels={[
                                Splitter.Panel(<Box padding="3" background="gray.100"><Text>Sidebar</Text></Box>, { id: "sidebar" }),
                                Splitter.Panel(<Box padding="3" background="gray.50"><Text>Main Content</Text></Box>, { id: "main" }),
                                Splitter.Panel(<Box padding="3" background="gray.100"><Text>Details</Text></Box>, { id: "details" }),
                            ]}
                            defaultSize={[20, 60, 20]}
                            orientation="horizontal"
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CONSTRAINED</Text>
                    <Box height="120px">
                        <Splitter
                            panels={[
                                Splitter.Panel(<Box padding="3" background="teal.50"><Text>Nav (min 15%, max 30%)</Text></Box>, { id: "nav", minSize: 15, maxSize: 30 }),
                                Splitter.Panel(<Box padding="3" background="teal.100"><Text>Content (min 50%)</Text></Box>, { id: "content", minSize: 50 }),
                            ]}
                            defaultSize={[25, 75]}
                            orientation="horizontal"
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">ASYMMETRIC</Text>
                    <Box height="120px">
                        <Splitter
                            panels={[
                                Splitter.Panel(<Box padding="3" background="cyan.50"><Text>Primary (70%)</Text></Box>, { id: "primary" }),
                                Splitter.Panel(<Box padding="3" background="cyan.100"><Text>Secondary (30%)</Text></Box>, { id: "secondary" }),
                            ]}
                            defaultSize={[70, 30]}
                            orientation="horizontal"
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">EDITOR</Text>
                    <Box height="200px">
                        <Splitter
                            panels={[
                                Splitter.Panel(<Box padding="4" background="gray.800" color="white"><Text>Code Editor</Text></Box>, { id: "editor", minSize: 30 }),
                                Splitter.Panel(<Box padding="4" background="gray.900" color="green.400"><Text>Terminal</Text></Box>, { id: "terminal", minSize: 10 }),
                            ]}
                            defaultSize={[70, 30]}
                            orientation="vertical"
                        />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Splitter — the resize callback grammar (merged pair)
// ============================================================================

export const splitterResizeEvents = example({
    keywords: ["Splitter", "Panel", "onResizeStart", "onResizeEnd", "Reactive", "State", "interactive", "onResize", "callback"],
    description: "Resize-event pair — on resize start end (drag handle counts onResizeStart and onResizeEnd transitions) and interactive (drag to see the onResize callback)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">ON RESIZE START END</Text>
                    <Reactive>{$ => {
                        const startBind = $.let(State.bind([IntegerType], "splitter_start_count", 0n));
                        const endBind = $.let(State.bind([IntegerType], "splitter_end_count", 0n));
                        const startCount = $.let(startBind.read());
                        const endCount = $.let(endBind.read());
                        const onResizeStart = $.const(East.function([], NullType, $ => {
                            const cur = $.let(startBind.read());
                            $(startBind.write(cur.add(1n)));
                        }));
                        const onResizeEnd = $.const(East.function([Splitter.Types.ResizeDetails], NullType, ($, _details) => {
                            const cur = $.let(endBind.read());
                            $(endBind.write(cur.add(1n)));
                        }));
                        return (
                            <VStack gap="3" align="stretch">
                                <Box height="150px">
                                    <Splitter
                                        panels={[
                                            Splitter.Panel(<Box padding="4" background="purple.100"><Text>Drag the divider</Text></Box>, { id: "a" }),
                                            Splitter.Panel(<Box padding="4" background="pink.100"><Text>Right side</Text></Box>, { id: "b" }),
                                        ]}
                                        defaultSize={[50, 50]}
                                        orientation="horizontal"
                                        onResizeStart={onResizeStart}
                                        onResizeEnd={onResizeEnd}
                                    />
                                </Box>
                                <HStack gap="2">
                                    <Badge colorPalette="purple">{East.str`Start: ${East.print(startCount)}`}</Badge>
                                    <Badge colorPalette="pink">{East.str`End: ${East.print(endCount)}`}</Badge>
                                </HStack>
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INTERACTIVE</Text>
                    <Reactive>{$ => {
                        const leftBind = $.let(State.bind([FloatType], "splitter_left_size", 50.0));
                        const rightBind = $.let(State.bind([FloatType], "splitter_right_size", 50.0));
                        const leftSize = $.let(leftBind.read());
                        const rightSize = $.let(rightBind.read());
                        const onResize = $.const(East.function([Splitter.Types.ResizeDetails], NullType, ($, details) => {
                            const sizes = $.let(details.size);
                            $(leftBind.write(sizes.get(0n)));
                            $(rightBind.write(sizes.get(1n)));
                        }));
                        return (
                            <VStack gap="3" align="stretch">
                                <Box height="150px">
                                    <Splitter
                                        panels={[
                                            Splitter.Panel(<Box padding="4" background="blue.100"><Text>Left Panel</Text></Box>, { id: "left" }),
                                            Splitter.Panel(<Box padding="4" background="green.100"><Text>Right Panel</Text></Box>, { id: "right" }),
                                        ]}
                                        defaultSize={[50, 50]}
                                        orientation="horizontal"
                                        onResize={onResize}
                                    />
                                </Box>
                                <HStack gap="2">
                                    <Badge colorPalette="blue" variant="solid">{East.str`Left: ${East.print(leftSize)}%`}</Badge>
                                    <Badge colorPalette="green" variant="solid">{East.str`Right: ${East.print(rightSize)}%`}</Badge>
                                </HStack>
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Behavioral isolates — golden-coupled responsive contract, name and body frozen
// ============================================================================

export const splitterCollapseBelow = example({
    keywords: ["Splitter", "collapseBelow", "responsive", "stack", "narrow", "mobile", "compact"],
    description: "Panels stack vertically when the container is narrower than collapseBelow",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box height="150px">
                <Splitter
                    panels={[
                        Splitter.Panel(<Box padding="4" background="blue.50"><Text>Primary</Text></Box>, { id: "primary" }),
                        Splitter.Panel(<Box padding="4" background="green.50"><Text>Secondary</Text></Box>, { id: "secondary" }),
                    ]}
                    defaultSize={[60, 40]}
                    orientation="horizontal"
                    collapseBelow={480}
                />
            </Box>
        );
    }),
    inputs: [],
});
