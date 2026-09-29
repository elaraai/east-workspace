/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, example, none, some, variant } from "@elaraai/east";
import { Chart, HStack, Layout, Stat, Table, UIComponentType } from "@elaraai/east-ui";

export const layoutPage = example({
    keywords: [
        "Layout", "tiles", "tile", "grid", "12-column", "columns", "span", "row", "rows", "cell", "page", "canvas",
        "frame", "height", "align", "responsive", "width", "Studio",
    ],
    description: "A page of tiles on the 12-column grid — a KPI rail across the top, a revenue trend beside a breakdown, and an assignment board below; each tile is a cell mapped from a row, and its content is chosen by the row's kind",
    fn: East.function([], UIComponentType, ($) => {
        const Kind = VariantType({ kpis: NullType, trend: NullType, breakdown: NullType, board: NullType });
        const Tile = StructType({ id: StringType, row: StringType, span: IntegerType, height: OptionType(IntegerType), kind: Kind });
        const tiles = $.const([
            { id: "kpi-rail", row: "top", span: 12n, height: none, kind: variant("kpis", null) },
            { id: "revenue-trend", row: "middle", span: 8n, height: some(280n), kind: variant("trend", null) },
            { id: "breakdown-bars", row: "middle", span: 4n, height: some(280n), kind: variant("breakdown", null) },
            { id: "assignment-board", row: "bottom", span: 12n, height: none, kind: variant("board", null) },
        ], ArrayType(Tile));
        const Day = StructType({ day: StringType, revenue: FloatType });
        const days = $.const([
            { day: "Mon", revenue: 4.2 }, { day: "Tue", revenue: 5.1 }, { day: "Wed", revenue: 4.8 },
            { day: "Thu", revenue: 6.3 }, { day: "Fri", revenue: 7.0 }, { day: "Sat", revenue: 5.6 },
        ], ArrayType(Day));
        const Region = StructType({ region: StringType, revenue: FloatType });
        const regions = $.const([
            { region: "North", revenue: 12.4 }, { region: "South", revenue: 9.1 },
            { region: "East", revenue: 7.6 }, { region: "West", revenue: 5.2 },
        ], ArrayType(Region));
        const Assignment = StructType({ crew: StringType, site: StringType, shift: StringType });
        const assignments = $.const([
            { crew: "Crew 1", site: "Depot A", shift: "Early" },
            { crew: "Crew 2", site: "Depot B", shift: "Late" },
            { crew: "Crew 3", site: "Depot A", shift: "Night" },
        ], ArrayType(Assignment));
        return (
            <Layout
                data={tiles}
                width="1440px"
                cell={t => Layout.cell({
                    key: t.id, row: t.row, span: t.span, height: t.height,
                    content: t.kind.match({
                        kpis: () => (
                            <HStack gap="8" padding="4">
                                <Stat label="Orders" value={128n} />
                                <Stat label="Revenue" value={32.4} />
                                <Stat label="Late" value={9n} />
                                <Stat label="Returns" value={4n} />
                            </HStack>
                        ),
                        trend: () => <Chart height="fill" grid layers={Chart.Area(days, { x: r => r.day, y: r => r.revenue })} />,
                        breakdown: () => <Chart height="fill" grid={false} layers={Chart.Bar(regions, { x: r => r.revenue, y: r => r.region })} />,
                        board: () => (
                            <Table data={assignments} columns={{
                                crew: { header: "Crew" },
                                site: { header: "Site" },
                                shift: { header: "Shift" },
                            }} />
                        ),
                    }),
                })}
            />
        );
    }),
    inputs: [],
});

export const layoutWireframe = example({
    keywords: ["Layout", "wireframe", "thumbnail", "outline", "template", "preview", "page library", "variant", "tiles", "grid"],
    description: "A page's wireframe — each cell drawn as an outline at its tile's size and its content left out, the page library's thumbnail",
    fn: East.function([], UIComponentType, ($) => {
        const Tile = StructType({ id: StringType, row: StringType, span: IntegerType, height: OptionType(IntegerType) });
        const tiles = $.const([
            { id: "kpi-1", row: "top", span: 3n, height: some(48n) },
            { id: "kpi-2", row: "top", span: 3n, height: some(48n) },
            { id: "kpi-3", row: "top", span: 3n, height: some(48n) },
            { id: "kpi-4", row: "top", span: 3n, height: some(48n) },
            { id: "trend", row: "middle", span: 8n, height: some(120n) },
            { id: "bars", row: "middle", span: 4n, height: some(120n) },
            { id: "board", row: "bottom", span: 12n, height: none },
        ], ArrayType(Tile));
        return (
            <Layout
                data={tiles}
                variant="wireframe"
                width="480px"
                cell={t => Layout.cell({ key: t.id, row: t.row, span: t.span, height: t.height, content: <Stat label="Tile" value={0n} /> })}
            />
        );
    }),
    inputs: [],
});
