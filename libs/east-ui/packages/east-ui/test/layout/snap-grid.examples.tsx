/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, DateTimeType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, example, none, some, variant } from "@elaraai/east";
import { BarStrip, Box, Chart, Format, HStack, MetricChip, SnapGrid, Stat, Status, Table, Text, UIComponentType } from "@elaraai/east-ui";

export const snapGridPage = example({
    keywords: [
        "SnapGrid", "tiles", "tile", "grid", "12-column", "columns", "span", "row", "rows", "cell", "page", "canvas",
        "frame", "height", "align", "stretch", "responsive", "Studio", "KPI", "Stat", "MetricChip", "Chart", "Area",
        "BarStrip", "Table", "Status", "placement", "kind", "match",
    ],
    description: "A page of tiles on the 12-column grid — four KPI tiles, the revenue trend beside the regional breakdown, and the accounts table below; each tile is a cell mapped from a placement, and its content is chosen by the placement's kind",
    fn: East.function([], UIComponentType, ($) => {
        const Kpi = StructType({ label: StringType, value: FloatType, format: Format.Types.Tick, change: StringType, tone: MetricChip.Types.Tone });
        const Kind = VariantType({ kpi: Kpi, trend: NullType, breakdown: NullType, accounts: NullType });
        const Placement = StructType({ id: StringType, row: StringType, span: IntegerType, height: OptionType(IntegerType), align: SnapGrid.Types.Align, kind: Kind });
        const placements = $.const([
            { id: "revenue", row: "kpis", span: 3n, height: none, align: variant("top", null), kind: variant("kpi", {
                label: "Revenue", value: 1284000.0, format: Format.Currency({ currency: "USD", compact: "short", maximumFractionDigits: 2n }),
                change: "▲ 6.4% vs Q2", tone: variant("positive", null),
            }) },
            { id: "orders", row: "kpis", span: 3n, height: none, align: variant("top", null), kind: variant("kpi", {
                label: "Orders", value: 8412.0, format: Format.Number(), change: "▲ 2.1%", tone: variant("positive", null),
            }) },
            { id: "avg-ticket", row: "kpis", span: 3n, height: none, align: variant("top", null), kind: variant("kpi", {
                label: "Avg ticket", value: 152.0, format: Format.Currency({ currency: "USD", maximumFractionDigits: 0n }),
                change: "▼ 1.3%", tone: variant("negative", null),
            }) },
            { id: "fill-rate", row: "kpis", span: 3n, height: none, align: variant("top", null), kind: variant("kpi", {
                label: "Fill rate", value: 0.94, format: Format.Percent({ maximumFractionDigits: 0n }), change: "— on target", tone: variant("neutral", null),
            }) },
            { id: "revenue-trend", row: "charts", span: 8n, height: some(220n), align: variant("top", null), kind: variant("trend", null) },
            { id: "breakdown", row: "charts", span: 4n, height: none, align: variant("stretch", null), kind: variant("breakdown", null) },
            { id: "accounts", row: "accounts", span: 12n, height: none, align: variant("top", null), kind: variant("accounts", null) },
        ], ArrayType(Placement));
        const Day = StructType({ day: DateTimeType, revenue: FloatType });
        const revenue = $.const([
            { day: new Date("2026-02-12T00:00:00Z"), revenue: 2640000.0 },
            { day: new Date("2026-02-15T00:00:00Z"), revenue: 2750000.0 },
            { day: new Date("2026-02-18T00:00:00Z"), revenue: 2700000.0 },
            { day: new Date("2026-02-21T00:00:00Z"), revenue: 2900000.0 },
            { day: new Date("2026-02-24T00:00:00Z"), revenue: 2830000.0 },
            { day: new Date("2026-02-27T00:00:00Z"), revenue: 3010000.0 },
            { day: new Date("2026-03-02T00:00:00Z"), revenue: 2960000.0 },
            { day: new Date("2026-03-05T00:00:00Z"), revenue: 3180000.0 },
            { day: new Date("2026-03-08T00:00:00Z"), revenue: 3090000.0 },
            { day: new Date("2026-03-11T00:00:00Z"), revenue: 3300000.0 },
            { day: new Date("2026-03-14T00:00:00Z"), revenue: 3220000.0 },
            { day: new Date("2026-03-18T00:00:00Z"), revenue: 3430000.0 },
            { day: new Date("2026-03-22T00:00:00Z"), revenue: 3380000.0 },
        ], ArrayType(Day));
        const Account = StructType({ account: StringType, owner: StringType, revenue: FloatType, status: StringType, tone: Status.Types.Value });
        const accounts = $.const([
            { account: "Aster Retail", owner: "M. Lee", revenue: 6810.0, status: "Active", tone: variant("success", null) },
            { account: "Meridian Foods", owner: "A. Fox", revenue: 4200.0, status: "Active", tone: variant("success", null) },
            { account: "Cedar Logistics", owner: "R. Yu", revenue: 2850.0, status: "At risk", tone: variant("warning", null) },
        ], ArrayType(Account));
        const statusCell = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
            const account = $.let(accounts.get(ctx.rowIndex));
            return <Status value={account.tone} label={<Text>{account.status}</Text>} />;
        }));
        return (
            <SnapGrid
                data={placements}
                cell={p => SnapGrid.cell({
                    key: p.id, row: p.row, span: p.span, height: p.height, align: p.align,
                    content: p.kind.match({
                        kpi: (_$, k) => (
                            <Box padding={{ top: some("3.5"), right: some("4"), bottom: some("3.5"), left: some("4") }}>
                                <Stat label={k.label} value={k.value} format={k.format}
                                    baseline={<MetricChip tone={k.tone} background="bg.subtle" borderColor="transparent"><Text>{k.change}</Text></MetricChip>} />
                            </Box>
                        ),
                        trend: () => (
                            <Box padding="4" height="100%">
                                <Chart height="fill" grid
                                    layers={Chart.Area(revenue, { x: r => r.day, y: r => r.revenue }, { color: "brand.solid", fillOpacity: 0.08, curve: "linear" })}
                                    x={{
                                        format: Chart.format.date("MMM D"),
                                        tickValues: [
                                            new Date("2026-02-12T00:00:00Z"), new Date("2026-02-26T00:00:00Z"),
                                            new Date("2026-03-11T00:00:00Z"), new Date("2026-03-22T00:00:00Z"),
                                        ],
                                    }}
                                    y={{ format: Chart.format.compact(), domain: [2400000, 3600000], tickValues: [2400000, 2800000, 3200000, 3600000] }}
                                />
                            </Box>
                        ),
                        breakdown: () => (
                            <Box padding={{ top: some("5"), right: some("4.5"), bottom: some("5"), left: some("4.5") }}>
                                <BarStrip showValues={false} items={[
                                    { label: <Text textStyle="body-sm">North</Text>, value: 42.0, color: "brand.solid", trailing: <Text textStyle="code-sm" fontWeight="semibold">42%</Text> },
                                    { label: <Text textStyle="body-sm">South</Text>, value: 31.0, color: "brand.solid", trailing: <Text textStyle="code-sm" fontWeight="semibold">31%</Text> },
                                    { label: <Text textStyle="body-sm">West</Text>, value: 27.0, color: "brand.solid", trailing: <Text textStyle="code-sm" fontWeight="semibold">27%</Text> },
                                ]} />
                            </Box>
                        ),
                        accounts: () => (
                            <Table data={accounts} columns={{
                                account: { header: "Account" },
                                owner: { header: "Owner" },
                                revenue: { header: "Revenue", format: Format.Currency({ currency: "USD", maximumFractionDigits: 0n }) },
                                status: { header: "Status", render: statusCell },
                            }} />
                        ),
                    }),
                })}
            />
        );
    }),
    inputs: [],
});

export const snapGridWireframe = example({
    keywords: ["SnapGrid", "wireframe", "thumbnail", "outline", "template", "preview", "page library", "variant", "tiles", "grid", "miniature"],
    description: "Pages as wireframes — each cell drawn as an outline at its tile's size and its content left out, the page library's thumbnails of three pages",
    fn: East.function([], UIComponentType, ($) => {
        const Placement = StructType({ id: StringType, row: StringType, span: IntegerType, height: OptionType(IntegerType) });
        const overview = $.const([
            { id: "revenue", row: "kpis", span: 3n, height: some(12n) },
            { id: "orders", row: "kpis", span: 3n, height: some(12n) },
            { id: "avg-ticket", row: "kpis", span: 3n, height: some(12n) },
            { id: "fill-rate", row: "kpis", span: 3n, height: some(12n) },
            { id: "revenue-trend", row: "charts", span: 8n, height: some(64n) },
            { id: "breakdown", row: "charts", span: 4n, height: some(64n) },
            { id: "accounts", row: "accounts", span: 12n, height: some(20n) },
        ], ArrayType(Placement));
        const accountDetail = $.const([
            { id: "header", row: "header", span: 12n, height: some(10n) },
            { id: "owner", row: "facts", span: 4n, height: some(14n) },
            { id: "revenue", row: "facts", span: 4n, height: some(14n) },
            { id: "status", row: "facts", span: 4n, height: some(14n) },
            { id: "orders", row: "orders", span: 12n, height: some(68n) },
        ], ArrayType(Placement));
        const regionalRollup = $.const([
            { id: "trend", row: "trend", span: 12n, height: some(84n) },
            { id: "north", row: "regions", span: 6n, height: some(16n) },
            { id: "south", row: "regions", span: 6n, height: some(16n) },
        ], ArrayType(Placement));
        return (
            <HStack gap="4" align="flex-start">
                <SnapGrid data={overview} variant="wireframe" width="160px"
                    cell={p => SnapGrid.cell({ key: p.id, row: p.row, span: p.span, height: p.height, content: <Text>{p.id}</Text> })} />
                <SnapGrid data={accountDetail} variant="wireframe" width="160px"
                    cell={p => SnapGrid.cell({ key: p.id, row: p.row, span: p.span, height: p.height, content: <Text>{p.id}</Text> })} />
                <SnapGrid data={regionalRollup} variant="wireframe" width="160px"
                    cell={p => SnapGrid.cell({ key: p.id, row: p.row, span: p.span, height: p.height, content: <Text>{p.id}</Text> })} />
            </HStack>
        );
    }),
    inputs: [],
});
