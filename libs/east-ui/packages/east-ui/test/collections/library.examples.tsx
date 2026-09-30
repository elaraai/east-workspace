/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example, some, none, ArrayType, BooleanType, FloatType, IntegerType, NullType, OptionType, StringType, StructType } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Configurator, Library, Reactive, SegmentGroup, Slice, SnapGrid, Sparkline, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

// ============================================================================
// Large libraries (#258) — hundreds of cards behind a height-constrained,
// virtualized scroll region. Data is generated East-side and deterministically
// (remainder indexing into literal pools — no host randomness).
// ============================================================================

/** Row shapes for the two small folded-in datasets (the old variant panel's
 *  asset and flat-room palettes) — each gets its own Slice config so the
 *  sliced mode composes across every dataset. */

// The ONE shared 400-card crew generator all three libraryLarge configurator
// branches consume (the literal pools live inside the generator body so the
// fixture is a self-contained module-scope expression).

export const libraryPeople = example({
    keywords: ["Library", "card", "meter", "chips", "group", "status", "search", "drag", "palette"],
    description: "People palette — grouped by role with hours meter, skill chips, statuses, and search",
    fn: East.function([], UIComponentType, ($) => {
        const people = $.const([
            { id: "patel", name: "Patel, R.", seniority: "Senior", hours: 38.0, skills: ["React", "Node", "Py"], onRoster: false, atCap: false, site: "SE-1" },
            { id: "cho", name: "Cho, J.", seniority: "Senior", hours: 26.0, skills: ["Go", "SQL"], onRoster: false, atCap: false, site: "SE-1" },
            { id: "rivera", name: "Rivera, M.", seniority: "Senior", hours: 32.0, skills: ["React", "Py"], onRoster: true, atCap: false, site: "SE-2" },
            { id: "okafor", name: "Okafor, S.", seniority: "Senior", hours: 40.0, skills: ["Go"], onRoster: false, atCap: true, site: "SE-2" },
            { id: "nguyen", name: "Nguyen, T.", seniority: "Mid", hours: 20.0, skills: ["React", "CSS"], onRoster: false, atCap: false, site: "SE-1" },
            { id: "kim", name: "Kim, A.", seniority: "Mid", hours: 22.0, skills: ["Go", "k8s"], onRoster: false, atCap: false, site: "SE-3" },
        ]);
        return (
            <Library
                id="people"
                data={people}
                item={p => ({
                    key: p.id,
                    label: p.name,
                    sublabel: East.str`${p.seniority} SE`,
                    icon: "user",
                    status: p.onRoster.ifElse(
                        () => some(Library.status("On roster", "info")),
                        () => p.atCap.ifElse(() => some(Library.status("At cap", "neutral")), () => none)),
                    draggable: p.atCap.not(),
                })}
                dimensions={[
                    { kind: "meter", key: "hours", label: "Hours", value: p => p.hours, max: 40.0, format: h => East.str`${h}h` },
                    { kind: "chips", key: "skills", label: "Skills", values: p => p.skills },
                    { kind: "text", key: "location", label: "Location", value: p => p.site },
                ]}
                groupBy={[
                    { key: "role", label: "Role", value: p => p.seniority, summary: members => East.str`${members.size()} people` },
                    { key: "site", label: "Site", value: p => p.site },
                ]}
                search={p => East.str`${p.name} ${p.seniority}`}
                addLabel="Add person"
            />
        );
    }),
    inputs: [],
});

/**
 * A component palette — the cards a builder drags onto its canvas. Each card
 * carries a trailing lock (what it shows is fixed by its developer); the card
 * already on the canvas is placed, in the brand; the Filter menu narrows by
 * category and tags; and a click reports the card, here into State.
 */
export const libraryPalette = example({
    keywords: ["Library", "palette", "component", "placed", "trailing", "glyph", "lock", "Library.glyph", "filters", "Filter", "facet", "tags", "noun", "onCardClick", "click", "Reactive", "State"],
    description: "Component palette — a trailing lock on each card, the placed card in the brand, a Filter menu over category and tags, and a click reported into State",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.const([
                { key: "kpi_rail", name: "KPI rail", icon: "gauge-high", category: "Display", tags: ["kpi", "sales"], reads: "sales_daily" },
                { key: "revenue_trend", name: "Revenue trend", icon: "chart-area", category: "Charts", tags: ["sales"], reads: "sales_daily" },
                { key: "orders_by_week", name: "Orders by week", icon: "chart-column", category: "Charts", tags: ["orders"], reads: "sales_weekly" },
                { key: "shift_roster", name: "Shift roster", icon: "calendar-week", category: "Operations", tags: ["people"], reads: "rota_week · people" },
            ], ArrayType(StructType({
                key: StringType, name: StringType, icon: StringType, category: StringType, tags: ArrayType(StringType), reads: StringType,
            })));
            const picked = $.let(State.bind([StringType], "library_palette_picked", "revenue_trend"));
            const current = $.let(picked.read());
            const onCardClick = $.const(East.function([StringType], NullType, ($2, key) => { $2(picked.write(key)); }));
            return (
                <Box width="264px" height="420px">
                    <Library
                        id="palette"
                        data={components}
                        item={c => ({
                            key: c.key,
                            label: c.name,
                            sublabel: c.key.equal(current).ifElse(() => "ON CANVAS · ×1", () => c.reads),
                            icon: c.icon,
                            trailing: some(Library.glyph("lock", "Logic fixed by the developer")),
                            placed: c.key.equal(current),
                        })}
                        groupBy={[{ key: "category", label: "Category", value: c => c.category }]}
                        filters={[
                            { key: "category", label: "Category", values: c => [c.category] },
                            { key: "tags", label: "Tags", values: c => c.tags },
                        ]}
                        search={c => East.str`${c.name} ${c.category}`}
                        noun={{ singular: "component", plural: "components" }}
                        onCardClick={onCardClick}
                        style={{ height: "fill" }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * THE large-library configurator (pass 5) — ONE live crew palette: slice
 * chrome (search / filter rail / count footer) composes on permanently, the
 * two-level grouping stays, and the size axis feeds the height expression
 * (auto / scroll / fill — an empty height reads as unbounded).
 */
export const libraryLarge = example({
    keywords: ["Library", "large", "virtualization", "scroll", "height", "group", "hundreds", "performance", "slice", "chrome", "filter", "search", "rail", "count", "footer", "Slice.rows", "SegmentGroup", "Configurator", "getTag", "configurator", "card", "chips", "meter", "maxHeight", "bounded", "fill", "#320"],
    description: "Large-library configurator — a size axis (auto / scroll / fill) on one live sliced, grouped crew palette of hundreds of cards",
    fn: East.function([], UIComponentType, (_$) => {
        const CrewType = StructType({
            id: StringType,
            name: StringType,
            role: StringType,
            depot: StringType,
            hours: FloatType,
            skills: ArrayType(StringType),
        });
        const LIBRARY_LARGE_CARDS = East.Array.generate(400n, CrewType, East.function([IntegerType], CrewType, ($, i) => {
            const surnames = $.let(["Patel", "Cho", "Rivera", "Okafor", "Nguyen", "Kim", "Ali", "Silva", "Weber", "Rossi", "Tanaka", "Novak"], ArrayType(StringType));
            const roles = $.let(["Senior", "Mid", "Junior", "Contract", "Casual"], ArrayType(StringType));
            const depots = $.let(["North", "South", "East", "West", "Central", "Airport", "Harbor", "Rail"], ArrayType(StringType));
            const skillPool = $.let(["Forklift", "HazMat", "CDL-B", "Crane", "Rigging", "First aid", "Welding", "Night"], ArrayType(StringType));
            const row = $.let({
                id: East.str`crew-${i}`,
                name: East.str`${surnames.get(i.remainder(12n))}, ${i}`,
                role: roles.get(i.remainder(5n)),
                depot: depots.get(i.remainder(8n)),
                hours: i.remainder(41n).toFloat(),
                skills: [skillPool.get(i.remainder(8n)), skillPool.get(i.add(3n).remainder(8n))],
            }, CrewType);
            return row;
        }));
        const cfg = Slice.config(CrewType, {
            fields: { name: { label: "Name" }, role: { label: "Role" }, depot: { label: "Depot" } },
            searchFieldIds: ["name", "role", "depot"],
        });
        return (
            <Reactive>{$ => {
                const sizes = $.const(["auto", "scroll", "fill"], ArrayType(StringType));
                const sizeBind = $.let(State.bind([StringType], "library_large_size", "scroll"));
                const sizeKey = $.let(sizeBind.read());
                const onSizeChange = $.const(East.function([StringType], NullType, ($, next) => {
                    $(sizeBind.write(next));
                }));

                const crew = $.const(LIBRARY_LARGE_CARDS);
                const slice = $.let(Slice.bind([CrewType], "ex.library.large.slice", cfg, Slice.state({}), crew, none));
                const narrowed = $.let(Slice.rows([CrewType], slice));

                // An empty height string reads as "unbounded"; the wrapper Box
                // only bounds in fill mode.
                const boxHeight = $.let(sizeKey.equal("fill").ifElse(_$ => "300px", _$ => ""));
                const libHeight = $.let(sizeKey.equal("scroll").ifElse(
                    _$ => "480px",
                    _$ => sizeKey.equal("fill").ifElse(_$ => "100%", _$ => ""),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Size", sizeKey,
                                <SegmentGroup value={sizeKey} onChange={onSizeChange} size="sm"
                                    items={sizes.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                        ]}
                        preview={
                            <Box width="100%" height={boxHeight} overflow="hidden">
                                <Library
                                    id="crew"
                                    data={narrowed}
                                    slice={slice}
                                    item={c => ({ key: c.id, label: c.name, sublabel: c.role, icon: "user" })}
                                    dimensions={[
                                        { kind: "meter", key: "hours", label: "Hours", value: c => c.hours, max: 40.0, format: h => East.str`${h}h` },
                                        { kind: "chips", key: "skills", label: "Skills", values: c => c.skills },
                                        { kind: "text", key: "depot", label: "Depot", value: c => c.depot },
                                    ]}
                                    groupBy={[
                                        { key: "depot", label: "Depot", value: c => c.depot, summary: members => East.str`${members.size()} crew` },
                                        { key: "role", label: "Role", value: c => c.role },
                                    ]}
                                    search={c => East.str`${c.name} ${c.role} ${c.depot}`}
                                    style={{ height: libHeight }}
                                />
                            </Box>
                        }
                        spec={[
                            Configurator.Spec("Cards", East.print(LIBRARY_LARGE_CARDS.size())),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/**
 * A gallery of pages — the page library's cards. Each card's media is the
 * page's wireframe at its start; its status is a dot, or an open ring for a
 * draft never published; its meta line says what it holds; and its foot names
 * the action a click takes. The dashed last card adds a page, and the
 * toolbar's Grid · List switch lays the cards out.
 */
export const libraryGalleryPages = example({
    keywords: [
        "Library", "gallery", "variant", "media", "thumbnail", "wireframe", "SnapGrid", "card", "columns",
        "mediaPlacement", "mediaSize", "layout", "grid", "list", "toolbar", "switch", "search", "noun", "status", "ring",
        "action", "addLabel", "onAdd", "onCardClick", "page library", "Reactive", "State",
    ],
    description: "A gallery of pages — each card's media the page's wireframe at its start, its status a dot or an open ring, an action in its foot, a dashed card to add one, and a toolbar holding the search and the grid · list switch",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const Placement = StructType({ id: StringType, row: StringType, span: IntegerType, height: OptionType(IntegerType) });
            const pages = $.const([
                {
                    key: "overview", title: "Overview", live: true,
                    cells: [
                        { id: "revenue", row: "kpis", span: 3n, height: some(12n) },
                        { id: "orders", row: "kpis", span: 3n, height: some(12n) },
                        { id: "avg-ticket", row: "kpis", span: 3n, height: some(12n) },
                        { id: "fill-rate", row: "kpis", span: 3n, height: some(12n) },
                        { id: "revenue-trend", row: "charts", span: 8n, height: some(56n) },
                        { id: "breakdown", row: "charts", span: 4n, height: some(56n) },
                        { id: "accounts", row: "accounts", span: 12n, height: some(18n) },
                    ],
                },
                {
                    key: "account-detail", title: "Account detail", live: false,
                    cells: [
                        { id: "header", row: "header", span: 12n, height: some(10n) },
                        { id: "owner", row: "facts", span: 4n, height: some(14n) },
                        { id: "revenue", row: "facts", span: 4n, height: some(14n) },
                        { id: "status", row: "facts", span: 4n, height: some(14n) },
                        { id: "orders", row: "orders", span: 12n, height: some(60n) },
                    ],
                },
                {
                    key: "regional-rollup", title: "Regional rollup", live: true,
                    cells: [
                        { id: "trend", row: "trend", span: 12n, height: some(72n) },
                        { id: "north", row: "regions", span: 6n, height: some(18n) },
                        { id: "south", row: "regions", span: 6n, height: some(18n) },
                    ],
                },
            ], ArrayType(StructType({ key: StringType, title: StringType, live: BooleanType, cells: ArrayType(Placement) })));
            const opened = $.let(State.bind([StringType], "library_gallery_opened", "nothing"));
            const onOpen = $.const(East.function([StringType], NullType, ($2, key) => { $2(opened.write(key)); }));
            const onAdd = $.const(East.function([], NullType, ($2) => { $2(opened.write("a new page")); }));
            return (
                <VStack gap="3" align="stretch">
                    <Library
                        id="pages"
                        variant="gallery"
                        data={pages}
                        item={p => ({
                            key: p.key,
                            label: p.title,
                            sublabel: East.str`${p.cells.size()} components`,
                            status: p.live.ifElse(
                                () => some(Library.status("Live", "success")),
                                () => some(Library.status("Draft", "neutral", true)),
                            ),
                            media: (
                                <SnapGrid data={p.cells} variant="wireframe"
                                    cell={c => SnapGrid.cell({ key: c.id, row: c.row, span: c.span, height: c.height, content: <Text>{c.id}</Text> })} />
                            ),
                            action: "Open in builder →",
                            draggable: false,
                        })}
                        search={p => p.title}
                        noun={{ singular: "page", plural: "pages" }}
                        onCardClick={onOpen}
                        addLabel="New page from template"
                        onAdd={onAdd}
                        style={{ columns: 2n, mediaPlacement: "start", mediaSize: "156px" }}
                    />
                    <Text>{East.str`Opened · ${opened.read()}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * A gallery of something other than pages — reports. Each card's media is its
 * trend, a sparkline above its face; its foot holds its owner's avatar beside
 * how many decks use it, and a star for a favourite; and the reports group by
 * team, searchable by name.
 */
export const libraryGalleryReports = example({
    keywords: [
        "Library", "gallery", "variant", "media", "Sparkline", "chart", "thumbnail", "avatar", "byline", "trailing",
        "glyph", "Library.glyph", "star", "favourite", "columns", "mediaSize", "groupBy", "search", "noun", "catalog",
    ],
    description: "A gallery of reports — each card's media a sparkline above its face, its owner's avatar beside how often it is used, a star for a favourite, grouped by team",
    fn: East.function([], UIComponentType, ($) => {
        const reports = $.const([
            { key: "weekly-revenue", name: "Weekly revenue", team: "Finance", owner: "Dana Voss", uses: 6n, favourite: true, trend: [12.0, 14.0, 13.0, 17.0, 16.0, 19.0, 21.0] },
            { key: "cash-runway", name: "Cash runway", team: "Finance", owner: "Dana Voss", uses: 3n, favourite: false, trend: [30.0, 28.0, 27.0, 25.0, 26.0, 24.0, 22.0] },
            { key: "order-intake", name: "Order intake", team: "Operations", owner: "Ravi Menon", uses: 11n, favourite: true, trend: [5.0, 7.0, 6.0, 9.0, 11.0, 10.0, 12.0] },
            { key: "fill-rate", name: "Fill rate", team: "Operations", owner: "Ravi Menon", uses: 7n, favourite: false, trend: [88.0, 90.0, 91.0, 89.0, 93.0, 94.0, 94.0] },
            { key: "backlog-age", name: "Backlog age", team: "Operations", owner: "Lea Park", uses: 2n, favourite: false, trend: [9.0, 8.0, 10.0, 7.0, 6.0, 6.0, 5.0] },
        ], ArrayType(StructType({
            key: StringType, name: StringType, team: StringType, owner: StringType, uses: IntegerType, favourite: BooleanType, trend: ArrayType(FloatType),
        })));
        return (
            <Library
                id="reports"
                variant="gallery"
                data={reports}
                item={r => ({
                    key: r.key,
                    label: r.name,
                    sublabel: East.str`${r.team.upperCase()} · ${r.trend.size()} weeks`,
                    media: <Sparkline data={r.trend} type="area" color="brand.600" width="100%" height="84px" />,
                    avatar: r.owner,
                    byline: East.str`used in ${r.uses}`,
                    trailing: r.favourite.ifElse(
                        () => some(Library.glyph("star", "Favourite", "info")),
                        () => some(Library.glyph("star", "Not a favourite")),
                    ),
                })}
                groupBy={[{ key: "team", label: "Team", value: r => r.team }]}
                search={r => East.str`${r.name} ${r.team}`}
                noun={{ singular: "report", plural: "reports" }}
                style={{ columns: 3n, mediaSize: "112px" }}
            />
        );
    }),
    inputs: [],
});
