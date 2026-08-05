/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Button, Configurator, HStack, Meter, SegmentGroup, Separator, Stack, Style, Switch, Tag, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door (V and H side by side)
// ============================================================================

export const stackBasic = example({
    keywords: ["Stack", "VStack", "vertical", "gap", "HStack", "horizontal"],
    description: "Basic pair — basic v stack (vertical stack with gap) and basic h stack (horizontal stack with gap)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="BASIC V STACK" align="start" />
                <VStack gap="3">
                    <Text>First item</Text>
                    <Text>Second item</Text>
                    <Text>Third item</Text>
                </VStack>
                <Separator label="BASIC H STACK" align="start" />
                <HStack gap="4">
                    <Text>Left</Text>
                    <Text>Center</Text>
                    <Text>Right</Text>
                </HStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Stack — live configurator over direction, alignment, density and content
// ============================================================================

export const stackVariants = example({
    keywords: ["Stack", "HStack", "justify", "space-between", "VStack", "align", "center", "wrap", "FlexWrap", "stretch", "nested", "navbar", "navigation", "logo", "density", "cascade", "condensed", "compact", "comfortable", "Reactive", "State", "interactive", "gap", "toggle", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Stack configurator — direction, justify, align, density and content axes plus a wrap switch driving one live stack; the aside toggles gap from a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const directions = $.const([
                    variant("row", null), variant("column", null),
                ], ArrayType(Style.Types.FlexDirection));

                const justifies = $.const([
                    variant("flex-start", null), variant("center", null), variant("space-between", null),
                ], ArrayType(Style.Types.JustifyContent));

                const aligns = $.const([
                    variant("flex-start", null), variant("center", null), variant("stretch", null),
                ], ArrayType(Style.Types.AlignItems));

                const densities = $.const([
                    variant("condensed", null), variant("compact", null), variant("comfortable", null),
                ], ArrayType(Style.Types.Density));

                // Content is a data-set axis (the chip-rail precedent): `chips`
                // carries the Tag / Badge / Meter children the density cascade
                // resizes, `navbar` nests an HStack inside the stack (logo left,
                // links right), `texts` is a plain run that shows wrap.
                const contents = $.const([
                    {
                        label: "chips",
                        kids: [
                            <Tag>Line A</Tag>,
                            <Badge>WK 12</Badge>,
                            <Box width="160px"><Meter value={72.0} tone="success" /></Box>,
                        ],
                    },
                    {
                        label: "navbar",
                        kids: [
                            <Text>Logo</Text>,
                            <HStack gap="4">
                                <Text>Home</Text>
                                <Text>About</Text>
                                <Text>Contact</Text>
                            </HStack>,
                        ],
                    },
                    {
                        label: "texts",
                        kids: [
                            <Text>Item 1</Text>, <Text>Item 2</Text>, <Text>Item 3</Text>,
                            <Text>Item 4</Text>, <Text>Item 5</Text>,
                        ],
                    },
                ], ArrayType(StructType({ label: StringType, kids: ArrayType(UIComponentType) })));

                const directionBind = $.let(State.bind([StringType], "stack_direction", "row"));
                const justifyBind   = $.let(State.bind([StringType], "stack_justify", "space-between"));
                const alignBind     = $.let(State.bind([StringType], "stack_align", "center"));
                const densityBind   = $.let(State.bind([StringType], "stack_density", "compact"));
                const contentBind   = $.let(State.bind([StringType], "stack_content", "chips"));
                const wrapBind      = $.let(State.bind([BooleanType], "stack_wrap", false));
                const counter       = $.let(State.bind([IntegerType], "stack_counter", 0n));

                const dKey   = $.let(directionBind.read());
                const jKey   = $.let(justifyBind.read());
                const aKey   = $.let(alignBind.read());
                const denKey = $.let(densityBind.read());
                const cKey   = $.let(contentBind.read());
                const wrapOn = $.let(wrapBind.read());
                const count  = $.let(counter.read());

                const onDirection = $.const(East.function([StringType], NullType, ($, next) => { $(directionBind.write(next)); }));
                const onJustify   = $.const(East.function([StringType], NullType, ($, next) => { $(justifyBind.write(next)); }));
                const onAlign     = $.const(East.function([StringType], NullType, ($, next) => { $(alignBind.write(next)); }));
                const onDensity   = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onContent   = $.const(East.function([StringType], NullType, ($, next) => { $(contentBind.write(next)); }));
                const onWrap      = $.const(East.function([BooleanType], NullType, ($, next) => { $(wrapBind.write(next)); }));
                const inc         = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const direction = $.let(directions.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
                const justify = $.let(justifies.filter((_$, v) => v.getTag().equal(jKey)).get(0n));
                const align = $.let(aligns.filter((_$, v) => v.getTag().equal(aKey)).get(0n));
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(denKey)).get(0n));
                const content = $.let(contents.filter((_$, o) => o.label.equal(cKey)).get(0n));

                // The folded interactive: gap alternates tight / wide on each
                // click of the aside button.
                const asideGap = $.let(count.remainder(2n).equal(0n).ifElse(_$ => "1", _$ => "8"));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Direction", dKey,
                                <SegmentGroup value={dKey} onChange={onDirection} size="sm"
                                    items={directions.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Justify", jKey,
                                <SegmentGroup value={jKey} onChange={onJustify} size="sm"
                                    items={justifies.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Align", aKey,
                                <SegmentGroup value={aKey} onChange={onAlign} size="sm"
                                    items={aligns.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Density", denKey,
                                <SegmentGroup value={denKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Content", cKey,
                                <SegmentGroup value={cKey} onChange={onContent} size="sm"
                                    items={contents.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Width spec row below rather than as one value.
                            Configurator.Slot("Wrap",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={wrapOn} label="Wrap" onChange={onWrap} />
                                </HStack>),
                        ]}
                        preview={
                            <Stack
                                direction={direction}
                                justify={justify}
                                align={align}
                                wrap={wrapOn.ifElse(_$ => variant("wrap", null), _$ => variant("nowrap", null))}
                                density={density}
                                gap="3"
                                padding="4"
                                background="bg.subtle"
                                borderRadius="md"
                                width={wrapOn.ifElse(_$ => "200px", _$ => "100%")}
                                height="120px"
                            >
                                {content.kids}
                            </Stack>
                        }
                        aside={{
                            label: "Gap · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <VStack gap={asideGap} align="stretch">
                                        <Text>First</Text>
                                        <Text>Second</Text>
                                        <Text>Third</Text>
                                    </VStack>
                                    <Button size="xs" onClick={inc}>Toggle gap</Button>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Width", wrapOn.ifElse(_$ => "200px", _$ => "100%")),
                            Configurator.Spec("Children", East.print(content.kids.size())),
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

export const stackFillScroll = example({
    keywords: ["Stack", "VStack", "fill", "scroll", "scrollY", "bounded", "sizing", "height"],
    description: "A height-bounded VStack (#320): a pinned header above a `fill scrollY` VStack that takes the remaining height and scrolls, so the region bounds and scrolls inside its box without pixel arithmetic",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack height="220px" width="260px" align="stretch" gap="0">
                <Box background="bg.subtle" padding="3"><Text>Header</Text></Box>
                <VStack fill scrollY align="stretch" gap="2" padding="3">
                    {Array.from({ length: 20 }, (_, i) => <Text>{`Item ${i + 1}`}</Text>)}
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
