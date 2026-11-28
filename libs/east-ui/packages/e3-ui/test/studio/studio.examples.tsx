/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * The Studio (#787) as a solution writes it — the design of record: the data
 * its components read (`studio-data.ts`, each re-exported here), the
 * components it offers, the one pages record its
 * operators build, and the three surfaces it mounts: the builder, the page
 * library and a published page. The record holds the mock of record's resting
 * state: the Ops console's Overview, live as v3 and drafted since, and the page
 * library's projects, pages and templates — each entry written with
 * `Studio.value` (#1759), some of them tagged — and declares the indexes a
 * page lists and narrows its entries by. A second record holds a page whose
 * placements hold content (#1669) — a text block and visuals over the two
 * sources the surface lists — and declares the steps that carry a workspace's
 * pages from the types earlier releases stored them as. A third holds a page of every form
 * a visual draws (#1671), over two years of a trade supplier's orders, its
 * readers starting in the latest quarter; a fourth, a page of the options a
 * chart and a value take (#1672).
 */

import {
    ArrayType, DateTimeType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    example, none, parseJq, some, variant,
} from "@elaraai/east";
import {
    BarStrip, Box, Button, Chart, Format, Grid, HStack, MetricChip, Reactive, Slice, Table, Sparkline, Stat, State, Text, UIComponentType, VStack,
} from "@elaraai/east-ui";
import { Data, Record, Studio } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import {
    studioAreas, studioAssignmentsToday, studioKpis, studioOrdersWeekly, studioPeople, studioReturns, studioRevenueDaily,
    studioRotaWeek, studioSales, studioShifts, studioVisitsDaily,
} from "./studio-data.js";

// ============================================================================
// The data — what the components read (`studio-data.ts`)
// ============================================================================

export {
    studioAreas, studioAssignmentsToday, studioKpis, studioOrdersWeekly, studioPeople, studioReturns, studioRevenueDaily,
    studioRotaWeek, studioSales, studioShifts, studioVisitsDaily,
};

// ============================================================================
// The components — what the surfaces offer, each a self-contained East UI function
// ============================================================================

/**
 * The KPI rail's code: the week's four figures, each with its change on last week — four abreast where four of
 * 170px fit, else two and two, else one above another, so no row stands short beside an empty cell.
 */
const kpiRailUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const kpis = $.let(Data.bind(studioKpis).read());
        return (
            <Box background="border.subtle"><Grid gap="1px" templateColumns="repeat(auto-fit, minmax(max(calc(25% - 1px), min(calc(50% - 1px), calc((683px - 100%) * 999)), min(100%, calc((341px - 100%) * 999))), 1fr))" items={kpis.map(($2, k) => Grid.Item(
                    <Box background="bg.surface"
                        padding={{ top: some("3"), right: some("4"), bottom: some("3"), left: some("4") }}>
                        <Stat label={k.label} value={k.value}
                            format={k.unit.match({
                                money: (_$3) => Format.Currency({ currency: "USD", compact: "short", maximumFractionDigits: 2n }),
                                count: (_$3) => Format.Number(),
                                price: (_$3) => Format.Currency({ currency: "USD", maximumFractionDigits: 0n }),
                                ratio: (_$3) => Format.Percent({ maximumFractionDigits: 0n }),
                            })}
                            baseline={
                                <MetricChip tone={k.change.greater(0.0).ifElse(
                                    _$3 => variant("positive", null),
                                    _$3 => k.change.less(0.0).ifElse(_$4 => variant("negative", null), _$4 => variant("neutral", null)),
                                )}>
                                    <Text>{k.change.greater(0.0).ifElse(
                                        _$3 => East.str`▲ ${East.print(k.change)}%`,
                                        _$3 => k.change.less(0.0).ifElse(
                                            _$4 => East.str`▼ ${East.print(k.change.negate())}%`,
                                            _$4 => "— flat",
                                        ),
                                    )}</Text>
                                </MetricChip>
                            } />
                    </Box>,
            ))} /></Box>
        );
    }}</Reactive>
));

/** The Revenue trend's code: revenue by day, as an area. */
const revenueTrendUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const days = $.let(Data.bind(studioRevenueDaily).read());
        return (
            <Box height="168px" padding={{ top: some("4"), right: some("4"), bottom: some("3"), left: some("3") }}>
                <Chart height="fill" grid
                    layers={Chart.Area(days, { x: r => r.day, y: r => r.revenue }, { color: "brand.solid", fillOpacity: 0.08, curve: "linear" })}
                    x={{ format: Chart.format.date("MMM D") }}
                    y={{ format: Chart.format.compact() }} />
            </Box>
        );
    }}</Reactive>
));

/** The Breakdown bars' code: each region's share of this week's revenue, largest first. */
const breakdownBarsUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const sales = $.let(Data.bind(studioSales).read());
        const total = $.let(sales.map(($2, r) => r.revenue).sum());
        const regions = $.let(sales
            .groupSum(($2, r) => r.region, ($2, r) => r.revenue)
            .toArray(($2, revenue, region) => ({ region, revenue })));
        return (
            <Box padding="4">
                <BarStrip data={regions} sort="desc" showValues={false}
                    item={r => ({
                        label: <Text>{r.region}</Text>,
                        value: r.revenue,
                        trailing: <Text>{East.str`${East.print(East.Float.roundHalf(r.revenue.divide(total).multiply(100.0)))}%`}</Text>,
                    })} />
            </Box>
        );
    }}</Reactive>
));

/** The Orders by week's code: orders placed each week. */
const ordersByWeekUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const weeks = $.let(Data.bind(studioOrdersWeekly).read());
        return (
            <Box height="168px" padding={{ top: some("4"), right: some("4"), bottom: some("3"), left: some("3") }}>
                <Chart height="fill" grid layers={Chart.Column(weeks, { x: r => r.week, y: r => r.orders }, { color: "brand.solid" })} />
            </Box>
        );
    }}</Reactive>
));

/** The Visits sparkline's code: visits by day. */
const visitsSparklineUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const visits = $.let(Data.bind(studioVisitsDaily).read());
        return (
            <Box padding="4">
                <Sparkline data={visits.map(($2, r) => r.visits)} type="area" width="100%" height="48px" />
            </Box>
        );
    }}</Reactive>
));

/** Today's assignments as a read-only table using the shared collection. */
const assignmentBoardUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const areas = $.let(Data.bind(studioAreas).read().toDict((_$2, area) => area.id, (_$2, area) => area.name));
        const shifts = $.let(Data.bind(studioShifts).read().toDict((_$2, shift) => shift.id, (_$2, shift) => shift.name));
        const people = $.let(Data.bind(studioPeople).read().toDict((_$2, person) => person.id, (_$2, person) => person.name));
        const today = $.let(Data.bind(studioAssignmentsToday).read());
        return <Table data={today.map((_$2, row) => ({ person: people.get(row.person), area: areas.get(row.area), shift: shifts.get(row.shift) }))} columns={["person", "area", "shift"]} />;
    }}</Reactive>
));

/** The week's shifts as a read-only table; editable rostering belongs to e3-ui. */
const shiftRosterUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const people = $.let(Data.bind(studioPeople).read().toDict((_$2, person) => person.id, (_$2, person) => person.name));
        const rota = $.let(Data.bind(studioRotaWeek).read());
        return <Table data={rota.map((_$2, row) => ({ person: people.get(row.person), day: row.day, hours: row.hours }))} columns={["person", "day", "hours"]} />;
    }}</Reactive>
));

export const kpiRail = Studio.component("kpi_rail", {
    name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none",
    description: "Revenue, orders, average ticket and fill rate this week, each with its change on last week.",
    tags: ["kpi", "sales"],
}, kpiRailUi);

export const breakdownBars = Studio.component("breakdown_bars", {
    name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n,
    description: "Each region's share of this week's revenue, largest first.",
    tags: ["sales"],
}, breakdownBarsUi);

export const revenueTrend = Studio.component("revenue_trend", {
    name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n,
    description: "Revenue by day, as an area.",
    tags: ["sales"],
}, revenueTrendUi);

export const ordersByWeek = Studio.component("orders_by_week", {
    name: "Orders by week", category: "Charts", icon: "chart-column", span: 6n,
    description: "Orders placed each week.",
    tags: ["orders"],
}, ordersByWeekUi);

export const visitsSparkline = Studio.component("visits_sparkline", {
    name: "Visits sparkline", category: "Charts", icon: "chart-line", span: 4n,
    description: "Visits by day, the last two weeks.",
    tags: ["traffic"],
}, visitsSparklineUi);

export const assignmentBoard = Studio.component("assignment_board", {
    name: "Assignment board", category: "Collections", icon: "border-all", span: 12n,
    description: "Today: who works where, by shift.",
    collections: ["People"],
}, assignmentBoardUi);

export const shiftRoster = Studio.component("shift_roster", {
    name: "Shift roster", category: "Collections", icon: "calendar-week", span: 12n,
    description: "This week: people, days and their assigned hours.",
    collections: ["People"],
}, shiftRosterUi);

// ============================================================================
// The pages — the one record the operators build
// ============================================================================

/**
 * The pages record: the Ops console's pages — the Overview live as v3, its
 * draft resizing the trend and adding the bars beside it — and its templates,
 * and the other projects' pages. Its indexes are each led by what an entry is,
 * so the pages and the templates are read apart: by its kind alone — how one
 * is found among its kind's by its key — by project, by tag — an entry filed
 * once under each tag it holds — and by title.
 */
export const studioPages = e3.record("studio_pages", Studio.Types.Pages, {
    initial: Studio.value([
        {
            key: { project: "Ops console", page: "Account detail" },
            draft: {
                title: "Account detail",
                cells: [
                    { key: "a-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "a-orders", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "orders_by_week") },
                    { key: "a-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: variant("component", "breakdown_bars") },
                    { key: "a-trend", row: "r3", span: 12n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                ],
                filters: [],
            },
        },
        {
            key: { project: "Ops console", page: "Overview" },
            tags: ["operations", "weekly"],
            draft: {
                title: "Overview",
                cells: [
                    { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "o-trend", row: "r2", span: 8n, height: none, align: variant("stretch", null), title: none, content: variant("component", "revenue_trend") },
                    { key: "o-bars", row: "r2", span: 4n, height: none, align: variant("stretch", null), title: none, content: variant("component", "breakdown_bars") },
                    { key: "o-board", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "assignment_board") },
                ],
                filters: [],
            },
            live: {
                version: 3n,
                page: {
                    title: "Overview",
                    cells: [
                        { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                        { key: "o-trend", row: "r2", span: 12n, height: none, align: variant("stretch", null), title: none, content: variant("component", "revenue_trend") },
                        { key: "o-board", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "assignment_board") },
                    ],
                    filters: [],
                },
            },
        },
        {
            key: { project: "Ops console", page: "Regional rollup" },
            tags: ["sales"],
            draft: {
                title: "Regional rollup",
                cells: [
                    { key: "r-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                    { key: "r-bars", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("By region"), content: variant("component", "breakdown_bars") },
                    { key: "r-visits", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "visits_sparkline") },
                ],
                filters: [],
            },
            live: {
                version: 1n,
                page: {
                    title: "Regional rollup",
                    cells: [
                        { key: "r-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                        { key: "r-bars", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("By region"), content: variant("component", "breakdown_bars") },
                        { key: "r-visits", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "visits_sparkline") },
                    ],
                    filters: [],
                },
            },
        },
        {
            key: { project: "Ops console", page: "Weekly export" },
            tags: ["export", "weekly"],
            draft: {
                title: "Weekly export",
                cells: [
                    { key: "w-orders", row: "r1", span: 12n, height: some(320n), align: variant("top", null), title: none, content: variant("component", "orders_by_week") },
                    { key: "w-roster", row: "r2", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "shift_roster") },
                ],
                filters: [],
            },
            live: { version: 2n, page: { title: "Weekly export", cells: [], filters: [] } },
        },
        {
            key: { project: "Ops console", page: "Ops board" },
            template: {
                title: "Ops board",
                cells: [
                    { key: "t-orders", row: "r1", span: 8n, height: some(320n), align: variant("top", null), title: none, content: variant("component", "orders_by_week") },
                    { key: "t-bars", row: "r1", span: 4n, height: some(320n), align: variant("stretch", null), title: none, content: variant("component", "breakdown_bars") },
                ],
                filters: [],
            },
        },
        {
            key: { project: "Ops console", page: "Report brief" },
            template: {
                title: "Report brief",
                cells: [
                    { key: "t-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                    { key: "t-orders", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "orders_by_week") },
                    { key: "t-visits", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "visits_sparkline") },
                ],
                filters: [],
            },
        },
        {
            key: { project: "Ops console", page: "Summary" },
            template: {
                title: "Summary",
                cells: [
                    { key: "t-kpi", row: "r1", span: 12n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "t-trend", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                    { key: "t-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: variant("component", "breakdown_bars") },
                ],
                filters: [],
            },
        },
        {
            key: { project: "Finance portal", page: "Ledger" },
            draft: {
                title: "Ledger",
                cells: [
                    { key: "l-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                ],
                filters: [],
            },
        },
        {
            key: { project: "HR roster", page: "Rota" },
            draft: {
                title: "Rota",
                cells: [
                    { key: "h-roster", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "shift_roster") },
                ],
                filters: [],
            },
            live: {
                version: 1n,
                page: {
                    title: "Rota",
                    cells: [
                        { key: "h-roster", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "shift_roster") },
                    ],
                    filters: [],
                },
            },
        },
    ]),
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
    }),
    // What a page lists and narrows the entries by, each led by what an entry is: a page or a template.
    indexes: (index) => ({
        pages_by_kind: index.on(["kind"]),
        pages_by_kind_project: index.on(["kind", "project"]),
        pages_by_kind_tag: index.on(["kind", "tags"]),
        pages_by_kind_title: index.on(["kind", "title"]),
    }),
    // A record an earlier release wrote, its entries with no fields of their own, is carried by this step — listed
    // alone: the record never listed one before it.
    migrations: (migration) => [migration.rows("entry_fields", Studio.migrations.entryFields)],
});


// ============================================================================
// The surfaces
// ============================================================================

export const studioBuilder = example({
    keywords: [
        "Studio", "Studio.Builder", "builder", "canvas", "palette", "inspector", "publish preview", "Preview", "Publish",
        "SnapGrid", "toolbar", "history", "Undo", "Save", "Save as template", "Record.bind", "patch", "e3.record",
        "mutation.patch", "Studio.component", "components", "pages", "Desktop", "Tablet", "env", "audience", "rollout",
        "Studio.value", "seed", "initial", "tags", "template", "index.on", "indexes", "kind", "project", "title",
    ],
    description: "The builder over the pages record — its pages and templates written with Studio.value (a page its `draft`, its `live` version and its `tags`; a template its `template`), its indexes led by what an entry is (`index.on([\"kind\"])`, `[\"kind\", \"project\"]`, `[\"kind\", \"tags\"]`, `[\"kind\", \"title\"]`): the Ops console's Overview on the canvas under one toolbar — its status, the zoom, the history item, Desktop · Tablet, Save as template, Preview and Publish — the palette of the seven components before it and the inspector after it; Preview and Publish open the publish preview in the canvas's place, its two changes since v3, and Exit returns; the page it shows is the surface's own state, given as `page` and changed in `onOpen` when the palette's Pages tab asks for another",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Record.bind(studioPages));
            // The open page is the surface's — the project's first to begin with: the builder shows it, and the page library below opens another.
            const open = $.let(State.bind([Studio.Types.Key], "ex.studio.open", { project: "Ops console", page: "Account detail" }));
            const go = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(open.write(key)); }));
            return (
                <Box height="760px">
                    <Studio.Builder pages={pages} components={components} project="Ops console" id="studio"
                        page={open.read()} onOpen={go}
                        env="Staging" audience="Field ops · 24 users" rollout="Immediate" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const studioBuilderMobile = example({
    keywords: ["Studio", "Studio.Builder", "builder", "mobile", "phone", "pane strip", "drawer", "palette", "inspector", "second row", "history"],
    description: "The same builder over the pages record in a phone's 390-wide frame: the toolbar over its second row — the history at 44px — the canvas the frame's whole width, and the palette and the inspector a strip of drawers along the bottom edge; given no `page`, it holds its own open page, the project's first to begin with",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Record.bind(studioPages));
            return (
                <Box width="390px" maxWidth="100%" height="760px">
                    <Studio.Builder pages={pages} components={components} project="Ops console" id="studioMobile"
                        env="Staging" audience="Field ops · 24 users" rollout="Immediate" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** A page's tiles each a column narrower, one three columns wide or less as it was: what someone else's save changes. */
const tilesNarrower = East.function([Studio.Types.Page], Studio.Types.Page, (_$, page) => ({
    title: page.title,
    cells: page.cells.map((_$2, cell) => ({
        key: cell.key, row: cell.row,
        span: cell.span.greater(3n).ifElse(() => cell.span.subtract(1n), () => cell.span),
        height: cell.height, align: cell.align, title: cell.title, content: cell.content,
    })),
    filters: page.filters,
}));

/** The pages the conflicts example edits, as the builder's start, in a record of their own so no other example's edits meet them. */
export const studioConflictPages = e3.record("studio_conflict_pages", Studio.Types.Pages, {
    initial: studioPages.default!,
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
        // Someone else's save: every page's tiles a column narrower in its draft, its templates as they were.
        elsewhere: mutation.reduce(East.function([Studio.Types.Pages], Studio.Types.Pages, ($, pages) => {
            const narrower = $.const(tilesNarrower);
            return pages.map((_$2, entry) => entry.kind.match({
                page: (_$3) => East.value({
                    kind: entry.kind, project: entry.project, title: entry.title, tags: entry.tags,
                    draft: narrower(entry.draft), live: entry.live,
                }, Studio.Types.Entry),
                template: (_$3) => entry,
            }));
        })),
    }),
    // A record an earlier release wrote, its entries with no fields of their own, is carried by this step — listed
    // alone: the record never listed one before it.
    migrations: (migration) => [migration.rows("entry_fields", Studio.migrations.entryFields)],
});

/**
 * Your edits meeting someone else's save, in one window: edit, then press
 * Someone else saves, which saves another person's change to the same pages —
 * every tile a column narrower. A tile you made wider or narrower too is a
 * conflict, waiting for you to choose; a tile you moved, aligned or made
 * taller combines with theirs. Each press saves their change again.
 */
export const studioConflicts = example({
    keywords: ["Studio", "Studio.Builder", "conflict", "conflicts", "combine", "someone else", "Choose", "tile", "span", "Record.bind", "mutate", "Button", "Save"],
    description: "Your edits meeting someone else's save, in one window — make a tile wider or narrower, then press Someone else saves, which saves another person's change to the same pages (every tile a column narrower), so yours conflict and wait to be chosen; a tile you move, align or make taller combines with theirs",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Record.bind(studioConflictPages, ["patch"]));
            const others = $.let(Record.bind(studioConflictPages, ["elsewhere"]));
            const theirs = $.const(East.function([], NullType, ($) => { $(others.mutate.elsewhere()); }));
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="3">
                        <Button variant="outline" onClick={theirs} loading={others.mutate.pending()}>Someone else saves</Button>
                        <Text color="fg.muted">Their change: every tile a column narrower</Text>
                    </HStack>
                    <Box height="760px">
                        <Studio.Builder pages={pages} components={components} project="Ops console" id="conflicts"
                            env="Staging" audience="Field ops · 24 users" rollout="Immediate" />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const studioLibrary = example({
    keywords: [
        "Studio", "Studio.Library", "page library", "pages", "templates", "cards", "grid", "wireframe", "new page", "project", "tags",
        "Slice.bindRecords", "Data.bindPaged", "scope", "kind", "indexes", "rail", "Record.bind", "patch", "e3.record", "onOpen", "page",
        "State.bind", "navigate", "Open in builder", "Library",
    ],
    description: "The page library over the same record: one toolbar — Pages · Templates, the rail over the view shown (Name, Project, Tag) and \"+ New page\" — over a responsive grid of cards, read a window at a time through the record's indexes and never whole: a page's card is a wireframe of its layout, its title, what it places, its tags, and its project and how many components it places, with \"Open in builder →\", which tells the surface in `onOpen`; a template's card starts a new page from it. A new page takes a name, its project and its tags, is one patch commit, and is then told to the surface. The surface holds the open page, which the builder above — a surface of its own — shows; this example says what it was asked to open",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            // The record bound to write a new page, and its rows paged through its indexes: the library never reads it whole.
            const pages = $.let(Record.bind(studioPages));
            const rows = $.let(Data.bindPaged(studioPages, { indexes: ["pages_by_kind", "pages_by_kind_project", "pages_by_kind_tag", "pages_by_kind_title"] }));
            // One rail over the pages and the templates, each source scoped to its kind of entry.
            const slice = $.let(Slice.bindRecords("ex.studio.library", {
                rows: {
                    source: rows, label: "Pages", scope: { kind: ["page"] }, search: ["title", "project", "tags"],
                    fields: { title: { label: "Name" }, project: { label: "Project" }, tags: { label: "Tag" } },
                },
                templates: { source: rows, label: "Templates", scope: { kind: ["template"] }, search: ["title"], fields: { title: { label: "Name" } } },
            }));
            // The open page is the surface's: the builder above shows it. A host with routes navigates here instead.
            const open = $.let(State.bind([Studio.Types.Key], "ex.studio.open", { project: "Ops console", page: "Account detail" }));
            const go = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(open.write(key)); }));
            const asked = $.let(East.str`Open in the builder: ${open.read().page}, in ${open.read().project}`);
            return (
                <VStack gap="2" align="stretch">
                    <Text color="fg.muted">{asked}</Text>
                    <Box height="720px">
                        <Studio.Library pages={pages} components={components} project="Ops console" slice={{ slice }} page={open.read()} onOpen={go} />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Content — a text block, and visuals over the sources the surface lists (#1669)
// ============================================================================

/** This week's revenue by region, as columns split by channel. */
const revenueByRegion = Studio.visual.of("sales", Studio.visual.column({
    x: Studio.visual.group("region"),
    values: [Studio.visual.sum("revenue", { label: "Revenue" })],
    split: "channel",
    stack: "stacked",
}));

/** The regions by revenue, largest first, each with a bar. */
const topRegions = Studio.visual.of("sales", Studio.visual.list({
    item: Studio.visual.group("region", { sort: "high", top: 5n }),
    values: [Studio.visual.sum("revenue")],
    bar: true,
}));

/** This week's refunds by why the items came back, the largest first. */
const refundsByReason = Studio.visual.of("returns", Studio.visual.bar({
    x: Studio.visual.group("reason", { sort: "high" }),
    values: [Studio.visual.sum("refunded")],
}));

/** How many items came back this week. */
const itemsReturned = Studio.visual.of("returns", Studio.visual.kpi({
    value: Studio.visual.sum("items", { label: "Items returned" }),
}));

/**
 * The pages of a project whose placements hold content: a text block, two
 * visuals over the sales, a developer's component, and two visuals over the
 * returns — so a filter's editor asks which dataset it is on. Its migration
 * steps carry a workspace's pages from the types earlier releases stored them
 * as: `cell_content`, for pages stored before a placement held content — each
 * component key becomes `component(key)` — then `entry_fields`, for entries
 * stored before one held what it is, its project, its title and its tags. A
 * workspace deployed fresh counts both applied.
 */
export const studioContentPages = e3.record("studio_content_pages", Studio.Types.Pages, {
    initial: Studio.value([
        {
            key: { project: "Sales desk", page: "This week" },
            draft: {
                title: "This week",
                cells: [
                    { key: "s-note", row: "r1", span: 12n, height: none, align: variant("top", null), title: none,
                        content: Studio.visual.text("Figures are to last night's close.\n\nRevenue is in US dollars, before returns.", "About these numbers") },
                    { key: "s-revenue", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: some("Revenue by region"), content: revenueByRegion },
                    { key: "s-top", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: topRegions },
                    { key: "s-kpi", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, content: Studio.visual.component("kpi_rail") },
                    { key: "s-reasons", row: "r4", span: 8n, height: some(220n), align: variant("top", null), title: some("Refunds by reason"), content: refundsByReason },
                    { key: "s-returned", row: "r4", span: 4n, height: none, align: variant("stretch", null), title: none, content: itemsReturned },
                ],
                filters: [],
            },
        },
    ]),
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
    }),
    // Pages an earlier release stored are carried by these steps, in order.
    migrations: (migration) => [
        migration.rows("cell_content", Studio.migrations.cellContent),
        migration.rows("entry_fields", Studio.migrations.entryFields),
    ],
});

export const studioContent = example({
    keywords: [
        "Studio", "Studio.source", "sources", "source", "fields", "Studio.visual", "visual", "KPI", "chart", "column", "list", "table",
        "text block", "text", "content", "Studio.Types.Content", "Studio.value", "Studio.migrations", "cellContent", "entryFields",
        "migration.rows", "migrations", "Data.bind", "Studio.Builder", "e3.record", "two sources", "datasets", "starting filters", "filter",
    ],
    description: "A page whose placements hold content: a text block, visuals over the two sources the surface lists — over the sales, revenue by region as stacked columns and the top regions as a list; over the returns, refunds by reason as bars and the items returned as a KPI — and a developer's component. The surface lists its sources with Studio.source — a bound handle, a name, an icon and its fields' labels and formats — and a filter is on one of the sources the page's visuals read: here two, so a new starting filter's editor asks which, and the rail names each source once before its chips. The page is written with Studio.value and its content built with Studio.visual, and its pages record declares the steps that carry pages an earlier release stored, in order: Studio.migrations.cellContent, for pages stored before a placement held content, then Studio.migrations.entryFields, for entries stored before one held what it is, its project, its title and its tags",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail]);
            const pages = $.let(Record.bind(studioContentPages));
            const sales = $.let(Data.bind(studioSales));
            const returns = $.let(Data.bind(studioReturns));
            return (
                <Box height="760px">
                    <Studio.Builder pages={pages} components={components} project="Sales desk" id="studioContent"
                        sources={{
                            sales: Studio.source(sales, {
                                name: "Sales", icon: "receipt", description: "One row per region per channel",
                                fields: {
                                    region: { label: "Region" },
                                    channel: { label: "Channel" },
                                    revenue: { label: "Revenue", format: { currency: { code: "USD" } } },
                                },
                            }),
                            returns: Studio.source(returns, {
                                name: "Returns", icon: "rotate-left", description: "One row per region, channel and reason",
                                fields: {
                                    region: { label: "Region" },
                                    channel: { label: "Channel" },
                                    reason: { label: "Reason" },
                                    items: { label: "Items" },
                                    refunded: { label: "Refunded", format: { currency: { code: "USD" } } },
                                },
                            }),
                        }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Visuals — every form a visual draws, from its answer (#1671)
// ============================================================================

/** One order: when it was placed, its region, category and customer, its revenue and units, and its margin — none where none was recorded. */
const OrderType = StructType({
    ordered_at: DateTimeType, region: StringType, category: StringType, customer: StringType, revenue: FloatType, units: IntegerType, margin: OptionType(FloatType),
});

/** One part of an order, drawn from its number: the number through the part's own stride, modulo a prime — so no two parts move in step. */
const drawPart = East.function([IntegerType, IntegerType], IntegerType, (_$, n, stride) => n.multiply(stride).add(stride.remainder(9_973n)).remainder(1_000_003n));

/**
 * A trade supplier's orders over two years, made from each order's number
 * alone — the same rows every time, varied as real ones are:
 *
 * - placed on a working day from 1 October 2024 to 30 September 2026, spread
 *   a couple of days either way, so no two weeks are alike;
 * - for one of fourteen customers, each as often as it buys, each in its own
 *   region — New South Wales sells the most, South Australia the least — and
 *   of one of three categories: Tools the most, then Electrical, then Garden;
 * - its units following its category's season — the garden's spring, the end
 *   of the financial year in June, the trades' summer break — and its prices
 *   rising about a tenth a year;
 * - its margin its category's, give or take, with one order in about a
 *   hundred recording none.
 */
const generateOrders = East.function([IntegerType], ArrayType(OrderType), ($, count) => {
    const draw = $.const(drawPart);
    // The Monday before the first working day, Tuesday 1 October 2024, and the working days from it to Wednesday 30 September 2026.
    const monday = $.const(new Date("2024-09-30T00:00:00Z"), DateTimeType);
    const workdays = $.const(522n);
    // The customers, each in its region, and how often each buys: of forty orders, Harbour five, Northwind four, …
    const customers = $.const(["Harbour", "Northwind", "Ironbark", "Bluewater", "Summit", "Redgum", "Kestrel", "Coastline", "Tallowood", "Saltbush", "Granite Peak", "Banksia", "Acme", "Mallee"]);
    const regions = $.const(["NSW", "NSW", "NSW", "NSW", "VIC", "VIC", "VIC", "QLD", "QLD", "QLD", "WA", "WA", "SA", "SA"]);
    const buyers = $.const([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 2n, 2n, 3n, 4n, 4n, 4n, 4n, 5n, 5n, 5n, 6n, 6n, 6n, 7n, 7n, 7n, 7n, 8n, 8n, 9n, 9n, 10n, 10n, 10n, 10n, 11n, 11n, 12n, 12n, 12n, 13n]);
    // The categories, how often each sells — of twenty orders, Tools nine, Electrical seven, Garden four — a unit's price and the margin of each.
    const categories = $.const(["Tools", "Electrical", "Garden"]);
    const sold = $.const([0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 2n, 2n, 2n, 2n]);
    const prices = $.const([11.8, 10.9, 8.7]);
    const margins = $.const([0.22, 0.16, 0.19]);
    // Each category's season, January to December: the trades slow over summer and busy before the financial year ends in June; the garden's spring.
    const seasons = $.const([
        [0.8, 0.95, 1.05, 1.0, 1.05, 1.3, 0.95, 1.0, 1.05, 1.05, 1.1, 0.75],
        [0.8, 0.95, 1.0, 1.0, 1.05, 1.25, 1.0, 1.0, 1.0, 1.05, 1.1, 0.8],
        [0.9, 0.85, 0.95, 0.85, 0.7, 0.6, 0.6, 0.85, 1.35, 1.45, 1.4, 1.05],
    ]);
    return East.Array.generate(count, OrderType, ($2, i) => {
        // Its working day: spread evenly over the two years, then a couple either way.
        const spread = $2.let(i.multiply(workdays).divide(count).add(draw(i, 390_383n).remainder(5n)).subtract(1n));
        const day = $2.let(spread.less(1n).ifElse(() => 1n, () => spread.greater(workdays).ifElse(() => workdays, () => spread)));
        const at = $2.let(monday.addDays(day.divide(5n).multiply(7n).add(day.remainder(5n))));
        const buyer = $2.let(buyers.get(draw(i, 479_909n).remainder(40n)));
        const category = $2.let(sold.get(draw(i, 350_377n).remainder(20n)));
        const season = $2.let(seasons.get(category).get(at.getMonth().subtract(1n)));
        const units = $2.let(East.Float.roundHalf(draw(i, 611_953n).remainder(150n).add(8n).toFloat().multiply(season)));
        // Prices about a tenth higher a year on, each order give or take eight in a hundred.
        const growth = $2.let(day.toFloat().divide(261.0).multiply(0.1).add(1.0));
        const noise = $2.let(draw(i, 104_729n).remainder(17n).toFloat().divide(100.0).add(0.92));
        const revenue = $2.let(East.Float.roundHalf(units.toFloat().multiply(prices.get(category)).multiply(noise).multiply(growth).multiply(100.0)).toFloat().divide(100.0));
        const margin = $2.let(East.Float.roundHalf(margins.get(category).add(draw(i, 746_773n).remainder(11n).subtract(5n).toFloat().divide(100.0)).multiply(100.0)).toFloat().divide(100.0));
        return {
            ordered_at: at,
            region: regions.get(buyer),
            category: categories.get(category),
            customer: customers.get(buyer),
            revenue,
            units,
            margin: draw(i, 821_641n).remainder(97n).equal(0n).ifElse(() => East.value(none, OptionType(FloatType)), () => some(margin)),
        };
    });
});

/** The supplier's orders, two years of them: each one's date, region, category, customer, revenue, units and margin. */
export const studioOrders = e3.input("studio_orders", ArrayType(OrderType), variant("value", East.compile(generateOrders, [])(2_920n)));

const vis = Studio.visual;

/** The orders' fields, as every page over them lists them: each one's label, and how a number of it prints. */
export const orderFields = {
    ordered_at: { label: "Ordered" },
    region: { label: "Region" },
    category: { label: "Category" },
    customer: { label: "Customer" },
    revenue: { label: "Revenue", format: { currency: { code: "AUD" } } },
    units: { label: "Units" },
    margin: { label: "Margin", format: "percent" },
} as const;

/**
 * The Visuals page's placements: the quarter's revenue against its goal and
 * a year ago, and its orders against the quarter before, and a donut; the
 * series charts, the combo and the scatter; the list; the summary and the
 * pivot; and the records.
 */
const visualCells = [
    { key: "v-revenue", row: "r1", span: 4n, height: none, align: variant("stretch", null), title: none, content: vis.of("orders", vis.kpi({
        value: vis.sum("revenue", { goal: 400000 }), compare: vis.sum("revenue", { period: "year_ago" }), trend: "ordered_at",
    })) },
    { key: "v-orders", row: "r1", span: 4n, height: none, align: variant("stretch", null), title: none, content: vis.of("orders", vis.kpi({
        value: vis.count(), compare: vis.count({ period: "previous" }), trend: "ordered_at",
    })) },
    { key: "v-share", row: "r1", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.pie({ slice: vis.group("category"), value: vis.sum("revenue"), donut: true })) },
    { key: "v-months", row: "r2", span: 6n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.column({ x: vis.group("ordered_at", { bucket: "month" }), values: [vis.sum("revenue")], split: "region", stack: "stacked" })) },
    { key: "v-customers", row: "r2", span: 6n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.bar({ x: vis.group("customer", { sort: "high", top: 4n }), values: [vis.sum("revenue")] })) },
    { key: "v-units", row: "r3", span: 4n, height: some(220n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.line({ x: vis.group("ordered_at", { bucket: "week" }), values: [vis.sum("units")] })) },
    { key: "v-trend", row: "r3", span: 4n, height: some(220n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.area({ x: vis.group("ordered_at", { bucket: "month" }), values: [vis.sum("revenue", { goal: 130000 })] })) },
    { key: "v-scatter", row: "r3", span: 4n, height: some(220n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.scatter({ point: "customer", x: vis.sum("units"), y: vis.sum("revenue"), split: "region" })) },
    { key: "v-combo", row: "r4", span: 6n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.combo({
        x: vis.group("region"), columns: [vis.left(vis.sum("revenue"))], lines: [vis.right(vis.mean("margin"))],
    })) },
    { key: "v-list", row: "r4", span: 6n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.list({ item: vis.group("customer", { sort: "high" }), caption: "region", values: [vis.sum("revenue"), vis.count()], bar: true })) },
    { key: "v-summary", row: "r5", span: 6n, height: some(300n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.summary({
        rows: [vis.group("region", { sort: "high" }), vis.group("category")],
        values: [vis.sum("revenue"), vis.ratio("revenue", "units", { goal: 13.5 })], total: true,
    })) },
    { key: "v-pivot", row: "r5", span: 6n, height: some(300n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.pivot({
        rows: vis.group("region"), columns: vis.group("ordered_at", { bucket: "month" }), value: vis.count(), heat: true,
    })) },
    { key: "v-records", row: "r6", span: 12n, height: some(320n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.records({ columns: ["ordered_at", "customer", "region", "revenue", "units", "margin"], sort: "ordered_at", descending: true })) },
];

/**
 * Where every reader of the Visuals page starts: the latest quarter, July to
 * September 2026 — the page's window on the orders' dates, which a value over
 * another period moves.
 */
const latestQuarter = parseJq(`.ordered_at >= "2026-07-01" and .ordered_at < "2026-10-01"`).program;
if (latestQuarter.type === "none") throw new Error("The latest quarter's condition does not parse");
const visualFilters = [{ key: "f-quarter", source: "orders", where: latestQuarter.value }];

/** The pages of the visuals' project: one page, Visuals, live as it was drafted, its readers starting in the latest quarter. */
export const studioVisualPages = e3.record("studio_visual_pages", Studio.Types.Pages, {
    initial: Studio.value([
        {
            key: { project: "Sales desk", page: "Visuals" },
            draft: { title: "Visuals", cells: visualCells, filters: visualFilters },
            live: { version: 1n, page: { title: "Visuals", cells: visualCells, filters: visualFilters } },
        },
    ]),
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
    }),
    // A record an earlier release wrote, its entries with no fields of their own, is carried by this step — listed
    // alone: the record never listed one before it.
    migrations: (migration) => [migration.rows("entry_fields", Studio.migrations.entryFields)],
});

export const studioVisuals = example({
    keywords: [
        "Studio", "Studio.Page", "Studio.visual", "visual", "KPI", "goal", "trend", "chart", "column", "bar", "line", "area", "combo", "scatter",
        "pie", "donut", "list", "ranking bar", "table", "records", "summary", "total", "pivot", "heat", "Studio.source", "Data.bind",
    ],
    description: "Every form a visual draws, on a published page over two years of orders, every reader starting in the latest quarter — the page's starting filter on the orders' dates, its window: the quarter's revenue as a KPI with its goal, its change on a year ago (`period: \"year_ago\"`) and its trend, and its orders' count against the quarter before (`period: \"previous\"`); a donut of revenue by category; columns stacked by region, the top customers' bars, a line, an area and a scatter; a combo of revenue against margin on its right axis; the customers as a list with ranking bars; a summary of regions over categories with its total row and a goal its cells are marked against; a pivot of orders by region and month on the heat ramp; and the latest orders, a page at a time",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pages = $.let(Data.bind(studioVisualPages));
            const orders = $.let(Data.bind(studioOrders));
            return (
                <Studio.Page pages={pages.read()} components={[]} page={{ project: "Sales desk", page: "Visuals" }}
                    sources={{
                        orders: Studio.source(orders, {
                            name: "Orders", icon: "receipt", description: "One row per order",
                            fields: orderFields,
                            range: "ordered_at",
                        }),
                    }} />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** The Chart options page's placements: a pie whose legend names its slices alone, a donut with no legend, stacked columns with their legend hidden, and a summary whose average order and margin are each printed as its field's format says and in a format of its own. */
const chartOptionCells = [
    { key: "c-names", row: "r1", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.pie({ slice: vis.group("category"), value: vis.sum("revenue"), legend: "names" })) },
    { key: "c-alone", row: "r1", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.pie({ slice: vis.group("region"), value: vis.sum("revenue"), donut: true, legend: "hidden" })) },
    { key: "c-columns", row: "r1", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.column({ x: vis.group("ordered_at", { bucket: "month" }), values: [vis.sum("revenue")], split: "region", stack: "stacked", legend: "hidden" })) },
    { key: "c-formats", row: "r2", span: 12n, height: some(260n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.summary({
        rows: [vis.group("region", { sort: "high" })],
        values: [
            vis.mean("revenue", { label: "Average order" }), vis.mean("revenue", { label: "Average order, as a number", format: "number" }),
            vis.mean("margin"), vis.mean("margin", { label: "Margin, as a number", format: "number" }),
        ],
    })) },
];

/** The pages of the chart options' project: one page, Chart options, live as it was drafted. */
export const studioChartOptionPages = e3.record("studio_chart_option_pages", Studio.Types.Pages, {
    initial: Studio.value([
        {
            key: { project: "Sales desk", page: "Chart options" },
            draft: { title: "Chart options", cells: chartOptionCells, filters: [] },
            live: { version: 1n, page: { title: "Chart options", cells: chartOptionCells, filters: [] } },
        },
    ]),
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
    }),
    // A record an earlier release wrote, its entries with no fields of their own, is carried by this step — listed
    // alone: the record never listed one before it.
    migrations: (migration) => [migration.rows("entry_fields", Studio.migrations.entryFields)],
});

export const studioChartOptions = example({
    keywords: [
        "Studio", "Studio.Page", "Studio.visual", "visual", "chart", "options", "legend", "hidden", "names", "values", "no legend", "pie", "donut", "column",
        "format", "value format", "number", "percent", "currency", "summary", "Studio.source", "Data.bind",
    ],
    description: "The options a chart and a value take, on a published page over two years of orders: a pie whose legend names its slices alone (`legend: \"names\"`), a donut with no legend (`\"hidden\"`) — a pie's legend shows each slice's value and share unless it says otherwise — stacked columns with their legend hidden (a chart draws its legend where it names more than one series, `\"auto\"`, or never, `\"hidden\"`), and a summary whose average order and margin are each printed as its field's format says — a currency, a percentage — beside the same value as a plain number (`format: \"number\"`) — a value's `format` (`\"number\"`, `\"percent\"`, `{ currency: { code: \"AUD\" } }`) takes the place of its field's wherever its numbers are printed",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pages = $.let(Data.bind(studioChartOptionPages));
            const orders = $.let(Data.bind(studioOrders));
            return (
                <Studio.Page pages={pages.read()} components={[]} page={{ project: "Sales desk", page: "Chart options" }}
                    sources={{
                        orders: Studio.source(orders, {
                            name: "Orders", icon: "receipt", description: "One row per order",
                            fields: orderFields,
                        }),
                    }} />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Clicks — a visual's click selects, filters or opens; a visual follows another (#1673)
// ============================================================================

/** The customers list a click selects in: what the Customers page's other visuals follow. */
const followCustomers = { leader: "k-customers", from: "customer", to: "customer" } as const;

/**
 * The Customers page's placements: a list of customers, whose click selects;
 * revenue by month, which follows it and shows every customer until one is
 * picked; the mean margin, which follows it and asks for a pick; a donut of
 * revenue by category, whose click filters the page; and the regions' bars,
 * whose click opens the Region orders page.
 */
const customerCells = [
    { key: "k-customers", row: "r1", span: 4n, height: some(300n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.list({ item: vis.group("customer", { sort: "high" }), values: [vis.sum("revenue"), vis.count()], bar: true })) },
    { key: "k-months", row: "r1", span: 8n, height: some(300n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.column({ x: vis.group("ordered_at", { bucket: "month" }), values: [vis.sum("revenue")] }), {
        follow: { ...followCustomers, empty: variant("all", null) },
    }) },
    { key: "k-margin", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.kpi({ value: vis.mean("margin") }), {
        follow: { ...followCustomers, empty: variant("prompt", null) },
    }) },
    { key: "k-category", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.pie({ slice: vis.group("category"), value: vis.sum("revenue"), donut: true }), {
        click: variant("filter", null),
    }) },
    { key: "k-regions", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.bar({ x: vis.group("region", { sort: "high" }), values: [vis.sum("revenue")] }), {
        click: variant("open", { project: "Sales desk", page: "Region orders" }),
    }) },
];

/** The Region orders page's placements: the orders' revenue and count, and the orders themselves — narrowed to the region whose bar opened it. */
const regionCells = [
    { key: "g-revenue", row: "r1", span: 6n, height: none, align: variant("stretch", null), title: none, content: vis.of("orders", vis.kpi({ value: vis.sum("revenue") })) },
    { key: "g-orders", row: "r1", span: 6n, height: none, align: variant("stretch", null), title: none, content: vis.of("orders", vis.kpi({ value: vis.count() })) },
    { key: "g-records", row: "r2", span: 12n, height: some(320n), align: variant("stretch", null), title: none, content: vis.of("orders", vis.records({ columns: ["ordered_at", "customer", "region", "category", "revenue"], sort: "ordered_at", descending: true })) },
];

/** The pages of the clicks' project: Customers, and Region orders, each live as it was drafted. */
export const studioClickPages = e3.record("studio_click_pages", Studio.Types.Pages, {
    initial: Studio.value([
        {
            key: { project: "Sales desk", page: "Customers" },
            draft: { title: "Customers", cells: customerCells, filters: [] },
            live: { version: 1n, page: { title: "Customers", cells: customerCells, filters: [] } },
        },
        {
            key: { project: "Sales desk", page: "Region orders" },
            draft: { title: "Region orders", cells: regionCells, filters: [] },
            live: { version: 1n, page: { title: "Region orders", cells: regionCells, filters: [] } },
        },
    ]),
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
    }),
    // A record an earlier release wrote, its entries with no fields of their own, is carried by this step — listed
    // alone: the record never listed one before it.
    migrations: (migration) => [migration.rows("entry_fields", Studio.migrations.entryFields)],
});

export const studioClicks = example({
    keywords: [
        "Studio", "Studio.Page", "Studio.visual", "visual", "click", "select", "selection", "filter", "open", "onOpen", "follow", "follower", "leader",
        "linked visuals", "master detail", "drill through", "page filters", "filter chip", "State.bind", "navigate", "Studio.source", "Data.bind",
    ],
    description: "What a click on a visual does, on a published page over two years of orders: a list of customers whose click selects (a list's and a table's click, unless it says otherwise) — ⌘-click adds, Esc or a click on the selection again clears; revenue by month follows it (`follow: { leader, from, to, empty: \"all\" }`), showing every customer until one is picked, its eyebrow then saying whom; the mean margin follows it too and asks for a pick first (`empty: \"prompt\"`); a donut whose click filters the page (`click: \"filter\"`, a chart's and a KPI's unless it says otherwise) — the slice joins the page's filters as a chip over the grid, which every visual of the source reads; and the regions' bars, whose click opens the Region orders page (`click: { open: key }`) narrowed to that region: the page's `onOpen` is told its key, and the surface, which holds the open page in a State, shows it — its filter chip the reader's to clear",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pages = $.let(Data.bind(studioClickPages));
            const orders = $.let(Data.bind(studioOrders));
            // The open page is the surface's: a click that opens a page writes it. A host with routes navigates here instead.
            const open = $.let(State.bind([Studio.Types.Key], "ex.studio.clicks.open", { project: "Sales desk", page: "Customers" }));
            const go = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(open.write(key)); }));
            return (
                <Studio.Page pages={pages.read()} components={[]} page={open.read()} onOpen={go}
                    sources={{
                        orders: Studio.source(orders, {
                            name: "Orders", icon: "receipt", description: "One row per order",
                            fields: orderFields,
                            range: "ordered_at",
                        }),
                    }} />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const studioOpsConsole = example({
    keywords: [
        "Studio", "Studio.Page", "published page", "live", "Data.bind", "e3.record", "components", "SnapGrid",
    ],
    description: "A published page, for everyone else: the Overview's live version, v3, each placement its component's own UI — the page reads the record and writes nothing",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Data.bind(studioPages));
            return <Studio.Page pages={pages.read()} components={components} page={{ project: "Ops console", page: "Overview" }} />;
        }}</Reactive>
    )),
    inputs: [],
});
