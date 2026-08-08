/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, OptionType, StringType, example, none, some, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Configurator, HStack, Input, Reactive, SegmentGroup, Status, Switch, Table, Tag, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures (consolidation epic #455, pass 5 — one live instance
// per configurator; column systems and presence-typed chrome are their own
// examples).
// ============================================================================

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
 * Rich column system in ONE table — explicit widths, a full-row render (the
 * `ctx.rowIndex` capture convention), a struct-derived value column and a
 * dict column wrapping into tags.
 */
export const tableRichColumns = example({
    keywords: ["Table", "Root", "header", "width", "minWidth", "maxWidth", "value", "render", "complex", "array", "struct", "capture", "closure", "rowIndex", "full row", "CellRenderContext", "Dict", "Tag", "wrap"],
    description: "Rich columns — widths, full-row renders, struct values and a dict column wrapping into tags on one table",
    fn: East.function([], UIComponentType, ($) => {
        const TABLE_RICH_COLUMNS_DATA = [
            {
                name: "Alice",
                skills: ["TypeScript", "React", "Node"],
                metadata: { level: "Senior", years: 5n },
                metrics: new Map<string, number>([["cpu", 45.2], ["mem", 78.5], ["disk", 62.1], ["net", 23.4]]),
            },
            {
                name: "Bob",
                skills: ["Python", "Django"],
                metadata: { level: "Mid", years: 3n },
                metrics: new Map<string, number>([["cpu", 82.1], ["mem", 91.2], ["disk", 45.0]]),
            },
            {
                name: "Charlie",
                skills: ["Go", "Rust", "C++", "Java"],
                metadata: { level: "Senior", years: 8n },
                metrics: new Map<string, number>([["cpu", 12.5], ["mem", 34.2], ["disk", 88.9], ["net", 56.7], ["io", 78.3]]),
            },
        ];
        const rows = $.let(TABLE_RICH_COLUMNS_DATA);
        const skillsRender = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
            // The render context carries only {rowIndex, columnKey, cellValue} —
            // CAPTURE the data array and index ctx.rowIndex for full-row access.
            // Captures must be data or bind-handles, never a UIComponentType value.
            const row = $.let(rows.get(ctx.rowIndex));
            return (
                <HStack gap="1" wrap="wrap">
                    {row.skills.map((_$, s) => <Badge variant="subtle" colorPalette="brand">{s}</Badge>)}
                </HStack>
            );
        }));
        const experienceRender = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
            const row = $.let(rows.get(ctx.rowIndex));
            return <Text>{East.str`${row.metadata.level} (${row.metadata.years} yrs)`}</Text>;
        }));
        const metricsRender = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
            const row = $.let(rows.get(ctx.rowIndex));
            return (
                <HStack wrap="wrap" gap="1">
                    {row.metrics.map((_$, value, key) => <Tag>{East.str`${key}: ${value}`}</Tag>).toArray()}
                </HStack>
            );
        }));
        return (
            <Table
                variant="line"
                striped={true}
                data={rows}
                columns={{
                    name: { header: "Name", width: "140px", minWidth: "80px" },
                    skills: { header: "Skills", value: (skills) => skills.size(), render: skillsRender },
                    metadata: { header: "Experience", value: (meta) => meta.years, render: experienceRender },
                    metrics: { header: "Metrics", width: "320px", maxWidth: "320px", value: (val) => val.map((_$, value) => value).mean(), render: metricsRender },
                }}
            />
        );
    }),
    inputs: [],
});

/** Frozen columns pin left while the rest scroll inside a bounded viewport. */
export const tableFrozen = example({
    keywords: ["Table", "Root", "frozen", "pin", "scroll", "width", "virtualization"],
    description: "Frozen id + name columns pin left while six more columns scroll in a 600px viewport",
    fn: East.function([], UIComponentType, (_$) => {
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
        return (
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
    );
    }),
    inputs: [],
});

/** Nested header groups + footer rows composed on one table. */
export const tableGroupedColumns = example({
    keywords: ["Table", "Root", "columnGroups", "nested", "category", "header row", "footerRows", "footer", "subtotal", "grand total", "colSpan", "showColumnBorder"],
    description: "Column groups band the quarters while footer rows carry the FY totals — one table",
    fn: East.function([], UIComponentType, (_$) => {
        const TABLE_NESTED_COLUMN_GROUPS_DATA = [
            { dept: "Sales", region: "EMEA", q1: "$120k", q2: "$135k", q3: "$148k", q4: "$162k" },
            { dept: "Sales", region: "APAC", q1: "$95k", q2: "$102k", q3: "$118k", q4: "$130k" },
            { dept: "Marketing", region: "AMER", q1: "$48k", q2: "$52k", q3: "$54k", q4: "$59k" },
        ];
        return (
        <Table
            variant="outline"
            showColumnBorder={true}
            footerBackground="bg.subtle"
            columnGroups={[
                { label: "Identity", columnKeys: ["dept", "region"] },
                { label: "First half", columnKeys: ["q1", "q2"] },
                { label: "Second half", columnKeys: ["q3", "q4"] },
            ]}
            footerRows={[
                {
                    dept: { content: <Text fontWeight="bold">FY total</Text>, colSpan: 2n },
                    q1: { content: <Text fontWeight="bold">$263k</Text> },
                    q2: { content: <Text fontWeight="bold">$289k</Text> },
                    q3: { content: <Text fontWeight="bold">$320k</Text> },
                    q4: { content: <Text fontWeight="bold">$351k</Text> },
                },
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
    );
    }),
    inputs: [],
});

/**
 * Nested P&L (#317) — groupBy [section, category] folds accounts into
 * collapsible group rows; sum aggregates render as currency subtotals on the
 * group headers; Net income rides footerRows.
 */
export const tablePnl = example({
    keywords: ["Table", "Root", "groupBy", "rowGroups", "collapse", "aggregate", "sum", "aggregateRender", "P&L", "#317", "footerRows"],
    description: "Nested P&L — two-level row grouping with currency subtotals and a Net income footer",
    fn: East.function([], UIComponentType, ($) => {
        const money = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) => (
            <Text width="100%" textAlign="right">{East.Float.printCurrency(ctx.cellValue.unwrap("Float"))}</Text>
        )));
        const moneyTotal = $.const(East.function([Table.Types.Cell], UIComponentType, (_$, v) => (
            <Text width="100%" textAlign="right" fontWeight="semibold">{East.Float.printCurrency(v.unwrap("Float"))}</Text>
        )));
        return (
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
        );
    }),
    inputs: [],
});

/**
 * THE Table configurator (pass 5) — ONE live 1000-row table; every axis is an
 * expression-fed prop on that single instance: density, striped, selection
 * mode, a row-height dial and a size mode (auto / scroll / fill — an empty
 * height reads as unbounded, so the sizing contracts need no second table).
 * Row status tint, the status badge column and the full callback surface are
 * composed on, with every event logging to the reactive aside.
 */
export const tableVariants = example({
    keywords: ["Table", "Root", "striped", "alternating", "render", "Badge", "CellRenderContext", "density", "rowHeight", "pixel", "override", "virtualization", "rowStatus", "StatusToken", "tint", "theme-agnostic", "Reactive", "State", "onRowClick", "onCellClick", "onSortChange", "interactive", "selection", "single", "multiple", "checkbox", "range", "shift-click", "fill", "scroll", "height", "#320", "SegmentGroup", "Input", "Switch", "Configurator", "getTag", "configurator"],
    description: "Table configurator — density, striped, selection mode, row-height dial and size mode (auto / scroll / fill) all expression-fed into one live 1000-row table; callbacks log to the aside",
    fn: East.function([], UIComponentType, (_$) => {
        const TABLE_WITH_BADGE_DATA = East.Array.range(0n, 1000n).map((_$, i) => ({
            name: East.str`User ${i}`,
            email: East.str`user${i}@example.com`,
            status: i.remainder(4n).equals(0n).ifElse(
                () => "Idle",
                () => i.remainder(7n).equals(0n).ifElse(() => "Failed", () => "Active"),
            ),
        }));
        return (
        <Reactive>{$ => {
            const badgeData = $.let(TABLE_WITH_BADGE_DATA);
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));
            const selectionModes = $.const([
                variant("single", null), variant("multiple", null), variant("range", null),
            ], ArrayType(Table.Types.SelectionMode));
            const sizeModes = $.const(["auto", "scroll", "fill"], ArrayType(StringType));

            const stripedBind = $.let(State.bind([BooleanType], "table_striped", true));
            const densityBind = $.let(State.bind([StringType], "table_density", "compact"));
            const selModeBind = $.let(State.bind([StringType], "table_selection_mode", "single"));
            const selectedBind = $.let(State.bind([ArrayType(IntegerType)], "table_selected", []));
            const sizeBind = $.let(State.bind([StringType], "table_size", "scroll"));
            const rowHeightBind = $.let(State.bind([IntegerType], "table_row_height", 36n));
            const lastEventBind = $.let(State.bind([StringType], "table_last_event", ""));

            const stripedOn = $.let(stripedBind.read());
            const dKey = $.let(densityBind.read());
            const mKey = $.let(selModeBind.read());
            const selected = $.let(selectedBind.read(), ArrayType(IntegerType));
            const sKey = $.let(sizeBind.read());
            const rowH = $.let(rowHeightBind.read());
            const lastEvent = $.let(lastEventBind.read());

            const onStriped = $.const(East.function([BooleanType], NullType, ($, next) => { $(stripedBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onSelMode = $.const(East.function([StringType], NullType, ($, next) => { $(selModeBind.write(next)); }));
            const onSelected = $.const(East.function([ArrayType(IntegerType)], NullType, ($, next) => { $(selectedBind.write(next)); }));
            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onRowHeight = $.const(East.function([IntegerType], NullType, ($, next) => { $(rowHeightBind.write(next)); }));

            // The interactive surface — every callback writes the event line
            // the aside shows.
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

            // A fixed badge render for the status column — badge STYLING is the
            // Badge configurator's axis, not a table feature.
            const badgeRender = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) => (
                <Badge variant="solid" colorPalette="brand">{ctx.cellValue.match({ String: (_$2, v) => v }, _$2 => "")}</Badge>
            )));

            // Each selection is a lookup into the same array the control renders.
            const densitySel = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
            const modeSel = $.let(selectionModes.filter((_$, v) => v.getTag().equal(mKey)).get(0n));

            // Size mode — an empty height string reads as "unbounded", so ONE
            // table covers auto / scroll / fill; the wrapper Box only bounds in
            // fill mode (an empty Box height is a no-op).
            const boxHeight = $.let(sKey.equal("fill").ifElse(_$ => "220px", _$ => ""));
            const tableHeight = $.let(sKey.equal("scroll").ifElse(
                _$ => "360px",
                _$ => sKey.equal("fill").ifElse(_$ => "fill", _$ => ""),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Selection", mKey,
                            <SegmentGroup value={mKey} onChange={onSelMode} size="sm"
                                items={selectionModes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizeModes.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                        Configurator.Control("Row height", East.print(rowH),
                            <Input.Integer value={rowH} min={28n} max={72n} step={4n} size="sm" onChange={onRowHeight} />),
                        Configurator.Slot("Chrome",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={stripedOn} label="Striped" onChange={onStriped} />
                            </HStack>),
                    ]}
                    preview={
                        <Box width="100%" height={boxHeight} overflow="hidden">
                            <Table
                                variant="line"
                                interactive={true}
                                striped={stripedOn}
                                density={densitySel}
                                rowHeight={rowH}
                                rowStatus={rowStatus}
                                height={tableHeight}
                                selection={{ mode: modeSel, selected, onChange: onSelected }}
                                selectedBackground="bg.brand.subtle"
                                selectedBorderColor="border.brand"
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
                        </Box>
                    }
                    aside={{
                        label: "Events · Reactive",
                        body: (
                            <Badge colorPalette="brand" variant="outline">
                                {East.equal(lastEvent.length(), 0n).ifElse(_$ => "Interact with the table", _$ => lastEvent)}
                            </Badge>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Selected", East.print(selected.size())),
                        Configurator.Spec("Rows", "1000 · virtualized"),
                    ]}
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});

/**
 * Embedded pagination (`pagination: { pageSize, page, onPageChange }` on the
 * main struct) — presence-typed, so it is its own configurator; the page-size
 * dial and density feed the one live pager-table.
 */
export const tablePaginated = example({
    keywords: ["Table", "Root", "pagination", "page", "pageSize", "onPageChange", "Reactive", "State", "density", "Input", "Integer", "Configurator", "configurator"],
    description: "Paginated table configurator — a page-size dial and density on one live 1000-row pager; the page lives in State",
    fn: East.function([], UIComponentType, (_$) => {
        const TABLE_WITH_BADGE_DATA = East.Array.range(0n, 1000n).map((_$, i) => ({
            name: East.str`User ${i}`,
            email: East.str`user${i}@example.com`,
            status: i.remainder(4n).equals(0n).ifElse(
                () => "Idle",
                () => i.remainder(7n).equals(0n).ifElse(() => "Failed", () => "Active"),
            ),
        }));
        return (
        <Reactive>{$ => {
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));

            const densityBind = $.let(State.bind([StringType], "table_paginated_density", "compact"));
            const pageBind = $.let(State.bind([IntegerType], "table_page", 0n));
            const pageSizeBind = $.let(State.bind([IntegerType], "table_page_size", 20n));

            const dKey = $.let(densityBind.read());
            const page = $.let(pageBind.read());
            const pageSize = $.let(pageSizeBind.read());

            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => { $(pageBind.write(next)); }));
            const onPageSize = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageSizeBind.write(next));
                $(pageBind.write(0n));
            }));

            const densitySel = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Page size", East.print(pageSize),
                            <Input.Integer value={pageSize} min={10n} max={100n} step={10n} size="sm" onChange={onPageSize} />),
                    ]}
                    preview={
                        <Table
                            variant="line"
                            striped={true}
                            density={densitySel}
                            pagination={{ pageSize, page, onPageChange }}
                            data={TABLE_WITH_BADGE_DATA}
                            columns={{ name: { header: "Name" }, email: { header: "Email" }, status: { header: "Status" } }}
                        />
                    }
                    spec={[
                        Configurator.Spec("Page", East.str`${East.print(page.add(1n))} of ${East.print(East.value(1000n, IntegerType).add(pageSize).subtract(1n).divide(pageSize))}`),
                    ]}
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});

/** Expandable rows — `expandedContent` renders a rich detail panel per row. */
export const tableExpandable = example({
    keywords: ["Table", "Root", "expandedContent", "expand", "rich detail", "rowIndex", "capture"],
    description: "Expandable rows — clicking a row opens a rich detail panel rendered by expandedContent",
    fn: East.function([], UIComponentType, ($) => {
        const detailRows = $.const([
            { name: "Alice", revenue: 142000n, deals: 18n, region: "EMEA" },
            { name: "Bob", revenue: 98000n, deals: 12n, region: "APAC" },
            { name: "Charlie", revenue: 215000n, deals: 24n, region: "AMER" },
        ]);
        const detailContent = $.const(East.function([IntegerType], UIComponentType, ($, rowIndex) => {
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
        }));
        return (
            <Table
                variant="line"
                striped={true}
                expandedContent={detailContent}
                data={detailRows}
                columns={{ name: { header: "Sales rep" }, region: { header: "Region" } }}
            />
        );
    }),
    inputs: [],
});

/**
 * Review chrome COMPOSED with pagination — the per-row Decision column, the
 * commitBar foot and page-stable `rowIndex` semantics (#unsliced) on one
 * table; approvals log beneath it.
 */
export const tableReview = example({
    keywords: ["Table", "Root", "review", "approve", "reject", "decision", "batch", "commitBar", "rerun", "rowIndex", "unsliced", "pagination", "Reactive", "State", "Status"],
    description: "Review table — Decision column + commit bar composed with pagination; approvals report the unsliced rowIndex",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([IntegerType], "table_review_page", 0n));
            const page = $.let(pageBind.read());
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => { $(pageBind.write(next)); }));
            const lastBind = $.let(State.bind([StringType], "table_review_last", "none yet"));
            const last = $.let(lastBind.read());

            const flagged = $.const(East.function([IntegerType], BooleanType, (_$, rowIndex) =>
                rowIndex.modulo(3n).equals(1n)));
            const reviewStatus = $.const(East.function([IntegerType], OptionType(Status.Types.Value), ($, rowIndex) =>
                flagged(rowIndex).ifElse(
                    _$ => some(variant("warning", null)),
                    _$ => East.value(none, OptionType(Status.Types.Value)),
                )));
            const reviewApproval = $.const(East.function([IntegerType], OptionType(Table.Types.Approval), ($, rowIndex) =>
                flagged(rowIndex).ifElse(
                    _$ => some(variant("pending", null)),
                    _$ => East.value(some(variant("approved", null)), OptionType(Table.Types.Approval)),
                )));
            const onApprove = $.const(East.function([Table.Types.ApproveEvent], NullType, ($, ev) => {
                $(lastBind.write(East.str`approved rowIndex ${East.print(ev.rowIndex)}`));
            }));
            const onReject = $.const(East.function([Table.Types.ApproveEvent], NullType, ($, ev) => {
                $(lastBind.write(East.str`rejected rowIndex ${East.print(ev.rowIndex)}`));
            }));
            const onApproveAll = $.const(East.function([], NullType, $ => { $(lastBind.write("approved all")); }));
            const onRejectAll = $.const(East.function([], NullType, $ => { $(lastBind.write("rejected all")); }));
            const onRerun = $.const(East.function([], NullType, $ => { $(lastBind.write("rerun requested")); }));

            return (
                <VStack gap="3" align="stretch">
                    <Table
                        variant="line"
                        striped={true}
                        pagination={{ pageSize: 20n, page, onPageChange }}
                        data={East.Array.range(0n, 200n).map((_$, i) => ({
                            order: East.str`SO-${i.add(100n)}`,
                            exception: i.modulo(3n).equals(1n).ifElse(_$ => "margin below floor", _$ => "—"),
                            value: i.multiply(1250n),
                        }))}
                        columns={{ order: { header: "Order" }, exception: { header: "Exception" }, value: { header: "Value" } }}
                        review={{
                            columnLabel: "Decision",
                            rerunLabel: "Rerun",
                            summary: <Text color="fg.muted">200 orders · a third need a call</Text>,
                            onApprove: onApprove,
                            onReject: onReject,
                            onApproveAll: onApproveAll,
                            onRejectAll: onRejectAll,
                            onRerun: onRerun,
                        }}
                        reviewStatus={reviewStatus}
                        reviewApproval={reviewApproval}
                    />
                    <Text.MonoLabel>{East.str`LAST DECISION · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
