/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Calendar's paged resource kind (#1424), over the windows example's records
 * on e3 itself: the payload compiles against the platform a UI task's preview
 * gives it, its slice made on the record Slice's platform over e3's pages, and
 * every read is counted from the harness's request log.
 *
 * - The paged seam the renderer reads the presses through: their rows a window
 *   at a time — and their keys alone, which the cells' reader places its blocks
 *   by — their count, one press by its key, and a key search over their own
 *   order; none of it reads a job.
 * - The refusals of a source's series and summary indexes, which the Calendar
 *   reads only as it is evaluated, in its words: the interval index alone, a
 *   summary and no series, a series and no summary — each naming the indexes
 *   to declare over the kind's own fields.
 *
 * What the Calendar reads as it draws, and when, is the DOM's
 * (`src/calendar/calendar-windows.dom.test.tsx`).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { East, none, some, variant, type BlockBuilder, type ExprType, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { StateRuntime, UIStore, createRecordSliceImplementation } from "@elaraai/east-ui-components/platform";
import { Calendar, CalendarPayloadType, Data, Record, createCalendarPayload } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import { PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import { datasetPathToString } from "../src/platform/dataset-store.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "plan/plan-windows": ex });

type Payload = ValueTypeOf<typeof CalendarPayloadType>;

/** The jobs' record and the presses, as the request log names them. */
const JOBS = datasetPathToString(ex.planWindowJobs.path);
const PRESSES = datasetPathToString(ex.planWindowPresses.output.path);
/** Every read of the jobs so far: a search, a page, a read of runs or rows, a read whole. */
const jobReads = () => h.requests().filter((request) => request.dataset === JOBS && ["find", "page", "runs", "rows", "read"].includes(request.kind));
/** Every read of the presses so far, each its kind. */
const pressReads = () => h.requests().filter((request) => request.dataset === PRESSES).map((request) => request.kind);

/** The windows example's Calendar (`calendarWindows`), its payload declared in East over e3, its `job` source over the indexes given. */
function windowsPayload($: BlockBuilder<typeof CalendarPayloadType>, indexes: readonly unknown[]): ExprType<typeof CalendarPayloadType> {
    const presses = $.let(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const entries = $.let(Data.bindPaged(ex.planWindowJobs));
    // The indexes are the test's to vary, so the source is built over whichever it lists.
    const job = { source: Data.bindPaged(ex.planWindowJobs, { indexes: indexes as never }), range: "start" };
    const slice = $.let(Slice.bindRecords("spec.calendar.windows", { job } as never));
    return createCalendarPayload({
        slice: { slice },
        resources: { presses: Calendar.resources(presses, { name: "Presses", icon: "print", label: (p) => p.name, meta: (p) => some(p.hall) }) },
        events: {
            job: Calendar.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j: ExprType<typeof PrintJob>) => variant("hours", j.sheets.divide(8000.0)), due: (j: ExprType<typeof PrintJob>) => j.due },
                entries,
            }),
        },
    }) as ExprType<typeof CalendarPayloadType>;
}

/** The payload, built over e3 as a UI task's preview builds it, its slice made on the record Slice's platform over e3's pages. */
async function payloadOf(indexes: readonly unknown[] = [ex.planWindowJobsByTime, ex.planWindowJobsByPressWeek, ex.planWindowJobsByPressMonth]): Promise<Payload> {
    const program = East.function([], CalendarPayloadType, ($) => windowsPayload($, indexes));
    const { platform } = await h.platform(program);
    StateRuntime.initializeStore(new UIStore());
    const implementations = [...platform];
    implementations.push(...createRecordSliceImplementation(() => implementations));
    return East.compile(program, implementations)() as Payload;
}

/** The payload's paged kind, the presses. */
const pagedOf = (payload: Payload) => (payload.paged.type === "some" ? payload.paged.value : assert.fail("expected the presses paged"));

describe("the paged seam the Calendar reads its presses through (#1424)", () => {
    test("their rows and their keys a window at a time, their count, one by its key and a key search over their own order — and no job read", async () => {
        const payload = await payloadOf();
        const paged = pagedOf(payload);
        assert.equal(paged.kind, "presses");
        // The kind on the wire lists none of them: they come a window at a time.
        assert.deepEqual(payload.resources.map((kind) => [kind.key, kind.rows.length]), [["presses", 0]]);
        const rows = await h.ready(() => paged.rows(0n, 3n));
        assert.deepEqual(rows.map((row) => [row.key, row.label, row.meta]), [
            ["P-1001", "Press 1001", some("Hall 1")], ["P-1002", "Press 1002", some("Hall 2")], ["P-1003", "Press 1003", some("Hall 3")],
        ]);
        assert.deepEqual(await h.ready(() => paged.keys(200n, 2n)), ["P-1201", "P-1202"]);
        assert.deepEqual(await h.ready(() => paged.keys(1_999n, 5n)), ["P-3000"], "a window past the last press holds what is left");
        assert.equal(await h.ready(() => paged.total()), 2_000n);
        // One press by its key — and a key it does not hold.
        const one = await h.ready(() => paged.byKey("P-1460"));
        assert.deepEqual(one.type === "some" ? [one.value.key, one.value.label] : [], ["P-1460", "Press 1460"]);
        assert.deepEqual(await h.ready(() => paged.byKey("P-9999")), none);
        // A key search over their own order: where a Chooser's typed key lands.
        const seek = paged.seek.type === "some" ? paged.seek.value : assert.fail("expected the presses sought by key");
        // Presses 1400 to 1499: the 400th press in key order on.
        const found = await h.ready(() => seek(variant("prefix", "P-14")));
        assert.deepEqual([found.found, found.row, found.count], [true, 399n, 100n]);
        // Read through the presses' own paged read: never a job.
        assert.ok(pressReads().length > 0);
        assert.deepEqual(jobReads(), [], "the presses' reads read no job");
    });
});

describe("a source's series and summary indexes, refused as the Calendar is evaluated (#1424)", () => {
    /** The two indexes a refusal names, declared over the jobs' own fields: their press, their start and their end. */
    const series = String.raw`e3\.recordIndex\.series\(name, record, \{ key: "press", from: "start", to: "end", tile: "week" \}\)`;
    const summary = String.raw`e3\.recordIndex\.summary\(name, record, \{ key: "press", from: "start", to: "end", tile: "month" \}\)`;
    const paged = String.raw`, and the kind is placed on resources\.presses, paged — a paged kind's events are read a cell at a time`;

    test("the example's three build", async () => {
        await assert.doesNotReject(payloadOf());
    });

    test("its interval index alone: refused, naming the series and the summary index to declare", async () => {
        await assert.rejects(payloadOf([ex.planWindowJobsByTime]),
            new RegExp(String.raw`^.*Calendar: events\.job's source lists no series index and no summary index${paged}, and shaded past what the Calendar draws: ` +
                `declare ${series} and ${summary} over the same record and list them beside its interval index`));
    });

    test("a summary and no series index: refused, naming the series index to declare", async () => {
        await assert.rejects(payloadOf([ex.planWindowJobsByTime, ex.planWindowJobsByPressMonth]),
            new RegExp(String.raw`^.*Calendar: events\.job's source lists the summary index "plan_window_jobs_by_press_month", and no series index${paged}, ` +
                `through a series index: declare ${series} over the same record and list it beside the summary index`));
    });

    test("a series and no summary index: refused, naming the summary index to declare", async () => {
        await assert.rejects(payloadOf([ex.planWindowJobsByTime, ex.planWindowJobsByPressWeek]),
            new RegExp(String.raw`^.*Calendar: events\.job's source lists the series index "plan_window_jobs_by_press_week", and no summary index — the Calendar ` +
                String.raw`draws a series index's events while they fit, and its summary's shading past that: declare ${summary} over the same record and list it beside the series index`));
    });
});
