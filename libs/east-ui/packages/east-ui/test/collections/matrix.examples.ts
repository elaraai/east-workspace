/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { ArrayType, East, FloatType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { Matrix, Reactive, State, Stack, Text, UIComponentType } from "@elaraai/east-ui";

/**
 * Heat-grid — rows × days, each cell a booked/free weight bar, rows grouped by
 * team. The base configuration: utilisation read as bar fill, no labels.
 */
export const matrixHeatGrid = example({
    keywords: ["Matrix", "heat-grid", "segment", "booked", "free", "group", "groupBy", "utilization", "capacity"],
    description: "Heat-grid: resources × days, each cell a booked/free weight bar; rows grouped by team",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { name: "Alice", role: "Senior PM", team: "Web", booked: new Map([["mon", 0.45], ["tue", 0.70], ["wed", 0.85], ["thu", 0.60], ["fri", 0.30]]) },
                { name: "Bob", role: "Designer", team: "Web", booked: new Map([["mon", 0.35], ["tue", 0.60], ["wed", 0.30], ["thu", 0.75], ["fri", 0.50]]) },
                { name: "Carol", role: "Engineer", team: "Batch", booked: new Map([["mon", 0.55], ["tue", 0.40], ["wed", 0.90], ["thu", 0.20], ["fri", 0.65]]) },
            ],
            {
                columns: [{ key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }, { key: "wed", label: "Wed" }, { key: "thu", label: "Thu" }, { key: "fri", label: "Fri" }],
                rowKey: r => r.name,
                rowHeader: "Resource",
                rowSublabel: r => r.role,
                groupBy: r => r.team,
                cell: (r, col) => Matrix.cell({ segments: [
                    Matrix.segment({ fill: "brand", weight: r.booked.get(col) }),
                    Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col)) }),
                ] }),
                legend: [{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }],
            },
        );
    }),
    inputs: [],
});

/**
 * Multi-segment — three categories per cell (committed / pending / slack) with
 * in-bar % labels, drag-resize handles (via `onSegmentChange`), and labels
 * suppressed under `minLabelSize`.
 */
export const matrixSegments = example({
    keywords: ["Matrix", "segment", "committed", "pending", "slack", "drag", "resize", "onSegmentChange", "minLabelSize", "weight", "allocation"],
    description: "Multi-segment cells (committed / pending / slack) with in-bar labels, drag-resize, and minLabelSize suppression",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { sprint: "Sprint 1", committed: new Map([["design", 0.50], ["dev", 0.70], ["qa", 0.30]]), pending: new Map([["design", 0.30], ["dev", 0.20], ["qa", 0.40]]) },
                { sprint: "Sprint 2", committed: new Map([["design", 0.45], ["dev", 0.80], ["qa", 0.25]]), pending: new Map([["design", 0.35], ["dev", 0.15], ["qa", 0.35]]) },
            ],
            {
                columns: [{ key: "design", label: "Design" }, { key: "dev", label: "Development" }, { key: "qa", label: "QA" }],
                rowKey: r => r.sprint,
                rowHeader: "Sprint",
                minLabelSize: 28.0,
                cell: (r, col) => Matrix.cell({ segments: [
                    Matrix.segment({ fill: "success", weight: r.committed.get(col), label: East.str`${r.committed.get(col).multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                    Matrix.segment({ fill: "warning", weight: r.pending.get(col), label: East.str`${r.pending.get(col).multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                    Matrix.segment({ fill: "slack", weight: East.value(1.0, FloatType).subtract(r.committed.get(col)).subtract(r.pending.get(col)) }),
                ] }),
                legend: [{ fill: "success", label: "Committed" }, { fill: "warning", label: "Pending" }, { fill: "slack", label: "Slack" }],
                onSegmentChange: East.function([Matrix.Types.SegmentChangeEvent], NullType, _$ => null),
            },
        );
    }),
    inputs: [],
});

/**
 * Vertical orientation — each cell a bottom-anchored stacked capacity bar
 * (utilisation by height) instead of a horizontal weight bar.
 */
export const matrixVertical = example({
    keywords: ["Matrix", "vertical", "orientation", "capacity", "stacked", "utilization", "bar"],
    description: "Vertical orientation — cells stack bottom-up as capacity bars (height-encoded utilisation)",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { team: "Team A", booked: new Map([["mon", 0.70], ["tue", 0.55], ["wed", 0.90], ["thu", 0.65], ["fri", 0.45]]) },
                { team: "Team B", booked: new Map([["mon", 0.50], ["tue", 0.75], ["wed", 0.40], ["thu", 0.85], ["fri", 0.60]]) },
            ],
            {
                columns: [{ key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }, { key: "wed", label: "Wed" }, { key: "thu", label: "Thu" }, { key: "fri", label: "Fri" }],
                rowKey: r => r.team,
                rowHeader: "Team",
                orientation: "vertical",
                cell: (r, col) => Matrix.cell({ segments: [
                    Matrix.segment({ fill: "brand", weight: r.booked.get(col) }),
                    Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col)) }),
                ] }),
                legend: [{ fill: "brand", label: "Used capacity" }, { fill: "free", label: "Available" }],
            },
        );
    }),
    inputs: [],
});

/**
 * Cell status markers — every cell carries a marker (the Matrix analogue of
 * `Planner.marker`) whose status, corner icon, and hover message follow the
 * booked value: over-capacity cells flag `danger`, near-capacity `warning`, the
 * rest `success`. The marker tints a corner ring over the segment bar.
 */
export const matrixMarkers = example({
    keywords: ["Matrix", "marker", "status", "ring", "corner", "tooltip", "danger", "warning", "capacity", "overbooked"],
    description: "Cell status markers (the Matrix analogue of Planner.marker) — status/message follow the booked value, tinting a corner ring",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [
                { name: "Alice", role: "PM", booked: new Map([["mon", 0.80], ["tue", 0.50], ["wed", 1.00]]) },
                { name: "Bob", role: "Design", booked: new Map([["mon", 0.35], ["tue", 1.00], ["wed", 0.60]]) },
            ],
            {
                columns: [{ key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }, { key: "wed", label: "Wed" }],
                rowKey: r => r.name,
                rowHeader: "Resource",
                rowSublabel: r => r.role,
                cell: (r, col) => Matrix.cell({
                    segments: [
                        Matrix.segment({ fill: "brand", weight: r.booked.get(col), label: East.str`${r.booked.get(col).multiply(8.0)}h` }),
                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col)) }),
                    ],
                    markers: [Matrix.marker({
                        status: r.booked.get(col).greaterEqual(1.0).ifElse(
                            _$ => variant("danger", null),
                            _$ => r.booked.get(col).greaterEqual(0.75).ifElse(_$ => variant("warning", null), _$ => variant("success", null)),
                        ),
                        message: East.str`${r.booked.get(col).multiply(100.0)}% booked`,
                        at: "tr",
                    })],
                }),
                legend: [{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }],
            },
        );
    }),
    inputs: [],
});

/**
 * Per-cell click popover — pass a UIComponent into `popover` for rich detail on
 * click (popover-only, like the Planner event — no tooltip).
 */
export const matrixPopover = example({
    keywords: ["Matrix", "popover", "click", "detail", "onCellClick"],
    description: "Per-cell click popover with rich content",
    fn: East.function([], UIComponentType, (_$) => {
        return Matrix.Root(
            [{ name: "Alice", booked: new Map([["mon", 0.7], ["tue", 0.4]]) }],
            {
                columns: [{ key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }],
                rowKey: r => r.name,
                rowHeader: "Resource",
                cell: (r, col) => Matrix.cell({
                    segments: [
                        Matrix.segment({ fill: "brand", weight: r.booked.get(col) }),
                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col)) }),
                    ],
                    popover: Stack.VStack([
                        Text.Root("Allocation", { fontWeight: "semibold" }),
                        Text.Root(East.str`${r.booked.get(col).multiply(100.0)}% booked`, { color: "fg.muted" }),
                    ], { gap: "1" }),
                }),
                onCellClick: East.function([Matrix.Types.CellClickEvent], NullType, _$ => null),
            },
        );
    }),
    inputs: [],
});

/**
 * Reactive bound-state edit — dragging the committed segment fires
 * `onSegmentChange`, which writes the new weight to browser-local state; the
 * cell reads that bound value back, so the grid is fully controlled.
 */
export const matrixReactiveAdjust = example({
    keywords: ["Matrix", "reactive", "State", "bind", "onSegmentChange", "adjust", "edit", "drag", "controlled"],
    description: "Drag a segment to adjust its weight — onSegmentChange writes the new value to bound State, which the cell reads back",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const committedBind = $.let(State.bind([FloatType], "matrix_adjust_committed", 0.5));
            const committed = $.let(committedBind.read());
            const data = $.const([{ team: "Squad", load: committed }], ArrayType(StructType({ team: StringType, load: FloatType })));
            return Matrix.Root(data, {
                columns: [{ key: "load", label: "Allocation" }],
                rowKey: r => r.team,
                rowHeader: "Squad",
                cell: (r, _col) => Matrix.cell({ segments: [
                    Matrix.segment({ fill: "success", weight: r.load, label: East.str`${r.load.multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                    Matrix.segment({ fill: "slack", weight: East.value(1.0, FloatType).subtract(r.load) }),
                ] }),
                onSegmentChange: East.function([Matrix.Types.SegmentChangeEvent], NullType, ($, e) => {
                    $(committedBind.write(e.weight));
                }),
            });
        }));
    }),
    inputs: [],
});
