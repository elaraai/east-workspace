/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Reactive, SegmentGroup, SegmentedMeter, Switch, Text } from "@elaraai/east-ui";

export const segmentedMeterBasic = example({
    keywords: ["SegmentedMeter", "Root", "segments"],
    description: "Three-segment meter with tones",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <SegmentedMeter segments={[
                { value: 40, tone: "success", label: "Fresh" },
                { value: 35, tone: "warning", label: "Stale" },
                { value: 25, tone: "danger", label: "Broken" },
            ]} />
        );
    }),
    inputs: [],
});

export const segmentedMeterVariants = example({
    keywords: ["SegmentedMeter", "Root", "labels", "outside", "thickness", "density", "condensed", "compact", "comfortable", "max", "residual", "trackColor", "caption", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "SegmentedMeter configurator — labels, thickness and density axes plus a residual-track switch on one live meter",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const labelModes = $.const([
                variant("inside", null), variant("outside", null),
            ], ArrayType(SegmentedMeter.Types.Labels));
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));

            const labelsBind = $.let(State.bind([StringType], "segmeter_labels", "inside"));
            const densityBind = $.let(State.bind([StringType], "segmeter_density", "compact"));

            const lKey = $.let(labelsBind.read());
            const dKey = $.let(densityBind.read());

            const onLabels = $.const(East.function([StringType], NullType, ($, next) => { $(labelsBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));

            const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));

            // ONE meter — labels placement feeds as an expression and the
            // caption composes on; the residual track (max + trackColor) lives
            // in its own example.
            const labelsSel = $.let(labelModes.filter((_$, v) => v.getTag().equal(lKey)).get(0n));
            const preview = $.const(
                <SegmentedMeter
                    segments={[
                        { value: 70, tone: "info", label: "Assigned" },
                        { value: 30, tone: "neutral", label: "Unassigned" },
                    ]}
                    thickness="md"
                    labels={labelsSel}
                    caption={<Text>Crew mix</Text>}
                    density={density}
                />,
            );

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Labels", lKey,
                            <SegmentGroup value={lKey} onChange={onLabels} size="sm"
                                items={labelModes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Segments", "2"),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** Residual track — segments summing under max leave the tinted remainder visible. */
export const segmentedMeterResidual = example({
    keywords: ["SegmentedMeter", "max", "trackColor", "residual", "remainder"],
    description: "Residual track — 40 of 100 filled; the track colour shows the remainder",
    fn: East.function([], UIComponentType, (_$) => (
        <SegmentedMeter
            segments={[
                { value: 30, color: "link", label: "Complete" },
                { value: 10, color: "fg.warning", label: "In progress" },
            ]}
            max={100}
            trackColor="bg.subtle"
        />
    )),
    inputs: [],
});
