/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, FloatType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Matrix, Reactive, Slider, Text, VStack } from "@elaraai/east-ui";

/**
 * Heat-grid — rows × days, each cell a booked/free weight bar, rows grouped by
 * team. The base configuration: utilisation read as bar fill, no labels.
 */
export const matrixHeatGrid = example({
    keywords: ["Matrix", "heat-grid", "segment", "booked", "free", "group", "groupBy", "utilization", "capacity"],
    description: "Heat-grid: resources × days, each cell a booked/free weight bar; rows grouped by team",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Matrix
                data={[
                    { name: "Alice", role: "Senior PM", team: "Web", booked: new Map([["mon", 0.45], ["tue", 0.70], ["wed", 0.85], ["thu", 0.60], ["fri", 0.30]]) },
                    { name: "Bob", role: "Designer", team: "Web", booked: new Map([["mon", 0.35], ["tue", 0.60], ["wed", 0.30], ["thu", 0.75], ["fri", 0.50]]) },
                    { name: "Carol", role: "Engineer", team: "Batch", booked: new Map([["mon", 0.55], ["tue", 0.40], ["wed", 0.90], ["thu", 0.20], ["fri", 0.65]]) },
                ]}
                columns={[
                    Matrix.column({ key: "mon", label: "Mon" }),
                    Matrix.column({ key: "tue", label: "Tue" }),
                    Matrix.column({ key: "wed", label: "Wed" }),
                    Matrix.column({ key: "thu", label: "Thu" }),
                    Matrix.column({ key: "fri", label: "Fri" }),
                ]}
                rowKey={r => r.name}
                rowHeader="Resource"
                rowSublabel={r => r.role}
                groupBy={r => r.team}
                cell={(r, col) => Matrix.cell({ segments: [
                    Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                    Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                ] })}
                legend={[{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }]}
            />
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
        return (
            <Matrix
                data={[
                    { sprint: "Sprint 1", committed: new Map([["design", 0.50], ["dev", 0.70], ["qa", 0.30]]), pending: new Map([["design", 0.30], ["dev", 0.20], ["qa", 0.40]]) },
                    { sprint: "Sprint 2", committed: new Map([["design", 0.45], ["dev", 0.80], ["qa", 0.25]]), pending: new Map([["design", 0.35], ["dev", 0.15], ["qa", 0.35]]) },
                ]}
                columns={[
                    Matrix.column({ key: "design", label: "Design" }),
                    Matrix.column({ key: "dev", label: "Development" }),
                    Matrix.column({ key: "qa", label: "QA" }),
                ]}
                rowKey={r => r.sprint}
                rowHeader="Sprint"
                minLabelSize={28.0}
                cell={(r, col) => Matrix.cell({ segments: [
                    Matrix.segment({ fill: "success", weight: r.committed.get(col.key), label: East.str`${r.committed.get(col.key).multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                    Matrix.segment({ fill: "warning", weight: r.pending.get(col.key), label: East.str`${r.pending.get(col.key).multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                    Matrix.segment({ fill: "slack", weight: East.value(1.0, FloatType).subtract(r.committed.get(col.key)).subtract(r.pending.get(col.key)) }),
                ] })}
                legend={[{ fill: "success", label: "Committed" }, { fill: "warning", label: "Pending" }, { fill: "slack", label: "Slack" }]}
                onSegmentChange={East.function([Matrix.Types.SegmentChangeEvent], NullType, _$ => null)}
            />
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
        return (
            <Matrix
                data={[
                    { team: "Team A", booked: new Map([["mon", 0.70], ["tue", 0.55], ["wed", 0.90], ["thu", 0.65], ["fri", 0.45]]) },
                    { team: "Team B", booked: new Map([["mon", 0.50], ["tue", 0.75], ["wed", 0.40], ["thu", 0.85], ["fri", 0.60]]) },
                ]}
                columns={[
                    Matrix.column({ key: "mon", label: "Mon" }),
                    Matrix.column({ key: "tue", label: "Tue" }),
                    Matrix.column({ key: "wed", label: "Wed" }),
                    Matrix.column({ key: "thu", label: "Thu" }),
                    Matrix.column({ key: "fri", label: "Fri" }),
                ]}
                rowKey={r => r.team}
                rowHeader="Team"
                orientation="vertical"
                cell={(r, col) => Matrix.cell({ segments: [
                    Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                    Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                ] })}
                legend={[{ fill: "brand", label: "Used capacity" }, { fill: "free", label: "Available" }]}
            />
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
        return (
            <Matrix
                data={[
                    { name: "Alice", role: "PM", booked: new Map([["mon", 0.80], ["tue", 0.50], ["wed", 1.00]]) },
                    { name: "Bob", role: "Design", booked: new Map([["mon", 0.35], ["tue", 1.00], ["wed", 0.60]]) },
                ]}
                columns={[
                    Matrix.column({ key: "mon", label: "Mon" }),
                    Matrix.column({ key: "tue", label: "Tue" }),
                    Matrix.column({ key: "wed", label: "Wed" }),
                ]}
                rowKey={r => r.name}
                rowHeader="Resource"
                rowSublabel={r => r.role}
                cell={(r, col) => Matrix.cell({
                    segments: [
                        Matrix.segment({ fill: "brand", weight: r.booked.get(col.key), label: East.str`${r.booked.get(col.key).multiply(8.0)}h` }),
                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                    ],
                    markers: [Matrix.marker({
                        status: r.booked.get(col.key).greaterEqual(1.0).ifElse(
                            _$ => variant("danger", null),
                            _$ => r.booked.get(col.key).greaterEqual(0.75).ifElse(_$ => variant("warning", null), _$ => variant("success", null)),
                        ),
                        message: East.str`${r.booked.get(col.key).multiply(100.0)}% booked`,
                        at: "tr",
                    })],
                })}
                legend={[{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }]}
            />
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
        return (
            <Matrix
                data={[{ name: "Alice", booked: new Map([["mon", 0.7], ["tue", 0.4]]) }]}
                columns={[
                    Matrix.column({ key: "mon", label: "Mon" }),
                    Matrix.column({ key: "tue", label: "Tue" }),
                ]}
                rowKey={r => r.name}
                rowHeader="Resource"
                cell={(r, col) => Matrix.cell({
                    segments: [
                        Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                    ],
                    popover: (
                        <VStack gap="1">
                            <Text fontWeight="semibold">Allocation</Text>
                            <Text color="fg.muted">{East.str`${r.booked.get(col.key).multiply(100.0)}% booked`}</Text>
                        </VStack>
                    ),
                })}
                onCellClick={East.function([Matrix.Types.CellClickEvent], NullType, _$ => null)}
            />
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
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const committedBind = $.let(State.bind([FloatType], "matrix_adjust_committed", 0.5));
            const committed = $.let(committedBind.read());
            const data = $.const([{ team: "Squad", load: committed }], ArrayType(StructType({ team: StringType, load: FloatType })));
            const onSegmentChange = $.const(East.function([Matrix.Types.SegmentChangeEvent], NullType, ($, e) => {
                $(committedBind.write(e.weight));
            }));
            return (
                <Matrix
                    data={data}
                    columns={[
                        Matrix.column({ key: "load", label: "Allocation" }),
                    ]}
                    rowKey={r => r.team}
                    rowHeader="Squad"
                    cell={(r, _col) => Matrix.cell({ segments: [
                        Matrix.segment({ fill: "success", weight: r.load, label: East.str`${r.load.multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                        Matrix.segment({ fill: "slack", weight: East.value(1.0, FloatType).subtract(r.load) }),
                    ] })}
                    onSegmentChange={onSegmentChange}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Reactive data-driven pivot — both axes are derived from the cell records, not
 * declared. A flat list of `{ resource, day, load }` bookings is pivoted into a
 * resource × day grid: the distinct days become the `columns` and the distinct
 * resources become the rows, each computed East-side from the data. A bound
 * threshold drops every booking below it, so as you drag the slider whole
 * columns and rows appear and disappear with the surviving cells.
 */
export const matrixReactivePivot = example({
    keywords: ["Matrix", "reactive", "pivot", "data-driven", "columns", "rows", "State", "threshold", "filter"],
    description: "Reactive pivot — rows and columns are both derived from the cell records; drag the threshold to drop low bookings and watch whole rows/columns appear and disappear",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const BookingArrayType = ArrayType(StructType({ resource: StringType, day: StringType, load: FloatType }));
            const bookings = $.let([
                { resource: "Alice", day: "Mon", load: 0.90 },
                { resource: "Alice", day: "Tue", load: 0.30 },
                { resource: "Alice", day: "Wed", load: 0.60 },
                { resource: "Bob", day: "Mon", load: 0.20 },
                { resource: "Bob", day: "Wed", load: 0.80 },
                { resource: "Carol", day: "Tue", load: 0.50 },
                { resource: "Carol", day: "Thu", load: 0.95 },
                { resource: "Dave", day: "Fri", load: 0.15 },
            ], BookingArrayType);

            const thresholdBind = $.let(State.bind([FloatType], "matrix_pivot_threshold", 0.0));
            const threshold = $.let(thresholdBind.read());
            const onChange = $.const(East.function([FloatType], NullType, ($, next) => {
                $(thresholdBind.write(next));
            }));

            // Both axes emerge from the surviving cells: keep bookings at or above
            // the threshold, then take the distinct days (columns) and resources (rows).
            const kept = $.let(bookings.filter(($, b) => b.load.greaterEqual(threshold)));
            const dayKeys = $.let(kept.toSet(($, b) => b.day).toArray());
            const resourceKeys = $.let(kept.toSet(($, b) => b.resource).toArray());

            return (
                <VStack gap="3" align="stretch">
                    <Slider value={threshold} min={0} max={1} step={0.05} onChange={onChange} />
                    {<Text.MonoLabel>{East.str`THRESHOLD ${East.print(threshold)} · ${resourceKeys.size()} ROWS × ${dayKeys.size()} COLS`}</Text.MonoLabel>}
                    <Matrix
                        data={resourceKeys.map(($, name) => ({
                            name,
                            // Pivot this resource's surviving bookings into a day → load
                            // cell, summed per (resource, day) and zero where it has none.
                            loads: dayKeys.toDict(
                                ($, day) => day,
                                ($, day) => kept.filter(($, b) => b.resource.equal(name).and(() => b.day.equal(day))).sum(($, b) => b.load),
                            ),
                        }))}
                        columns={dayKeys.map(($, day) => Matrix.column({ key: day, label: day }))}
                        rowKey={r => r.name}
                        rowHeader="Resource"
                        cell={(r, col) => Matrix.cell({ segments: [
                            Matrix.segment({ fill: "brand", weight: r.loads.get(col.key), label: East.str`${r.loads.get(col.key).multiply(100.0)}%` }),
                            Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.loads.get(col.key)) }),
                        ] })}
                        legend={[{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }]}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Bounded (#320) — a bare-number `maxHeight` (parsed to px) caps the whole
 * matrix; it becomes its own scroll region (chrome-inclusive) and scrolls within.
 */
export const matrixBounded = example({
    keywords: ["Matrix", "maxHeight", "height", "bounded", "scroll", "sizing", "#320"],
    description: "Bounded matrix (#320) — a bare-number maxHeight ('140', parsed to 140px) caps the whole component; it scrolls within its box instead of growing to content",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Matrix
                data={[
                    { name: "Alice", role: "Senior PM", team: "Web", booked: new Map([["mon", 0.45], ["tue", 0.70], ["wed", 0.85]]) },
                    { name: "Bob", role: "Designer", team: "Web", booked: new Map([["mon", 0.35], ["tue", 0.60], ["wed", 0.30]]) },
                    { name: "Carol", role: "Engineer", team: "Batch", booked: new Map([["mon", 0.55], ["tue", 0.40], ["wed", 0.90]]) },
                    { name: "Dan", role: "Engineer", team: "Batch", booked: new Map([["mon", 0.25], ["tue", 0.80], ["wed", 0.50]]) },
                ]}
                columns={[
                    Matrix.column({ key: "mon", label: "Mon" }),
                    Matrix.column({ key: "tue", label: "Tue" }),
                    Matrix.column({ key: "wed", label: "Wed" }),
                ]}
                rowKey={r => r.name}
                rowHeader="Resource"
                rowSublabel={r => r.role}
                groupBy={r => r.team}
                cell={(r, col) => Matrix.cell({ segments: [
                    Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                    Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                ] })}
                legend={[{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }]}
                maxHeight="140"
            />
        );
    }),
    inputs: [],
});
