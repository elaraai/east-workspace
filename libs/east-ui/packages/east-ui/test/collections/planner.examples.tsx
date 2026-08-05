/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, IntegerType, NullType, FloatType, ArrayType, OptionType, StringType, StructType, some, none, variant, example } from "@elaraai/east";
import { DragEventType, State, Style, UIComponentType } from "@elaraai/east-ui";
import { Box, Configurator, Library, Planner, Reactive, SegmentGroup, Select, Switch, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures (consolidation epic #455, pass 4).
// ============================================================================

/** One row shape for every configurator preset — the detailed column set
 *  derives Hours / Free from used / cap on ANY preset's rows. */
const PLANNER_ROW = StructType({ name: StringType, role: StringType, team: StringType, used: FloatType, cap: FloatType });

const PLANNER_CREW_DATA = [
    { name: "Alice", role: "Lead", team: "Team A", used: 6.0, cap: 8.0 },
    { name: "Bob", role: "Engineer", team: "Team A", used: 4.0, cap: 8.0 },
    { name: "Carol", role: "Designer", team: "Team B", used: 7.0, cap: 8.0 },
];
const PLANNER_PAIR_DATA = [
    { name: "Line A", role: "Press", team: "Plant", used: 6.0, cap: 8.0 },
    { name: "Line B", role: "Press", team: "Plant", used: 5.0, cap: 8.0 },
];
const PLANNER_SCROLL_DATA = East.Array.range(0n, 16n).map((_$, i) => ({
    name: East.str`unit-${i}`,
    role: i.remainder(3n).equals(0n).ifElse(() => "Lead", () => "Engineer"),
    team: i.remainder(2n).equals(0n).ifElse(() => "Team A", () => "Team B"),
    used: 6.0,
    cap: 8.0,
}));
const PLANNER_FILL_DATA = East.Array.range(0n, 200n).map((_$, i) => ({
    name: East.str`unit-${i}`,
    role: i.remainder(3n).equals(0n).ifElse(() => "Lead", () => "Engineer"),
    team: i.remainder(2n).equals(0n).ifElse(() => "Team A", () => "Team B"),
    used: 6.0,
    cap: 8.0,
}));

/**
 * Point Planner — a numeric day axis with AM/PM buckets, an identity column,
 * committed events, an explicit now-line, and a row-selection callback.
 */
export const plannerPoint = example({
    keywords: ["Planner", "Point", "slot", "schedule", "roster", "committed", "proposed", "now", "select"],
    description: "Slot-based Point planner: resources × days, AM/PM buckets, committed past + proposed future, now-line",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[
                    { name: "api-01", role: "Lead", team: "Web" },
                    { name: "api-02", role: "Engineer", team: "Web" },
                    { name: "cache", role: "Service", team: "Web" },
                    { name: "etl-01", role: "Lead", team: "Batch" },
                    { name: "etl-02", role: "Engineer", team: "Batch" },
                ]}
                axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 8 } })}
                groupBy={r => r.team}
                columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                events={_r => [
                    Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(2), bucket: "pm", label: "✓", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(3), bucket: "am", label: "✓", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(4), bucket: "am", label: "✓", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(5), bucket: "am", label: "check", state: "added" }),
                    Planner.event({ slot: Planner.at.number(6), bucket: "pm", label: "check", state: "added" }),
                    Planner.event({ slot: Planner.at.number(7), bucket: "am", label: "? plan", state: "model" }),
                ]}
                now={Planner.at.number(5)}
                onSelectRow={East.function([Planner.Types.SelectEvent], NullType, _$ => null)}
            />
        );
    }),
    inputs: [],
});

/**
 * THE Planner configurator (pass 4) — one preset axis spans the whole surface:
 * the event grammars (states / stretch / tones / colors / markers), the bucket
 * grammars (buckets / mixed / per-cell), the overlays (popover / hovercard),
 * the axis scales (ordinal / day / hour / horizon / scroll), the span chassis
 * and the #320 fill contract. Axis configs, `now` slots and event arrays are
 * all East DATA, so every point preset flows through ONE subtree; only the
 * chassis (Point / Span / bounded-fill) and the build-time column sets are
 * prebuilt arms. Columns and density compose across every preset; the events
 * callback branches per row for the mixed / per-cell bucket grammars.
 */
export const plannerVariants = example({
    keywords: ["Planner", "state", "committed", "proposed", "rejected", "model", "draft", "audit", "stretch", "content", "align", "tile", "tone", "pulse", "animation", "warning", "danger", "color", "colorPalette", "brand", "teal", "marker", "status", "flag", "tooltip", "bucket", "sub-slot", "shift", "per-cell", "mixed", "flat", "popover", "hovercard", "hover", "detail", "click", "ordinal", "phase", "time", "day", "resolution", "hour", "horizon", "FloatType", "expression", "scroll", "maxHeight", "span", "datetime", "duration", "timeline", "fill", "height", "#320", "virtual", "rowHover", "density", "columns", "eyebrow", "derived", "groupBy", "frozen", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State"],
    description: "Planner configurator — a preset axis over event, bucket, overlay, axis-scale, span and fill demos plus columns, density and row-hover controls on one live plan",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presetKeys = $.const([
                "states", "stretch", "tones", "colors", "markers",
                "buckets", "mixed", "percell", "popover", "hovercard",
                "ordinal", "day", "hour", "horizon", "scroll", "span", "fill",
            ], ArrayType(StringType));
            const columnSets = $.const(["simple", "detailed"], ArrayType(StringType));
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));

            const presetBind = $.let(State.bind([StringType], "planner_preset", "states"));
            const columnsBind = $.let(State.bind([StringType], "planner_columns", "simple"));
            const densityBind = $.let(State.bind([StringType], "planner_density", "compact"));
            const hoverBind = $.let(State.bind([BooleanType], "planner_rowhover", false));

            const pKey = $.let(presetBind.read());
            const cKey = $.let(columnsBind.read());
            const dKey = $.let(densityBind.read());
            const hoverOn = $.let(hoverBind.read());

            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onColumns = $.const(East.function([StringType], NullType, ($, next) => { $(columnsBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onHover = $.const(East.function([BooleanType], NullType, ($, next) => { $(hoverBind.write(next)); }));

            // HORIZON — a runtime-derived extent (last event day 3 + a 4-day
            // tail) proves `range.max` accepts a FloatType expression.
            const lastEventDay = $.const(3.0, FloatType);
            const horizon = $.const(lastEventDay.add(4.0), FloatType);

            // Every POINT preset is pure data: axis + now + rows + events
            // travel together through one subtree.
            const presets = $.const([
                {
                    key: "states",
                    axis: Planner.axis.number({ range: { min: 1, max: 5 } }),
                    now: Planner.at.number(5),
                    rows: [{ name: "Stream", role: "Monitor", team: "Ops", used: 6.0, cap: 8.0 }],
                    events: [
                        Planner.event({ slot: Planner.at.number(1), label: "Done", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(2), label: "Add", state: "added" }),
                        Planner.event({ slot: Planner.at.number(3), label: "Suggest", state: "model" }),
                        Planner.event({ slot: Planner.at.number(4), label: "Drop", state: "removed" }),
                        Planner.event({ slot: Planner.at.number(5), label: "Declined", state: "rejected" }),
                    ],
                },
                {
                    key: "stretch",
                    axis: Planner.axis.number({ range: { min: 1, max: 4 } }),
                    now: Planner.at.number(4),
                    rows: PLANNER_PAIR_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.number(1), label: "Full", state: "committed", stretch: "both", content: { horizontal: "center", vertical: "center" } }),
                        Planner.event({ slot: Planner.at.number(2), label: "Wide", state: "added", stretch: "horizontal" }),
                        Planner.event({ slot: Planner.at.number(3), label: "Top-left", state: "committed" }),
                    ],
                },
                {
                    key: "tones",
                    axis: Planner.axis.number({ range: { min: 1, max: 4 } }),
                    now: Planner.at.number(4),
                    rows: [{ name: "Reactor", role: "Vessel", team: "Plant", used: 7.0, cap: 8.0 }],
                    events: [
                        Planner.event({ slot: Planner.at.number(1), label: "OK", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(2), label: "Watch", state: "committed", tone: "warning" }),
                        Planner.event({ slot: Planner.at.number(3), label: "Breach", state: "committed", tone: "danger", animation: "pulse" }),
                    ],
                },
                {
                    key: "colors",
                    axis: Planner.axis.number({ range: { min: 1, max: 4 } }),
                    now: Planner.at.number(4),
                    rows: [{ name: "Line", role: "Pack", team: "Plant", used: 5.0, cap: 8.0 }],
                    events: [
                        Planner.event({ slot: Planner.at.number(1), label: "Series A", state: "committed", color: "teal.solid" }),
                        Planner.event({ slot: Planner.at.number(2), label: "Series B", state: "committed", colorPalette: "brand" }),
                        Planner.event({ slot: Planner.at.number(3), label: "Set", state: "committed", color: "fg.default" }),
                    ],
                },
                {
                    key: "markers",
                    axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 4 } }),
                    now: Planner.at.number(4),
                    rows: PLANNER_CREW_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(2), bucket: "am", label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(3), bucket: "am", label: "plan", state: "added" }),
                    ],
                },
                {
                    key: "buckets",
                    axis: Planner.axis.number({
                        buckets: [
                            { key: "morning", label: "AM" },
                            { key: "afternoon", label: "PM" },
                            { key: "evening", label: "EV" },
                        ],
                        range: { min: 1, max: 3 },
                    }),
                    now: Planner.at.number(3),
                    rows: PLANNER_PAIR_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.number(1), bucket: "morning", label: "A", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(1), bucket: "evening", label: "B", state: "added" }),
                    ],
                },
                {
                    key: "mixed",
                    axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 5 } }),
                    now: Planner.at.number(5),
                    rows: [
                        { name: "Alice", role: "Shifts", team: "Shifts", used: 6.0, cap: 8.0 },
                        { name: "Bob", role: "Shifts", team: "Shifts", used: 5.0, cap: 8.0 },
                        { name: "Headcount", role: "Daily", team: "Daily", used: 0.0, cap: 0.0 },
                    ],
                    // Per-row events come from the callback branch below.
                    events: [],
                },
                {
                    key: "percell",
                    axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 3 } }),
                    now: Planner.at.number(3),
                    rows: [
                        { name: "Press A", role: "bucketed", team: "Plant", used: 6.0, cap: 8.0 },
                        { name: "Press B", role: "flat", team: "Plant", used: 5.0, cap: 8.0 },
                    ],
                    events: [],
                },
                {
                    key: "popover",
                    axis: Planner.axis.number({ range: { min: 1, max: 4 } }),
                    now: Planner.at.number(4),
                    rows: PLANNER_PAIR_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.number(1), label: "Setup", state: "committed" }),
                        Planner.event({
                            slot: Planner.at.number(2), label: "Review", state: "committed",
                            popover: (
                                <VStack gap="1">
                                    <Text fontWeight="semibold">Review</Text>
                                    <Text color="fg.muted">Owner: Alice</Text>
                                </VStack>
                            ),
                        }),
                        Planner.event({ slot: Planner.at.number(3), label: "Plan", state: "added" }),
                    ],
                },
                {
                    key: "hovercard",
                    axis: Planner.axis.number({ range: { min: 1, max: 4 } }),
                    now: Planner.at.number(4),
                    rows: PLANNER_PAIR_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.number(1), label: "Setup", state: "committed" }),
                        Planner.event({
                            slot: Planner.at.number(2), label: "Review", state: "committed",
                            hovercard: (
                                <VStack gap="1">
                                    <Text fontWeight="semibold">Review</Text>
                                    <Text color="fg.muted">Hover preview · click to pin</Text>
                                </VStack>
                            ),
                            popover: (
                                <VStack gap="1">
                                    <Text fontWeight="semibold">Review details</Text>
                                    <Text color="fg.muted">Owner: Alice</Text>
                                </VStack>
                            ),
                        }),
                        Planner.event({ slot: Planner.at.number(3), label: "Plan", state: "added" }),
                    ],
                },
                {
                    key: "ordinal",
                    axis: Planner.axis.ordinal({ range: ["backlog", "active", "review", "done"] }),
                    now: Planner.at.ordinal("review"),
                    rows: PLANNER_CREW_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.ordinal("active"), label: "Start", state: "committed" }),
                        Planner.event({ slot: Planner.at.ordinal("review"), label: "Check", state: "added" }),
                        Planner.event({ slot: Planner.at.ordinal("done"), label: "Wrap up", state: "model" }),
                    ],
                },
                {
                    // A pinned ≤ 14-day window auto-derives Mon 30 … Sun 05 day
                    // columns (#309).
                    key: "day",
                    axis: Planner.axis.time({ format: "ddd DD", range: { min: new Date("2026-03-30"), max: new Date("2026-04-06") } }),
                    now: Planner.at.time(new Date("2026-04-02")),
                    rows: PLANNER_CREW_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.time(new Date("2026-03-30T10:00:00Z")), label: "Setup", state: "committed" }),
                        Planner.event({ slot: Planner.at.time(new Date("2026-04-01T09:00:00Z")), label: "Run", state: "committed" }),
                        Planner.event({ slot: Planner.at.time(new Date("2026-04-03T09:00:00Z")), label: "Plan", state: "added" }),
                    ],
                },
                {
                    // Forced hour resolution over a single working day (#309).
                    key: "hour",
                    axis: Planner.axis.time({ resolution: "hour", format: "HH:mm", range: { min: new Date("2026-03-30T08:00:00Z"), max: new Date("2026-03-30T18:00:00Z") } }),
                    now: Planner.at.time(new Date("2026-03-30T12:00:00Z")),
                    rows: PLANNER_CREW_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.time(new Date("2026-03-30T09:00:00Z")), label: "Setup", state: "committed" }),
                        Planner.event({ slot: Planner.at.time(new Date("2026-03-30T11:00:00Z")), label: "Run", state: "committed" }),
                        Planner.event({ slot: Planner.at.time(new Date("2026-03-30T14:00:00Z")), label: "Plan", state: "added" }),
                    ],
                },
                {
                    // `range.max` is a Float EXPRESSION — a data-driven extent.
                    key: "horizon",
                    axis: Planner.axis.number({ range: { min: 1, max: horizon } }),
                    now: Planner.at.number(7),
                    rows: PLANNER_CREW_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.number(1), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(2), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(3), label: "plan", state: "added" }),
                    ],
                },
                {
                    key: "scroll",
                    axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 6 } }),
                    now: Planner.at.number(4),
                    rows: PLANNER_SCROLL_DATA,
                    events: [
                        Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(2), bucket: "pm", label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(4), bucket: "pm", label: "plan", state: "added" }),
                    ],
                },
            ], ArrayType(StructType({ key: StringType, axis: Planner.Types.Axis, now: Planner.Types.Slot, rows: ArrayType(PLANNER_ROW), events: ArrayType(Planner.Types.Event) })));
            const sel = $.let(presets.filter((_$, o) => o.key.equal(pKey)).get(0n, _$ => presets.get(0n)));
            const densitySel = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));

            // MIXED / PER-CELL grammars need per-row event lists — the one
            // events callback branches on the preset key AND the row.
            const aliceEvents = $.const([
                Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "Open", state: "committed", stretch: "both" }),
                Planner.event({ slot: Planner.at.number(1), bucket: "pm", label: "Mid", state: "committed", stretch: "both" }),
                Planner.event({ slot: Planner.at.number(3), label: "OT", state: "added" }),
            ], ArrayType(Planner.Types.Event));
            const bobEvents = $.const([
                Planner.event({ slot: Planner.at.number(1), label: "Cover", state: "committed", stretch: "both" }),
            ], ArrayType(Planner.Types.Event));
            const dailyEvents = $.const([
                Planner.event({ slot: Planner.at.number(1), label: "12", state: "committed" }),
                Planner.event({ slot: Planner.at.number(2), label: "15", state: "committed" }),
                Planner.event({ slot: Planner.at.number(3), label: "9", state: "added" }),
            ], ArrayType(Planner.Types.Event));
            const pressA = $.const([
                Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "Setup", state: "committed", stretch: "both" }),
                Planner.event({ slot: Planner.at.number(1), bucket: "pm", label: "Run", state: "committed", stretch: "both" }),
                Planner.event({ slot: Planner.at.number(1), label: "Note", state: "added" }),
                Planner.event({ slot: Planner.at.number(2), bucket: "am", label: "QA", state: "committed" }),
            ], ArrayType(Planner.Types.Event));
            const pressB = $.const([
                Planner.event({ slot: Planner.at.number(1), label: "Maint", state: "committed", stretch: "both" }),
                Planner.event({ slot: Planner.at.number(2), label: "Idle", state: "added" }),
            ], ArrayType(Planner.Types.Event));

            // SPAN chassis — multi-slot start → end events on a months axis.
            const spanAxis = $.let(Planner.axis.time({ format: "MMM" }));
            const spanEvents = $.const([
                Planner.event({
                    slot: Planner.at.time(new Date("2024-01-01")), endSlot: Planner.at.time(new Date("2024-02-15")),
                    label: "Phase one", state: "committed",
                }),
                Planner.event({
                    slot: Planner.at.time(new Date("2024-02-15")), endSlot: Planner.at.time(new Date("2024-04-01")),
                    label: "Phase two", state: "added",
                }),
            ], ArrayType(Planner.Types.Event));

            // Prebuilt arms: chassis × column set (columns are build-time).
            const pointSimple = $.const(
                <Planner.Point
                    data={sel.rows}
                    axis={sel.axis}
                    now={sel.now}
                    density={densitySel}
                    rowHover={hoverOn}
                    columns={[{ key: "name", frozen: true, value: r => r.name }]}
                    events={r => pKey.equal("mixed").ifElse(
                        _$ => r.team.equal("Daily").ifElse(_$ => dailyEvents, _$ => r.name.equal("Alice").ifElse(_$ => aliceEvents, _$ => bobEvents)),
                        _$ => pKey.equal("percell").ifElse(
                            _$ => r.role.equal("bucketed").ifElse(_$ => pressA, _$ => pressB),
                            _$ => sel.events,
                        ),
                    )}
                    maxHeight="320px"
                />,
            );
            const pointDetailed = $.const(
                <Planner.Point
                    data={sel.rows}
                    axis={sel.axis}
                    now={sel.now}
                    density={densitySel}
                    rowHover={hoverOn}
                    groupBy={r => r.team}
                    columns={[
                        { key: "name", frozen: true, value: r => r.name, sublabel: r => r.role },
                        { key: "hours", header: "Hours", align: "end", value: r => East.str`${r.used} / ${r.cap} h` },
                        { key: "free", header: "Free", align: "end", value: r => East.print(r.cap.subtract(r.used)) },
                    ]}
                    events={r => pKey.equal("mixed").ifElse(
                        _$ => r.team.equal("Daily").ifElse(_$ => dailyEvents, _$ => r.name.equal("Alice").ifElse(_$ => aliceEvents, _$ => bobEvents)),
                        _$ => pKey.equal("percell").ifElse(
                            _$ => r.role.equal("bucketed").ifElse(_$ => pressA, _$ => pressB),
                            _$ => sel.events,
                        ),
                    )}
                    maxHeight="320px"
                />,
            );
            const spanSimple = $.const(
                <Planner.Span
                    data={PLANNER_CREW_DATA}
                    axis={spanAxis}
                    density={densitySel}
                    rowHover={hoverOn}
                    columns={[{ key: "name", frozen: true, value: r => r.name }]}
                    events={_r => spanEvents}
                />,
            );
            const spanDetailed = $.const(
                <Planner.Span
                    data={PLANNER_CREW_DATA}
                    axis={spanAxis}
                    density={densitySel}
                    rowHover={hoverOn}
                    groupBy={r => r.team}
                    columns={[
                        { key: "name", frozen: true, value: r => r.name, sublabel: r => r.role },
                        { key: "hours", header: "Hours", align: "end", value: r => East.str`${r.used} / ${r.cap} h` },
                        { key: "free", header: "Free", align: "end", value: r => East.print(r.cap.subtract(r.used)) },
                    ]}
                    events={_r => spanEvents}
                />,
            );
            // FILL (#320) — height="fill" resolves against the bounded Box and
            // virtualizes the 200 rows.
            const fillArm = $.const(
                <Box height="200px">
                    <Planner.Point
                        data={PLANNER_FILL_DATA}
                        axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 6 } })}
                        density={densitySel}
                        columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "on", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(4), bucket: "pm", label: "plan", state: "added" }),
                        ]}
                        height="fill"
                    />
                </Box>,
            );

            const preview = $.const(pKey.equal("span").ifElse(
                _$ => cKey.equal("detailed").ifElse(_$ => spanDetailed, _$ => spanSimple),
                _$ => pKey.equal("fill").ifElse(
                    _$ => fillArm,
                    _$ => cKey.equal("detailed").ifElse(_$ => pointDetailed, _$ => pointSimple),
                ),
            ), UIComponentType);

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Preset", pKey,
                            <Select value={pKey} onChange={onPreset} size="sm"
                                items={presetKeys.map((_$, s) => Select.Item(s, s))} />),
                        Configurator.Control("Columns", cKey,
                            <SegmentGroup value={cKey} onChange={onColumns} size="sm"
                                items={columnSets.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Row hover", hoverOn.ifElse(_$ => "on", _$ => "off"),
                            <Switch checked={hoverOn} onChange={onHover} />),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Chassis", pKey.equal("span").ifElse(_$ => "Span", _$ => "Point")),
                        Configurator.Spec("Scale", pKey.equal("span").ifElse(_$ => "time", _$ => pKey.equal("fill").ifElse(_$ => "number", _$ => sel.axis.scale.getTag()))),
                        Configurator.Spec("Rows", pKey.equal("span").ifElse(_$ => "3", _$ => pKey.equal("fill").ifElse(_$ => "200", _$ => East.print(sel.rows.size())))),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Optional row-approval review chrome — a per-row Approve / Reject decision
 * column plus a batch foot (approve-all / reject-all / rerun). Clean lines rest
 * pre-approved (`approval = some(approved)`, no status dot); flagged lines carry
 * a quiet warning dot and await an explicit call (`approval = some(pending)`).
 * The decision callbacks receive the acted-on `{ rowIndex }`.
 */
export const plannerReview = example({
    keywords: ["Planner", "review", "approve", "reject", "approval", "decision", "batch", "rerun", "status", "row"],
    description: "Optional per-row approval — Approve/Reject decision column + batch foot, with a quiet status dot on flagged lines",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[
                    { name: "Press A", line: "die-set 12", flagged: false },
                    { name: "Press B", line: "die-set 07", flagged: false },
                    { name: "Weld cell", line: "fixture 3", flagged: true },
                    { name: "Paint line", line: "batch 19", flagged: false },
                    { name: "Assembly", line: "station 5", flagged: true },
                ]}
                axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 6 } })}
                columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.line }]}
                events={_r => [
                    Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(2), bucket: "pm", label: "✓", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(4), bucket: "am", label: "plan", state: "added" }),
                    Planner.event({ slot: Planner.at.number(5), bucket: "pm", label: "? shift", state: "model" }),
                ]}
                now={Planner.at.number(3)}
                status={r => r.flagged.ifElse(() => some(variant("warning", null)), () => none)}
                approval={r => r.flagged.ifElse(() => some(variant("pending", null)), () => some(variant("approved", null)))}
                review={{
                    columnLabel: "Decision",
                    rerunLabel: "Rerun",
                    summary: <Text color="fg.muted">5 lines · 2 flagged need a call · −$24k wage/fn</Text>,
                    onApprove: East.function([Planner.Types.ApproveEvent], NullType, _$ => null),
                    onReject: East.function([Planner.Types.ApproveEvent], NullType, _$ => null),
                    onApproveAll: East.function([], NullType, _$ => null),
                    onRejectAll: East.function([], NullType, _$ => null),
                    onRerun: East.function([], NullType, _$ => null),
                }}
            />
        );
    }),
    inputs: [],
});

/**
 * Opt-in DnD target (#269) — drag a person from the Library onto the weekly
 * plan: drops land as `proposed(added)` tiles at the (row, day[:bucket])
 * the pointer resolves, arriving through the ONE shared `onDrag` grammar
 * funnel. Press B carries AM/PM buckets, so its cells render lanes and drops
 * there deliver composite `"5:pm"` slot keys (Press A stays flat — plain
 * `"5"`). `canDrop` vetoes drops left of `now` (committed history, ⊘ while
 * hovering) — policy is host-owned, never hard-coded. Every callback (all
 * four grammar arms + the review's Approve) writes the `LAST ·` line under
 * the planner so gestures are visible while testing. The example proves the
 * review loop: a drop flips its row to `pending` via the `approval`
 * accessor; the row's Approve resolves it back.
 */
export const plannerLibraryDnd = example({
    keywords: ["Planner", "Library", "DnD", "drag", "add", "move", "remove", "onDrag", "canDrop", "target", "bucket", "lane", "composite", "proposed", "review", "pending", "approve", "loop"],
    description: "Library + Planner DnD — proposed(added) drops through the one onDrag grammar, canDrop ⊘ left of now, composite day:bucket lanes on Press B; a drop flips its row pending and Approve resolves it",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pendingRowBind = $.let(State.bind([IntegerType], "planner_pending_row", -1n));
            const pendingRow = $.let(pendingRowBind.read());
            // The host owns the dropped tile (drops funnel through the normal
            // commit pipeline): the optimistic tile hands over to this bound
            // state when the Reactive value reconciles.
            const droppedRowBind = $.let(State.bind([IntegerType], "planner_dropped_row", -1n));
            const droppedRow = $.let(droppedRowBind.read());
            const droppedDayBind = $.let(State.bind([FloatType], "planner_dropped_day", -1.0));
            const droppedDay = $.let(droppedDayBind.read());
            const droppedBucketBind = $.let(State.bind([StringType], "planner_dropped_bucket", ""));
            const droppedBucket = $.let(droppedBucketBind.read());
            const droppedKeyBind = $.let(State.bind([StringType], "planner_dropped_key", ""));
            const droppedKey = $.let(droppedKeyBind.read());
            const lastBind = $.let(State.bind([StringType], "planner_last", "none yet"));
            const last = $.let(lastBind.read());
            const onDrag = $.const(East.function([DragEventType], NullType, ($, event) => {
                // Slot keys on this number axis arrive as "5" (flat cell) or
                // "5:pm" (bucket lane) — split off the day and the lane.
                const slotDay = $.const(East.function([StringType], FloatType, (_$, slot) =>
                    slot.split(":").get(0n).parse(FloatType)));
                const slotBucket = $.const(East.function([StringType], StringType, (_$, slot) =>
                    slot.split(":").get(1n, _ => "")));
                const isDroppedTile = $.const(East.function([OptionType(StringType)], BooleanType, (_$, ev) =>
                    ev.match({ some: (_$, k) => East.equal(k, "dropped"), none: (_$) => East.value(false) })));
                $.match(event, {
                    add: ($, add) => {
                        // The dropped row awaits an explicit call (#269 loop step 2);
                        // the tile itself is host-owned and survives the approval.
                        $(pendingRowBind.write(add.into.row.parse(IntegerType)));
                        $(droppedRowBind.write(add.into.row.parse(IntegerType)));
                        $(droppedDayBind.write(slotDay(add.into.slot)));
                        $(droppedBucketBind.write(slotBucket(add.into.slot)));
                        $(droppedKeyBind.write(add.from.key));
                        $(lastBind.write(East.str`add · ${add.from.key} → r${add.into.row} @ ${add.into.slot}`));
                    },
                    move: ($, mv) => {
                        // The host-owned tile follows its own moves.
                        $.if(isDroppedTile(mv.from.event), $ => {
                            $(droppedRowBind.write(mv.to.row.parse(IntegerType)));
                            $(pendingRowBind.write(mv.to.row.parse(IntegerType)));
                            $(droppedDayBind.write(slotDay(mv.to.slot)));
                            $(droppedBucketBind.write(slotBucket(mv.to.slot)));
                        });
                        $(lastBind.write(East.str`move · r${mv.from.row} @ ${mv.from.slot} → r${mv.to.row} @ ${mv.to.slot}`));
                    },
                    remove: ($, rm) => {
                        $.if(isDroppedTile(rm.from.event), $ => {
                            $(droppedRowBind.write(-1n));
                            $(pendingRowBind.write(-1n));
                        });
                        $(lastBind.write(East.str`remove · r${rm.from.row} @ ${rm.from.slot} → ${rm.to.getTag()}`));
                    },
                    resize: ($, rz) => {
                        $(lastBind.write(East.str`resize · ${rz.edge.getTag()} → ${rz.event.slot}`));
                    },
                });
            }));
            // Committed history is closed: no drops on days 1–3 (left of now).
            const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) => {
                const slotDay = $.const(East.function([StringType], FloatType, (_$, slot) =>
                    slot.split(":").get(0n).parse(FloatType)));
                return event.match({
                    add: (_$, add) => slotDay(add.into.slot).greater(3.0),
                    move: (_$, mv) => slotDay(mv.to.slot).greater(3.0),
                    remove: (_$) => East.value(true),
                    resize: (_$) => East.value(true),
                });
            }));
            const onApprove = $.const(East.function([Planner.Types.ApproveEvent], NullType, ($, ev) => {
                // Approving the line resolves it (#269 loop step 3).
                $(pendingRowBind.write(-1n));
                $(lastBind.write(East.str`approve · r${East.print(ev.rowIndex)}`));
            }));
            const onApproveAll = $.const(East.function([], NullType, ($) => {
                $(pendingRowBind.write(-1n));
                $(lastBind.write("approve all"));
            }));
            return (
                <VStack gap="4" align="stretch">
                    <Library
                        id="people"
                        data={[
                            { id: "patel", name: "Patel, R.", role: "Senior SE" },
                            { id: "kim", name: "Kim, A.", role: "Mid SE" },
                        ]}
                        item={p => ({ key: p.id, label: p.name, sublabel: p.role, icon: "user" })}
                    />
                    <Planner.Point
                        id="week-plan"
                        sources={["people"]}
                        data={[
                            { idx: 0n, name: "Press A" },
                            { idx: 1n, name: "Press B" },
                        ]}
                        axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 6 } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={r => East.equal(r.idx, 0n).ifElse(
                            // Press A — flat cells (plain "5" slot keys).
                            _$ => East.equal(droppedRow, 0n).and(_$ => droppedDay.greater(0.0)).ifElse(
                                _$ => [
                                    Planner.event({ key: "c0", slot: Planner.at.number(1), label: "✓", state: "committed" }),
                                    Planner.event({ key: "p0", slot: Planner.at.number(5), label: "plan", state: "added" }),
                                    Planner.event({ key: "dropped", slot: Planner.at.number(droppedDay), label: droppedKey, state: "added" }),
                                ],
                                _$ => [
                                    Planner.event({ key: "c0", slot: Planner.at.number(1), label: "✓", state: "committed" }),
                                    Planner.event({ key: "p0", slot: Planner.at.number(5), label: "plan", state: "added" }),
                                ]),
                            // Press B — AM/PM lanes (composite "5:pm" slot keys);
                            // the dropped tile lands in the lane the drop named.
                            _$ => East.equal(droppedRow, 1n).and(_$ => droppedDay.greater(0.0)).ifElse(
                                _$ => [
                                    Planner.event({ key: "c1", slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
                                    Planner.event({ key: "c1b", slot: Planner.at.number(2), bucket: "pm", label: "✓", state: "committed" }),
                                    Planner.event({ key: "p1", slot: Planner.at.number(5), bucket: "am", label: "plan", state: "added" }),
                                    Planner.event({ key: "dropped", slot: Planner.at.number(droppedDay), bucket: droppedBucket, label: droppedKey, state: "added" }),
                                ],
                                _$ => [
                                    Planner.event({ key: "c1", slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
                                    Planner.event({ key: "c1b", slot: Planner.at.number(2), bucket: "pm", label: "✓", state: "committed" }),
                                    Planner.event({ key: "p1", slot: Planner.at.number(5), bucket: "am", label: "plan", state: "added" }),
                                ]),
                        )}
                        now={Planner.at.number(4)}
                        onDrag={onDrag}
                        canDrop={canDrop}
                        status={r => East.equal(r.idx, pendingRow).ifElse(() => some(variant("warning", null)), () => none)}
                        approval={r => East.equal(r.idx, pendingRow).ifElse(() => some(variant("pending", null)), () => some(variant("approved", null)))}
                        review={{
                            onApprove,
                            onApproveAll,
                        }}
                    />
                    <Text.MonoLabel>{East.str`LAST · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
