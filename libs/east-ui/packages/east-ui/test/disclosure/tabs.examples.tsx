/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Configurator, SegmentGroup, Switch, Tabs, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

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
// Tabs — live configurator over every trigger + style axis
// ============================================================================

export const tabsVariants = example({
    keywords: ["Tabs", "Root", "variant", "line", "underline", "fitted", "equal width", "size", "sm", "md", "lg", "Item", "disabled", "trigger", "count", "mono", "rich", "two-line", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State", "onValueChange", "interactive", "controlled"],
    description: "Tabs configurator — variant, size and trigger-preset axes plus fitted and disabled-tab switches driving one live tab strip; the aside round-trips a controlled strip's active tab",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const variants = $.const([
                    variant("line", null), variant("plain", null),
                ], ArrayType(Tabs.Types.Variant));

                const sizes = $.const([
                    variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Tabs.Types.Size));

                // A trigger preset is its items PLUS the tab that starts
                // selected, so the axis is a struct.
                const presets = $.const([
                    {
                        label: "plain", defaultTab: "tab1",
                        items: [
                            Tabs.Item("tab1", "Account", [<Box padding="4"><Text>Manage your account settings and preferences.</Text></Box>]),
                            Tabs.Item("tab2", "Security", [<Box padding="4"><Text>Configure security options and two-factor authentication.</Text></Box>]),
                            Tabs.Item("tab3", "Billing", [<Box padding="4"><Text>View billing history and update payment methods.</Text></Box>]),
                        ],
                    },
                    {
                        label: "count", defaultTab: "inputs",
                        items: [
                            Tabs.Item("inputs", "Inputs", [<Box padding="4"><Text>Three inputs are defined.</Text></Box>]),
                            Tabs.Item(
                                "results",
                                <HStack gap="2" align="center"><Text>Results</Text>{<Text.MonoSm>{"5"}</Text.MonoSm>}</HStack>,
                                [<Box padding="4"><Text>Five results computed.</Text></Box>],
                            ),
                        ],
                    },
                    {
                        label: "two-line", defaultTab: "week-06",
                        items: [
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
                        ],
                    },
                ], ArrayType(StructType({ label: StringType, defaultTab: StringType, items: ArrayType(Tabs.Types.Item) })));

                const variantBind  = $.let(State.bind([StringType], "tabs_variant", "line"));
                const sizeBind     = $.let(State.bind([StringType], "tabs_size", "md"));
                const triggerBind  = $.let(State.bind([StringType], "tabs_trigger", "plain"));
                const fittedBind   = $.let(State.bind([BooleanType], "tabs_fitted", false));
                const disabledBind = $.let(State.bind([BooleanType], "tabs_disabled", false));
                // The aside is the reactive row — a controlled strip whose
                // active tab round-trips through State (the old reactive
                // panel's key).
                const activeBind   = $.let(State.bind([StringType], "tabs_reactive_active", "a"));

                const vKey     = $.let(variantBind.read());
                const sKey     = $.let(sizeBind.read());
                const tKey     = $.let(triggerBind.read());
                const fitted   = $.let(fittedBind.read());
                const disabled = $.let(disabledBind.read());
                const active   = $.let(activeBind.read(), StringType);

                const onVariant  = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onSize     = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onTrigger  = $.const(East.function([StringType], NullType, ($, next) => { $(triggerBind.write(next)); }));
                const onFitted   = $.const(East.function([BooleanType], NullType, ($, next) => { $(fittedBind.write(next)); }));
                const onDisabled = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
                const onActive   = $.const(East.function([StringType], NullType, ($, next) => { $(activeBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const tabsVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const preset = $.let(presets.filter((_$, o) => o.label.equal(tKey)).get(0n));

                // The disabled switch appends a disabled tab to the preset.
                const locked = $.const([
                    Tabs.Item("locked", "Disabled", [<Box padding="4"><Text>This content is not accessible.</Text></Box>], { disabled: true }),
                ], ArrayType(Tabs.Types.Item));
                const items = $.let(disabled.ifElse(_$ => preset.items.concat(locked), _$ => preset.items));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Trigger", tKey,
                                <SegmentGroup value={tKey} onChange={onTrigger} size="sm"
                                    items={presets.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the two switches report as the
                            // Fitted / Tabs spec rows below rather than as one value.
                            Configurator.Slot("List",
                                <HStack gap="5" align="center">
                                    <Switch checked={fitted} label="Fitted" onChange={onFitted} />
                                    <Switch checked={disabled} label="Disabled tab" onChange={onDisabled} />
                                </HStack>),
                        ]}
                        preview={
                            <Box width="100%">
                                <Tabs
                                    items={items}
                                    defaultValue={preset.defaultTab}
                                    variant={tabsVariant}
                                    size={size}
                                    fitted={fitted}
                                />
                            </Box>
                        }
                        aside={{
                            label: "Controlled · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Tabs
                                        items={[
                                            Tabs.Item("a", "Tab A", [<Box padding="4"><Text>A content</Text></Box>]),
                                            Tabs.Item("b", "Tab B", [<Box padding="4"><Text>B content</Text></Box>]),
                                            Tabs.Item("c", "Tab C", [<Box padding="4"><Text>C content</Text></Box>]),
                                        ]}
                                        value={active}
                                        onValueChange={onActive}
                                        variant="line"
                                    />
                                    <Text color="fg.muted">{East.str`Active: ${active}`}</Text>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Tabs", East.print(items.size())),
                            Configurator.Spec("Fitted", fitted.ifElse(_$ => "equal width", _$ => "natural")),
                            Configurator.Spec("Disabled", disabled.ifElse(_$ => "one blocked", _$ => "none")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

