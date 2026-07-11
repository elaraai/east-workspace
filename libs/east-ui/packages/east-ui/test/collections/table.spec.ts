/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Table, Badge, Text, Stack, Style, UIComponentType } from "@elaraai/east-ui/internal";
import { East, BooleanType, IntegerType, NullType, OptionType, ArrayType, none, some, variant } from "@elaraai/east";
import * as ex from "./table.examples.js";

describeEast("Table", (test) => {
    Assert.examples(test, {
        tableFill: ex.tableFill,
        tablePnlGrouped: ex.tablePnlGrouped,
        tableBasic: ex.tableBasic,
        tableCustomHeaders: ex.tableCustomHeaders,
        tableStriped: ex.tableStriped,
        tableWithBadge: ex.tableWithBadge,
        tableComplexColumns: ex.tableComplexColumns,
        tableWrappingTags: ex.tableWrappingTags,
        tableInteractiveCallbacks: ex.tableInteractiveCallbacks,
        tableFrozenColumns: ex.tableFrozenColumns,
        tableRowStatus: ex.tableRowStatus,
        tableReview: ex.tableReview,
        tableReviewPaginated: ex.tableReviewPaginated,
        tableReactivePagination: ex.tableReactivePagination,
        tableDensityCompact: ex.tableDensityCompact,
        tableRowHeight: ex.tableRowHeight,
        tableExpandedRichDetail: ex.tableExpandedRichDetail,
        tableMultiRowFooter: ex.tableMultiRowFooter,
        tableNestedColumnGroups: ex.tableNestedColumnGroups,
        tableMultiSelection: ex.tableMultiSelection,
        tableRangeSelection: ex.tableRangeSelection,
    });

    // =========================================================================
    // Simple Array Syntax
    // =========================================================================

    test("creates table with array of field names (primitive fields only)", $ => {
        const table = $.let(Table.Root(
            [
                { name: "Alice", email: "alice@example.com" },
                { name: "Bob", email: "bob@example.com" },
            ],
            ["name", "email"]
        ));

        $(Assert.equal(table.unwrap().getTag(), "Table"));
        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 2n));
        $(Assert.equal(table.unwrap().unwrap("Table").rows.size(), 2n));
    });

    // =========================================================================
    // Object Syntax with Default Rendering
    // =========================================================================

    test("creates table with object config (no render - uses default)", $ => {
        const table = $.let(Table.Root(
            [
                { name: "Alice", email: "alice@example.com" },
                { name: "Bob", email: "bob@example.com" },
            ],
            {
                name: { header: "Name" },
                email: { header: "Email" },
            }
        ));

        $(Assert.equal(table.unwrap().getTag(), "Table"));
        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 2n));
    });

    test("creates table with column subset", $ => {
        // Only select some columns
        const table = $.let(Table.Root(
            [
                { name: "Alice", age: 30n, city: "NYC", other: true },
            ],
            {
                name: { header: "Name" },
                city: { header: "City" },
                // age and other are not included
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 2n));
    });

    test("creates table with non-string fields (auto converts to string)", $ => {
        const table = $.let(Table.Root(
            [
                { name: "Alice", age: 30n, active: true },
            ],
            {
                name: { header: "Name" },
                age: { header: "Age" },
                active: { header: "Active" },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 3n));
    });

    // =========================================================================
    // Column Configuration
    // =========================================================================

    test("creates table with custom headers", $ => {
        const table = $.let(Table.Root(
            [
                { firstName: "Alice", lastName: "Smith" },
            ],
            {
                firstName: { header: "First Name" },
                lastName: { header: "Last Name" },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").columns.get(0n).header.unwrap("some"), "First Name"));
    });

    test("creates table with custom render for text alignment", $ => {
        const table = $.let(Table.Root(
            [
                { item: "Widget", price: "$99.99" },
            ],
            {
                item: { header: "Item" },
                price: { header: "Price", render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => Text.Root(ctx.cellValue.match({ String: (_$, v) => v }, _$ => ""), { textAlign: "right" })) },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 2n));
    });

    // =========================================================================
    // Custom Rendering
    // =========================================================================

    test("creates table with custom render for Badge", $ => {
        const table = $.let(Table.Root(
            [
                { name: "Alice", status: "Active" },
                { name: "Bob", status: "Pending" },
            ],
            {
                name: { header: "Name" },
                status: { header: "Status", render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => Badge.Root(ctx.cellValue.match({ String: (_$, v) => v }, _$ => ""), { variant: "solid" })) },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").rows.size(), 2n));
    });

    // =========================================================================
    // Styling
    // =========================================================================

    test("creates table with line variant", $ => {
        const table = $.let(Table.Root(
            [{ col: "value" }],
            { col: { header: "Column" } },
            { variant: "line" }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").style.unwrap("some").variant.unwrap("some").hasTag("line"), true));
    });

    test("creates striped table", $ => {
        const table = $.let(Table.Root(
            [{ col: "value" }],
            { col: { header: "Column" } },
            { striped: true }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").style.unwrap("some").striped.unwrap("some"), true));
    });

    test("creates table with size", $ => {
        const table = $.let(Table.Root(
            [{ col: "value" }],
            { col: { header: "Column" } },
            { size: "lg" }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    test("creates table with all style options", $ => {
        const table = $.let(Table.Root(
            [{ name: "Alice", email: "alice@example.com" }],
            {
                name: { header: "Name" },
                email: { header: "Email" },
            },
            {
                variant: "outline",
                size: "md",
                striped: true,
                interactive: true,
                stickyHeader: true,
                colorPalette: "blue",
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
        $(Assert.equal(table.unwrap().unwrap("Table").style.unwrap("some").striped.unwrap("some"), true));
        $(Assert.equal(table.unwrap().unwrap("Table").interactive.unwrap("some"), true));
    });

    // =========================================================================
    // Render with Row Access
    // =========================================================================

    test("render function receives row parameter to access other fields", $ => {
        const data = $.let(East.value([
            { name: "Alice", status: "Active", role: "Admin" },
            { name: "Bob", status: "Inactive", role: "User" },
        ]));
        const table = $.let(Table.Root(
            data,
            {
                name: { header: "Name" },
                status: {
                    header: "Status",
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Badge.Root(East.str`${row.status} (${row.role})`, { variant: "solid" });
                    }),
                },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").rows.size(), 2n));
        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 2n));
    });

    test("render function uses row field for conditional styling", $ => {
        const table = $.let(Table.Root(
            [
                { product: "Widget", price: 100n, inStock: true },
                { product: "Gadget", price: 250n, inStock: false },
            ],
            {
                product: { header: "Product" },
                price: {
                    header: "Price",
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) =>
                        Text.Root(ctx.cellValue.match({ Integer: (_$, v) => East.str`$${v}` }, _$ => ""))
                    ),
                },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").rows.size(), 2n));
    });

    test("render function accesses multiple row fields", $ => {
        const data = $.let(East.value([
            { firstName: "Alice", lastName: "Smith", department: "Engineering" },
        ]));
        const table = $.let(Table.Root(
            data,
            {
                firstName: {
                    header: "Full Name",
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`${row.firstName} ${row.lastName}`);
                    }),
                },
                department: { header: "Department" },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 2n));
    });

    // =========================================================================
    // Real-World Examples
    // =========================================================================

    test("creates user table with mixed components", $ => {
        const table = $.let(Table.Root(
            [
                { name: "Alice Smith", email: "alice@example.com", role: "Admin" },
                { name: "Bob Jones", email: "bob@example.com", role: "User" },
            ],
            {
                name: { header: "Name" },
                email: { header: "Email" },
                role: { header: "Role", render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => Badge.Root(ctx.cellValue.match({ String: (_$, v) => v }, _$ => ""), { colorPalette: "blue" })) },
            },
            { variant: "line", striped: true }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").rows.size(), 2n));
        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 3n));
    });

    // =========================================================================
    // Complex Type Columns (require value function)
    // =========================================================================

    test("creates table with array field using value function", $ => {
        // Array fields require a value function to extract a sortable value
        const data = $.let(East.value([
            { name: "Alice", tags: ["admin", "active"] },
            { name: "Bob", tags: ["user"] },
        ]));
        const table = $.let(Table.Root(
            data,
            {
                name: { header: "Name" },
                tags: {
                    header: "Tags",
                    // Extract array length as sortable integer value
                    value: (tags) => tags.size(),
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Stack.HStack(row.tags.map(($, tag) => Badge.Root(tag, { variant: "subtle" })));
                    }),
                },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 2n));
        $(Assert.equal(table.unwrap().unwrap("Table").rows.size(), 2n));
    });

    test("creates table with struct field using value function", $ => {
        // Struct fields require a value function to extract a sortable value
        const data = $.let(East.value([
            { name: "Project A", metadata: { priority: 1n, owner: "Alice" } },
            { name: "Project B", metadata: { priority: 3n, owner: "Bob" } },
        ]));
        const table = $.let(Table.Root(
            data,
            {
                name: { header: "Name" },
                metadata: {
                    header: "Priority",
                    // Extract priority as sortable integer value (plain expression, not wrapped in variant)
                    value: (meta) => meta.priority,
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`Priority: ${row.metadata.priority}`);
                    }),
                },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 2n));
        $(Assert.equal(table.unwrap().unwrap("Table").rows.size(), 2n));
    });

    test("creates table with array field extracting string value", $ => {
        // Extract first tag as string value for sorting
        const data = $.let(East.value([
            { name: "Alice", skills: ["TypeScript", "React", "Node"] },
            { name: "Bob", skills: ["Python", "Django"] },
        ]));
        const table = $.let(Table.Root(
            data,
            {
                name: { header: "Name" },
                skills: {
                    header: "Primary Skill",
                    // Extract first skill as sortable string value (plain expression)
                    value: (skills) => skills.get(0n),
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Badge.Root(row.skills.get(0n), { variant: "subtle" });
                    }),
                },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 2n));
    });

    test("creates table mixing primitive and complex columns", $ => {
        // Mix of primitive fields (no value function needed) and complex fields (value function required)
        const data = $.let(East.value([
            { id: 1n, name: "Alice", contact: { email: "alice@example.com", phone: "555-1234" } },
            { id: 2n, name: "Bob", contact: { email: "bob@example.com", phone: "555-5678" } },
        ]));
        const table = $.let(Table.Root(
            data,
            {
                id: { header: "ID" },  // Primitive - no value function needed
                name: { header: "Name" },  // Primitive - no value function needed
                contact: {
                    header: "Contact",
                    // Extract email as sortable string value (plain expression)
                    value: (contact) => contact.email,
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(row.contact.email);
                    }),
                },
            }
        ));

        $(Assert.equal(table.unwrap().unwrap("Table").columns.size(), 3n));
        $(Assert.equal(table.unwrap().unwrap("Table").rows.size(), 2n));
    });

    // =========================================================================
    // Plan 1.10 K — IR roundtrip coverage for newly-wired fields
    // =========================================================================

    test("footer dict round-trips with content + colSpan", $ => {
        const t = $.let(Table.Root(
            [{ a: "1", b: "2" }],
            { a: { header: "A" }, b: { header: "B" } },
            {
                footer: {
                    a: { content: Text.Root("Total"), colSpan: 1n },
                    b: { content: Text.Root("3") },
                },
            },
        ));
        const footer = $.let(t.unwrap().unwrap("Table").footer.unwrap("some"));
        $(Assert.equal(footer.size(), 2n));
        $(Assert.equal(footer.get("a").colSpan.unwrap("some"), 1n));
        $(Assert.equal(footer.get("a").content.unwrap().hasTag("Text"), true));
    });

    test("footerRows array round-trips multiple rows", $ => {
        const t = $.let(Table.Root(
            [{ a: "x", b: "y" }],
            { a: { header: "A" }, b: { header: "B" } },
            {
                footerRows: [
                    { a: { content: Text.Root("Subtotal"), colSpan: 1n }, b: { content: Text.Root("10") } },
                    { a: { content: Text.Root("Total"), colSpan: 1n }, b: { content: Text.Root("100") } },
                ],
            },
        ));
        const footerRows = $.let(t.unwrap().unwrap("Table").footerRows.unwrap("some"));
        $(Assert.equal(footerRows.size(), 2n));
        $(Assert.equal(footerRows.get(0n).get("b").content.unwrap().hasTag("Text"), true));
        $(Assert.equal(footerRows.get(1n).get("a").colSpan.unwrap("some"), 1n));
    });

    test("columnGroups round-trip with label + columnKeys", $ => {
        const t = $.let(Table.Root(
            [{ a: 1n, b: 2n, c: 3n }],
            { a: { header: "A" }, b: { header: "B" }, c: { header: "C" } },
            {
                columnGroups: [
                    { label: "First", columnKeys: ["a"] },
                    { label: "Rest", columnKeys: ["b", "c"] },
                ],
            },
        ));
        const groups = $.let(t.unwrap().unwrap("Table").columnGroups.unwrap("some"));
        $(Assert.equal(groups.size(), 2n));
        $(Assert.equal(groups.get(0n).label, "First"));
        $(Assert.equal(groups.get(1n).columnKeys.size(), 2n));
        $(Assert.equal(groups.get(1n).columnKeys.get(0n), "b"));
    });

    test("pagination struct round-trips pageSize / page / onPageChange", $ => {
        const onPageChange = East.function([IntegerType], NullType, (_$, _next) => { /* noop */ });
        const t = $.let(Table.Root(
            [{ a: "x" }],
            { a: { header: "A" } },
            {
                pagination: { pageSize: 25n, page: 2n, onPageChange },
            },
        ));
        const pag = $.let(t.unwrap().unwrap("Table").pagination.unwrap("some"));
        $(Assert.equal(pag.pageSize, 25n));
        $(Assert.equal(pag.page, 2n));
    });

    test("selection round-trips single mode + selected array + onChange", $ => {
        const onChange = East.function([ArrayType(IntegerType)], NullType, (_$, _idxs) => { /* noop */ });
        const t = $.let(Table.Root(
            [{ a: "x" }, { a: "y" }],
            { a: { header: "A" } },
            {
                selection: { mode: "single", selected: [0n], onChange },
            },
        ));
        const sel = $.let(t.unwrap().unwrap("Table").selection.unwrap("some"));
        $(Assert.equal(sel.mode.hasTag("single"), true));
        $(Assert.equal(sel.selected.size(), 1n));
        $(Assert.equal(sel.selected.get(0n), 0n));
    });

    test("selection round-trips multiple mode", $ => {
        const onChange = East.function([ArrayType(IntegerType)], NullType, (_$, _idxs) => { /* noop */ });
        const t = $.let(Table.Root(
            [{ a: "x" }, { a: "y" }, { a: "z" }],
            { a: { header: "A" } },
            {
                selection: { mode: "multiple", selected: [0n, 2n], onChange },
            },
        ));
        const sel = $.let(t.unwrap().unwrap("Table").selection.unwrap("some"));
        $(Assert.equal(sel.mode.hasTag("multiple"), true));
        $(Assert.equal(sel.selected.size(), 2n));
    });

    test("selection round-trips range mode", $ => {
        const onChange = East.function([ArrayType(IntegerType)], NullType, (_$, _idxs) => { /* noop */ });
        const t = $.let(Table.Root(
            [{ a: "x" }, { a: "y" }, { a: "z" }],
            { a: { header: "A" } },
            {
                selection: { mode: "range", selected: [], onChange },
            },
        ));
        const sel = $.let(t.unwrap().unwrap("Table").selection.unwrap("some"));
        $(Assert.equal(sel.mode.hasTag("range"), true));
        $(Assert.equal(sel.selected.size(), 0n));
    });

    test("expandedContent round-trips as some(callback)", $ => {
        const t = $.let(Table.Root(
            [{ a: "x" }],
            { a: { header: "A" } },
            {
                expandedContent: East.function([IntegerType], UIComponentType, (_$, _i) => Text.Root("detail")),
            },
        ));
        $(Assert.equal(t.unwrap().unwrap("Table").expandedContent.hasTag("some"), true));
    });

    test("density compact round-trips as variant tag", $ => {
        const t = $.let(Table.Root(
            [{ a: "x" }],
            { a: { header: "A" } },
            { density: "compact" },
        ));
        const den = $.let(t.unwrap().unwrap("Table").density.unwrap("some"));
        $(Assert.equal(den.hasTag("compact"), true));
    });

    test("density comfortable round-trips as variant tag", $ => {
        const t = $.let(Table.Root(
            [{ a: "x" }],
            { a: { header: "A" } },
            { density: "comfortable" },
        ));
        const den = $.let(t.unwrap().unwrap("Table").density.unwrap("some"));
        $(Assert.equal(den.hasTag("comfortable"), true));
    });

    test("rowStatus callback round-trips on main struct", $ => {
        const rowStatus = East.function([IntegerType], Style.Types.StatusToken, (_$, _i) => Style.StatusToken("success"));
        const t = $.let(Table.Root(
            [{ a: "x" }],
            { a: { header: "A" } },
            { rowStatus },
        ));
        $(Assert.equal(t.unwrap().unwrap("Table").rowStatus.hasTag("some"), true));
    });

    test("columnResize flag round-trips when explicit", $ => {
        const t = $.let(Table.Root(
            [{ a: "x" }],
            { a: { header: "A" } },
            { columnResize: false },
        ));
        $(Assert.equal(t.unwrap().unwrap("Table").columnResize.unwrap("some"), false));
    });

    test("virtualization flag round-trips when explicit", $ => {
        const t = $.let(Table.Root(
            [{ a: "x" }],
            { a: { header: "A" } },
            { virtualization: false },
        ));
        $(Assert.equal(t.unwrap().unwrap("Table").virtualization.unwrap("some"), false));
    });

    test("colour overrides round-trip via style sub-struct", $ => {
        const t = $.let(Table.Root(
            [{ a: "x" }],
            { a: { header: "A" } },
            {
                headerBackground: "blue.600",
                headerColor: "white",
                borderColor: "blue.200",
                zebraBackground: "blue.50",
                hoverBackground: "blue.100",
                selectedBackground: "blue.200",
                selectedBorderColor: "blue.400",
                footerBackground: "gray.100",
            },
        ));
        const style = $.let(t.unwrap().unwrap("Table").style.unwrap("some"));
        $(Assert.equal(style.headerBackground.unwrap("some"), "blue.600"));
        $(Assert.equal(style.headerColor.unwrap("some"), "white"));
        $(Assert.equal(style.borderColor.unwrap("some"), "blue.200"));
        $(Assert.equal(style.zebraBackground.unwrap("some"), "blue.50"));
        $(Assert.equal(style.hoverBackground.unwrap("some"), "blue.100"));
        $(Assert.equal(style.selectedBackground.unwrap("some"), "blue.200"));
        $(Assert.equal(style.selectedBorderColor.unwrap("some"), "blue.400"));
        $(Assert.equal(style.footerBackground.unwrap("some"), "gray.100"));
    });

    test("review chrome + accessors encode via the shared contract over the UNSLICED index (#264)", $ => {
        const onApprove = $.const(East.function([Table.Types.ApproveEvent], NullType, _$ => null));
        const reviewApproval = $.const(East.function([IntegerType], OptionType(Table.Types.Approval), ($, rowIndex) =>
            rowIndex.modulo(3n).equals(1n).ifElse(
                _$ => East.value(some(variant("pending", null)), OptionType(Table.Types.Approval)),
                _$ => East.value(some(variant("approved", null)), OptionType(Table.Types.Approval)),
            )));
        const table = $.let(Table.Root(
            East.Array.range(0n, 60n).map((_$, i) => ({ id: East.print(i) })),
            { id: { header: "ID" } },
            {
                pagination: { pageSize: 20n, page: 1n, onPageChange: East.function([IntegerType], NullType, _$ => null) },
                review: { onApprove, onApproveAll: East.function([], NullType, _$ => null) },
                reviewApproval,
            },
        ));
        const root = $.let(table.unwrap().unwrap("Table"));

        const review = $.let(root.review.unwrap("some"));
        $(Assert.equal(review.columnLabel, "Decision"));
        $(Assert.equal(review.onApprove.hasTag("some"), true));
        $(Assert.equal(review.onApproveAll.hasTag("some"), true));
        // The accessor's domain is the UNSLICED row index — page 2's first row
        // is rowIndex 20 (the expandedContent convention), and the accessor
        // answers for it directly.
        const approvalFor = $.let(root.reviewApproval.unwrap("some"));
        $(Assert.equal(approvalFor(20n).unwrap("some").hasTag("approved"), true));
        $(Assert.equal(approvalFor(22n).unwrap("some").hasTag("pending"), true));
        $(Assert.equal(root.reviewStatus.hasTag("none"), true));
    });
}, {   platformFns: TestImpl,});
