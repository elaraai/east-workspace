/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

/**
 * Slice examples — use-case documents for the composition model:
 *
 * - **Data flows explicitly.** Consumers read `Slice.rows([RowType], slice)`
 *   (or aggregate from it); nothing narrows data behind your back.
 * - **Chrome attaches declaratively.** A component's `slice` option mounts
 *   the affordance rail (and footer / legend / brush, per component) in its
 *   own chassis; the standalone `Slice.Rail` strip serves multi-consumer
 *   compositions. There are no per-consumer wrappers.
 *
 * Across these examples every affordance is exercised: filter, search,
 * cohort, breakdown, range, brush — plus the count footer, the legend, the
 * `Chart.Series` layer, the compress ladder, and `Slice.Summary`.
 */

import { East, DateTimeType, StringType, IntegerType, NullType, ArrayType, StructType, variant, some, none, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Box, Chart, Gantt, Reactive, Separator, Slice, State, Table, VStack } from "@elaraai/east-ui";

// ============================================================================
// 1. Events table — Table with the `slice` chrome option.
//    Exercises: filter chips, add-filter builder, search, save-as-cohort,
//    active cohorts, the derived-count footer.
// ============================================================================

export const sliceTableChrome = example({
    keywords: ["Slice", "Table", "slice", "chrome", "filter", "search", "cohort", "footer", "count"],
    description: "Events table — Table with the `slice` chrome option: a header rail mounting `[\"filter\", \"search\", \"cohort\"]` (an active saved cohort applies its clauses) and one footer band — derived count left, pager right; rows fed explicitly via `Slice.rows`",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ scenario: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { scenario: { label: "Scenario" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["scenario", "region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { scenario: "procurement v3", region: "EU",   sessions: 42n },
                    { scenario: "procurement v3", region: "NA",   sessions: 18n },
                    { scenario: "procurement v2", region: "EU",   sessions: 31n },
                    { scenario: "logistics",      region: "NA",   sessions: 56n },
                    { scenario: "procurement v3", region: "APAC", sessions: 7n },
                    { scenario: "procurement v2", region: "APAC", sessions: 25n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.table.chrome", cfg, Slice.state({
                    filters: [variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") })],
                    cohorts: [{ id: "high-volume", name: "High volume", filters: [
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ] }],
                    activeCohorts: new Set(["high-volume"]),
                }), data, none));
                const narrowed = $.let(Slice.rows([EventType], slice));
                const pageBind = $.let(State.bind([IntegerType], "ex.slice.table.chrome.page", 0n));
                return (
                    <Table data={narrowed} columns={{
                        scenario: { header: "Scenario" },
                        region:   { header: "Region" },
                        sessions: { header: "Sessions" },
                    }} slice={slice} affordances={["filter", "search", "cohort"]} pagination={{
                        pageSize: 2n,
                        page: pageBind.read(),
                        onPageChange: East.function([IntegerType], NullType, ($, page) => {
                            $(pageBind.write(page));
                        }),
                    }} />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 2. Sessions chart — Chart with the `slice` chrome option.
//    Exercises: breakdown (→ Chart.Series split + colour-matched legend),
//    range pill, the brush gesture on a time x-axis.
// ============================================================================

export const sliceChartChrome = example({
    keywords: ["Slice", "Chart", "slice", "chrome", "Series", "breakdown", "legend", "brush", "range"],
    description: "Sessions chart — Chart with the `slice` chrome option: its own header rail (`breakdown`, `range`, `brush`), a `Chart.Series` layer splitting the narrowed rows into one coloured series per active-breakdown value, the colour-matched legend beneath the plot (the explicit `legend` affordance — nothing mounts one implicitly), and drag-to-range brushing on the time x-axis",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ day: DateTimeType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { day: { label: "Day" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
            rangeFieldId: "day",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { day: new Date("2025-03-03"), region: "EU", sessions: 30n },
                    { day: new Date("2025-03-03"), region: "NA", sessions: 22n },
                    { day: new Date("2025-03-10"), region: "EU", sessions: 42n },
                    { day: new Date("2025-03-10"), region: "NA", sessions: 28n },
                    { day: new Date("2025-03-17"), region: "EU", sessions: 38n },
                    { day: new Date("2025-03-17"), region: "NA", sessions: 41n },
                    { day: new Date("2025-03-24"), region: "EU", sessions: 51n },
                    { day: new Date("2025-03-24"), region: "NA", sessions: 36n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.chart.chrome", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                return (
                    <Chart
                        layers={[Chart.Series(slice, { x: "day", value: "sessions" })]}
                        slice={slice}
                        affordances={["breakdown", "range", "brush", "legend"]}
                        height={180}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 3. One slice, three consumers — the standalone Slice.Rail strip — plus the
//    rich brush strips on a datetime domain and on a currency domain (#190),
//    one captioned row each (epic #455).
//    Exercises: the strip placement, several consumers reading one
//    `Slice.rows` feed, `Slice.Summary` as the quiet status bar, and the
//    brush track's axis / count-histogram chrome.
// ============================================================================

export const sliceRail = example({
    keywords: ["Slice", "Rail", "rows", "strip", "multi-consumer", "Table", "Summary", "persist", "localStorage", "url", "shareable", "brush", "axis", "count", "histogram", "datetime", "format", "date", "currency", "compact"],
    description: "One slice, several consumers plus the rich brush strips, one captioned row each — multi-consumer rail (a standalone Slice.Rail strip (with the brush mini-strip over the sessions domain) narrowing a plain Table reading `Slice.rows([RowType], slice)`, with Slice.Summary as the quiet status footer; `persist=\"local\"` opts the slice state into localStorage — the narrowing survives a reload (`\"url\"` makes it a shareable link)), brush datetime (a standalone Slice.Rail brush strip on a datetime domain: the field's `format: { date: \"MMM DD\" }` drives the axis labels under the track, the self-excluding count histogram shows where the bookings cluster, and the Table + Summary below narrow live to the seeded window), brush currency (the strip on an integer order-value domain: `format: { currency: { code: \"USD\", compact: true } }` renders the axis as `$0 … $12K` over a skewed histogram; pass `brush={{ axis: false, count: false }}` to restore the minimal bare track)",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ scenario: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { scenario: { label: "Scenario" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["scenario", "region"],
            rangeFieldId: "sessions",
        });
        const BookingType = StructType({ when: DateTimeType, route: StringType, seats: IntegerType });
        const datetimeCfg = Slice.config(BookingType, {
            fields: {
                when:  { label: "Departure", format: { date: "MMM DD" } },
                route: { label: "Route" },
                seats: { label: "Seats" },
            },
            rangeFieldId: "when",
        });
        const OrderType = StructType({ customer: StringType, value: IntegerType });
        const currencyCfg = Slice.config(OrderType, {
            fields: {
                customer: { label: "Customer" },
                value:    { label: "Order value", format: { currency: { code: "USD", compact: true } } },
            },
            rangeFieldId: "value",
        });
        return (
            <VStack gap="4" align="stretch">
                <Separator label="MULTI-CONSUMER RAIL" align="start" />
                <Reactive>{$ => {
                    const data = $.const([
                        { scenario: "procurement v3", region: "EU",   sessions: 42n },
                        { scenario: "procurement v3", region: "NA",   sessions: 18n },
                        { scenario: "procurement v2", region: "EU",   sessions: 31n },
                        { scenario: "logistics",      region: "NA",   sessions: 56n },
                        { scenario: "procurement v3", region: "NA",   sessions: 12n },
                    ], ArrayType(EventType));
                    const slice = $.let(Slice.bind([EventType], "ex.slice.rail", cfg, Slice.state({
                        filters: [variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") })],
                    }), data, none));
                    const narrowed = $.let(Slice.rows([EventType], slice));
                    return (
                        <VStack gap="3" align="stretch">
                            <Slice.Rail slice={slice} affordances={["filter", "search", "brush"]} persist="local" />
                            <Table data={narrowed} columns={{
                                scenario: { header: "Scenario" },
                                region:   { header: "Region" },
                                sessions: { header: "Sessions" },
                            }} />
                            <Slice.Summary slice={slice} />
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="BRUSH DATETIME" align="start" />
                <Reactive>{$ => {
                    const data = $.const([
                        { when: new Date("2025-03-02"), route: "SYD→MEL", seats: 140n },
                        { when: new Date("2025-03-03"), route: "SYD→BNE", seats: 96n },
                        { when: new Date("2025-03-04"), route: "MEL→SYD", seats: 152n },
                        { when: new Date("2025-03-05"), route: "SYD→MEL", seats: 88n },
                        { when: new Date("2025-03-21"), route: "SYD→PER", seats: 44n },
                        { when: new Date("2025-04-08"), route: "MEL→SYD", seats: 120n },
                        { when: new Date("2025-04-09"), route: "SYD→MEL", seats: 134n },
                        { when: new Date("2025-04-10"), route: "SYD→BNE", seats: 61n },
                        { when: new Date("2025-04-11"), route: "MEL→BNE", seats: 105n },
                        { when: new Date("2025-04-12"), route: "SYD→MEL", seats: 149n },
                    ], ArrayType(BookingType));
                    const slice = $.let(Slice.bind([BookingType], "ex.slice.brush.datetime", datetimeCfg, Slice.state({
                        range: some(variant("datetime", {
                            from: new Date("2025-04-07"),
                            to:   new Date("2025-04-13"),
                        })),
                    }), data, none));
                    const narrowed = $.let(Slice.rows([BookingType], slice));
                    return (
                        <VStack gap="3" align="stretch">
                            <Slice.Rail slice={slice} affordances={["brush"]} />
                            <Table data={narrowed} columns={{
                                when:  { header: "Departure" },
                                route: { header: "Route" },
                                seats: { header: "Seats" },
                            }} />
                            <Slice.Summary slice={slice} />
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="BRUSH CURRENCY" align="start" />
                <Reactive>{$ => {
                    const data = $.const([
                        { customer: "Acme",     value: 180n },
                        { customer: "Birch",    value: 240n },
                        { customer: "Cobalt",   value: 310n },
                        { customer: "Dover",    value: 420n },
                        { customer: "Ember",    value: 480n },
                        { customer: "Foundry",  value: 650n },
                        { customer: "Gale",     value: 900n },
                        { customer: "Harbor",   value: 1400n },
                        { customer: "Ionia",    value: 4200n },
                        { customer: "Juniper",  value: 12000n },
                    ], ArrayType(OrderType));
                    const slice = $.let(Slice.bind([OrderType], "ex.slice.brush.currency", currencyCfg, Slice.state({
                        range: some(variant("integer", { from: 800n, to: 12000n })),
                    }), data, none));
                    const narrowed = $.let(Slice.rows([OrderType], slice));
                    return (
                        <VStack gap="3" align="stretch">
                            <Slice.Rail slice={slice} affordances={["brush"]} />
                            <Table data={narrowed} columns={{
                                customer: { header: "Customer" },
                                value:    { header: "Order value" },
                            }} />
                            <Slice.Summary slice={slice} />
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// 4. Narrow rail — the compress ladder under real width pressure.
//    Exercises: whole-chip folding → family count chips → the terminal
//    `N narrowed` chip, and the sectioned editor popover trigger.
// ============================================================================

export const sliceNarrow = example({
    keywords: ["Slice", "narrow", "ladder", "compress", "progressive", "fold", "count chip", "editor"],
    description: "The compress ladder under width pressure — a four-affordance Table chrome (`[\"filter\", \"breakdown\", \"cohort\", \"search\"]`) in a ~360px rail: affordances fold one at a time, cheapest first (search, then the cohort/split summaries), keeping the filter builder live longest; each folded family becomes a summary chip and the terminal chip names the rail's contents (never the bare word \"narrow\"). Every folded chip opens the sectioned editor",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ scenario: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { scenario: { label: "Scenario" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
            searchFieldIds: ["scenario"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { scenario: "procurement v3", region: "EU", sessions: 42n },
                    { scenario: "procurement v3", region: "NA", sessions: 18n },
                    { scenario: "procurement v2", region: "EU", sessions: 31n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.narrow", cfg, Slice.state({
                    filters: [
                        variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") }),
                        variant("string", { fieldId: "region", op: variant("eq", "EU") }),
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ],
                    cohorts: [{ id: "high-volume", name: "High volume", filters: [
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ] }],
                }), data, none));
                const narrowed = $.let(Slice.rows([EventType], slice));
                return (
                    <Box width="360px">
                        <Table data={narrowed} columns={{
                            scenario: { header: "Scenario" },
                            sessions: { header: "Sessions" },
                        }} slice={slice} affordances={["filter", "breakdown", "cohort", "search"]} />
                    </Box>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 6. Cross-filter dashboard — chart + legend + table over ONE slice (#165).
//    Exercises: breakdown with a top-N roll-up (`other` bucket, #162), the
//    legend's filter-to gesture beside the visibility eye, and the narrowed
//    Table + "N of M" Summary that the same gesture drives (#169).
// ============================================================================

export const sliceCrossFilterDashboard = example({
    keywords: ["Slice", "cross-filter", "toggleFilter", "Legend", "filter to", "breakdown", "limit", "other", "linked", "dashboard", "Chart", "Table", "Summary"],
    description: "Cross-filtering dashboard — a Chart (split by region, top-2 + `other` roll-up), its Slice.Legend facet bar, a Table, and a `N of M` Slice.Summary all bound to ONE slice: clicking a legend item toggles it in the field's `in`-set filter (OR within the field), narrowing the chart AND the table, and the self-excluding facet options never disappear while selected — click again to deselect; `<Slice.Legend mode=\"visibility\">` is the chart-decluttering eye rail instead",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ day: DateTimeType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { day: { label: "Day" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
            rangeFieldId: "day",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { day: new Date("2025-03-03"), region: "EU",    sessions: 30n },
                    { day: new Date("2025-03-10"), region: "EU",    sessions: 42n },
                    { day: new Date("2025-03-17"), region: "EU",    sessions: 38n },
                    { day: new Date("2025-03-03"), region: "NA",    sessions: 22n },
                    { day: new Date("2025-03-10"), region: "NA",    sessions: 28n },
                    { day: new Date("2025-03-03"), region: "APAC",  sessions: 9n },
                    { day: new Date("2025-03-10"), region: "LATAM", sessions: 7n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.crossfilter", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: some(2n) }),
                }), data, none));
                const narrowed = $.let(Slice.rows([EventType], slice));
                return (
                    <VStack gap="3" align="stretch">
                        <Chart
                            layers={[Chart.Series(slice, { x: "day", value: "sessions" })]}
                            slice={slice}
                            affordances={["breakdown", "range"]}
                            height={160}
                        />
                        <Slice.Legend slice={slice} />
                        <Table data={narrowed} columns={{
                            day:      { header: "Day" },
                            region:   { header: "Region" },
                            sessions: { header: "Sessions" },
                        }} />
                        <Slice.Summary slice={slice} />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 7. Expressive filters — the widened predicate vocabulary in one rail — plus
//    the presets surfaces: preset cohorts on a squeezed rail (#319) and the
//    curated Slice.Presets toggle bar (#163), one captioned row each (#455).
//    Exercises: string startsWith / isNotEmpty (#171), datetime between +
//    integer in (#166), the capped `first-3 +N` in-set chip preview (#175),
//    and the presets-as-the-cohort-surface dedupe.
// ============================================================================

export const sliceExpressiveFilters = example({
    keywords: ["Slice", "Filter", "startsWith", "isEmpty", "isNotEmpty", "between", "in", "set", "preview", "predicates", "expressive", "presets", "cohort", "dedupe", "duplicate", "narrow", "summary", "compress", "contents", "Presets", "Cohort", "toggle", "segments", "preset", "on", "off", "counts"],
    description: "The widened filter vocabulary plus the presets surfaces, one captioned row each — expressive filters (`sku starts with SKU-`, `note is not empty` (value-less presence chip), `day between JAN 5 – MAR 28` (datetime range op), and `qty in 10, 20, 30 +2` (integer set-membership previewing 3 of 5 members so a big set stays a legible chip); the Table and `N of M` footer read the composed narrowing), presets rail (a squeezed Table `slice` chrome mounting `[\"presets\", \"filter\", \"search\"]`: the presets bar already IS the cohort surface, so no duplicate `cohort` band is auto-appended (#319), and the collapsed chip names its contents rather than the placeholder \"narrow\"), presets bar (`Slice.Presets` = `Slice.Cohort` with `mode: \"toggle\"` (#163): developer-seeded cohorts as pure on/off segment chips with live counts, narrowing the Table below via `Slice.rows` with `Slice.Summary` reflecting the active narrowings)",
    fn: East.function([], UIComponentType, (_$) => {
        const OrderType = StructType({ sku: StringType, note: StringType, day: DateTimeType, qty: IntegerType });
        const cfg = Slice.config(OrderType, {
            fields: { sku: { label: "SKU" }, note: { label: "Note" }, day: { label: "Day" }, qty: { label: "Qty" } },
            searchFieldIds: ["sku", "note"],
        });
        const PresetOrderType = StructType({ sku: StringType, region: StringType, qty: IntegerType });
        const railCfg = Slice.config(PresetOrderType, {
            fields: { sku: { label: "SKU" }, region: { label: "Region" }, qty: { label: "Qty" } },
            searchFieldIds: ["sku"],
        });
        const barCfg = Slice.config(PresetOrderType, {
            fields: { sku: { label: "SKU" }, region: { label: "Region" }, qty: { label: "Qty" } },
        });
        return (
            <VStack gap="4" align="stretch">
                <Separator label="EXPRESSIVE FILTERS" align="start" />
                <Reactive>{$ => {
                    const data = $.const([
                        { sku: "SKU-100", note: "rush order", day: new Date("2025-01-10"), qty: 10n },
                        { sku: "SKU-200", note: "  ",         day: new Date("2025-02-14"), qty: 20n },
                        { sku: "SKU-300", note: "fragile",    day: new Date("2025-03-01"), qty: 30n },
                        { sku: "ALT-400", note: "reseller",   day: new Date("2025-02-02"), qty: 40n },
                        { sku: "SKU-500", note: "priority",   day: new Date("2025-05-20"), qty: 50n },
                    ], ArrayType(OrderType));
                    const slice = $.let(Slice.bind([OrderType], "ex.slice.expressive", cfg, Slice.state({
                        filters: [
                            variant("string",   { fieldId: "sku",  op: variant("startsWith", "SKU-") }),
                            variant("string",   { fieldId: "note", op: variant("isNotEmpty", null) }),
                            variant("datetime", { fieldId: "day",  op: variant("between", { from: new Date("2025-01-05"), to: new Date("2025-03-28") }) }),
                            variant("integer",  { fieldId: "qty",  op: variant("in", new Set([10n, 20n, 30n, 40n, 50n])) }),
                        ],
                    }), data, none));
                    const narrowed = $.let(Slice.rows([OrderType], slice));
                    return (
                        <VStack gap="3" align="stretch">
                            <Slice.Rail slice={slice} affordances={["filter"]} />
                            <Table data={narrowed} columns={{
                                sku:  { header: "SKU" },
                                note: { header: "Note" },
                                day:  { header: "Day" },
                                qty:  { header: "Qty" },
                            }} />
                            <Slice.Summary slice={slice} />
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="PRESETS RAIL" align="start" />
                <Reactive>{$ => {
                    const data = $.const([
                        { sku: "A-100", region: "EU",   qty: 40n },
                        { sku: "A-101", region: "EU",   qty: 12n },
                        { sku: "B-200", region: "NA",   qty: 55n },
                        { sku: "C-300", region: "APAC", qty: 23n },
                    ], ArrayType(PresetOrderType));
                    const slice = $.let(Slice.bind([PresetOrderType], "ex.slice.presets.rail", railCfg, Slice.state({
                        cohorts: [
                            { id: "eu",   name: "EU",          filters: [variant("string",  { fieldId: "region", op: variant("eq", "EU") })] },
                            { id: "bulk", name: "Bulk orders", filters: [variant("integer", { fieldId: "qty",    op: variant("gte", 20n) })] },
                        ],
                    }), data, none));
                    const narrowed = $.let(Slice.rows([PresetOrderType], slice));
                    return (
                        <Box width="300px">
                            <Table data={narrowed} columns={{
                                sku:    { header: "SKU" },
                                region: { header: "Region" },
                                qty:    { header: "Qty" },
                            }} slice={slice} affordances={["presets", "filter", "search"]} />
                        </Box>
                    );
                }}</Reactive>
                <Separator label="PRESETS BAR" align="start" />
                <Reactive>{$ => {
                    const data = $.const([
                        { sku: "A-100", region: "EU",   qty: 40n },
                        { sku: "A-101", region: "EU",   qty: 12n },
                        { sku: "B-200", region: "NA",   qty: 55n },
                        { sku: "B-201", region: "NA",   qty: 9n },
                        { sku: "C-300", region: "APAC", qty: 23n },
                    ], ArrayType(PresetOrderType));
                    const slice = $.let(Slice.bind([PresetOrderType], "ex.slice.presets", barCfg, Slice.state({
                        cohorts: [
                            { id: "eu",   name: "EU",          filters: [variant("string",  { fieldId: "region", op: variant("eq", "EU") })] },
                            { id: "bulk", name: "Bulk orders", filters: [variant("integer", { fieldId: "qty",    op: variant("gte", 20n) })] },
                        ],
                        activeCohorts: new Set(["bulk"]),
                    }), data, none));
                    const narrowed = $.let(Slice.rows([PresetOrderType], slice));
                    return (
                        <VStack gap="3" align="stretch">
                            <Slice.Presets slice={slice} />
                            <Table data={narrowed} columns={{
                                sku:    { header: "SKU" },
                                region: { header: "Region" },
                                qty:    { header: "Qty" },
                            }} />
                            <Slice.Summary slice={slice} />
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// 7b. Resolution segment — the shared bucket unit on Slice.Range (Plan spec §8).
//     Exercises: `resolutions={["week", "day"]}` rendering the WEEK · DAY
//     segment beside the range pill, a seeded `Slice.state({ resolution })`,
//     and `setResolution` re-bucketing every bound time-bucketed surface.
// ============================================================================

export const sliceResolution = example({
    keywords: ["Slice", "Range", "resolution", "resolutions", "segment", "week", "day", "bucket", "re-bucket", "setResolution", "shared", "unit", "seg"],
    description: "The Slice.Range resolution segment — `resolutions={[\"week\", \"day\"]}` renders the WEEK · DAY bucket-unit segment beside the range pill; the slice state is seeded `resolution: week` (the active segment), clicking a unit writes `setResolution` so every bound time-bucketed surface re-buckets together, and the Table + Summary below read the same slice",
    fn: East.function([], UIComponentType, (_$) => {
        const BookingType = StructType({ when: DateTimeType, route: StringType, seats: IntegerType });
        const cfg = Slice.config(BookingType, {
            fields: {
                when:  { label: "Departure", format: { date: "MMM DD" } },
                route: { label: "Route" },
                seats: { label: "Seats" },
            },
            rangeFieldId: "when",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { when: new Date("2025-03-03"), route: "SYD→MEL", seats: 140n },
                    { when: new Date("2025-03-10"), route: "SYD→BNE", seats: 96n },
                    { when: new Date("2025-03-17"), route: "MEL→SYD", seats: 152n },
                    { when: new Date("2025-03-24"), route: "SYD→MEL", seats: 88n },
                    { when: new Date("2025-03-31"), route: "SYD→PER", seats: 44n },
                ], ArrayType(BookingType));
                const slice = $.let(Slice.bind([BookingType], "ex.slice.resolution", cfg, Slice.state({
                    resolution: some(variant("week", null)),
                }), data, none));
                const narrowed = $.let(Slice.rows([BookingType], slice));
                return (
                    <VStack gap="3" align="stretch">
                        <Slice.Range slice={slice} resolutions={["week", "day"]} />
                        <Table data={narrowed} columns={{
                            when:  { header: "Departure" },
                            route: { header: "Route" },
                            seats: { header: "Seats" },
                        }} />
                        <Slice.Summary slice={slice} />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 8. Ops Gantt — Gantt with the `slice` chrome option.
//    Exercises: the rail on a timeline component (filter · search · range
//    over the row type's datetime field) and the derived-count footer.
// ============================================================================

export const sliceGanttChrome = example({
    keywords: ["Slice", "Gantt", "slice", "chrome", "filter", "search", "range", "timeline"],
    description: "Ops Gantt — Gantt with the `slice` chrome option: a header rail (`filter`, `search`, `range`) plus the `brush` affordance — drag a window on the timeline header to set the slice's range; a derived-count footer; rows fed explicitly via `Slice.rows`",
    fn: East.function([], UIComponentType, (_$) => {
        const JobType = StructType({ task: StringType, owner: StringType, start: DateTimeType, end: DateTimeType });
        const cfg = Slice.config(JobType, {
            fields: { task: { label: "Task" }, owner: { label: "Owner" }, start: { label: "Start" } },
            searchFieldIds: ["task", "owner"],
            rangeFieldId: "start",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { task: "Planning",    owner: "Alice",   start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                    { task: "Design",      owner: "Bob",     start: new Date("2024-01-10"), end: new Date("2024-02-01") },
                    { task: "Development", owner: "Charlie", start: new Date("2024-01-20"), end: new Date("2024-03-15") },
                    { task: "Testing",     owner: "Alice",   start: new Date("2024-03-01"), end: new Date("2024-03-30") },
                ], ArrayType(JobType));
                const slice = $.let(Slice.bind([JobType], "ex.slice.gantt.chrome", cfg, Slice.state({
                    filters: [variant("string", { fieldId: "owner", op: variant("eq", "Alice") })],
                }), data, none));
                const narrowed = $.let(Slice.rows([JobType], slice));
                return (
                    <Gantt
                        data={narrowed}
                        columns={["task", "owner"]}
                        rowSpec={row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })}
                        slice={slice}
                        affordances={["filter", "search", "range", "brush"]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
