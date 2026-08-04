/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, FloatType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Configurator, SegmentGroup, Splitter, Text, HStack, Reactive } from "@elaraai/east-ui";

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
                        Splitter.Panel(<Box padding="4" background="bg.brand.subtle"><Text>Left Panel</Text></Box>, { id: "left" }),
                        Splitter.Panel(<Box padding="4" background="bg.success.subtle"><Text>Right Panel</Text></Box>, { id: "right" }),
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
// Splitter — live configurator over orientation, panel-size and collapse axes
// ============================================================================

export const splitterVariants = example({
    keywords: ["Splitter", "Root", "Panel", "orientation", "vertical", "three", "sidebar", "main", "minSize", "maxSize", "constraints", "asymmetric", "70/30", "editor", "terminal", "collapsible", "defaultCollapsed", "onResizeStart", "onResizeEnd", "onResize", "callback", "interactive", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Splitter configurator — orientation, panel-size and collapse-mode axes driving one live splitter; the aside logs onResize / onResizeStart / onResizeEnd as the divider drags",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // The orientation axis is just its variants — `getTag()` gives
                // the segment key AND its label.
                const orientations = $.const([
                    variant("horizontal", null), variant("vertical", null),
                ], ArrayType(Style.Types.Orientation));

                // Collapse mode threads Panel-level expressions into the first
                // panel of whichever preset is selected.
                const collapseModes = $.const(["none", "collapsible", "collapsed"], ArrayType(StringType));

                const orientationBind = $.let(State.bind([StringType], "splitter_orientation", "horizontal"));
                const panelsBind      = $.let(State.bind([StringType], "splitter_panels", "even"));
                const collapseBind    = $.let(State.bind([StringType], "splitter_collapse", "none"));
                const startBind       = $.let(State.bind([IntegerType], "splitter_start_count", 0n));
                const endBind         = $.let(State.bind([IntegerType], "splitter_end_count", 0n));
                const leftBind        = $.let(State.bind([FloatType], "splitter_left_size", 50.0));
                const rightBind       = $.let(State.bind([FloatType], "splitter_right_size", 50.0));

                const oKey = $.let(orientationBind.read());
                const pKey = $.let(panelsBind.read());
                const cKey = $.let(collapseBind.read());
                const startCount = $.let(startBind.read());
                const endCount = $.let(endBind.read());
                const leftSize = $.let(leftBind.read());
                const rightSize = $.let(rightBind.read());

                const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));
                const onPanels      = $.const(East.function([StringType], NullType, ($, next) => { $(panelsBind.write(next)); }));
                const onCollapse    = $.const(East.function([StringType], NullType, ($, next) => { $(collapseBind.write(next)); }));
                const onResizeStart = $.const(East.function([], NullType, $ => {
                    const cur = $.let(startBind.read());
                    $(startBind.write(cur.add(1n)));
                }));
                const onResizeEnd = $.const(East.function([Splitter.Types.ResizeDetails], NullType, ($, _details) => {
                    const cur = $.let(endBind.read());
                    $(endBind.write(cur.add(1n)));
                }));
                const onResize = $.const(East.function([Splitter.Types.ResizeDetails], NullType, ($, details) => {
                    const sizes = $.let(details.size);
                    $(leftBind.write(sizes.get(0n)));
                    $(rightBind.write(sizes.get(1n)));
                }));

                // Collapse-mode expressions embedded in each preset's first panel.
                const canCollapse = $.let(cKey.equal("none").not());
                const startCollapsed = $.let(cKey.equal("collapsed"));

                // The panel-size axis is a preset table: each entry carries its
                // whole panel array (with min/max constraints where the preset
                // is about them) and the matching defaultSize percentages.
                const presets = $.const([
                    { label: "even", sizes: [50.0, 50.0], panels: [
                        Splitter.Panel(<Box padding="4" background="bg.brand.subtle"><Text>Left Panel</Text></Box>, { id: "left", collapsible: canCollapse, defaultCollapsed: startCollapsed }),
                        Splitter.Panel(<Box padding="4" background="bg.success.subtle"><Text>Right Panel</Text></Box>, { id: "right" }),
                    ] },
                    { label: "asymmetric", sizes: [70.0, 30.0], panels: [
                        Splitter.Panel(<Box padding="3" background="bg.brand.subtle"><Text>Primary (70%)</Text></Box>, { id: "primary", collapsible: canCollapse, defaultCollapsed: startCollapsed }),
                        Splitter.Panel(<Box padding="3" background="bg.brand.subtle"><Text>Secondary (30%)</Text></Box>, { id: "secondary" }),
                    ] },
                    { label: "three", sizes: [20.0, 60.0, 20.0], panels: [
                        Splitter.Panel(<Box padding="3" background="bg.subtle"><Text>Sidebar</Text></Box>, { id: "sidebar", collapsible: canCollapse, defaultCollapsed: startCollapsed }),
                        Splitter.Panel(<Box padding="3" background="bg.subtle"><Text>Main Content</Text></Box>, { id: "main" }),
                        Splitter.Panel(<Box padding="3" background="bg.subtle"><Text>Details</Text></Box>, { id: "details" }),
                    ] },
                    { label: "constrained", sizes: [25.0, 75.0], panels: [
                        Splitter.Panel(<Box padding="3" background="bg.brand.subtle"><Text>Nav (min 15%, max 30%)</Text></Box>, { id: "nav", minSize: 15, maxSize: 30, collapsible: canCollapse, defaultCollapsed: startCollapsed }),
                        Splitter.Panel(<Box padding="3" background="bg.brand.subtle"><Text>Content (min 50%)</Text></Box>, { id: "content", minSize: 50 }),
                    ] },
                ], ArrayType(StructType({ label: StringType, sizes: ArrayType(FloatType), panels: ArrayType(Splitter.Types.Panel) })));

                // Each selection is a lookup into the same array the control renders.
                const orientSel = $.let(orientations.filter((_$, v) => v.getTag().equal(oKey)).get(0n));
                const preset = $.let(presets.filter((_$, o) => o.label.equal(pKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Orientation", oKey,
                                <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                    items={orientations.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Panels", pKey,
                                <SegmentGroup value={pKey} onChange={onPanels} size="sm"
                                    items={presets.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Collapse", cKey,
                                <SegmentGroup value={cKey} onChange={onCollapse} size="sm"
                                    items={collapseModes.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        ]}
                        preview={
                            <Box height="200px">
                                <Splitter
                                    panels={preset.panels}
                                    defaultSize={preset.sizes}
                                    orientation={orientSel}
                                    onResize={onResize}
                                    onResizeStart={onResizeStart}
                                    onResizeEnd={onResizeEnd}
                                />
                            </Box>
                        }
                        aside={{
                            label: "Resize · events",
                            body: (
                                <HStack gap="2">
                                    <Badge colorPalette="brand">{East.str`Start: ${East.print(startCount)}`}</Badge>
                                    <Badge colorPalette="brand">{East.str`End: ${East.print(endCount)}`}</Badge>
                                    <Badge colorPalette="brand" variant="solid">{East.str`Left: ${East.print(leftSize)}%`}</Badge>
                                    <Badge colorPalette="success" variant="solid">{East.str`Right: ${East.print(rightSize)}%`}</Badge>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Panel count", East.print(preset.panels.size())),
                            Configurator.Spec("First panel", cKey),
                        ]}
                    />
                );
            }}</Reactive>
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
                        Splitter.Panel(<Box padding="4" background="bg.brand.subtle"><Text>Primary</Text></Box>, { id: "primary" }),
                        Splitter.Panel(<Box padding="4" background="bg.success.subtle"><Text>Secondary</Text></Box>, { id: "secondary" }),
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
