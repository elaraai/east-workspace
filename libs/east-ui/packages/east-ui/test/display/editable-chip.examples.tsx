/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, EditableChip, SegmentGroup, Style, Switch, Text, HStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const editableChipBasic = example({
    keywords: ["EditableChip", "Root", "label"],
    description: "Basic editable chip with default trigger icon",
    fn: East.function([], UIComponentType, ($) => {
        return <EditableChip><Text>Service level · 85%</Text></EditableChip>;
    }),
    inputs: [],
});

// ============================================================================
// EditableChip — live configurator over every style axis
// ============================================================================

export const editableChipVariants = example({
    keywords: ["EditableChip", "Root", "disabled", "style", "colour", "color", "background", "borderColor", "triggerIconColor", "borderRadius", "density", "condensed", "compact", "comfortable", "sizes", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "interactive", "onClick", "callback"],
    description: "EditableChip configurator — density, radius and colour-slot axes plus a disabled switch driving one live chip; the aside chip's onClick cycles a scenario",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const densities = $.const([
                    variant("condensed", null), variant("compact", null), variant("comfortable", null),
                ], ArrayType(Style.Types.Density));

                // A token axis collapses the same way: a radius is a corner-scale
                // token, so the array is bare tokens. (No `size` axis — the
                // density cascade is declared after `size` in the slot recipe and
                // overrides its padding / font scale outright, so a size control
                // would sit here doing nothing.)
                const radii = $.const(["sm", "md", "lg", "full"], ArrayType(StringType));

                // Only colour needs a struct — the chip paints four slots at once
                // (surface, text, border, trigger icon), with no single value to
                // name it by.
                const colors = $.const([
                    { label: "neutral", bg: "bg.subtle",         fg: "fg.default", border: "border.subtle", icon: "fg.subtle" },
                    { label: "brand",   bg: "bg.brand.subtle",   fg: "link",       border: "border.brand",  icon: "link" },
                    { label: "warn",    bg: "bg.warning.subtle", fg: "fg.warning", border: "border.strong", icon: "fg.warning" },
                    { label: "dark",    bg: "bg.inverse",        fg: "fg.inverse", border: "border.strong", icon: "fg.inverse" },
                ], ArrayType(StructType({ label: StringType, bg: StringType, fg: StringType, border: StringType, icon: StringType })));

                const densityBind  = $.let(State.bind([StringType], "chip_density", "compact"));
                const radiusBind   = $.let(State.bind([StringType], "chip_radius", "md"));
                const colorBind    = $.let(State.bind([StringType], "chip_color", "brand"));
                const disabledBind = $.let(State.bind([BooleanType], "chip_disabled", false));
                // The aside chip is the reactive row — its onClick cycles a
                // scenario through State (the old reactive panel's key).
                const scenarioBind = $.let(State.bind([IntegerType], "scenarioIndex", 0n));

                const dKey = $.let(densityBind.read());
                const rKey = $.let(radiusBind.read());
                const cKey = $.let(colorBind.read());
                const disabled = $.let(disabledBind.read());
                const scenarioIndex = $.let(scenarioBind.read());

                const scenarios = $.let(["Baseline", "Optimistic", "Stress"]);
                const currentLabel = $.let(scenarios.get(scenarioIndex.remainder(3n)));

                const onDensity  = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onRadius   = $.const(East.function([StringType], NullType, ($, next) => { $(radiusBind.write(next)); }));
                const onColor    = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));
                const onDisabled = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
                const cycle      = $.const(East.function([], NullType, $ => {
                    const current = $.let(scenarioBind.read());
                    $(scenarioBind.write(current.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
                const radius = $.let(radii.filter((_$, s) => s.equal(rKey)).get(0n));
                const color = $.let(colors.filter((_$, o) => o.label.equal(cKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Density", dKey,
                                <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Radius", rKey,
                                <SegmentGroup value={rKey} onChange={onRadius} size="sm"
                                    items={radii.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColor} size="sm"
                                    items={colors.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("State", disabled.ifElse(_$ => "disabled", _$ => "enabled"),
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={disabled} label="Disabled" onChange={onDisabled} />
                                </HStack>),
                        ]}
                        preview={
                            <EditableChip
                                disabled={disabled}
                                density={density}
                                borderRadius={radius}
                                background={color.bg}
                                color={color.fg}
                                borderColor={color.border}
                                triggerIconColor={color.icon}
                            >
                                <Text>{disabled.ifElse(_$ => "Locked assumption", _$ => "Demand mix · balanced")}</Text>
                            </EditableChip>
                        }
                        aside={{
                            label: "Row alignment · Reactive",
                            body: (
                                <HStack gap="2" align="center">
                                    <EditableChip density={density} onClick={cycle}><Text>{currentLabel}</Text></EditableChip>
                                    <EditableChip density={density}><Text>Horizon · 12 weeks</Text></EditableChip>
                                </HStack>
                            ),
                        }}
                        spec={[
                            // The colour struct is one control but four slots — break
                            // it back out so the readout names what actually painted.
                            Configurator.Spec("Background", color.bg),
                            Configurator.Spec("Foreground", color.fg),
                            Configurator.Spec("Border colour", color.border),
                            Configurator.Spec("Trigger icon", color.icon),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

