/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, FloatType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Configurator, Matrix, Reactive, SegmentGroup, Slider, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures (consolidation epic #455, pass 5 — one live instance
// per configurator; the controlled and pivot contracts are their own
// examples).
// ============================================================================

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
 * THE Matrix configurator (pass 5) — ONE live 200-row allocation grid: the
 * orientation axis feeds every cell's orientation override, the size axis
 * feeds the maxHeight / height expressions (auto / bounded scroll / fill — an
 * empty size reads as unbounded), markers fire from the DATA (overbooked
 * cells), every cell composes a click popover, and segment drags log to the
 * aside.
 */
export const matrixVariants = example({
    keywords: ["Matrix", "segment", "drag", "resize", "onSegmentChange", "minLabelSize", "weight", "allocation", "vertical", "orientation", "capacity", "stacked", "utilization", "bar", "marker", "status", "ring", "corner", "tooltip", "danger", "warning", "overbooked", "popover", "click", "detail", "onCellClick", "maxHeight", "bounded", "fill", "#320", "group", "groupBy", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "Matrix configurator — orientation and size axes on one live 200-row grid; markers fire from the data, popovers compose on every cell, segment drags log to the aside",
    fn: East.function([], UIComponentType, (_$) => {
        const MATRIX_BOOKED_SHAPES = [
            new Map([["mon", 0.45], ["tue", 0.70], ["wed", 0.85]]),
            new Map([["mon", 0.90], ["tue", 0.30], ["wed", 0.55]]),
            new Map([["mon", 0.20], ["tue", 0.95], ["wed", 0.40]]),
            new Map([["mon", 0.60], ["tue", 0.50], ["wed", 0.75]]),
        ];
        const MATRIX_GRID_DATA = East.Array.range(0n, 200n).map((_$, i) => ({
            name: East.str`Res ${i}`,
            role: i.remainder(3n).equals(0n).ifElse(() => "Senior PM", () => "Engineer"),
            team: i.lessThan(100n).ifElse(() => "Web", () => "Batch"),
            booked: i.remainder(4n).equals(0n).ifElse(
                () => MATRIX_BOOKED_SHAPES[0]!,
                () => i.remainder(4n).equals(1n).ifElse(
                    () => MATRIX_BOOKED_SHAPES[1]!,
                    () => i.remainder(4n).equals(2n).ifElse(
                        () => MATRIX_BOOKED_SHAPES[2]!,
                        () => MATRIX_BOOKED_SHAPES[3]!,
                    ),
                ),
            ),
        }));
        return (
        <Reactive>{$ => {
            const orientations = $.const([
                variant("horizontal", null), variant("vertical", null),
            ], ArrayType(Matrix.Types.Orientation));
            const sizes = $.const(["auto", "bounded", "fill"], ArrayType(StringType));

            const orientationBind = $.let(State.bind([StringType], "matrix_orientation", "horizontal"));
            const sizeBind = $.let(State.bind([StringType], "matrix_size", "bounded"));
            const lastBind = $.let(State.bind([StringType], "matrix_last_event", ""));

            const oKey = $.let(orientationBind.read());
            const sKey = $.let(sizeBind.read());
            const last = $.let(lastBind.read());

            const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));
            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onSegmentChange = $.const(East.function([Matrix.Types.SegmentChangeEvent], NullType, ($, e) => {
                $(lastBind.write(East.str`onSegmentChange: weight ${East.print(e.weight)}`));
            }));
            const onCellClick = $.const(East.function([Matrix.Types.CellClickEvent], NullType, ($, e) => {
                $(lastBind.write(East.str`onCellClick: ${e.row} · ${e.column}`));
            }));

            // Each selection is a lookup into the same array the control renders.
            const orientation = $.let(orientations.filter((_$, v) => v.getTag().equal(oKey)).get(0n));

            // An empty size string reads as "unbounded"; the wrapper Box only
            // bounds in fill mode.
            const boxHeight = $.let(sKey.equal("fill").ifElse(_$ => "200px", _$ => ""));
            const gridMaxHeight = $.let(sKey.equal("bounded").ifElse(_$ => "240", _$ => ""));
            const gridHeight = $.let(sKey.equal("fill").ifElse(_$ => "fill", _$ => ""));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Orientation", oKey,
                            <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                items={orientations.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                    ]}
                    preview={
                        <Box width="100%" height={boxHeight} overflow="hidden">
                            <Matrix
                                data={MATRIX_GRID_DATA}
                                columns={[
                                    Matrix.column({ key: "mon", label: "Mon" }),
                                    Matrix.column({ key: "tue", label: "Tue" }),
                                    Matrix.column({ key: "wed", label: "Wed" }),
                                ]}
                                rowKey={r => r.name}
                                rowHeader="Resource"
                                rowSublabel={r => r.role}
                                groupBy={r => r.team}
                                minLabelSize={28.0}
                                cell={(r, col) => Matrix.cell({
                                    orientation,
                                    segments: [
                                        Matrix.segment({ fill: "brand", weight: r.booked.get(col.key), label: East.str`${r.booked.get(col.key).multiply(100.0)}%`, min: 0.0, max: 1.0, step: 0.05 }),
                                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                                    ],
                                    // Data-driven markers: the single overbooked marker survives
                                    // the filter only where the booking crosses the threshold.
                                    markers: East.value([Matrix.marker({
                                        status: r.booked.get(col.key).greaterEqual(0.85).ifElse(
                                            (_$: unknown) => variant("danger", null),
                                            (_$: unknown) => variant("warning", null),
                                        ),
                                        message: East.str`${r.booked.get(col.key).multiply(100.0)}% booked`,
                                        at: "tr",
                                    })], ArrayType(Matrix.Types.Marker)).filter((_$, _m) => r.booked.get(col.key).greaterEqual(0.7)),
                                    popover: (
                                        <VStack gap="1">
                                            <Text fontWeight="semibold">Allocation</Text>
                                            <Text color="fg.muted">{East.str`${r.booked.get(col.key).multiply(100.0)}% booked`}</Text>
                                        </VStack>
                                    ),
                                })}
                                legend={[{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }]}
                                onSegmentChange={onSegmentChange}
                                onCellClick={onCellClick}
                                maxHeight={gridMaxHeight}
                                height={gridHeight}
                            />
                        </Box>
                    }
                    aside={{
                        label: "Events · Reactive",
                        body: (
                            <Badge colorPalette="brand" variant="outline">
                                {East.equal(last.length(), 0n).ifElse(_$ => "Drag a segment or click a cell", _$ => last)}
                            </Badge>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Rows", "200 · grouped"),
                    ]}
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});

/**
 * Controlled grid — dragging the committed segment fires `onSegmentChange`,
 * which writes the new weight to bound State; the cell reads it back.
 */
export const matrixAdjust = example({
    keywords: ["Matrix", "onSegmentChange", "adjust", "edit", "controlled", "drag", "resize", "State", "Reactive", "bind"],
    description: "Controlled allocation — dragging the committed segment writes State and the cell reads it back",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const committedBind = $.let(State.bind([FloatType], "matrix_adjust_committed", 0.5));
            const committed = $.let(committedBind.read());
            const adjustData = $.const([{ team: "Squad", load: committed }], ArrayType(StructType({ team: StringType, load: FloatType })));
            const onSegmentChange = $.const(East.function([Matrix.Types.SegmentChangeEvent], NullType, ($, e) => {
                $(committedBind.write(e.weight));
            }));
            return (
                <VStack gap="2" align="stretch">
                    <Matrix
                        data={adjustData}
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
                    <Text.MonoLabel>{East.str`COMMITTED · ${East.print(committed.multiply(100.0))}%`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Pivot — both axes derive from the surviving cell records; the threshold
 * slider drops low bookings and whole rows / columns appear and disappear
 * with them.
 */
export const matrixPivot = example({
    keywords: ["Matrix", "pivot", "data-driven", "derive", "threshold", "filter", "Slider", "Reactive", "State"],
    description: "Pivot grid — rows and columns derive from filtered records; the threshold slider reshapes both axes",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
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
            return (
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
