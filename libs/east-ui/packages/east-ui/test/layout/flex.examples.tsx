/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, Flex, HStack, SegmentGroup, Style, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const flexBasic = example({
    keywords: ["Flex", "Root", "basic", "row", "gap"],
    description: "Simple flex container (row by default)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex gap="4">
                <Text>Item 1</Text>
                <Text>Item 2</Text>
                <Text>Item 3</Text>
            </Flex>
        );
    }),
    inputs: [],
});

// ============================================================================
// Flex — live configurator over direction, alignment and content
// ============================================================================

export const flexVariants = example({
    keywords: ["Flex", "Root", "direction", "row", "justifyContent", "space-between", "column", "alignItems", "wrap", "responsive", "center", "nested", "flex-start", "flex-end", "row-reverse", "Reactive", "State", "interactive", "toggle", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Flex configurator — direction, justify, align and content axes plus a wrap switch driving one live flex container; the aside toggles direction from a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const directions = $.const([
                    variant("row", null), variant("column", null), variant("row-reverse", null),
                ], ArrayType(Style.Types.FlexDirection));

                const justifies = $.const([
                    variant("flex-start", null), variant("center", null),
                    variant("space-between", null), variant("space-around", null),
                ], ArrayType(Style.Types.JustifyContent));

                const aligns = $.const([
                    variant("flex-start", null), variant("center", null),
                    variant("flex-end", null), variant("stretch", null),
                ], ArrayType(Style.Types.AlignItems));

                // Content is a data-set axis (the chip-rail precedent): each
                // entry swaps the children AND the canvas height that makes it
                // legible — `centered` brings the 100px canvas the centering
                // demo needs, `nested` puts flex containers inside the flex.
                const contents = $.const([
                    {
                        label: "items", height: "auto",
                        kids: [
                            <Text>Item 1</Text>, <Text>Item 2</Text>, <Text>Item 3</Text>,
                            <Text>Item 4</Text>, <Text>Item 5</Text>, <Text>Item 6</Text>,
                        ],
                    },
                    {
                        label: "centered", height: "100px",
                        kids: [<Text>Centered!</Text>],
                    },
                    {
                        label: "nested", height: "auto",
                        kids: [
                            <Flex direction="column" gap="1" padding="2" background="bg.warning.subtle" borderRadius="sm">
                                <Text>A</Text>
                                <Text>B</Text>
                            </Flex>,
                            <Flex direction="column" gap="1" padding="2" background="bg.warning.subtle" borderRadius="sm">
                                <Text>C</Text>
                                <Text>D</Text>
                            </Flex>,
                        ],
                    },
                ], ArrayType(StructType({ label: StringType, height: StringType, kids: ArrayType(UIComponentType) })));

                const directionBind = $.let(State.bind([StringType], "flex_direction", "row"));
                const justifyBind   = $.let(State.bind([StringType], "flex_justify", "space-between"));
                const alignBind     = $.let(State.bind([StringType], "flex_align", "center"));
                const contentBind   = $.let(State.bind([StringType], "flex_content", "items"));
                const wrapBind      = $.let(State.bind([BooleanType], "flex_wrap", false));
                const counter       = $.let(State.bind([IntegerType], "flex_counter", 0n));

                const dKey  = $.let(directionBind.read());
                const jKey  = $.let(justifyBind.read());
                const aKey  = $.let(alignBind.read());
                const cKey  = $.let(contentBind.read());
                const wrapOn = $.let(wrapBind.read());
                const count = $.let(counter.read());

                const onDirection = $.const(East.function([StringType], NullType, ($, next) => { $(directionBind.write(next)); }));
                const onJustify   = $.const(East.function([StringType], NullType, ($, next) => { $(justifyBind.write(next)); }));
                const onAlign     = $.const(East.function([StringType], NullType, ($, next) => { $(alignBind.write(next)); }));
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
                const content = $.let(contents.filter((_$, o) => o.label.equal(cKey)).get(0n));

                // The folded interactive: direction alternates row / column on
                // each click of the aside button.
                const asideDirection = $.let(count.remainder(2n).equal(0n).ifElse(_$ => variant("row", null), _$ => variant("column", null)));

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
                            <Flex
                                direction={direction}
                                justifyContent={justify}
                                alignItems={align}
                                wrap={wrapOn.ifElse(_$ => variant("wrap", null), _$ => variant("nowrap", null))}
                                gap="3"
                                padding="4"
                                background="bg.subtle"
                                borderRadius="md"
                                width={wrapOn.ifElse(_$ => "200px", _$ => "auto")}
                                height={content.height}
                            >
                                {content.kids}
                            </Flex>
                        }
                        aside={{
                            label: "Direction · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Flex direction={asideDirection} gap="4" padding="4" background="bg.subtle" borderRadius="md">
                                        <Text>A</Text>
                                        <Text>B</Text>
                                        <Text>C</Text>
                                    </Flex>
                                    <Button size="xs" onClick={inc}>Toggle direction</Button>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Width", wrapOn.ifElse(_$ => "200px", _$ => "auto")),
                            Configurator.Spec("Height", content.height),
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

export const flexFillScroll = example({
    keywords: ["Flex", "fill", "scroll", "scrollY", "column", "bounded", "sizing", "height"],
    description: "A column Flex bounded to a fixed height (#320): a non-shrinking toolbar row above a `fill scrollY` body that consumes the remainder and scrolls — the `flex:1 + min-height:0 + overflow` incantation as declarative props",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex direction="column" height="220px" width="260px">
                <Flex background="bg.subtle" padding="3"><Text>Toolbar</Text></Flex>
                <Flex fill scrollY direction="column" gap="2" padding="3">
                    {Array.from({ length: 20 }, (_, i) => <Text>{`Row ${i + 1}`}</Text>)}
                </Flex>
            </Flex>
        );
    }),
    inputs: [],
});
