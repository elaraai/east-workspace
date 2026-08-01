/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Separator, Tabs, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

export const tabsBasic = example({
    keywords: ["Tabs", "Root", "Item", "defaultValue", "basic"],
    description: "Simple tabbed interface",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box width="100%">
                <Tabs
                    items={[
                        Tabs.Item("overview", "Overview", [<Box padding="4"><Text>Welcome to the overview tab. This is the default content panel.</Text></Box>]),
                        Tabs.Item("features", "Features", [<Box padding="4"><Text>Explore our features in this panel.</Text></Box>]),
                        Tabs.Item("pricing", "Pricing", [<Box padding="4"><Text>View pricing information here.</Text></Box>]),
                    ]}
                    defaultValue="overview"
                />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Variants — static enumeration panel (consolidation epic #455).
// ============================================================================

export const tabsVariants = example({
    keywords: ["Tabs", "Root", "variant", "line", "underline", "fitted", "equal width", "size", "sm", "md", "lg", "Item", "disabled", "trigger", "count", "mono", "rich", "two-line"],
    description: "Tabs variant panel — line (underline indicator), fitted (equal width tabs), sizes (small, medium, and large), with disabled (one tab disabled), with count badges (rich trigger with an inline mono count per bsys eyebrow grammar), two line (rich two-line trigger mirroring the Week / Period header)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="LINE" align="start" />
                <Box width="100%">
                    <Tabs
                        items={[
                            Tabs.Item("tab1", "Account", [<Box padding="4"><Text>Manage your account settings and preferences.</Text></Box>]),
                            Tabs.Item("tab2", "Security", [<Box padding="4"><Text>Configure security options and two-factor authentication.</Text></Box>]),
                            Tabs.Item("tab3", "Billing", [<Box padding="4"><Text>View billing history and update payment methods.</Text></Box>]),
                        ]}
                        defaultValue="tab1"
                        variant="line"
                    />
                </Box>
                <Separator label="FITTED" align="start" />
                <Box width="100%">
                    <Tabs
                        items={[
                            Tabs.Item("day", "Day", [<Box padding="4"><Text>Daily view of your calendar.</Text></Box>]),
                            Tabs.Item("week", "Week", [<Box padding="4"><Text>Weekly view of your calendar.</Text></Box>]),
                            Tabs.Item("month", "Month", [<Box padding="4"><Text>Monthly view of your calendar.</Text></Box>]),
                        ]}
                        defaultValue="week"
                        variant="line"
                        fitted={true}
                    />
                </Box>
                <Separator label="SIZES" align="start" />
                <VStack gap="4" align="stretch" width="100%">
                    <Tabs
                        items={[
                            Tabs.Item("sm1", "Small", [<Box padding="4"><Text>Small size tabs</Text></Box>]),
                            Tabs.Item("sm2", "Tabs", [<Box padding="4"><Text>Content</Text></Box>]),
                        ]}
                        defaultValue="sm1"
                        size="sm"
                        variant="line"
                    />
                    <Tabs
                        items={[
                            Tabs.Item("md1", "Medium", [<Box padding="4"><Text>Medium size tabs</Text></Box>]),
                            Tabs.Item("md2", "Tabs", [<Box padding="4"><Text>Content</Text></Box>]),
                        ]}
                        defaultValue="md1"
                        size="md"
                        variant="line"
                    />
                    <Tabs
                        items={[
                            Tabs.Item("lg1", "Large", [<Box padding="4"><Text>Large size tabs</Text></Box>]),
                            Tabs.Item("lg2", "Tabs", [<Box padding="4"><Text>Content</Text></Box>]),
                        ]}
                        defaultValue="lg1"
                        size="lg"
                        variant="line"
                    />
                </VStack>
                <Separator label="WITH DISABLED" align="start" />
                <Box width="100%">
                    <Tabs
                        items={[
                            Tabs.Item("enabled1", "Enabled", [<Box padding="4"><Text>This tab is enabled.</Text></Box>]),
                            Tabs.Item("disabled", "Disabled", [<Box padding="4"><Text>This content is not accessible.</Text></Box>], { disabled: true }),
                            Tabs.Item("enabled2", "Also Enabled", [<Box padding="4"><Text>This tab is also enabled.</Text></Box>]),
                        ]}
                        defaultValue="enabled1"
                        variant="line"
                    />
                </Box>
                <Separator label="WITH COUNT BADGES" align="start" />
                <Tabs
                    items={[
                        Tabs.Item("inputs", "Inputs", [<Box padding="4"><Text>Three inputs are defined.</Text></Box>]),
                        Tabs.Item(
                            "results",
                            <HStack gap="2" align="center"><Text>Results</Text>{<Text.MonoSm>{"5"}</Text.MonoSm>}</HStack>,
                            [<Box padding="4"><Text>Five results computed.</Text></Box>],
                        ),
                    ]}
                    defaultValue="inputs"
                    variant="line"
                />
                <Separator label="TWO LINE" align="start" />
                <Tabs
                    items={[
                        Tabs.Item(
                            "week-06",
                            <VStack gap="0" align="flex-start"><Text fontWeight="semibold">Week 06</Text><Text color="fg.muted">Cycle · 3–9 Feb</Text></VStack>,
                            [<Box padding="4"><Text>Week 06 detail.</Text></Box>],
                        ),
                        Tabs.Item(
                            "week-12",
                            <VStack gap="0" align="flex-start"><Text fontWeight="semibold">Week 12</Text><Text color="fg.muted">Cycle · 17–23 Mar</Text></VStack>,
                            [<Box padding="4"><Text>Week 12 detail.</Text></Box>],
                        ),
                    ]}
                    defaultValue="week-06"
                    variant="line"
                />
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Reactive — interactive/controlled rows (consolidation epic #455).
// ============================================================================

export const tabsReactive = example({
    keywords: ["Tabs", "Root", "Reactive", "State", "onValueChange", "interactive", "controlled"],
    description: "Reactive tabs panel — interactive (click tabs to see the onValueChange callback), reactive (controlled Tabs with a live active-tab indicator)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="INTERACTIVE" align="start" />
                <Reactive>{$ => {
                    const selectedBind = $.let(State.bind([StringType], "tabs_selected", "tab1"));
                    const selected = $.let(selectedBind.read(), StringType);
                    const onValueChange = $.const(East.function([StringType], NullType, ($, newValue) => {
                        $(selectedBind.write(newValue));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <Box width="100%">
                                <Tabs
                                    items={[
                                        Tabs.Item("tab1", "Dashboard", [<Box padding="4"><Text>Dashboard content - view your metrics here.</Text></Box>]),
                                        Tabs.Item("tab2", "Analytics", [<Box padding="4"><Text>Analytics content - detailed reports and charts.</Text></Box>]),
                                        Tabs.Item("tab3", "Settings", [<Box padding="4"><Text>Settings content - configure your preferences.</Text></Box>]),
                                    ]}
                                    defaultValue="tab1"
                                    onValueChange={onValueChange}
                                    variant="line"
                                />
                            </Box>
                            {<Text.Eyebrow>{East.str`SELECTED · ${selected}`}</Text.Eyebrow>}
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="REACTIVE" align="start" />
                <Reactive>{$ => {
                    const bind = $.let(State.bind([StringType], "tabs_reactive_active", "a"));
                    const active = $.let(bind.read(), StringType);
                    const onValueChange = $.const(East.function([StringType], NullType, ($, next) => {
                        $(bind.write(next));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <Tabs
                                items={[
                                    Tabs.Item("a", "Tab A", [<Box padding="4"><Text>A content</Text></Box>]),
                                    Tabs.Item("b", "Tab B", [<Box padding="4"><Text>B content</Text></Box>]),
                                    Tabs.Item("c", "Tab C", [<Box padding="4"><Text>C content</Text></Box>]),
                                ]}
                                value={active}
                                onValueChange={onValueChange}
                                variant="line"
                            />
                            <Text color="fg.muted">{East.str`Active: ${active}`}</Text>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
