/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, IntegerType, NullType, FloatType, ArrayType, OptionType, StringType, some, none, variant, example } from "@elaraai/east";
import { DragEventType, State, UIComponentType } from "@elaraai/east-ui";
import { Box, Library, Planner, Reactive, Text, VStack } from "@elaraai/east-ui";

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
 * Vertical scroll (#302) — a `maxHeight` caps the plan area so the body scrolls
 * within it while the header row (identity columns + day axis) stays pinned. The
 * row list here is deliberately taller than the cap so the scroll engages.
 */
export const plannerScroll = example({
    keywords: ["Planner", "maxHeight", "scroll", "vertical", "stickyHeader", "sticky", "overflow", "pinned"],
    description: "Vertical scroll — maxHeight caps the plan area, body scrolls with the header pinned (sticky-top)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[
                    { name: "api-01", role: "Lead" }, { name: "api-02", role: "Engineer" },
                    { name: "api-03", role: "Engineer" }, { name: "cache-01", role: "Service" },
                    { name: "cache-02", role: "Service" }, { name: "etl-01", role: "Lead" },
                    { name: "etl-02", role: "Engineer" }, { name: "etl-03", role: "Engineer" },
                    { name: "web-01", role: "Lead" }, { name: "web-02", role: "Engineer" },
                    { name: "web-03", role: "Engineer" }, { name: "queue-01", role: "Service" },
                    { name: "queue-02", role: "Service" }, { name: "batch-01", role: "Lead" },
                    { name: "batch-02", role: "Engineer" }, { name: "batch-03", role: "Engineer" },
                ]}
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
 * Configurable labelled sub-slot buckets — here three named buckets per column.
 */
export const plannerBuckets = example({
    keywords: ["Planner", "bucket", "sub-slot", "slotsPerColumn", "shift", "morning", "afternoon"],
    description: "Labelled sub-slot buckets per column (three named shifts)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Alice" }, { name: "Bob" }]}
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
        );
    }),
    inputs: [],
});

/**
 * Per-cell bucketing across a grouped Planner — `Alice` mixes stretched
 * bucketed cells (day-1 am/pm fill their lanes) with an unstretched unbucketed
 * cell (day-3, a flat tile that still fills the taller row); `Bob` has a
 * stretched unbucketed cell (day-1); the `Daily` group is plain flat rows.
 * `events` branches per row on boolean fields so each resource emits its own
 * typed `Array<PlannerEvent>`.
 */
export const plannerMixedBuckets = example({
    keywords: ["Planner", "bucket", "per-cell", "mixed", "unbucketed", "stretch", "flat", "ifElse", "group"],
    description: "Per-cell bucketing in a grouped Planner — Alice mixes stretched bucketed cells with an unstretched flat cell, Bob has a stretched flat cell, the Daily group is plain flat rows",
    fn: East.function([], UIComponentType, ($) => {
        // One typed event list per resource so the per-row `ifElse` branches
        // each return a typed `Array<PlannerEvent>`.
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
        return (
            <Planner.Point
                data={[
                    { name: "Alice", group: "Shifts", isAlice: true, isBob: false },
                    { name: "Bob", group: "Shifts", isAlice: false, isBob: true },
                    { name: "Headcount", group: "Daily", isAlice: false, isBob: false },
                    { name: "Output", group: "Daily", isAlice: false, isBob: false },
                ]}
                axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 5 } })}
                groupBy={r => r.group}
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={r => r.isAlice.ifElse(() => aliceEvents, () => r.isBob.ifElse(() => bobEvents, () => dailyEvents))}
            />
        );
    }),
    inputs: [],
});

/**
 * An ordinal axis (named phases), one slot per column (no buckets).
 */
export const plannerOrdinalAxis = example({
    keywords: ["Planner", "ordinal", "phase", "stage", "category", "axis"],
    description: "Ordinal phase axis, one slot per column",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Item" }]}
                axis={Planner.axis.ordinal({ range: ["backlog", "active", "review", "done"] })}
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={_r => [
                    Planner.event({ slot: Planner.at.ordinal("active"), label: "Start", state: "committed" }),
                    Planner.event({ slot: Planner.at.ordinal("done"), label: "Wrap up", state: "model" }),
                ]}
            />
        );
    }),
    inputs: [],
});

/**
 * Data-driven axis extent — `range.max` is a runtime `FloatType` expression
 * (not a literal), so the day axis can be pinned to bound/computed data. Here a
 * `horizon` day past the last event pins the grid, keeping the `now` marker (a
 * day with no events) on-grid instead of clipped off the right edge.
 */
export const plannerDataDrivenRange = example({
    keywords: ["Planner", "axis", "range", "data-driven", "expression", "now", "horizon", "FloatType", "SubtypeExprOrValue"],
    description: "Data-driven numeric axis extent — range.max is a FloatType expression; the now marker beyond the last event stays on-grid",
    fn: East.function([], UIComponentType, ($) => {
        // A runtime-derived horizon (last event day 3 + a 4-day tail = 7) — proves
        // range.max accepts a FloatType *expression*, not just a literal.
        const lastEventDay = $.const(3.0, FloatType);
        const horizon = $.const(lastEventDay.add(4.0), FloatType);
        return (
            <Planner.Point
                data={[{ name: "Line A" }, { name: "Line B" }]}
                axis={Planner.axis.number({ range: { min: 1, max: horizon } })}
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={_r => [
                    Planner.event({ slot: Planner.at.number(1), label: "✓", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(2), label: "✓", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(3), label: "plan", state: "added" }),
                ]}
                now={Planner.at.number(7)}
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
 * Status markers — declared parallel to events, each a status-coloured ring +
 * corner icon with a hover-tooltip message. Reuses the shared status palette so
 * a cell can be flagged good (`success`) as readily as bad (`danger`).
 */
export const plannerMarkers = example({
    keywords: ["Planner", "marker", "status", "success", "warning", "danger", "info", "flag", "tooltip"],
    description: "Status markers parallel to events — success / warning / danger / info, each a status-coloured ring + corner icon with a hover tooltip",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[
                    { name: "api-01", role: "Lead" },
                    { name: "api-02", role: "Engineer" },
                    { name: "cache", role: "Service" },
                    { name: "etl-01", role: "Batch" },
                ]}
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
        );
    }),
    inputs: [],
});

/**
 * A per-event click popover with rich content.
 */
export const plannerPopover = example({
    keywords: ["Planner", "popover", "detail", "click", "rich"],
    description: "Per-event click popover with rich content",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Alice" }]}
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
                { name: "Press A", role: "Crush" },
                { name: "Press B", role: "Crush" },
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
 * Density — the row / header rhythm (compact here; comfortable / condensed also
 * available), mirroring Table and Gantt.
 */
export const plannerDensity = example({
    keywords: ["Planner", "density", "compact", "comfortable", "condensed", "size"],
    description: "Density control over the row / header rhythm",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Alice" }, { name: "Bob" }]}
                axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                density="compact"
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={_r => [Planner.event({ slot: Planner.at.number(1), label: "Task", state: "committed" })]}
            />
        );
    }),
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
 * Per-event `stretch` + content orientation — a tile fills its cell on one or
 * both axes, with its content positioned inside. Absent ⇒ a normal-size,
 * top-left tile (the new default).
 */
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

export const plannerStretch = example({
    keywords: ["Planner", "stretch", "fill", "content", "align", "orientation", "tile", "both", "horizontal"],
    description: "Per-event stretch + content alignment — a both-axis tile filling its cell with centred content, a width-filling tile, and a normal top-left tile",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Line A" }, { name: "Line B" }]}
                axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                density="comfortable"
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={_r => [
                    Planner.event({ slot: Planner.at.number(1), label: "Full", state: "committed", stretch: "both", content: { horizontal: "center", vertical: "center" } }),
                    Planner.event({ slot: Planner.at.number(2), label: "Wide", state: "added", stretch: "horizontal" }),
                    Planner.event({ slot: Planner.at.number(3), label: "Top-left", state: "committed" }),
                ]}
            />
        );
    }),
    inputs: [],
});

/**
 * Per-event colour override (`tone`) + attention `animation`. `tone` tints
 * fill/text/border while keeping the state's audit cues (border-style /
 * strike-through); `pulse` draws a gentle opacity pulse (honouring
 * `prefers-reduced-motion`).
 */
export const plannerEventTone = example({
    keywords: ["Planner", "tone", "colour", "override", "animation", "pulse", "attention", "warning", "danger"],
    description: "Per-event tone colour override + pulse animation — a danger-toned committed event pulses for attention while keeping its audit cues",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Reactor" }]}
                axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={_r => [
                    Planner.event({ slot: Planner.at.number(1), label: "OK", state: "committed" }),
                    Planner.event({ slot: Planner.at.number(2), label: "Watch", state: "committed", tone: "warning" }),
                    Planner.event({ slot: Planner.at.number(3), label: "Breach", state: "committed", tone: "danger", animation: "pulse" }),
                ]}
            />
        );
    }),
    inputs: [],
});

/**
 * Per-event brand colour (`color` raw token / `colorPalette` palette) so planner
 * rows can match a paired Chart's series colours — overriding the `tone` tint
 * while keeping the state's border-style.
 */
export const plannerEventColor = example({
    keywords: ["Planner", "color", "colorPalette", "brand", "teal", "purple", "match", "chart", "series"],
    description: "Per-event brand colour — color (raw token e.g. 'teal.solid') and colorPalette ('purple') so planner rows match their paired chart series colours",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Line" }]}
                axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={_r => [
                    Planner.event({ slot: Planner.at.number(1), label: "Series A", state: "committed", color: "teal.solid" }),
                    Planner.event({ slot: Planner.at.number(2), label: "Series B", state: "committed", colorPalette: "purple" }),
                    Planner.event({ slot: Planner.at.number(3), label: "Set", state: "committed", color: "black" }),
                ]}
            />
        );
    }),
    inputs: [],
});

/**
 * Open-on-hover `hovercard` (rich UIComponent), coexisting with the click
 * `popover` on one event — hover previews, click pins.
 */
export const plannerHovercard = example({
    keywords: ["Planner", "hovercard", "hover", "popover", "preview", "rich", "coexist"],
    description: "Open-on-hover HoverCard on an event, coexisting with the click popover (hover previews, click pins)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Alice" }]}
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
        );
    }),
    inputs: [],
});

/**
 * Opt-in `rowHover` — a light brand outline draws around the whole row (over
 * both panes) on hover. Pure visual affordance; works on read-only planners.
 */
export const plannerRowHover = example({
    keywords: ["Planner", "rowHover", "hover", "row", "highlight", "outline"],
    description: "Opt-in row-hover highlight — a light brand outline draws around the whole row on hover",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]}
                axis={Planner.axis.number({ range: { min: 1, max: 4 } })}
                rowHover={true}
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={_r => [Planner.event({ slot: Planner.at.number(1), label: "Task", state: "committed" })]}
            />
        );
    }),
    inputs: [],
});

/**
 * Per-cell bucketing composed with `stretch` — `Press A` is bucketed (its day-1
 * am/pm lanes are stretched to fill their band, a stray bucketless event drops
 * to an `N/A` lane, and day-2 is a normal-sized bucketed cell); `Press B` is
 * flat (a stretched unbucketed tile filling day-1, a normal tile on day-2).
 */
export const plannerPerCellBuckets = example({
    keywords: ["Planner", "bucket", "per-cell", "mixed", "flat", "N/A", "orphan", "stretch", "fill"],
    description: "Per-cell bucketing with stretch — Press A's bucketed day-1 lanes are stretched to fill (a stray bucketless event drops to an N/A lane) beside a normal bucketed cell; Press B is flat, with a stretched unbucketed cell beside a normal one",
    fn: East.function([], UIComponentType, ($) => {
        // Press A — bucketed: day-1 am/pm lanes stretched to fill their band (+ a
        // stray bucketless event ⇒ N/A lane); day-2 a normal-sized bucketed cell.
        const pressA = $.const([
            Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "Setup", state: "committed", stretch: "both" }),
            Planner.event({ slot: Planner.at.number(1), bucket: "pm", label: "Run", state: "committed", stretch: "both" }),
            Planner.event({ slot: Planner.at.number(1), label: "Note", state: "added" }),
            Planner.event({ slot: Planner.at.number(2), bucket: "am", label: "QA", state: "committed" }),
        ], ArrayType(Planner.Types.Event));
        // Press B — flat (unbucketed): day-1 a stretched tile filling the cell,
        // day-2 a normal content-sized tile.
        const pressB = $.const([
            Planner.event({ slot: Planner.at.number(1), label: "Maint", state: "committed", stretch: "both" }),
            Planner.event({ slot: Planner.at.number(2), label: "Idle", state: "added" }),
        ], ArrayType(Planner.Types.Event));
        return (
            <Planner.Point
                data={[
                    { name: "Press A", bucketed: true },
                    { name: "Press B", bucketed: false },
                ]}
                axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 3 } })}
                columns={[{ key: "name", frozen: true, value: r => r.name }]}
                events={r => r.bucketed.ifElse(() => pressA, () => pressB)}
            />
        );
    }),
    inputs: [],
});

/**
 * Definite height (#320) — `height` pins the plan to exactly this box (vs
 * `maxHeight`'s grow-up-to-a-cap); the header stays pinned and the body scrolls.
 */
export const plannerFillHeight = example({
    keywords: ["Planner", "height", "definite", "bounded", "scroll", "sticky", "sizing", "#320"],
    description: "Definite height (#320) — `height=\"220px\"` pins the plan to exactly this box; header pinned, body scrolls within (contrast `plannerScroll`'s grow-to-a-cap `maxHeight`)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Planner.Point
                data={[
                    { name: "api-01", role: "Lead" }, { name: "api-02", role: "Engineer" },
                    { name: "api-03", role: "Engineer" }, { name: "cache-01", role: "Service" },
                    { name: "cache-02", role: "Service" }, { name: "etl-01", role: "Lead" },
                    { name: "etl-02", role: "Engineer" }, { name: "etl-03", role: "Engineer" },
                    { name: "web-01", role: "Lead" }, { name: "web-02", role: "Engineer" },
                    { name: "web-03", role: "Engineer" }, { name: "queue-01", role: "Service" },
                ]}
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
        );
    }),
    inputs: [],
});


export const plannerFill = example({
    keywords: ["Planner", "fill", "height", "Box", "bounded", "scroll", "virtual", "sizing", "#320"],
    description: "height=\"fill\" (#320) — the plan fills a fixed 200px Box and scrolls within it; two hundred rows overflow the box so only the visible rows (plus overscan) mount, with the header pinned (contrast plannerFillHeight's own definite height)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box height="200px">
                <Planner.Point
                    data={East.Array.range(0n, 200n).map((_$, i) => ({
                        name: East.str`unit-${i}`,
                        role: i.remainder(3n).equals(0n).ifElse(() => "Lead", () => "Engineer"),
                    }))}
                    axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 6 } })}
                    columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                    events={_r => [
                        Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "on", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(4), bucket: "pm", label: "plan", state: "added" }),
                    ]}
                    height="fill"
                />
            </Box>
        );
    }),
    inputs: [],
});
