/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, some, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, Heading, HStack, SegmentGroup, Style, Switch, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const headingBasic = example({
    keywords: ["Heading", "Root", "basic"],
    description: "Simple heading with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Heading>Hello World</Heading>;
    }),
    inputs: [],
});

// ============================================================================
// Heading — live configurator over every style axis
// ============================================================================

export const headingVariants = example({
    keywords: ["Heading", "Root", "textStyle", "heading-xs", "heading-sm", "heading-md", "heading-lg", "display-sm", "display-md", "display-lg", "display-xl", "as", "h1", "h2", "h3", "h4", "semantic", "color", "blue", "green", "purple", "textAlign", "left", "center", "right", "combined", "background", "hero", "coloured-band", "Reactive", "State", "interactive", "counter", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Heading configurator — text-style, level, colour and align axes plus a background-band switch driving one live heading; the aside counts clicks into a reactive heading",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step. The text-style ramp spans the heading scale AND
                // the display scale, so both families sit on one axis.
                const scales = $.const([
                    variant("heading-xs", null), variant("heading-sm", null),
                    variant("heading-md", null), variant("heading-lg", null),
                    variant("display-sm", null), variant("display-md", null),
                    variant("display-lg", null), variant("display-xl", null),
                ], ArrayType(Style.Types.TextStyle));

                const levels = $.const([
                    variant("h1", null), variant("h2", null), variant("h3", null),
                    variant("h4", null), variant("h5", null), variant("h6", null),
                ], ArrayType(Heading.Types.As));

                const aligns = $.const([
                    variant("left", null), variant("center", null), variant("right", null),
                ], ArrayType(Style.Types.TextAlign));

                // Only colour needs a struct — an ink token is too long to name
                // its own segment, so the label rides beside it.
                const inks = $.const([
                    { label: "default", ink: "fg.default" },
                    { label: "link",    ink: "link" },
                    { label: "success", ink: "fg.success" },
                    { label: "purple",  ink: "accent.purple" },
                ], ArrayType(StructType({ label: StringType, ink: StringType })));

                const scaleBind = $.let(State.bind([StringType], "heading_textstyle", "heading-lg"));
                const levelBind = $.let(State.bind([StringType], "heading_level", "h2"));
                const colorBind = $.let(State.bind([StringType], "heading_color", "default"));
                const alignBind = $.let(State.bind([StringType], "heading_align", "left"));
                const bandBind  = $.let(State.bind([BooleanType], "heading_band", false));
                const counter   = $.let(State.bind([IntegerType], "heading_counter", 0n));

                const sKey  = $.let(scaleBind.read());
                const lKey  = $.let(levelBind.read());
                const cKey  = $.let(colorBind.read());
                const aKey  = $.let(alignBind.read());
                const band  = $.let(bandBind.read());
                const count = $.let(counter.read());

                const onScale = $.const(East.function([StringType], NullType, ($, next) => { $(scaleBind.write(next)); }));
                const onLevel = $.const(East.function([StringType], NullType, ($, next) => { $(levelBind.write(next)); }));
                const onColor = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));
                const onAlign = $.const(East.function([StringType], NullType, ($, next) => { $(alignBind.write(next)); }));
                const onBand  = $.const(East.function([BooleanType], NullType, ($, next) => { $(bandBind.write(next)); }));
                const inc     = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const scale = $.let(scales.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const level = $.let(levels.filter((_$, v) => v.getTag().equal(lKey)).get(0n));
                const ink = $.let(inks.filter((_$, o) => o.label.equal(cKey)).get(0n));
                const align = $.let(aligns.filter((_$, v) => v.getTag().equal(aKey)).get(0n));

                // The band is a hero treatment — background and padding move
                // together, so the switch swaps both at once.
                const bg  = $.let(band.ifElse(_$ => "bg.brand.subtle", _$ => "transparent"));
                const pad = $.let(band.ifElse(_$ => "4", _$ => "0"));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Text style", sKey,
                                <SegmentGroup value={sKey} onChange={onScale} size="sm"
                                    items={scales.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />,
                                "heading scale · display scale"),
                            Configurator.Control("Level", lKey,
                                <SegmentGroup value={lKey} onChange={onLevel} size="sm"
                                    items={levels.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />,
                                "semantic element only — the scale sets the size"),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColor} size="sm"
                                    items={inks.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Align", aKey,
                                <SegmentGroup value={aKey} onChange={onAlign} size="sm"
                                    items={aligns.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Band spec row below rather than as one value.
                            Configurator.Slot("Band",
                                <HStack gap="5" align="center">
                                    <Switch checked={band} label="Hero band" onChange={onBand} />
                                    <Text textStyle="caption" color="fg.subtle">coloured background · padded</Text>
                                </HStack>),
                        ]}
                        preview={
                            <Heading
                                as={level}
                                textStyle={scale}
                                color={ink.ink}
                                textAlign={align}
                                background={bg}
                                padding={{ top: some(pad), right: some(pad), bottom: some(pad), left: some(pad) }}
                            >
                                Welcome to East UI
                            </Heading>
                        }
                        aside={{
                            label: "Count · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Heading textStyle="heading-sm">{East.str`Click count: ${East.print(count)}`}</Heading>
                                    <Button size="xs" onClick={inc}>Click me</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Band", band.ifElse(_$ => "bg.brand.subtle · padded", _$ => "off")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
