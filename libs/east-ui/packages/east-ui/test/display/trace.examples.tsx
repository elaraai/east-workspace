/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, FloatType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { ChipRail, Configurator, HStack, SegmentGroup, Select, Stack, Style, Tag, Text, Trace, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const traceBasic = example({
    keywords: ["Trace", "heatmap", "now", "measured", "predicted"],
    description: "Two tracks over a shared step axis with a now-line after four measured steps and per-step axis labels",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Trace
                tracks={[
                    { name: "A", values: [12, 14, 13, 18, 20, 22] },
                    { name: "B", values: [40, 38, 35, 30, 28, 25] },
                ]}
                now={4n}
                density="comfortable"
                scale="brand"
                axis={["−3", "−2", "−1", "0", "+1", "+2"]}
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// With ChipRail — the cross-component height-match contract
// ============================================================================

export const traceWithChipRail = example({
    keywords: ["Trace", "ChipRail", "density", "table", "align", "row"],
    description: "A Trace and a ChipRail at the same density sit at matching heights — the case for adjacent table cells",
    fn: East.function([], UIComponentType, ($) => {
        const trace = $.const(
            <Trace
                tracks={[{ name: "A", values: [12, 14, 13, 18, 20, 22] }]}
                now={4n}
                density="compact"
                scale="brand"
            />,
        );
        const rail = $.const(
            <ChipRail density="compact" separator="dot">
                <Tag>Open</Tag>
                <Tag>3 days</Tag>
                <Tag>On track</Tag>
            </ChipRail>,
        );
        return (
            <Stack direction="row" gap="8">
                {trace}
                {rail}
            </Stack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Trace — live configurator over every axis
// ============================================================================

export const traceVariants = example({
    keywords: ["Trace", "density", "condensed", "compact", "comfortable", "sizes", "scale", "brand", "diverge", "categorical", "colour", "ragged", "unequal", "lengths", "padding", "phantom", "row", "labelWidth", "gutter", "label", "truncate", "width", "now", "future", "ghost", "hatch", "fade", "tracks", "ChipRail", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator", "interactive"],
    description: "Trace configurator — density, scale, future, now-line, label-gutter and track-data axes driving one live trace; the aside re-checks the ChipRail height-match at the selected density",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const densities = $.const([
                    variant("condensed", null), variant("compact", null), variant("comfortable", null),
                ], ArrayType(Style.Types.Density));

                const scales = $.const([
                    variant("brand", null), variant("diverge", null), variant("categorical", null),
                ], ArrayType(Trace.Types.Scale));

                const futures = $.const([
                    variant("ghost", null), variant("hatch", null), variant("fade", null),
                ], ArrayType(Trace.Types.Future));

                // Numeric / token axes collapse the same way: the now-line is a
                // step index and the label gutter is a CSS length, so both are
                // bare arrays of the value itself ("34px" is the compact density
                // default, so it reads as the no-override case).
                const nows = $.const([0n, 2n, 4n, 6n], ArrayType(IntegerType));
                const gutters = $.const(["34px", "72px", "120px"], ArrayType(StringType));

                // Only the data needs a struct — a track set is names PLUS value
                // rows, with no single value to name it by. `ragged` carries rows
                // of 5 / 6 / 4 steps (the longer rows pad out); `totals` folds a
                // per-track total into each name, which is what the wide gutter
                // is for.
                const datasets = $.const([
                    {
                        label: "trend",
                        names: ["A", "B", "C"],
                        values: [[12, 14, 13, 18, 20, 22], [40, 38, 35, 30, 28, 25], [5, 9, 7, 11, 8, 14]],
                    },
                    {
                        label: "ragged",
                        names: ["Series A", "°C", "Load"],
                        values: [[12, 11, 10, 9, 8], [22, 23, 24, 25, 26, 27], [5, 9, 7, 11]],
                    },
                    {
                        label: "totals",
                        names: ["Series A · 20", "Series B · 8", "Series C · 12"],
                        values: [[12, 14, 13, 18, 20, 22], [3, 5, 4, 6, 8, 7], [8, 10, 9, 11, 12, 10]],
                    },
                ], ArrayType(StructType({
                    label: StringType,
                    names: ArrayType(StringType),
                    values: ArrayType(ArrayType(FloatType)),
                })));

                const densityBind = $.let(State.bind([StringType], "trace_density", "compact"));
                const scaleBind   = $.let(State.bind([StringType], "trace_scale", "brand"));
                const futureBind  = $.let(State.bind([StringType], "trace_future", "ghost"));
                const nowBind     = $.let(State.bind([StringType], "trace_now", "4"));
                const gutterBind  = $.let(State.bind([StringType], "trace_gutter", "34px"));
                const dataBind    = $.let(State.bind([StringType], "trace_data", "trend"));

                const densityKey = $.let(densityBind.read());
                const scaleKey   = $.let(scaleBind.read());
                const futureKey  = $.let(futureBind.read());
                const nowKey     = $.let(nowBind.read());
                const gutterKey  = $.let(gutterBind.read());
                const dataKey    = $.let(dataBind.read());

                const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onScale   = $.const(East.function([StringType], NullType, ($, next) => { $(scaleBind.write(next)); }));
                const onFuture  = $.const(East.function([StringType], NullType, ($, next) => { $(futureBind.write(next)); }));
                const onNow     = $.const(East.function([StringType], NullType, ($, next) => { $(nowBind.write(next)); }));
                const onGutter  = $.const(East.function([StringType], NullType, ($, next) => { $(gutterBind.write(next)); }));
                const onData    = $.const(East.function([StringType], NullType, ($, next) => { $(dataBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const density = $.let(densities.filter((_$, v) => v.getTag().equal(densityKey)).get(0n));
                const scale = $.let(scales.filter((_$, v) => v.getTag().equal(scaleKey)).get(0n));
                const future = $.let(futures.filter((_$, v) => v.getTag().equal(futureKey)).get(0n));
                const now = $.let(nows.filter((_$, n) => East.print(n).equal(nowKey)).get(0n));
                const gutter = $.let(gutters.filter((_$, w) => w.equal(gutterKey)).get(0n));
                const data = $.let(datasets.filter((_$, d) => d.label.equal(dataKey)).get(0n));

                // The step counts are derived, not configured — they report in the
                // spec column, and their spread is what "ragged" means.
                const stepsA = $.let(data.values.get(0n).size());
                const stepsB = $.let(data.values.get(1n).size());
                const stepsC = $.let(data.values.get(2n).size());

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Data", dataKey,
                                <SegmentGroup value={dataKey} onChange={onData} size="sm"
                                    items={datasets.map((_$, d) => SegmentGroup.Item(d.label, <Text>{d.label.upperCase()}</Text>))} />),
                            Configurator.Control("Density", densityKey,
                                <SegmentGroup value={densityKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Scale", scaleKey,
                                <SegmentGroup value={scaleKey} onChange={onScale} size="sm"
                                    items={scales.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Future", futureKey,
                                <SegmentGroup value={futureKey} onChange={onFuture} size="sm"
                                    items={futures.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Now", nowKey,
                                <Select value={nowKey} onChange={onNow} size="sm"
                                    items={nows.map((_$, n) => Select.Item(East.print(n), East.print(n)))} />),
                            Configurator.Control("Label width", gutterKey,
                                <SegmentGroup value={gutterKey} onChange={onGutter} size="sm"
                                    items={gutters.map((_$, w) => SegmentGroup.Item(w, <Text>{w}</Text>))} />),
                        ]}
                        preview={
                            <Trace
                                tracks={[
                                    { name: data.names.get(0n), values: data.values.get(0n) },
                                    { name: data.names.get(1n), values: data.values.get(1n) },
                                    { name: data.names.get(2n), values: data.values.get(2n) },
                                ]}
                                now={now}
                                density={density}
                                scale={scale}
                                future={future}
                                labelWidth={gutter}
                            />
                        }
                        aside={{
                            label: "Row · ChipRail height match",
                            body: (
                                <HStack gap="8" align="center">
                                    <Trace
                                        tracks={[{ name: data.names.get(0n), values: data.values.get(0n) }]}
                                        now={now}
                                        density={density}
                                        scale={scale}
                                    />
                                    <ChipRail density={density} separator="dot">
                                        <Tag>Open</Tag>
                                        <Tag>3 days</Tag>
                                        <Tag>On track</Tag>
                                    </ChipRail>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Tracks", East.print(data.names.size())),
                            Configurator.Spec("Steps", East.str`${East.print(stepsA)} · ${East.print(stepsB)} · ${East.print(stepsC)}`),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
