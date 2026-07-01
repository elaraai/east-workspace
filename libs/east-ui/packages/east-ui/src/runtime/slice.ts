/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `<Slice.*>` tag namespace — a family of slice-bound controls that read
 * and write one shared narrowing state, plus the platform that creates and
 * applies it. A *slice* is a typed view over a row collection: a range, a set
 * of filter predicates, a search, a breakdown dimension, and saved cohorts.
 * You build it with the platform members (`Slice.config` declares the fields,
 * `Slice.bind` binds rows + initial `Slice.state` under a stable id) and then
 * drop in whichever `<Slice.*>` controls a surface needs — they all stay in
 * sync because they target the same bound handle.
 *
 * Component tags fall into three roles:
 * - **Controls** (`<Slice.Summary>`, `<Slice.Range>`, `<Slice.Filter>`,
 *   `<Slice.Breakdown>`, `<Slice.Legend>`, `<Slice.Search>`, `<Slice.Cohort>`,
 *   `<Slice.Presets>`) — self-driving widgets that mutate the bound state on
 *   interaction; each takes a flat options bag whose only required prop is
 *   `slice`.
 * - **Strip** (`<Slice.Rail>`) — the affordance cluster standalone; components
 *   with the `slice` chrome option mount the same cluster in their own header.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, StructType, StringType, IntegerType, ArrayType, none } from "@elaraai/east";
 * import { Reactive, Slice, Table, UIComponentType } from "@elaraai/east-ui";
 *
 * const view = East.function([], UIComponentType, _$ => {
 *     const EventType = StructType({ scenario: StringType, sessions: IntegerType });
 *     const cfg = Slice.config(EventType, {
 *         fields: { scenario: { label: "Scenario" }, sessions: { label: "Sessions" } },
 *         searchFieldIds: ["scenario"],
 *     });
 *     return (
 *         <Reactive>{$ => {
 *             const data = $.const([{ scenario: "v3", sessions: 42n }], ArrayType(EventType));
 *             const slice = $.let(Slice.bind([EventType], "ex.slice", cfg, Slice.state(), data, none));
 *             const filtered = $.let(Slice.apply.where([EventType], slice.read(), cfg, data));
 *             return (
 *                 <Slice.Frame slice={slice} affordances={["filter", "search"]}>
 *                     <Table data={filtered} columns={{ scenario: { header: "Scenario" }, sessions: { header: "Sessions" } }} />
 *                 </Slice.Frame>
 *             );
 *         }}</Reactive>
 *     );
 * });
 * ```
 *
 * @remarks
 * Carries the slice platform alongside the tags: `Slice.config` (declares the
 * fields), `Slice.bind` (binds rows + initial state under a stable id),
 * `Slice.state` (the initial-state builder), `Slice.apply` (the pure
 * narrowing — `Slice.apply.where`, `.breakdown`, …), and `Slice.Types` (every
 * East type: `State`, `Predicate`, `Range`, `Breakdown`, `Cohort`,
 * `SearchMatch`, …). One import from `@elaraai/east-ui` wires the whole
 * surface.
 */

import { Slice as SliceFactory } from "../slice/index.js";
import { optionsTag, type OptionsProps, type JsxTag } from "./combinators.js";

/** The `<Slice.*>` tag namespace: component tags + the carried platform API. */
type SliceTags = {
    Summary: JsxTag<OptionsProps<typeof SliceFactory.Summary.Root>>;
    Range: JsxTag<OptionsProps<typeof SliceFactory.Range.Root>>;
    Filter: JsxTag<OptionsProps<typeof SliceFactory.Filter.Root>>;
    Breakdown: JsxTag<OptionsProps<typeof SliceFactory.Breakdown.Root>>;
    Legend: JsxTag<OptionsProps<typeof SliceFactory.Legend.Root>>;
    Search: JsxTag<OptionsProps<typeof SliceFactory.Search.Root>>;
    Cohort: JsxTag<OptionsProps<typeof SliceFactory.Cohort.Root>>;
    Presets: JsxTag<OptionsProps<typeof SliceFactory.Presets.Root>>;
    Rail: JsxTag<OptionsProps<typeof SliceFactory.Rail.Root>>;
    config: typeof SliceFactory.config;
    bind: typeof SliceFactory.bind;
    rows: typeof SliceFactory.rows;
    partition: typeof SliceFactory.partition;
    partitionRowType: typeof SliceFactory.partitionRowType;
    state: typeof SliceFactory.state;
    apply: typeof SliceFactory.apply;
    Types: typeof SliceFactory.Types;
};

/**
 * The slice-bound component family + the slice platform. See the namespace
 * doc above for the full surface; each tag below carries its own TypeDoc.
 */
export const Slice: SliceTags = {
    /**
     * One-line `N results · M filters · clear all` status bar bound to a
     * slice. Reach for it as the unobtrusive footer of a slice surface — the
     * result count comes from the rows bound at `Slice.bind`, the filter count
     * from the bound state, and `clear all` resets every predicate. Props are
     * flat ({@link SliceSummaryOptions}); the only required one is `slice`.
     *
     * @example
     * ```tsx
     * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
     * import { East, StructType, StringType, IntegerType, ArrayType, variant, none } from "@elaraai/east";
     * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
     *
     * const view = East.function([], UIComponentType, _$ => {
     *     const EventType = StructType({ country: StringType, sessions: IntegerType });
     *     const cfg = Slice.config(EventType, { fields: { country: { label: "Country" }, sessions: { label: "Sessions" } } });
     *     return (
     *         <Reactive>{$ => {
     *             const data = $.const([{ country: "US", sessions: 42n }], ArrayType(EventType));
     *             const slice = $.let(Slice.bind([EventType], "ex.slice.summary", cfg, Slice.state({
     *                 filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
     *             }), data, none));
     *             return <Slice.Summary slice={slice} />;
     *         }}</Reactive>
     *     );
     * });
     * ```
     *
     * @remarks
     * Carries `Slice.Summary.Types` (the `Summary` East type). Desugars to
     * `Slice.Summary.Root(options)`.
     */
    Summary: optionsTag(SliceFactory.Summary.Root),
    /**
     * A single time-range pill bound to a slice. Click it to open the picker
     * popover with presets (`Today / 7d / 30d / 90d / YTD / Custom…`), an
     * optional compare row, and the resolved window. Use it wherever a surface
     * narrows by a `DateTime` field (the slice's `rangeFieldId`). Props are
     * flat ({@link SliceRangeOptions}); the only required one is `slice`.
     *
     * @example
     * ```tsx
     * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
     * import { East, StructType, DateTimeType, IntegerType, ArrayType, variant, some, none } from "@elaraai/east";
     * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
     *
     * const view = East.function([], UIComponentType, _$ => {
     *     const EventType = StructType({ timestamp: DateTimeType, sessions: IntegerType });
     *     const cfg = Slice.config(EventType, {
     *         fields: { timestamp: { label: "Time" }, sessions: { label: "Sessions" } },
     *         rangeFieldId: "timestamp",
     *     });
     *     return (
     *         <Reactive>{$ => {
     *             const data = $.const([{ timestamp: new Date(), sessions: 42n }], ArrayType(EventType));
     *             const slice = $.let(Slice.bind([EventType], "ex.slice.range", cfg, Slice.state({
     *                 range: some(variant("datetimePreset", variant("last30d", null))),
     *             }), data, none));
     *             return <Slice.Range slice={slice} />;
     *         }}</Reactive>
     *     );
     * });
     * ```
     *
     * @remarks
     * Carries `Slice.Range.Types` (the `Range` picker East type). Desugars to
     * `Slice.Range.Root(options)`.
     */
    Range: optionsTag(SliceFactory.Range.Root),
    /**
     * Faceted predicate chips bound to a slice. Each filter in the bound state
     * renders as a chip (field · operator · value) with a remove `×`; the
     * built-in `+ add filter` builder (driven by the slice's fields) appends
     * new predicates with no host wiring. Reach for it as the primary
     * narrowing control of a table surface. Props are flat
     * ({@link SliceFilterOptions}); `density` defaults from the surrounding rail.
     *
     * @example
     * ```tsx
     * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
     * import { East, StructType, StringType, IntegerType, ArrayType, variant, none } from "@elaraai/east";
     * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
     *
     * const view = East.function([], UIComponentType, _$ => {
     *     const EventType = StructType({ scenario: StringType, sessions: IntegerType });
     *     const cfg = Slice.config(EventType, {
     *         fields: { scenario: { label: "Scenario" }, sessions: { label: "Sessions" } },
     *         searchFieldIds: ["scenario"],
     *     });
     *     return (
     *         <Reactive>{$ => {
     *             const data = $.const([{ scenario: "v3", sessions: 42n }], ArrayType(EventType));
     *             const slice = $.let(Slice.bind([EventType], "ex.slice.filter", cfg, Slice.state({
     *                 filters: [variant("string", { fieldId: "scenario", op: variant("eq", "v3") })],
     *             }), data, none));
     *             return <Slice.Filter slice={slice} unit="events" density="compact" />;
     *         }}</Reactive>
     *     );
     * });
     * ```
     *
     * @remarks
     * Carries `Slice.Filter.Types` (the `Filter` East type). Desugars to
     * `Slice.Filter.Root(options)`.
     */
    Filter: optionsTag(SliceFactory.Filter.Root),
    /**
     * Split-by-dimension picker bound to a slice. Dimension chips (the fields
     * declared as `breakdownFieldIds`) set the active breakdown — the chosen
     * one is brand-tinted with a remove `×` — and a preview of the resulting
     * series is rendered from the platform-computed groups. Pair it with a
     * a `Chart.Series` layer / `Slice.Legend` to split a chart into series. Props are
     * flat ({@link SliceBreakdownOptions}); `density` defaults from the
     * surrounding `Slice.Frame`.
     *
     * @example
     * ```tsx
     * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
     * import { East, StructType, StringType, IntegerType, ArrayType, some, none } from "@elaraai/east";
     * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
     *
     * const view = East.function([], UIComponentType, _$ => {
     *     const EventType = StructType({ country: StringType, sessions: IntegerType });
     *     const cfg = Slice.config(EventType, {
     *         fields: { country: { label: "Country" }, sessions: { label: "Sessions" } },
     *         breakdownFieldIds: ["country"],
     *     });
     *     return (
     *         <Reactive>{$ => {
     *             const data = $.const([{ country: "US", sessions: 12n }], ArrayType(EventType));
     *             const slice = $.let(Slice.bind([EventType], "ex.slice.breakdown", cfg, Slice.state({
     *                 breakdown: some({ fieldId: "country", limit: none }),
     *             }), data, none));
     *             return <Slice.Breakdown slice={slice} density="compact" />;
     *         }}</Reactive>
     *     );
     * });
     * ```
     *
     * @remarks
     * Carries `Slice.Breakdown.Types` (the `Breakdown` picker East type).
     * Desugars to `Slice.Breakdown.Root(options)`.
     */
    Breakdown: optionsTag(SliceFactory.Breakdown.Root),
    /**
     * Inline `swatch · label · count` rail over the slice's active breakdown
     * series. The default `filter` mode is a **facet bar** (#188): items come
     * from the self-excluding `slice.facetGroups()` — options never disappear
     * while selected — and clicking one toggles it in the field's `in`-set
     * filter (OR within the field, AND across fields), narrowing every view
     * bound to the same slice key. `mode: "visibility"` is the
     * chart-decluttering rail instead: clicking flips the series' membership
     * in `state.visible` (rows untouched). Colours match whatever
     * `Chart.Series` is rendering the same series. Props are flat
     * ({@link SliceLegendOptions}); the only required one is `slice`.
     *
     * @example
     * ```tsx
     * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
     * import { East, StructType, StringType, IntegerType, ArrayType, some, none } from "@elaraai/east";
     * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
     *
     * const view = East.function([], UIComponentType, _$ => {
     *     const EventType = StructType({ region: StringType, sessions: IntegerType });
     *     const cfg = Slice.config(EventType, {
     *         fields: { region: { label: "Region" }, sessions: { label: "Sessions" } },
     *         breakdownFieldIds: ["region"],
     *     });
     *     return (
     *         <Reactive>{$ => {
     *             const data = $.const([{ region: "EU", sessions: 12n }], ArrayType(EventType));
     *             const slice = $.let(Slice.bind([EventType], "ex.slice.legend", cfg, Slice.state({
     *                 breakdown: some({ fieldId: "region", limit: none }),
     *             }), data, none));
     *             return <Slice.Legend slice={slice} />;
     *         }}</Reactive>
     *     );
     * });
     * ```
     *
     * @remarks
     * Carries `Slice.Legend.Types` (the `Legend` East type). Desugars to
     * `Slice.Legend.Root(options)`.
     */
    Legend: optionsTag(SliceFactory.Legend.Root),
    /**
     * Combobox typeahead over a slice dimension. Typing drives the bound
     * search state; suggestions come from the rows the bind projects through
     * its `toMatch` function (so this control needs a slice bound with a
     * `toMatch`), and selecting a suggestion commits it. Use it for
     * find-by-id / find-by-name narrowing. Props are flat
     * ({@link SliceSearchOptions}); `density` defaults from the surrounding rail.
     *
     * @example
     * ```tsx
     * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
     * import { East, StructType, StringType, ArrayType, some } from "@elaraai/east";
     * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
     *
     * const view = East.function([], UIComponentType, _$ => {
     *     const EventType = StructType({ sku: StringType, name: StringType, note: StringType });
     *     const cfg = Slice.config(EventType, {
     *         fields: { sku: { label: "SKU" }, name: { label: "Name" }, note: { label: "Note" } },
     *         searchFieldIds: ["sku"],
     *     });
     *     return (
     *         <Reactive>{$ => {
     *             const data = $.const([{ sku: "SKU-001", name: "Industrial fan", note: "spike" }], ArrayType(EventType));
     *             const toMatch = $.const(East.function([EventType], Slice.Types.SearchMatch, ($, r) =>
     *                 ({ id: r.sku, label: r.name, meta: some(r.note) })));
     *             const slice = $.let(Slice.bind([EventType], "ex.slice.search", cfg, Slice.state({
     *                 search: some("SKU-001"),
     *             }), data, some(toMatch)));
     *             return <Slice.Search slice={slice} density="compact" />;
     *         }}</Reactive>
     *     );
     * });
     * ```
     *
     * @remarks
     * Carries `Slice.Search.Types` (`Search`, the `Match` row-projection
     * struct, and the `Matches` array). Desugars to
     * `Slice.Search.Root(options)`.
     */
    Search: optionsTag(SliceFactory.Search.Root),
    /**
     * Toggleable saved-segment chips bound to a slice. Each cohort in the
     * bound state is a named bundle of AND-ed predicates rendered as a chip
     * (swatch · name · live count, active ones brand-tinted); the chip's
     * primary click toggles it on/off via `slice.toggleCohort(id)` (#163). In
     * `manage` mode (the default) a secondary pencil opens the editor popover
     * (clauses + Apply / Remove, captioned with the author / freshness /
     * re-evaluation meta you pass) and a `+ cohort` pill authors new ones;
     * `mode: "toggle"` renders a pure preset bar. Props are flat
     * ({@link SliceCohortOptions}); the only required one is `slice`.
     *
     * @example
     * ```tsx
     * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
     * import { East, StructType, StringType, IntegerType, ArrayType, variant, none } from "@elaraai/east";
     * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
     *
     * const view = East.function([], UIComponentType, _$ => {
     *     const EventType = StructType({ sessions: IntegerType, plan_tier: StringType });
     *     const cfg = Slice.config(EventType, {
     *         fields: { sessions: { label: "Sessions" }, plan_tier: { label: "Plan tier" } },
     *         searchFieldIds: ["plan_tier"],
     *     });
     *     return (
     *         <Reactive>{$ => {
     *             const data = $.const([{ sessions: 18n, plan_tier: "pro" }], ArrayType(EventType));
     *             const slice = $.let(Slice.bind([EventType], "ex.slice.cohort", cfg, Slice.state({
     *                 cohorts: [{ id: "power-users", name: "Power users", filters: [
     *                     variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
     *                 ] }],
     *                 activeCohorts: new Set(["power-users"]),
     *             }), data, none));
     *             return <Slice.Cohort slice={slice} createdBy="d.park" reevaluateEvery="every 10 min" />;
     *         }}</Reactive>
     *     );
     * });
     * ```
     *
     * @remarks
     * Carries `Slice.Cohort.Types` (the `Cohort` picker East type). Desugars
     * to `Slice.Cohort.Root(options)`.
     */
    Cohort: optionsTag(SliceFactory.Cohort.Root),
    /**
     * Curated preset bar — `Slice.Cohort` pinned to `mode: "toggle"` (#163):
     * developer-seeded cohorts render as pure on/off segment chips with live
     * counts and no authoring affordances (no pencil, no `+ cohort`). Reach
     * for it to ship predefined filter groups users just click on and off.
     * Props are flat ({@link SlicePresetsOptions}); the only required one is
     * `slice`.
     *
     * @example
     * ```tsx
     * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
     * import { East, StructType, StringType, IntegerType, ArrayType, variant, none } from "@elaraai/east";
     * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
     *
     * const view = East.function([], UIComponentType, _$ => {
     *     const OrderType = StructType({ region: StringType, qty: IntegerType });
     *     const cfg = Slice.config(OrderType, { fields: { region: { label: "Region" }, qty: { label: "Qty" } } });
     *     return (
     *         <Reactive>{$ => {
     *             const data = $.const([{ region: "EU", qty: 40n }], ArrayType(OrderType));
     *             const slice = $.let(Slice.bind([OrderType], "ex.slice.presets", cfg, Slice.state({
     *                 cohorts: [{ id: "eu", name: "EU", filters: [
     *                     variant("string", { fieldId: "region", op: variant("eq", "EU") }),
     *                 ] }],
     *                 activeCohorts: new Set(["eu"]),
     *             }), data, none));
     *             return <Slice.Presets slice={slice} />;
     *         }}</Reactive>
     *     );
     * });
     * ```
     *
     * @remarks
     * Carries `Slice.Presets.Types`. Desugars to `Slice.Presets.Root(options)`
     * (= `Slice.Cohort.Root` with `mode: "toggle"`).
     */
    Presets: optionsTag(SliceFactory.Presets.Root),
    /**
     * The slice affordance cluster as a standalone strip — one row that never
     * wraps, compressing along the chip ladder (whole chips → `+M more` within
     * a family → family count chips → one `N narrowed` chip); under
     * compression every chip opens the sectioned `Slice.Edit` popover floating
     * over whatever sits below. Place it above components reading
     * `Slice.rows([RowType], slice)` and the rail narrows them all — the new
     * composition model: data flows explicitly, chrome sits where the author
     * puts it. Props are flat ({@link SliceRailOptions}).
     *
     * @example
     * ```tsx
     * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
     * import { East, StructType, StringType, IntegerType, ArrayType, none } from "@elaraai/east";
     * import { Reactive, Slice, Table, UIComponentType, VStack } from "@elaraai/east-ui";
     *
     * const view = East.function([], UIComponentType, _$ => {
     *     const EventType = StructType({ scenario: StringType, sessions: IntegerType });
     *     const cfg = Slice.config(EventType, {
     *         fields: { scenario: { label: "Scenario" }, sessions: { label: "Sessions" } },
     *         searchFieldIds: ["scenario"],
     *     });
     *     return (
     *         <Reactive>{$ => {
     *             const data = $.const([{ scenario: "v3", sessions: 42n }], ArrayType(EventType));
     *             const slice = $.let(Slice.bind([EventType], "ex.slice.rail", cfg, Slice.state(), data, none));
     *             const narrowed = $.let(Slice.rows([EventType], slice));
     *             return (
     *                 <VStack gap="3" align="stretch">
     *                     <Slice.Rail slice={slice} affordances={["filter", "search"]} />
     *                     <Table data={narrowed} columns={{ scenario: { header: "Scenario" }, sessions: { header: "Sessions" } }} />
     *                 </VStack>
     *             );
     *         }}</Reactive>
     *     );
     * });
     * ```
     *
     * @remarks
     * Desugars to `Slice.Rail.Root(options)`. Components that take a `slice`
     * chrome option mount this same rail inside their own header.
     */
    Rail: optionsTag(SliceFactory.Rail.Root),
    config: SliceFactory.config,
    bind: SliceFactory.bind,
    /** Narrowed rows for a bound slice — the typed data feed (`Slice.rows([RowType], slice)`). */
    rows: SliceFactory.rows,
    /** Full bound rows tagged `{ value, matched }` — the "keep the excluded" feed. */
    partition: SliceFactory.partition,
    /** Materialise the `{ value, matched }` partition-row type for a row type. */
    partitionRowType: SliceFactory.partitionRowType,
    state: SliceFactory.state,
    apply: SliceFactory.apply,
    Types: SliceFactory.Types,
};
