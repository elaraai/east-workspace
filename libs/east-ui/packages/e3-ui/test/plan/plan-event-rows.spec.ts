/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Events into rows (#1192, `Plan Builder Spec.md` §9.4, PB12–PB17) — what is
 * checked of them without e3: the refusals a Plan of event kinds makes as it
 * is built. The rows it draws over a window read the print works' records, so
 * they are drawn in e3-ui-components on e3 itself
 * (`test/plan-event-rows.spec.ts`): a resource as a row per way its kinds
 * draw, nesting and group strips, the Unassigned rows, drafts in place, what
 * the viewer hides and what the rail shows.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, FloatType, NullType, StringType, StructType, type BlockBuilder } from "@elaraai/east";
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

// ============================================================================
// Refused at build
// ============================================================================

describe("the event rows' refusals", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });
    const jobsOf = ($: BlockBuilder<NullType>) => {
        const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
        return Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } });
    };
    const pressesOf = ($: BlockBuilder<NullType>, measures: readonly unknown[] = []) => {
        const presses = $.let(Record.bind(ex.planPrintPresses, []));
        return Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall, measures: measures as never });
    };
    const heat = (key: string) => Plan.series.heat(ex.PrintPress, { key, title: "Heat", label: () => "Heat", cells: () => Plan.heatCells([]) });

    test("a resource kind no event kind is placed on, with no measures, would draw no rows", () => {
        assert.match(refusal(($) => {
            const crews = $.let(Record.bind(ex.planPrintCrews, []));
            return Plan.Payload({ axis, resources: { presses: pressesOf($), crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name }) }, events: { job: jobsOf($) } });
        }), /^Plan: resources\.crews has no event kind placed on it and no measures, so it would draw no rows — place an event kind on it \(Schedule\.events' `resource: \{ field, of: "crews" \}`\), or give it `measures`$/);
        // With a measure it draws that.
        assert.equal(refusal(($) => {
            const crews = $.let(Record.bind(ex.planPrintCrews, []));
            const load = Plan.series.heat(ex.PrintCrew, { key: "load", title: "Load", label: () => "Load", cells: () => Plan.heatCells([]) });
            return Plan.Payload({ axis, resources: { presses: pressesOf($), crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name, measures: [load] }) }, events: { job: jobsOf($) } });
        }), "");
    });

    test("a key the Plan gives its event rows that a measure, a `data` series or a Plan.over series has", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($, [heat("presses.span")]) }, events: { job: jobsOf($) } })),
            /^Plan: the span rows of resources\.presses and resources\.presses\.measures\[0\] have the same key, "presses\.span" — a row's id is its series' key and its path, so no two series share one$/);
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($, [heat("presses.group")]) }, events: { job: jobsOf($) } })),
            /^Plan: the group strips of resources\.presses and resources\.presses\.measures\[0\] have the same key, "presses\.group"/);
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($, [heat("presses")]) }, events: { job: jobsOf($) } })),
            /^Plan: resources\.presses\.measures\[0\] has the key "presses", the slot's own — a resource kind's rows are laid out by a series of that key; give the measure another$/);
        const Row = StructType({ v: FloatType });
        assert.match(refusal(($) => Plan.Payload({
            axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) },
            data: $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row)),
            series: [Plan.series.events(Row, { key: "job.unassigned", title: "Marks", label: (_r, k) => k, marks: () => [] })],
        })), /^Plan: the Unassigned row of events\.job and a series in `series` have the same key, "job\.unassigned"/);
        // A key a series nested in another has, too.
        assert.match(refusal(($) => Plan.Payload({
            axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) },
            data: $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row)),
            series: [Plan.series.section(Row, { key: "rows", title: "Rows" }, [
                Plan.series.events(Row, { key: "presses.span", title: "Marks", label: (_r, k) => k, marks: () => [] }),
            ])],
        })), /^Plan: the span rows of resources\.presses and a series in `series` have the same key, "presses\.span"/);
        assert.match(refusal(($) => {
            const stock = $.let(Data.bind(ex.planLinkStock));
            return Plan.Payload({
                axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) },
                rows: [Plan.over(stock, [Plan.series.table(ex.PrintStock, { key: "presses.span", title: "Stock", label: (s) => s.name })])],
            });
        }), /^Plan: the span rows of resources\.presses and rows\[0\] \(Plan\.over\) have the same key, "presses\.span"/);
    });
});
