/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, DictType, East, FloatType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Configurator, Matrix, Reactive, SegmentGroup, Select, Slider, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const MATRIX_SEGMENTS_DATA = [
    { sprint: "Sprint 1", committed: new Map([["design", 0.50], ["dev", 0.70], ["qa", 0.30]]), pending: new Map([["design", 0.30], ["dev", 0.20], ["qa", 0.40]]) },
    { sprint: "Sprint 2", committed: new Map([["design", 0.45], ["dev", 0.80], ["qa", 0.25]]), pending: new Map([["design", 0.35], ["dev", 0.15], ["qa", 0.35]]) },
];
const MATRIX_MARKERS_DATA = [
    { name: "Alice", role: "PM", booked: new Map([["mon", 0.80], ["tue", 0.50], ["wed", 1.00]]) },
    { name: "Bob", role: "Design", booked: new Map([["mon", 0.35], ["tue", 1.00], ["wed", 0.60]]) },
];
const MATRIX_POPOVER_DATA = [{ name: "Alice", booked: new Map([["mon", 0.7], ["tue", 0.4]]) }];
const MATRIX_BOUNDED_DATA = [
    { name: "Alice", role: "Senior PM", team: "Web", booked: new Map([["mon", 0.45], ["tue", 0.70], ["wed", 0.85]]) },
    { name: "Bob", role: "Designer", team: "Web", booked: new Map([["mon", 0.35], ["tue", 0.60], ["wed", 0.30]]) },
    { name: "Carol", role: "Engineer", team: "Batch", booked: new Map([["mon", 0.55], ["tue", 0.40], ["wed", 0.90]]) },
    { name: "Dan", role: "Engineer", team: "Batch", booked: new Map([["mon", 0.25], ["tue", 0.80], ["wed", 0.50]]) },
];
const MATRIX_FILL_DATA = East.Array.range(0n, 200n).map((_$, i) => ({
    name: East.str`Res ${i}`,
    role: "Engineer",
    team: i.lessThan(100n).ifElse(() => "Web", () => "Batch"),
    booked: East.value(new Map([["mon", 0.45], ["tue", 0.7], ["wed", 0.85]]), DictType(StringType, FloatType)),
}));

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

export const matrixVariants = example({
    keywords: ["Matrix", "segment", "committed", "pending", "slack", "drag", "resize", "onSegmentChange", "minLabelSize", "weight", "allocation", "vertical", "orientation", "capacity", "stacked", "utilization", "bar", "marker", "status", "ring", "corner", "tooltip", "danger", "warning", "overbooked", "popover", "click", "detail", "onCellClick", "reactive", "bind", "onSegmentChange", "adjust", "edit", "controlled", "pivot", "data-driven", "threshold", "filter", "maxHeight", "bounded", "fill", "#320", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Matrix configurator — a cell-preset axis (segments / markers / popover / adjust / pivot / bounded / fill) and an orientation axis driving one live allocation grid",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Enumerated axes are just their variants — `getTag()` gives the
            // segment key AND its label, so there is no parallel table to
            // keep in step.
            const orientations = $.const([
                variant("horizontal", null), variant("vertical", null),
            ], ArrayType(Matrix.Types.Orientation));

            // Each preset is its own build-time cell config (segment stacks,
            // corner markers, click popovers, the two reactive contracts and
            // the two #320 sizing arms), so the axis routes between complete
            // matrices over the same orientation override.
            const presets = $.const(["segments", "markers", "popover", "adjust", "pivot", "bounded", "fill"], ArrayType(StringType));

            const presetBind      = $.let(State.bind([StringType], "matrix_preset", "segments"));
            const orientationBind = $.let(State.bind([StringType], "matrix_orientation", "horizontal"));

            const pKey = $.let(presetBind.read());
            const oKey = $.let(orientationBind.read());

            const onPreset      = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));

            // Each selection is a lookup into the same array the control renders.
            const orientation = $.let(orientations.filter((_$, v) => v.getTag().equal(oKey)).get(0n));

            // Root `orientation` is a build-time literal, but the per-cell
            // override is a live value — every cell carries the selected
            // orientation, which is exactly what the root default would set.
            const segments = $.const(
                <Matrix
                    data={MATRIX_SEGMENTS_DATA}
                    columns={[
                        Matrix.column({ key: "design", label: "Design" }),
                        Matrix.column({ key: "dev", label: "Development" }),
                        Matrix.column({ key: "qa", label: "QA" }),
                    ]}
                    rowKey={r => r.sprint}
                    rowHeader="Sprint"
                    minLabelSize={28.0}
                    cell={(r, col) => Matrix.cell({ orientation, segments: [
                        Matrix.segment({ fill: "success", weight: r.committed.get(col.key), label: East.str`${r.committed.get(col.key).multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                        Matrix.segment({ fill: "warning", weight: r.pending.get(col.key), label: East.str`${r.pending.get(col.key).multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                        Matrix.segment({ fill: "slack", weight: East.value(1.0, FloatType).subtract(r.committed.get(col.key)).subtract(r.pending.get(col.key)) }),
                    ] })}
                    legend={[{ fill: "success", label: "Committed" }, { fill: "warning", label: "Pending" }, { fill: "slack", label: "Slack" }]}
                    onSegmentChange={East.function([Matrix.Types.SegmentChangeEvent], NullType, _$ => null)}
                />,
            );
            const markers = $.const(
                <Matrix
                    data={MATRIX_MARKERS_DATA}
                    columns={[
                        Matrix.column({ key: "mon", label: "Mon" }),
                        Matrix.column({ key: "tue", label: "Tue" }),
                        Matrix.column({ key: "wed", label: "Wed" }),
                    ]}
                    rowKey={r => r.name}
                    rowHeader="Resource"
                    rowSublabel={r => r.role}
                    cell={(r, col) => Matrix.cell({
                        orientation,
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
                />,
            );
            const popover = $.const(
                <Matrix
                    data={MATRIX_POPOVER_DATA}
                    columns={[
                        Matrix.column({ key: "mon", label: "Mon" }),
                        Matrix.column({ key: "tue", label: "Tue" }),
                    ]}
                    rowKey={r => r.name}
                    rowHeader="Resource"
                    cell={(r, col) => Matrix.cell({
                        orientation,
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
                />,
            );
            // ADJUST — dragging the committed segment fires onSegmentChange,
            // which writes the new weight to bound State; the cell reads it
            // back, so the grid is fully controlled.
            const committedBind = $.let(State.bind([FloatType], "matrix_adjust_committed", 0.5));
            const committed = $.let(committedBind.read());
            const adjustData = $.const([{ team: "Squad", load: committed }], ArrayType(StructType({ team: StringType, load: FloatType })));
            const onSegmentChange = $.const(East.function([Matrix.Types.SegmentChangeEvent], NullType, ($, e) => {
                $(committedBind.write(e.weight));
            }));
            const adjust = $.const(
                <Matrix
                    data={adjustData}
                    columns={[
                        Matrix.column({ key: "load", label: "Allocation" }),
                    ]}
                    rowKey={r => r.team}
                    rowHeader="Squad"
                    cell={(r, _col) => Matrix.cell({ orientation, segments: [
                        Matrix.segment({ fill: "success", weight: r.load, label: East.str`${r.load.multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                        Matrix.segment({ fill: "slack", weight: East.value(1.0, FloatType).subtract(r.load) }),
                    ] })}
                    onSegmentChange={onSegmentChange}
                />,
            );

            // PIVOT — both axes derive from the surviving cell records; the
            // threshold slider drops low bookings and whole rows / columns
            // appear and disappear with them.
            const BookingArrayType = ArrayType(StructType({ resource: StringType, day: StringType, load: FloatType }));
            const bookings = $.const([
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
            const onThreshold = $.const(East.function([FloatType], NullType, ($, next) => {
                $(thresholdBind.write(next));
            }));
            const kept = $.let(bookings.filter(($, b) => b.load.greaterEqual(threshold)));
            const dayKeys = $.let(kept.toSet(($, b) => b.day).toArray());
            const resourceKeys = $.let(kept.toSet(($, b) => b.resource).toArray());
            const pivot = $.const(
                <VStack gap="3" align="stretch">
                    <Slider value={threshold} min={0} max={1} step={0.05} onChange={onThreshold} />
                    {<Text.MonoLabel>{East.str`THRESHOLD ${East.print(threshold)} · ${resourceKeys.size()} ROWS × ${dayKeys.size()} COLS`}</Text.MonoLabel>}
                    <Matrix
                        data={resourceKeys.map(($, name) => ({
                            name,
                            loads: dayKeys.toDict(
                                ($, day) => day,
                                ($, day) => kept.filter(($, b) => b.resource.equal(name).and(() => b.day.equal(day))).sum(($, b) => b.load),
                            ),
                        }))}
                        columns={dayKeys.map(($, day) => Matrix.column({ key: day, label: day }))}
                        rowKey={r => r.name}
                        rowHeader="Resource"
                        cell={(r, col) => Matrix.cell({ orientation, segments: [
                            Matrix.segment({ fill: "brand", weight: r.loads.get(col.key), label: East.str`${r.loads.get(col.key).multiply(100.0)}%` }),
                            Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.loads.get(col.key)) }),
                        ] })}
                        legend={[{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }]}
                    />
                </VStack>,
            );

            // BOUNDED / FILL (#320) — a bare-number maxHeight caps the grid;
            // height="fill" resolves against the bounded Box and virtualizes.
            const bounded = $.const(
                <Matrix
                    data={MATRIX_BOUNDED_DATA}
                    columns={[
                        Matrix.column({ key: "mon", label: "Mon" }),
                        Matrix.column({ key: "tue", label: "Tue" }),
                        Matrix.column({ key: "wed", label: "Wed" }),
                    ]}
                    rowKey={r => r.name}
                    rowHeader="Resource"
                    rowSublabel={r => r.role}
                    groupBy={r => r.team}
                    cell={(r, col) => Matrix.cell({ orientation, segments: [
                        Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                    ] })}
                    legend={[{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }]}
                    maxHeight="140"
                />,
            );
            const fillArm = $.const(
                <Box height="200px">
                    <Matrix
                        data={MATRIX_FILL_DATA}
                        columns={[
                            Matrix.column({ key: "mon", label: "Mon" }),
                            Matrix.column({ key: "tue", label: "Tue" }),
                            Matrix.column({ key: "wed", label: "Wed" }),
                        ]}
                        rowKey={r => r.name}
                        rowHeader="Resource"
                        rowSublabel={r => r.role}
                        groupBy={r => r.team}
                        cell={(r, col) => Matrix.cell({ orientation, segments: [
                            Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                            Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                        ] })}
                        legend={[{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }]}
                        height="fill"
                    />
                </Box>,
            );

            const grid = $.const(pKey.equal("markers").ifElse(
                _$ => markers,
                _$ => pKey.equal("popover").ifElse(
                    _$ => popover,
                    _$ => pKey.equal("adjust").ifElse(
                        _$ => adjust,
                        _$ => pKey.equal("pivot").ifElse(
                            _$ => pivot,
                            _$ => pKey.equal("bounded").ifElse(
                                _$ => bounded,
                                _$ => pKey.equal("fill").ifElse(_$ => fillArm, _$ => segments),
                            ),
                        ),
                    ),
                ),
            ), UIComponentType);

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Preset", pKey,
                            <Select value={pKey} onChange={onPreset} size="sm"
                                items={presets.map((_$, p) => Select.Item(p, p))} />),
                        Configurator.Control("Orientation", oKey,
                            <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                items={orientations.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                    ]}
                    preview={grid}
                    spec={[
                        Configurator.Spec("Committed", East.str`${committed.multiply(100.0)}%`),
                        Configurator.Spec("Pivot", East.str`${East.print(resourceKeys.size())} rows`),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
