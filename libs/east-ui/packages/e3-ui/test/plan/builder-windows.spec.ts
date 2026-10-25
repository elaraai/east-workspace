/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan read a window at a time (#1199, `Plan Builder Spec.md` §9.11,
 * PB54–PB55) — what is checked of it without e3: the windows example runs,
 * and the series example (#1039), the same Plan reading its jobs a cell at a
 * time, reads what it does, as the halls example (#1344), its presses a record
 * the rail narrows, does;
 * the windows' types and their refusals at build — a window that is not an
 * index window of the kind's own record, a kind read by day whose backlog has
 * no window, a `window` without `entries`, `entries` without a `window` or
 * not the record's own entries, `window` on a resource kind (gone), a paged
 * resource kind keyed by another type than String, grouped or nested, read by
 * the Calendar, two paged kinds, and a paged kind beside a paged `data`; a
 * resource kind read whole, which lists its rows; and the windows example's
 * manifest: its records and its presses paged reads alone, none of them
 * preloaded or polled whole. What a window reads — the days in view, one
 * event by its key, the presses a window at a time, and a window that reads
 * no rows, refused as it is read — is read from e3, so it is checked in
 * e3-ui-components on e3 itself (`test/plan-windows.spec.ts`).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, NullType, SetType, StringType, StructType, none, variant,
    type BlockBuilder, type EastType, type ExprType,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Data, Plan, Record, Schedule, deriveManifest } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./plan-windows.examples.js";
import { PrintPress } from "./plan-events.examples.js";

describeEast("Plan read a window at a time — the examples (#1199, #1039, #1344)", (test) => {
    Assert.examples(test, { planWindows: ex.planWindows, planSeries: ex.planSeries, planSeriesByHall: ex.planSeriesByHall });
}, { platformFns: TestImpl });

const at = (text: string): Date => new Date(text);

/** A dataset's path as text: its fields, joined by dots. */
function pathText(path: unknown): string {
    return (path as readonly { value: string }[]).map((step) => step.value).join(".");
}

/** The jobs' record and the presses' dataset, by their paths' text. */
const JOBS_PATH = pathText(ex.planWindowJobs.path);
const PRESSES_PATH = pathText(ex.planWindowPresses.output.path);

/** The jobs' kind as the example declares it for a Plan with no rail: read by day, its backlog by its index. */
function windowedJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
    const days = $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true }));
    const backlog = $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
    const entries = $.let(Data.bindPaged(ex.planWindowJobs));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state",
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
        window: days, backlogWindow: backlog, entries,
    });
}

// ============================================================================
// The windows' types and their refusals
// ============================================================================

describe("the windows' types and their refusals", () => {
    /** What `build` throws inside a block; `""` when it builds. */
    function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
        try {
            East.function([], NullType, ($) => { build($); });
            return "";
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
    }
    const kindWith = ($: BlockBuilder<NullType>, options: object) => {
        const jobs = $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
        return Schedule.events(jobs as never, {
            name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", ...options,
        } as never);
    };

    const entries = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs));

    test("a kind's window is an index window of its own record: its day index for `window`, its backlog index for `backlogWindow`", () => {
        const days = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true }));
        const backlog = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
        assert.equal(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: entries($) })), "");
        // The record whole is no index window.
        assert.match(refusal(($) => kindWith($, { window: $.let(Data.bindPaged(ex.planWindowJobs)), backlogWindow: backlog($) })),
            /^Schedule\.events: "Print job": `window` reads the record through a day index keyed by Schedule\.days — Data\.bindPaged\(record, \{ index, join: true \}\), each window an Array of \{ ik: \.DateTime, key, value, row: Option<.*> \} — and this one serves \.Dict/);
        // The backlog's index read as the days, and the days' as the backlog.
        assert.match(refusal(($) => kindWith($, { window: backlog($), backlogWindow: backlog($) })), /`window` reads the record through a day index keyed by Schedule\.days/);
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: days($) })), /`backlogWindow` reads the record through a backlog index keyed by Schedule\.unscheduled/);
        // Another record's day index serves another record's rows.
        const PlateSet = StructType({ title: StringType, at: DateTimeType, press: StringType });
        const plates = e3.record("builder_windows_plates", DictType(StringType, PlateSet), new Map());
        const platesByDay = e3.recordIndex("builder_windows_plates_by_day", plates, {
            keys: East.function([StringType, PlateSet], SetType(DateTimeType), ($, _id, plate) => {
                const daysOf = $.const(Schedule.days);
                return daysOf(plate.at, plate.at);
            }),
        });
        assert.match(refusal(($) => kindWith($, { window: $.let(Data.bindPaged(plates, { index: platesByDay, join: true })), backlogWindow: backlog($) })),
            /`window` reads the record through a day index keyed by Schedule\.days — .* and this one serves /);
    });

    test("a kind read by day whose times are Options reads its backlog through its index too; plain times take no backlog window", () => {
        const days = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true }));
        assert.match(refusal(($) => kindWith($, { window: days($) })),
            /^Schedule\.events: "Print job": `window` reads the days in view through a day index, so the record is never read whole — and this kind's times are Options, so it has a backlog: read it through `backlogWindow` beside it/);
    });

    test("a kind given `window` reads one event by its key through `entries`: refused without it, without a window, and over anything but the record's own entries", () => {
        const days = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsByDay, join: true }));
        const backlog = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: ex.planWindowJobsUnscheduled, join: true }));
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($) })),
            /^Schedule\.events: "Print job": an indexed kind reads only the window — and one event, the inspector's or its editing's, is read by its key: give `entries` beside it, Data\.bindPaged\(record\), the record's own entries$/);
        // Without a window, `entries` needs the kind's source of its builder's slice: refused as the kind is built without one (#1343).
        assert.match(refusal(($) => (kindWith($, { entries: entries($) }) as { build(slot: string): unknown }).build("job")),
            /^Schedule\.events: "Print job": `entries` reads one event by its key beside `window`, or beside the kind's source of its builder's Slice\.bindRecords \(one named "job"\) — give one of those with it$/);
        // An index's window, the entries whole, and another record's entries.
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: days($) })),
            /^Schedule\.events: "Print job": `entries` reads the record's own entries by key — Data\.bindPaged\(record\), a window at a time of \.Dict.* — and this one serves an index's window, /);
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: $.let(Record.bind(ex.planWindowJobs, [])).read() })),
            /`entries` reads the record's own entries by key — .* and this one serves \.Dict.* whole$/);
        const PlateSet = StructType({ title: StringType, at: DateTimeType, press: StringType });
        const plates = e3.record("builder_windows_entry_plates", DictType(StringType, PlateSet), new Map());
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: $.let(Data.bindPaged(plates)) })),
            /`entries` reads the record's own entries by key — .* and this one serves \.Dict \(key=\.String, value=\.Struct \[\(name="title", type=\.String\), \(name="at", type=\.DateTime\), \(name="press", type=\.String\)\]\)$/);
    });

    test("a paged resource kind: over its own record, keyed by String, neither grouped nor nested — and `window`, which is gone", () => {
        const pressesOf = ($: BlockBuilder<NullType>, options: object) => {
            const pages = $.let(Data.bindPaged(ex.planWindowPresses));
            return Schedule.resources(pages, { name: "Presses", icon: "print", label: (p: ExprType<typeof PrintPress>) => p.name, ...options } as never);
        };
        assert.equal(refusal(($) => pressesOf($, {})), "");
        assert.match(refusal(($) => pressesOf($, { group: (p: ExprType<typeof PrintPress>) => p.hall })),
            /^Schedule\.resources: "Presses": a paged kind reads its resources a window at a time in their key order, and `group` gathers resources from anywhere in the record/);
        assert.match(refusal(($) => pressesOf($, { parent: () => none })),
            /^Schedule\.resources: "Presses": a paged kind reads its resources a window at a time in their key order, and `parent` gathers resources/);
        const ByNumber = DictType(IntegerType, PrintPress);
        const numbered = e3.input("builder_windows_numbered", ByNumber, variant("value", new Map()));
        // Refused at compile time too: a paged read's key type is a String one.
        assert.match(refusal(($) => Schedule.resources($.let(Data.bindPaged(numbered)) as never, { name: "Presses", icon: "print", label: (p: ExprType<typeof PrintPress>) => p.name } as never)),
            /^Schedule\.resources: "Presses": a paged kind's key search seeks a resource by its key, as text — key the resources by String, and these are keyed by \.Integer$/);
        // The form before #1199 is refused, naming the one that took its place.
        assert.match(refusal(($) => {
            const rows = $.let(Data.bind(ex.planWindowPresses));
            return Schedule.resources(rows.read(), { name: "Presses", icon: "print", label: (p: ExprType<typeof PrintPress>) => p.name, window: $.let(Data.bindPaged(ex.planWindowPresses)) } as never);
        }), /^Schedule\.resources: "Presses": `window` is gone — a kind pages when its resources are a paged read: Schedule\.resources\(Data\.bindPaged\(record\), \{ … \}\)/);
    });

    test("the Calendar reads a resource kind whole, and refuses a paged one in words", () => {
        assert.match(refusal(($) => {
            const pages = $.let(Data.bindPaged(ex.planWindowPresses));
            return Schedule.resources(pages, { name: "Presses", icon: "print", label: (p) => p.name }).build("presses");
        }), /^Schedule\.resources: "Presses": the Calendar reads a resource kind's resources whole, and this one's are a paged read — give it the resources as a Dict, usually a record's read\(\)$/);
    });

    test("a Plan pages one source: two paged resource kinds, or a paged kind beside a paged `data`, are refused", () => {
        const axis = Plan.axis({ window: { min: at("2026-10-05T00:00:00Z"), max: at("2026-10-19T00:00:00Z") }, resolution: "day" });
        const pressesOf = ($: BlockBuilder<NullType>) => Schedule.resources($.let(Data.bindPaged(ex.planWindowPresses)), { name: "Presses", icon: "print", label: (p) => p.name });
        assert.equal(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: windowedJobs($ as never) } })), "");
        assert.match(refusal(($) => Plan.Payload({
            axis,
            resources: { presses: pressesOf($), spares: pressesOf($) },
            events: { job: windowedJobs($ as never) },
        })), /^Plan: resources\.presses and resources\.spares each page their rows \(Data\.bindPaged\), and a canvas pages one source — read all but one of them whole$/);
        const Row = StructType({ v: IntegerType });
        const rows = e3.input("builder_windows_rows", DictType(StringType, Row), variant("value", new Map()));
        assert.match(refusal(($) => Plan.Payload({
            axis,
            data: $.let(Data.bindPaged(rows)),
            series: [Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: () => [] })],
            resources: { presses: pressesOf($) },
            events: { job: windowedJobs($ as never) },
        })), /^Plan: resources\.presses pages its rows \(Data\.bindPaged\), and `data` is paged too, and a canvas pages one source — bind `data` whole, or read the resources whole$/);
    });
});

// ============================================================================
// A resource kind read whole (PB55)
// ============================================================================

describe("a resource kind read whole (PB55)", () => {
    test("lists its rows, and reads none by its key", () => {
        const whole = East.compile(East.function([], Schedule.Types.PlanResources, ($) => {
            const rows = $.const(new Map([
                ["P-1001", { name: "Press 1001", hall: "Hall 1", sheets_per_hour: 6000.0 }],
                ["P-1002", { name: "Press 1002", hall: "Hall 2", sheets_per_hour: 7000.0 }],
            ]), DictType(StringType, PrintPress));
            return Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name }).buildPlan("presses");
        }), [])();
        assert.deepEqual([whole.rows.length, whole.byKey.type], [2, "none"]);
    });
});

// ============================================================================
// The windows example's manifest (#1199)
// ============================================================================

describe("the windows example's manifest: what a ui() task preloads and polls whole (#1199)", () => {
    test("names the jobs record and the presses as paged reads alone: neither is preloaded or polled whole", () => {
        const manifest = deriveManifest(ex.planWindows.fn as never);
        const texts = (paths: readonly unknown[]) => paths.map(pathText);
        assert.deepEqual(manifest.records, [ex.planWindowJobs.name]);
        assert.ok(texts(manifest.pages).includes(JOBS_PATH), "the jobs record is read by window");
        assert.ok(texts(manifest.pages).includes(PRESSES_PATH), "the presses are read by window");
        assert.ok(!texts(manifest.paths).includes(JOBS_PATH), "the jobs record is never preloaded");
        assert.ok(!texts(manifest.paths).includes(PRESSES_PATH), "the presses are never preloaded");
        assert.deepEqual(texts(manifest.paths), []);
    });

    test("the series example reads as the windows example does: the jobs record and the presses paged alone (#1039)", () => {
        const texts = (paths: readonly unknown[]) => paths.map(pathText);
        const read = (fn: unknown) => {
            const manifest = deriveManifest(fn as never);
            return [manifest.records, texts(manifest.paths), texts(manifest.pages)];
        };
        assert.deepEqual(read(ex.planSeries.fn), read(ex.planWindows.fn));
    });

    test("the halls example reads its presses' record a window at a time beside the jobs': neither preloaded nor polled whole (#1344)", () => {
        const manifest = deriveManifest(ex.planSeriesByHall.fn as never);
        const texts = (paths: readonly unknown[]) => paths.map(pathText);
        const presses = pathText(ex.planSeriesPresses.path);
        assert.deepEqual(manifest.records, [ex.planWindowJobs.name]);
        assert.ok(texts(manifest.pages).includes(presses), "the presses' record is read by window");
        assert.ok(texts(manifest.pages).includes(JOBS_PATH), "the jobs record is read by window");
        assert.deepEqual(texts(manifest.paths), []);
    });

    test("a record bound alone with Record.bind is preloaded and polled, as it was", () => {
        const manifest = deriveManifest(East.function([], NullType, ($) => {
            $.let(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
        }) as never);
        assert.deepEqual([manifest.records, manifest.paths.map(pathText), manifest.pages.map(pathText)], [[ex.planWindowJobs.name], [JOBS_PATH], []]);
    });
});
