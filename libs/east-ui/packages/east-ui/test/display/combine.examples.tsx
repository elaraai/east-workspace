/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Avatar, ChipRail, HStack, Meter, MetricChip, Stack, Table, Tag, Text, Trace } from "@elaraai/east-ui";

export const combineDensities = example({
    keywords: ["density", "Table", "Tag", "Trace", "ChipRail", "Meter", "MetricChip", "Avatar", "combine", "cascade"],
    description: "One density prop on the Table cascades to every display component in its cells — the same mixed surface at condensed, compact and comfortable",
    fn: East.function([], UIComponentType, ($) => {
        const lines = $.let([
            { line: "Line A", owner: "Mia Kerr", state: "Running", mix: ["Grade A", "Grade B"], trend: [12.0, 14.0, 13.0, 18.0, 20.0], util: 82.0, delta: "+4.2%" },
            { line: "Line B", owner: "Tom Ode", state: "Changeover", mix: ["Grade C"], trend: [30.0, 28.0, 26.0, 22.0, 18.0], util: 41.0, delta: "+1.1%" },
            { line: "Line C", owner: "Ana Diaz", state: "Running", mix: ["Grade A", "Grade D", "Grade E"], trend: [8.0, 9.0, 12.0, 14.0, 17.0], util: 67.0, delta: "+6.8%" },
        ]);
        const condensed = $.const(
            <Table
                density="condensed"
                data={lines}
                columns={{
                    line: {
                        header: "Line",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return (
                                <HStack gap="2">
                                    <Avatar name={row.owner} colorPalette="blue" />
                                    <Text>{row.line}</Text>
                                </HStack>
                            );
                        }),
                    },
                    state: {
                        header: "State",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <Tag variant="brand">{row.state}</Tag>;
                        }),
                    },
                    mix: {
                        header: "Mix",
                        width: "210px",
                        value: (mix) => mix.size(),
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <ChipRail separator="dot">{row.mix.map((_$, m) => <Tag>{m}</Tag>)}</ChipRail>;
                        }),
                    },
                    trend: {
                        header: "Trend",
                        width: "140px",
                        value: (trend) => trend.size(),
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <Trace tracks={[{ name: "", values: row.trend }]} now={4n} />;
                        }),
                    },
                    util: {
                        header: "Util",
                        width: "160px",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <Meter value={row.util} tone="success" />;
                        }),
                    },
                    delta: {
                        header: "Δ Out",
                        width: "120px",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <MetricChip tone="positive"><Text>{row.delta}</Text></MetricChip>;
                        }),
                    },
                }}
            />,
        );
        const compact = $.const(
            <Table
                density="compact"
                data={lines}
                columns={{
                    line: {
                        header: "Line",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return (
                                <HStack gap="2">
                                    <Avatar name={row.owner} colorPalette="blue" />
                                    <Text>{row.line}</Text>
                                </HStack>
                            );
                        }),
                    },
                    state: {
                        header: "State",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <Tag variant="brand">{row.state}</Tag>;
                        }),
                    },
                    mix: {
                        header: "Mix",
                        width: "260px",
                        value: (mix) => mix.size(),
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <ChipRail separator="dot">{row.mix.map((_$, m) => <Tag>{m}</Tag>)}</ChipRail>;
                        }),
                    },
                    trend: {
                        header: "Trend",
                        width: "240px",
                        value: (trend) => trend.size(),
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <Trace tracks={[{ name: "", values: row.trend }]} now={4n} />;
                        }),
                    },
                    util: {
                        header: "Util",
                        width: "160px",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <Meter value={row.util} tone="success" />;
                        }),
                    },
                    delta: {
                        header: "Δ Out",
                        width: "120px",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <MetricChip tone="positive"><Text>{row.delta}</Text></MetricChip>;
                        }),
                    },
                }}
            />,
        );
        const comfortable = $.const(
            <Table
                density="comfortable"
                data={lines}
                columns={{
                    line: {
                        header: "Line",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return (
                                <HStack gap="2">
                                    <Avatar name={row.owner} colorPalette="blue" />
                                    <Text>{row.line}</Text>
                                </HStack>
                            );
                        }),
                    },
                    state: {
                        header: "State",
                        width: "150px",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <Tag variant="brand">{row.state}</Tag>;
                        }),
                    },
                    mix: {
                        header: "Mix",
                        width: "200px",
                        value: (mix) => mix.size(),
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <ChipRail separator="dot">{row.mix.map((_$, m) => <Tag>{m}</Tag>)}</ChipRail>;
                        }),
                    },
                    trend: {
                        header: "Trend",
                        width: "320px",
                        value: (trend) => trend.size(),
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <Trace tracks={[{ name: "", values: row.trend }]} now={4n} />;
                        }),
                    },
                    util: {
                        header: "Util",
                        width: "125px",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <Meter value={row.util} tone="success" />;
                        }),
                    },
                    delta: {
                        header: "Δ Out",
                        width: "135px",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                            const row = $.let(lines.get(ctx.rowIndex));
                            return <MetricChip tone="positive"><Text>{row.delta}</Text></MetricChip>;
                        }),
                    },
                }}
            />,
        );
        return (
            <Stack direction="column" gap="8">
                {condensed}
                {compact}
                {comfortable}
            </Stack>
        );
    }),
    inputs: [],
});
