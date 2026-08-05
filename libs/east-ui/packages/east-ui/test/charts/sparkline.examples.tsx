/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, FloatType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, Reactive, SegmentGroup, Select, Sparkline, Text, VStack } from "@elaraai/east-ui";

// Module-scope fixtures — one per data preset (consolidation epic #455).
const SPARKLINE_STOCK_DATA = [142.5, 143.2, 141.8, 144.0, 143.5, 145.2, 144.8, 146.0];
const SPARKLINE_METRIC_DATA = [100.0, 120.0, 115.0, 130.0, 125.0, 140.0, 155.0];
const SPARKLINE_TABLE_CELL_DATA = [10.0, 12.0, 8.0, 15.0, 11.0, 14.0];
const SPARKLINE_DOWNTREND_DATA = [50.0, 48.0, 45.0, 42.0, 44.0, 40.0, 38.0];

export const sparklineBasic = example({
    keywords: ["Sparkline", "line", "basic"],
    description: "Default line chart type",
    fn: East.function([], UIComponentType, (_$) => {
        return <Sparkline data={[1.0, 3.0, 2.0, 4.0, 3.5, 5.0, 4.2]} type="line" color="link" width="150px" height="40px" />;
    }),
    inputs: [],
});

// ============================================================================
// Sparkline — live configurator over every axis
// ============================================================================

export const sparklineVariants = example({
    keywords: ["Sparkline", "area", "filled", "color", "red", "teal", "purple", "width", "height", "sizes", "stock", "uptrend", "dashboard", "metric", "inline", "table", "compact", "downtrend", "declining", "Reactive", "State", "interactive", "counter", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Sparkline configurator — type, colour, size and data axes driving one live sparkline; the aside bumps a reactive counter into the trend's last point",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const types = $.const([
                    variant("line", null), variant("area", null),
                ], ArrayType(Sparkline.Types.ChartType));

                // Colour is a labelled semantic token; size a width/height pair;
                // data a labelled trend preset — each a bare array of the value.
                const colors = $.const([
                    { label: "success", color: "fg.success" },
                    { label: "danger",  color: "fg.danger" },
                    { label: "brand",   color: "brand.600" },
                    { label: "accent",  color: "accent.purple" },
                    { label: "muted",   color: "fg.muted" },
                    { label: "link",    color: "link" },
                ], ArrayType(StructType({ label: StringType, color: StringType })));

                const sizes = $.const([
                    { label: "sm", w: "80px",  h: "24px" },
                    { label: "md", w: "120px", h: "32px" },
                    { label: "lg", w: "200px", h: "48px" },
                ], ArrayType(StructType({ label: StringType, w: StringType, h: StringType })));

                const datasets = $.const([
                    { label: "stock",     points: SPARKLINE_STOCK_DATA },
                    { label: "metric",    points: SPARKLINE_METRIC_DATA },
                    { label: "cell",      points: SPARKLINE_TABLE_CELL_DATA },
                    { label: "downtrend", points: SPARKLINE_DOWNTREND_DATA },
                ], ArrayType(StructType({ label: StringType, points: ArrayType(FloatType) })));

                const typeBind  = $.let(State.bind([StringType], "sparkline_type", "area"));
                const colorBind = $.let(State.bind([StringType], "sparkline_color", "success"));
                const sizeBind  = $.let(State.bind([StringType], "sparkline_size", "lg"));
                const dataBind  = $.let(State.bind([StringType], "sparkline_data", "stock"));
                const counter   = $.let(State.bind([IntegerType], "sparkline_counter", 0n));

                const tKey = $.let(typeBind.read());
                const cKey = $.let(colorBind.read());
                const sKey = $.let(sizeBind.read());
                const dKey = $.let(dataBind.read());
                const value = $.let(counter.read());

                const onType  = $.const(East.function([StringType], NullType, ($, next) => { $(typeBind.write(next)); }));
                const onColor = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));
                const onSize  = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onData  = $.const(East.function([StringType], NullType, ($, next) => { $(dataBind.write(next)); }));
                const inc     = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const chartType = $.let(types.filter((_$, v) => v.getTag().equal(tKey)).get(0n));
                const color = $.let(colors.filter((_$, o) => o.label.equal(cKey)).get(0n));
                const size = $.let(sizes.filter((_$, o) => o.label.equal(sKey)).get(0n));
                const dataset = $.let(datasets.filter((_$, o) => o.label.equal(dKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Type", tKey,
                                <SegmentGroup value={tKey} onChange={onType} size="sm"
                                    items={types.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Colour", cKey,
                                <Select value={cKey} onChange={onColor} size="sm"
                                    items={colors.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Data", dKey,
                                <Select value={dKey} onChange={onData} size="sm"
                                    items={datasets.map((_$, o) => Select.Item(o.label, o.label))} />),
                        ]}
                        preview={
                            <Sparkline data={dataset.points} type={chartType} color={color.color} width={size.w} height={size.h} />
                        }
                        aside={{
                            label: "Last point · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Sparkline
                                        data={[10.0, 12.0, 8.0, 15.0, 18.0, 14.0, 22.0, value.toFloat().multiply(2.0).add(19.0)]}
                                        color="blue.solid"
                                        height="40px"
                                        width="200px"
                                        type="area"
                                    />
                                    <Button size="xs" onClick={inc}>Bump last point</Button>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Dimensions", East.str`${size.w} × ${size.h}`),
                            Configurator.Spec("Samples", East.print(dataset.points.length())),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
