/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, IntegerType, StringType, StructType, NullType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Box, Calendar, Configurator, HStack, Reactive, SegmentGroup, Switch, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures (consolidation epic #455).
// ============================================================================

export const calendarDemand = example({
    keywords: ["Calendar", "heatmap", "intensity", "week", "day", "totals", "mean", "footer", "legend", "compare"],
    description: "The full heatmap — the Σ-wk totals rail, the per-weekday mean row, and the selection footer (predicted / last-year / delta chip) with the low→high gradient legend",
    fn: East.function([], UIComponentType, ($) => {
        // Five weeks × seven days of forecast demand with a last-year
        // baseline; the first Monday is omitted so it renders the hatched
        // empty cell.
        const days = $.const([
            { week: "W37", day: "Tue", demand: 105.0, lastYear: 95.0 }, { week: "W37", day: "Wed", demand: 116.0, lastYear: 102.0 },
            { week: "W37", day: "Thu", demand: 120.0, lastYear: 103.0 }, { week: "W37", day: "Fri", demand: 144.0, lastYear: 121.0 },
            { week: "W37", day: "Sat", demand: 179.0, lastYear: 147.0 }, { week: "W37", day: "Sun", demand: 151.0, lastYear: 134.0 },
            { week: "W38", day: "Mon", demand: 96.0, lastYear: 89.0 }, { week: "W38", day: "Tue", demand: 104.0, lastYear: 94.0 },
            { week: "W38", day: "Wed", demand: 124.0, lastYear: 109.0 }, { week: "W38", day: "Thu", demand: 131.0, lastYear: 112.0 },
            { week: "W38", day: "Fri", demand: 157.0, lastYear: 132.0 }, { week: "W38", day: "Sat", demand: 187.0, lastYear: 153.0 },
            { week: "W38", day: "Sun", demand: 160.0, lastYear: 142.0 }, { week: "W39", day: "Mon", demand: 98.0, lastYear: 91.0 },
            { week: "W39", day: "Tue", demand: 116.0, lastYear: 104.0 }, { week: "W39", day: "Wed", demand: 127.0, lastYear: 112.0 },
            { week: "W39", day: "Thu", demand: 141.0, lastYear: 121.0 }, { week: "W39", day: "Fri", demand: 165.0, lastYear: 139.0 },
            { week: "W39", day: "Sat", demand: 201.0, lastYear: 165.0 }, { week: "W39", day: "Sun", demand: 164.0, lastYear: 145.0 },
            { week: "W40", day: "Mon", demand: 102.0, lastYear: 95.0 }, { week: "W40", day: "Tue", demand: 118.0, lastYear: 106.0 },
            { week: "W40", day: "Wed", demand: 134.0, lastYear: 118.0 }, { week: "W40", day: "Thu", demand: 141.0, lastYear: 121.0 },
            { week: "W40", day: "Fri", demand: 175.0, lastYear: 147.0 }, { week: "W40", day: "Sat", demand: 207.0, lastYear: 170.0 },
            { week: "W40", day: "Sun", demand: 175.0, lastYear: 155.0 }, { week: "W41", day: "Mon", demand: 112.0, lastYear: 104.0 },
            { week: "W41", day: "Tue", demand: 130.0, lastYear: 117.0 }, { week: "W41", day: "Wed", demand: 140.0, lastYear: 123.0 },
            { week: "W41", day: "Thu", demand: 154.0, lastYear: 132.0 }, { week: "W41", day: "Fri", demand: 178.0, lastYear: 150.0 },
            { week: "W41", day: "Sat", demand: 222.0, lastYear: 182.0 }, { week: "W41", day: "Sun", demand: 181.0, lastYear: 160.0 },
        ]);
        return (
            <Calendar
                data={days}
                cell={d => ({
                    week: d.week, day: d.day,
                    value: d.demand, compare: d.lastYear,
                    text: East.Float.printFixed(d.demand, 0n),
                })}
                totals={Calendar.totals({ aggregate: "sum", label: "Σ wk" })}
                aggregateRow={Calendar.aggregateRow({ aggregate: "mean", label: "mean" })}
                footer={Calendar.footer({ valueLabel: "predicted", compareLabel: "last yr", legend: true })}
            />
        );
    }),
    inputs: [],
});

export const calendarVariants = example({
    keywords: ["Calendar", "heatmap", "minimal", "sparse", "hatched", "values", "heat", "overview", "scale", "steps", "totals", "aggregate", "sum", "mean", "rail", "bar", "density", "comfortable", "compact", "condensed", "sizes", "maxHeight", "bounded", "scroll", "virtual", "fill", "height", "#320", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State", "onSelect", "interactive", "footer"],
    description: "Calendar configurator — density, scale-step and size axes plus values, totals and sparse-data switches driving one live heatmap; the aside tracks the tapped day via onSelect",
    fn: East.function([], UIComponentType, (_$) => {
        const CALENDAR_ROW = StructType({ week: StringType, day: StringType, demand: FloatType });
        const CALENDAR_DENSE_DATA = [
            { week: "W37", day: "Mon", demand: 96.0 }, { week: "W37", day: "Tue", demand: 105.0 }, { week: "W37", day: "Wed", demand: 116.0 },
            { week: "W37", day: "Thu", demand: 120.0 }, { week: "W37", day: "Fri", demand: 144.0 }, { week: "W37", day: "Sat", demand: 179.0 }, { week: "W37", day: "Sun", demand: 151.0 },
            { week: "W38", day: "Mon", demand: 98.0 }, { week: "W38", day: "Tue", demand: 116.0 }, { week: "W38", day: "Wed", demand: 127.0 },
            { week: "W38", day: "Thu", demand: 141.0 }, { week: "W38", day: "Fri", demand: 165.0 }, { week: "W38", day: "Sat", demand: 201.0 }, { week: "W38", day: "Sun", demand: 164.0 },
            { week: "W39", day: "Mon", demand: 112.0 }, { week: "W39", day: "Tue", demand: 130.0 }, { week: "W39", day: "Wed", demand: 140.0 },
            { week: "W39", day: "Thu", demand: 154.0 }, { week: "W39", day: "Fri", demand: 178.0 }, { week: "W39", day: "Sat", demand: 222.0 }, { week: "W39", day: "Sun", demand: 181.0 },
        ];
        const CALENDAR_SPARSE_DATA = [
            { week: "W1", day: "Mon", demand: 4.0 },
            { week: "W1", day: "Wed", demand: 9.0 },
            { week: "W1", day: "Fri", demand: 2.0 },
            { week: "W2", day: "Tue", demand: 6.0 },
            { week: "W2", day: "Sat", demand: 12.0 },
        ];
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const densities = $.const([
                    variant("comfortable", null), variant("compact", null), variant("condensed", null),
                ], ArrayType(Style.Types.Density));

                // A scale is only legible against its bucket count, so the axis
                // is a struct (8 is Calendar.scale's default ramp length).
                const scales = $.const([
                    { label: "default", steps: 8n },
                    { label: "6-step",  steps: 6n },
                ], ArrayType(StructType({ label: StringType, steps: IntegerType })));

                const dense = $.const(CALENDAR_DENSE_DATA, ArrayType(CALENDAR_ROW));
                const sparse = $.const(CALENDAR_SPARSE_DATA, ArrayType(CALENDAR_ROW));

                const densityBind = $.let(State.bind([StringType], "calendar_density", "comfortable"));
                const scaleBind   = $.let(State.bind([StringType], "calendar_scale", "default"));
                const valuesBind  = $.let(State.bind([BooleanType], "calendar_values", true));
                const totalsBind  = $.let(State.bind([BooleanType], "calendar_totals", false));
                const chromeBind  = $.let(State.bind([BooleanType], "calendar_chrome", false));
                // The selection readout (folded from the old interactive
                // example — its State key is preserved): onSelect writes the
                // tapped day into the aside.
                const selectedBind = $.let(State.bind([StringType], "calendar_selected", "none"));

                const dKey     = $.let(densityBind.read());
                const sKey     = $.let(scaleBind.read());
                const valuesOn = $.let(valuesBind.read());
                const minimal  = $.let(chromeBind.read());
                const selected = $.let(selectedBind.read());

                const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onScale   = $.const(East.function([StringType], NullType, ($, next) => { $(scaleBind.write(next)); }));
                const onValues  = $.const(East.function([BooleanType], NullType, ($, next) => { $(valuesBind.write(next)); }));
                const onTotals  = $.const(East.function([BooleanType], NullType, ($, next) => { $(totalsBind.write(next)); }));
                const onChrome  = $.const(East.function([BooleanType], NullType, ($, next) => { $(chromeBind.write(next)); }));
                const onSelect  = $.const(East.function([Calendar.Types.CellRef], NullType, ($, ref) => {
                    $(selectedBind.write(East.str`${ref.day} ${ref.week}`));
                }));

                // Each selection is a lookup into the same array the control renders.
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
                const scale = $.let(scales.filter((_$, o) => o.label.equal(sKey)).get(0n));

                // The minimal switch swaps the whole dataset — the sparse weeks
                // leave gaps that render as hatched missing days.
                const data = $.let(minimal.ifElse(_$ => sparse, _$ => dense));

                // Totals chrome composes on permanently — the sum rail and
                // peak row are presence-typed, so they stay rather than lie
                // behind a switch.
                const cal = $.const(
                    <Calendar
                        data={data}
                        cell={d => ({ week: d.week, day: d.day, value: d.demand, text: East.Float.printFixed(d.demand, 0n) })}
                        values={valuesOn}
                        scale={Calendar.scale({ steps: scale.steps })}
                        density={density}
                        totals={Calendar.totals({ aggregate: "sum", label: "Σ wk", bar: true })}
                        aggregateRow={Calendar.aggregateRow({ aggregate: "max", label: "peak" })}
                        onSelect={onSelect}
                    />,
                );

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Density", dKey,
                                <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Scale", sKey,
                                <SegmentGroup value={sKey} onChange={onScale} size="sm"
                                    items={scales.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // Slots, not Controls: the switches report as the
                            // Values / Totals / Data spec rows below rather than
                            // as one value each.
                            Configurator.Slot("Cells",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={valuesOn} label="Values" onChange={onValues} />
                                </HStack>),
                            Configurator.Slot("Chrome",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={minimal} label="Sparse data" onChange={onChrome} />
                                </HStack>),
                        ]}
                        preview={cal}
                        aside={{
                            label: "Selection · Reactive",
                            body: <Text.MonoLabel>{East.str`SELECTED · ${selected}`}</Text.MonoLabel>,
                        }}
                        spec={[
                            Configurator.Spec("Days", East.print(data.size())),
                            Configurator.Spec("Steps", East.print(scale.steps)),
                            Configurator.Spec("Values", valuesOn.ifElse(_$ => "numerals", _$ => "heat only")),
                            Configurator.Spec("Totals", "sum rail · peak row"),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/** Fill (#320) — height="fill" resolves against the bounded Box and virtualizes the 200-day grid. */
export const calendarFill = example({
    keywords: ["Calendar", "fill", "height", "#320", "virtual", "bounded", "Box", "scroll"],
    description: "Fill sizing — height=\"fill\" resolves against the bounded Box and virtualizes a 200-day calendar",
    fn: East.function([], UIComponentType, (_$) => {
        const CALENDAR_FILL_DATA = East.Array.range(10n, 210n).map((_$, w) => ({
            week: East.str`W${w}`,
            day: "Wed",
            demand: w.toFloat().multiply(4.0),
        }));
        return (
        <Box height="200px">
            <Calendar
                data={CALENDAR_FILL_DATA}
                cell={d => ({ week: d.week, day: d.day, value: d.demand, text: East.Float.printFixed(d.demand, 0n) })}
                scale={Calendar.scale({ steps: 5n })}
                height="fill"
            />
        </Box>
    );
    }),
    inputs: [],
});
