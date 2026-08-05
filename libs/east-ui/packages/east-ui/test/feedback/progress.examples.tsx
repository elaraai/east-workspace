/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Progress, SegmentGroup, Select, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

// Progress does not export its tone enum standalone — pull it out of the
// component's own style contract so the axis stays typed by exactly the
// tags the prop accepts (brand / pos / neg).
const ProgressToneType = Progress.Types.Style.fields.tone.cases.some;

// Fixed start timestamp for the ETA preset (estimatedDuration + startedAt).
const PROGRESS_ETA_STARTED_AT = new Date("2026-01-01T09:00:00Z");

export const progressBasic = example({
    keywords: ["Progress", "Root", "basic"],
    description: "Simple progress bar",
    fn: East.function([], UIComponentType, (_$) => {
        return <Progress value={60.0} />;
    }),
    inputs: [],
});

// ============================================================================
// Progress — live configurator over every bar axis
// ============================================================================

export const progressVariants = example({
    keywords: ["Progress", "Root", "label", "valueText", "tone", "brand", "pos", "neg", "size", "xs", "sm", "md", "striped", "animated", "min", "max", "indeterminate", "estimatedDuration", "startedAt", "ETA", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Progress configurator — tone, size and value-preset axes plus striped / animated and label switches driving one live bar; the aside stacks the three tones",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const tones = $.const([
                    variant("brand", null), variant("pos", null), variant("neg", null),
                ], ArrayType(ProgressToneType));

                const sizes = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null),
                ], ArrayType(Style.Types.Size));

                // A value preset swaps the whole reading — value, range, mode
                // and the caption that goes with it — so the axis is a struct.
                const presets = $.const([
                    { label: "percent",       value: 75.0, min: 0.0, max: 100.0, indeterminate: false, eta: false, labelText: "Upload progress",   valueText: "75%" },
                    { label: "range",         value: 7.5,  min: 0.0, max: 10.0,  indeterminate: false, eta: false, labelText: "Rating 7.5 / 10",   valueText: "" },
                    { label: "indeterminate", value: 0.0,  min: 0.0, max: 100.0, indeterminate: true,  eta: false, labelText: "Solver running…",   valueText: "" },
                    { label: "eta",           value: 42.0, min: 0.0, max: 100.0, indeterminate: false, eta: true,  labelText: "Solver running 42%", valueText: "" },
                ], ArrayType(StructType({ label: StringType, value: FloatType, min: FloatType, max: FloatType, indeterminate: BooleanType, eta: BooleanType, labelText: StringType, valueText: StringType })));

                const toneBind     = $.let(State.bind([StringType], "progress_tone", "brand"));
                const sizeBind     = $.let(State.bind([StringType], "progress_size", "md"));
                const valueBind    = $.let(State.bind([StringType], "progress_value", "percent"));
                const stripedBind  = $.let(State.bind([BooleanType], "progress_striped", false));
                const animatedBind = $.let(State.bind([BooleanType], "progress_animated", false));
                const labelBind    = $.let(State.bind([BooleanType], "progress_label", true));

                const tKey     = $.let(toneBind.read());
                const sKey     = $.let(sizeBind.read());
                const vKey     = $.let(valueBind.read());
                const striped  = $.let(stripedBind.read());
                const animated = $.let(animatedBind.read());
                const labelOn  = $.let(labelBind.read());

                const onTone     = $.const(East.function([StringType], NullType, ($, next) => { $(toneBind.write(next)); }));
                const onSize     = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onValue    = $.const(East.function([StringType], NullType, ($, next) => { $(valueBind.write(next)); }));
                const onStriped  = $.const(East.function([BooleanType], NullType, ($, next) => { $(stripedBind.write(next)); }));
                const onAnimated = $.const(East.function([BooleanType], NullType, ($, next) => { $(animatedBind.write(next)); }));
                const onLabel    = $.const(East.function([BooleanType], NullType, ($, next) => { $(labelBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const tone = $.let(tones.filter((_$, v) => v.getTag().equal(tKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const preset = $.let(presets.filter((_$, o) => o.label.equal(vKey)).get(0n));

                const labelText = $.let(labelOn.ifElse(_$ => preset.labelText, _$ => ""));
                const valueText = $.let(labelOn.ifElse(_$ => preset.valueText, _$ => ""));
                const labelSpec = $.let(labelOn.ifElse(_$ => "label + valueText", _$ => "hidden"));

                // ETA is the presence of estimatedDuration + startedAt, not a
                // value of either — so the preset picks between the two bars
                // rather than feeding empty timing fields.
                const bar = $.const(preset.eta.ifElse(
                    _$ => (
                        <Progress
                            value={preset.value} min={preset.min} max={preset.max}
                            label={labelText} valueText={valueText}
                            tone={tone} size={size} striped={striped} animated={animated}
                            estimatedDuration={120n} startedAt={PROGRESS_ETA_STARTED_AT} showValue={true}
                        />
                    ),
                    _$ => (
                        <Progress
                            value={preset.value} min={preset.min} max={preset.max}
                            indeterminate={preset.indeterminate}
                            label={labelText} valueText={valueText}
                            tone={tone} size={size} striped={striped} animated={animated}
                        />
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Tone", tKey,
                                <SegmentGroup value={tKey} onChange={onTone} size="sm"
                                    items={tones.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Value", vKey,
                                <Select value={vKey} onChange={onValue} size="sm"
                                    items={presets.map((_$, o) => Select.Item(o.label, o.label))} />),
                            // A Slot, not a Control: the two switches report as the
                            // Striped / Animated spec rows below rather than as one
                            // value.
                            Configurator.Slot("Stripes",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={striped} label="Striped" onChange={onStriped} />
                                    <Switch checked={animated} label="Animated" onChange={onAnimated} />
                                </HStack>),
                            Configurator.Control("Label", labelSpec,
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={labelOn} label="Label" onChange={onLabel} />
                                </HStack>),
                        ]}
                        preview={bar}
                        aside={{
                            label: "Tone ladder",
                            body: (
                                <VStack gap="4" align="stretch">
                                    {tones.map((_$, t) => <Progress value={65.0} tone={t} size={size} />)}
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Range", East.str`${East.print(preset.min)}–${East.print(preset.max)}`),
                            Configurator.Spec("Mode", preset.eta.ifElse(_$ => "eta", _$ => preset.indeterminate.ifElse(_$ => "indeterminate", _$ => "determinate"))),
                            Configurator.Spec("Striped", striped.ifElse(_$ => animated.ifElse(_$ => "animated", _$ => "static"), _$ => "off")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
