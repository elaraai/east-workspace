/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The one `<Plan>`'s event kinds and read-only rows (#1191, `Plan Builder
 * Spec.md` §3.2, §3.3, §4.3, §5.2, PB8–PB11) — what is checked of them
 * without e3: the examples run; a Plan's payload is one type whatever its
 * records hold, and returns through the `Plan` carrier; every refusal at
 * build names itself; and its narrowing is one `Slice.bindRecords`, each
 * kind's templates a record of its own naming its source (#1344), refused in
 * every other form with the change to make. A payload reads the print works'
 * records as it is built, so the payload itself — the canvas beside the
 * resource kinds and event kinds, its templates, links, rows over a dataset,
 * drop veto and inspector (#1197), and the refusals a Plan makes as it is
 * evaluated — is checked in e3-ui-components on e3 itself
 * (`test/plan-events-payload.spec.ts`). The resources' rows over a window are
 * `plan-event-rows`' (#1192).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, Expr, FloatType, FunctionType, IntegerType, NullType, OptionType,
    StringType, StructType, decodeBeast2For, equalFor, isTypeEqual, none, some, variant,
    type BlockBuilder, type EastType,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Slice, UIComponentType } from "@elaraai/east-ui";
import { Text } from "@elaraai/east-ui/internal";
import { Data, Plan, PlanPayloadType, Record, Schedule, planKeys } from "@elaraai/e3-ui/internal";
import { Plan as PublicPlan } from "@elaraai/e3-ui";
import * as ex from "./plan-events.examples.js";

describeEast("Plan of event kinds — the examples (#1191)", (test) => {
    Assert.examples(test, {
        planEvents: ex.planEvents,
        planPrintWorks: ex.planPrintWorks,
        planEventLinks: ex.planEventLinks,
    });
}, { platformFns: TestImpl });

/** Run `build` inside a block, as `<Plan>`'s factory runs. */
function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
    let out: T | undefined;
    East.function([], NullType, ($) => { out = build($); });
    return out!;
}

/** What `build` throws inside a block; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        inBlock(build);
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");
const WINDOW = { min: FIRST, max: LAST };

/** The jobs over the presses, bound inside a block: the event kind §3.2 declares. */
function jobsOf($: BlockBuilder<NullType>) {
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines",
        title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
    });
}

/** The jobs over the presses, bound inside a block, with more of a kind's options. */
function jobsOf2($: BlockBuilder<NullType>, more: globalThis.Record<string, unknown>) {
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines",
        title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, ...more,
    } as never);
}

/** The presses, bound inside a block: the resource kind §3.2 declares. */
function pressesOf($: BlockBuilder<NullType>) {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    return Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name });
}

/** A source of two entries, as a Plan's `data`, and a series over it. */
const Row = StructType({ v: FloatType });
const Rows = DictType(StringType, Row);
const ROWS = new Map([["a", { v: 1.0 }], ["b", { v: 2.0 }]]);
const MARKS = Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: () => [] });

// ============================================================================
// The payload (PB8, PB11)
// ============================================================================

describe("the payload (PB8, PB11)", () => {
    test("every Plan's payload is one type, whatever its records hold — each kind's rows closed behind functions over bytes", () => {
        inBlock(($) => {
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            const axis = $.let(Plan.axis({ window: WINDOW, resolution: "day" }));
            const resources = { presses: pressesOf($) };
            const ofJobs = Plan.Payload({ axis, resources, events: { job: jobsOf($) } });
            const ofStops = Plan.Payload({
                axis, resources,
                events: { stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" } }) },
            });
            for (const payload of [ofJobs, ofStops]) assert.ok(isTypeEqual(Expr.type(payload as unknown as Expr) as EastType, PlanPayloadType));
        });
    });

    test("<Plan> returns its payload through the `Plan` carrier", () => {
        const ui = East.compile(East.function([], UIComponentType, (_$) => PublicPlan({
            axis: Plan.axis({ window: WINDOW, resolution: "day" }),
            rows: [Plan.events({ key: "ms", label: "Milestones", marks: [Plan.mark({ key: "go", at: FIRST, kind: "milestone" })] })],
        })), [])();
        if (ui.type !== "Extension") assert.fail(`expected the Plan extension, got the ${ui.type} arm`);
        assert.equal(ui.value.kind, "Plan");
        const payload = decodeBeast2For(PlanPayloadType)(ui.value.payload);
        assert.deepEqual(payload.plan.rows.type === "inline" ? payload.plan.rows.value.map((b) => b.rows.length) : [], [1]);
        assert.deepEqual([payload.resources.length, payload.events.length], [0, 0]);
    });

    test("the keys a Plan keeps its viewer's state under follow its `id`", () => {
        assert.deepEqual(planKeys(undefined), { frame: "plan.frame", series: "plan.series", library: "plan.library", surface: "plan.surface" });
        assert.deepEqual(planKeys("ops"), { frame: "plan.ops.frame", series: "plan.ops.series", library: "plan.library.ops", surface: "plan.ops.surface" });
    });
});

// ============================================================================
// Refused at build, each naming itself (PB8–PB10)
// ============================================================================

describe("the Plan's refusals (PB8)", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });

    test("a Plan with no rows from any source, naming the three — and a canvas's root with neither `data` nor rows", () => {
        assert.match(refusal(() => Plan.Payload({ axis })),
            /^Plan: needs its rows — `data` and its `series`, `slice`'s `rows` source, event kinds \(`events` over `resources`\), or read-only `rows`$/);
        assert.match(refusal(() => Plan.Root({ axis } as never)), /^Plan: `data` is required — a canvas is its data plus the series over it$/);
    });

    test("resources without event kinds, no event kind, and kinds a Schedule factory did not build", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) } })),
            /^Plan: `resources` are the rows events are placed on — declare `events`, the event kinds over records \(Schedule\.events\)$/);
        assert.match(refusal(() => Plan.Payload({ axis, events: {} })), /^Plan: `events` declares at least one event kind/);
        assert.match(refusal(() => Plan.Payload({ axis, events: { job: {} as never } })), /^Plan: events\.job is an event kind — Schedule\.events\(record, \{ … \}\)$/);
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: {} as never }, events: { job: jobsOf($) } })),
            /^Plan: resources\.presses is a resource kind — Schedule\.resources\(rows, \{ name, icon, label \}\)$/);
    });

    test("an event kind's resources in a slot `resources` lacks, or keyed by another type than String", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: {}, events: { job: jobsOf($) } })),
            /^Plan: events\.job's resource names the slot "presses", and `resources` has no slot of that name \(none\)$/);
        assert.match(refusal(($) => {
            const byNumber = $.const(new Map([[1n, { name: "Press 1", hall: "Hall A", sheets_per_hour: 1000.0 }]]), DictType(IntegerType, ex.PrintPress));
            return Plan.Payload({ axis, resources: { presses: Schedule.resources(byNumber, { name: "Presses", icon: "print", label: (p) => p.name }) }, events: { job: jobsOf($) } });
        }), /^Plan: events\.job's resource field holds String keys of resources\.presses, which is keyed by \.Integer — key the resources by String$/);
    });

    test("`series`, `pick` and `editing` with no `data` to read", () => {
        const rows = [Plan.events({ key: "ms", label: "Milestones" })];
        assert.match(refusal(() => Plan.Payload({ axis, rows, series: [MARKS] })), /^Plan: `series` reads `data`'s entries — pass `data` with it, or place read-only rows with `rows`$/);
        assert.match(refusal(() => Plan.Payload({ axis, rows, editing: {} })), /^Plan: `editing` reads `data`'s entries/);
    });

    test("a `rows` item that is neither a hand-built row nor Plan.over's", () => {
        assert.match(refusal(() => Plan.Payload({ axis, rows: [East.value("a row") as never] })),
            /^Plan: rows\[0\] is a row a kind factory builds \(Plan\.chart, Plan\.span, …\) or Plan\.over\(data, \[series…\]\) — and this one is \.String$/);
    });

    test("a `canDrop` over neither a drag nor a candidate, or over a candidate with no event kinds", () => {
        const neither = East.function([StringType], BooleanType, () => true);
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], canDrop: neither as never })),
            /^Plan: `canDrop` vets a drop — Fn\(DragEvent\) → Boolean over a drag on `data`'s rows, or Fn\(Schedule\.Types\.Candidate\) → Option<String> over an event kind's drop, its message on the ghost — and this one is/);
        const candidate = East.function([Schedule.Types.Candidate], OptionType(StringType), () => none);
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], canDrop: candidate })),
            /^Plan: `canDrop` over Schedule\.Types\.Candidate vets an event kind's drop, and this Plan has no event kinds$/);
    });

    test("an `applyMode` that is neither batch nor auto, or with no event kinds", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, applyMode: "sometimes" as never })),
            /^Plan: `applyMode` is "batch" or "auto" — and it is "sometimes"$/);
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], applyMode: "auto" })),
            /^Plan: `applyMode` says when the event kinds' drafts go, and this Plan has none — `data`'s session takes `editing\.mode`$/);
    });
});

describe("its narrowing (#1344): one Slice.bindRecords, each source named after what it narrows", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });
    const jobIndex = () => Data.bindPaged(ex.planPrintJobs, { indexes: [ex.planPrintJobsByTime, ex.planPrintJobsByStockTime] });
    const jobEntries = ($: BlockBuilder<NullType>) => $.let(Data.bindPaged(ex.planPrintJobs));
    /** The jobs, narrowed through the slice's `job` source when `entries` is given. */
    const narrowedJobs = ($: BlockBuilder<NullType>, more: globalThis.Record<string, unknown> = {}) => {
        const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
        return Schedule.events(jobs, {
            name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" },
            entries: jobEntries($), ...more,
        } as never);
    };
    const jobSlice = (key = "spec.jobs") => Slice.bindRecords(key, {
        job: { source: jobIndex(), fields: { stock: { label: "Stock" }, start: { label: "Dates" } }, range: "start" },
    });
    const jobTemplates = ($: BlockBuilder<NullType>, source?: string) => Schedule.templates($.let(Data.bind(ex.planPrintJobTemplates)).read(), {
        name: (t) => t.name, duration: (t) => variant("hours", t.hours), values: (t) => t.values, ...(source === undefined ? {} : { source }),
    });
    const templatesIndex = () => Data.bindPaged(ex.planPrintJobTemplates, { indexes: [ex.planPrintJobTemplatesByGroup] });

    test("an event kind's source, a resource kind's, a templates list's and a tab's: the Plan takes each, and builds", () => {
        assert.equal(refusal(($) => {
            const customers = $.let(Data.bind(ex.planPrintCustomers));
            const slice = Slice.bindRecords("spec.all", {
                job: { source: jobIndex(), fields: { stock: { label: "Stock" }, start: { label: "Dates" } }, range: "start" },
                presses: { source: Data.bindPaged(ex.planPrintPresses, { indexes: [ex.planPrintPressesByHall] }), fields: { hall: { label: "Hall", hints: ["Hall A", "Hall B"] } } },
                jobTemplates: { source: templatesIndex() },
                customers: { source: Data.bindPaged(ex.planPrintCustomers, { indexes: [ex.planPrintCustomersByDistrict] }), fields: { district: { label: "District", hints: ["Old Town"] } } },
            });
            const payload = Plan.Payload({
                axis, slice: { slice }, resources: { presses: pressesOf($) },
                events: { job: narrowedJobs($, { templates: jobTemplates($, "jobTemplates") }) },
                library: [Plan.library.events(), Plan.library.tab(customers.read(), { name: "Customers", label: (c) => c.name, source: "customers" })],
            });
            assert.ok(isTypeEqual(Expr.type(payload as unknown as Expr) as EastType, PlanPayloadType));
        }), "");
    });

    test("the `rows` source is the canvas's data, paged from it, laid out by `series`: `data` beside it is refused, naming the change", () => {
        const Job = ex.PrintJob;
        const series = [Plan.series.span(Job, { key: "jobs", title: "Jobs", label: (j) => j.title,
            runs: (j, k) => [Plan.run({ key: k, start: j.start.unwrap("some"), end: j.end.unwrap("some"), label: j.title, state: "confirmed" })] })];
        // The rows' dates are a field of the rail: the canvas's rows never follow the dates on screen (#1344).
        const rowsSlice = () => Slice.bindRecords("spec.rows", { rows: { source: jobIndex(), fields: { start: { label: "Dates" } } } });
        assert.equal(refusal(() => {
            const payload = Plan.Payload({ axis, slice: { slice: rowsSlice() }, series });
            assert.ok(isTypeEqual(Expr.type(payload as unknown as Expr) as EastType, PlanPayloadType));
        }), "");
        assert.match(refusal(($) => Plan.Payload({ axis, slice: { slice: rowsSlice() }, series, data: $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch])) })),
            /^Plan: `slice`'s `rows` source gives the canvas its rows, paged from it — leave `data` out: data=\{Slice\.rows\(slice\)\} is gone, and the Plan reads its rows from the slice: slice=\{\{ slice \}\}$/);
    });

    test("an axis with no window of its own takes it from a source holding a range: a slice of the canvas's rows' sources alone holds none, and is refused, naming the change (#1344)", () => {
        const Job = ex.PrintJob;
        const series = [Plan.series.span(Job, { key: "jobs", title: "Jobs", label: (j) => j.title,
            runs: (j, k) => [Plan.run({ key: k, start: j.start.unwrap("some"), end: j.end.unwrap("some"), label: j.title, state: "confirmed" })] })];
        const windowless = () => Plan.axis({ resolution: "day" });
        const refused = /^Plan: the axis states no `window`, and no source of the slice holds one — the canvas's rows never follow the dates on screen, so neither the `rows` source nor a resource kind's holds the window: declare it, Plan\.axis\(\{ window: \{ min, max \}, … \}\), or name a range on an event kind's source or a tab's$/;
        // The rows' source alone…
        assert.match(refusal(() => Plan.Payload({ axis: windowless(), series,
            slice: { slice: Slice.bindRecords("spec.rows.only", { rows: { source: jobIndex(), fields: { start: { label: "Dates" } } } }) } })), refused);
        // …and beside a resource kind's.
        assert.match(refusal(($) => Plan.Payload({ axis: windowless(), resources: { presses: pressesOf($) }, events: { job: jobsOf($) },
            slice: { slice: Slice.bindRecords("spec.presses.only", { presses: { source: Data.bindPaged(ex.planPrintPresses, { indexes: [ex.planPrintPressesByHall] }), fields: { hall: { label: "Hall", hints: ["Hall A"] } } } }) } })), refused);
        // An event kind's source holds the window: a windowless axis takes it.
        assert.equal(refusal(($) => Plan.Payload({ axis: windowless(), resources: { presses: pressesOf($) }, events: { job: narrowedJobs($) }, slice: { slice: jobSlice() } })), "");
    });

    test("the bare handle, Slice.bind and a single Slice.bindRecord are refused, naming Slice.bindRecords and the Plan's sources", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: narrowedJobs($) }, slice: $.let(jobSlice()) as never })),
            /^Plan: `slice` takes \{ slice \} — slice=\{\{ slice: Slice\.bindRecords\(key, \{ rows, … \}\) \}\}: the bare handle is not taken$/);
        const named = /^Plan: `slice` is Slice\.bindRecords\(key, \{ rows, job, presses \}\) — name each source after what it narrows; Slice\.bind and Slice\.bindRecord are not taken$/;
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: narrowedJobs($) },
            slice: { slice: Slice.bindRecord("spec.single", jobIndex()) as never } })), named);
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: narrowedJobs($) },
            slice: { slice: Slice.bind("spec.local", [{ day: FIRST }], { fields: { day: { label: "Day" } }, range: "day" }) as never } })), named);
    });

    test("a source nothing names is refused, naming the sources the Plan takes", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: narrowedJobs($) },
            slice: { slice: Slice.bindRecords("spec.stray", { jobs: { source: jobIndex(), fields: { start: { label: "Dates" } }, range: "start" } }) } })),
            /^Plan: `slice` narrows its rows, its event kinds, its resource kinds, and the templates lists and tabs that name a source — its source 'jobs' is none of them; name the sources `rows`, `job` and `presses`$/);
    });

    test("an event kind's source over another record than the kind's is refused, naming the change", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: narrowedJobs($) },
            slice: { slice: Slice.bindRecords("spec.other", { job: { source: Data.bindPaged(ex.planPrintCustomers, { indexes: [ex.planPrintCustomersByDistrict] }), fields: { district: { label: "District", hints: ["Old Town"] } } } }) } })),
            /^Schedule\.events: "Print job": the builder's source "job" narrows another record — name it after this kind's slot over the kind's own record, Data\.bindPaged\(record, \{ indexes \}\), its rows joined$/);
    });

    test("a kind narrowed through its source needs its `entries`, and takes no `window` or `backlogWindow` beside it", () => {
        assert.match(refusal(($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            return Plan.Payload({ axis, resources: { presses: pressesOf($) }, slice: { slice: jobSlice() },
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) } });
        }), /^Schedule\.events: "Print job": the builder's source "job" reads only its narrowing — and one event, the inspector's or its editing's, is read by its key: give `entries` beside it/);
    });

    test("a paged resource kind its source narrows is paged from the narrowing's rows, and builds; a source over another record is refused, naming the change (#1344)", () => {
        const pagedPresses = ($: BlockBuilder<NullType>) =>
            Schedule.resources($.let(Data.bindPaged(ex.planPrintPresses)), { name: "Presses", icon: "print", label: (p) => p.name });
        // The jobs on the paged presses are read through their own source of the slice (#1039), which the Plan reads as it is evaluated.
        const job = { source: jobIndex(), fields: { start: { label: "Dates" } }, range: "start" as const };
        assert.equal(refusal(($) => {
            const payload = Plan.Payload({ axis, events: { job: narrowedJobs($) }, resources: { presses: pagedPresses($) },
                slice: { slice: Slice.bindRecords("spec.paged", { job, presses: { source: Data.bindPaged(ex.planPrintPresses, { indexes: [ex.planPrintPressesByHall] }), fields: { hall: { label: "Hall", hints: ["Hall A"] } } } }) } });
            assert.ok(isTypeEqual(Expr.type(payload as unknown as Expr) as EastType, PlanPayloadType));
        }), "");
        assert.match(refusal(($) => Plan.Payload({ axis, events: { job: narrowedJobs($) }, resources: { presses: pagedPresses($) },
            slice: { slice: Slice.bindRecords("spec.other", { job, presses: { source: Data.bindPaged(ex.planPrintCustomers, { indexes: [ex.planPrintCustomersByDistrict] }), fields: { district: { label: "District", hints: ["Old Town"] } } } }) } })),
            /^Plan: the slice's source "presses" narrows resources\.presses, and its rows are .+ — the kind's are .+: bind the source over the kind's own record, Data\.bindPaged\(record, \{ indexes \}\)$/);
    });

    test("templates are records: a list written in the code, or one naming no source of the slice, is refused with the change to make", () => {
        const change = /^Plan: templates are records now — bind them in Slice\.bindRecords and name the source, Schedule\.templates\(rows, \{ …, source: "jobTemplates" \}\)/;
        const coded = [{ key: "run", name: "Run", duration: variant("hours", 1.0), values: { title: "Run", state: variant("confirmed", null), sheets: 1.0, customer: "", stock: variant("coated", null), due: none } }];
        // Written in the code, with no slice and with one.
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf2($, { templates: coded }) } })), new RegExp(`${change.source} \\(it has no slice\\)$`));
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: narrowedJobs($, { templates: coded }) }, slice: { slice: jobSlice() } })),
            new RegExp(`${change.source} \\(the slice's sources: job\\)$`));
        // A record's list naming no source, one the slice lacks, or with no slice at all.
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: narrowedJobs($, { templates: jobTemplates($) }) }, slice: { slice: jobSlice() } })), change);
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: narrowedJobs($, { templates: jobTemplates($, "jobTemplates") }) }, slice: { slice: jobSlice() } })),
            /\(the slice's sources: job — 'jobTemplates' is not one of them\)$/);
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf2($, { templates: jobTemplates($, "jobTemplates") }) } })),
            /\(it has no slice — 'jobTemplates' is not one of them\)$/);
    });

    test("a templates record's templates give each event's duration on a span kind, and none on an instant kind", () => {
        assert.match(refusal(($) => jobsOf2($, { templates: Schedule.templates($.let(Data.bind(ex.planPrintJobTemplates)).read(), { name: (t) => t.name, values: (t) => t.values, source: "jobTemplates" }) })),
            /^Schedule\.events: "Print job": its templates give each event's `duration` — Schedule\.templates\(rows, \{ …, duration: \(row\) => variant\("hours", …\) \}\), how long the event a template creates runs$/);
        assert.match(refusal(($) => {
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            return Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" },
                templates: Schedule.templates($.let(Data.bind(ex.planPrintStopTemplates)).read(), { name: (t) => t.name, duration: () => variant("hours", 1.0), values: (t) => t.values, source: "stopTemplates" }) });
        }), /^Schedule\.events: "Stop": an instant kind's events are one time, and its templates give a `duration` — leave it out of Schedule\.templates$/);
    });

    test("a tab naming a source the slice lacks is refused, naming the slice's sources", () => {
        assert.match(refusal(($) => {
            const customers = $.let(Data.bind(ex.planPrintCustomers));
            return Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: narrowedJobs($) }, slice: { slice: jobSlice() },
                library: [Plan.library.tab(customers.read(), { name: "Customers", label: (c) => c.name, source: "customers" })] });
        }), /^Plan: the Customers tab's source 'customers' is not one of the slice's sources \(job\)$/);
    });
});

describe("the inspector's refusals (#1197)", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });

    test("an `inspector` on a Plan with no event kinds, or one that is not a boolean, naming the kind's own", () => {
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], inspector: true })),
            /^Plan: `inspector` shows the event kinds' events and the resources' rows, and this Plan has no event kinds — declare `events` \(Schedule\.events\), or leave `inspector` out$/);
        const own = East.function([ex.PrintJob, FunctionType([ex.PrintJob], NullType)], UIComponentType, (_$2, job) => Text.Root(job.title));
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, inspector: own as never })),
            /^Plan: `inspector` is `true` for the inspector pane, or `false` or left out for none, and this one is no boolean — a kind's own inspector for one event is Schedule\.events' `inspector`$/);
        // An `inspector: false` asks for nothing: it passes with no event kinds.
        assert.equal(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], inspector: false })), "");
    });
});

describe("links between events (PB10)", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });

    test("a link naming an event kind the Plan has not is refused at build, naming the kinds it has", () => {
        const link = () => Plan.link({ key: "x", from: Plan.eventRef("stop", "S-01"), to: Plan.eventRef("job", "J-1001") });
        assert.match(refusal(($) => Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, links: [link()] })),
            /^Plan: links\[0\] names the event kind "stop", and `events` has no kind of that name \(job\)$/);
        assert.match(refusal(($) => Plan.Payload({ axis, data: $.const(ROWS, Rows), series: [MARKS], links: [link()] })),
            /^Plan: links\[0\] names the event kind "stop", and `events` has no kind of that name \(none\)$/);
    });

    test("an event names its own run, and a row's id needs one", () => {
        assert.throws(() => Plan.link({ key: "x", from: Plan.eventRef("job", "J-1001"), fromRun: "r", to: Plan.eventRef("job", "J-1002") }),
            /^Error: Plan\.link: `from` is an event, which names its own run — leave out `fromRun`$/);
        assert.throws(() => Plan.link({ key: "x", from: Plan.ref("presses", "a1"), to: Plan.eventRef("job", "J-1002") }),
            /^Error: Plan\.link: `from` is a row's id — name the run on it with `fromRun`, or name an event with Plan\.eventRef\(kind, key\)$/);
        assert.throws(() => Plan.link({ key: "x", from: Plan.eventRef("job", "J-1001"), to: Plan.ref("presses", "a1") }),
            /^Error: Plan\.link: `to` is a row's id — name the run on it with `toRun`/);
    });

    test("an event ref is a run ref whose row is the kind's, at no path — a row no series makes", () => {
        inBlock(($) => {
            const ref = $.let(Plan.eventRef("job", "J-1001"));
            assert.ok(isTypeEqual(Expr.type(ref as unknown as Expr) as EastType, Plan.Types.RunRef));
        });
        const ref = East.compile(East.function([], Plan.Types.RunRef, (_$) => Plan.eventRef("job", "J-1001")), [])();
        assert.ok(equalFor(Plan.Types.RunRef)(ref, { row: variant("entry", { series: "job", path: [] }), run: "J-1001" }));
    });
});

describe("rows over a dataset (PB9)", () => {
    const StockRow = StructType({ name: StringType, marks: ArrayType(Plan.Types.EventMark) });
    const STOCK = new Map([["board", { name: "Board", marks: [] }]]);
    const table = () => Plan.series.table(StockRow, { key: "stock", title: "Paper stock", label: (s) => s.name });

    test("a `data` that is no keyed collection, and no series", () => {
        assert.match(refusal(($) => Plan.over($.const([1n], ArrayType(IntegerType)) as never, [table()])),
            /^Plan\.over: `data` is a keyed collection — a Dict, or a bind handle over one \(Data\.bind\) — and this one is \.Array/);
        assert.match(refusal(($) => Plan.over($.const(STOCK, DictType(StringType, StockRow)), [])),
            /^Plan\.over: lays series over the dataset — give at least one `Plan\.series\.\*`$/);
    });

    test("a series that writes — an `edit` — is refused, naming Schedule.events", () => {
        const data = ($: BlockBuilder<NullType>) => $.const(STOCK, DictType(StringType, StockRow));
        assert.match(refusal(($) => Plan.over(data($), [table(), Plan.series.events(StockRow, {
            key: "marks", title: "Marks", label: (s) => s.name, marks: (s) => s.marks,
            edit: { items: "marks", create: (drop) => ({ key: drop.from.key, at: drop.at, kind: variant("milestone", null), icon: none, label: none }) },
        })])), /^Plan\.over: series\[1\], events "Marks", declares `edit` — a Plan's rows over a dataset are read only, and its edits go through its event kinds \(Schedule\.events\)$/);
    });

    test("a series held in a variable, over another entry type, or repeating another's key", () => {
        assert.match(refusal(($) => Plan.over($.const(STOCK, DictType(StringType, StockRow)), [$.let(table()) as never])),
            /^Plan\.over: series\[0\] is a Plan\.series\.\* value written in place — a series bound or stored elsewhere cannot be checked to be read only$/);
        assert.match(refusal(($) => Plan.over($.const(ROWS, Rows), [table()])),
            /the series is built over one entry type and applied to entries of another/);
        assert.match(refusal(($) => Plan.over($.const(STOCK, DictType(StringType, StockRow)), [table(), table()])),
            /two series share the key "stock"/);
    });
});

// ============================================================================
// What fails to compile (PB8): every row on the axis's arm
// ============================================================================

/** Never run: each line marked below must fail to compile, or the build fails on the unused directive. */
export function planEventsTypeChecks(): void {
    inBlock(($) => {
        const When = StructType({ when: DateTimeType });
        const data = $.const(new Map([["a", { when: FIRST }]]), DictType(StringType, When));
        const number = Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 });
        // @ts-expect-error — a hand-built row whose instants are times cannot sit on a number axis
        PublicPlan({ axis: number, rows: [Plan.cards({ key: "crew", label: "Crew", chips: [Plan.chip({ key: "s", from: FIRST, to: LAST, label: "Early", state: "confirmed" })] })] });
        // @ts-expect-error — nor can rows over a dataset whose runs are times
        PublicPlan({ axis: number, rows: [Plan.over(data, [Plan.series.span(When, { key: "s", title: "S", label: (_r, k) => k, runs: (r, k) => [Plan.run({ key: k, start: r.when, end: r.when, label: k, state: "confirmed" })] })])] });
        // A row on the axis's arm fits.
        PublicPlan({ axis: number, rows: [Plan.heat({ key: "load", label: "Load", cells: Plan.heatCells([{ at: Plan.at.number(3), value: some(40.0), label: none }]) })] });
    });
}
