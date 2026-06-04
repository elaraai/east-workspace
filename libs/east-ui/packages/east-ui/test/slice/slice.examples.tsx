/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, DateTimeType, StringType, IntegerType, ArrayType, StructType, variant, some, none, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Box, Reactive, Separator, Slice, Table, Text, VStack } from "@elaraai/east-ui/jsx";

export const sliceSummary = example({
    keywords: ["Slice", "Summary", "results", "filters", "clear"],
    description: "Result / filter-count status bar bound to a slice",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ country: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { country: { label: "Country" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["country"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { country: "US", sessions: 42n }, { country: "US", sessions: 8n },
                    { country: "UK", sessions: 31n }, { country: "DE", sessions: 12n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.summary", cfg, Slice.state({
                    filters: [
                        variant("string", { fieldId: "country", op: variant("eq", "US") }),
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ],
                }), data, none));
                return <Slice.Summary slice={slice} />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceRange = example({
    keywords: ["Slice", "Range", "preset", "time", "compare"],
    description: "Preset time-range picker (Today / 7d / 30d / 90d / YTD / Custom) with compare row",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ timestamp: DateTimeType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { timestamp: { label: "Time" }, sessions: { label: "Sessions" } },
            rangeFieldId: "timestamp",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { timestamp: new Date(Date.now() - 2 * 86400000), sessions: 42n },
                    { timestamp: new Date(Date.now() - 40 * 86400000), sessions: 18n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.range", cfg, Slice.state({
                    range: some(variant("datetimePreset", variant("last30d", null))),
                }), data, none));
                return <Slice.Range slice={slice} />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceFilter = example({
    keywords: ["Slice", "Filter", "predicate", "chips", "facet"],
    description: "Faceted predicate chips with a built-in add-filter builder + showing-count footer",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ scenario: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { scenario: { label: "Scenario" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["scenario", "region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { scenario: "procurement v3", region: "EU", sessions: 42n },
                    { scenario: "procurement v3", region: "NA", sessions: 18n },
                    { scenario: "logistics", region: "EU", sessions: 9n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.filter", cfg, Slice.state({
                    filters: [
                        variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") }),
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ],
                }), data, none));
                return (
                    <VStack gap="4" align="stretch">
                        {Text.Presets.Eyebrow("COMPACT · IN FRAME EYEBROW")}
                        <Slice.Filter slice={slice} unit="events" density="compact" />
                        <Separator orientation="horizontal" />
                        {Text.Presets.Eyebrow("FOCUSED · STANDALONE")}
                        <Slice.Filter slice={slice} unit="events" density="focused" />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceBreakdown = example({
    keywords: ["Slice", "Breakdown", "dimension", "series", "split"],
    description: "Split-by-dimension picker — dimensions + series computed by the bound slice",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ country: StringType, plan_tier: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { country: { label: "Country" }, plan_tier: { label: "plan_tier" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["country", "plan_tier"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { country: "US", plan_tier: "pro", sessions: 12n }, { country: "US", plan_tier: "free", sessions: 8n },
                    { country: "UK", plan_tier: "pro", sessions: 5n }, { country: "DE", plan_tier: "enterprise", sessions: 3n },
                    { country: "AU", plan_tier: "free", sessions: 2n }, { country: "FR", plan_tier: "pro", sessions: 2n },
                    { country: "NL", plan_tier: "free", sessions: 1n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.breakdown", cfg, Slice.state({
                    breakdown: some({ fieldId: "country", limit: none }),
                }), data, none));
                return (
                    <VStack gap="4" align="stretch">
                        {Text.Presets.Eyebrow("COMPACT · IN CHART-FRAME EYEBROW")}
                        <Slice.Breakdown slice={slice} density="compact" />
                        <Separator orientation="horizontal" />
                        {Text.Presets.Eyebrow("FOCUSED · STANDALONE")}
                        <Slice.Breakdown slice={slice} density="focused" />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceLegend = example({
    keywords: ["Slice", "Legend", "series", "swatch", "visibility"],
    description: "Series swatch / visibility rail over the bound slice's breakdown groups",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { region: "EU", sessions: 12n }, { region: "EU", sessions: 6n },
                    { region: "NA", sessions: 9n }, { region: "APAC", sessions: 4n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.legend", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                return <Slice.Legend slice={slice} />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceSearch = example({
    keywords: ["Slice", "Search", "typeahead", "combobox", "commit"],
    description: "Combobox typeahead — suggestions projected from the bound rows via toMatch",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ sku: StringType, name: StringType, note: StringType });
        const cfg = Slice.config(EventType, {
            fields: { sku: { label: "SKU" }, name: { label: "Name" }, note: { label: "Note" } },
            searchFieldIds: ["sku"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { sku: "SKU-001", name: "Industrial fan", note: "demand-spike pattern" },
                    { sku: "SKU-0012", name: "Switching unit", note: "last seen 09-12" },
                    { sku: "SKU-0018", name: "Pump motor", note: "last seen 09-10" },
                    { sku: "SKU-0019", name: "Filter set", note: "last seen 09-09" },
                    { sku: "SKU-022", name: "Conveyor belt", note: "last seen 09-02" },
                ], ArrayType(EventType));
                const toMatch = $.const(East.function([EventType], Slice.Types.SearchMatch, ($, r) =>
                    ({ id: r.sku, label: r.name, meta: some(r.note) })));
                const slice = $.let(Slice.bind([EventType], "ex.slice.search", cfg, Slice.state({
                    search: some("SKU-001"),
                }), data, some(toMatch)));
                return (
                    <VStack gap="4" align="stretch">
                        {Text.Presets.Eyebrow("COMPACT · IN FRAME EYEBROW")}
                        <Slice.Search slice={slice} density="compact" />
                        <Separator orientation="horizontal" />
                        {Text.Presets.Eyebrow("FOCUSED · STANDALONE")}
                        <Slice.Search slice={slice} recent={["demand-spike", "SKU-022"]} density="focused" />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceCohort = example({
    keywords: ["Slice", "Cohort", "segment", "predicate", "saved"],
    description: "Saved-segment chips with focused-cohort predicate detail + Edit / Apply / Remove",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ page_views: IntegerType, sessions: IntegerType, plan_tier: StringType });
        const cfg = Slice.config(EventType, {
            fields: { page_views: { label: "Page views" }, sessions: { label: "Sessions" }, plan_tier: { label: "Plan tier" } },
            searchFieldIds: ["plan_tier"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { page_views: 40n, sessions: 18n, plan_tier: "pro" }, { page_views: 25n, sessions: 12n, plan_tier: "enterprise" },
                    { page_views: 5n, sessions: 1n, plan_tier: "free" }, { page_views: 30n, sessions: 11n, plan_tier: "pro" },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.cohort", cfg, Slice.state({
                    cohorts: [
                        { id: "power-users", name: "Power users", filters: [
                            variant("integer", { fieldId: "page_views", op: variant("gte", 20n) }),
                            variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                            variant("string", { fieldId: "plan_tier", op: variant("in", new Set(["pro", "enterprise"])) }),
                        ] },
                        { id: "trial-paid", name: "Trial → paid", filters: [variant("string", { fieldId: "plan_tier", op: variant("eq", "pro") })] },
                        { id: "churn-risk", name: "Churn risk", filters: [variant("integer", { fieldId: "sessions", op: variant("lt", 2n) })] },
                    ],
                    activeCohorts: new Set(["power-users"]),
                }), data, none));
                return <Slice.Cohort slice={slice} createdBy="d.park" lastEdited="09-08" reevaluateEvery="every 10 min" />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceComposed = example({
    keywords: ["Slice", "Frame", "Table", "apply", "where", "narrowing", "container"],
    description: "A Table consumer housed in a Slice.Frame — the eyebrow mounts the listed `[\"filter\", \"search\"]` affordances; the footer shows the derived narrowed count",
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
                    { scenario: "procurement v3", region: "APAC", sessions: 7n },
                    { scenario: "logistics",      region: "NA",   sessions: 56n },
                    { scenario: "procurement v3", region: "NA",   sessions: 12n },
                    { scenario: "procurement v2", region: "APAC", sessions: 25n },
                    { scenario: "procurement v3", region: "EU",   sessions: 9n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.frame.table", cfg, Slice.state({
                    filters: [
                        variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") }),
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ],
                }), data, none));
                const filtered = $.let(Slice.apply.where([EventType], slice.read(), cfg, data));
                return (
                    <Slice.Frame slice={slice} affordances={["filter", "search"]}>
                        <Table data={filtered} columns={{
                            scenario: { header: "Scenario" },
                            region:   { header: "Region" },
                            sessions: { header: "Sessions" },
                        }} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceFrameNarrow = example({
    keywords: ["Slice", "Frame", "narrow", "overflow", "compress", "wrap", "eyebrow"],
    description: "A Slice.Frame in a width-constrained container — more filter chips than fit one line, so the affordance bar reflows to stacked labelled rows (nothing hidden); the filter's own excess clauses still collapse to `+N more`",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ scenario: StringType, region: StringType, plan_tier: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { scenario: { label: "Scenario" }, region: { label: "Region" }, plan_tier: { label: "Plan tier" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["scenario", "region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { scenario: "procurement v3", region: "EU", plan_tier: "pro", sessions: 42n },
                    { scenario: "procurement v3", region: "NA", plan_tier: "enterprise", sessions: 18n },
                    { scenario: "logistics", region: "EU", plan_tier: "free", sessions: 9n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.frame.narrow", cfg, Slice.state({
                    filters: [
                        variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") }),
                        variant("string", { fieldId: "region", op: variant("in", new Set(["EU", "NA"])) }),
                        variant("string", { fieldId: "plan_tier", op: variant("eq", "pro") }),
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                        variant("integer", { fieldId: "sessions", op: variant("lt", 100n) }),
                        variant("string", { fieldId: "region", op: variant("neq", "APAC") }),
                    ],
                }), data, none));
                const filtered = $.let(Slice.apply.where([EventType], slice.read(), cfg, data));
                // Constrain the width so the eyebrow can't fit six chips + search.
                return (
                    <Box width="520px" maxWidth="520px">
                        <Slice.Frame slice={slice} affordances={["filter", "search"]}>
                            <Table data={filtered} columns={{
                                scenario: { header: "Scenario" },
                                region:   { header: "Region" },
                                sessions: { header: "Sessions" },
                            }} />
                        </Slice.Frame>
                    </Box>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceFrameFaceted = example({
    keywords: ["Slice", "Frame", "Table", "Filter", "Search", "Breakdown", "Range", "eyebrow", "composed"],
    description: "A Table consumer in a Slice.Frame mounting `[\"filter\", \"breakdown\", \"search\"]` — each renders as a labelled block in the eyebrow's affordance bar, reflowing to stacked rows when they don't fit one line",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({
            timestamp: DateTimeType, region: StringType, plan_tier: StringType,
            sku: StringType, name: StringType, sessions: IntegerType,
        });
        const cfg = Slice.config(EventType, {
            fields: {
                timestamp: { label: "Time" }, region: { label: "Region" }, plan_tier: { label: "Plan tier" },
                sku: { label: "SKU" }, name: { label: "Name" }, sessions: { label: "Sessions" },
            },
            searchFieldIds: ["sku", "name"],
            breakdownFieldIds: ["region", "plan_tier"],
            rangeFieldId: "timestamp",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { timestamp: new Date(Date.now() - 2 * 86400000),  region: "EU",   plan_tier: "pro",        sku: "SKU-001", name: "Industrial fan", sessions: 42n },
                    { timestamp: new Date(Date.now() - 5 * 86400000),  region: "NA",   plan_tier: "enterprise", sku: "SKU-012", name: "Switching unit",  sessions: 18n },
                    { timestamp: new Date(Date.now() - 9 * 86400000),  region: "EU",   plan_tier: "free",       sku: "SKU-018", name: "Pump motor",     sessions: 9n },
                    { timestamp: new Date(Date.now() - 12 * 86400000), region: "APAC", plan_tier: "pro",        sku: "SKU-019", name: "Filter set",     sessions: 31n },
                    { timestamp: new Date(Date.now() - 18 * 86400000), region: "NA",   plan_tier: "pro",        sku: "SKU-022", name: "Conveyor belt",  sessions: 56n },
                    { timestamp: new Date(Date.now() - 25 * 86400000), region: "APAC", plan_tier: "free",       sku: "SKU-031", name: "Drive shaft",    sessions: 7n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.frame.faceted", cfg, Slice.state({
                    range: some(variant("datetimePreset", variant("last30d", null))),
                    filters: [
                        variant("string", { fieldId: "plan_tier", op: variant("in", new Set(["pro", "enterprise"])) }),
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ],
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                const filtered = $.let(Slice.apply.where([EventType], slice.read(), cfg, data));
                return (
                    <Slice.Frame slice={slice} affordances={["filter", "breakdown", "search"]}>
                        <Table data={filtered} columns={{
                            sku:       { header: "SKU" },
                            name:      { header: "Name" },
                            region:    { header: "Region" },
                            plan_tier: { header: "Plan tier" },
                            sessions:  { header: "Sessions" },
                        }} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceFrameFull = example({
    keywords: ["Slice", "Frame", "affordances", "collapsible", "filter", "breakdown", "cohort", "range", "search", "stacked"],
    description: "A Slice.Frame mounting all five affordances (`filter`, `breakdown`, `cohort`, `range`, `search`) — they reflow to stacked labelled rows, and the eyebrow is `collapsible` to a one-line summary of the active narrowing",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({
            timestamp: DateTimeType, region: StringType, plan_tier: StringType,
            sku: StringType, name: StringType, sessions: IntegerType,
        });
        const cfg = Slice.config(EventType, {
            fields: {
                timestamp: { label: "Time" }, region: { label: "Region" }, plan_tier: { label: "Plan tier" },
                sku: { label: "SKU" }, name: { label: "Name" }, sessions: { label: "Sessions" },
            },
            searchFieldIds: ["sku", "name"],
            breakdownFieldIds: ["region", "plan_tier"],
            rangeFieldId: "timestamp",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { timestamp: new Date(Date.now() - 2 * 86400000),  region: "EU",   plan_tier: "pro",        sku: "SKU-001", name: "Industrial fan", sessions: 42n },
                    { timestamp: new Date(Date.now() - 5 * 86400000),  region: "NA",   plan_tier: "enterprise", sku: "SKU-012", name: "Switching unit",  sessions: 18n },
                    { timestamp: new Date(Date.now() - 9 * 86400000),  region: "EU",   plan_tier: "free",       sku: "SKU-018", name: "Pump motor",     sessions: 9n },
                    { timestamp: new Date(Date.now() - 12 * 86400000), region: "APAC", plan_tier: "pro",        sku: "SKU-019", name: "Filter set",     sessions: 31n },
                    { timestamp: new Date(Date.now() - 18 * 86400000), region: "NA",   plan_tier: "pro",        sku: "SKU-022", name: "Conveyor belt",  sessions: 56n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.frame.full", cfg, Slice.state({
                    range: some(variant("datetimePreset", variant("last30d", null))),
                    filters: [
                        variant("string", { fieldId: "plan_tier", op: variant("in", new Set(["pro", "enterprise"])) }),
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ],
                    breakdown: some({ fieldId: "region", limit: none }),
                    cohorts: [
                        { id: "power-users", name: "Power users", filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 30n) })] },
                        { id: "enterprise",  name: "Enterprise",  filters: [variant("string", { fieldId: "plan_tier", op: variant("eq", "enterprise") })] },
                    ],
                    activeCohorts: new Set(["power-users"]),
                }), data, none));
                const filtered = $.let(Slice.apply.where([EventType], slice.read(), cfg, data));
                return (
                    <Slice.Frame slice={slice} affordances={["filter", "breakdown", "cohort", "range", "search"]} collapsible={true}>
                        <Table data={filtered} columns={{
                            sku:      { header: "SKU" },
                            name:     { header: "Name" },
                            region:   { header: "Region" },
                            sessions: { header: "Sessions" },
                        }} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceChartFrame = example({
    keywords: ["Slice", "Frame", "Chart", "Breakdown", "Legend", "series", "container"],
    description: "A Chart consumer housed in a Slice.Frame — the `breakdown` affordance splits the line into one series per dimension via `slice.series`; switch Split-by between region and plan tier; Slice.Legend labels (and toggles) the series beneath the chart",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ month: StringType, region: StringType, plan_tier: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { month: { label: "Month" }, region: { label: "Region" }, plan_tier: { label: "Plan tier" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region", "plan_tier"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { month: "Jan", region: "EU", plan_tier: "pro", sessions: 30n }, { month: "Jan", region: "NA", plan_tier: "free", sessions: 22n }, { month: "Jan", region: "APAC", plan_tier: "pro", sessions: 9n },
                    { month: "Feb", region: "EU", plan_tier: "free", sessions: 42n }, { month: "Feb", region: "NA", plan_tier: "pro", sessions: 28n }, { month: "Feb", region: "APAC", plan_tier: "free", sessions: 14n },
                    { month: "Mar", region: "EU", plan_tier: "pro", sessions: 38n }, { month: "Mar", region: "NA", plan_tier: "free", sessions: 41n }, { month: "Mar", region: "APAC", plan_tier: "pro", sessions: 18n },
                    { month: "Apr", region: "EU", plan_tier: "free", sessions: 51n }, { month: "Apr", region: "NA", plan_tier: "pro", sessions: 36n }, { month: "Apr", region: "APAC", plan_tier: "free", sessions: 25n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.frame.chart", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                // Slice.Chart.Line pivots the narrowed rows by the active breakdown
                // into one coloured line per value (colours assigned by the slice,
                // matching the bundled legend) — fully data-driven, no hardcoding.
                return (
                    <Slice.Frame slice={slice} affordances={["breakdown"]}>
                        <Slice.Chart.Line slice={slice} x="month" value="sessions" height={150} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceChartBar = example({
    keywords: ["Slice", "Chart", "Bar", "Breakdown", "series"],
    description: "`Slice.Chart.Bar` — the active breakdown splits the data into one coloured bar series per dimension value, sharing the bundled legend's colours",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ month: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { month: { label: "Month" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { month: "Jan", region: "EU", sessions: 30n }, { month: "Jan", region: "NA", sessions: 22n }, { month: "Jan", region: "APAC", sessions: 9n },
                    { month: "Feb", region: "EU", sessions: 42n }, { month: "Feb", region: "NA", sessions: 28n }, { month: "Feb", region: "APAC", sessions: 14n },
                    { month: "Mar", region: "EU", sessions: 38n }, { month: "Mar", region: "NA", sessions: 41n }, { month: "Mar", region: "APAC", sessions: 18n },
                    { month: "Apr", region: "EU", sessions: 51n }, { month: "Apr", region: "NA", sessions: 36n }, { month: "Apr", region: "APAC", sessions: 25n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.chart.bar", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                return (
                    <Slice.Frame slice={slice} affordances={["breakdown"]}>
                        <Slice.Chart.Bar slice={slice} x="month" value="sessions" height={150} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceChartArea = example({
    keywords: ["Slice", "Chart", "Area", "Breakdown", "series"],
    description: "`Slice.Chart.Area` — one filled area per breakdown series, the slice's palette feeding both the fill and the legend swatch",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ month: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { month: { label: "Month" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { month: "Jan", region: "EU", sessions: 30n }, { month: "Jan", region: "NA", sessions: 22n }, { month: "Jan", region: "APAC", sessions: 9n },
                    { month: "Feb", region: "EU", sessions: 42n }, { month: "Feb", region: "NA", sessions: 28n }, { month: "Feb", region: "APAC", sessions: 14n },
                    { month: "Mar", region: "EU", sessions: 38n }, { month: "Mar", region: "NA", sessions: 41n }, { month: "Mar", region: "APAC", sessions: 18n },
                    { month: "Apr", region: "EU", sessions: 51n }, { month: "Apr", region: "NA", sessions: 36n }, { month: "Apr", region: "APAC", sessions: 25n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.chart.area", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                return (
                    <Slice.Frame slice={slice} affordances={["breakdown"]}>
                        <Slice.Chart.Area slice={slice} x="month" value="sessions" height={150} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceChartScatter = example({
    keywords: ["Slice", "Chart", "Scatter", "Breakdown", "points"],
    description: "`Slice.Chart.Scatter` — point markers per breakdown series, one set of dots per dimension value",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ month: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { month: { label: "Month" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { month: "Jan", region: "EU", sessions: 30n }, { month: "Jan", region: "NA", sessions: 22n }, { month: "Jan", region: "APAC", sessions: 9n },
                    { month: "Feb", region: "EU", sessions: 42n }, { month: "Feb", region: "NA", sessions: 28n }, { month: "Feb", region: "APAC", sessions: 14n },
                    { month: "Mar", region: "EU", sessions: 38n }, { month: "Mar", region: "NA", sessions: 41n }, { month: "Mar", region: "APAC", sessions: 18n },
                    { month: "Apr", region: "EU", sessions: 51n }, { month: "Apr", region: "NA", sessions: 36n }, { month: "Apr", region: "APAC", sessions: 25n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.chart.scatter", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                return (
                    <Slice.Frame slice={slice} affordances={["breakdown"]}>
                        <Slice.Chart.Scatter slice={slice} x="month" value="sessions" height={150} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceChartTime = example({
    keywords: ["Slice", "Chart", "Line", "time", "datetime", "axis", "xScale"],
    description: "`Slice.Chart.Line` over a continuous **time** x-axis (`xScale: \"time\"`) — the `DateTime` x field lays out by date, not as discrete categories",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ day: DateTimeType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { day: { label: "Day" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { day: new Date("2025-01-06"), region: "EU", sessions: 30n }, { day: new Date("2025-01-06"), region: "NA", sessions: 22n },
                    { day: new Date("2025-01-13"), region: "EU", sessions: 42n }, { day: new Date("2025-01-13"), region: "NA", sessions: 28n },
                    { day: new Date("2025-01-27"), region: "EU", sessions: 38n }, { day: new Date("2025-01-27"), region: "NA", sessions: 41n },
                    { day: new Date("2025-02-17"), region: "EU", sessions: 51n }, { day: new Date("2025-02-17"), region: "NA", sessions: 36n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.chart.time", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                return (
                    <Slice.Frame slice={slice} affordances={["breakdown"]}>
                        <Slice.Chart.Line slice={slice} x="day" value="sessions" xScale="time" height={150} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceChartLinearX = example({
    keywords: ["Slice", "Chart", "Scatter", "linear", "numeric", "axis", "xScale"],
    description: "`Slice.Chart.Scatter` over a continuous **linear** x-axis (`xScale: \"linear\"`) — a numeric x field positions points along the axis rather than bucketing them",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ spend: IntegerType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { spend: { label: "Spend" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { spend: 10n, region: "EU", sessions: 12n }, { spend: 25n, region: "EU", sessions: 28n }, { spend: 60n, region: "EU", sessions: 44n }, { spend: 90n, region: "EU", sessions: 51n },
                    { spend: 15n, region: "NA", sessions: 9n }, { spend: 40n, region: "NA", sessions: 22n }, { spend: 70n, region: "NA", sessions: 33n }, { spend: 110n, region: "NA", sessions: 38n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.chart.linear", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                return (
                    <Slice.Frame slice={slice} affordances={["breakdown"]}>
                        <Slice.Chart.Scatter slice={slice} x="spend" value="sessions" xScale="linear" height={150} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const sliceChartBrush = example({
    keywords: ["Slice", "Chart", "Line", "brush", "range", "time", "drag", "setRange"],
    description: "`Slice.Chart.Line` with `brush: true` — drag across the time x-axis to set the slice's range (`setRange`), re-narrowing every bound control in sync; clearing the brush resets the range to none",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ day: DateTimeType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { day: { label: "Day" }, sessions: { label: "Sessions" } },
            rangeFieldId: "day",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { day: new Date("2025-01-06"), sessions: 30n }, { day: new Date("2025-01-13"), sessions: 42n },
                    { day: new Date("2025-01-20"), sessions: 38n }, { day: new Date("2025-01-27"), sessions: 51n },
                    { day: new Date("2025-02-03"), sessions: 47n }, { day: new Date("2025-02-10"), sessions: 60n },
                    { day: new Date("2025-02-17"), sessions: 55n }, { day: new Date("2025-02-24"), sessions: 68n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.chart.brush", cfg, Slice.state(), data, none));
                return (
                    <Slice.Frame slice={slice} affordances={["range"]}>
                        <Slice.Chart.Line slice={slice} x="day" value="sessions" xScale="time" brush={true} legend={false} height={160} />
                    </Slice.Frame>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
