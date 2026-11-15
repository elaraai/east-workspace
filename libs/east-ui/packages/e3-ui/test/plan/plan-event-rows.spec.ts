/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Events onto rows (#1192, #1541 U1) — what is checked of them without e3: the
 * refusals a Plan of event kinds makes as it is built, word for word. Where the
 * events land is `plan-landing.spec.ts`, over values; the rows drawn over the
 * print works' records are drawn in e3-ui-components on e3 itself.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DictType, East, IntegerType, NullType, StringType, StructType, type BlockBuilder } from "@elaraai/east";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-events.examples.js";

/** Run `build` inside a block, as `<Plan>`'s factory runs; what it throws, or `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");
const WINDOW = { min: FIRST, max: LAST };

describe("the event rows' refusals", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });
    const jobsOf = ($: BlockBuilder<NullType>, of = "presses") => {
        const jobs = $.let(Record.bind(ex.planPrintJobs));
        return Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of } });
    };
    const stopsOf = ($: BlockBuilder<NullType>) => Schedule.events($.let(Record.bind(ex.planPrintStops)), {
        name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" },
    });
    const pressRows = ($: BlockBuilder<NullType>) => $.let(Record.bind(ex.planPrintPresses, [])).read();
    const presses = (key = "presses") => Plan.series.resources(ex.PrintPress, { key, title: "Presses", icon: "print", label: (p) => p.name });

    test("`resources` is removed, refused naming the series that replaces it", () => {
        assert.equal(refusal(($) => Plan.Payload({
            axis, resources: {}, events: { job: jobsOf($) }, data: pressRows($), series: [presses()],
        } as never)), "Plan: `resources` is removed (#1541) — the rows are the resources: lay them out with " +
            "Plan.series.resources(Row, { key, title, label }) over the record they are read from (`data`, or the slice's `rows` source), or a case " +
            "of Plan.series.kinds for each kind of resource, and name that series' key in each event kind's resource.of — a resource kind's " +
            "`measures` are the series' `series`, its `parent` a tree (`children`), and its `group` a Plan.series.group around it");
    });

    test("an event kind lands on a resources series or a kinds case by its key, and on no other name", () => {
        assert.equal(refusal(($) => Plan.Payload({ axis, events: { job: jobsOf($) }, data: pressRows($), series: [presses()] })), "");
        assert.equal(refusal(($) => Plan.Payload({ axis, events: { job: jobsOf($, "machines") }, data: pressRows($), series: [presses()] })),
            "Plan: events.job's resource names \"machines\", and no resources series or kinds case has that key (presses) — the event kinds " +
            "land on the rows of a Plan.series.resources series, or of a Plan.series.kinds case, by its key");
        // A series that is no resources series is not landed on, whatever its key.
        assert.match(refusal(($) => Plan.Payload({
            axis, events: { job: jobsOf($) }, data: pressRows($),
            series: [Plan.series.span(ex.PrintPress, { key: "presses", title: "Presses", label: (p) => p.name, runs: () => [] })],
        })), /^Plan: events\.job's resource names "presses", and no resources series or kinds case has that key \(none\)/);
    });

    test("the rows an event kind lands on are known as the Plan is built, keyed by String, and given", () => {
        assert.equal(refusal(($) => {
            const list = $.const([presses()], ArrayType(Plan.Types.Series(ex.PrintPress)));
            return Plan.Payload({ axis, events: { job: jobsOf($) }, data: pressRows($), series: list });
        }), "Plan: the event kinds land on the rows of a resources series, known as the Plan is built — give `series` the list itself, " +
            "each series written in place: [Plan.series.resources(Row, { key, title, label }), …]");
        const Counted = StructType({ name: StringType });
        assert.equal(refusal(($) => Plan.Payload({
            axis, events: { job: jobsOf($) },
            data: $.const(new Map([[1n, { name: "Press 1" }]]), DictType(IntegerType, Counted)),
            series: [Plan.series.resources(Counted, { key: "presses", title: "Presses", keyType: IntegerType, label: (p) => p.name })],
        })), "Plan: events.job's resource field holds String keys of the rows of \"presses\", which are keyed by .Integer — key the rows by String");
        assert.equal(refusal(($) => {
            const stock = $.let(Data.bind(ex.planLinkStock));
            return Plan.Payload({
                axis, events: { job: jobsOf($) }, series: [presses()],
                rows: [Plan.over(stock, [Plan.series.table(ex.PrintStock, { key: "stock", title: "Stock", label: (s) => s.name })])],
            });
        }), "Plan: the event kinds land on the canvas's rows, and this Plan has none — give the rows they land on, `data` or the slice's " +
            "`rows` source, laid out by a series of them: Plan.series.resources(Row, { key, title, label }), named by each kind's resource.of");
    });

    test("a key the Plan gives a resource's further rows, or a kind's Unassigned row, that another series has", () => {
        // The jobs draw bars on the landing row; the stops' marks a row of their own, `presses.marks`.
        assert.equal(refusal(($) => Plan.Payload({
            axis, events: { job: jobsOf($), stop: stopsOf($) }, data: pressRows($),
            series: [presses(), Plan.series.events(ex.PrintPress, { key: "presses.marks", title: "Marks", label: (p) => p.name, marks: () => [] })],
        })), "Plan: the marks rows of \"presses\" and a series in `series` have the same key, \"presses.marks\" — a row's id is its series' key and its path, so no two series share one");
        assert.match(refusal(($) => Plan.Payload({
            axis, events: { job: jobsOf($) }, data: pressRows($),
            series: [presses(), Plan.series.section(ex.PrintPress, { key: "rows", title: "Rows" }, [
                Plan.series.events(ex.PrintPress, { key: "job.unassigned", title: "Marks", label: (p) => p.name, marks: () => [] }),
            ])],
        })), /^Plan: the Unassigned row of events\.job and a series in `series` have the same key, "job\.unassigned"/);
        assert.match(refusal(($) => {
            const stock = $.let(Data.bind(ex.planLinkStock));
            return Plan.Payload({
                axis, events: { job: jobsOf($), stop: stopsOf($) }, data: pressRows($), series: [presses()],
                rows: [Plan.over(stock, [Plan.series.table(ex.PrintStock, { key: "presses.marks", title: "Stock", label: (s) => s.name })])],
            });
        }), /^Plan: the marks rows of "presses" and rows\[0\] \(Plan\.over\) have the same key, "presses\.marks"/);
    });
});
