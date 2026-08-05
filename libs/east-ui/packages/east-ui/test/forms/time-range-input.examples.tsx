/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, SegmentGroup, Style, Switch, Text, TimeRangeInput, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — presets are a host-level array (not an East
// expression), so the three shifts live here once.
// ============================================================================

const TIME_RANGE_PRESETS = [
    { label: "Morning", start: 360n, end: 840n },
    { label: "Afternoon", start: 840n, end: 1320n },
    { label: "Night", start: 1320n, end: 360n },
];

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const timeRangeInputBasic = example({
    keywords: ["TimeRangeInput", "Root", "shift", "time", "range"],
    description: "Basic 06:00 – 14:00 morning window with 15-min step",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        return <TimeRangeInput startValue={start} endValue={end} step={15n} />;
    }),
    inputs: [],
});

// ============================================================================
// TimeRangeInput — live configurator over every range axis
// ============================================================================

export const timeRangeInputVariants = example({
    keywords: ["TimeRangeInput", "presets", "shift", "morning", "afternoon", "night", "colour", "color", "escape", "hatches", "size", "sm", "md", "lg", "disabled", "readonly", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State", "onChange", "interactive"],
    description: "TimeRangeInput configurator — size and colour axes plus disabled and presets switches driving one live State-bound shift window; the aside reads the minutes back",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const sizes = $.const([
                    variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                // Only colour needs a struct — the four escape-hatch slots move
                // together, with no single value to name them by. The `recipe`
                // row carries empty slots because the preview drops the
                // overrides entirely for it (below).
                const colours = $.const([
                    { label: "recipe",  color: "",           background: "",          borderColor: "",             focusBorder: "" },
                    { label: "branded", color: "fg.default", background: "bg.subtle", borderColor: "border.brand", focusBorder: "border.brand" },
                ], ArrayType(StructType({ label: StringType, color: StringType, background: StringType, borderColor: StringType, focusBorder: StringType })));

                const sizeBind     = $.let(State.bind([StringType], "time_range_input_size", "md"));
                const colourBind   = $.let(State.bind([StringType], "time_range_input_color", "recipe"));
                const disabledBind = $.let(State.bind([BooleanType], "time_range_input_disabled", false));
                const presetsBind  = $.let(State.bind([BooleanType], "time_range_input_presets", false));

                // The preview is a live control, so the window keeps its own
                // State-bound start / end pair — the old reactive row's binds.
                const startBind = $.let(State.bind([IntegerType], "time_range_input_start", 360n));
                const endBind   = $.let(State.bind([IntegerType], "time_range_input_end", 840n));

                const sKey      = $.let(sizeBind.read());
                const cKey      = $.let(colourBind.read());
                const disabled  = $.let(disabledBind.read());
                const presetsOn = $.let(presetsBind.read());
                const start     = $.let(startBind.read(), IntegerType);
                const end       = $.let(endBind.read(), IntegerType);

                const onSize     = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onColour   = $.const(East.function([StringType], NullType, ($, next) => { $(colourBind.write(next)); }));
                const onDisabled = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
                const onPresets  = $.const(East.function([BooleanType], NullType, ($, next) => { $(presetsBind.write(next)); }));
                const onChange   = $.const(East.function([IntegerType, IntegerType], NullType, ($, s, e) => {
                    $(startBind.write(s));
                    $(endBind.write(e));
                }));

                // Each selection is a lookup into the same array the control renders.
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const colour = $.let(colours.filter((_$, o) => o.label.equal(cKey)).get(0n));

                // The colour slots and the preset rail are escape hatches the
                // factory omits from the IR entirely when absent — presence IS
                // the demo — so the preview picks between four windows (slots ×
                // presets) rather than feeding empty values.
                const window = $.const(cKey.equal("recipe").ifElse(
                    _$ => presetsOn.ifElse(
                        _$ => (
                            <TimeRangeInput startValue={start} endValue={end} step={15n} size={size}
                                disabled={disabled} onChange={onChange} presets={TIME_RANGE_PRESETS} />
                        ),
                        _$ => (
                            <TimeRangeInput startValue={start} endValue={end} step={15n} size={size}
                                disabled={disabled} onChange={onChange} />
                        ),
                    ),
                    _$ => presetsOn.ifElse(
                        _$ => (
                            <TimeRangeInput startValue={start} endValue={end} step={15n} size={size}
                                disabled={disabled} onChange={onChange} presets={TIME_RANGE_PRESETS}
                                color={colour.color} background={colour.background} borderColor={colour.borderColor} focusBorderColor={colour.focusBorder} />
                        ),
                        _$ => (
                            <TimeRangeInput startValue={start} endValue={end} step={15n} size={size}
                                disabled={disabled} onChange={onChange}
                                color={colour.color} background={colour.background} borderColor={colour.borderColor} focusBorderColor={colour.focusBorder} />
                        ),
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColour} size="sm"
                                    items={colours.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switches report as the
                            // Disabled / Presets spec rows below rather than as
                            // one value each.
                            Configurator.Slot("Flags",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={disabled} label="Disabled" onChange={onDisabled} />
                                    <Switch checked={presetsOn} label="Presets" onChange={onPresets} />
                                </HStack>),
                        ]}
                        preview={window}
                        aside={{
                            label: "Window · Reactive",
                            body: <Text.MonoLabel>{East.str`MIN · ${start} → ${end}`}</Text.MonoLabel>,
                        }}
                        spec={[
                            Configurator.Spec("Presets", presetsOn.ifElse(
                                _$ => "Morning · Afternoon · Night",
                                _$ => "hidden",
                            )),
                            Configurator.Spec("Disabled", disabled.ifElse(_$ => "both inputs", _$ => "off")),
                            Configurator.Spec("Slots", cKey.equal("recipe").ifElse(
                                _$ => "input recipe",
                                _$ => East.str`${colour.color} · ${colour.background} · ${colour.borderColor}`,
                            )),
                            Configurator.Spec("Step", "15 min"),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
