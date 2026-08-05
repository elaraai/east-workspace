/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, Meter, Input, SegmentGroup, Select, Slider, Style, Switch, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const meterBasic = example({
    keywords: ["Meter", "Root", "value"],
    description: "Basic meter at 60% with default styling",
    fn: East.function([], UIComponentType, ($) => {
        return <Meter value={60.0} />;
    }),
    inputs: [],
});

// ============================================================================
// Meter — live configurator over every meter axis
// ============================================================================

export const meterVariants = example({
    keywords: ["Meter", "Root", "tone", "success", "warning", "danger", "info", "neutral", "thickness", "density", "condensed", "compact", "comfortable", "sizes", "max", "custom", "value", "label", "fillColor", "trackColor", "labelColor", "showValue", "Reactive", "State", "SegmentGroup", "Switch", "Button", "Configurator", "getTag", "configurator", "interactive"],
    description: "Meter configurator — tone, density, thickness, colour and label axes with reading and max dials plus a show-percent switch driving one live meter; the aside drives a reactive load",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const tones = $.const([
                    variant("success", null), variant("warning", null), variant("danger", null),
                    variant("info", null), variant("neutral", null),
                ], ArrayType(Style.Types.StatusToken));

                const densities = $.const([
                    variant("condensed", null), variant("compact", null), variant("comfortable", null),
                ], ArrayType(Style.Types.Density));

                const thicknesses = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Meter.Types.Thickness));

                // Numeric / token axes collapse the same way: the reading is a
                // percentage, the scale is the `max` the meter divides by, and a
                // caption is just a string.
                const captions = $.const(["Uptime", "Service level", "Capacity"], ArrayType(StringType));

                const toneBind      = $.let(State.bind([StringType], "meter_tone", "success"));
                const densityBind   = $.let(State.bind([StringType], "meter_density", "compact"));
                const thicknessBind = $.let(State.bind([StringType], "meter_thickness", "md"));
                const readingBind   = $.let(State.bind([FloatType], "meter_reading", 85.0));
                const maxBind       = $.let(State.bind([IntegerType], "meter_max", 100n));
                const captionBind   = $.let(State.bind([StringType], "meter_caption", "Uptime"));
                const colorBind     = $.let(State.bind([StringType], "meter_color", "tone"));
                const percentBind   = $.let(State.bind([BooleanType], "meter_percent", true));
                const loadBind      = $.let(State.bind([IntegerType], "meter_load", 40n));

                const toneKey      = $.let(toneBind.read());
                const densityKey   = $.let(densityBind.read());
                const thicknessKey = $.let(thicknessBind.read());
                const pct          = $.let(readingBind.read());
                const maxN         = $.let(maxBind.read());
                const captionKey   = $.let(captionBind.read());
                const colorKey     = $.let(colorBind.read());
                const showPercent  = $.let(percentBind.read());
                const load         = $.let(loadBind.read());

                const onTone      = $.const(East.function([StringType], NullType, ($, next) => { $(toneBind.write(next)); }));
                const onDensity   = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onThickness = $.const(East.function([StringType], NullType, ($, next) => { $(thicknessBind.write(next)); }));
                const onReading   = $.const(East.function([FloatType], NullType, ($, next) => { $(readingBind.write(next)); }));
                const onMax       = $.const(East.function([IntegerType], NullType, ($, next) => { $(maxBind.write(next)); }));
                const onCaption   = $.const(East.function([StringType], NullType, ($, next) => { $(captionBind.write(next)); }));
                const onColor     = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));
                const onPercent   = $.const(East.function([BooleanType], NullType, ($, next) => { $(percentBind.write(next)); }));
                const drain       = $.const(East.function([], NullType, $ => {
                    const current = $.let(loadBind.read());
                    const next = $.let(current.subtract(10n));
                    $(loadBind.write(next.lessThan(0n).ifElse(_$ => 0n, _$ => next)));
                }));
                const raise       = $.const(East.function([], NullType, $ => {
                    const current = $.let(loadBind.read());
                    const next = $.let(current.add(10n));
                    $(loadBind.write(next.greaterThan(100n).ifElse(_$ => 100n, _$ => next)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const tone = $.let(tones.filter((_$, t) => t.getTag().equal(toneKey)).get(0n));
                const density = $.let(densities.filter((_$, d) => d.getTag().equal(densityKey)).get(0n));
                const thickness = $.let(thicknesses.filter((_$, t) => t.getTag().equal(thicknessKey)).get(0n));
                const caption = $.let(captions.filter((_$, c) => c.equal(captionKey)).get(0n));

                // The recipe paints a toned fill from `fg.<tag>` (neutral reads
                // `fg.muted`), so the "tone" colour entry can restate the default
                // instead of overriding it — that keeps the tone axis live while
                // the other entries demonstrate the explicit slots.
                const toneFill = $.let(tone.hasTag("neutral").ifElse(_$ => "fg.muted", _$ => East.str`fg.${tone.getTag()}`));

                // Only colour needs a struct — it is a fill / track / label-colour
                // triple, with no single value to name it by.
                const colors = $.const([
                    { label: "tone",     fill: toneFill,        track: "bg.subtle", text: "fg.default" },
                    { label: "purple",   fill: "accent.purple", track: "bg.subtle", text: "accent.purple" },
                    { label: "inverse",  fill: "fg.inverse",    track: "bg.inverse", text: "fg.default" },
                    { label: "gradient", fill: "linear-gradient(90deg, {colors.brand.500} 0%, {colors.brand.700} 100%)", track: "bg.subtle", text: "fg.default" },
                ], ArrayType(StructType({ label: StringType, fill: StringType, track: StringType, text: StringType })));
                const color = $.let(colors.filter((_$, o) => o.label.equal(colorKey)).get(0n));

                // The meter fills by value / max, so the reading is the dialled
                // percentage OF the dialled scale — 70% of a custom 500 is 350.
                const reading = $.let(pct.divide(100.0).multiply(maxN.toFloat()));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Tone", toneKey,
                                <Select value={toneKey} onChange={onTone} size="sm"
                                    items={tones.map((_$, t) => Select.Item(t.getTag(), t.getTag()))} />),
                            Configurator.Control("Density", densityKey,
                                <SegmentGroup value={densityKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, d) => SegmentGroup.Item(d.getTag(), <Text>{d.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Thickness", thicknessKey,
                                <Select value={thicknessKey} onChange={onThickness} size="sm"
                                    items={thicknesses.map((_$, t) => Select.Item(t.getTag(), t.getTag()))} />),
                            Configurator.Control("Reading", East.str`${East.print(pct.toInteger())}%`,
                                <Slider value={pct} min={0.0} max={100.0} step={1.0} size="sm" onChange={onReading} />),
                            Configurator.Control("Max", East.print(maxN),
                                <Input.Integer value={maxN} min={50n} max={1000n} step={50n} size="sm" onChange={onMax} />),
                            Configurator.Control("Colour", colorKey,
                                <Select value={colorKey} onChange={onColor} size="sm"
                                    items={colors.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Label", captionKey,
                                <SegmentGroup value={captionKey} onChange={onCaption} size="sm"
                                    items={captions.map((_$, c) => SegmentGroup.Item(c, <Text>{c.upperCase()}</Text>))} />),
                            Configurator.Control("Percent", showPercent.ifElse(_$ => "shown", _$ => "hidden"),
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={showPercent} label="Show percent" onChange={onPercent} />
                                </HStack>),
                        ]}
                        preview={
                            <Meter
                                value={reading}
                                max={maxN.toFloat()}
                                tone={tone}
                                density={density}
                                thickness={thickness}
                                label={<Text>{caption}</Text>}
                                fillColor={color.fill}
                                trackColor={color.track}
                                labelColor={color.text}
                                showValue={showPercent}
                            />
                        }
                        aside={{
                            label: "Load · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Button size="xs" onClick={drain}>-10</Button>
                                    <Button size="xs" onClick={raise}>+10</Button>
                                    <Meter value={load.toFloat()} tone={tone} density={density} label={<Text>Load</Text>} />
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Reads", East.str`${East.print(reading.toInteger())} / ${East.print(maxN)}`),
                            Configurator.Spec("Fill", color.fill),
                            Configurator.Spec("Track", color.track),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
