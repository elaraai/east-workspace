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
    status: "Active",
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
    keywords: ["Table", "Root", "header", "width", "minWidth", "maxWidth", "value", "render", "complex", "array", "struct", "capture", "closure", "rowIndex", "full row", "CellRenderContext", "Dict", "Tag", "wrap", "frozen", "pin", "scroll", "columnGroups", "nested", "category", "header row", "footerRows", "subtotal", "grand total", "multi-row", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Column-system configurator — columns axis (widths / complex full-row render / wrapping tags) plus frozen / groups / footer switches on one live table; one structure previews at a time",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const complexData = $.let(TABLE_COMPLEX_COLUMNS_DATA);
            const metricsData = $.let(TABLE_WRAPPING_TAGS_DATA);
            const columnSets = $.const(["widths", "complex", "tags"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "table_columns_preset", "widths"));
            const frozenBind = $.let(State.bind([BooleanType], "table_columns_frozen", false));
            const groupsBind = $.let(State.bind([BooleanType], "table_columns_groups", false));
            const footerBind = $.let(State.bind([BooleanType], "table_columns_footer", false));

            const cKey = $.let(presetBind.read());
            const frozenOn = $.let(frozenBind.read());
            const groupsOn = $.let(groupsBind.read());
            const footerOn = $.let(footerBind.read());

            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onFrozen = $.const(East.function([BooleanType], NullType, ($, next) => { $(frozenBind.write(next)); }));
            const onGroups = $.const(East.function([BooleanType], NullType, ($, next) => { $(groupsBind.write(next)); }));
            const onFooter = $.const(East.function([BooleanType], NullType, ($, next) => { $(footerBind.write(next)); }));

            // One prebuilt table per column mechanic — the structure switches
            // take priority (frozen > groups > footer), then the columns axis
            // picks among the header-config presets.
            const preview = $.const(frozenOn.ifElse(
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
                _$ => groupsOn.ifElse(
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
                    _$ => footerOn.ifElse(
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
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Columns", cKey,
                            <SegmentGroup value={cKey} onChange={onPreset} size="sm"
                                items={columnSets.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        // A Slot, not a Control: the three switches report as
                        // the Structure spec row below rather than as one value.
                        Configurator.Slot("Structure",
                            <HStack gap="5" align="center">
                                <Switch checked={frozenOn} label="Frozen" onChange={onFrozen} />
                                <Switch checked={groupsOn} label="Groups" onChange={onGroups} />
                                <Switch checked={footerOn} label="Footer" onChange={onFooter} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Structure", frozenOn.ifElse(
                            _$ => "frozen columns",
                            _$ => groupsOn.ifElse(
                                _$ => "column groups",
                                _$ => footerOn.ifElse(_$ => "footer rows", _$ => "column preset")))),
                        Configurator.Spec("Columns", cKey),
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
    keywords: ["Table", "Root", "striped", "alternating", "render", "Badge", "CellRenderContext", "density", "compact", "minimal", "rowHeight", "pixel", "override", "virtualization", "rowStatus", "StatusToken", "tint", "theme-agnostic", "Reactive", "State", "onRowClick", "onCellClick", "onSortChange", "interactive", "pagination", "page", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Table style configurator — density, badge and row-height axes plus striped / paginated / row-status switches over one live 1000-row table; every callback logs to the aside",
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
            const rowHeights = $.const(["auto", "48", "64"], ArrayType(StringType));

            const stripedBind = $.let(State.bind([BooleanType], "table_striped", true));
            const densityBind = $.let(State.bind([StringType], "table_density", "compact"));
            const badgeBind = $.let(State.bind([StringType], "table_badge", "solid"));
            const rhBind = $.let(State.bind([StringType], "table_rowheight", "auto"));
            const paginatedBind = $.let(State.bind([BooleanType], "table_paginated", false));
            const statusBind = $.let(State.bind([BooleanType], "table_rowstatus", false));
            const pageBind = $.let(State.bind([IntegerType], "table_page", 0n));
            const lastEventBind = $.let(State.bind([StringType], "table_last_event", ""));

            const stripedOn = $.let(stripedBind.read());
            const dKey = $.let(densityBind.read());
            const bKey = $.let(badgeBind.read());
            const rhKey = $.let(rhBind.read());
            const pagOn = $.let(paginatedBind.read());
            const statusOn = $.let(statusBind.read());
            const page = $.let(pageBind.read());
            const lastEvent = $.let(lastEventBind.read());

            const onStriped = $.const(East.function([BooleanType], NullType, ($, next) => { $(stripedBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onBadge = $.const(East.function([StringType], NullType, ($, next) => { $(badgeBind.write(next)); }));
            const onRowHeight = $.const(East.function([StringType], NullType, ($, next) => { $(rhBind.write(next)); }));
            const onPaginated = $.const(East.function([BooleanType], NullType, ($, next) => { $(paginatedBind.write(next)); }));
            const onRowStatus = $.const(East.function([BooleanType], NullType, ($, next) => { $(statusBind.write(next)); }));
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
            const rhPx = $.let(rhKey.equal("48").ifElse(_$ => 48n, _$ => 64n));

            // The badge axis drives the status column's render live — the
            // render captures only data (the selected variant value).
            const badgeRender = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) => (
                <Badge variant={badgeSel} colorPalette="brand">{ctx.cellValue.match({ String: (_$2, v) => v }, _$2 => "")}</Badge>
            )));

            // rowStatus / pagination / rowHeight presence is host-side, so the
            // switches pick between prebuilt tables (the cardVariants leaf
            // precedent); striped / density / badge stay live in every arm.
            const preview = $.const(pagOn.ifElse(
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
                _$ => statusOn.ifElse(
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
                    _$ => rhKey.equal("auto").ifElse(
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
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Badge", bKey,
                            <SegmentGroup value={bKey} onChange={onBadge} size="sm"
                                items={badgeVariants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Row height", rhKey,
                            <SegmentGroup value={rhKey} onChange={onRowHeight} size="sm"
                                items={rowHeights.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        // A Slot, not a Control: the three switches report as
                        // the Preview spec row below rather than as one value.
                        Configurator.Slot("Rows",
                            <HStack gap="5" align="center">
                                <Switch checked={stripedOn} label="Striped" onChange={onStriped} />
                                <Switch checked={pagOn} label="Paginated" onChange={onPaginated} />
                                <Switch checked={statusOn} label="Row status" onChange={onRowStatus} />
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
                        Configurator.Spec("Preview", pagOn.ifElse(
                            _$ => "paginated",
                            _$ => statusOn.ifElse(
                                _$ => "row status",
                                _$ => rhKey.equal("auto").ifElse(_$ => "virtualized", _$ => "row height")))),
                        Configurator.Spec("Rows", pagOn.ifElse(_$ => "1000 · paged 20", _$ => "1000 · virtualized")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Selection configurator — one table whose `selection.mode` flips between
 * multiple and range from the Mode control; each mode's selection mirrors its
 * own State array so switching modes preserves each mode's selection.
 */
export const tableSelection = example({
    keywords: ["Table", "Root", "selection", "multiple", "checkbox", "Reactive", "State", "range", "shift-click", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Table selection configurator — a selection-mode axis (multiple / range) driving one live State-bound table; each mode mirrors its own State array and the spec reads both counts back",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Enumerated axes are just their variants — `getTag()` gives the
            // segment key AND its label, so there is no parallel table to
            // keep in step.
            const modes = $.const([
                variant("multiple", null), variant("range", null),
            ], ArrayType(Table.Types.SelectionMode));

            const modeBind = $.let(State.bind([StringType], "table_selection_mode", "multiple"));
            const mode = $.let(modeBind.read());
            const multiBind = $.let(State.bind([ArrayType(IntegerType)], "table_multi_selected", []));
            const multiSelected = $.let(multiBind.read(), ArrayType(IntegerType));
            const rangeBind = $.let(State.bind([ArrayType(IntegerType)], "table_range_selected", []));
            const rangeSelected = $.let(rangeBind.read(), ArrayType(IntegerType));
            const onModeChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(modeBind.write(next));
            }));
            // The active mode routes reads + writes to its own bind.
            const selected = $.let(mode.equal("range").ifElse(_$ => rangeSelected, _$ => multiSelected), ArrayType(IntegerType));
            const onChange = $.const(East.function([ArrayType(IntegerType)], NullType, ($, next) => {
                const m = $.let(modeBind.read());
                $(m.equal("range").ifElse(_$ => rangeBind.write(next), _$ => multiBind.write(next)));
            }));
            // The selection is a lookup into the same array the control renders.
            const selectionMode = $.let(modes.filter((_$, v) => v.getTag().equal(mode)).get(0n));
            return (
                <Configurator
                    controls={[
                        Configurator.Control("Mode", mode,
                            <SegmentGroup value={mode} onChange={onModeChange} size="sm"
                                items={modes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                    ]}
                    preview={
                        <Table
                            variant="line"
                            striped={true}
                            selection={{ mode: selectionMode, selected, onChange }}
                            selectedBackground={mode.equal("range").ifElse(_$ => "bg.info.subtle", _$ => "bg.brand.subtle")}
                            selectedBorderColor={mode.equal("range").ifElse(_$ => "border.subtle", _$ => "border.brand")}
                            data={TABLE_SELECTION_DATA}
                            columns={{ name: { header: "Name" }, role: { header: "Role" } }}
                        />
                    }
                    spec={[
                        // Each mode's count reads its own State array, so both
                        // readouts stay live while the other mode is parked.
                        Configurator.Spec("Multiple selected", East.print(multiSelected.size())),
                        Configurator.Spec("Range size", East.print(rangeSelected.size())),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Review chrome pair (#264) — the shared per-row Approve / Reject Decision
 * column (a pinned-right column) plus the commitBar batch foot, identical to
 * the Planner's, on an order-exceptions table (flagged rows rest `pending`
 * with a quiet warning dot; clean rows rest `approved`); and the same chrome
 * composed with the pager — the review foot stacks BELOW the pagination band,
 * and every review callback / accessor receives the UNSLICED row index (page
 * 2's first row is rowIndex 20, not 0 — the `expandedContent` convention), so
 * approvals map straight back to the source data under paging AND sorting.
 */
export const tableReview = example({
    keywords: ["Table", "review", "approve", "reject", "approval", "decision", "batch", "rerun", "status", "row", "exception", "pagination", "rowIndex", "unsliced", "page", "foot"],
    description: "Review chrome pair — per-row Decision column + commitBar batch foot on an order-exceptions table, and the same chrome under pagination (unsliced rowIndex: page 2 row 0 is rowIndex 20, foot below the pager band)",
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
            <VStack gap="4" align="stretch">
                <Separator label="REVIEW" align="start" />
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
                <Separator label="REVIEW PAGINATED" align="start" />
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
                    const reviewApprovalPaged = $.const(East.function([IntegerType], OptionType(Table.Types.Approval), (_$, _rowIndex) =>
                        some(variant("pending", null))));
                    const last = $.let(lastBind.read());
                    return (
                        <VStack gap="3" align="stretch">
                            <Table
                                variant="line"
                                pagination={{ pageSize: 20n, page, onPageChange }}
                                data={East.Array.range(0n, 200n).map((_$, i) => ({
                                    id: East.str`#${i}`,
                                    name: East.str`Order ${i}`,
                                }))}
                                columns={{ id: { header: "ID" }, name: { header: "Name" } }}
                                review={{ onApprove, onApproveAll: East.function([], NullType, _$ => null) }}
                                reviewApproval={reviewApprovalPaged}
                            />
                            <Text.MonoLabel>{East.str`LAST · ${last}`}</Text.MonoLabel>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
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
                data={rows}
                columns={{ name: { header: "Sales rep" }, region: { header: "Region" } }}
            />
        );
    }),
    inputs: [],
});

export const tableFill = example({
    keywords: ["Table", "fill", "height", "Box", "scroll", "virtual", "sizing", "#320"],
    description: "height=\"fill\" (#320) — the table fills a fixed 220px Box and scrolls within it; two hundred rows overflow the box so only the visible rows mount, with the header pinned",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box height="220px">
                <Table
                    variant="line"
                    striped={true}
                    height="fill"
                    data={East.Array.range(0n, 200n).map((_$, i) => ({
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
            </Box>
        );
    }),
    inputs: [],
});

/**
 * Nested P&L (#317) — `groupBy` folds leaf accounts into collapsible group
 * header rows: section (Revenue / Cost of sales / Operating expenses) →
 * category → account. Columns with `aggregate: "sum"` put subtotals on each
 * group row, so a COLLAPSED group reads as its subtotal line (drill up) and
 * expanding drills down; `aggregateRender` gives subtotals the members'
 * currency treatment. Sections keep statement order under any sort (groups
 * hold first-appearance data order; sorting reorders within groups). The
 * grand-total Net income line rides `footerRows`.
 */
export const tablePnlGrouped = example({
    keywords: ["Table", "groupBy", "rowGroups", "group", "collapse", "expand", "aggregate", "sum", "subtotal", "P&L", "statement", "accounting", "nested", "drill", "#317"],
    description: "Nested P&L (#317) — groupBy [section, category] folds accounts into collapsible group rows; sum aggregates render as currency subtotals on the group headers (a collapsed group reads as its subtotal line); categories start collapsed, Net income rides footerRows",
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
                    { section: "Revenue", category: "Product sales", account: "Direct sales", q1: 45500.0, q2: 61000.0, q3: 74000.0, q4: 66500.0, fy: 247000.0 },
                    { section: "Revenue", category: "Services", account: "Consulting", q1: 18500.0, q2: 27000.0, q3: 33500.0, q4: 24000.0, fy: 103000.0 },
                    { section: "Revenue", category: "Services", account: "Subscriptions", q1: 22000.0, q2: 12500.0, q3: 9000.0, q4: 19500.0, fy: 63000.0 },
                    { section: "Cost of sales", category: "Materials", account: "Raw materials", q1: 62000.0, q2: 58000.0, q3: 44000.0, q4: 71000.0, fy: 235000.0 },
                    { section: "Cost of sales", category: "Materials", account: "Freight & duty", q1: 38500.0, q2: 42000.0, q3: 31000.0, q4: 47500.0, fy: 159000.0 },
                    { section: "Cost of sales", category: "Production", account: "Equipment & maintenance", q1: 24000.0, q2: 18500.0, q3: 21000.0, q4: 26500.0, fy: 90000.0 },
                    { section: "Cost of sales", category: "Production", account: "Packaging", q1: 41000.0, q2: 46500.0, q3: 39000.0, q4: 52500.0, fy: 179000.0 },
                    { section: "Cost of sales", category: "Production", account: "Direct labour", q1: 55000.0, q2: 55000.0, q3: 57500.0, q4: 57500.0, fy: 225000.0 },
                    { section: "Operating expenses", category: "Sales & marketing", account: "Distribution", q1: 28000.0, q2: 31500.0, q3: 27000.0, q4: 36500.0, fy: 123000.0 },
                    { section: "Operating expenses", category: "Sales & marketing", account: "Marketing", q1: 19500.0, q2: 22000.0, q3: 30500.0, q4: 28000.0, fy: 100000.0 },
                    { section: "Operating expenses", category: "Administration", account: "Insurance", q1: 12500.0, q2: 12500.0, q3: 12500.0, q4: 12500.0, fy: 50000.0 },
                    { section: "Operating expenses", category: "Administration", account: "Utilities", q1: 9000.0, q2: 8500.0, q3: 10000.0, q4: 11500.0, fy: 39000.0 },
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
                    // Net income = Revenue - Cost of sales - Operating expenses (per quarter).
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
