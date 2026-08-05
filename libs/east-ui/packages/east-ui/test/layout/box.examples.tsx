/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, some, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Configurator, HStack, SegmentGroup, Select, Style, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const boxBasic = example({
    keywords: ["Box", "Root", "basic", "container"],
    description: "Simple container with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Box><Text>Content inside a basic box</Text></Box>;
    }),
    inputs: [],
});

// ============================================================================
// Box — live configurator over surface, layout, animation and typography
// ============================================================================

export const boxVariants = example({
    keywords: ["Box", "Root", "padding", "background", "borderRadius", "color", "border", "borderColor", "borderWidth", "solid", "dashed", "boxShadow", "elevated", "card", "animation", "pulse", "status", "live", "recomputing", "fontFamily", "mono", "fontVariantNumeric", "tabular-nums", "KPI", "position", "sticky", "scroll", "header", "Reactive", "State", "interactive", "toggle", "flex", "row", "justifyContent", "alignItems", "column", "vertical", "width", "height", "fixed", "dimensions", "nested", "container", "flex-start", "center", "flex-end", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Box configurator — surface, layout, animation and padding axes plus a mono tabular-nums switch driving one live box; the aside toggles a reactive background",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const animations = $.const([
                    variant("none", null), variant("pulse", null),
                ], ArrayType(Style.Types.AnimationPreset));

                // Numeric / token axes collapse the same way: a padding is a
                // spacing-scale token, so the axis is a bare array of the value.
                const paddings = $.const(["0", "3", "4"], ArrayType(StringType));

                // Surface is a preset axis — a background / ink / border / shadow
                // set only reads well together, so a struct carries the label and
                // the values it swaps.
                const surfaces = $.const([
                    { label: "styled",   bg: "bg.brand.subtle",  ink: "link",       border: "none",       borderColor: "transparent",  radius: "md", shadow: variant("none", null) },
                    { label: "solid",    bg: "transparent",      ink: "fg.default", border: "2px solid",  borderColor: "border.brand", radius: "md", shadow: variant("none", null) },
                    { label: "dashed",   bg: "transparent",      ink: "fg.default", border: "2px dashed", borderColor: "status.pos",   radius: "md", shadow: variant("none", null) },
                    { label: "wide",     bg: "bg.danger.subtle", ink: "fg.default", border: "4px solid",  borderColor: "status.neg",   radius: "lg", shadow: variant("none", null) },
                    { label: "elevated", bg: "bg.surface",       ink: "fg.default", border: "none",       borderColor: "transparent",  radius: "md", shadow: variant("md", null) },
                ], ArrayType(StructType({ label: StringType, bg: StringType, ink: StringType, border: StringType, borderColor: StringType, radius: StringType, shadow: Style.Types.BoxShadow })));

                // Layout is a data-set axis (the chip-rail precedent): each entry
                // swaps the flex configuration, the canvas size AND the children
                // that make it legible. `sticky` keeps its scroll container — a
                // pinned header only demonstrates position=sticky while its
                // parent scrolls.
                const layouts = $.const([
                    {
                        label: "flex row", display: variant("flex", null), direction: variant("row", null),
                        justify: variant("space-between", null), align: variant("center", null),
                        gap: "4", width: "auto", height: "auto", overflowY: variant("visible", null),
                        kids: [<Text>Item 1</Text>, <Text>Item 2</Text>, <Text>Item 3</Text>],
                    },
                    {
                        label: "flex column", display: variant("flex", null), direction: variant("column", null),
                        justify: variant("space-around", null), align: variant("center", null),
                        gap: "0", width: "auto", height: "150px", overflowY: variant("visible", null),
                        kids: [<Text>Top</Text>, <Text>Middle</Text>, <Text>Bottom</Text>],
                    },
                    {
                        label: "fixed", display: variant("flex", null), direction: variant("row", null),
                        justify: variant("center", null), align: variant("center", null),
                        gap: "0", width: "200px", height: "100px", overflowY: variant("visible", null),
                        kids: [<Text>200x100 box</Text>],
                    },
                    {
                        label: "nested", display: variant("block", null), direction: variant("row", null),
                        justify: variant("flex-start", null), align: variant("stretch", null),
                        gap: "0", width: "auto", height: "auto", overflowY: variant("visible", null),
                        kids: [<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>Inner box</Text></Box>],
                    },
                    {
                        label: "justify", display: variant("flex", null), direction: variant("column", null),
                        justify: variant("flex-start", null), align: variant("stretch", null),
                        gap: "2", width: "auto", height: "auto", overflowY: variant("visible", null),
                        kids: [
                            <Box display="flex" justifyContent="flex-start" padding="2" background="bg.success.subtle" borderRadius="sm"><Text>start</Text></Box>,
                            <Box display="flex" justifyContent="center" padding="2" background="bg.success.subtle" borderRadius="sm"><Text>center</Text></Box>,
                            <Box display="flex" justifyContent="flex-end" padding="2" background="bg.success.subtle" borderRadius="sm"><Text>end</Text></Box>,
                        ],
                    },
                    {
                        label: "sticky", display: variant("block", null), direction: variant("column", null),
                        justify: variant("flex-start", null), align: variant("stretch", null),
                        gap: "0", width: "auto", height: "240px", overflowY: variant("auto", null),
                        kids: [
                            <Box position="sticky" top="0" zIndex="sticky" padding="3" background="bg.surface" borderColor="border.subtle" borderWidth="thin">
                                <Text>Sticky header</Text>
                            </Box>,
                            <VStack gap="2" padding="3">
                                {Array.from({ length: 10 }, (_, i) => <Text>{`Row ${i + 1}`}</Text>)}
                            </VStack>,
                        ],
                    },
                ], ArrayType(StructType({ label: StringType, display: Style.Types.Display, direction: Style.Types.FlexDirection, justify: Style.Types.JustifyContent, align: Style.Types.AlignItems, gap: StringType, width: StringType, height: StringType, overflowY: Style.Types.Overflow, kids: ArrayType(UIComponentType) })));

                // tabular-nums is only legible against a digit column, so the
                // mono switch swaps the canvas to the KPI digits while it is on
                // (the chip-rail presence-switch precedent).
                const digits = $.const([
                    <VStack gap="1" align="flex-end">
                        <Text>{"  1,234.56"}</Text>
                        <Text>{"    56.07"}</Text>
                        <Text>{"789,012.30"}</Text>
                    </VStack>,
                ], ArrayType(UIComponentType));

                const surfaceBind = $.let(State.bind([StringType], "box_surface", "styled"));
                const layoutBind  = $.let(State.bind([StringType], "box_layout", "flex row"));
                const animBind    = $.let(State.bind([StringType], "box_animation", "none"));
                const paddingBind = $.let(State.bind([StringType], "box_padding", "4"));
                const monoBind    = $.let(State.bind([BooleanType], "box_mono", false));
                const counter     = $.let(State.bind([IntegerType], "box_counter", 0n));

                const sKey  = $.let(surfaceBind.read());
                const lKey  = $.let(layoutBind.read());
                const aKey  = $.let(animBind.read());
                const pKey  = $.let(paddingBind.read());
                const mono  = $.let(monoBind.read());
                const count = $.let(counter.read());

                const onSurface = $.const(East.function([StringType], NullType, ($, next) => { $(surfaceBind.write(next)); }));
                const onLayout  = $.const(East.function([StringType], NullType, ($, next) => { $(layoutBind.write(next)); }));
                const onAnim    = $.const(East.function([StringType], NullType, ($, next) => { $(animBind.write(next)); }));
                const onPadding = $.const(East.function([StringType], NullType, ($, next) => { $(paddingBind.write(next)); }));
                const onMono    = $.const(East.function([BooleanType], NullType, ($, next) => { $(monoBind.write(next)); }));
                const inc       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const surface = $.let(surfaces.filter((_$, o) => o.label.equal(sKey)).get(0n));
                const layout = $.let(layouts.filter((_$, o) => o.label.equal(lKey)).get(0n));
                const animation = $.let(animations.filter((_$, v) => v.getTag().equal(aKey)).get(0n));
                const pad = $.let(paddings.filter((_$, s) => s.equal(pKey)).get(0n));

                const kids = $.let(mono.ifElse(_$ => digits, _$ => layout.kids));
                const bg = $.let(count.remainder(2n).equal(0n).ifElse(_$ => "bg.brand.subtle", _$ => "bg.success.subtle"));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Surface", sKey,
                                <Select value={sKey} onChange={onSurface} size="sm"
                                    items={surfaces.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Layout", lKey,
                                <Select value={lKey} onChange={onLayout} size="sm"
                                    items={layouts.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Animation", aKey,
                                <SegmentGroup value={aKey} onChange={onAnim} size="sm"
                                    items={animations.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Padding", pKey,
                                <SegmentGroup value={pKey} onChange={onPadding} size="sm"
                                    items={paddings.map((_$, s) => SegmentGroup.Item(s, <Text>{s}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Font spec row below rather than as one value.
                            Configurator.Slot("Typography",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={mono} label="Mono" onChange={onMono} />
                                </HStack>),
                        ]}
                        preview={
                            <Box
                                display={layout.display}
                                flexDirection={layout.direction}
                                justifyContent={layout.justify}
                                alignItems={layout.align}
                                gap={layout.gap}
                                width={layout.width}
                                height={layout.height}
                                overflowY={layout.overflowY}
                                background={surface.bg}
                                color={surface.ink}
                                border={surface.border}
                                borderColor={surface.borderColor}
                                borderRadius={surface.radius}
                                boxShadow={surface.shadow}
                                animation={animation}
                                fontFamily={mono.ifElse(_$ => variant("mono", null), _$ => variant("sans", null))}
                                fontVariantNumeric={mono.ifElse(_$ => variant("tabular-nums", null), _$ => variant("normal", null))}
                                padding={{ top: some(pad), right: some(pad), bottom: some(pad), left: some(pad) }}
                            >
                                {kids}
                            </Box>
                        }
                        aside={{
                            label: "Background · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Box padding="4" background={bg} borderRadius="md">
                                        <Text>Box background toggles between brand and success</Text>
                                    </Box>
                                    <Button size="xs" onClick={inc}>Toggle background</Button>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Font", mono.ifElse(_$ => "mono · tabular-nums", _$ => "inherit")),
                            Configurator.Spec("Canvas", East.str`${layout.width} × ${layout.height}`),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// Behavioral isolates — the #320 bounded-column contract
// ============================================================================

export const boxFillScroll = example({
    keywords: ["Box", "fill", "scroll", "scrollY", "flexShrink", "bounded", "sizing", "height"],
    description: "Bounded column (#320) — a fixed-height Box whose pinned header does not shrink (definite size ⇒ flexShrink:0) above a `fill scrollY` region that takes the remaining height and scrolls, replacing the hand-written `flex:1 + min-height:0 + overflow` chain with one prop each",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box display="flex" flexDirection="column" height="220px" width="260px" border="1px solid" borderColor="border.subtle" borderRadius="md" overflow="hidden">
                <Box padding="3" background="bg.subtle"><Text>Pinned header</Text></Box>
                <Box fill scrollY padding="3">
                    <VStack align="stretch" gap="2">
                        {Array.from({ length: 20 }, (_, i) => <Text>{`Scrolling row ${i + 1}`}</Text>)}
                    </VStack>
                </Box>
            </Box>
        );
    }),
    inputs: [],
});
