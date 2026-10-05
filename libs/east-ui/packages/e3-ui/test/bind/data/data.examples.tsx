/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, RecursiveType, StringType, PatchType, StructType, none, some, variant, example } from "@elaraai/east";
import { Button, EventStateType, Format, Input, Reactive, Separator, Slider, Stat, Table, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Plan, Sheet } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";

export const thresholdInput      = e3.input('threshold',       FloatType, variant('value', 50.0));
export const thresholdPatchInput = e3.input('threshold_patch', PatchType(FloatType), variant('value', variant("unchanged", null)));
export const countInput          = e3.input('count', IntegerType, variant('value', 0n));
export const nameInput           = e3.input('name',  StringType,  variant('value', ''));

// Lifecycle shorthands, so a stored row fits on one line. These are plain
// `EventStateType` values — the shared contracts vocabulary a plan dataset
// stores, not display strings.
const ACTUAL    = variant("actual", null);
const RUNNING   = variant("in-progress", null);
const CONFIRMED = variant("confirmed", null);
const PROPOSED  = variant("proposed", variant("recommended", null));
const ESTIMATED = variant("estimated", null);

/**
 * The RAW ops row — deliberately FLAT and scalar: a job ticket, the job's
 * window as a start week + a duration, its sheets, a utilisation reading, and
 * the lifecycle state. No dates, no display strings.
 *
 * Everything the canvas shows — the run bars, their labels, quantities, the
 * per-week load cells — is DERIVED from these scalars by the series
 * accessors, client-side, per window. That is the whole point of the split:
 * the wire carries the cheapest honest record, and the reading of it lives in
 * the series.
 */
export const OpsRow = StructType({
    ticket:    StringType,
    /** ISO week the job starts (2026); the series turns it into an instant. */
    startWeek: IntegerType,
    /** Duration in weeks. */
    weeks:     IntegerType,
    sheets:    FloatType,
    /** % utilisation, which the load series expands into a weekly strip. */
    load:      FloatType,
    state:     EventStateType,
});
/** One hall's presses (or the delivery vans), keyed by id. */
export const OpsHall = DictType(StringType, OpsRow);

/**
 * The seeded ops schedule — an `e3.input`'s default IS the dataset's initial
 * value, so this is what a freshly-deployed workspace (and the offline
 * snapshot harness) serves windows out of. Fifty presses across five
 * halls plus ten delivery vans.
 *
 * GROUPED by hall, as the dataflow that produces it would store it: a canvas
 * nests what its data nests, and a paged source is grouped where it is made —
 * in an e3 task — never on the canvas one window at a time (#822).
 *
 * Work moves left-to-right through the ladder as it approaches the now-line —
 * observed at the back, in-progress across it, confirmed then proposed then
 * estimated ahead of it.
 */
export const opsInput = e3.input('ops', DictType(StringType, OpsHall), variant('value', new Map([
    ["Hall 1", new Map([
        ["H1-P01", { ticket: "J-4603", startWeek: 25n, weeks: 3n, sheets: 96.0,  load: 78.0, state: ACTUAL }],
        ["H1-P02", { ticket: "J-4612", startWeek: 26n, weeks: 2n, sheets: 64.0,  load: 71.0, state: ACTUAL }],
        ["H1-P03", { ticket: "J-4642", startWeek: 28n, weeks: 3n, sheets: 112.0, load: 88.0, state: RUNNING }],
        ["H1-P04", { ticket: "J-4624", startWeek: 27n, weeks: 4n, sheets: 104.0, load: 84.0, state: RUNNING }],
        ["H1-P05", { ticket: "J-4657", startWeek: 31n, weeks: 3n, sheets: 88.0,  load: 66.0, state: CONFIRMED }],
        ["H1-P06", { ticket: "J-4669", startWeek: 32n, weeks: 2n, sheets: 72.0,  load: 59.0, state: CONFIRMED }],
        ["H1-P07", { ticket: "J-4693", startWeek: 33n, weeks: 4n, sheets: 120.0, load: 92.0, state: PROPOSED }],
        ["H1-P08", { ticket: "J-4708", startWeek: 35n, weeks: 3n, sheets: 96.0,  load: 74.0, state: PROPOSED }],
        ["H1-P09", { ticket: "J-4726", startWeek: 36n, weeks: 3n, sheets: 80.0,  load: 63.0, state: ESTIMATED }],
        ["H1-P10", { ticket: "J-4741", startWeek: 37n, weeks: 2n, sheets: 56.0,  load: 48.0, state: ESTIMATED }],
    ])],
    ["Hall 2", new Map([
        ["H2-P01", { ticket: "J-4906", startWeek: 25n, weeks: 4n, sheets: 118.0, load: 91.0, state: ACTUAL }],
        ["H2-P02", { ticket: "J-4921", startWeek: 27n, weeks: 2n, sheets: 52.0,  load: 55.0, state: ACTUAL }],
        ["H2-P03", { ticket: "J-4933", startWeek: 29n, weeks: 3n, sheets: 92.0,  load: 80.0, state: RUNNING }],
        ["H2-P04", { ticket: "J-4948", startWeek: 30n, weeks: 2n, sheets: 68.0,  load: 61.0, state: CONFIRMED }],
        ["H2-P05", { ticket: "J-4960", startWeek: 31n, weeks: 4n, sheets: 128.0, load: 96.0, state: CONFIRMED }],
        ["H2-P06", { ticket: "J-4975", startWeek: 33n, weeks: 3n, sheets: 84.0,  load: 69.0, state: PROPOSED }],
        ["H2-P07", { ticket: "J-4987", startWeek: 34n, weeks: 2n, sheets: 60.0,  load: 52.0, state: PROPOSED }],
        ["H2-P08", { ticket: "J-5002", startWeek: 35n, weeks: 4n, sheets: 112.0, load: 87.0, state: PROPOSED }],
        ["H2-P09", { ticket: "J-5014", startWeek: 37n, weeks: 3n, sheets: 76.0,  load: 64.0, state: ESTIMATED }],
        ["H2-P10", { ticket: "J-5029", startWeek: 38n, weeks: 2n, sheets: 48.0,  load: 44.0, state: ESTIMATED }],
    ])],
    ["Hall 3", new Map([
        ["H3-P01", { ticket: "J-5203", startWeek: 24n, weeks: 3n, sheets: 88.0,  load: 73.0, state: ACTUAL }],
        ["H3-P02", { ticket: "J-5215", startWeek: 26n, weeks: 4n, sheets: 124.0, load: 94.0, state: ACTUAL }],
        ["H3-P03", { ticket: "J-5230", startWeek: 29n, weeks: 2n, sheets: 56.0,  load: 51.0, state: RUNNING }],
        ["H3-P04", { ticket: "J-5242", startWeek: 30n, weeks: 3n, sheets: 100.0, load: 82.0, state: RUNNING }],
        ["H3-P05", { ticket: "J-5257", startWeek: 32n, weeks: 2n, sheets: 72.0,  load: 62.0, state: CONFIRMED }],
        ["H3-P06", { ticket: "J-5272", startWeek: 33n, weeks: 4n, sheets: 116.0, load: 90.0, state: CONFIRMED }],
        ["H3-P07", { ticket: "J-5284", startWeek: 35n, weeks: 3n, sheets: 92.0,  load: 76.0, state: PROPOSED }],
        ["H3-P08", { ticket: "J-5299", startWeek: 36n, weeks: 2n, sheets: 64.0,  load: 57.0, state: PROPOSED }],
        ["H3-P09", { ticket: "J-5311", startWeek: 37n, weeks: 4n, sheets: 108.0, load: 85.0, state: ESTIMATED }],
        ["H3-P10", { ticket: "J-5323", startWeek: 39n, weeks: 2n, sheets: 44.0,  load: 41.0, state: ESTIMATED }],
    ])],
    ["Hall 4", new Map([
        ["H4-P01", { ticket: "J-5506", startWeek: 25n, weeks: 2n, sheets: 60.0,  load: 54.0, state: ACTUAL }],
        ["H4-P02", { ticket: "J-5518", startWeek: 27n, weeks: 3n, sheets: 96.0,  load: 79.0, state: ACTUAL }],
        ["H4-P03", { ticket: "J-5533", startWeek: 28n, weeks: 4n, sheets: 132.0, load: 98.0, state: RUNNING }],
        ["H4-P04", { ticket: "J-5545", startWeek: 31n, weeks: 2n, sheets: 68.0,  load: 60.0, state: CONFIRMED }],
        ["H4-P05", { ticket: "J-5560", startWeek: 32n, weeks: 3n, sheets: 104.0, load: 83.0, state: CONFIRMED }],
        ["H4-P06", { ticket: "J-5572", startWeek: 34n, weeks: 2n, sheets: 76.0,  load: 67.0, state: PROPOSED }],
        ["H4-P07", { ticket: "J-5587", startWeek: 35n, weeks: 4n, sheets: 120.0, load: 93.0, state: PROPOSED }],
        ["H4-P08", { ticket: "J-5599", startWeek: 37n, weeks: 3n, sheets: 84.0,  load: 70.0, state: ESTIMATED }],
        ["H4-P09", { ticket: "J-5614", startWeek: 38n, weeks: 2n, sheets: 52.0,  load: 47.0, state: ESTIMATED }],
        ["H4-P10", { ticket: "J-5626", startWeek: 39n, weeks: 3n, sheets: 88.0,  load: 72.0, state: ESTIMATED }],
    ])],
    ["Hall 5", new Map([
        ["H5-P01", { ticket: "J-5803", startWeek: 24n, weeks: 4n, sheets: 110.0, load: 86.0, state: ACTUAL }],
        ["H5-P02", { ticket: "J-5815", startWeek: 26n, weeks: 2n, sheets: 58.0,  load: 53.0, state: ACTUAL }],
        ["H5-P03", { ticket: "J-5827", startWeek: 28n, weeks: 3n, sheets: 94.0,  load: 77.0, state: RUNNING }],
        ["H5-P04", { ticket: "J-5839", startWeek: 30n, weeks: 4n, sheets: 126.0, load: 95.0, state: RUNNING }],
        ["H5-P05", { ticket: "J-5854", startWeek: 32n, weeks: 2n, sheets: 70.0,  load: 61.0, state: CONFIRMED }],
        ["H5-P06", { ticket: "J-5866", startWeek: 33n, weeks: 3n, sheets: 98.0,  load: 81.0, state: CONFIRMED }],
        ["H5-P07", { ticket: "J-5881", startWeek: 35n, weeks: 2n, sheets: 66.0,  load: 58.0, state: PROPOSED }],
        ["H5-P08", { ticket: "J-5893", startWeek: 36n, weeks: 4n, sheets: 114.0, load: 89.0, state: PROPOSED }],
        ["H5-P09", { ticket: "J-5908", startWeek: 38n, weeks: 3n, sheets: 82.0,  load: 68.0, state: ESTIMATED }],
        ["H5-P10", { ticket: "J-5920", startWeek: 39n, weeks: 2n, sheets: 50.0,  load: 45.0, state: ESTIMATED }],
    ])],
    // The delivery vans — the same flat row, read as weekly load strips
    // rather than run bars (see the `vans` series below).
    ["Vans", new Map([
        ["V-01", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 46.0, state: CONFIRMED }],
        ["V-02", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 58.0, state: CONFIRMED }],
        ["V-03", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 67.0, state: CONFIRMED }],
        ["V-04", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 74.0, state: CONFIRMED }],
        ["V-05", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 81.0, state: CONFIRMED }],
        ["V-06", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 88.0, state: CONFIRMED }],
        ["V-07", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 93.0, state: CONFIRMED }],
        ["V-08", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 97.0, state: CONFIRMED }],
        ["V-09", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 64.0, state: CONFIRMED }],
        ["V-10", { ticket: "—", startWeek: 27n, weeks: 12n, sheets: 0.0, load: 52.0, state: CONFIRMED }],
    ])],
])));

/**
 * A maintenance work order — the row of the `work_orders` record, keyed by
 * its order id. The id says nothing about urgency: the order a dispatcher
 * works through comes from the index below, not from the record.
 */
export const WorkOrderRow = StructType({
    site:   StringType,
    title:  StringType,
    crew:   StringType,
    /** `late`, `open` or `planned` — alphabetical order IS urgency order, so
     *  the index sorts the queue with no rank to compute. */
    status: StringType,
    due:    DateTimeType,
});

/** The dispatch queue's sort key: status first, then due date within one. */
export const WorkQueueKey = StructType({ status: StringType, due: DateTimeType });

/**
 * The work orders — a record, so its initial state IS what a freshly deployed
 * workspace holds, and deploy builds its index over it. The ids run in the
 * order the orders were raised, which is nothing like the order they are due.
 */
export const workOrders = e3.record('work_orders', DictType(StringType, WorkOrderRow), new Map([
    ["WO-1001", { site: "North", title: "Replace kiln 2 burner",       crew: "Mech A", status: "planned", due: new Date("2026-10-19T00:00:00Z") }],
    ["WO-1002", { site: "North", title: "Calibrate belt scale 4",      crew: "Inst",   status: "late",    due: new Date("2026-09-15T00:00:00Z") }],
    ["WO-1003", { site: "South", title: "Reline crusher jaw",          crew: "Mech B", status: "open",    due: new Date("2026-09-25T00:00:00Z") }],
    ["WO-1004", { site: "South", title: "Grease stacker bearings",     crew: "Mech B", status: "open",    due: new Date("2026-09-24T00:00:00Z") }],
    ["WO-1005", { site: "Port",  title: "Inspect shiploader boom",     crew: "Struct", status: "late",    due: new Date("2026-09-18T00:00:00Z") }],
    ["WO-1006", { site: "North", title: "Swap conveyor 7 idlers",      crew: "Mech A", status: "open",    due: new Date("2026-09-29T00:00:00Z") }],
    ["WO-1007", { site: "Port",  title: "Test dust suppression pumps", crew: "Elec",   status: "planned", due: new Date("2026-10-06T00:00:00Z") }],
    ["WO-1008", { site: "South", title: "Replace screen deck panels",  crew: "Mech B", status: "late",    due: new Date("2026-09-11T00:00:00Z") }],
    ["WO-1009", { site: "North", title: "Thermal scan MCC room",       crew: "Elec",   status: "open",    due: new Date("2026-09-26T00:00:00Z") }],
    ["WO-1010", { site: "Port",  title: "Rebuild reclaimer gearbox",   crew: "Mech A", status: "planned", due: new Date("2026-10-26T00:00:00Z") }],
    ["WO-1011", { site: "South", title: "Align apron feeder",          crew: "Mech B", status: "open",    due: new Date("2026-10-01T00:00:00Z") }],
    ["WO-1012", { site: "North", title: "Service compressor 2",        crew: "Mech A", status: "late",    due: new Date("2026-09-21T00:00:00Z") }],
    ["WO-1013", { site: "Port",  title: "Weld chute liner",            crew: "Struct", status: "open",    due: new Date("2026-09-30T00:00:00Z") }],
    ["WO-1014", { site: "South", title: "Replace pump 3 impeller",     crew: "Mech B", status: "planned", due: new Date("2026-10-09T00:00:00Z") }],
    ["WO-1015", { site: "North", title: "Relamp stockpile towers",     crew: "Elec",   status: "planned", due: new Date("2026-10-13T00:00:00Z") }],
    ["WO-1016", { site: "Port",  title: "Tension berth 2 belt",        crew: "Mech A", status: "open",    due: new Date("2026-09-24T00:00:00Z") }],
    ["WO-1017", { site: "South", title: "Inspect tailings line",       crew: "Struct", status: "late",    due: new Date("2026-09-22T00:00:00Z") }],
    ["WO-1018", { site: "North", title: "Change kiln 1 seals",         crew: "Mech A", status: "planned", due: new Date("2026-11-02T00:00:00Z") }],
]));

/**
 * The dispatch queue — every work order under `{status, due}`, carrying its
 * title so the queue renders from index pages alone and never reads an
 * order's row.
 */
export const workQueue = e3.recordIndex('by_status', workOrders, {
    key:   East.function([StringType, WorkOrderRow], WorkQueueKey, ($, _id, order) => ({ status: order.status, due: order.due })),
    value: East.function([StringType, WorkOrderRow], StringType, ($, _id, order) => order.title),
});

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
        "grouped", "children", "rollup", "group",
    ],
    description: "Bind a collection dataset BY WINDOW and hand it straight to a Plan — `Data.bindPaged(ops)` returns the paged handle, the row-source contract the canvas recognises by its East type, and the factory wraps `page` with the series' row-building functions so each window's rows become canvas rows client-side. The dataset is GROUPED by hall where it is made (an e3 task), so the canvas nests what the data nests: a hall's span row rolls up the union of its presses' runs, stepped down into with `Plan.children`, and the vans are one collapsed group strip. The stored rows are FLAT scalars (a start week, a duration, a sheet count, a load reading); the series expressions do the reading — week arithmetic turns indices into instants, one job becomes a make-ready bar plus its run, and `East.Array.generate` expands a single load figure into a twelve-week heat strip. The dataset is never fetched whole and nothing here touches bytes, offsets or beast2",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The paged handle — the dataset's element type comes from the def,
            // so `page(offset, limit)` is typed Option<Dict<String, OpsHall>>
            // with no decode step to write.
            const paged = $.let(Data.bindPaged(opsInput));
            // Monday of ISO week n, 2026 (W1 Monday = 2025-12-29). The stored
            // rows carry week INDICES; instants are the series' business.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const series = $.const([
                // Halls — one span row per hall whose own runs are none: it
                // DECLARES a union rollup, so its ×k concurrency bands are the
                // renderer's, over the presses stepped down into from the
                // hall's own entry — exact in every window, since a hall
                // arrives with all of its presses.
                Plan.series.span(OpsHall, {
                    key: "halls", title: "Halls",
                    match: (_h, hall) => hall.equal("Vans").not(),
                    label: (_h, hall) => hall,
                    runs: _l => [],
                    rollup: "union",
                    children: Plan.children((l) => l, [
                        // Presses — each flat row becomes TWO bars: a one-week
                        // make-ready ahead of the job, then the run itself, with its
                        // label and quantity built from the job ticket and sheets
                        // (a quantity carries its unit — the hall's bands sum by it).
                        Plan.series.span(OpsRow, {
                            key: "presses", title: "Presses",
                            label: (_r, k) => k, id: true,
                            value: r => some(East.str`${East.Float.printFixed(r.sheets, 0n)} k sheets`),
                            runs: r => [
                                Plan.run({
                                    key: East.str`${r.ticket}-mr`,
                                    start: week(r.startWeek.subtract(1n)), end: week(r.startWeek),
                                    label: "MAKEREADY", state: r.state,
                                }),
                                Plan.run({
                                    key: r.ticket,
                                    start: week(r.startWeek), end: week(r.startWeek.add(r.weeks)),
                                    label: East.str`RUN · ${r.ticket}`,
                                    quantity: Plan.quantity(r.sheets, { unit: "k sheets", format: Format.Number({ maximumFractionDigits: 0n }) }),
                                    state: r.state,
                                }),
                            ],
                        }),
                    ]),
                }),
                // Vans — one collapsed group strip, its mean derived from the
                // vans it nests: the SAME flat row read as a load strip, one
                // scalar `load` expanded by `East.Array.generate` into a cell
                // per week, drifting with a per-van phase so the strip reads
                // as a real profile rather than a flat band.
                Plan.series.group(OpsHall, {
                    key: "vans", title: "Vans",
                    match: (_h, hall) => hall.equal("Vans"),
                    label: (_h, hall) => hall,
                    collapsed: true, summaryAggregate: "mean",
                    children: Plan.children((l) => l, [
                        Plan.series.heat(OpsRow, {
                            key: "van-load", title: "Van load",
                            label: (_r, k) => k, id: true,
                            cells: r => Plan.heatCells(
                                East.Array.generate(12n, Plan.Types.HeatCell, ($, i) => {
                                    const drift = $.let(i.toFloat().multiply(2.5).subtract(6.0), FloatType);
                                    const value = $.let(r.load.add(drift), FloatType);
                                    // A heat cell is a stored RECORD, so its instant is
                                    // spelled — `Plan.at.time` on the time arm (#631).
                                    return {
                                        at: Plan.at.time(week(r.startWeek.add(i))),
                                        value: some(value),
                                        label: some(East.Float.printFixed(value, 0n)),
                                    };
                                }),
                                { min: 0, max: 100, warnAt: 95 },
                            ),
                        }),
                    ]),
                }),
            ], ArrayType(Plan.Types.Series(OpsHall)));
            const axis = $.const(Plan.axis({
                window: { min: week(24n), max: week(42n) },
                resolution: "week", resolutions: ["month", "week", "day"], now: week(31n),
            }));
            return <Plan.View axis={axis} data={paged} series={series} />;
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindPagedRevision = example({
    keywords: [
        "Data", "bindPaged", "paged", "revision", "refresh", "snapshot", "content hash", "hash", "pinned",
        "follow", "move", "write", "confirmed", "Button", "Reactive",
    ],
    description: "Show which snapshot a paged source reads, and move it after a write — `revision()` is the dataset's content hash every window and search is pinned to (`none` while it is found), so rows from two snapshots never sit side by side; the source follows the dataset on its own, and `refresh(none)` moves it to the dataset's current content at once, from a click after a write the view confirmed",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const paged = $.let(Data.bindPaged(opsInput));
            const snapshot = $.let(paged.revision().match({
                some: (_$, hash) => hash,
                none: _$ => East.str`finding…`,
            }), StringType);
            const refresh = $.const(East.function([], NullType, $ => {
                $(paged.refresh(none));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Stat label="Snapshot" value={snapshot} />
                    <Button variant="outline" onClick={refresh}>Refresh</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const dataBindPagedIndex = example({
    keywords: [
        "Data", "bindPaged", "index", "recordIndex", "record", "secondary index", "queue", "ordered",
        "window", "covering", "projection", "ik", "key", "value", "row", "join", "Table", "paged", "by_status",
    ],
    description: "Read a record THROUGH one of its indexes — `Data.bindPaged(workOrders, { index: workQueue })` serves the INDEX's pages in the index's own order, so the dispatch queue arrives late-first and by due date within each status, whatever the work orders' ids are. Each row is `{ ik, key, value, row }`: the index key, the order's id, and the title the index covers — so the Table renders from index pages alone and reads no order's row (`join: true` would fill `row` from the record too)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Pass the index DECLARATION, not its name: the window's type —
            // its key and what it covers — comes from it.
            const queue = $.let(Data.bindPaged(workOrders, { index: workQueue }));
            return <Table data={queue} columns={{
                ik:    { header: "Due", value: (ik) => East.str`${ik.status} · ${ik.due.printFormatted("ddd D MMM")}` },
                value: { header: "Work order" },
                key:   { header: "Order" },
            }} />;
        }}</Reactive>
    )),
    inputs: [],
});

// ── Several series over one bound source page as blocks (#823) ─────────────
// A canvas is its series list's blocks, one after another — inline and paged
// alike. Two series over one bound dataset are two blocks: each pages on its
// own over the same windows, and one read of a window serves both.

/**
 * How many units the generated schedule holds. A small authored constant: the
 * rows themselves come from {@link unitsTask}, which generates them in the
 * dataflow — a dataset this size is made where data is made, never written
 * into the package.
 */
export const unitCountInput = e3.input('unit_count', IntegerType, variant('value', 3_000n));

/** A generated unit: the weeks it runs, and how many sheets it prints. */
export const UnitRow = StructType({ start: DateTimeType, end: DateTimeType, sheets: FloatType });

/**
 * The units, generated from their count — keyed `U10000`, `U10001`, …: fixed
 * width, so key order is build order. Each runs two weeks, from one of ten
 * consecutive weeks starting at W27, and prints 40 to 119 k sheets.
 */
export const generateUnits = East.function([IntegerType], DictType(StringType, UnitRow), ($, count) => {
    // Monday of ISO week 1, 2026.
    const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
    return East.Array.range(0n, count).toDict(
        (_$, i) => East.str`U${i.add(10_000n)}`,
        ($2, i) => $2.const({
            start: w1.addWeeks(i.remainder(10n).add(26n)),
            end: w1.addWeeks(i.remainder(10n).add(28n)),
            sheets: i.remainder(80n).add(40n).toFloat(),
        }, UnitRow),
    );
});

/** The task that generates the units — its output is the dataset the canvas pages. */
export const unitsTask = e3.task('units', [unitCountInput], generateUnits);

export const dataBindPagedBlocks = example({
    keywords: [
        "Data", "bindPaged", "paged", "task", "e3.task", "generated", "blocks", "block", "several series", "series",
        "layout", "window", "windows", "band", "residency", "rebase", "one read", "transport", "footer", "total",
        "scroll", "virtual", "large", "collection", "keyed", "Dict", "key order", "seek", "key", "prefix",
        "row-source", "contract", "Plan", "canvas", "Reactive",
    ],
    description: "The paged canvas doing the thing it exists for — 3,000 units an `e3.task` generates, bound with `Data.bindPaged(unitsTask)` behind the canvas's 200-element page, so only the opening windows are built into canvas rows and everything below them is ONE band sized from the ledger, captioned with the elements it stands for. Several series over the one source lay out as BLOCKS, exactly as inline (#823): every unit's jobs row, then every unit's loads row, never a window's jobs, then its loads. Each block pages on its own — its own bands, its own resident run following the viewport, its own rebase on a far jump — while one read of a window serves every block. The footer counts in ELEMENTS, never canvas rows, and marks itself partial until the total is known and reached; the source is keyed, so its windows arrive in the dataset's key order and the canvas's key search seeks its own keys",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The units, a window at a time — the task's output dataset, bound
            // through the task def: its path and type come from it.
            const units = $.let(Data.bindPaged(unitsTask));
            // Monday of ISO week n, 2026 — window W27–W39 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const series = $.const([
                Plan.series.span(UnitRow, {
                    key: "jobs", title: "Jobs",
                    label: (_r, k) => k, id: true,
                    value: r => some(East.str`${East.Float.printFixed(r.sheets, 0n)} k sheets`),
                    runs: (r, k) => [Plan.run({
                        key: "run", start: r.start, end: r.end, label: East.str`RUN · ${k}`,
                        quantity: Plan.quantity(r.sheets, { unit: "k sheets", format: Format.Number({ maximumFractionDigits: 0n }) }),
                        state: "actual",
                    })],
                }),
                Plan.series.span(UnitRow, {
                    key: "loads", title: "Loads",
                    label: (_r, k) => East.str`${k} · load`,
                    runs: (r) => [Plan.run({
                        key: "run", start: r.start, end: r.end, label: "LOAD", state: "confirmed",
                    })],
                }),
            ], ArrayType(Plan.Types.Series(UnitRow)));
            // Every canvas DECLARES its window (#822): a paged one could not
            // fit to data that has not landed.
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n),
            }));
            // Bounded, so the canvas virtualizes and each block pages by what is in view.
            return <Plan.View axis={axis} data={units} series={series} style={{ maxHeight: "420px" }} />;
        }}</Reactive>
    )),
    inputs: [],
});

// ── A Table over a bound tree (#954) ────────────────────────────────────────

/** A bill-of-materials part — an assembly holds its parts (#954). `cost` is the
 *  part's extended cost; an assembly's own is 0, and its column shows its
 *  parts' subtotal. */
export const BomPart = RecursiveType((self) => StructType({
    part: StringType,
    sku: StringType,
    qty: IntegerType,
    cost: FloatType,
    parts: ArrayType(self),
}));

/** Two top-level assemblies, four deep: a bicycle (frame set, drivetrain, a
 *  wheel set of two wheels) and a tool kit. */
export const bomInput = e3.input('bom_rows', ArrayType(BomPart), variant('value', [
    { part: "Bicycle", sku: "BK-100", qty: 1n, cost: 0.0, parts: [
        { part: "Frame set", sku: "FS-10", qty: 1n, cost: 0.0, parts: [
            { part: "Frame", sku: "FR-1", qty: 1n, cost: 420.0, parts: [] },
            { part: "Fork", sku: "FK-2", qty: 1n, cost: 180.0, parts: [] },
        ] },
        { part: "Drivetrain", sku: "DT-20", qty: 1n, cost: 0.0, parts: [
            { part: "Crankset", sku: "CR-3", qty: 1n, cost: 145.0, parts: [] },
            { part: "Chain", sku: "CH-4", qty: 1n, cost: 32.0, parts: [] },
            { part: "Cassette", sku: "CS-5", qty: 1n, cost: 68.0, parts: [] },
        ] },
        { part: "Wheel set", sku: "WS-30", qty: 1n, cost: 0.0, parts: [
            { part: "Front wheel", sku: "WF-31", qty: 1n, cost: 0.0, parts: [
                { part: "Rim", sku: "RM-6", qty: 1n, cost: 55.0, parts: [] },
                { part: "Hub", sku: "HB-7", qty: 1n, cost: 48.0, parts: [] },
                { part: "Spokes", sku: "SP-8", qty: 32n, cost: 11.2, parts: [] },
            ] },
            { part: "Rear wheel", sku: "WR-32", qty: 1n, cost: 0.0, parts: [
                { part: "Rim", sku: "RM-6", qty: 1n, cost: 55.0, parts: [] },
                { part: "Hub", sku: "HB-9", qty: 1n, cost: 62.0, parts: [] },
                { part: "Spokes", sku: "SP-8", qty: 32n, cost: 11.2, parts: [] },
            ] },
        ] },
    ] },
    { part: "Tool kit", sku: "TK-40", qty: 1n, cost: 0.0, parts: [
        { part: "Multi-tool", sku: "MT-11", qty: 1n, cost: 24.0, parts: [] },
        { part: "Pump", sku: "PM-12", qty: 1n, cost: 29.0, parts: [] },
    ] },
]));

export const dataBindPagedTable = example({
    keywords: [
        "Data", "bindPaged", "paged", "Table", "tree", "children", "nested", "RecursiveType", "window", "page",
        "total", "subtotal", "aggregate", "count", "sum", "positional", "Array", "stream order", "sort",
        "partial", "row-source", "contract", "bill of materials", "#954", "#576",
    ],
    description: "A Table over a BOUND dataset — `Data.bindPaged(bom_rows)` hands the Table its windows exactly as a Plan takes them, and the difference is only the collection: a Table's windows are ARRAYS that concatenate in stream order. The bill of materials nests in the data (`tree.children`), and a window holds whole top-level assemblies with their subtrees, so every subtotal — the cost in the column's currency format, the SKU column's count of leaf parts — is exact over what has loaded, exactly as inline. Client sort is withdrawn on a paged table and the footer says so, because sorting a loaded prefix would look like a sort of the whole table",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bom = $.let(Data.bindPaged(bomInput));
            return (
                <Table
                    variant="line"
                    data={bom}
                    columns={{
                        part: { header: "Part", width: "240px" },
                        sku: { header: "SKU · parts", aggregate: "count" },
                        qty: { header: "Qty" },
                        cost: { header: "Cost", format: Format.Currency({ currency: "EUR" }), aggregate: "sum" },
                    }}
                    tree={{ children: (p) => p.parts }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ── A Sheet over a bound keyed source (§3.13) ───────────────────────────────

/** How many jobs the generated sheet holds — a small authored constant; {@link jobsTask} makes the rows. */
export const jobCountInput = e3.input('job_count', IntegerType, variant('value', 600n));

/** A generated job: when it starts, what it is, and how many. */
export const JobRow = StructType({ start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType) });

/**
 * The jobs, generated from their count — keyed `J1000`, `J1001`, …: fixed
 * width, so key order is the order the sheet reads them in, and a key search
 * addresses real rows. One a day from 5 January, the three tasks in turn.
 */
export const generateJobs = East.function([IntegerType], DictType(StringType, JobRow), ($, count) => {
    const day0 = $.const(new Date("2026-01-05T00:00:00Z"), DateTimeType);
    const tasks = $.const(["Routing", "Spraying", "Wrapping"], ArrayType(StringType));
    return East.Array.range(0n, count).toDict(
        (_$, i) => East.str`J${i.add(1_000n)}`,
        ($2, i) => $2.const({
            start: some(day0.addDays(i)),
            task: tasks.get(i.remainder(3n)),
            qty: some(i.multiply(15n).toFloat().add(180.0)),
        }, JobRow),
    );
});

/** The task that generates the jobs — its output is the dataset the sheet pages. */
export const jobsTask = e3.task('jobs', [jobCountInput], generateJobs);

export const dataBindPagedSheet = example({
    keywords: [
        "Data", "bindPaged", "paged", "task", "e3.task", "generated", "Sheet", "Root", "keyed", "Dict", "key order",
        "window", "page", "seek", "key search", "transport", "partial", "exhausted", "readOnly", "row-source",
        "contract", "Reactive",
    ],
    description: "A paged sheet over a BOUND keyed dataset — `Data.bindPaged(jobsTask)` over the jobs an `e3.task` generates: windows land as the planner scrolls, the footer counts elements, the blank tail appears once the source is exhausted, and key search seeks the dataset's own keys. A keyed source needs no `id` — its key is the row id. Read-only: a sheet edits a paged source only through an authoritative `onApply`, which this one declares none of",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const jobs = $.let(Data.bindPaged(jobsTask));
            return (
                <VStack gap="3" align="stretch">
                    <Sheet.View
                        data={jobs}
                        columns={{
                            start: Sheet.column.date(JobRow, { header: "Start", width: "96px" }),
                            task:  Sheet.column.text(JobRow, { header: "Task", width: "180px" }),
                            qty:   Sheet.column.quantity(JobRow, { header: "Qty", width: "112px", format: Format.Number({ maximumFractionDigits: 0n }) }),
                        }}
                        readOnly={true}
                        style={{ height: "420px" }}
                    />
                    <Text.MonoLabel>Bound dataset · key search and paging</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
