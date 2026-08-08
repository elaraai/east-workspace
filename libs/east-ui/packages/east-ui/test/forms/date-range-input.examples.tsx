/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, DateTimeType, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, DateRangeInput, HStack, Input, SegmentGroup, Style, Switch, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — presets are a host-level array (not an East
// expression), so the five canonical ranges live here once.
// ============================================================================

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const dateRangeInputBasic = example({
    keywords: ["DateRangeInput", "Root", "date", "range", "basic"],
    description: "Basic date range — April 1 → April 30 2026",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        return <DateRangeInput startValue={start} endValue={end} precision="date" />;
    }),
    inputs: [],
});

// ============================================================================
// DateRangeInput — live configurator over every range axis
// ============================================================================

export const dateRangeInputVariants = example({
    keywords: ["DateRangeInput", "precision", "datetime", "time", "hours", "presets", "relative", "MTD", "YTD", "Last 7 days", "colour", "color", "escape", "hatches", "size", "sm", "md", "lg", "disabled", "readonly", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State", "onChange", "interactive"],
    description: "DateRangeInput configurator — precision, size and colour axes plus disabled and presets switches driving one live State-bound range; the aside reads the range back",
    fn: East.function([], UIComponentType, (_$) => {
        const DATE_RANGE_PRESETS = [
            { label: "Last 7 days", start: new Date("2026-04-21T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
            { label: "MTD", start: new Date("2026-04-01T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
            { label: "QTD", start: new Date("2026-04-01T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
            { label: "YTD", start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
            { label: "Q2 2026", start: new Date("2026-04-01T00:00:00Z"), end: new Date("2026-06-30T00:00:00Z") },
        ];
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const precisions = $.const([
                    variant("date", null), variant("datetime", null),
                ], ArrayType(Input.Types.DateTimePrecision));

                const sizes = $.const([
                    variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                // Only colour needs a struct — the four escape-hatch slots move
                // together, with no single value to name them by. The `recipe`
                // row carries empty slots because the preview drops the
                // overrides entirely for it (below).

                const precisionBind = $.let(State.bind([StringType], "date_range_input_precision", "date"));
                const sizeBind      = $.let(State.bind([StringType], "date_range_input_size", "md"));
                const disabledBind  = $.let(State.bind([BooleanType], "date_range_input_disabled", false));

                // The preview is a live control, so the range keeps its own
                // State-bound start / end pair — the old reactive row's binds.
                const startBind = $.let(State.bind([DateTimeType], "date_range_input_start", new Date("2026-04-01T00:00:00Z")));
                const endBind   = $.let(State.bind([DateTimeType], "date_range_input_end", new Date("2026-04-30T00:00:00Z")));

                const pKey      = $.let(precisionBind.read());
                const sKey      = $.let(sizeBind.read());
                const disabled  = $.let(disabledBind.read());
                const start     = $.let(startBind.read(), DateTimeType);
                const end       = $.let(endBind.read(), DateTimeType);

                const onPrecision = $.const(East.function([StringType], NullType, ($, next) => { $(precisionBind.write(next)); }));
                const onSize      = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onDisabled  = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
                const onChange    = $.const(East.function([DateTimeType, DateTimeType], NullType, ($, s, e) => {
                    $(startBind.write(s));
                    $(endBind.write(e));
                }));

                // Each selection is a lookup into the same array the control renders.
                const precision = $.let(precisions.filter((_$, v) => v.getTag().equal(pKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));

                // ONE input — the preset rail composes on permanently; the
                // colour escape hatches live in their own example.
                const range = $.const(
                    <DateRangeInput startValue={start} endValue={end} precision={precision} size={size}
                        disabled={disabled} onChange={onChange} presets={DATE_RANGE_PRESETS} />,
                );

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Precision", pKey,
                                <SegmentGroup value={pKey} onChange={onPrecision} size="sm"
                                    items={precisions.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switches report as the
                            // Disabled / Presets spec rows below rather than as
                            // one value each.
                            Configurator.Slot("Flags",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={disabled} label="Disabled" onChange={onDisabled} />
                                </HStack>),
                        ]}
                        preview={range}
                        aside={{
                            label: "Range · Reactive",
                            body: <Text.MonoLabel>{East.str`${start} → ${end}`}</Text.MonoLabel>,
                        }}
                        spec={[
                            Configurator.Spec("Disabled", disabled.ifElse(_$ => "both inputs", _$ => "off")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/** Raw colour escape hatches on a static range input. */
export const dateRangeInputCustomColours = example({
    keywords: ["DateRangeInput", "color", "background", "borderColor", "focusBorderColor", "override", "custom"],
    description: "Colour overrides — brand border and focus ring on a static range input",
    fn: East.function([], UIComponentType, (_$) => (
        <DateRangeInput startValue={new Date("2026-07-01T00:00:00Z")} endValue={new Date("2026-07-14T00:00:00Z")}
            color="fg.default" background="bg.canvas" borderColor="border.brand" focusBorderColor="border.brand" />
    )),
    inputs: [],
});
