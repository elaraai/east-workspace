/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan read a window at a time (#1199, `Plan Builder Spec.md` §9.11,
 * PB54–PB55) — what is checked of it without e3: the windows example runs,
 * its jobs read a cell at a time (#1039), as the halls example (#1344), its
 * presses a record the rail narrows, does, and the typed keys' sibling of it,
 * its jobs keyed by a variant (#1696);
 * the windows' types and their refusals at build — a window that is not an
 * index window of the kind's own record, a kind read by day whose backlog has
 * no window, a `window` without `entries`, `entries` without a `window` or
 * not the record's own entries, `window` on a resource kind (gone), and a
 * paged resource kind (a Calendar's) keyed by another type than String or
 * grouped; an event kind landing on rows read a page at a time read
 * whole or through its day index (#1039, #1541); and the windows example's
 * manifest: its records and its presses paged reads alone, none of them
 * preloaded or polled whole. What
 * a window reads — the days in view, one event by its key, the presses a
 * window at a time, and a window that reads no rows, refused as it is read —
 * is read from e3, so it is checked in e3-ui-components on e3 itself
 * (`test/plan-windows.spec.ts`), as a source's indexes, which a Plan reads only
 * as it is evaluated, are (`test/plan-series.spec.ts`).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, NullType, SetType, StringType, StructType, none, variant,
    type BlockBuilder, type EastType, type ExprType,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Data, Plan, Record, Schedule, deriveManifest } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./plan-windows.examples.js";
import { PrintPress } from "./plan-events.examples.js";

describeEast("Plan read a window at a time — the examples (#1199, #1039, #1344)", (test) => {
    Assert.examples(test, { planWindows: ex.planWindows, planSeriesByHall: ex.planSeriesByHall, planTypedKeysPaged: ex.planTypedKeysPaged });
}, { platformFns: TestImpl });

const at = (text: string): Date => new Date(text);

/** A dataset's path as text: its fields, joined by dots. */
function pathText(path: unknown): string {
    return (path as readonly { value: string }[]).map((step) => step.value).join(".");
}

/** The jobs' record and the presses' dataset, by their paths' text. */
const JOBS_PATH = pathText(ex.planWindowJobs.path);
const PRESSES_PATH = pathText(ex.planWindowPresses.output.path);

/** The jobs' kind as a Plan with no rail declares it: read by day, its backlog by its index. */
function windowedJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(ex.planWindowJobs));
    const days = $.let(Data.bindPaged(ex.planWindowJobs, { index: "plan_window_jobs_by_day", join: true }));
    const backlog = $.let(Data.bindPaged(ex.planWindowJobs, { index: "plan_window_jobs_unscheduled", join: true }));
    const entries = $.let(Data.bindPaged(ex.planWindowJobs));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state",
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
        window: days, backlogWindow: backlog, entries,
    });
}

/** The jobs' kind read whole: the record bound alone, no source of the slice and no window. */
function wholeJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(ex.planWindowJobs));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state",
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
    });
}

/** The jobs' kind as the windows example declares it: narrowed through its source of the slice, one job read by its key. */
function railJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(ex.planWindowJobs));
    const entries = $.let(Data.bindPaged(ex.planWindowJobs));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state",
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
        entries,
    });
}

/** The windows example's rail: its `job` source over the jobs' interval index, their series index and their summary. */
const jobSlice = () => Slice.bindRecords("spec.windows", {
    job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: ["plan_window_jobs_by_time", "plan_window_jobs_by_press_week", "plan_window_jobs_by_press_month"] }), range: "start" },
});

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
        const jobs = $.let(Record.bind(ex.planWindowJobs));
        return Schedule.events(jobs as never, {
            name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", ...options,
        } as never);
    };

    const entries = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs));

    test("a kind's window is an index window of its own record: its day index for `window`, its backlog index for `backlogWindow`", () => {
        const days = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: "plan_window_jobs_by_day", join: true }));
        const backlog = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: "plan_window_jobs_unscheduled", join: true }));
        assert.equal(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: entries($) })), "");
        // The record whole is no index window.
        assert.match(refusal(($) => kindWith($, { window: $.let(Data.bindPaged(ex.planWindowJobs)), backlogWindow: backlog($) })),
            /^Schedule\.events: "Print job": `window` reads the record through a day index keyed by Schedule\.days — Data\.bindPaged\(record, \{ index, join: true \}\), each window an Array of \{ ik: \.DateTime, key, value, row: Option<.*> \} — and this one serves \.Dict/);
        // The backlog's index read as the days, and the days' as the backlog.
        assert.match(refusal(($) => kindWith($, { window: backlog($), backlogWindow: backlog($) })), /`window` reads the record through a day index keyed by Schedule\.days/);
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: days($) })), /`backlogWindow` reads the record through a backlog index keyed by Schedule\.unscheduled/);
        // Another record's day index serves another record's rows.
        const PlateSet = StructType({ title: StringType, at: DateTimeType, press: StringType });
        const plates = e3.record("builder_windows_plates", DictType(StringType, PlateSet), {
            initial: new Map(),
            indexes: (index) => ({
                builder_windows_plates_by_day: index.keys(East.function([StringType, PlateSet], SetType(DateTimeType), ($, _id, plate) => {
                    const daysOf = $.const(Schedule.days);
                    return daysOf(plate.at, plate.at);
                })),
            }),
        });
        assert.match(refusal(($) => kindWith($, { window: $.let(Data.bindPaged(plates, { index: "builder_windows_plates_by_day", join: true })), backlogWindow: backlog($) })),
            /`window` reads the record through a day index keyed by Schedule\.days — .* and this one serves /);
    });

    test("a kind read by day whose times are Options reads its backlog through its index too; plain times take no backlog window", () => {
        const days = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: "plan_window_jobs_by_day", join: true }));
        assert.match(refusal(($) => kindWith($, { window: days($) })),
            /^Schedule\.events: "Print job": `window` reads the days in view through a day index, so the record is never read whole — and this kind's times are Options, so it has a backlog: read it through `backlogWindow` beside it/);
    });

    test("a kind given `window` reads one event by its key through `entries`: refused without it, without a window, and over anything but the record's own entries", () => {
        const days = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: "plan_window_jobs_by_day", join: true }));
        const backlog = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowJobs, { index: "plan_window_jobs_unscheduled", join: true }));
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
        const plates = e3.record("builder_windows_entry_plates", DictType(StringType, PlateSet), { initial: new Map() });
        assert.match(refusal(($) => kindWith($, { window: days($), backlogWindow: backlog($), entries: $.let(Data.bindPaged(plates)) })),
            /`entries` reads the record's own entries by key — .* and this one serves \.Dict \(key=\.String, value=\.Struct \[\(name="title", type=\.String\), \(name="at", type=\.DateTime\), \(name="press", type=\.String\)\]\)$/);
    });

    test("a paged resource kind (a Calendar's): over its own record, keyed by String, never grouped — and `window`, which is gone", () => {
        const pressesOf = ($: BlockBuilder<NullType>, options: object) => {
            const pages = $.let(Data.bindPaged(ex.planWindowPresses));
            return Schedule.resources(pages, { name: "Presses", icon: "print", label: (p: ExprType<typeof PrintPress>) => p.name, ...options } as never);
        };
        assert.equal(refusal(($) => pressesOf($, {})), "");
        assert.match(refusal(($) => pressesOf($, { group: (p: ExprType<typeof PrintPress>) => p.hall })),
            /^Schedule\.resources: "Presses": a paged kind reads its resources a window at a time in their key order, and `group` gathers resources from anywhere in the record/);
        // A resource nested under another was the Plan's, which lays its rows out as a tree of them now (#1541).
        assert.match(refusal(($) => pressesOf($, { parent: () => none })),
            /^Schedule\.resources: "Presses": `parent` was the Plan's, and a Plan takes no resource kinds now \(#1541\)/);
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

    test("an event kind on rows read a page at a time is read a cell at a time through its source of the slice: read whole, or through its day index, it is refused at build, the refusal naming both indexes over the kind's own fields (#1039, #1541)", () => {
        const axis = Plan.axis({ window: { min: at("2026-10-05T00:00:00Z"), max: at("2026-10-19T00:00:00Z") }, resolution: "day" });
        // The presses are the rows the jobs land on.
        const presses = [Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name })];
        const pages = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planWindowPresses));
        const declared = String.raw`index\.flatSeries\(\{ key: "press", from: "start", to: "end", tile: "week" \}\) and ` +
            String.raw`index\.summary\(\{ key: "press", from: "start", to: "end", tile: "month" \}\) beside its interval index$`;
        const source = String.raw`a paged kind's events are read a cell at a time, through the kind's source of the slice: `;
        const named = String.raw`name a source after "job", Data\.bindPaged\(record, \{ indexes \}\), listing `;
        // Its record read whole: no source of the slice.
        assert.match(refusal(($) => Plan.Payload({ axis, data: pages($), series: presses, events: { job: wholeJobs($ as never) } })),
            new RegExp(String.raw`^Plan: events\.job is placed on the rows of presses, paged, and its record is read whole — ${source}${named}${declared}`));
        // The days in view through its day index, the form for a kind with no rail: no source of the slice either.
        assert.match(refusal(($) => Plan.Payload({ axis, data: pages($), series: presses, events: { job: windowedJobs($ as never) } })),
            new RegExp(String.raw`^Plan: events\.job is placed on the rows of presses, paged, and reads the days in view through its day index \(\`window\`\) — ` +
                String.raw`${source}leave \`window\` and \`backlogWindow\` out, and ${named}${declared}`));
        // The rows paged from the slice's `rows` source, whose sources name none of the kind's own.
        assert.match(refusal(($) => Plan.Payload({
            axis, series: presses, events: { job: wholeJobs($ as never) },
            slice: { slice: Slice.bindRecords("spec.windows.rows", { rows: { source: Data.bindPaged(ex.planSeriesPresses, { indexes: ["plan_series_presses_by_hall"] }) } }) },
        })), new RegExp(String.raw`^Plan: events\.job is placed on the rows of presses, paged, and its record is read whole — `));
        // Read through its own source of the slice, it builds — its rows paged through `data`, or through the `rows` source.
        assert.equal(refusal(($) => Plan.Payload({ axis, data: pages($), series: presses, slice: { slice: jobSlice() }, events: { job: railJobs($ as never) } })), "");
        assert.equal(refusal(($) => Plan.Payload({
            axis, series: presses, events: { job: railJobs($ as never) },
            slice: { slice: Slice.bindRecords("spec.windows.both", {
                rows: { source: Data.bindPaged(ex.planSeriesPresses, { indexes: ["plan_series_presses_by_hall"] }) },
                job: { source: Data.bindPaged(ex.planWindowJobs, { indexes: ["plan_window_jobs_by_time", "plan_window_jobs_by_press_week", "plan_window_jobs_by_press_month"] }), range: "start" },
            }) },
        })), "");
        // A kind on rows read whole is read whole, or through its day index: it builds.
        const whole = ($: BlockBuilder<NullType>) => $.let(Data.bind(ex.planWindowPresses)).read();
        assert.equal(refusal(($) => Plan.Payload({ axis, data: whole($), series: presses, events: { job: wholeJobs($ as never) } })), "");
        assert.equal(refusal(($) => Plan.Payload({ axis, data: whole($), series: presses, events: { job: windowedJobs($ as never) } })), "");
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

    test("the halls example reads its presses' record a window at a time beside the jobs': neither preloaded nor polled whole (#1344)", () => {
        const manifest = deriveManifest(ex.planSeriesByHall.fn as never);
        const texts = (paths: readonly unknown[]) => paths.map(pathText);
        const presses = pathText(ex.planSeriesPresses.path);
        assert.deepEqual(manifest.records, [ex.planWindowJobs.name]);
        assert.ok(texts(manifest.pages).includes(presses), "the presses' record is read by window");
        assert.ok(texts(manifest.pages).includes(JOBS_PATH), "the jobs record is read by window");
        assert.deepEqual(texts(manifest.paths), []);
    });

    test("#1696 — the typed keys' sibling reads its jobs, keyed by a variant, a window at a time beside the presses' record, as the halls example reads its own: neither preloaded nor polled whole", () => {
        const manifest = deriveManifest(ex.planTypedKeysPaged.fn as never);
        const texts = (paths: readonly unknown[]) => paths.map(pathText);
        assert.deepEqual(manifest.records, [ex.planKeyedWindowJobs.name]);
        assert.ok(texts(manifest.pages).includes(pathText(ex.planSeriesPresses.path)), "the presses' record is read by window");
        assert.ok(texts(manifest.pages).includes(pathText(ex.planKeyedWindowJobs.path)), "the jobs record is read by window");
        assert.deepEqual(texts(manifest.paths), []);
    });

    test("a record bound alone with Record.bind is preloaded and polled, as it was", () => {
        const manifest = deriveManifest(East.function([], NullType, ($) => {
            $.let(Record.bind(ex.planWindowJobs));
        }) as never);
        assert.deepEqual([manifest.records, manifest.paths.map(pathText), manifest.pages.map(pathText)], [[ex.planWindowJobs.name], [JOBS_PATH], []]);
    });
});
