/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Avatar, ChipRail, Configurator, HStack, Meter, MetricChip, Reactive, SegmentGroup, Style, Switch, Table, Tag, Text, Trace } from "@elaraai/east-ui";

// ============================================================================
// Combine — live configurator over the density cascade (one Table hosting
// Avatar / Tag / ChipRail / Trace / Meter / MetricChip cells).
// ============================================================================

export const combineDensities = example({
    keywords: ["density", "Table", "Tag", "Trace", "ChipRail", "Meter", "MetricChip", "Avatar", "combine", "cascade", "condensed", "compact", "comfortable", "variant", "striped", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Density-cascade configurator — density and table-variant axes plus a striped switch driving one mixed Table; the density cascades into every display component in its cells",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const lines = $.let([
                    { line: "Line A", owner: "Mia Kerr", state: "Running", mix: ["Grade A", "Grade B"], trend: [12.0, 14.0, 13.0, 18.0, 20.0], util: 82.0, delta: "+4.2%" },
                    { line: "Line B", owner: "Tom Ode", state: "Changeover", mix: ["Grade C"], trend: [30.0, 28.0, 26.0, 22.0, 18.0], util: 41.0, delta: "+1.1%" },
                    { line: "Line C", owner: "Ana Diaz", state: "Running", mix: ["Grade A", "Grade D", "Grade E"], trend: [8.0, 9.0, 12.0, 14.0, 17.0], util: 67.0, delta: "+6.8%" },
                ]);

                // A density preset is the Density variant PLUS the column
                // widths tuned for it, so the axis swaps the whole set
                // together — `getTag()` on the variant still names the segment.
                const densities = $.const([
                    { density: variant("condensed", null), state: "auto", mix: "210px", trend: "140px", util: "160px", delta: "120px" },
                    { density: variant("compact", null), state: "auto", mix: "260px", trend: "240px", util: "160px", delta: "120px" },
                    { density: variant("comfortable", null), state: "150px", mix: "200px", trend: "320px", util: "125px", delta: "135px" },
                ], ArrayType(StructType({ density: Style.Types.Density, state: StringType, mix: StringType, trend: StringType, util: StringType, delta: StringType })));

                // Enumerated axes are just their variants — `getTag()` gives
                // the segment key AND its label.
                const variants = $.const([
                    variant("line", null), variant("outline", null),
                ], ArrayType(Table.Types.Variant));

                const densityBind = $.let(State.bind([StringType], "combine_density", "compact"));
                const variantBind = $.let(State.bind([StringType], "combine_variant", "line"));
                const stripedBind = $.let(State.bind([BooleanType], "combine_striped", false));

                const dKey = $.let(densityBind.read());
                const vKey = $.let(variantBind.read());
                const striped = $.let(stripedBind.read());

                const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
                const onVariant = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onStriped = $.const(East.function([BooleanType], NullType, ($, next) => { $(stripedBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const preset = $.let(densities.filter((_$, o) => o.density.getTag().equal(dKey)).get(0n));
                const tableVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Density", dKey,
                                <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                    items={densities.map((_$, o) => SegmentGroup.Item(o.density.getTag(), <Text>{o.density.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Striped spec row below rather than as one value.
                            Configurator.Slot("Rows",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={striped} label="Striped" onChange={onStriped} />
                                </HStack>),
                        ]}
                        preview={
                            <Table
                                density={preset.density}
                                variant={tableVariant}
                                striped={striped}
                                data={lines}
                                columns={{
                                    line: {
                                        header: "Line",
                                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                                            const row = $.let(lines.get(ctx.rowIndex));
                                            return (
                                                <HStack gap="2">
                                                    <Avatar name={row.owner} colorPalette="brand" />
                                                    <Text>{row.line}</Text>
                                                </HStack>
                                            );
                                        }),
                                    },
                                    state: {
                                        header: "State",
                                        width: preset.state,
                                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                                            const row = $.let(lines.get(ctx.rowIndex));
                                            return <Tag variant="brand">{row.state}</Tag>;
                                        }),
                                    },
                                    mix: {
                                        header: "Mix",
                                        width: preset.mix,
                                        value: (mix) => mix.size(),
                                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                                            const row = $.let(lines.get(ctx.rowIndex));
                                            return <ChipRail separator="dot">{row.mix.map((_$, m) => <Tag>{m}</Tag>)}</ChipRail>;
                                        }),
                                    },
                                    trend: {
                                        header: "Trend",
                                        width: preset.trend,
                                        value: (trend) => trend.size(),
                                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                                            const row = $.let(lines.get(ctx.rowIndex));
                                            return <Trace tracks={[{ name: "", values: row.trend }]} now={4n} />;
                                        }),
                                    },
                                    util: {
                                        header: "Util",
                                        width: preset.util,
                                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                                            const row = $.let(lines.get(ctx.rowIndex));
                                            return <Meter value={row.util} tone="success" />;
                                        }),
                                    },
                                    delta: {
                                        header: "Δ Out",
                                        width: preset.delta,
                                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                                            const row = $.let(lines.get(ctx.rowIndex));
                                            return <MetricChip tone="positive"><Text>{row.delta}</Text></MetricChip>;
                                        }),
                                    },
                                }}
                            />
                        }
                        spec={[
                            Configurator.Spec("Cascade", "Avatar · Tag · ChipRail · Trace · Meter · MetricChip"),
                            Configurator.Spec("Striped", striped.ifElse(_$ => "zebra", _$ => "plain")),
                            Configurator.Spec("Widths", East.str`mix ${preset.mix} · trend ${preset.trend}`),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
