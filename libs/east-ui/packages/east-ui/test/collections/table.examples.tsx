/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, OptionType, StringType, example, none, some, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Card, Badge, Box, HStack, Reactive, Status, Table, Tag, Text, VStack } from "@elaraai/east-ui";

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

export const tableCustomHeaders = example({
    keywords: ["Table", "Root", "header", "width", "minWidth", "maxWidth"],
    description: "Object config with custom column headers and widths",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Table
                data={[
                    { firstName: "Alice", lastName: "Smith", dept: "Engineering" },
                    { firstName: "Bob", lastName: "Jones", dept: "Marketing" },
                ]}
                columns={{
                    firstName: { header: "First Name", width: "300px", minWidth: "80px" },
                    lastName: { header: "Last Name", width: "150px" },
                    dept: { header: "Department", minWidth: "100px", maxWidth: "200px" },
                }}
            />
        );
    }),
    inputs: [],
});

export const tableStriped = example({
    keywords: ["Table", "Root", "striped", "alternating"],
    description: "Alternating row colors for readability",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Table
                striped={true}
                data={[
                    { product: "Widget A", price: "$29.99", stock: 150n },
                    { product: "Widget B", price: "$49.99", stock: 75n },
                    { product: "Widget C", price: "$19.99", stock: 200n },
                    { product: "Widget D", price: "$39.99", stock: 50n },
                ]}
                columns={{
                    product: { header: "Product" },
                    price: { header: "Price" },
                    stock: { header: "In Stock" },
                }}
            />
        );
    }),
    inputs: [],
});

export const tableWithBadge = example({
    keywords: ["Table", "Root", "render", "Badge", "CellRenderContext"],
    description: "Using Badge for status column",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Table
                variant="line"
                height="400px"
                data={East.Array.range(0n, 1000n).map((_$, i) => ({
                    name: East.str`User ${i}`,
                    email: East.str`user${i}@example.com`,
                    status: "Active",
                }))}
                columns={{
                    name: { header: "Name" },
                    email: { header: "Email" },
                    status: {
                        header: "Status",
                        render: East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) => (
                            <Badge variant="solid" colorPalette="blue">{ctx.cellValue.match({ String: (_$2, v) => v }, _$2 => "")}</Badge>
                        )),
                    },
                }}
            />
        );
    }),
    inputs: [],
});

export const tableComplexColumns = example({
    keywords: ["Table", "Root", "value", "render", "complex", "array", "struct", "capture", "closure", "rowIndex", "full row", "CellRenderContext"],
    description: "Array and struct fields with value functions for sorting; render reaches the FULL row by capturing the data array and indexing ctx.rowIndex",
    fn: East.function([], UIComponentType, ($) => {
        const complexData = $.let([
            { name: "Alice", skills: ["TypeScript", "React", "Node"], metadata: { level: "Senior", years: 5n } },
            { name: "Bob", skills: ["Python", "Django"], metadata: { level: "Mid", years: 3n } },
            { name: "Charlie", skills: ["Go", "Rust", "C++", "Java"], metadata: { level: "Senior", years: 8n } },
        ]);
        return (
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
                                    {row.skills.map((_$, s) => <Badge variant="subtle" colorPalette="blue">{s}</Badge>)}
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
        );
    }),
    inputs: [],
});

export const tableWrappingTags = example({
    keywords: ["Table", "Root", "Dict", "Tag", "wrap"],
    description: "Dict column rendered as tags that wrap within a fixed width",
    fn: East.function([], UIComponentType, ($) => {
        const metricsData = $.let([
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
        ]);
        return (
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
        );
    }),
    inputs: [],
});

export const tableInteractiveCallbacks = example({
    keywords: ["Table", "Reactive", "State", "onRowClick", "onCellClick", "onSortChange", "interactive"],
    description: "Click, double-click rows/cells, or click headers to sort",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const lastEventBind = $.let(State.bind([StringType], "table_last_event", ""));
            const lastEvent = $.let(lastEventBind.read());

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

            return (
                <VStack gap="3" align="stretch">
                    <Table
                        interactive={true}
                        striped={true}
                        onRowClick={onRowClick}
                        onRowDoubleClick={onRowDoubleClick}
                        onCellClick={onCellClick}
                        onCellDoubleClick={onCellDoubleClick}
                        onRowSelectionChange={onRowSelectionChange}
                        onSortChange={onSortChange}
                        data={[
                            { name: "Alice", role: "Admin", score: 95n },
                            { name: "Bob", role: "User", score: 88n },
                            { name: "Charlie", role: "User", score: 92n },
                        ]}
                        columns={{
                            name: { header: "Name" },
                            role: { header: "Role" },
                            score: { header: "Score" },
                        }}
                    />
                    <Badge colorPalette="blue" variant="outline">
                        {East.equal(lastEvent.length(), 0n).ifElse(_$ => "Interact with the table", _$ => lastEvent)}
                    </Badge>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const tableFrozenColumns = example({
    keywords: ["Table", "Root", "frozen", "pin", "scroll"],
    description: "Pin columns left so they stay visible during horizontal scroll. Container is 600px wide to force horizontal scroll.",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box width="600px" overflow="hidden">
                <Table
                    frozen={["id", "name"]}
                    variant="line"
                    striped={true}
                    height="400px"
                    data={East.Array.range(0n, 20n).map((_$, i) => ({
                        id: East.str`#${i}`,
                        name: East.str`User ${i}`,
                        email: East.str`user${i}@example.com`,
                        dept: "Engineering",
                        role: "Developer",
                        location: "Remote",
                        status: "Active",
                        score: i.multiply(7n),
                    }))}
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

export const tableRowStatus = example({
    keywords: ["Table", "Root", "rowStatus", "StatusToken", "tint", "theme-agnostic"],
    description: "Row-status tint — `rowStatus: (rowIndex) => StatusToken` paints each row with a semantic background tint",
    fn: East.function([], UIComponentType, ($) => {
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
        return (
            <Table
                rowStatus={rowStatus}
                variant="line"
                data={East.Array.range(0n, 9n).map((_$, i) => ({
                    name: East.str`Row ${i}`,
                    score: i.multiply(11n),
                }))}
                columns={{ name: { header: "Name" }, score: { header: "Score" } }}
            />
        );
    }),
    inputs: [],
});

export const tableReactivePagination = example({
    keywords: ["Table", "Root", "pagination", "page", "Reactive", "State"],
    description: "Embedded pagination — Table holds `pagination: { pageSize, page, onPageChange }` on its main struct; the renderer draws the Pagination primitive beneath",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([IntegerType], "table_page", 0n));
            const page = $.let(pageBind.read());
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return (
                <Table
                    variant="line"
                    pagination={{ pageSize: 20n, page, onPageChange }}
                    data={East.Array.range(0n, 120n).map((_$, i) => ({
                        id: East.str`#${i}`,
                        name: East.str`Row ${i}`,
                        value: i.multiply(3n),
                    }))}
                    columns={{ id: { header: "ID" }, name: { header: "Name" }, value: { header: "Value" } }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Review chrome (#264) — the shared per-row Approve / Reject Decision column
 * (a pinned-right column) plus the commitBar batch foot, identical to the
 * Planner's. An order-exceptions table: flagged rows rest `pending` with a
 * quiet warning dot; clean rows rest `approved`. Accessors receive the
 * UNSLICED `rowIndex`.
 */
export const tableReview = example({
    keywords: ["Table", "review", "approve", "reject", "approval", "decision", "batch", "rerun", "status", "row", "exception"],
    description: "Optional per-row approval on an order-exceptions table — pinned-right Decision column + commitBar batch foot, quiet dots on flagged pending rows",
    fn: East.function([], UIComponentType, ($) => {
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
        return (
            <Table
                variant="line"
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
                    onApprove: East.function([Table.Types.ApproveEvent], NullType, _$ => null),
                    onReject: East.function([Table.Types.ApproveEvent], NullType, _$ => null),
                    onApproveAll: East.function([], NullType, _$ => null),
                    onRejectAll: East.function([], NullType, _$ => null),
                    onRerun: East.function([], NullType, _$ => null),
                }}
                reviewStatus={reviewStatus}
                reviewApproval={reviewApproval}
            />
        );
    }),
    inputs: [],
});

/**
 * Review + pagination (#264) — the Decision column composes with the pager:
 * the review foot stacks BELOW the pagination band, and every review
 * callback / accessor receives the UNSLICED row index (page 2's first row is
 * rowIndex 20, not 0 — the `expandedContent` convention), so approvals map
 * straight back to the source data under paging AND sorting.
 */
export const tableReviewPaginated = example({
    keywords: ["Table", "review", "pagination", "rowIndex", "unsliced", "page", "decision", "foot"],
    description: "Review chrome under pagination — unsliced rowIndex semantics (page 2 row 0 is rowIndex 20), review foot stacked below the pager band",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pageBind = $.let(State.bind([IntegerType], "table_review_page", 1n));
            const page = $.let(pageBind.read());
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            const lastBind = $.let(State.bind([StringType], "table_review_last", "none yet"));
            const onApprove = $.const(East.function([Table.Types.ApproveEvent], NullType, ($, ev) => {
                $(lastBind.write(East.str`approved rowIndex ${East.print(ev.rowIndex)}`));
            }));
            const reviewApproval = $.const(East.function([IntegerType], OptionType(Table.Types.Approval), (_$, _rowIndex) =>
                some(variant("pending", null))));
            const last = $.let(lastBind.read());
            return (
                <VStack gap="3" align="stretch">
                    <Table
                        variant="line"
                        pagination={{ pageSize: 20n, page, onPageChange }}
                        data={East.Array.range(0n, 60n).map((_$, i) => ({
                            id: East.str`#${i}`,
                            name: East.str`Order ${i}`,
                        }))}
                        columns={{ id: { header: "ID" }, name: { header: "Name" } }}
                        review={{ onApprove, onApproveAll: East.function([], NullType, _$ => null) }}
                        reviewApproval={reviewApproval}
                    />
                    <Text.MonoLabel>{East.str`LAST · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const tableDensityCompact = example({
    keywords: ["Table", "Root", "density", "compact", "minimal"],
    description: "Compact density — the `density: 'compact'` token tightens row height for dense enterprise tables",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Table
                variant="line"
                density="compact"
                data={East.Array.range(0n, 6n).map((_$, i) => ({
                    name: East.str`Row ${i}`,
                    status: "Active",
                }))}
                columns={{ name: { header: "Name" }, status: { header: "Status" } }}
            />
        );
    }),
    inputs: [],
});

export const tableRowHeight = example({
    keywords: ["Table", "Root", "rowHeight", "pixel", "override", "density", "virtualization"],
    description: "Explicit pixel rowHeight overrides the density preset — fixed 48px rows fed to the virtualizer",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Table
                variant="line"
                rowHeight={48n}
                data={East.Array.range(0n, 6n).map((_$, i) => ({
                    name: East.str`Row ${i}`,
                    status: "Active",
                }))}
                columns={{ name: { header: "Name" }, status: { header: "Status" } }}
            />
        );
    }),
    inputs: [],
});

export const tableExpandedRichDetail = example({
    keywords: ["Table", "Root", "expandedContent", "rich detail", "Stack", "Stat"],
    description: "Expandable rows with rich detail content — Stack of Stat + Text components nested in the detail panel",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { name: "Alice", revenue: 142000n, deals: 18n, region: "EMEA" },
            { name: "Bob", revenue: 98000n, deals: 12n, region: "APAC" },
            { name: "Charlie", revenue: 215000n, deals: 24n, region: "AMER" },
        ]);
        return (
            <Table
                variant="line"
                striped={true}
                expandedContent={East.function([IntegerType], UIComponentType, ($, rowIndex) => {
                    const row = $.let(rows.get(rowIndex));
                    return (
                        <Box padding="4" background="gray.50">
                            <HStack gap="8">
                                <VStack gap="1">
                                    <Text textStyle="caption" color="gray.600">Revenue</Text>
                                    <Text textStyle="heading-md" fontWeight="bold">{East.str`$${row.revenue}`}</Text>
                                </VStack>
                                <VStack gap="1">
                                    <Text textStyle="caption" color="gray.600">Deals closed</Text>
                                    <Text textStyle="heading-md" fontWeight="bold">{East.str`${row.deals}`}</Text>
                                </VStack>
                                <VStack gap="1">
                                    <Text textStyle="caption" color="gray.600">Region</Text>
                                    <Badge variant="subtle" colorPalette="blue">{row.region}</Badge>
                                </VStack>
                            </HStack>
                        </Box>
                    );
                })}
                data={rows}
                columns={{ name: { header: "Sales rep" }, region: { header: "Region" } }}
            />
        );
    }),
    inputs: [],
});

export const tableMultiRowFooter = example({
    keywords: ["Table", "Root", "footerRows", "subtotal", "grand total", "multi-row"],
    description: "Multi-row footer — `footerRows` with a subtotal row and a bold grand-total row, demonstrating colSpan-spanned label cells",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Table
                variant="line"
                footerBackground="gray.50"
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
                data={[
                    { item: "Sandwich", category: "Food", price: 12.50 },
                    { item: "Salad", category: "Food", price: 9.00 },
                    { item: "Soda", category: "Drink", price: 3.50 },
                    { item: "Coffee", category: "Drink", price: 4.50 },
                ]}
                columns={{
                    item: { header: "Item" },
                    category: { header: "Category" },
                    price: { header: "Price ($)" },
                }}
            />
        );
    }),
    inputs: [],
});

export const tableNestedColumnGroups = example({
    keywords: ["Table", "Root", "columnGroups", "nested", "category", "header row"],
    description: "Three column groups across six columns — financial-report-style header with Identity / Q1-Q2 / Q3-Q4 groupings",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Table
                variant="outline"
                showColumnBorder={true}
                columnGroups={[
                    { label: "Identity", columnKeys: ["dept", "region"] },
                    { label: "First half", columnKeys: ["q1", "q2"] },
                    { label: "Second half", columnKeys: ["q3", "q4"] },
                ]}
                data={[
                    { dept: "Sales", region: "EMEA", q1: "$120k", q2: "$135k", q3: "$148k", q4: "$162k" },
                    { dept: "Sales", region: "APAC", q1: "$95k", q2: "$102k", q3: "$118k", q4: "$130k" },
                    { dept: "Marketing", region: "AMER", q1: "$48k", q2: "$52k", q3: "$54k", q4: "$59k" },
                ]}
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

export const tableMultiSelection = example({
    keywords: ["Table", "Root", "selection", "multiple", "checkbox", "Reactive", "State"],
    description: "Multiple-row selection — `mode: 'multiple'` toggles rows independently; selection mirrors a State array",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const selectedBind = $.let(State.bind([ArrayType(IntegerType)], "table_multi_selected", []));
            const selected = $.let(selectedBind.read(), ArrayType(IntegerType));
            const onChange = $.const(East.function([ArrayType(IntegerType)], NullType, ($, next) => {
                $(selectedBind.write(next));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Badge variant="solid" colorPalette="blue">{East.str`${selected.size()} selected`}</Badge>
                    <Table
                        variant="line"
                        striped={true}
                        selection={{ mode: "multiple", selected, onChange }}
                        selectedBackground="blue.50"
                        selectedBorderColor="blue.300"
                        data={[
                            { name: "Alice", role: "Admin" },
                            { name: "Bob", role: "User" },
                            { name: "Charlie", role: "User" },
                            { name: "Diana", role: "Manager" },
                            { name: "Eve", role: "User" },
                        ]}
                        columns={{ name: { header: "Name" }, role: { header: "Role" } }}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const tableRangeSelection = example({
    keywords: ["Table", "Root", "selection", "range", "shift-click", "Reactive", "State"],
    description: "Range-mode selection — shift-click extends from the last anchor; plain click resets to a single row",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const selectedBind = $.let(State.bind([ArrayType(IntegerType)], "table_range_selected", []));
            const selected = $.let(selectedBind.read(), ArrayType(IntegerType));
            const onChange = $.const(East.function([ArrayType(IntegerType)], NullType, ($, next) => {
                $(selectedBind.write(next));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Badge variant="outline" colorPalette="purple">{East.str`Range size: ${selected.size()}`}</Badge>
                    <Table
                        variant="line"
                        striped={true}
                        selection={{ mode: "range", selected, onChange }}
                        selectedBackground="purple.50"
                        selectedBorderColor="purple.300"
                        data={East.Array.range(0n, 8n).map((_$, i) => ({
                            id: East.str`#${i.add(1n)}`,
                            task: East.str`Task ${i.add(1n)}`,
                        }))}
                        columns={{ id: { header: "ID" }, task: { header: "Task" } }}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});


export const tableFill = example({
    keywords: ["Table", "fill", "height", "Card", "scroll", "sizing", "#320"],
    description: "height=\"fill\" (#320) — the table fills a fixed 220px Card body and scrolls within it; twenty rows overflow so it clips mid-row with the header pinned",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card height="220px">
                <Table
                    variant="line"
                    striped={true}
                    height="fill"
                    data={East.Array.range(0n, 20n).map((_$, i) => ({
                        id: East.str`#${i}`,
                        name: East.str`User ${i}`,
                        email: East.str`user${i}@example.com`,
                        dept: "Engineering",
                    }))}
                    columns={{
                        id: { header: "ID", width: "80px" },
                        name: { header: "Name", width: "150px" },
                        email: { header: "Email", width: "250px" },
                        dept: { header: "Department", width: "150px" },
                    }}
                />
            </Card>
        );
    }),
    inputs: [],
});
