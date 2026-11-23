/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a builder checks of the indexes an event kind's source lists, as it is
 * evaluated (#1039, #1424, #1732): `checkedScheduleTilings` run over the Slice
 * config of a real binding, on a platform that reads nothing. A summary by key
 * is filed by the kind's resource field; the record's totals, which a horizon
 * counts the kind's events by, are over the kind's own times, and filed by no
 * resource, so they are no summary beside a series index — a kind on paged
 * resources still lists one. Each refusal in its words.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, DictType, East, NullType, StringType, StructType } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { bindRecord } from "@elaraai/east-ui/internal";
import { Data, Record, Schedule } from "@elaraai/e3-ui/internal";
import { checkedScheduleTilings, scheduleResourcePaging, type SchedulePaging } from "../../src/schedule/cell-checks.js";
import { refusingPlatform } from "../refusing-platform.js";

/** A job: the press it runs on, when, when it is due, and its title. */
const Job = StructType({ press: StringType, start: DateTimeType, end: DateTimeType, due: DateTimeType, title: StringType });
const jobs = e3.record("cell_checks_jobs", DictType(StringType, Job), {
    initial: new Map(),
    mutations: (mutation) => ({ patch: mutation.patch() }),
    indexes: (index) => ({
        jobs_by_time: index.interval({ from: "start", to: "end" }),
        jobs_by_press_week: index.series({ key: "press", from: "start", to: "end", tile: "week" }),
        jobs_by_press_month: index.summary({ key: "press", from: "start", to: "end", tile: "month" }),
        jobs_by_title_month: index.summary({ key: "title", from: "start", to: "end", tile: "month" }),
        // The record's totals a month over the jobs' own times, and over the start to when each is due.
        jobs_month: index.summary({ from: "start", to: "end", tile: "month" }),
        jobs_due_month: index.summary({ from: "start", to: "due", tile: "month" }),
    }),
});

/** The jobs' kind, declared in a block as a builder's are: placed on the presses, over its own times. */
const kind = ((): Parameters<typeof checkedScheduleTilings>[1] => {
    let declared: unknown;
    East.function([], NullType, ($) => {
        const bound = $.let(Record.bind(jobs, ["patch"]));
        declared = Schedule.events(bound as never, { name: "Job", icon: "i", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } } as never);
    });
    return declared as Parameters<typeof checkedScheduleTilings>[1];
})();

/** A Plan whose rows are the presses, paged: the kind is placed on them alone. */
const pagedPresses: SchedulePaging = { paged: "the rows", split: () => ({ paged: ["the rows"], whole: [] }) };

/** Run the Plan's check of the kind's source listing these indexes beside its interval index, and these totals. */
function check(paging: SchedulePaging, indexes: readonly string[], totals: readonly string[]): void {
    East.compile(East.function([], NullType, ($) => {
        const source = Data.bindPaged(jobs, { indexes: ["jobs_by_time", ...indexes] as never, totals: totals as never });
        const sliced = $.let(bindRecord("job", source, { range: "start" } as never));
        $(checkedScheduleTilings("job", kind, paging, sliced.config, "Plan"));
        return null;
    }), refusingPlatform)();
}

describe("checkedScheduleTilings", () => {
    test("passes a summary filed by the kind's resource and the record's totals over its own times", () => {
        assert.doesNotThrow(() => check(scheduleResourcePaging([]), ["jobs_by_press_month"], ["jobs_month"]));
        assert.doesNotThrow(() => check(scheduleResourcePaging([]), [], ["jobs_month"]), "the record's totals alone, filed by no resource");
        assert.doesNotThrow(() => check(pagedPresses, ["jobs_by_press_week", "jobs_by_press_month"], ["jobs_month"]));
    });

    test("refuses, in its words, a summary filed by another field than the kind's resource", () => {
        assert.throws(() => check(scheduleResourcePaging([]), ["jobs_by_title_month"], []), {
            message: "Plan: events.job's source lists the summary index \"jobs_by_title_month\", filed by \"title\" — a Plan reads it by the kind's " +
                "resource field: key: \"press\"",
        });
    });

    test("refuses, in its words, the record's totals over other times than the kind's (#1732)", () => {
        assert.throws(() => check(scheduleResourcePaging([]), [], ["jobs_due_month"]), {
            message: "Plan: events.job's source lists the totals \"jobs_due_month\", over \"start\" to \"due\" — a Plan's horizon counts the kind's " +
                "events over their own times: from: \"start\", to: \"end\"",
        });
    });

    test("takes the record's totals for no summary beside a series index, nor for one on paged resources (#1732)", () => {
        assert.throws(() => check(pagedPresses, ["jobs_by_press_week"], ["jobs_month"]), {
            message: "Plan: events.job's source lists the series index \"jobs_by_press_week\", and no summary index — the Plan draws a series index's " +
                "events while they fit, and its summary's shading past that: declare index.summary({ key: \"press\", from: \"start\", to: \"end\", " +
                "tile: \"month\" }) over the same record and list it beside the series index",
        });
        assert.throws(() => check(pagedPresses, [], ["jobs_month"]), {
            message: "Plan: events.job's source lists no series index and no summary index, and the kind is placed on the rows, paged — a paged " +
                "kind's events are read a cell at a time, and shaded past what the Plan draws: declare index.series({ key: \"press\", from: \"start\", " +
                "to: \"end\", tile: \"week\" }) and index.summary({ key: \"press\", from: \"start\", to: \"end\", tile: \"month\" }) over the same " +
                "record and list them beside its interval index",
        });
    });
});
