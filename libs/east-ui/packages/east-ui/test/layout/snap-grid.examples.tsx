/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, DateTimeType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, example, none, some, variant } from "@elaraai/east";
import { BarStrip, Board, Box, Chart, Dock, Format, HStack, Library, MetricChip, Reactive, Roster, SnapGrid, Sparkline, Stat, State, Status, Table, Text, UIComponentType } from "@elaraai/east-ui";

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
                            <Box padding={{ top: some("3"), right: some("4"), bottom: some("3"), left: some("4") }}>
                                <Stat label={k.label} value={k.value} format={k.format}
                                    baseline={<MetricChip tone={k.tone}><Text>{k.change}</Text></MetricChip>} />
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
                            <Box padding={{ top: some("5"), right: some("4"), bottom: some("5"), left: some("4") }}>
                                <BarStrip showValues={false} items={[
                                    { label: <Text>North</Text>, value: 42.0, trailing: <Text>42%</Text> },
                                    { label: <Text>South</Text>, value: 31.0, trailing: <Text>31%</Text> },
                                    { label: <Text>West</Text>, value: 27.0, trailing: <Text>27%</Text> },
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
    keywords: ["SnapGrid", "wireframe", "thumbnail", "outline", "template", "preview", "page library", "variant", "tiles", "grid", "miniature", "blank", "empty"],
    description: "Pages as wireframes — each cell drawn as an outline at its tile's size and its content left out, the page library's thumbnails of three pages, each framed by its host; the last, with no cells, is the blank page",
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
        const blank = $.const([], ArrayType(Placement));
        return (
            <HStack gap="4" align="stretch">
                <Box display="flex" flexDirection="column" padding="3.5" background="bg.subtle">
                    <SnapGrid data={overview} variant="wireframe" width="160px"
                        cell={p => SnapGrid.cell({ key: p.id, row: p.row, span: p.span, height: p.height, content: <Text>{p.id}</Text> })} />
                </Box>
                <Box display="flex" flexDirection="column" padding="3.5" background="bg.subtle">
                    <SnapGrid data={accountDetail} variant="wireframe" width="160px"
                        cell={p => SnapGrid.cell({ key: p.id, row: p.row, span: p.span, height: p.height, content: <Text>{p.id}</Text> })} />
                </Box>
                <Box display="flex" flexDirection="column" padding="3.5" background="bg.subtle">
                    <SnapGrid data={regionalRollup} variant="wireframe" width="160px"
                        cell={p => SnapGrid.cell({ key: p.id, row: p.row, span: p.span, height: p.height, content: <Text>{p.id}</Text> })} />
                </Box>
                <Box display="flex" flexDirection="column" padding="3.5" background="bg.subtle">
                    <SnapGrid data={blank} variant="wireframe" width="160px"
                        cell={p => SnapGrid.cell({ key: p.id, row: p.row, span: p.span, height: p.height, content: <Text>{p.id}</Text> })} />
                </Box>
            </HStack>
        );
    }),
    inputs: [],
});

export const snapGridEditor = example({
    keywords: [
        "SnapGrid", "edit", "editing", "builder", "canvas", "drag", "drop", "move", "resize", "span", "height", "select",
        "Library", "palette", "component library", "create", "onUpdate", "undo", "Apply", "guides", "ruler", "Studio",
        "toolbar", "selection bar", "panes", "Dock", "zoom", "design width", "Desktop", "Tablet", "view", "viewState", "icon", "meta",
    ],
    description: "The builder's canvas — an editable SnapGrid over the page's tiles in the builder's frame: one toolbar across it (a status, the grid chip, the width readout, the zoom, the history item and Desktop · Tablet), the component library in a pane beside the grid, and the selection bar naming the selected tile; a component dropped on the grid becomes a tile, and every move, resize and removal is a draft the history item undoes, redoes, discards and applies",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const Kind = VariantType({ kpis: NullType, breakdown: NullType, trend: NullType, orders: NullType, visits: NullType, board: NullType, roster: NullType });
            const Component = StructType({ id: StringType, name: StringType, meta: StringType, icon: StringType, group: StringType, span: IntegerType, kind: Kind });
            // The component library: what the operator can place, grouped, and each one's span when it lands.
            const library = $.const([
                { id: "kpi", name: "KPI rail", meta: "Stat ×4 · metrics.today", icon: "gauge-high", group: "Display", span: 12n, kind: variant("kpis", null) },
                { id: "region", name: "Breakdown bars", meta: "BarStrip · by region", icon: "chart-bar", group: "Display", span: 4n, kind: variant("breakdown", null) },
                { id: "trend", name: "Revenue trend", meta: "Chart.Area · 90 d", icon: "chart-area", group: "Charts", span: 8n, kind: variant("trend", null) },
                { id: "orders", name: "Orders by week", meta: "Chart.Column · 8 wk", icon: "chart-column", group: "Charts", span: 6n, kind: variant("orders", null) },
                { id: "spark", name: "Visits sparkline", meta: "Sparkline · 14 d", icon: "chart-line", group: "Charts", span: 4n, kind: variant("visits", null) },
                { id: "board", name: "Assignment board", meta: "Board · areas × shifts", icon: "border-all", group: "Collections", span: 12n, kind: variant("board", null) },
                { id: "roster", name: "Shift roster", meta: "Roster · people × days", icon: "calendar-week", group: "Collections", span: 12n, kind: variant("roster", null) },
            ], ArrayType(Component));
            // The page's tiles, held where the canvas writes them back.
            const Tile = StructType({ id: StringType, row: StringType, span: IntegerType, height: OptionType(IntegerType), name: StringType, kind: Kind });
            const tiles = $.let(State.bind([ArrayType(Tile)], "snap-grid-editor.tiles", [
                { id: "kpi", row: "kpis", span: 12n, height: none, name: "KPI rail", kind: variant("kpis", null) },
                { id: "trend", row: "charts", span: 8n, height: none, name: "Revenue trend", kind: variant("trend", null) },
                { id: "region", row: "charts", span: 4n, height: none, name: "Breakdown bars", kind: variant("breakdown", null) },
                { id: "board", row: "board", span: 12n, height: none, name: "Assignment board", kind: variant("board", null) },
            ]));
            const selection = $.let(State.bind([SnapGrid.Types.UiState], "snap-grid-editor.selection", SnapGrid.uiState({ selected: "trend" })));
            // The design width and the zoom the toolbar sets, held where a preview beside it could read them.
            const view = $.let(State.bind([SnapGrid.Types.ViewState], "snap-grid-editor.view", SnapGrid.viewState()));
            // Each tile's icon and meta line, from its component in the library.
            const byKind = $.const(library.toDict((_$2, c) => c.kind.getTag(), (_$2, c) => c));
            // What the tiles show.
            const Kpi = StructType({ label: StringType, value: FloatType, format: Format.Types.Tick, change: StringType, tone: MetricChip.Types.Tone });
            const kpis = $.const([
                { label: "Revenue", value: 1284000.0, format: Format.Currency({ currency: "USD", compact: "short", maximumFractionDigits: 2n }), change: "▲ 6.4%", tone: variant("positive", null) },
                { label: "Orders", value: 8412.0, format: Format.Number(), change: "▲ 2.1%", tone: variant("positive", null) },
                { label: "Avg ticket", value: 152.0, format: Format.Currency({ currency: "USD", maximumFractionDigits: 0n }), change: "▼ 1.3%", tone: variant("negative", null) },
                { label: "Fill rate", value: 0.94, format: Format.Percent({ maximumFractionDigits: 0n }), change: "— flat", tone: variant("neutral", null) },
            ], ArrayType(Kpi));
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
            const Week = StructType({ week: StringType, orders: IntegerType });
            const orders = $.const([
                { week: "W9", orders: 96n }, { week: "W10", orders: 158n }, { week: "W11", orders: 214n }, { week: "W12", orders: 271n },
                { week: "W13", orders: 248n }, { week: "W14", orders: 196n }, { week: "W15", orders: 132n }, { week: "W16", orders: 74n },
            ], ArrayType(Week));
            const visits = $.const([412.0, 438.0, 401.0, 466.0, 490.0, 455.0, 512.0, 538.0, 501.0, 560.0, 587.0, 549.0, 603.0, 621.0], ArrayType(FloatType));
            const COMMITTED = variant("committed", null);
            return (
                <SnapGrid
                    data={tiles}
                    ui={selection}
                    view={view}
                    sources={["palette"]}
                    guides
                    width="1440px"
                    widths={[
                        { label: "Desktop", icon: "desktop", width: "1440px" },
                        { label: "Tablet", icon: "tablet-screen-button", width: "1024px" },
                    ]}
                    toolbar={{ start: [<Status label="Draft" ring showIcon={false} />] }}
                    panes={{
                        start: (
                            <Dock icon="shapes" label="Components" badge="7" expandedSize="264px" surface="shell">
                                <Library id="palette" data={library}
                                    item={c => ({ key: c.id, label: c.name, sublabel: c.meta, icon: c.icon })}
                                    groupBy={[{ key: "category", label: "Category", value: c => c.group }]}
                                    search={c => c.name} />
                            </Dock>
                        ),
                    }}
                    cell={t => SnapGrid.cell({
                        key: t.id, row: t.row, span: t.span, height: t.height, label: some(t.name),
                        icon: some(byKind.get(t.kind.getTag()).icon),
                        meta: some(byKind.get(t.kind.getTag()).meta),
                        // A chart shrinks to 120px, a sparkline to 80px; any other tile stops at its content.
                        minHeight: t.kind.match({
                            kpis: () => none, breakdown: () => none, trend: () => some(120n), orders: () => some(120n),
                            visits: () => some(80n), board: () => none, roster: () => none,
                        }),
                        content: t.kind.match({
                            kpis: () => (
                                <HStack gap="0" align="stretch">
                                    {kpis.map(($2, k, i) => (
                                        <Box flex="1" borderColor="border.subtle"
                                            borderWidth={i.equal(kpis.size().subtract(1n)).ifElse(_$3 => "0", _$3 => "0 1px 0 0")}
                                            padding={{ top: some("3"), right: some("4"), bottom: some("3"), left: some("4") }}>
                                            <Stat label={k.label} value={k.value} format={k.format}
                                                baseline={<MetricChip tone={k.tone}><Text>{k.change}</Text></MetricChip>} />
                                        </Box>
                                    ))}
                                </HStack>
                            ),
                            breakdown: () => (
                                <Box padding="4">
                                    <BarStrip showValues={false} items={[
                                        { label: <Text>North</Text>, value: 42.0, trailing: <Text>42%</Text> },
                                        { label: <Text>South</Text>, value: 31.0, trailing: <Text>31%</Text> },
                                        { label: <Text>West</Text>, value: 27.0, trailing: <Text>27%</Text> },
                                    ]} />
                                </Box>
                            ),
                            // A plot's natural height is its box's; a tile given a height gives it that one.
                            trend: () => (
                                <Box height="168px" padding={{ top: some("4"), right: some("4"), bottom: some("3"), left: some("3") }}>
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
                            orders: () => (
                                <Box height="168px" padding={{ top: some("4"), right: some("4"), bottom: some("3"), left: some("3") }}>
                                    <Chart height="fill" grid layers={Chart.Column(orders, { x: w => w.week, y: w => w.orders }, { color: "brand.solid" })}
                                        y={{ format: Chart.format.compact() }} />
                                </Box>
                            ),
                            visits: () => (
                                <HStack gap="5" align="center" padding={{ top: some("3"), right: some("5"), bottom: some("3"), left: some("5") }}>
                                    <Stat label="Visits · 14 d" value={9840.0} format={Format.Number()} />
                                    <Box flex="1" minWidth="0" height="48px">
                                        <Sparkline data={visits} type="area" height="100%" />
                                    </Box>
                                </HStack>
                            ),
                            board: () => (
                                <Board id="assignments" mode="published" areaHeader="Area"
                                    areas={[{ key: "north", label: "North" }, { key: "south", label: "South" }]}
                                    area={a => ({ key: a.key, label: a.label })}
                                    shifts={[{ key: "am", label: "AM", sublabel: "07-15" }, { key: "pm", label: "PM", sublabel: "15-23" }, { key: "night", label: "Night", sublabel: "23-07" }]}
                                    shift={sh => ({ key: sh.key, label: sh.label, sublabel: sh.sublabel })}
                                    people={[
                                        { key: "af", label: "A.F." }, { key: "ry", label: "R.Y." }, { key: "ka", label: "K.A." },
                                        { key: "ml", label: "M.L." }, { key: "ti", label: "T.I." }, { key: "pr", label: "P.R." },
                                    ]}
                                    person={pe => ({ key: pe.key, label: pe.label })}
                                    assignments={[
                                        { key: "a1", person: "af", area: "north", shift: "am", state: COMMITTED },
                                        { key: "a2", person: "ry", area: "north", shift: "am", state: COMMITTED },
                                        { key: "a3", person: "ml", area: "north", shift: "night", state: COMMITTED },
                                        { key: "a4", person: "ka", area: "south", shift: "am", state: COMMITTED },
                                        { key: "a5", person: "ti", area: "south", shift: "pm", state: COMMITTED },
                                        { key: "a6", person: "pr", area: "south", shift: "pm", state: COMMITTED },
                                    ]}
                                    assignment={x => ({ key: x.key, person: x.person, area: x.area, shift: x.shift, state: x.state })}
                                    requirements={[
                                        { area: "north", shift: "am", required: 2n }, { area: "north", shift: "pm", required: 1n },
                                        { area: "north", shift: "night", required: 1n }, { area: "south", shift: "am", required: 1n },
                                        { area: "south", shift: "pm", required: 2n }, { area: "south", shift: "night", required: 1n },
                                    ]}
                                    requirement={r => ({ area: r.area, shift: r.shift, required: r.required })}
                                    summary="2 open · 0 over" />
                            ),
                            roster: () => (
                                <Roster id="roster" mode="published" personHeader="Person"
                                    people={[{ key: "af", label: "A.F." }, { key: "ka", label: "K.A." }, { key: "ml", label: "M.L." }]}
                                    person={pe => ({ key: pe.key, label: pe.label })}
                                    shifts={[
                                        { key: "s1", person: "af", day: "Mon", hours: 8n, state: COMMITTED },
                                        { key: "s2", person: "af", day: "Tue", hours: 8n, state: COMMITTED },
                                        { key: "s3", person: "ka", day: "Wed", hours: 6n, state: COMMITTED },
                                        { key: "s4", person: "ml", day: "Thu", hours: 8n, state: COMMITTED },
                                        { key: "s5", person: "ml", day: "Fri", hours: 6n, state: COMMITTED },
                                    ]}
                                    shift={sh => ({ key: sh.key, person: sh.person, day: sh.day, hours: sh.hours, state: sh.state })}
                                    days={["Mon", "Tue", "Wed", "Thu", "Fri"]} />
                            ),
                        }),
                    })}
                    edit={{
                        key: "id", row: "row", span: "span", height: "height",
                        // A component dropped on the grid: its library entry's name, span and kind.
                        create: ($2, card, at) => {
                            const placed = $2.let(library.filter((_$3, c) => c.id.equal(card.key)).get(0n));
                            return { id: at.key, row: at.row, span: placed.span, height: none, name: placed.name, kind: placed.kind };
                        },
                    }}
                    editing={{ onUpdate: tiles.write }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
