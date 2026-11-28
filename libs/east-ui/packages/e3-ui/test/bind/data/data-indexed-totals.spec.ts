/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Data.bindPaged(record, { indexes, totals })` (#1732), reading no e3: the
 * record's totals a tile — summaries with no key — listed apart from the
 * indexes rows are read through, each described as a summary marked as the
 * record's totals, searched by e3's own key, with no maintenance of its own:
 * a horizon counts what is saved. The rail over them reads each as the
 * summary's `totals` and offers none of their fields. What each refuses, in
 * its words — and what it takes beside the rail's and the scope's fields: totals
 * led by the fields a series index in time order is led by, which a builder
 * fills from its rows (#1716).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, Expr, NullType, StringType, StructType, VariantType, equalFor, isTypeEqual, variant,
    type ArrayType, type EastType, type FunctionType, type ValueTypeOf, type option,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { bindRecord, type RecordSliceConfigType } from "@elaraai/east-ui/internal";
import { Data } from "@elaraai/e3-ui";
import { refusingPlatform } from "../../refusing-platform.js";

/** A job: the hall and the press it runs on, when, and its title. */
const Job = StructType({ hall: StringType, press: StringType, start: DateTimeType, end: DateTimeType, title: StringType });
const jobs = e3.record("data_totals_jobs", DictType(StringType, Job), {
    initial: new Map(),
    indexes: (index) => ({
        jobs_by_time: index.interval({ from: "start", to: "end" }),
        jobs_by_hall_time: index.interval({ on: ["hall"], from: "start", to: "end" }),
        jobs_by_hall: index.on(["hall"]),
        jobs_by_press_month: index.summary({ key: "press", from: "start", to: "end", tile: "month" }),
        // The jobs a week under their hall, in time order — whose leading field a builder fills from its rows — and under
        // their title, in their keys' order, whose a builder never fills.
        jobs_by_hall_series: index.flatSeries({ on: ["hall"], key: "press", from: "start", to: "end", tile: "week", order: "time" }),
        jobs_by_title_series: index.flatSeries({ on: ["title"], key: "press", from: "start", to: "end", tile: "week" }),
        // The record's totals a month and a quarter, the hall's a month, and some that do not fit a horizon over the start.
        jobs_month: index.totals({ from: "start", to: "end", tile: "month" }),
        jobs_quarter: index.totals({ from: "start", to: "end", tile: "quarter" }),
        jobs_by_hall_month: index.totals({ on: ["hall"], from: "start", to: "end", tile: "month" }),
        jobs_month_too: index.totals({ from: "start", to: "end", tile: "month" }),
        jobs_ending_month: index.totals({ from: "end", to: "end", tile: "month" }),
        jobs_by_title_month: index.totals({ on: ["title"], from: "start", to: "end", tile: "month" }),
    }),
});

/** A binding's handle type, as its expression holds it. */
const typeOf = (source: unknown) => Expr.type(source as Expr) as StructType;
/** A binding's handle, built on a platform that reads nothing. */
const handleOf = (source: unknown) => East.compile(East.function([], typeOf(source), ($) => $.return(source as Expr)), refusingPlatform)() as {
    readonly indexes: Readonly<Record<string, unknown>>; readonly maintenance: option<unknown>; readonly defaultIndex: string;
};
/** The record Slice's config over a binding, built on a platform that reads nothing: its type from one build, its value from another. */
const configOf = (source: unknown, options: object): ValueTypeOf<RecordSliceConfigType> => {
    const type = Expr.type(bindRecord("jobs", source as never, options as never)) as EastType;
    const built = East.function([], type, ($) => $.return(bindRecord("jobs", source as never, options as never)));
    return (East.compile(built, refusingPlatform)() as { readonly config: ValueTypeOf<RecordSliceConfigType> }).config;
};

/** How the binding describes the record's totals a month, led by some fields: a summary, its marker the totals'. */
const MonthTotals = (led: readonly string[]) => StructType({
    fields: StructType(led.map((field) => [field, NullType] as const)),
    kind: VariantType({ summary: StructType({ "from=start": NullType, "to=end": NullType, "tile=month": NullType, __totals: NullType }) }),
});

describe("Data.bindPaged's totals", () => {
    test("describes each as a summary marked as the record's totals, searched by e3's own key, beside the indexes rows are read through", () => {
        const source = Data.bindPaged(jobs, { indexes: ["jobs_by_time", "jobs_by_hall"], totals: ["jobs_month", "jobs_by_hall_month"] });
        const indexes = typeOf(source).fields.indexes as StructType;
        assert.deepEqual(Object.keys(indexes.fields), ["jobs_by_time", "jobs_by_hall", "jobs_month", "jobs_by_hall_month"],
            "the indexes in their order, then the totals in theirs");
        assert.ok(isTypeEqual(indexes.fields.jobs_month!, MonthTotals([])), "led by no field");
        assert.ok(isTypeEqual(indexes.fields.jobs_by_hall_month!, MonthTotals(["hall"])), "led by the hall");
        const handle = handleOf(source);
        const marker = { "from=start": null, "to=end": null, "tile=month": null, __totals: null };
        assert.ok(equalFor(MonthTotals([]))(handle.indexes.jobs_month as never, { fields: {}, kind: variant("summary", marker) }),
            "a summary's metadata, marked as the record's totals");
        assert.ok(equalFor(MonthTotals(["hall"]))(handle.indexes.jobs_by_hall_month as never, { fields: { hall: null }, kind: variant("summary", marker) }));
        const page = typeOf(source).fields.page as FunctionType;
        const keys = ((((page.output as VariantType).cases.some as ArrayType<StructType>).value).fields.ik as VariantType).cases;
        assert.ok(isTypeEqual(keys.jobs_month!, jobs.indexes.jobs_month.keyType), "searched by e3's own key: the tile under no key");
        assert.ok(isTypeEqual(keys.jobs_by_hall_month!, jobs.indexes.jobs_by_hall_month.keyType));
        assert.equal(handle.maintenance.type, "none", "no maintenance of their own: a horizon counts what is saved");
        assert.equal(handle.defaultIndex, "primary");
    });

    test("the rail reads each as the summary's totals, offers none of their fields, and pages none of them", () => {
        const source = Data.bindPaged(jobs, { indexes: ["jobs_by_time", "jobs_by_hall"], totals: ["jobs_month", "jobs_quarter", "jobs_by_hall_month"] });
        const config = configOf(source, { range: "start", fields: { hall: { label: "Hall", hints: ["H-1", "H-2"] }, start: {} } });
        const summaryOf = (name: string) => config.indexes.find((index) => index.name === name)?.summary;
        const month = summaryOf("jobs_month");
        assert.ok(month?.type === "some" && month.value.type === "totals", "the record's totals, never a summary by key");
        assert.deepEqual([month.value.value.from, month.value.value.to, month.value.value.tile.type], ["start", "end", "month"]);
        const quarter = summaryOf("jobs_quarter");
        assert.ok(quarter?.type === "some" && quarter.value.type === "totals" && quarter.value.value.tile.type === "quarter");
        assert.deepEqual([...(config.indexes.find((index) => index.name === "jobs_by_hall_month")?.fields ?? [])], ["hall"], "led by the hall");
        assert.deepEqual(config.fields.map((field) => field.fieldId), ["hall", "start"], "the rail offers what it is told, from the indexes rows are read through");
        // Offered nothing of them: the fields the rail takes unless told are the indexes' alone.
        const untold = configOf(Data.bindPaged(jobs, { indexes: ["jobs_by_time"], totals: ["jobs_month"] }), { range: "start" });
        assert.deepEqual(untold.fields.map((field) => field.fieldId), ["start"], "the interval's start alone: the totals offer no field");
    });

    test("refuses, in its words, what is not the record's totals, totals listed among the indexes, and two at a tile over the same fields", () => {
        // A name in totals is one of the record's summaries with no key, so these do not compile; the build refuses them too.
        assert.throws(() => Data.bindPaged(jobs, { indexes: ["jobs_by_time"], totals: ["jobs_by_press_month"] as never }), {
            message: "Data.bindPaged: 'jobs_by_press_month' is listed in totals, and is a summary by 'press' — the record's totals a tile are a summary " +
                "with no key: index.totals({ from, to, tile })",
        });
        assert.throws(() => Data.bindPaged(jobs, { indexes: ["jobs_by_time"], totals: ["jobs_by_hall"] as never }), {
            message: "Data.bindPaged: 'jobs_by_hall' is listed in totals, and is no summary — the record's totals a tile are a summary with no key: " +
                "index.totals({ from, to, tile })",
        });
        assert.throws(() => Data.bindPaged(jobs, { indexes: ["jobs_by_time", "jobs_month"] }), {
            message: "Data.bindPaged: 'jobs_month' keeps the record's totals a month, which nothing reads rows through — list it in totals",
        });
        assert.throws(() => Data.bindPaged(jobs, { indexes: ["jobs_by_time"], totals: ["jobs_month", "jobs_month"] }), {
            message: "Data.bindPaged: repeated index 'jobs_month'",
        });
        assert.throws(() => Data.bindPaged(jobs, { indexes: ["jobs_by_time"], totals: ["jobs_month", "jobs_month_too"] }), {
            message: "Data.bindPaged: 'jobs_month' and 'jobs_month_too' are each the record's totals a month over the same leading fields — list one",
        });
        assert.doesNotThrow(() => Data.bindPaged(jobs, { indexes: ["jobs_by_time"], totals: ["jobs_month", "jobs_by_hall_month"] }),
            "a month's totals led by the hall beside those led by none: each a narrowing's");
        assert.throws(() => Data.bindPaged(jobs, { indexes: ["jobs_by_time"], totals: "jobs_month" as never }), {
            message: "Data.bindPaged: totals lists the names of record 'data_totals_jobs''s summaries with no key, the record's totals a tile — " +
                "it declares 'jobs_month', 'jobs_quarter', 'jobs_by_hall_month', 'jobs_month_too', 'jobs_ending_month', 'jobs_by_title_month'",
        });
        assert.throws(() => Data.bindPaged(jobs, { indexes: ["jobs_by_time"], totals: ["jobs_week" as never] }), {
            message: "Data.bindPaged: record 'data_totals_jobs' declares no index 'jobs_week' — it declares 'jobs_by_time', 'jobs_by_hall_time', 'jobs_by_hall', " +
                "'jobs_by_press_month', 'jobs_by_hall_series', 'jobs_by_title_series', 'jobs_month', 'jobs_quarter', 'jobs_by_hall_month', 'jobs_month_too', " +
                "'jobs_ending_month', 'jobs_by_title_month'",
        });
    });

    test("the rail refuses, in its words, totals a horizon over the source's range cannot read", () => {
        const listing = (totals: readonly string[]) => Data.bindPaged(jobs, { indexes: ["jobs_by_time", "jobs_by_hall_time", "jobs_by_hall"], totals: totals as never });
        assert.throws(() => configOf(listing(["jobs_month"]), {}), {
            message: "Slice.bindRecord: 'jobs_month', the record's totals a month, is read by a horizon over the source's range, and the source has none — " +
                "give it its range, range: \"start\"",
        });
        assert.throws(() => configOf(listing(["jobs_ending_month"]), { range: "start" }), {
            message: "Slice.bindRecord: 'jobs_ending_month', the record's totals a month, counts the events from 'end', and the source's range is 'start' — " +
                "a horizon counts what its window shows: declare them from it, index.totals({ from: \"start\", to: \"end\", tile: \"month\" })",
        });
        assert.throws(() => configOf(listing(["jobs_by_title_month"]), { range: "start" }), {
            message: "Slice.bindRecord: 'jobs_by_title_month', the record's totals a month, is led by 'title', which no read of the source chooses — the rail " +
                "offers no control of it, the scope holds none, and no series index in time order the source lists is led by it: lead them by fields the " +
                "rail offers, the scope holds or such an index is led by, or by none",
        });
        assert.throws(() => configOf(listing(["jobs_month"]), { range: "start", scope: { hall: ["H-1"] } }), {
            message: "Slice.bindRecord: 'jobs_month', the record's totals a month, is not led by the scope's 'hall', which every read of the source holds — " +
                "lead them by the scope's fields, index.totals({ on: [\"hall\"], from: \"start\", to: \"end\", tile: \"month\" })",
        });
        const scoped = configOf(listing(["jobs_by_hall_month"]), { range: "start", scope: { hall: ["H-1"] } });
        assert.ok(scoped.indexes.some((index) => index.name === "jobs_by_hall_month"), "led by the scope's fields: read under it");
    });

    test("takes totals led by the fields a series index in time order it lists is led by, which a builder fills from its rows (#1716)", () => {
        // The rail offers the dates alone; the jobs are read a week at a time under their hall, which a Plan fills from its groups.
        const grouped = configOf(Data.bindPaged(jobs, { indexes: ["jobs_by_time", "jobs_by_hall_series"], totals: ["jobs_month", "jobs_by_hall_month"] }),
            { range: "start", fields: { start: {} } });
        assert.ok(grouped.indexes.some((index) => index.name === "jobs_by_hall_month"), "led by the series index's field: a group's row reads them");
        assert.deepEqual(grouped.fields.map((field) => field.fieldId), ["start"], "and the rail offers no control of it");
        // A series index in its keys' order is read a key at a time, its leading fields never filled from the rows.
        assert.throws(() => configOf(Data.bindPaged(jobs, { indexes: ["jobs_by_time", "jobs_by_title_series"], totals: ["jobs_by_title_month"] }),
            { range: "start", fields: { start: {} } }), {
            message: "Slice.bindRecord: 'jobs_by_title_month', the record's totals a month, is led by 'title', which no read of the source chooses — the rail " +
                "offers no control of it, the scope holds none, and no series index in time order the source lists is led by it: lead them by fields the " +
                "rail offers, the scope holds or such an index is led by, or by none",
        });
    });

    test("refuses two totals at the same tile whose leading fields are permutations of each other", () => {
        const permRec = e3.record("data_totals_perm_jobs", DictType(StringType, Job), {
            initial: new Map(),
            indexes: (index) => ({
                by_time: index.interval({ from: "start", to: "end" }),
                by_hall_title: index.totals({ on: ["hall", "title"], from: "start", to: "end", tile: "month" }),
                by_title_hall: index.totals({ on: ["title", "hall"], from: "start", to: "end", tile: "month" }),
            }),
        });
        assert.throws(() => Data.bindPaged(permRec, { indexes: ["by_time"], totals: ["by_hall_title", "by_title_hall"] }), {
            message: "Data.bindPaged: 'by_hall_title' and 'by_title_hall' are each the record's totals a month over the same leading fields — list one",
        });
    });
});
