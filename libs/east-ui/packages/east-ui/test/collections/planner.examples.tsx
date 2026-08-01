/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, IntegerType, NullType, FloatType, ArrayType, OptionType, StringType, some, none, variant, example } from "@elaraai/east";
import { DragEventType, State, UIComponentType } from "@elaraai/east-ui";
import { Box, Library, Planner, Reactive, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const PLANNER_BUCKETS_DATA = [{ name: "Alice" }, { name: "Bob" }];
const PLANNER_MIXED_BUCKETS_DATA = [
    { name: "Alice", group: "Shifts", isAlice: true, isBob: false },
    { name: "Bob", group: "Shifts", isAlice: false, isBob: true },
    { name: "Headcount", group: "Daily", isAlice: false, isBob: false },
    { name: "Output", group: "Daily", isAlice: false, isBob: false },
];
const PLANNER_PER_CELL_BUCKETS_DATA = [
    { name: "Press A", bucketed: true },
    { name: "Press B", bucketed: false },
];
const PLANNER_STRETCH_DATA = [{ name: "Line A" }, { name: "Line B" }];
const PLANNER_EVENT_TONE_DATA = [{ name: "Reactor" }];
const PLANNER_EVENT_COLOR_DATA = [{ name: "Line" }];
const PLANNER_MARKERS_DATA = [
    { name: "api-01", role: "Lead" },
    { name: "api-02", role: "Engineer" },
    { name: "cache", role: "Service" },
    { name: "etl-01", role: "Batch" },
];
const PLANNER_ROW_HOVER_DATA = [{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }];
const PLANNER_DENSITY_DATA = [{ name: "Alice" }, { name: "Bob" }];
const PLANNER_ORDINAL_AXIS_DATA = [{ name: "Item" }];
const PLANNER_DATA_DRIVEN_RANGE_DATA = [{ name: "Line A" }, { name: "Line B" }];
const PLANNER_SCROLL_DATA = [
    { name: "api-01", role: "Lead" }, { name: "api-02", role: "Engineer" },
    { name: "api-03", role: "Engineer" }, { name: "cache-01", role: "Service" },
    { name: "cache-02", role: "Service" }, { name: "etl-01", role: "Lead" },
    { name: "etl-02", role: "Engineer" }, { name: "etl-03", role: "Engineer" },
    { name: "web-01", role: "Lead" }, { name: "web-02", role: "Engineer" },
    { name: "web-03", role: "Engineer" }, { name: "queue-01", role: "Service" },
    { name: "queue-02", role: "Service" }, { name: "batch-01", role: "Lead" },
    { name: "batch-02", role: "Engineer" }, { name: "batch-03", role: "Engineer" },
];
const PLANNER_POPOVER_DATA = [{ name: "Alice" }];
const PLANNER_HOVERCARD_DATA = [{ name: "Alice" }];
const PLANNER_FILL_HEIGHT_DATA = [
    { name: "api-01", role: "Lead" }, { name: "api-02", role: "Engineer" },
    { name: "api-03", role: "Engineer" }, { name: "cache-01", role: "Service" },
    { name: "cache-02", role: "Service" }, { name: "etl-01", role: "Lead" },
    { name: "etl-02", role: "Engineer" }, { name: "etl-03", role: "Engineer" },
    { name: "web-01", role: "Lead" }, { name: "web-02", role: "Engineer" },
    { name: "web-03", role: "Engineer" }, { name: "queue-01", role: "Service" },
];
const PLANNER_FILL_DATA = East.Array.range(0n, 200n).map((_$, i) => ({
    name: East.str`unit-${i}`,
    role: i.remainder(3n).equals(0n).ifElse(() => "Lead", () => "Engineer"),
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
 * The Span variant — multi-slot span events on a datetime axis (a committed span
 * and a proposed one).
 */
export const plannerSpan = example({
    keywords: ["Planner", "span", "gantt", "datetime", "range", "duration", "timeline"],
    description: "Span variant: multi-slot datetime spans, committed and proposed",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Span
                data={[
                    { name: "Workstream A", owner: "d.park" },
                    { name: "Workstream B", owner: "r.chen" },
                ]}
                axis={Planner.axis.time({ format: "MMM" })}
                columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.owner }]}
                events={_r => [
                    Planner.event({
                        slot: Planner.at.time(new Date("2024-01-01")), endSlot: Planner.at.time(new Date("2024-02-15")),
                        label: "Phase one", state: "committed",
                    }),
                    Planner.event({
                        slot: Planner.at.time(new Date("2024-02-15")), endSlot: Planner.at.time(new Date("2024-04-01")),
                        label: "Phase two", state: "added",
                    }),
                ]}
            />
        );
    }),
    inputs: [],
});

/**
 * Every event state in one row — committed, the three proposed flavours
 * (added / model / removed), and rejected.
 */
export const plannerEventStates = example({
    keywords: ["Planner", "state", "committed", "proposed", "rejected", "model", "draft", "audit", "diff"],
    description: "The event-state grammar: committed, proposed (added / model / removed), rejected",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Stream" }]}
                axis={Planner.axis.number({ range: { min: 1, max: 5 } })}
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={_r => [
                    Planner.event({ slot: Planner.at.number(1), label: "Done", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(2), label: "Add", state: "added" }),
                    Planner.event({ slot: Planner.at.number(3), label: "Suggest", state: "model" }),
                    Planner.event({ slot: Planner.at.number(4), label: "Drop", state: "removed" }),
                    Planner.event({ slot: Planner.at.number(5), label: "Declined", state: "rejected" }),
                ]}
            />
        );
    }),
    inputs: [],
});

/**
 * The left-column model — a frozen identity column with an eyebrow sub-label, a
 * derived column computed in East, an end-aligned column, and row grouping.
 */
export const plannerColumns = example({
    keywords: ["Planner", "column", "eyebrow", "sublabel", "derived", "group", "groupBy", "frozen", "capacity"],
    description: "Value + eyebrow columns, a derived East-computed column, alignment, frozen, groupBy",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[
                    { name: "Alice", role: "Lead", team: "Team A", used: 6.0, cap: 8.0 },
                    { name: "Bob", role: "Engineer", team: "Team A", used: 4.0, cap: 8.0 },
                    { name: "Carol", role: "Designer", team: "Team B", used: 7.0, cap: 8.0 },
                ]}
                axis={Planner.axis.number({ range: { min: 1, max: 3 } })}
                groupBy={r => r.team}
                columns={[
                    { key: "name", frozen: true, value: r => r.name, sublabel: r => r.role },
                    { key: "hours", header: "Hours", align: "end", value: r => East.str`${r.used} / ${r.cap} h` },
                    { key: "free", header: "Free", align: "end", value: r => East.print(r.cap.subtract(r.used)) },
                ]}
                events={_r => [Planner.event({ slot: Planner.at.number(1), label: "Task", state: "committed" })]}
            />
        );
    }),
    inputs: [],
});

/**
 * Bucket variant panel — labelled sub-slot buckets, per-cell bucketing in a
 * grouped Planner, and per-cell bucketing composed with stretch (+ the N/A
 * orphan lane).
 */
export const plannerBucketsVariants = example({
    keywords: ["Planner", "bucket", "sub-slot", "slotsPerColumn", "shift", "morning", "afternoon", "per-cell", "mixed", "unbucketed", "stretch", "flat", "ifElse", "group", "N/A", "orphan", "fill"],
    description: "Bucket variant panel — buckets (labelled sub-slot buckets per column, three named shifts), mixed buckets (grouped per-cell bucketing: Alice mixes stretched bucketed cells with an unstretched flat cell, Bob a stretched flat cell, the Daily group plain flat rows), per cell buckets (stretched lanes with a stray bucketless event dropping to an N/A lane, beside normal bucketed and flat cells)",
    fn: East.function([], UIComponentType, ($) => {
        // MIXED BUCKETS — one typed event list per resource so the per-row
        // `ifElse` branches each return a typed `Array<PlannerEvent>`.
        const aliceEvents = $.const([
            // Day 1 — stretched bucketed cells: am + pm fill their lane bands.
            Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "Open", state: "committed", stretch: "both" }),
            Planner.event({ slot: Planner.at.number(1), bucket: "pm", label: "Mid", state: "committed", stretch: "both" }),
            // Day 3 — an unstretched unbucketed (flat) cell beside the bucketed one.
            Planner.event({ slot: Planner.at.number(3), label: "OT", state: "added" }),
        ], ArrayType(Planner.Types.Event));
        const bobEvents = $.const([
            // Day 1 — a stretched unbucketed (flat) cell filling its cell.
            Planner.event({ slot: Planner.at.number(1), label: "Cover", state: "committed", stretch: "both" }),
        ], ArrayType(Planner.Types.Event));
        const dailyEvents = $.const([
            Planner.event({ slot: Planner.at.number(1), label: "12", state: "committed" }),
            Planner.event({ slot: Planner.at.number(2), label: "15", state: "committed" }),
            Planner.event({ slot: Planner.at.number(3), label: "9", state: "added" }),
        ], ArrayType(Planner.Types.Event));
        // PER CELL BUCKETS — Press A bucketed: day-1 am/pm lanes stretched to
        // fill their band (+ a stray bucketless event ⇒ N/A lane); day-2 a
        // normal-sized bucketed cell. Press B flat: day-1 a stretched tile
        // filling the cell, day-2 a normal content-sized tile.
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
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">BUCKETS</Text>
                    <Planner.Point
                        data={PLANNER_BUCKETS_DATA}
                        axis={Planner.axis.number({
                            buckets: [
                                { key: "morning", label: "AM" },
                                { key: "afternoon", label: "PM" },
                                { key: "evening", label: "EV" },
                            ],
                            range: { min: 1, max: 3 },
                        })}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.number(1), bucket: "morning", label: "A", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(1), bucket: "evening", label: "B", state: "added" }),
                        ]}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">MIXED BUCKETS</Text>
                    <Planner.Point
                        data={PLANNER_MIXED_BUCKETS_DATA}
                        axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 5 } })}
                        groupBy={r => r.group}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={r => r.isAlice.ifElse(() => aliceEvents, () => r.isBob.ifElse(() => bobEvents, () => dailyEvents))}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PER CELL BUCKETS</Text>
                    <Planner.Point
                        data={PLANNER_PER_CELL_BUCKETS_DATA}
                        axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 3 } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={r => r.bucketed.ifElse(() => pressA, () => pressB)}
                    />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

/**
 * Event-style variant panel — per-event stretch/content geometry, tone +
 * animation, brand colour, status markers, row hover, and density.
 */
export const plannerEventStyleVariants = example({
    keywords: ["Planner", "stretch", "fill", "content", "align", "orientation", "tile", "both", "horizontal", "tone", "colour", "override", "animation", "pulse", "attention", "warning", "danger", "color", "colorPalette", "brand", "teal", "purple", "match", "chart", "series", "marker", "status", "success", "info", "flag", "tooltip", "rowHover", "hover", "row", "highlight", "outline", "density", "compact", "comfortable", "condensed", "size"],
    description: "Event-style variant panel — stretch (a both-axis tile with centred content, a width-filling tile, a normal top-left tile), event tone (danger-toned committed event pulses while keeping audit cues), event color (color 'teal.solid' / colorPalette 'purple' match paired chart series), markers (success / warning / danger / info status rings with hover tooltips), row hover (light brand outline around the whole row), density (compact row / header rhythm)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">STRETCH</Text>
                    <Planner.Point
                        data={PLANNER_STRETCH_DATA}
                        axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                        density="comfortable"
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.number(1), label: "Full", state: "committed", stretch: "both", content: { horizontal: "center", vertical: "center" } }),
                            Planner.event({ slot: Planner.at.number(2), label: "Wide", state: "added", stretch: "horizontal" }),
                            Planner.event({ slot: Planner.at.number(3), label: "Top-left", state: "committed" }),
                        ]}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">EVENT TONE</Text>
                    <Planner.Point
                        data={PLANNER_EVENT_TONE_DATA}
                        axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.number(1), label: "OK", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(2), label: "Watch", state: "committed", tone: "warning" }),
                            Planner.event({ slot: Planner.at.number(3), label: "Breach", state: "committed", tone: "danger", animation: "pulse" }),
                        ]}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">EVENT COLOR</Text>
                    <Planner.Point
                        data={PLANNER_EVENT_COLOR_DATA}
                        axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.number(1), label: "Series A", state: "committed", color: "teal.solid" }),
                            Planner.event({ slot: Planner.at.number(2), label: "Series B", state: "committed", colorPalette: "purple" }),
                            Planner.event({ slot: Planner.at.number(3), label: "Set", state: "committed", color: "black" }),
                        ]}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">MARKERS</Text>
                    <Planner.Point
                        data={PLANNER_MARKERS_DATA}
                        axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 4 } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(2), bucket: "am", label: "✓", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(3), bucket: "am", label: "plan", state: "added" }),
                        ]}
                        markers={_r => [
                            Planner.marker({ slot: Planner.at.number(1), status: "success", message: "On track" }),
                            Planner.marker({ slot: Planner.at.number(2), status: "warning", message: "Tight turnaround" }),
                            Planner.marker({ slot: Planner.at.number(3), status: "danger", message: "Double-booked in this slot" }),
                            Planner.marker({ slot: Planner.at.number(4), status: "info", message: "Pending review" }),
                        ]}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">ROW HOVER</Text>
                    <Planner.Point
                        data={PLANNER_ROW_HOVER_DATA}
                        axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                        rowHover={true}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [Planner.event({ slot: Planner.at.number(1), label: "Task", state: "committed" })]}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DENSITY</Text>
                    <Planner.Point
                        data={PLANNER_DENSITY_DATA}
                        axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                        density="compact"
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [Planner.event({ slot: Planner.at.number(1), label: "Task", state: "committed" })]}
                    />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

/**
 * Axis variant panel — ordinal phases, a data-driven numeric extent, and the
 * maxHeight scroll cap (#302).
 */
export const plannerAxisVariants = example({
    keywords: ["Planner", "ordinal", "phase", "stage", "category", "axis", "range", "data-driven", "expression", "now", "horizon", "FloatType", "SubtypeExprOrValue", "maxHeight", "scroll", "vertical", "stickyHeader", "sticky", "overflow", "pinned"],
    description: "Axis variant panel — ordinal axis (named phases, one slot per column), data driven range (range.max is a FloatType expression: a horizon past the last event keeps the now marker on-grid), scroll (maxHeight caps the plan area, body scrolls with the header pinned sticky-top)",
    fn: East.function([], UIComponentType, ($) => {
        // DATA DRIVEN RANGE — a runtime-derived horizon (last event day 3 + a
        // 4-day tail = 7) proves range.max accepts a FloatType *expression*.
        const lastEventDay = $.const(3.0, FloatType);
        const horizon = $.const(lastEventDay.add(4.0), FloatType);
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">ORDINAL AXIS</Text>
                    <Planner.Point
                        data={PLANNER_ORDINAL_AXIS_DATA}
                        axis={Planner.axis.ordinal({ range: ["backlog", "active", "review", "done"] })}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.ordinal("active"), label: "Start", state: "committed" }),
                            Planner.event({ slot: Planner.at.ordinal("done"), label: "Wrap up", state: "model" }),
                        ]}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DATA DRIVEN RANGE</Text>
                    <Planner.Point
                        data={PLANNER_DATA_DRIVEN_RANGE_DATA}
                        axis={Planner.axis.number({ range: { min: 1, max: horizon } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.number(1), label: "✓", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(2), label: "✓", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(3), label: "plan", state: "added" }),
                        ]}
                        now={Planner.at.number(7)}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SCROLL</Text>
                    <Planner.Point
                        data={PLANNER_SCROLL_DATA}
                        axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 6 } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(2), bucket: "pm", label: "✓", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(3), bucket: "am", label: "✓", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(4), bucket: "pm", label: "plan", state: "added" }),
                            Planner.event({ slot: Planner.at.number(5), bucket: "am", label: "plan", state: "model" }),
                        ]}
                        now={Planner.at.number(4)}
                        maxHeight="320px"
                    />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

/**
 * Overlay pair — the per-event click popover and the open-on-hover HoverCard
 * (coexisting with the click popover on one event).
 */
export const plannerOverlays = example({
    keywords: ["Planner", "popover", "detail", "click", "rich", "hovercard", "hover", "preview", "coexist"],
    description: "Overlay pair — popover (per-event click popover with rich content) and hovercard (open-on-hover HoverCard on an event coexisting with the click popover: hover previews, click pins)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">POPOVER</Text>
                    <Planner.Point
                        data={PLANNER_POPOVER_DATA}
                        axis={Planner.axis.number({ range: { min: 1, max: 3 } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [
                            Planner.event({
                                slot: Planner.at.number(2), label: "Review", state: "committed",
                                popover: (
                                    <VStack gap="1">
                                        <Text fontWeight="semibold">Review</Text>
                                        <Text color="fg.muted">Owner: Alice</Text>
                                    </VStack>
                                ),
                            }),
                        ]}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">HOVERCARD</Text>
                    <Planner.Point
                        data={PLANNER_HOVERCARD_DATA}
                        axis={Planner.axis.number({ range: { min: 1, max: 3 } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name }]}
                        events={_r => [
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
                        ]}
                    />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

/**
 * Day-resolution time axis (#309) — a pinned time range spanning ≤ 14 days
 * derives one column per day automatically (`resolution: "hour" | "day" |
 * "week" | "month" | "quarter" | "year"` forces the unit instead), and
 * `format` prints each column with the Chart date-pattern tokens (`"ddd DD"`
 * → `Mon 30`). The pinned range is a half-open calendar window `[min, max)`:
 * Mar 30 … Apr 6 is exactly the seven columns Mon 30 … Sun 05. Events and the
 * now divider keep real instants — each floors to its day column.
 */
export const plannerDayResolution = example({
    keywords: ["Planner", "time", "day", "resolution", "week", "daily", "format", "ddd", "axis", "range", "roster", "hour", "columns"],
    description: "Day-resolution time axis — a pinned 7-day window derives Mon 30 … Sun 05 day columns (format 'ddd DD'); resolution: 'hour'/'day'/'week'/'month'/'quarter'/'year' forces the unit",
    fn: East.function([], UIComponentType, (_$) => (
        <Planner.Point
            data={[
                { name: "Press A", role: "Stamp" },
                { name: "Press B", role: "Stamp" },
                { name: "Line 1", role: "Bottling" },
            ]}
            axis={Planner.axis.time({
                format: "ddd DD",
                range: { min: new Date("2026-03-30"), max: new Date("2026-04-06") },
            })}
            now={Planner.at.time(new Date("2026-04-02"))}
            columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
            events={_r => [
                Planner.event({ slot: Planner.at.time(new Date("2026-03-30T10:00:00Z")), label: "Setup", state: "committed" }),
                Planner.event({ slot: Planner.at.time(new Date("2026-04-01T09:00:00Z")), label: "Run", state: "committed" }),
                Planner.event({ slot: Planner.at.time(new Date("2026-04-03T09:00:00Z")), label: "Plan", state: "added" }),
            ]}
        />
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
    description: "Library + Planner DnD — drag a person onto the weekly plan (proposed(added) tile, per-cell ⊘ veto left of now; Press B's AM/PM bucket lanes take drops as composite day:bucket slots); every grammar arm and Approve logs to the LAST line; the drop flips the row pending and Approve resolves it",
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

/**
 * Height sizing pair (#320) — a definite `height` pins the plan to exactly its
 * box (vs `maxHeight`'s grow-up-to-a-cap), and `height="fill"` resolves against
 * a bounded parent Box with row virtualization.
 */
export const plannerFill = example({
    keywords: ["Planner", "height", "definite", "bounded", "scroll", "sticky", "sizing", "#320", "fill", "Box", "virtual"],
    description: "Height sizing pair (#320) — fill height (a definite height=\"220px\" pins the plan to exactly this box; header pinned, body scrolls within) and fill (height=\"fill\" inside a fixed 200px Box: two hundred rows overflow the box so only the visible rows mount, header pinned)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FILL HEIGHT</Text>
                    <Planner.Point
                        data={PLANNER_FILL_HEIGHT_DATA}
                        axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 6 } })}
                        columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                        events={_r => [
                            Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(3), bucket: "am", label: "✓", state: "committed" }),
                            Planner.event({ slot: Planner.at.number(4), bucket: "pm", label: "plan", state: "added" }),
                        ]}
                        now={Planner.at.number(4)}
                        height="220px"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FILL</Text>
                    <Box height="200px">
                        <Planner.Point
                            data={PLANNER_FILL_DATA}
                            axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 6 } })}
                            columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                            events={_r => [
                                Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "on", state: "committed" }),
                                Planner.event({ slot: Planner.at.number(4), bucket: "pm", label: "plan", state: "added" }),
                            ]}
                            height="fill"
                        />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
