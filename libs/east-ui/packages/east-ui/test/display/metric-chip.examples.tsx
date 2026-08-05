/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, MetricChip, SegmentGroup, Select, Style, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const metricChipBasic = example({
    keywords: ["MetricChip", "Root", "tone", "positive", "delta", "basic"],
    description: "Positive metric chip with subtle emphasis",
    fn: East.function([], UIComponentType, ($) => {
        return <MetricChip tone="positive" emphasis="subtle"><Text>+12.5%</Text></MetricChip>;
    }),
    inputs: [],
});

// ============================================================================
// MetricChip — live configurator over every chip axis
// ============================================================================

export const metricChipVariants = example({
    keywords: ["MetricChip", "Root", "tone", "positive", "negative", "neutral", "info", "emphasis", "subtle", "solid", "outline", "density", "condensed", "compact", "comfortable", "size", "sizes", "xs", "sm", "md", "lg", "unit", "background", "color", "borderColor", "escape", "custom", "delta", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator", "interactive"],
    description: "MetricChip configurator — tone, emphasis, density, size, unit and colour-slot axes driving one live chip; the aside nudges a reading that re-classifies its own tone",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const tones = $.const([
                    variant("positive", null), variant("negative", null),
                    variant("neutral", null), variant("info", null),
                ], ArrayType(MetricChip.Types.Tone));

                const emphases = $.const([
                    variant("subtle", null), variant("solid", null), variant("outline", null),
                ], ArrayType(MetricChip.Types.Emphasis));

                const densities = $.const([
                    variant("condensed", null), variant("compact", null), variant("comfortable", null),
                ], ArrayType(Style.Types.Density));

                const sizes = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                // A token axis collapses the same way: a unit is just the suffix
                // string, with "none" standing in for no suffix at all.
                const units = $.const(["none", "%", "ms", "pts"], ArrayType(StringType));

                // Only the colour slots need a struct — background / text / border
                // move together as one escape-hatch triple, with no single value to
                // name them by. The `recipe` row carries empty slots because the
                // preview drops the overrides entirely for it (below).
                const colors = $.const([
                    { label: "recipe",  bg: "",                  fg: "",           border: "" },
                    { label: "brand",   bg: "bg.brand.subtle",   fg: "link",       border: "border.brand" },
                    { label: "warn",    bg: "bg.warning.subtle", fg: "fg.warning", border: "fg.warning" },
                    { label: "inverse", bg: "bg.inverse",        fg: "fg.inverse", border: "bg.inverse" },
                ], ArrayType(StructType({ label: StringType, bg: StringType, fg: StringType, border: StringType })));

                const toneBind     = $.let(State.bind([StringType], "metric_chip_tone", "positive"));
                const emphasisBind = $.let(State.bind([StringType], "metric_chip_emphasis", "subtle"));
                const densityBind  = $.let(State.bind([StringType], "metric_chip_density", "compact"));
                const sizeBind     = $.let(State.bind([StringType], "metric_chip_size", "sm"));
                const unitBind     = $.let(State.bind([StringType], "metric_chip_unit", "%"));
                const colorBind    = $.let(State.bind([StringType], "metric_chip_color", "recipe"));
                const readingBind  = $.let(State.bind([IntegerType], "metric_chip_reading", 12n));

                const tKey = $.let(toneBind.read());
                const eKey = $.let(emphasisBind.read());
                const dKey = $.let(densityBind.read());
                const sKey = $.let(sizeBind.read());
                const uKey = $.let(unitBind.read());
                const cKey = $.let(colorBind.read());
                const reading = $.let(readingBind.read());

                const onTone     = $.const(East.function([StringType], NullType, ($, next) => { $(toneBind.write(next)); }));
                const onEmphasis = $.const(East.function([StringType], NullType, ($, next) => { $(emphasisBind.write(next)); }));
                const onDensity  = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onSize     = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onUnit     = $.const(East.function([StringType], NullType, ($, next) => { $(unitBind.write(next)); }));
                const onColor    = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));
                const up         = $.const(East.function([], NullType, $ => {
                    const cur = $.let(readingBind.read());
                    $(readingBind.write(cur.add(5n)));
                }));
                const down       = $.const(East.function([], NullType, $ => {
                    const cur = $.let(readingBind.read());
                    $(readingBind.write(cur.subtract(5n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const tone = $.let(tones.filter((_$, v) => v.getTag().equal(tKey)).get(0n));
                const emphasis = $.let(emphases.filter((_$, v) => v.getTag().equal(eKey)).get(0n));
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const unitToken = $.let(units.filter((_$, s) => s.equal(uKey)).get(0n));
                const color = $.let(colors.filter((_$, o) => o.label.equal(cKey)).get(0n));

                // "none" is the no-suffix row, so it maps back to an empty unit.
                const unit = $.let(unitToken.equal("none").ifElse(_$ => "", _$ => unitToken));
                // A delta chip reads with its sign, so positives print an explicit +.
                const readingText = $.let(reading.greater(0n).ifElse(
                    _$ => East.str`+${East.print(reading)}`,
                    _$ => East.print(reading),
                ));
                // The aside chip classifies itself: the sign of the reading picks the
                // tone out of the same array the Tone control renders.
                const signKey = $.let(reading.greater(0n).ifElse(
                    _$ => "positive",
                    _$ => reading.less(0n).ifElse(_$ => "negative", _$ => "neutral"),
                ));
                const signTone = $.let(tones.filter((_$, v) => v.getTag().equal(signKey)).get(0n));

                // The colour slots are escape hatches ON TOP of the tone recipe — an
                // override the renderer honours as soon as it is present. So `recipe`
                // is the absence of the props, not an empty value of them, and the
                // preview picks between the two chips.
                const chip = $.const(cKey.equal("recipe").ifElse(
                    _$ => (
                        <MetricChip tone={tone} emphasis={emphasis} density={density} size={size} unit={unit}>
                            <Text>{readingText}</Text>
                        </MetricChip>
                    ),
                    _$ => (
                        <MetricChip tone={tone} emphasis={emphasis} density={density} size={size} unit={unit}
                            background={color.bg} color={color.fg} borderColor={color.border}>
                            <Text>{readingText}</Text>
                        </MetricChip>
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Tone", tKey,
                                <Select value={tKey} onChange={onTone} size="sm"
                                    items={tones.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Emphasis", eKey,
                                <SegmentGroup value={eKey} onChange={onEmphasis} size="sm"
                                    items={emphases.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Density", dKey,
                                <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <Select value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            Configurator.Control("Unit", uKey,
                                <Select value={uKey} onChange={onUnit} size="sm"
                                    items={units.map((_$, s) => Select.Item(s, s))} />),
                            Configurator.Control("Colour", cKey,
                                <Select value={cKey} onChange={onColor} size="sm"
                                    items={colors.map((_$, o) => Select.Item(o.label, o.label))} />),
                        ]}
                        preview={chip}
                        aside={{
                            label: "Reading · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Button size="xs" onClick={down}>-5</Button>
                                    <MetricChip tone={signTone} emphasis={emphasis} density={density} unit={unit}>
                                        <Text>{readingText}</Text>
                                    </MetricChip>
                                    <Button size="xs" onClick={up}>+5</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Value", readingText),
                            Configurator.Spec("Slots", cKey.equal("recipe").ifElse(
                                _$ => "tone recipe",
                                _$ => East.str`${color.bg} · ${color.fg} · ${color.border}`,
                            )),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
