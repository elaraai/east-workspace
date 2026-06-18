/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, some, none, variant, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Planner, Text, VStack } from "@elaraai/east-ui";

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
