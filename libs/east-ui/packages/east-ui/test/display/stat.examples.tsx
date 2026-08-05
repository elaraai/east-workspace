/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, IntegerType, NullType, StringType, StructType, example, none, variant } from "@elaraai/east";
import { Format, State, Style, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, SegmentGroup, Select, Stat, Switch, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const statBasic = example({
    keywords: ["Stat", "Root", "basic", "metrics"],
    description: "Key metrics display — scalar values with formats",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="8">
                <Stat label="Revenue" value={45231} format={Format.Currency({ currency: "USD", maximumFractionDigits: 0n })} />
                <Stat label="Users" value={1234} format={Format.Number()} />
                <Stat label="Orders" value={567} format={Format.Number()} />
            </HStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Stat — live configurator over every metric axis
// ============================================================================

export const statVariants = example({
    keywords: ["Stat", "Root", "helpText", "context", "indicator", "up", "down", "flat", "trend", "Format", "currency", "number", "percent", "compact", "unit", "datetime", "density", "condensed", "comfortable", "size", "sizes", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "interactive", "counter"],
    description: "Stat configurator — format, indicator, density and size axes plus a help-text switch driving one live metric tile; the aside feeds a reactive click counter into a second Stat",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Format is the one axis that needs a struct: a formatter is
                // only legible against the magnitude it was built for, so each
                // entry carries the metric name, the raw value and the caption
                // that go with it. The format's own `getTag()` still names the
                // segment — there is no separate key column.
                const formats = $.const([
                    { format: Format.Currency({ currency: "AUD", compact: "short" }), value: 1842500.0, label: "ARR", help: "Last 30 days" },
                    { format: Format.Number(), value: 1234.0, label: "New users", help: "This week" },
                    { format: Format.Percent({ maximumFractionDigits: 2n, signDisplay: "exceptZero" }), value: 0.2336, label: "Growth", help: "vs last month" },
                    { format: Format.Compact({ display: "short" }), value: 1240000.0, label: "Requests", help: "vs yesterday" },
                    { format: Format.Unit({ unit: "kilometerPerHour", display: "short" }), value: 42.5, label: "Throughput", help: "Rolling 5 min" },
                    { format: Format.DateTime("YYYY-MM-DD HH:mm"), value: 1716249600000.0, label: "Last sync", help: "Server time" },
                ], ArrayType(StructType({ format: Format.Types.Tick, value: FloatType, label: StringType, help: StringType })));

                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const directions = $.const([
                    variant("up", null), variant("down", null), variant("flat", null),
                ], ArrayType(Stat.Types.Direction));

                const densities = $.const([
                    variant("condensed", null), variant("compact", null), variant("comfortable", null),
                ], ArrayType(Style.Types.Density));

                const sizes = $.const([
                    variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                const formatBind    = $.let(State.bind([StringType], "stat_format", "currency"));
                const directionBind = $.let(State.bind([StringType], "stat_direction", "up"));
                const densityBind   = $.let(State.bind([StringType], "stat_density", "compact"));
                const sizeBind      = $.let(State.bind([StringType], "stat_size", "md"));
                const helpBind      = $.let(State.bind([BooleanType], "stat_help", true));
                const counter       = $.let(State.bind([IntegerType], "stat_counter", 0n));

                const fKey     = $.let(formatBind.read());
                const dirKey   = $.let(directionBind.read());
                const dKey     = $.let(densityBind.read());
                const sKey     = $.let(sizeBind.read());
                const showHelp = $.let(helpBind.read());
                const count    = $.let(counter.read());

                const onFormat    = $.const(East.function([StringType], NullType, ($, next) => { $(formatBind.write(next)); }));
                const onDirection = $.const(East.function([StringType], NullType, ($, next) => { $(directionBind.write(next)); }));
                const onDensity   = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onSize      = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onHelp      = $.const(East.function([BooleanType], NullType, ($, next) => { $(helpBind.write(next)); }));
                const inc         = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const metric = $.let(formats.filter((_$, o) => o.format.getTag().equal(fKey)).get(0n));
                const direction = $.let(directions.filter((_$, v) => v.getTag().equal(dirKey)).get(0n));
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));

                // The indicator is a composite — direction is the axis, the
                // semantic sentiment and its paired icon stay unset here.
                const indicator = $.const({ direction, sentiment: none, icon: none }, Stat.Types.Indicator);
                const helpText = $.let(showHelp.ifElse(_$ => metric.help, _$ => ""));
                const helpSpec = $.let(showHelp.ifElse(_$ => metric.help, _$ => "hidden"));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Format", fKey,
                                <Select value={fKey} onChange={onFormat} size="sm"
                                    items={formats.map((_$, o) => Select.Item(o.format.getTag(), o.format.getTag()))} />),
                            Configurator.Control("Indicator", dirKey,
                                <SegmentGroup value={dirKey} onChange={onDirection} size="sm"
                                    items={directions.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Density", dKey,
                                <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Help text", helpSpec,
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={showHelp} label="Caption" onChange={onHelp} />
                                </HStack>),
                        ]}
                        preview={
                            <Stat
                                label={metric.label}
                                value={metric.value}
                                format={metric.format}
                                helpText={helpText}
                                indicator={indicator}
                                density={density}
                                size={size}
                            />
                        }
                        aside={{
                            label: "Clicks · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Stat label="Clicks" value={count} format={Format.Number()} density={density} />
                                    <Button size="xs" onClick={inc}>Click me</Button>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Metric", metric.label),
                            Configurator.Spec("Raw value", East.print(metric.value)),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
