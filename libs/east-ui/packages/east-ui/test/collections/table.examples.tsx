/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, OptionType, StringType, example, none, some, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Configurator, HStack, Reactive, SegmentGroup, Separator, Status, Switch, Table, Tag, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const TABLE_CUSTOM_HEADERS_DATA = [
    { firstName: "Alice", lastName: "Smith", dept: "Engineering" },
    { firstName: "Bob", lastName: "Jones", dept: "Marketing" },
];
const TABLE_COMPLEX_COLUMNS_DATA = [
    { name: "Alice", skills: ["TypeScript", "React", "Node"], metadata: { level: "Senior", years: 5n } },
    { name: "Bob", skills: ["Python", "Django"], metadata: { level: "Mid", years: 3n } },
    { name: "Charlie", skills: ["Go", "Rust", "C++", "Java"], metadata: { level: "Senior", years: 8n } },
];
const TABLE_WRAPPING_TAGS_DATA = [
    {
        name: "Server A",
        metrics: new Map<string, number>([["cpu", 45.2], ["mem", 78.5], ["disk", 62.1], ["net", 23.4], ["io", 15.8], ["load", 2.3]]),
    },
    {
        name: "Server B",
        metrics: new Map<string, number>([["cpu", 82.1], ["mem", 91.2], ["disk", 45.0]]),
    },
    {
        name: "Server C",
        metrics: new Map<string, number>([["cpu", 12.5], ["mem", 34.2], ["disk", 88.9], ["net", 56.7], ["io", 78.3], ["load", 1.1], ["temp", 42.0], ["power", 320.5]]),
    },
];
const TABLE_FROZEN_COLUMNS_DATA = East.Array.range(0n, 20n).map((_$, i) => ({
    id: East.str`#${i}`,
    name: East.str`User ${i}`,
    email: East.str`user${i}@example.com`,
    dept: "Engineering",
    role: "Developer",
    location: "Remote",
    status: "Active",
    score: i.multiply(7n),
}));
const TABLE_NESTED_COLUMN_GROUPS_DATA = [
    { dept: "Sales", region: "EMEA", q1: "$120k", q2: "$135k", q3: "$148k", q4: "$162k" },
    { dept: "Sales", region: "APAC", q1: "$95k", q2: "$102k", q3: "$118k", q4: "$130k" },
    { dept: "Marketing", region: "AMER", q1: "$48k", q2: "$52k", q3: "$54k", q4: "$59k" },
];
const TABLE_MULTI_ROW_FOOTER_DATA = [
    { item: "Sandwich", category: "Food", price: 12.50 },
    { item: "Salad", category: "Food", price: 9.00 },
    { item: "Soda", category: "Drink", price: 3.50 },
    { item: "Coffee", category: "Drink", price: 4.50 },
];
const TABLE_WITH_BADGE_DATA = East.Array.range(0n, 1000n).map((_$, i) => ({
    name: East.str`User ${i}`,
    email: East.str`user${i}@example.com`,
    status: i.remainder(4n).equals(0n).ifElse(
        () => "Idle",
        () => i.remainder(7n).equals(0n).ifElse(() => "Failed", () => "Active"),
    ),
}));
const TABLE_SELECTION_DATA = [
    { name: "Alice", role: "Admin" },
    { name: "Bob", role: "User" },
    { name: "Charlie", role: "User" },
    { name: "Diana", role: "Manager" },
    { name: "Eve", role: "User" },
];

export const tableBasic = example({
    keywords: ["Table", "Root", "basic", "header"],
    description: "Simple table with field names",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Table
                data={[
                    { name: "Alice", email: "alice@example.com", role: "Admin" },
                    { name: "Bob", email: "bob@example.com", role: "User" },
                    { name: "Charlie", email: "charlie@example.com", role: "User" },
                ]}
                columns={["name", "email", "role"]}
            />
        );
    }),
    inputs: [],
});

/**
 * Column-system configurator (pass 3, name kept) — the columns axis picks a
 * column preset (custom-header widths, complex columns with the FULL-row
 * render trick, dict-as-wrapping-tags), and the frozen / groups / footer
 * switches preview the structural column mechanics. Column sets are composed
 * at build time, so each axis arm is a prebuilt table (the cardVariants leaf
 * precedent) and the structure switches preview one at a time.
 */
export const tableColumnsVariants = example({
    keywords: ["Table", "Root", "header", "width", "minWidth", "maxWidth", "value", "render", "complex", "array", "struct", "capture", "closure", "rowIndex", "full row", "CellRenderContext", "Dict", "Tag", "wrap", "frozen", "pin", "scroll", "columnGroups", "nested", "category", "header row", "footerRows", "subtotal", "grand total", "multi-row", "groupBy", "rowGroups", "collapse", "aggregate", "P&L", "#317", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Column-system configurator — one columns axis: widths, complex full-row render, wrapping tags, frozen, nested groups, footer rows, nested P&L grouping",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const complexData = $.let(TABLE_COMPLEX_COLUMNS_DATA);
            const metricsData = $.let(TABLE_WRAPPING_TAGS_DATA);
            const columnSets = $.const(["widths", "complex", "tags", "frozen", "groups", "footer", "pnl"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "table_columns_preset", "widths"));
            const cKey = $.let(presetBind.read());
            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));

            const money = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) => (
                <Text width="100%" textAlign="right">{East.Float.printCurrency(ctx.cellValue.unwrap("Float"))}</Text>
            )));
            const moneyTotal = $.const(East.function([Table.Types.Cell], UIComponentType, (_$, v) => (
                <Text width="100%" textAlign="right" fontWeight="semibold">{East.Float.printCurrency(v.unwrap("Float"))}</Text>
            )));

            // One prebuilt table per column mechanic — a single axis, no
            // priority chains: every value previews exactly what it names.
            const preview = $.const(cKey.equal("frozen").ifElse(
                _$ => (
                    <Box width="600px" overflow="hidden">
                        <Table
                            frozen={["id", "name"]}
                            variant="line"
                            striped={true}
                            height="400px"
                            data={TABLE_FROZEN_COLUMNS_DATA}
                            columns={{
                                id: { header: "ID", width: "80px" },
                                name: { header: "Name", width: "150px" },
                                email: { header: "Email", width: "250px" },
                                dept: { header: "Department", width: "150px" },
                                role: { header: "Role", width: "150px" },
                                location: { header: "Location", width: "150px" },
                                status: { header: "Status", width: "120px" },
                                score: { header: "Score", width: "100px" },
                            }}
                        />
                    </Box>
                ),
                _$ => cKey.equal("groups").ifElse(
                    _$ => (
                        <Table
                            variant="outline"
                            showColumnBorder={true}
                            columnGroups={[
                                { label: "Identity", columnKeys: ["dept", "region"] },
                                { label: "First half", columnKeys: ["q1", "q2"] },
                                { label: "Second half", columnKeys: ["q3", "q4"] },
                            ]}
                            data={TABLE_NESTED_COLUMN_GROUPS_DATA}
                            columns={{
                                dept: { header: "Department" },
                                region: { header: "Region" },
                                q1: { header: "Q1" },
                                q2: { header: "Q2" },
                                q3: { header: "Q3" },
                                q4: { header: "Q4" },
                            }}
                        />
                    ),
                    _$ => cKey.equal("pnl").ifElse(
                        // Nested P&L (#317) — groupBy [section, category] folds
                        // accounts into collapsible group rows; sum aggregates
                        // render as currency subtotals on the group headers;
                        // Net income rides footerRows.
                        _$ => (
                            <Table
                                variant="line"
                                data={[
                                    { section: "Revenue", category: "Product sales", account: "Product line A", q1: 210000.0, q2: 232500.0, q3: 198000.0, q4: 251500.0, fy: 892000.0 },
                                    { section: "Revenue", category: "Product sales", account: "Product line B", q1: 118000.0, q2: 141000.0, q3: 122500.0, q4: 133500.0, fy: 515000.0 },
                                    { section: "Revenue", category: "Services", account: "Consulting", q1: 18500.0, q2: 27000.0, q3: 33500.0, q4: 24000.0, fy: 103000.0 },
                                    { section: "Cost of sales", category: "Materials", account: "Raw materials", q1: 62000.0, q2: 58000.0, q3: 44000.0, q4: 71000.0, fy: 235000.0 },
                                    { section: "Cost of sales", category: "Production", account: "Direct labour", q1: 55000.0, q2: 55000.0, q3: 57500.0, q4: 57500.0, fy: 225000.0 },
                                    { section: "Operating expenses", category: "Sales & marketing", account: "Marketing", q1: 19500.0, q2: 22000.0, q3: 30500.0, q4: 28000.0, fy: 100000.0 },
                                    { section: "Operating expenses", category: "Administration", account: "Salaries", q1: 47500.0, q2: 47500.0, q3: 47500.0, q4: 47500.0, fy: 190000.0 },
                                ]}
                                columns={{
                                    account: { header: "Account", width: "220px" },
                                    q1: { header: "Q1", aggregate: "sum", render: money, aggregateRender: moneyTotal },
                                    q2: { header: "Q2", aggregate: "sum", render: money, aggregateRender: moneyTotal },
                                    q3: { header: "Q3", aggregate: "sum", render: money, aggregateRender: moneyTotal },
                                    q4: { header: "Q4", aggregate: "sum", render: money, aggregateRender: moneyTotal },
                                    fy: { header: "FY", aggregate: "sum", render: money, aggregateRender: moneyTotal },
                                }}
                                groupBy={[
                                    r => r.section,
                                    { value: r => r.category, collapsed: true },
                                ]}
                                footerRows={[
                                    {
                                        account: { content: <Text fontWeight="bold">Net income</Text> },
                                        q1: { content: <Text width="100%" textAlign="right" fontWeight="bold">$77,000.00</Text> },
                                        q2: { content: <Text width="100%" textAlign="right" fontWeight="bold">$132,000.00</Text> },
                                        q3: { content: <Text width="100%" textAlign="right" fontWeight="bold">$117,000.00</Text> },
                                        q4: { content: <Text width="100%" textAlign="right" fontWeight="bold">$104,000.00</Text> },
                                        fy: { content: <Text width="100%" textAlign="right" fontWeight="bold">$430,000.00</Text> },
                                    },
                                ]}
                            />
                        ),
                    _$ => cKey.equal("footer").ifElse(
                        _$ => (
                            <Table
                                variant="line"
                                footerBackground="bg.subtle"
                                footerRows={[
                                    {
                                        item: { content: <Text fontWeight="medium">Food subtotal</Text>, colSpan: 2n },
                                        price: { content: <Text>$21.50</Text> },
                                    },
                                    {
                                        item: { content: <Text fontWeight="medium">Drink subtotal</Text>, colSpan: 2n },
                                        price: { content: <Text>$8.00</Text> },
                                    },
                                    {
                                        item: { content: <Text fontWeight="bold">Grand total</Text>, colSpan: 2n },
                                        price: { content: <Text fontWeight="bold">$29.50</Text> },
                                    },
                                ]}
                                data={TABLE_MULTI_ROW_FOOTER_DATA}
                                columns={{
                                    item: { header: "Item" },
                                    category: { header: "Category" },
                                    price: { header: "Price ($)" },
                                }}
                            />
                        ),
                        _$ => cKey.equal("widths").ifElse(
                            _$ => (
                                <Table
                                    data={TABLE_CUSTOM_HEADERS_DATA}
                                    columns={{
                                        firstName: { header: "First Name", width: "300px", minWidth: "80px" },
                                        lastName: { header: "Last Name", width: "150px" },
                                        dept: { header: "Department", minWidth: "100px", maxWidth: "200px" },
                                    }}
                                />
                            ),
                            _$ => cKey.equal("complex").ifElse(
                                _$ => (
                                    <Table
                                        variant="line"
                                        striped={true}
                                        data={complexData}
                                        columns={{
                                            name: { header: "Name" },
                                            skills: {
                                                header: "Skills",
                                                value: (skills) => skills.size(),
                                                render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                                                    // The render context carries only {rowIndex, columnKey, cellValue} —
                                                    // CAPTURE the data array and index ctx.rowIndex for full-row access.
                                                    // Captures must be data or bind-handles, never a UIComponentType value.
                                                    const row = $.let(complexData.get(ctx.rowIndex));
                                                    return (
                                                        <HStack gap="1" wrap="wrap">
                                                            {row.skills.map((_$, s) => <Badge variant="subtle" colorPalette="brand">{s}</Badge>)}
                                                        </HStack>
                                                    );
                                                }),
                                            },
                                            metadata: {
                                                header: "Experience",
                                                value: (meta) => meta.years,
                                                render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                                                    const row = $.let(complexData.get(ctx.rowIndex));
                                                    return <Text>{East.str`${row.metadata.level} (${row.metadata.years} yrs)`}</Text>;
                                                }),
                                            },
                                        }}
                                    />
                                ),
                                _$ => (
                                    <Table
                                        variant="line"
                                        data={metricsData}
                                        columns={{
                                            name: { header: "Server", width: "120px" },
                                            metrics: {
                                                header: "Metrics",
                                                width: "400px",
                                                maxWidth: "400px",
                                                value: (val) => val.map((_$, value) => value).mean(),
                                                render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                                                    const row = $.let(metricsData.get(ctx.rowIndex));
                                                    return (
                                                        <HStack wrap="wrap" gap="1">
                                                            {row.metrics.map((_$, value, key) => <Tag>{East.str`${key}: ${value}`}</Tag>).toArray()}
                                                        </HStack>
                                                    );
                                                }),
                                            },
                                        }}
                                    />
                                ),
                            ),
                        ),
                    ),
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Columns", cKey,
                            <SegmentGroup value={cKey} onChange={onPreset} size="sm"
                                items={columnSets.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Rows", cKey.equal("frozen").ifElse(_$ => "20 · 600px viewport", _$ => "3")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Style configurator (pass 3, name kept) — density, badge and row-height axes
 * plus striped / paginated / row-status switches over one live 1000-row
 * table. The absorbed interactive surface logs every callback to the reactive
 * aside; the paginated switch carries the embedded-pagination contract
 * (`pagination: { pageSize, page, onPageChange }` on the main struct) with
 * its page in State. rowStatus / pagination presence is host-side, so those
 * switches preview prebuilt arms one at a time (priority: paginated > row
 * status > explicit row height > virtualized base).
 */
export const tableStyleVariants = example({
    keywords: ["Table", "Root", "striped", "alternating", "render", "Badge", "CellRenderContext", "density", "compact", "minimal", "rowHeight", "pixel", "override", "virtualization", "rowStatus", "StatusToken", "tint", "theme-agnostic", "Reactive", "State", "onRowClick", "onCellClick", "onSortChange", "interactive", "pagination", "page", "selection", "multiple", "checkbox", "range", "shift-click", "expandedContent", "rich detail", "review", "approve", "reject", "decision", "batch", "rowIndex", "unsliced", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Table style configurator — density and badge axes plus one rows axis: virtual, paginated, status, row heights, fill, multi/range selection, expandable detail and review chrome; callbacks log to the aside",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Bound ONCE — every preview arm maps over the same 1000-row array.
            const badgeData = $.let(TABLE_WITH_BADGE_DATA);
            // Enumerated axes are just their variants — `getTag()` gives the
            // segment key AND its label.
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));
            const badgeVariants = $.const([
                variant("solid", null), variant("subtle", null), variant("outline", null),
            ], ArrayType(Style.Types.StyleVariant));
            const rowModes = $.const(["virtual", "paginated", "status", "row 48", "row 64", "fill", "multi", "range", "detail", "review", "review paged"], ArrayType(StringType));

            const stripedBind = $.let(State.bind([BooleanType], "table_striped", true));
            const densityBind = $.let(State.bind([StringType], "table_density", "compact"));
            const badgeBind = $.let(State.bind([StringType], "table_badge", "solid"));
            const rowsBind = $.let(State.bind([StringType], "table_rows", "virtual"));
            const pageBind = $.let(State.bind([IntegerType], "table_page", 0n));
            const lastEventBind = $.let(State.bind([StringType], "table_last_event", ""));

            const stripedOn = $.let(stripedBind.read());
            const dKey = $.let(densityBind.read());
            const bKey = $.let(badgeBind.read());
            const rKey = $.let(rowsBind.read());
            const page = $.let(pageBind.read());
            const lastEvent = $.let(lastEventBind.read());

            const onStriped = $.const(East.function([BooleanType], NullType, ($, next) => { $(stripedBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onBadge = $.const(East.function([StringType], NullType, ($, next) => { $(badgeBind.write(next)); }));
            const onRows = $.const(East.function([StringType], NullType, ($, next) => { $(rowsBind.write(next)); }));
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));

            // The absorbed interactive surface — every callback writes the
            // event line the aside shows.
            const onRowClick = $.const(East.function([Table.Types.RowClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onRowClick: row ${event.rowIndex}`));
            }));
            const onRowDoubleClick = $.const(East.function([Table.Types.RowClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onRowDoubleClick: row ${event.rowIndex}`));
            }));
            const onCellClick = $.const(East.function([Table.Types.CellClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onCellClick: row ${event.rowIndex}, col ${event.columnKey}`));
            }));
            const onCellDoubleClick = $.const(East.function([Table.Types.CellClickEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onCellDoubleClick: row ${event.rowIndex}, col ${event.columnKey}`));
            }));
            const onRowSelectionChange = $.const(East.function([Table.Types.RowSelectionEvent], NullType, ($, event) => {
                $(lastEventBind.write(
                    event.selected.ifElse(
                        _$ => East.str`onRowSelectionChange: selected row ${event.rowIndex}`,
                        _$ => East.str`onRowSelectionChange: deselected row ${event.rowIndex}`,
                    ),
                ));
            }));
            const onSortChange = $.const(East.function([Table.Types.SortEvent], NullType, ($, event) => {
                $(lastEventBind.write(East.str`onSortChange: ${event.columnKey} - ${event.sortDirection.getTag()}`));
            }));

            // ROW STATUS — a semantic token per row index (theme-agnostic tint).
            const rowStatus = $.const(East.function([IntegerType], Style.Types.StatusToken, ($, rowIndex) => {
                const bucket = $.let(rowIndex.modulo(3n), IntegerType);
                return bucket.equals(0n).ifElse(
                    $ => Style.StatusToken("success"),
                    $ => bucket.equals(1n).ifElse(
                        $ => Style.StatusToken("warning"),
                        $ => Style.StatusToken("danger"),
                    ),
                );
            }));

            // Each selection is a lookup into the same array the control renders.
            const densitySel = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
            const badgeSel = $.let(badgeVariants.filter((_$, v) => v.getTag().equal(bKey)).get(0n));
            const rhPx = $.let(rKey.equal("row 48").ifElse(_$ => 48n, _$ => 64n));

            // The badge axis drives the status column's render live — the
            // render captures only data (the selected variant value).
            const badgeRender = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) => (
                <Badge variant={badgeSel} colorPalette="brand">{ctx.cellValue.match({ String: (_$2, v) => v }, _$2 => "")}</Badge>
            )));

            // FILL (#320, absorbed tableFill) — height="fill" resolves against
            // the bounded Box; striped / density stay live.
            const fillArm = $.const(
                <Box height="220px">
                    <Table
                        variant="line"
                        striped={stripedOn}
                        density={densitySel}
                        height="fill"
                        data={badgeData}
                        columns={{
                            name: { header: "Name" },
                            email: { header: "Email" },
                            status: { header: "Status", render: badgeRender },
                        }}
                    />
                </Box>,
            );

            // SELECTION (absorbed tableSelection) — each mode mirrors its own
            // State array, so switching arms preserves each mode's selection.
            const multiBind = $.let(State.bind([ArrayType(IntegerType)], "table_multi_selected", []));
            const multiSelected = $.let(multiBind.read(), ArrayType(IntegerType));
            const rangeBind = $.let(State.bind([ArrayType(IntegerType)], "table_range_selected", []));
            const rangeSelected = $.let(rangeBind.read(), ArrayType(IntegerType));
            const onMultiChange = $.const(East.function([ArrayType(IntegerType)], NullType, ($, next) => {
                $(multiBind.write(next));
            }));
            const onRangeChange = $.const(East.function([ArrayType(IntegerType)], NullType, ($, next) => {
                $(rangeBind.write(next));
            }));
            const multiArm = $.const(
                <Table
                    variant="line"
                    striped={stripedOn}
                    density={densitySel}
                    selection={{ mode: "multiple", selected: multiSelected, onChange: onMultiChange }}
                    selectedBackground="bg.brand.subtle"
                    selectedBorderColor="border.brand"
                    data={TABLE_SELECTION_DATA}
                    columns={{ name: { header: "Name" }, role: { header: "Role" } }}
                />,
            );
            const rangeArm = $.const(
                <Table
                    variant="line"
                    striped={stripedOn}
                    density={densitySel}
                    selection={{ mode: "range", selected: rangeSelected, onChange: onRangeChange }}
                    selectedBackground="bg.info.subtle"
                    selectedBorderColor="border.subtle"
                    data={TABLE_SELECTION_DATA}
                    columns={{ name: { header: "Name" }, role: { header: "Role" } }}
                />,
            );

            // DETAIL (absorbed tableExpandedRichDetail) — expandable rows with
            // rich content nested in the detail panel.
            const detailRows = $.const([
                { name: "Alice", revenue: 142000n, deals: 18n, region: "EMEA" },
                { name: "Bob", revenue: 98000n, deals: 12n, region: "APAC" },
                { name: "Charlie", revenue: 215000n, deals: 24n, region: "AMER" },
            ]);
            const detailArm = $.const(
                <Table
                    variant="line"
                    striped={stripedOn}
                    density={densitySel}
                    expandedContent={East.function([IntegerType], UIComponentType, ($, rowIndex) => {
                        const row = $.let(detailRows.get(rowIndex));
                        return (
                            <Box padding="4" background="bg.subtle">
                                <HStack gap="8">
                                    <VStack gap="1">
                                        <Text textStyle="caption" color="fg.muted">Revenue</Text>
                                        <Text textStyle="heading-md" fontWeight="bold">{East.str`$${row.revenue}`}</Text>
                                    </VStack>
                                    <VStack gap="1">
                                        <Text textStyle="caption" color="fg.muted">Deals closed</Text>
                                        <Text textStyle="heading-md" fontWeight="bold">{East.str`${row.deals}`}</Text>
                                    </VStack>
                                    <VStack gap="1">
                                        <Text textStyle="caption" color="fg.muted">Region</Text>
                                        <Badge variant="subtle" colorPalette="brand">{row.region}</Badge>
                                    </VStack>
                                </HStack>
                            </Box>
                        );
                    })}
                    data={detailRows}
                    columns={{ name: { header: "Sales rep" }, region: { header: "Region" } }}
                />,
            );

            // REVIEW (absorbed tableReview) — per-row Decision column +
            // commitBar foot; the paged arm keeps unsliced rowIndex semantics.
            const flagged = $.const(East.function([IntegerType], BooleanType, (_$, rowIndex) =>
                rowIndex.modulo(3n).equals(1n)));
            const reviewStatus = $.const(East.function([IntegerType], OptionType(Status.Types.Value), ($, rowIndex) =>
                flagged(rowIndex).ifElse(
                    _$ => East.value(some(variant("warning", null)), OptionType(Status.Types.Value)),
                    _$ => East.value(none, OptionType(Status.Types.Value)),
                )));
            const reviewApproval = $.const(East.function([IntegerType], OptionType(Table.Types.Approval), ($, rowIndex) =>
                flagged(rowIndex).ifElse(
                    _$ => East.value(some(variant("pending", null)), OptionType(Table.Types.Approval)),
                    _$ => East.value(some(variant("approved", null)), OptionType(Table.Types.Approval)),
                )));
            const onApprove = $.const(East.function([Table.Types.ApproveEvent], NullType, _$ => null));
            const onReject = $.const(East.function([Table.Types.ApproveEvent], NullType, _$ => null));
            const onApproveAll = $.const(East.function([], NullType, _$ => null));
            const onRejectAll = $.const(East.function([], NullType, _$ => null));
            const onRerun = $.const(East.function([], NullType, _$ => null));
            const reviewArm = $.const(
                <Table
                    variant="line"
                    striped={stripedOn}
                    density={densitySel}
                    data={East.Array.range(0n, 6n).map((_$, i) => ({
                        order: East.str`SO-10${i}`,
                        exception: i.modulo(3n).equals(1n).ifElse(_$ => "margin below floor", _$ => "—"),
                        value: i.multiply(1250n),
                    }))}
                    columns={{ order: { header: "Order" }, exception: { header: "Exception" }, value: { header: "Value" } }}
                    review={{
                        columnLabel: "Decision",
                        rerunLabel: "Rerun",
                        summary: <Text color="fg.muted">6 orders · 2 exceptions need a call</Text>,
                        onApprove: onApprove,
                        onReject: onReject,
                        onApproveAll: onApproveAll,
                        onRejectAll: onRejectAll,
                        onRerun: onRerun,
                    }}
                    reviewStatus={reviewStatus}
                    reviewApproval={reviewApproval}
                />,
            );
            const reviewPageBind = $.let(State.bind([IntegerType], "table_review_page", 1n));
            const reviewPage = $.let(reviewPageBind.read());
            const onReviewPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(reviewPageBind.write(next));
            }));
            const reviewLastBind = $.let(State.bind([StringType], "table_review_last", "none yet"));
            const onApprovePaged = $.const(East.function([Table.Types.ApproveEvent], NullType, ($, ev) => {
                $(reviewLastBind.write(East.str`approved rowIndex ${East.print(ev.rowIndex)}`));
            }));
            const reviewApprovalPaged = $.const(East.function([IntegerType], OptionType(Table.Types.Approval), (_$, _rowIndex) =>
                some(variant("pending", null))));
            const reviewLast = $.let(reviewLastBind.read());
            const reviewPagedArm = $.const(
                <Table
                    variant="line"
                    striped={stripedOn}
                    density={densitySel}
                    pagination={{ pageSize: 20n, page: reviewPage, onPageChange: onReviewPageChange }}
                    data={East.Array.range(0n, 200n).map((_$, i) => ({
                        id: East.str`#${i}`,
                        name: East.str`Order ${i}`,
                    }))}
                    columns={{ id: { header: "ID" }, name: { header: "Name" } }}
                    review={{ onApprove: onApprovePaged, onApproveAll: onApproveAll }}
                    reviewApproval={reviewApprovalPaged}
                />,
            );

            // Row-mode presence (pagination / rowStatus / explicit height /
            // bounded fill) is host-side, so the axis picks between prebuilt
            // tables; striped / density / badge stay live in every arm.
            const preview = $.const(rKey.equal("paginated").ifElse(
                _$ => (
                    <Table
                        variant="line"
                        interactive={true}
                        striped={stripedOn}
                        density={densitySel}
                        pagination={{ pageSize: 20n, page, onPageChange }}
                        onRowClick={onRowClick}
                        onRowDoubleClick={onRowDoubleClick}
                        onCellClick={onCellClick}
                        onCellDoubleClick={onCellDoubleClick}
                        onRowSelectionChange={onRowSelectionChange}
                        onSortChange={onSortChange}
                        data={badgeData}
                        columns={{
                            name: { header: "Name" },
                            email: { header: "Email" },
                            status: { header: "Status", render: badgeRender },
                        }}
                    />
                ),
                _$ => rKey.equal("status").ifElse(
                    _$ => (
                        <Table
                            variant="line"
                            interactive={true}
                            striped={stripedOn}
                            density={densitySel}
                            rowStatus={rowStatus}
                            height="400px"
                            onRowClick={onRowClick}
                            onRowDoubleClick={onRowDoubleClick}
                            onCellClick={onCellClick}
                            onCellDoubleClick={onCellDoubleClick}
                            onRowSelectionChange={onRowSelectionChange}
                            onSortChange={onSortChange}
                            data={badgeData}
                            columns={{
                                name: { header: "Name" },
                                email: { header: "Email" },
                                status: { header: "Status", render: badgeRender },
                            }}
                        />
                    ),
                    _$ => rKey.equal("virtual").ifElse(
                        _$ => (
                            <Table
                                variant="line"
                                interactive={true}
                                striped={stripedOn}
                                density={densitySel}
                                height="400px"
                                onRowClick={onRowClick}
                                onRowDoubleClick={onRowDoubleClick}
                                onCellClick={onCellClick}
                                onCellDoubleClick={onCellDoubleClick}
                                onRowSelectionChange={onRowSelectionChange}
                                onSortChange={onSortChange}
                                data={badgeData}
                                columns={{
                                    name: { header: "Name" },
                                    email: { header: "Email" },
                                    status: { header: "Status", render: badgeRender },
                                }}
                            />
                        ),
                        _$ => rKey.equal("fill").ifElse(
                            _$ => fillArm,
                            _$ => rKey.equal("multi").ifElse(
                                _$ => multiArm,
                                _$ => rKey.equal("range").ifElse(
                                    _$ => rangeArm,
                                    _$ => rKey.equal("detail").ifElse(
                                        _$ => detailArm,
                                        _$ => rKey.equal("review").ifElse(
                                            _$ => reviewArm,
                                            _$ => rKey.equal("review paged").ifElse(
                                                _$ => reviewPagedArm,
                                                _$ => (
                            <Table
                                variant="line"
                                interactive={true}
                                striped={stripedOn}
                                density={densitySel}
                                rowHeight={rhPx}
                                height="400px"
                                onRowClick={onRowClick}
                                onRowDoubleClick={onRowDoubleClick}
                                onCellClick={onCellClick}
                                onCellDoubleClick={onCellDoubleClick}
                                onRowSelectionChange={onRowSelectionChange}
                                onSortChange={onSortChange}
                                data={badgeData}
                                columns={{
                                    name: { header: "Name" },
                                    email: { header: "Email" },
                                    status: { header: "Status", render: badgeRender },
                                }}
                            />
                        ),
                                            ),
                                            ),
                                        ),
                                    ),
                                ),
                        ),
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Badge (status col)", bKey,
                            <SegmentGroup value={bKey} onChange={onBadge} size="sm"
                                items={badgeVariants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Rows", rKey,
                            <SegmentGroup value={rKey} onChange={onRows} size="sm"
                                items={rowModes.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        Configurator.Slot("Chrome",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={stripedOn} label="Striped" onChange={onStriped} />
                            </HStack>),
                    ]}
                    preview={preview}
                    aside={{
                        label: "Events · Reactive",
                        body: (
                            <Badge colorPalette="brand" variant="outline">
                                {East.equal(lastEvent.length(), 0n).ifElse(_$ => "Interact with the table", _$ => lastEvent)}
                            </Badge>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Selected", East.str`${East.print(multiSelected.size())} · range ${East.print(rangeSelected.size())}`),
                        Configurator.Spec("Approvals", reviewLast),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
