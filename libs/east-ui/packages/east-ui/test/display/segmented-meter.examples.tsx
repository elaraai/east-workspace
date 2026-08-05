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
            const labelModes = $.const(["inside", "outside"], ArrayType(StringType));
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));

            const labelsBind = $.let(State.bind([StringType], "segmeter_labels", "inside"));
            const densityBind = $.let(State.bind([StringType], "segmeter_density", "compact"));
            const residualBind = $.let(State.bind([BooleanType], "segmeter_residual", false));

            const lKey = $.let(labelsBind.read());
            const dKey = $.let(densityBind.read());
            const residualOn = $.let(residualBind.read());

            const onLabels = $.const(East.function([StringType], NullType, ($, next) => { $(labelsBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onResidual = $.const(East.function([BooleanType], NullType, ($, next) => { $(residualBind.write(next)); }));

            const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));

            // Labels placement, max and trackColor are presence-typed, so the
            // switches pick between prebuilt meters; density stays live.
            const preview = $.const(residualOn.ifElse(
                _$ => (
                    <SegmentedMeter
                        segments={[
                            { value: 30, color: "link", label: "Complete" },
                            { value: 10, color: "fg.warning", label: "In progress" },
                        ]}
                        max={100}
                        trackColor="bg.subtle"
                        density={density}
                    />
                ),
                _$ => lKey.equal("outside").ifElse(
                    _$ => (
                        <SegmentedMeter
                            segments={[
                                { value: 70, tone: "info", label: "Assigned" },
                                { value: 30, tone: "neutral", label: "Unassigned" },
                            ]}
                            thickness="md"
                            labels="outside"
                            caption={<Text>Crew mix</Text>}
                            density={density}
                        />
                    ),
                    _$ => (
                        <SegmentedMeter
                            segments={[
                                { value: 40, tone: "success", label: "Fresh" },
                                { value: 35, tone: "warning", label: "Stale" },
                                { value: 25, tone: "danger", label: "Broken" },
                            ]}
                            density={density}
                        />
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Labels", lKey,
                            <SegmentGroup value={lKey} onChange={onLabels} size="sm"
                                items={labelModes.map((_$, o) => SegmentGroup.Item(o, <Text>{o.upperCase()}</Text>))} />),
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Slot("Track",
                            <HStack gap="5" align="center">
                                <Switch checked={residualOn} label="Residual (sum < max)" onChange={onResidual} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Segments", residualOn.ifElse(_$ => "2 · 40 empty", _$ => lKey.equal("outside").ifElse(_$ => "2", _$ => "3"))),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
