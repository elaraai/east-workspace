/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, IntegerType, NullType, StringType, StructType, example } from "@elaraai/east";
import { Badge, Box, Pagination, Reactive, Stack, State, Style, Table, Tag, Text, UIComponentType } from "@elaraai/east-ui";

export const tableBasic = example({
    keywords: ["Table", "Root", "basic", "header"],
    description: "Simple table with field names",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { name: "Alice", email: "alice@example.com", role: "Admin", tags: ["team lead", "full-time"] },
                { name: "Bob", email: "bob@example.com", role: "User", tags: ["part-time"] },
                { name: "Charlie", email: "charlie@example.com", role: "User", tags: ["contractor"] },
            ],
            {
                name: { header: "Name" },
                email: { header: "Email" },
                role: { header: "Role" },
                tags: {
                    header: "Tags",
                    value: tags => tags.size(),
                },
            }
        );
    }),
    inputs: [],
});

export const tableCustomHeaders = example({
    keywords: ["Table", "Root", "header", "width", "minWidth", "maxWidth"],
    description: "Object config with custom column headers and widths",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { firstName: "Alice", lastName: "Smith", dept: "Engineering" },
                { firstName: "Bob", lastName: "Jones", dept: "Marketing" },
            ],
            {
                firstName: { header: "First Name", width: "300px", minWidth: "80px" },
                lastName: { header: "Last Name", width: "150px" },
                dept: { header: "Department", minWidth: "100px", maxWidth: "200px" },
            }
        );
    }),
    inputs: [],
});

export const tableStriped = example({
    keywords: ["Table", "Root", "striped", "alternating"],
    description: "Alternating row colors for readability",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { product: "Widget A", price: "$29.99", stock: 150n },
                { product: "Widget B", price: "$49.99", stock: 75n },
                { product: "Widget C", price: "$19.99", stock: 200n },
                { product: "Widget D", price: "$39.99", stock: 50n },
            ],
            {
                product: { header: "Product" },
                price: { header: "Price" },
                stock: { header: "In Stock" },
            },
            { striped: true }
        );
    }),
    inputs: [],
});

export const tableWithBadge = example({
    keywords: ["Table", "Root", "render", "Badge", "CellRenderContext"],
    description: "Using Badge for status column",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            East.Array.range(0n, 1000n).map((_$, i) => ({
                name: East.str`User ${i}`,
                email: East.str`user${i}@example.com`,
                status: "Active",
            })),
            {
                name: { header: "Name" },
                email: { header: "Email" },
                status: {
                    header: "Status",
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        (_$, ctx) => Badge.Root(
                            ctx.cellValue.match({ String: (_$2, v) => v }, _$2 => ""),
                            { variant: "solid", colorPalette: "blue" }
                        )
                    ),
                },
            },
            { variant: "line", height: "400px" }
        );
    }),
    inputs: [],
});

export const tableComplexColumns = example({
    keywords: ["Table", "Root", "value", "render", "complex", "array", "struct"],
    description: "Array and struct fields with value functions for sorting",
    fn: East.function([], UIComponentType, ($) => {
        const complexData = $.let(East.value([
            { name: "Alice", skills: ["TypeScript", "React", "Node"], metadata: { level: "Senior", years: 5n } },
            { name: "Bob", skills: ["Python", "Django"], metadata: { level: "Mid", years: 3n } },
            { name: "Charlie", skills: ["Go", "Rust", "C++", "Java"], metadata: { level: "Senior", years: 8n } },
        ]));
        return Table.Root(
            complexData,
            {
                name: { header: "Name" },
                skills: {
                    header: "Skills",
                    value: (skills) => skills.size(),
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        ($, ctx) => {
                            const row = $.let(complexData.get(ctx.rowIndex));
                            return Stack.HStack(
                                row.skills.map((_$, s) => Badge.Root(s, { variant: "subtle", colorPalette: "blue" })),
                                { gap: "1", wrap: "wrap" }
                            );
                        }
                    ),
                },
                metadata: {
                    header: "Experience",
                    value: (meta) => meta.years,
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        ($, ctx) => {
                            const row = $.let(complexData.get(ctx.rowIndex));
                            return Text.Root(East.str`${row.metadata.level} (${row.metadata.years} yrs)`);
                        }
                    ),
                },
            },
            { variant: "line", striped: true }
        );
    }),
    inputs: [],
});

export const tableWrappingTags = example({
    keywords: ["Table", "Root", "Dict", "Tag", "wrap"],
    description: "Dict column rendered as tags that wrap within a fixed width",
    fn: East.function([], UIComponentType, ($) => {
        const metricsData = $.let(East.value([
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
        ]));
        return Table.Root(
            metricsData,
            {
                name: { header: "Server", width: "120px" },
                metrics: {
                    header: "Metrics",
                    width: "400px",
                    maxWidth: "400px",
                    value: (val) => val.map((_$, value) => value).mean(),
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        ($, ctx) => {
                            const row = $.let(metricsData.get(ctx.rowIndex));
                            return Stack.HStack(
                                row.metrics.map((_$, value, key) => Tag.Root(East.str`${key}: ${value}`)).toArray(),
                                { wrap: "wrap", gap: "1" }
                            );
                        }
                    ),
                },
            },
            { variant: "line" }
        );
    }),
    inputs: [],
});

export const tableInteractiveCallbacks = example({
    keywords: ["Table", "Reactive", "State", "onRowClick", "onCellClick", "onSortChange", "interactive"],
    description: "Click, double-click rows/cells, or click headers to sort",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const lastEventBind = $.let(State.bind([StringType], "table_last_event", ""));
            const lastEvent = $.let(lastEventBind.read());

            const onRowClick = $.const(East.function(
                [Table.Types.RowClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onRowClick: row ${event.rowIndex}`));
                }
            ));

            const onRowDoubleClick = $.const(East.function(
                [Table.Types.RowClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onRowDoubleClick: row ${event.rowIndex}`));
                }
            ));

            const onCellClick = $.const(East.function(
                [Table.Types.CellClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onCellClick: row ${event.rowIndex}, col ${event.columnKey}`));
                }
            ));

            const onCellDoubleClick = $.const(East.function(
                [Table.Types.CellClickEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onCellDoubleClick: row ${event.rowIndex}, col ${event.columnKey}`));
                }
            ));

            const onRowSelectionChange = $.const(East.function(
                [Table.Types.RowSelectionEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(
                        event.selected.ifElse(
                            _$ => East.str`onRowSelectionChange: selected row ${event.rowIndex}`,
                            _$ => East.str`onRowSelectionChange: deselected row ${event.rowIndex}`
                        )
                    ));
                }
            ));

            const onSortChange = $.const(East.function(
                [Table.Types.SortEvent],
                NullType,
                ($, event) => {
                    $(lastEventBind.write(East.str`onSortChange: ${event.columnKey} - ${event.sortDirection.getTag()}`));
                }
            ));

            return Stack.VStack([
                Table.Root(
                    [
                        { name: "Alice", role: "Admin", score: 95n },
                        { name: "Bob", role: "User", score: 88n },
                        { name: "Charlie", role: "User", score: 92n },
                    ],
                    {
                        name: { header: "Name" },
                        role: { header: "Role" },
                        score: { header: "Score" },
                    },
                    {
                        interactive: true,
                        striped: true,
                        onRowClick,
                        onRowDoubleClick,
                        onCellClick,
                        onCellDoubleClick,
                        onRowSelectionChange,
                        onSortChange,
                    }
                ),
                Badge.Root(
                    East.equal(lastEvent.length(), 0n).ifElse(_$ => "Interact with the table", _$ => lastEvent),
                    { colorPalette: "blue", variant: "outline" }
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const tableFrozenColumns = example({
    keywords: ["Table", "Root", "frozen", "pin", "scroll"],
    description: "Pin columns left so they stay visible during horizontal scroll. Container is 600px wide to force horizontal scroll.",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([Table.Root(
            East.Array.range(0n, 20n).map((_$, i) => ({
                id: East.str`#${i}`,
                name: East.str`User ${i}`,
                email: East.str`user${i}@example.com`,
                dept: "Engineering",
                role: "Developer",
                location: "Remote",
                status: "Active",
                score: i.multiply(7n),
            })),
            {
                id: { header: "ID", width: "80px" },
                name: { header: "Name", width: "150px" },
                email: { header: "Email", width: "250px" },
                dept: { header: "Department", width: "150px" },
                role: { header: "Role", width: "150px" },
                location: { header: "Location", width: "150px" },
                status: { header: "Status", width: "120px" },
                score: { header: "Score", width: "100px" },
            },
            {
                frozen: ["id", "name"],
                variant: "line",
                striped: true,
                height: "400px",
            }
        )], { width: "600px", overflow: "hidden" });
    }),
    inputs: [],
});

// ============================================================================
// Plan 1.10 — new main-struct fields (rowStatus / pagination / selection /
// expandedContent / columnGroups / footer / density) + new visual colour slots
// ============================================================================

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

        return Table.Root(
            East.Array.range(0n, 9n).map((_$, i) => ({
                name: East.str`Row ${i}`,
                score: i.multiply(11n),
            })),
            { name: { header: "Name" }, score: { header: "Score" } },
            { rowStatus, variant: "line" },
        );
    }),
    inputs: [],
});

export const tableReactivePagination = example({
    keywords: ["Table", "Root", "pagination", "page", "Reactive", "State"],
    description: "Embedded pagination — Table holds `pagination: { pageSize, page, onPageChange }` on its main struct; the renderer draws the Pagination primitive beneath",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const pageBind = $.let(State.bind([IntegerType], "table_page", 0n));
            const page = $.let(pageBind.read(), IntegerType);
            const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
                $(pageBind.write(next));
            }));
            return Table.Root(
                East.Array.range(0n, 120n).map((_$, i) => ({
                    id: East.str`#${i}`,
                    name: East.str`Row ${i}`,
                    value: i.multiply(3n),
                })),
                { id: { header: "ID" }, name: { header: "Name" }, value: { header: "Value" } },
                {
                    variant: "line",
                    pagination: { pageSize: 20n, page, onPageChange },
                },
            );
        }));
    }),
    inputs: [],
});

export const tableDensityCompact = example({
    keywords: ["Table", "Root", "density", "compact", "minimal"],
    description: "Compact density — the `density: 'compact'` token tightens row height for dense enterprise tables",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            East.Array.range(0n, 6n).map((_$, i) => ({
                name: East.str`Row ${i}`,
                status: "Active",
            })),
            { name: { header: "Name" }, status: { header: "Status" } },
            { variant: "line", density: "compact" },
        );
    }),
    inputs: [],
});

export const tableExpandedRichDetail = example({
    keywords: ["Table", "Root", "expandedContent", "rich detail", "Stack", "Stat"],
    description: "Expandable rows with rich detail content — Stack of Stat + Text components nested in the detail panel",
    fn: East.function([], UIComponentType, (_$) => {
        const rows = [
            { name: "Alice", revenue: 142000n, deals: 18n, region: "EMEA" },
            { name: "Bob", revenue: 98000n, deals: 12n, region: "APAC" },
            { name: "Charlie", revenue: 215000n, deals: 24n, region: "AMER" },
        ];
        const rowsExpr = East.value(rows);
        return Table.Root(
            rows,
            { name: { header: "Sales rep" }, region: { header: "Region" } },
            {
                variant: "line",
                striped: true,
                expandedContent: East.function([IntegerType], UIComponentType, ($, rowIndex) => {
                    const row = $.let(rowsExpr.get(rowIndex));
                    return Box.Root([
                        Stack.HStack([
                            Stack.VStack([
                                Text.Root("Revenue", { textStyle: "caption", color: "gray.600" }),
                                Text.Root(East.str`$${row.revenue}`, { textStyle: "heading-md", fontWeight: "bold" }),
                            ], { gap: "1" }),
                            Stack.VStack([
                                Text.Root("Deals closed", { textStyle: "caption", color: "gray.600" }),
                                Text.Root(East.str`${row.deals}`, { textStyle: "heading-md", fontWeight: "bold" }),
                            ], { gap: "1" }),
                            Stack.VStack([
                                Text.Root("Region", { textStyle: "caption", color: "gray.600" }),
                                Badge.Root(row.region, { variant: "subtle", colorPalette: "blue" }),
                            ], { gap: "1" }),
                        ], { gap: "8" }),
                    ], { padding: "4", background: "gray.50" });
                }),
            },
        );
    }),
    inputs: [],
});

export const tableMultiRowFooter = example({
    keywords: ["Table", "Root", "footerRows", "subtotal", "grand total", "multi-row"],
    description: "Multi-row footer — `footerRows` with a subtotal row and a bold grand-total row, demonstrating colSpan-spanned label cells",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { item: "Sandwich", category: "Food", price: 12.50 },
                { item: "Salad", category: "Food", price: 9.00 },
                { item: "Soda", category: "Drink", price: 3.50 },
                { item: "Coffee", category: "Drink", price: 4.50 },
            ],
            {
                item: { header: "Item" },
                category: { header: "Category" },
                price: { header: "Price ($)" },
            },
            {
                variant: "line",
                footerRows: [
                    {
                        item: { content: Text.Root("Food subtotal", { fontWeight: "medium" }), colSpan: 2n },
                        price: { content: Text.Root("$21.50") },
                    },
                    {
                        item: { content: Text.Root("Drink subtotal", { fontWeight: "medium" }), colSpan: 2n },
                        price: { content: Text.Root("$8.00") },
                    },
                    {
                        item: { content: Text.Root("Grand total", { fontWeight: "bold" }), colSpan: 2n },
                        price: { content: Text.Root("$29.50", { fontWeight: "bold" }) },
                    },
                ],
                footerBackground: "gray.50",
            },
        );
    }),
    inputs: [],
});

export const tableNestedColumnGroups = example({
    keywords: ["Table", "Root", "columnGroups", "nested", "category", "header row"],
    description: "Three column groups across six columns — financial-report-style header with Identity / Q1-Q2 / Q3-Q4 groupings",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { dept: "Sales", region: "EMEA", q1: "$120k", q2: "$135k", q3: "$148k", q4: "$162k" },
                { dept: "Sales", region: "APAC", q1: "$95k", q2: "$102k", q3: "$118k", q4: "$130k" },
                { dept: "Marketing", region: "AMER", q1: "$48k", q2: "$52k", q3: "$54k", q4: "$59k" },
            ],
            {
                dept: { header: "Department" },
                region: { header: "Region" },
                q1: { header: "Q1" },
                q2: { header: "Q2" },
                q3: { header: "Q3" },
                q4: { header: "Q4" },
            },
            {
                variant: "outline",
                showColumnBorder: true,
                columnGroups: [
                    { label: "Identity", columnKeys: ["dept", "region"] },
                    { label: "First half", columnKeys: ["q1", "q2"] },
                    { label: "Second half", columnKeys: ["q3", "q4"] },
                ],
            },
        );
    }),
    inputs: [],
});

export const tableMultiSelection = example({
    keywords: ["Table", "Root", "selection", "multiple", "checkbox", "Reactive", "State"],
    description: "Multiple-row selection — `mode: 'multiple'` toggles rows independently; selection mirrors a State array",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const selectedBind = $.let(State.bind([ArrayType(IntegerType)], "table_multi_selected", []));
            const selected = $.let(selectedBind.read(), ArrayType(IntegerType));
            const onChange = $.const(East.function([ArrayType(IntegerType)], NullType, ($, next) => {
                $(selectedBind.write(next));
            }));
            return Stack.VStack([
                Badge.Root(
                    East.str`${selected.size()} selected`,
                    { variant: "solid", colorPalette: "blue" },
                ),
                Table.Root(
                    [
                        { name: "Alice", role: "Admin" },
                        { name: "Bob", role: "User" },
                        { name: "Charlie", role: "User" },
                        { name: "Diana", role: "Manager" },
                        { name: "Eve", role: "User" },
                    ],
                    { name: { header: "Name" }, role: { header: "Role" } },
                    {
                        variant: "line",
                        striped: true,
                        selection: { mode: "multiple", selected, onChange },
                        selectedBackground: "blue.50",
                        selectedBorderColor: "blue.300",
                    },
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const tableRangeSelection = example({
    keywords: ["Table", "Root", "selection", "range", "shift-click", "Reactive", "State"],
    description: "Range-mode selection — shift-click extends from the last anchor; plain click resets to a single row",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const selectedBind = $.let(State.bind([ArrayType(IntegerType)], "table_range_selected", []));
            const selected = $.let(selectedBind.read(), ArrayType(IntegerType));
            const onChange = $.const(East.function([ArrayType(IntegerType)], NullType, ($, next) => {
                $(selectedBind.write(next));
            }));
            return Stack.VStack([
                Badge.Root(
                    East.str`Range size: ${selected.size()}`,
                    { variant: "outline", colorPalette: "purple" },
                ),
                Table.Root(
                    East.Array.range(0n, 8n).map((_$, i) => ({
                        id: East.str`#${i.add(1n)}`,
                        task: East.str`Task ${i.add(1n)}`,
                    })),
                    { id: { header: "ID" }, task: { header: "Task" } },
                    {
                        variant: "line",
                        striped: true,
                        selection: { mode: "range", selected, onChange },
                        selectedBackground: "purple.50",
                        selectedBorderColor: "purple.300",
                    },
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

