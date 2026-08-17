/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, StringType, PatchType, StructType, some, variant, example } from "@elaraai/east";
import { Button, EventStateType, Input, Plan, Reactive, Separator, Slider, Stat, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";

export const thresholdInput      = e3.input('threshold',       FloatType, 50.0);
export const thresholdPatchInput = e3.input('threshold_patch', PatchType(FloatType), variant("unchanged", null));
export const countInput          = e3.input('count', IntegerType, 0n);
export const nameInput           = e3.input('name',  StringType,  '');

// Lifecycle shorthands, so a stored row fits on one line. These are plain
// `EventStateType` values — the shared contracts vocabulary a plan dataset
// stores, not display strings.
const ACTUAL    = variant("actual", null);
const RUNNING   = variant("in-progress", null);
const CONFIRMED = variant("confirmed", null);
const PROPOSED  = variant("proposed", variant("recommended", null));
const ESTIMATED = variant("estimated", null);

/**
 * The RAW ops row — deliberately FLAT and scalar: an id, its line, a batch
 * code, the job's window as a start week + a duration, its tonnage, a
 * utilisation reading, and the lifecycle state. No dates, no nested elements,
 * no display strings; one line per row in the dataset.
 *
 * Everything the canvas shows — the run bars, their labels, quantities, the
 * per-week load cells — is DERIVED from these scalars by the series
 * accessors, client-side, per window. That is the whole point of the split:
 * the wire carries the cheapest honest record, and the reading of it lives in
 * the series.
 */
export const OpsRow = StructType({
    line:      StringType,
    batch:     StringType,
    /** ISO week the job starts (2026); the series turns it into an instant. */
    startWeek: IntegerType,
    /** Duration in weeks. */
    weeks:     IntegerType,
    tonnes:    FloatType,
    /** % utilisation, which the load series expands into a weekly strip. */
    load:      FloatType,
    state:     EventStateType,
});
/**
 * The seeded ops schedule — an `e3.input`'s default IS the dataset's initial
 * value, so this is what a freshly-deployed workspace (and the offline
 * snapshot harness) serves windows out of. Sixty rows across five production
 * lines plus a dock's load readings: enough that reading it by window is the
 * obvious thing to do, and small enough to read here.
 *
 * Work moves left-to-right through the ladder as it approaches the now-line —
 * observed at the back, in-progress across it, confirmed then proposed then
 * estimated ahead of it.
 */
export const opsInput = e3.input('ops', DictType(StringType, OpsRow), new Map([
    ["L1-M01", { line: "Line 1", batch: "B-201", startWeek: 25n, weeks: 3n, tonnes: 96.0,  load: 78.0, state: ACTUAL }],
    ["L1-M02", { line: "Line 1", batch: "B-204", startWeek: 26n, weeks: 2n, tonnes: 64.0,  load: 71.0, state: ACTUAL }],
    ["L1-M03", { line: "Line 1", batch: "B-214", startWeek: 28n, weeks: 3n, tonnes: 112.0, load: 88.0, state: RUNNING }],
    ["L1-M04", { line: "Line 1", batch: "B-208", startWeek: 27n, weeks: 4n, tonnes: 104.0, load: 84.0, state: RUNNING }],
    ["L1-M05", { line: "Line 1", batch: "B-219", startWeek: 31n, weeks: 3n, tonnes: 88.0,  load: 66.0, state: CONFIRMED }],
    ["L1-M06", { line: "Line 1", batch: "B-223", startWeek: 32n, weeks: 2n, tonnes: 72.0,  load: 59.0, state: CONFIRMED }],
    ["L1-M07", { line: "Line 1", batch: "B-231", startWeek: 33n, weeks: 4n, tonnes: 120.0, load: 92.0, state: PROPOSED }],
    ["L1-M08", { line: "Line 1", batch: "B-236", startWeek: 35n, weeks: 3n, tonnes: 96.0,  load: 74.0, state: PROPOSED }],
    ["L1-M09", { line: "Line 1", batch: "B-242", startWeek: 36n, weeks: 3n, tonnes: 80.0,  load: 63.0, state: ESTIMATED }],
    ["L1-M10", { line: "Line 1", batch: "B-247", startWeek: 37n, weeks: 2n, tonnes: 56.0,  load: 48.0, state: ESTIMATED }],

    ["L2-M01", { line: "Line 2", batch: "B-302", startWeek: 25n, weeks: 4n, tonnes: 118.0, load: 91.0, state: ACTUAL }],
    ["L2-M02", { line: "Line 2", batch: "B-307", startWeek: 27n, weeks: 2n, tonnes: 52.0,  load: 55.0, state: ACTUAL }],
    ["L2-M03", { line: "Line 2", batch: "B-311", startWeek: 29n, weeks: 3n, tonnes: 92.0,  load: 80.0, state: RUNNING }],
    ["L2-M04", { line: "Line 2", batch: "B-316", startWeek: 30n, weeks: 2n, tonnes: 68.0,  load: 61.0, state: CONFIRMED }],
    ["L2-M05", { line: "Line 2", batch: "B-320", startWeek: 31n, weeks: 4n, tonnes: 128.0, load: 96.0, state: CONFIRMED }],
    ["L2-M06", { line: "Line 2", batch: "B-325", startWeek: 33n, weeks: 3n, tonnes: 84.0,  load: 69.0, state: PROPOSED }],
    ["L2-M07", { line: "Line 2", batch: "B-329", startWeek: 34n, weeks: 2n, tonnes: 60.0,  load: 52.0, state: PROPOSED }],
    ["L2-M08", { line: "Line 2", batch: "B-334", startWeek: 35n, weeks: 4n, tonnes: 112.0, load: 87.0, state: PROPOSED }],
    ["L2-M09", { line: "Line 2", batch: "B-338", startWeek: 37n, weeks: 3n, tonnes: 76.0,  load: 64.0, state: ESTIMATED }],
    ["L2-M10", { line: "Line 2", batch: "B-343", startWeek: 38n, weeks: 2n, tonnes: 48.0,  load: 44.0, state: ESTIMATED }],

    ["L3-M01", { line: "Line 3", batch: "B-401", startWeek: 24n, weeks: 3n, tonnes: 88.0,  load: 73.0, state: ACTUAL }],
    ["L3-M02", { line: "Line 3", batch: "B-405", startWeek: 26n, weeks: 4n, tonnes: 124.0, load: 94.0, state: ACTUAL }],
    ["L3-M03", { line: "Line 3", batch: "B-410", startWeek: 29n, weeks: 2n, tonnes: 56.0,  load: 51.0, state: RUNNING }],
    ["L3-M04", { line: "Line 3", batch: "B-414", startWeek: 30n, weeks: 3n, tonnes: 100.0, load: 82.0, state: RUNNING }],
    ["L3-M05", { line: "Line 3", batch: "B-419", startWeek: 32n, weeks: 2n, tonnes: 72.0,  load: 62.0, state: CONFIRMED }],
    ["L3-M06", { line: "Line 3", batch: "B-424", startWeek: 33n, weeks: 4n, tonnes: 116.0, load: 90.0, state: CONFIRMED }],
    ["L3-M07", { line: "Line 3", batch: "B-428", startWeek: 35n, weeks: 3n, tonnes: 92.0,  load: 76.0, state: PROPOSED }],
    ["L3-M08", { line: "Line 3", batch: "B-433", startWeek: 36n, weeks: 2n, tonnes: 64.0,  load: 57.0, state: PROPOSED }],
    ["L3-M09", { line: "Line 3", batch: "B-437", startWeek: 37n, weeks: 4n, tonnes: 108.0, load: 85.0, state: ESTIMATED }],
    ["L3-M10", { line: "Line 3", batch: "B-441", startWeek: 39n, weeks: 2n, tonnes: 44.0,  load: 41.0, state: ESTIMATED }],

    ["L4-M01", { line: "Line 4", batch: "B-502", startWeek: 25n, weeks: 2n, tonnes: 60.0,  load: 54.0, state: ACTUAL }],
    ["L4-M02", { line: "Line 4", batch: "B-506", startWeek: 27n, weeks: 3n, tonnes: 96.0,  load: 79.0, state: ACTUAL }],
    ["L4-M03", { line: "Line 4", batch: "B-511", startWeek: 28n, weeks: 4n, tonnes: 132.0, load: 98.0, state: RUNNING }],
    ["L4-M04", { line: "Line 4", batch: "B-515", startWeek: 31n, weeks: 2n, tonnes: 68.0,  load: 60.0, state: CONFIRMED }],
    ["L4-M05", { line: "Line 4", batch: "B-520", startWeek: 32n, weeks: 3n, tonnes: 104.0, load: 83.0, state: CONFIRMED }],
    ["L4-M06", { line: "Line 4", batch: "B-524", startWeek: 34n, weeks: 2n, tonnes: 76.0,  load: 67.0, state: PROPOSED }],
    ["L4-M07", { line: "Line 4", batch: "B-529", startWeek: 35n, weeks: 4n, tonnes: 120.0, load: 93.0, state: PROPOSED }],
    ["L4-M08", { line: "Line 4", batch: "B-533", startWeek: 37n, weeks: 3n, tonnes: 84.0,  load: 70.0, state: ESTIMATED }],
    ["L4-M09", { line: "Line 4", batch: "B-538", startWeek: 38n, weeks: 2n, tonnes: 52.0,  load: 47.0, state: ESTIMATED }],
    ["L4-M10", { line: "Line 4", batch: "B-542", startWeek: 39n, weeks: 3n, tonnes: 88.0,  load: 72.0, state: ESTIMATED }],

    ["L5-M01", { line: "Line 5", batch: "B-601", startWeek: 24n, weeks: 4n, tonnes: 110.0, load: 86.0, state: ACTUAL }],
    ["L5-M02", { line: "Line 5", batch: "B-605", startWeek: 26n, weeks: 2n, tonnes: 58.0,  load: 53.0, state: ACTUAL }],
    ["L5-M03", { line: "Line 5", batch: "B-609", startWeek: 28n, weeks: 3n, tonnes: 94.0,  load: 77.0, state: RUNNING }],
    ["L5-M04", { line: "Line 5", batch: "B-613", startWeek: 30n, weeks: 4n, tonnes: 126.0, load: 95.0, state: RUNNING }],
    ["L5-M05", { line: "Line 5", batch: "B-618", startWeek: 32n, weeks: 2n, tonnes: 70.0,  load: 61.0, state: CONFIRMED }],
    ["L5-M06", { line: "Line 5", batch: "B-622", startWeek: 33n, weeks: 3n, tonnes: 98.0,  load: 81.0, state: CONFIRMED }],
    ["L5-M07", { line: "Line 5", batch: "B-627", startWeek: 35n, weeks: 2n, tonnes: 66.0,  load: 58.0, state: PROPOSED }],
    ["L5-M08", { line: "Line 5", batch: "B-631", startWeek: 36n, weeks: 4n, tonnes: 114.0, load: 89.0, state: PROPOSED }],
    ["L5-M09", { line: "Line 5", batch: "B-636", startWeek: 38n, weeks: 3n, tonnes: 82.0,  load: 68.0, state: ESTIMATED }],
    ["L5-M10", { line: "Line 5", batch: "B-640", startWeek: 39n, weeks: 2n, tonnes: 50.0,  load: 45.0, state: ESTIMATED }],

    // The dock's berths — carried as the same flat row, but read as weekly
    // load strips rather than run bars (see the `load` series below).
    ["D-01", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 46.0, state: CONFIRMED }],
    ["D-02", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 58.0, state: CONFIRMED }],
    ["D-03", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 67.0, state: CONFIRMED }],
    ["D-04", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 74.0, state: CONFIRMED }],
    ["D-05", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 81.0, state: CONFIRMED }],
    ["D-06", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 88.0, state: CONFIRMED }],
    ["D-07", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 93.0, state: CONFIRMED }],
    ["D-08", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 97.0, state: CONFIRMED }],
    ["D-09", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 64.0, state: CONFIRMED }],
    ["D-10", { line: "Docks", batch: "—", startWeek: 27n, weeks: 12n, tonnes: 0.0, load: 52.0, state: CONFIRMED }],
]));

export const dataBindFloat = example({
    keywords: ["Data", "bind", "Reactive", "Float", "dataset", "read"],
    description: "Bind to a Float dataset and display its current value",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind(thresholdInput));
            const value = $.let(thresh.read());
            return <Stat label="Threshold" value={value} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindVariants = example({
    keywords: ["Data", "bind", "Reactive", "Slider", "onChange", "write", "interactive", "Integer", "Input", "String", "callback", "Button", "reset", "has", "guard", "conditional"],
    description: "Direct-bind variant panel — SLIDER WRITEBACK: a Slider whose value is bound to a dataset, onChange writes back; INTEGER: an Integer dataset bound to a number input with writeback; STRING RESET: a String dataset with a reset button that writes an empty string; HAS GUARD: has() gates UI on whether a dataset has been written",
    fn: East.function([], UIComponentType, (_$) => (
        <VStack gap="4" align="stretch">
            <Separator label="SLIDER WRITEBACK" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput));
                const value = $.let(thresh.read());
                return (
                    <Slider
                        value={value}
                        min={0}
                        max={100}
                        onChangeEnd={thresh.writeAndStart}
                        disabled={thresh.status().hasTag('stale')}
                    />
                );
            }}</Reactive>
            <Separator label="INTEGER" align="start" />
            <Reactive>{$ => {
                const count = $.let(Data.bind(countInput));
                const value = $.let(count.read());
                return <Input.Integer value={value} onChange={count.write} />;
            }}</Reactive>
            <Separator label="STRING RESET" align="start" />
            <Reactive>{$ => {
                const name = $.let(Data.bind(nameInput));
                const value = $.let(name.read());
                const reset = $.const(East.function([], NullType, $ => {
                    $(name.write(""));
                }));
                return (
                    <VStack gap="3" align="stretch">
                        <Stat label="Name" value={value} />
                        <Button variant="outline" onClick={reset}>Reset</Button>
                    </VStack>
                );
            }}</Reactive>
            <Separator label="HAS GUARD" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput));
                const ready = $.let(thresh.has());
                const message = $.let("(no data)");
                $.if(ready, $ => {
                    $.assign(message, East.print(thresh.read()));
                });
                return <Text>{message}</Text>;
            }}</Reactive>
        </VStack>
    )),
    inputs: [],
});

export const dataBindStagedFloat = example({
    keywords: ["Data", "bindStaged", "Reactive", "Float", "buffered", "transactional"],
    description: "Stage edits to a Float dataset; read returns overlay (buffered or server)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const thresh = $.let(Data.bind(thresholdInput, { mode: "staged" }));
            const value = $.let(thresh.read(), FloatType);
            return <Stat label="Threshold (live)" value={value} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindStagedVariants = example({
    keywords: ["Data", "bindStaged", "Slider", "write", "buffer", "interactive", "commit", "discard", "pending", "transactional", "original", "read", "overlay", "diff"],
    description: "Staged-bind variant panel — STAGED SLIDER WRITE: a Slider whose onChange writes to the staged buffer instead of the server; STAGED COMMIT DISCARD: two buttons that commit or discard the staged buffer for a path; STAGED ORIGINAL VS READ: the server snapshot (original) and the overlay (read) side by side",
    fn: East.function([], UIComponentType, (_$) => (
        <VStack gap="4" align="stretch">
            <Separator label="STAGED SLIDER WRITE" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput, { mode: "staged" }));
                const value = $.let(thresh.read(), FloatType);
                return <Slider value={value} min={0} max={100} onChange={thresh.write} />;
            }}</Reactive>
            <Separator label="STAGED COMMIT DISCARD" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput, { mode: "staged" }));
                const commit = $.const(East.function([], NullType, $ => {
                    $(thresh.commit());
                }), FunctionType([], NullType));
                const discard = $.const(East.function([], NullType, $ => {
                    $(thresh.discard());
                }), FunctionType([], NullType));
                return (
                    <VStack gap="3" align="stretch">
                        <Text>Pending edits</Text>
                        <Button onClick={commit}>Commit</Button>
                        <Button variant="outline" onClick={discard}>Discard</Button>
                    </VStack>
                );
            }}</Reactive>
            <Separator label="STAGED ORIGINAL VS READ" align="start" />
            <Reactive>{$ => {
                const thresh = $.let(Data.bind(thresholdInput, { mode: "staged", patch: thresholdPatchInput }));
                const live = $.let(thresh.read(), FloatType);
                const server = $.let(thresh.source(), FloatType);
                return (
                    <VStack gap="3" align="stretch">
                        <Stat label="Server" value={server} />
                        <Stat label="Live (with stage)" value={live} />
                    </VStack>
                );
            }}</Reactive>
        </VStack>
    )),
    inputs: [],
});

export const dataBindPagedPlan = example({
    keywords: [
        "Data", "bindPaged", "paged", "page", "total", "window", "windows", "Plan",
        "canvas", "series", "collection", "large", "dataset", "Reactive", "stream",
    ],
    description: "Bind a collection dataset BY WINDOW and hand it straight to a Plan — `Data.bindPaged(ops)` returns a `{ page, total }` handle the canvas consumes structurally, and the factory wraps `page` with the series' row-building functions so each window's rows become canvas rows client-side. The stored rows are FLAT scalars (a start week, a duration, a tonnage, a load reading); the series expressions do the reading — week arithmetic turns indices into instants, one job becomes a setup bar plus its run, and `East.Array.generate` expands a single load figure into a twelve-week heat strip. The dataset is never fetched whole and nothing here touches bytes, offsets or beast2",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The paged handle — the dataset's element type comes from the def,
            // so `page(offset, limit)` is typed Option<Array<OpsRow>> with no
            // decode step to write.
            const paged = $.let(Data.bindPaged(opsInput));
            // Monday of ISO week n, 2026 (W1 Monday = 2025-12-29). The stored
            // rows carry week INDICES; instants are the series' business.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const series = $.const([
                // Machines — each flat row becomes TWO bars: a one-week setup
                // ahead of the job, then the run itself, with its label and
                // quantity built from the batch code and tonnage. The line
                // field drives union rollup parents, so the ×k concurrency
                // bands are the renderer's, over rows it was handed a window
                // at a time.
                Plan.series.span(OpsRow, {
                        key: "span", title: "Span",
                    match: r => r.line.equal("Docks").not(),
                    label: (_r, k) => k, id: true,
                    value: r => some(East.str`${East.Float.printFixed(r.tonnes, 0n)} t`),
                    runs: r => [
                        Plan.run({
                            key: East.str`${r.batch}-set`,
                            start: week(r.startWeek.subtract(1n)), end: week(r.startWeek),
                            label: "SET", state: r.state,
                        }),
                        Plan.run({
                            key: r.batch,
                            start: week(r.startWeek), end: week(r.startWeek.add(r.weeks)),
                            label: East.str`RUN · ${r.batch}`,
                            quantity: East.str`${East.Float.printFixed(r.tonnes, 0n)} t`,
                            qty: r.tonnes, state: r.state,
                        }),
                    ],
                    groupBy: [r => r.line], rollup: "union", unit: "t",
                }),
                // Docks — the SAME flat row read as a load strip instead: one
                // scalar `load` expanded by `East.Array.generate` into a cell
                // per week, drifting with a per-berth phase so the strip reads
                // as a real profile rather than a flat band.
                Plan.series.group(OpsRow, { key: "docks", label: "Docks", meta: "10 berths", collapsed: true, summaryAggregate: "mean" }, [
                    Plan.series.heat(OpsRow, {
                        key: "heat-2", title: "Heat",
                        match: r => r.line.equal("Docks"),
                        label: (_r, k) => k, id: true,
                        cells: r => Plan.heatCells(
                            East.Array.generate(12n, Plan.Types.HeatCell, ($, i) => {
                                const drift = $.let(i.toFloat().multiply(2.5).subtract(6.0), FloatType);
                                const value = $.let(r.load.add(drift), FloatType);
                                return {
                                    at: week(r.startWeek.add(i)),
                                    value: some(value),
                                    label: some(East.Float.printFixed(value, 0n)),
                                };
                            }),
                            { min: 0, max: 100, warnAt: 95 },
                        ),
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(OpsRow)));
            const axis = $.const(Plan.axis({
                window: { min: week(24n), max: week(42n) },
                resolution: "week", resolutions: ["month", "week", "day"], now: week(31n),
            }));
            return <Plan axis={axis} data={paged} series={series} />;
        }}</Reactive>
    )),
    inputs: [],
});
