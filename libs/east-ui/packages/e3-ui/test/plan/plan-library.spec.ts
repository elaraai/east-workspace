/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's library pane (#1195, `Plan Builder Spec.md` §4.3, §9.6, PB26,
 * PB29, PB61, PB62) — what is checked of it without e3: the Series tab on a
 * Plan with nothing a viewer can hide, `Schedule.patch`'s type and value, and
 * every refusal at build, naming itself. A payload reads the print works'
 * records as it is built, so the tabs `library` lists, the Series tab's lines
 * and what hiding each hides, and an author's tab's cards and what a card
 * dropped on an event sets are checked in e3-ui-components on e3 itself
 * (`test/plan-library-payload.spec.ts`). What the viewer hides leaves the
 * event kinds' rows in `plan-event-rows.spec.ts`, and the pane the renderer
 * draws is e3-ui-components'.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    equalFor, isTypeEqual, none, some, variant,
    type BlockBuilder,
} from "@elaraai/east";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-events.examples.js";

/** What `build` throws inside a block, as `<Plan>`'s factory runs; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

const WINDOW = { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") };

/** The presses, bound inside a block. */
function pressesOf($: BlockBuilder<never>) {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    return Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name });
}

/** The jobs over the presses, bound inside a block, their unscheduled ones in the backlog. */
function jobsOf($: BlockBuilder<never>) {
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
    });
}

/** The customers' tab, bound inside a block: a card a customer, by district, which sets a job's customer. */
function customersOf($: BlockBuilder<never>, name = "Customers") {
    const customers = $.let(Record.bind(ex.planPrintCustomers, []));
    return Plan.library.tab(customers.read(), {
        name, icon: "building",
        label: (c) => c.name, meta: (c) => some(c.trade), group: (c) => c.district,
        drop: (c) => Schedule.patch(ex.PrintJob, { customer: c.name }),
    });
}

// ============================================================================
// The Series tab (PB29)
// ============================================================================

describe("the Series tab (PB29)", () => {
    test("the Series tab is a Plan's with anything a viewer can hide: `data`'s series when they are picked, and nothing else", () => {
        const Row = StructType({ v: FloatType });
        const marks = Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: () => [] });
        assert.equal(refusal(($) => {
            const data = $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row));
            const all = $.const([marks], ArrayType(Plan.Types.Series(Row)));
            const picked = $.let(Plan.pick("lib.pick", all));
            return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), data, pick: picked, library: [Plan.library.series()] });
        }), "");
        assert.match(refusal(($) => {
            const data = $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row));
            return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), data, series: [marks], library: [Plan.library.series()] });
        }), /^Plan: the library lists Plan\.library\.series\(\), and this Plan has nothing a viewer can hide — it lists event kinds, resource kinds and their measures, `rows`, and `data`'s series when they are picked \(`pick`\)$/);
    });
});

// ============================================================================
// An author's tab (PB62)
// ============================================================================

describe("an author's tab (PB62)", () => {
    test("Schedule.patch: every field of the row type an Option, the fields it sets some and the rest none", () => {
        const Patch = Schedule.Types.Patch(ex.PrintCustomer);
        assert.ok(isTypeEqual(Patch, StructType({ name: OptionType(StringType), district: OptionType(StringType), trade: OptionType(StringType) })));
        const patch = East.compile(East.function([StringType], Patch, (_$, trade) => Schedule.patch(ex.PrintCustomer, { name: "Ivy Lane Studio", trade })), [])("Design");
        assert.ok(equalFor(Patch)(patch, { name: some("Ivy Lane Studio"), district: none, trade: some("Design") }));
    });
});

// ============================================================================
// Refused at build, each naming itself (PB61, PB62)
// ============================================================================

describe("the library's refusals (PB61, PB62)", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });
    const overJobs = ($: BlockBuilder<NullType>, library: readonly ReturnType<typeof Plan.library.events>[]) =>
        Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, library });

    test("a tab listed twice, the author's by its name", () => {
        assert.match(refusal(($) => overJobs($, [Plan.library.events(), Plan.library.series(), Plan.library.events()])),
            /^Plan: the library lists Plan\.library\.events\(\) twice — each tab once$/);
        assert.match(refusal(($) => overJobs($, [customersOf($), customersOf($)])),
            /^Plan: the library lists two tabs named "Customers" — each tab's name is its own$/);
        // Two of the author's own, each named apart, are two tabs.
        assert.equal(refusal(($) => overJobs($, [customersOf($), customersOf($, "Accounts")])), "");
    });

    test("a `drop` whose patch is over no event kind's row type, or over one two kinds share", () => {
        const customers = ($: BlockBuilder<NullType>) => $.let(Record.bind(ex.planPrintCustomers, []));
        assert.match(refusal(($) => overJobs($, [Plan.library.tab(customers($).read(), {
            name: "Customers", label: (c) => c.name, drop: (c) => Schedule.patch(ex.PrintCustomer, { name: c.name }),
        })])), /^Plan: the "Customers" tab's `drop` returns a patch over no event kind's row type — build it with Schedule\.patch\(RowType, \{ … \}\) over the row type of the kind its cards land on \(job\)$/);
        assert.match(refusal(($) => {
            const rush = $.let(Record.bind(ex.planLinkJobs, [ex.planLinkJobsPatch]));
            return Plan.Payload({
                axis, resources: { presses: pressesOf($) },
                events: {
                    job: jobsOf($),
                    rush: Schedule.events(rush, { name: "Rush job", icon: "bolt", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                },
                library: [customersOf($)],
            });
        }), /^Plan: the "Customers" tab's `drop` returns a patch over a row type 2 event kinds share \(job, rush\) — a card lands on one kind, so give each kind a row type of its own$/);
        // On a Plan of no event kinds, no kind takes it.
        assert.match(refusal(($) => Plan.Payload({ axis, rows: [Plan.events({ key: "ms", label: "Milestones" })], library: [customersOf($)] })),
            /^Plan: the "Customers" tab's `drop` returns a patch over no event kind's row type — .* \(this Plan has no event kinds\)$/);
    });

    test("the Events or the Backlog tab on a Plan with no event kinds", () => {
        const rows = [Plan.events({ key: "ms", label: "Milestones" })];
        assert.match(refusal(() => Plan.Payload({ axis, rows, library: [Plan.library.events()] })),
            /^Plan: the library lists Plan\.library\.events\(\), and this Plan has no event kinds — its templates are its event kinds' \(Schedule\.events\)$/);
        assert.match(refusal(() => Plan.Payload({ axis, rows, library: [Plan.library.backlog()] })),
            /^Plan: the library lists Plan\.library\.backlog\(\), and this Plan has no event kinds — its unscheduled events are its event kinds' \(Schedule\.events\)$/);
    });

    test("an author's tab over rows that are not a Dict", () => {
        assert.match(refusal(($) => overJobs($, [Plan.library.tab($.const([1n], ArrayType(IntegerType)) as never, { name: "Numbers", label: () => "n" })])),
            /^Plan: the "Numbers" tab reads its rows as Schedule\.resources does — a Dict, usually a record's read\(\) — and these are \.Array \.Integer$/);
    });
});
