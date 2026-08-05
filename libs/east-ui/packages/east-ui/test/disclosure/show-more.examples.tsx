/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Disclosure, HStack, Reactive, SegmentGroup, Switch, Text } from "@elaraai/east-ui";

export const disclosureRationale = example({
    keywords: ["Disclosure", "Root", "show more", "truncate", "rationale"],
    description: "Action-card rationale clamped to 3 lines with a show-more toggle",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Disclosure lines={3n}>
                {"Stage 1 was delayed ~6h due to setpoint drift since 02:00. Redirecting feedstock to Stage 2 reduces unmet demand at the cost of 1.2% yield. Our model scored this option 0.83 on confidence based on historical recovery patterns from the last 12 months of similar upsets; prior comparable recoveries averaged 5.8h with a standard deviation of 1.2h."}
            </Disclosure>
        );
    }),
    inputs: [],
});

export const disclosureVariants = example({
    keywords: ["Disclosure", "Root", "show more", "truncate", "narrative", "lines", "moreLabel", "lessLabel", "color", "triggerColor", "branded", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "configurator"],
    description: "Disclosure configurator — a content preset axis (rationale / narrative) plus a branded-colours switch",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presets = $.const(["rationale", "narrative"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "disclosure_preset", "rationale"));
            const brandedBind = $.let(State.bind([BooleanType], "disclosure_branded", false));

            const pKey = $.let(presetBind.read());
            const brandedOn = $.let(brandedBind.read());

            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onBranded = $.const(East.function([BooleanType], NullType, ($, next) => { $(brandedBind.write(next)); }));

            // lines / labels / colour hatches are presence-typed, so the axes
            // pick between prebuilt disclosures.
            const preview = $.const(pKey.equal("narrative").ifElse(
                _$ => (
                    <Disclosure lines={2n} moreLabel="Read full narrative" lessLabel="Collapse narrative">
                        <Text color="fg.muted">{"Service level slipped from 92% to 85% this week. Root cause: Stage 2 blender #3 downtime 07:00–11:30 on Wednesday, compounded by a 2-hour delay in Stage 1 feed due to a sensor drift on loop LIC-107. Mitigation: swapped to backup blender #5 at 11:45; tuned LIC-107 controller; both are now stable. Residual risk: backup blender runs at 85% capacity until spares arrive Friday."}</Text>
                    </Disclosure>
                ),
                _$ => brandedOn.ifElse(
                    _$ => (
                        <Disclosure lines={2n} color="fg.default" triggerColor="link">
                            {"Branded narrative text that clamps to the configured number of lines and reveals the full content on demand. Useful when the theme's default link colour doesn't fit."}
                        </Disclosure>
                    ),
                    _$ => (
                        <Disclosure lines={3n}>
                            {"Stage 1 was delayed ~6h due to setpoint drift since 02:00. Redirecting feedstock to Stage 2 reduces unmet demand at the cost of 1.2% yield. Our model scored this option 0.83 on confidence based on historical recovery patterns from the last 12 months of similar upsets; prior comparable recoveries averaged 5.8h with a standard deviation of 1.2h."}
                        </Disclosure>
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Content", pKey,
                            <SegmentGroup value={pKey} onChange={onPreset} size="sm"
                                items={presets.map((_$, o) => SegmentGroup.Item(o, <Text>{o.upperCase()}</Text>))} />),
                        Configurator.Slot("Colours",
                            <HStack gap="5" align="center">
                                <Switch checked={brandedOn} label="Branded (rationale)" onChange={onBranded} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Lines", pKey.equal("narrative").ifElse(_$ => "2", _$ => brandedOn.ifElse(_$ => "2", _$ => "3"))),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const disclosureDefault = example({
    keywords: ["Disclosure", "Root", "default"],
    description: "Default Disclosure — 3 lines + 'show more' / 'show less'",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Disclosure>
                {"Short enough to stay on one or two lines most of the time, but long enough to demonstrate the show-more toggle when the container is narrow — this paragraph adapts to the surrounding layout."}
            </Disclosure>
        );
    }),
    inputs: [],
});

