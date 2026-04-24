/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, IntegerType, LiteralValueType, NullType, StringType, variant, example } from "@elaraai/east";
import { Badge, Box, Reactive, Stack, State, Style, Table, Tag, Text, UIComponentType } from "@elaraai/east-ui";

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

export const tableInteractive = example({
    keywords: ["Table", "Root", "interactive", "hover"],
    description: "Hover effects for better UX",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { id: "#001", task: "Review PR", status: "In Progress" },
                { id: "#002", task: "Deploy v2.0", status: "Pending" },
                { id: "#003", task: "Update docs", status: "Complete" },
            ],
            {
                id: { header: "ID" },
                task: { header: "Task" },
                status: { header: "Status" },
            },
            { interactive: true }
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

export const tableFullStyled = example({
    keywords: ["Table", "Root", "variant", "outline", "showColumnBorder", "colorPalette"],
    description: "Multiple style options combined",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { q1: "$45,000", q2: "$52,000", q3: "$48,000", q4: "$61,000" },
                { q1: "$38,000", q2: "$41,000", q3: "$44,000", q4: "$47,000" },
            ],
            {
                q1: { header: "Q1" },
                q2: { header: "Q2" },
                q3: { header: "Q3" },
                q4: { header: "Q4" },
            },
            {
                variant: "outline",
                striped: true,
                showColumnBorder: true,
                colorPalette: "teal",
            }
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

export const tableColumnRenderWithRow = example({
    keywords: ["Table", "Root", "render", "CellRenderContext", "context"],
    description: "East render function receives cell context at render time",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { name: "Alice", role: "Admin", status: "Active", score: 95n },
                { name: "Bob", role: "User", status: "Inactive", score: 72n },
                { name: "Charlie", role: "Manager", status: "Active", score: 88n },
                { name: "Diana", role: "User", status: "Pending", score: 65n },
            ],
            {
                name: { header: "Name" },
                status: {
                    header: "Status",
                    render: East.function(
                        [Table.Types.CellRenderContext],
                        UIComponentType,
                        (_$, ctx) => Badge.Root(
                            ctx.cellValue.match({ String: (_$2, v) => v }, _$2 => ""),
                            { variant: "solid" }
                        )
                    ),
                },
                score: { header: "Score" },
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

export const tableCustomHeight = example({
    keywords: ["Table", "Root", "height", "scroll"],
    description: "Set height via style to control container size",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { name: "Alice", email: "alice@example.com", role: "Admin" },
                { name: "Bob", email: "bob@example.com", role: "User" },
                { name: "Charlie", email: "charlie@example.com", role: "User" },
                { name: "Diana", email: "diana@example.com", role: "Manager" },
                { name: "Eve", email: "eve@example.com", role: "User" },
            ],
            {
                name: { header: "Name" },
                email: { header: "Email" },
                role: { header: "Role" },
            },
            { height: "200px", variant: "line", striped: true }
        );
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

export const tableWithFooter = example({
    keywords: ["Table", "Root", "footer", "totals", "colSpan", "aggregate"],
    description: "Footer row with a totals aggregation, using colSpan to merge the label cell across columns",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { product: "Widget A", qty: 5n, total: 125.0 },
                { product: "Widget B", qty: 12n, total: 360.0 },
                { product: "Widget C", qty: 3n, total: 75.0 },
            ],
            {
                product: { header: "Product" },
                qty: { header: "Qty" },
                total: { header: "Total ($)" },
            },
            {
                variant: "line",
                footer: {
                    product: { content: Text.Root("Total", { fontWeight: "bold" }), colSpan: 2n },
                    qty: { content: Text.Root("20") },
                    total: { content: Text.Root("$560.00", { fontWeight: "bold" }) },
                },
                footerBackground: "gray.50",
            },
        );
    }),
    inputs: [],
});

export const tableColumnGroups = example({
    keywords: ["Table", "Root", "columnGroups", "grouped header", "category"],
    description: "Two-level header — `columnGroups` renders a grouping row above the column headers",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { sku: "SKU-001", price: 19.99, stock: 120n, reordered: 50n, delivered: 50n },
                { sku: "SKU-002", price: 29.99, stock: 45n, reordered: 25n, delivered: 0n },
            ],
            {
                sku: { header: "SKU" },
                price: { header: "Price" },
                stock: { header: "On hand" },
                reordered: { header: "Reordered" },
                delivered: { header: "Delivered" },
            },
            {
                variant: "outline",
                columnGroups: [
                    { label: "Identity", columnKeys: ["sku"] },
                    { label: "Pricing", columnKeys: ["price"] },
                    { label: "Inventory", columnKeys: ["stock", "reordered", "delivered"] },
                ],
            },
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

export const tableReactiveSelection = example({
    keywords: ["Table", "Root", "selection", "single", "Reactive", "State"],
    description: "Single-row selection — `selection: { mode: single, selected, onChange }` tracks which rows are selected and emits changes to a State binding",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const selectedBind = $.let(State.bind([ArrayType(IntegerType)], "table_selected_indices", []));
            const selected = $.let(selectedBind.read(), ArrayType(IntegerType));
            const onChange = $.const(East.function([ArrayType(IntegerType)], NullType, ($, next) => {
                $(selectedBind.write(next));
            }));
            return Table.Root(
                [
                    { name: "Alice", role: "Admin" },
                    { name: "Bob", role: "User" },
                    { name: "Charlie", role: "User" },
                ],
                { name: { header: "Name" }, role: { header: "Role" } },
                {
                    variant: "line",
                    selection: { mode: "single", selected, onChange },
                    selectedBackground: "blue.50",
                    selectedBorderColor: "blue.200",
                },
            );
        }));
    }),
    inputs: [],
});

export const tableExpandedContent = example({
    keywords: ["Table", "Root", "expandedContent", "expandable", "detail row"],
    description: "Expandable rows — `expandedContent: (rowIndex) => UIComponent` renders a detail panel beneath each row when expanded",
    fn: East.function([], UIComponentType, (_$) => {
        const rows = [
            { name: "Alice", email: "alice@example.com", role: "Admin" },
            { name: "Bob", email: "bob@example.com", role: "User" },
        ];
        const rowsExpr = East.value(rows);
        return Table.Root(
            rows,
            { name: { header: "Name" }, role: { header: "Role" } },
            {
                variant: "line",
                expandedContent: East.function([IntegerType], UIComponentType, ($, rowIndex) => {
                    const row = $.let(rowsExpr.get(rowIndex));
                    return Box.Root([
                        Stack.VStack([
                            Text.Root("Email", { fontWeight: "bold" }),
                            Text.Root(row.email),
                        ], { gap: "1" }),
                    ], { padding: "4", background: "gray.50" });
                }),
            },
        );
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

export const tableColourOverrides = example({
    keywords: ["Table", "Root", "colour", "override", "headerBackground", "hoverBackground"],
    description: "Explicit colour overrides for header / zebra / hover / footer — theme escape hatches for enterprise brand alignment",
    fn: East.function([], UIComponentType, (_$) => {
        return Table.Root(
            [
                { product: "Widget A", qty: 5n },
                { product: "Widget B", qty: 12n },
            ],
            { product: { header: "Product" }, qty: { header: "Qty" } },
            {
                variant: "line",
                striped: true,
                headerBackground: "blue.600",
                headerColor: "white",
                borderColor: "blue.200",
                zebraBackground: "blue.50",
                hoverBackground: "blue.100",
            },
        );
    }),
    inputs: [],
});
