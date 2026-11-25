/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * One record of every kind of step (#1769): a print works' steps — press runs,
 * the setups before them and crew shifts — each step a row of one record,
 * holding what it is in a variant field whose cases carry their own fields,
 * and a kind of event per case (`Schedule.events.kinds`), each drawn its own
 * way on the machines of its kind. And the Plan over them:
 *
 * - `planCaseKinds`, the works' machines read a page at a time and drawn by
 *   what they are, and every kind of step read a cell at a time through the one
 *   source of the rail they share.
 *
 * @packageDocumentation
 */

import { DateTimeType, DictType, East, FloatType, IntegerType, NullType, StringType, StructType, VariantType, example, variant } from "@elaraai/east";
import { Box, EventStateType, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** What a machine of the works is. */
export const CaseMachineKind = VariantType({ crew: NullType, press: NullType });

/** A machine: its name, and what it is. */
export const CaseMachine = StructType({ name: StringType, what: CaseMachineKind });

/** The works' machines: two presses and two crews. */
export const planCaseMachines = e3.record("plan_case_machines", DictType(StringType, CaseMachine), {
    initial: new Map([
        ["C1", { name: "Crew 1", what: variant("crew", null) }],
        ["C2", { name: "Crew 2", what: variant("crew", null) }],
        ["P1", { name: "Press 1", what: variant("press", null) }],
        ["P2", { name: "Press 2", what: variant("press", null) }],
    ]),
    indexes: (index) => ({
        // The machines by name: the rail's order and its search.
        plan_case_machines_by_name: index.on(["name"]),
    }),
});

/**
 * A step of the works: the machine it is on — a press or a crew, by its case —
 * its times, the lifecycle it wears, and what it is: a run of sheets, a press's
 * setup, or a crew's shift, each case holding its own fields.
 */
export const CaseStep = StructType({
    on: VariantType({ crew: StringType, press: StringType }),
    start: DateTimeType,
    end: DateTimeType,
    state: EventStateType,
    kind: VariantType({
        run: StructType({ title: StringType, sheets: FloatType }),
        setup: StructType({ plates: IntegerType }),
        shift: StructType({ people: IntegerType }),
    }),
});

/** The steps of the week of Monday 5 October 2026: each press's setups and the runs after them, and each crew's shifts. */
export const planCaseSteps = e3.record("plan_case_steps", DictType(StringType, CaseStep), {
    initial: new Map([
        ["S-01", { on: variant("press", "P1"), start: new Date("2026-10-05T06:00:00Z"), end: new Date("2026-10-05T07:00:00Z"),
            state: variant("actual", null), kind: variant("setup", { plates: 4n }) }],
        ["S-02", { on: variant("press", "P1"), start: new Date("2026-10-05T07:00:00Z"), end: new Date("2026-10-05T15:00:00Z"),
            state: variant("actual", null), kind: variant("run", { title: "Brochures", sheets: 40000 }) }],
        ["S-03", { on: variant("press", "P1"), start: new Date("2026-10-06T06:00:00Z"), end: new Date("2026-10-06T06:30:00Z"),
            state: variant("confirmed", null), kind: variant("setup", { plates: 2n }) }],
        ["S-04", { on: variant("press", "P1"), start: new Date("2026-10-06T06:30:00Z"), end: new Date("2026-10-06T12:00:00Z"),
            state: variant("confirmed", null), kind: variant("run", { title: "Catalogues", sheets: 24000 }) }],
        ["S-05", { on: variant("press", "P2"), start: new Date("2026-10-05T08:00:00Z"), end: new Date("2026-10-05T09:00:00Z"),
            state: variant("actual", null), kind: variant("setup", { plates: 8n }) }],
        ["S-06", { on: variant("press", "P2"), start: new Date("2026-10-05T09:00:00Z"), end: new Date("2026-10-06T03:00:00Z"),
            state: variant("in-progress", null), kind: variant("run", { title: "Posters", sheets: 60000 }) }],
        ["S-07", { on: variant("crew", "C1"), start: new Date("2026-10-05T06:00:00Z"), end: new Date("2026-10-05T14:00:00Z"),
            state: variant("actual", null), kind: variant("shift", { people: 3n }) }],
        ["S-08", { on: variant("crew", "C1"), start: new Date("2026-10-06T06:00:00Z"), end: new Date("2026-10-06T14:00:00Z"),
            state: variant("confirmed", null), kind: variant("shift", { people: 3n }) }],
        ["S-09", { on: variant("crew", "C2"), start: new Date("2026-10-05T14:00:00Z"), end: new Date("2026-10-05T22:00:00Z"),
            state: variant("actual", null), kind: variant("shift", { people: 2n }) }],
    ]),
    indexes: (index) => ({
        // The steps a window holds, and its count: what the rail's one `step` source narrows them through.
        plan_case_steps_by_time: index.interval({ from: "start", to: "end" }),
        // The steps a machine at a time, a cell at a time — every kind of step read through it, each filed by the
        // machine its `on` names.
        plan_case_steps_by_machine_week: index.flatSeries({ key: "on", from: "start", to: "end", tile: "week" }),
        // How busy each machine is a month: what the Plan shades from, zoomed out past what it draws.
        plan_case_steps_by_machine_month: index.summary({ key: "on", from: "start", to: "end", tile: "month" }),
    }),
    mutations: (mutation) => ({
        // The steps' patch door: a Save of every kind commits through it, in one request.
        patch: mutation.patch(),
    }),
});

/**
 * One record of every kind of step, a kind of event per case of its `kind`
 * field (#1769): a print works' runs as bars and their setups as marks on its
 * presses, and its crew shifts as chips on its crews. Each kind's title is
 * handed what its case holds after the row and its key; each lands on the
 * machines of its kind — its `resource.of` naming a slot for some of `on`'s
 * cases alone. The machines are read a page at a time and drawn by what they
 * are; every kind of step is read a cell at a time through the one source of
 * the rail they share (`source`), one series index for them all. The kinds
 * share what is the record's: its lifecycle field, its read by key, and its one
 * session — a gesture over a run and a setup is one step, and Save commits both
 * in one request.
 */
export const planCaseKinds = example({
    keywords: [
        "Plan", "Schedule.events.kinds", "a kind per case", "event kind per case", "one record of every kind", "variant field", "case", "cases",
        "each kind drawn its own way", "draw", "span", "bars", "marks", "cards", "chips", "source", "one source", "shared source", "Plan.series.kinds",
        "resource", "of", "some cases", "partial of", "setup", "run", "shift", "Slice.bindRecords", "Data.bindPaged", "index.flatSeries",
        "series index", "index.summary", "index.interval", "cell", "one session", "Save", "one request", "Record.bind", "entries", "#1769",
    ],
    description: "One record of every kind of step, a kind of event per case of its variant field (Schedule.events.kinds): a print works' press runs as bars and their setups as marks on its presses, and its crew shifts as chips on its crews — each case's title handed what its case holds, each landing on the machines of its kind (resource.of naming a slot for some of the field's cases alone); the machines read a page at a time and drawn by what they are (Plan.series.kinds), every kind of step read a cell at a time through the one source of the rail they share (source), one series index for them all; the kinds share the record's lifecycle field and its read by key, given once beside them, and its one session — a gesture over a run and a setup is one step, and Save commits both in one request",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const steps = $.let(Record.bind(planCaseSteps));
            const stepEntries = $.let(Data.bindPaged(planCaseSteps));
            // One rail: the machines paged by name, and the one source every kind of step is read through.
            const slice = $.let(Slice.bindRecords("ex.planCaseKinds", {
                rows: {
                    source: Data.bindPaged(planCaseMachines, { indexes: ["plan_case_machines_by_name"] }),
                    label: "Machines", icon: { prefix: "fas", name: "industry" }, search: ["name"],
                },
                step: {
                    source: Data.bindPaged(planCaseSteps, {
                        indexes: ["plan_case_steps_by_time", "plan_case_steps_by_machine_week", "plan_case_steps_by_machine_month"],
                    }),
                    label: "Steps", icon: { prefix: "fas", name: "list-check" }, fields: { start: { label: "Dates" } }, range: "start",
                },
            }));
            return <Box width="100%" height="460px"><Plan id="planCaseKinds" slice={{ slice }}
                axis={Plan.axis({
                    window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-12T00:00:00Z") },
                    resolution: "day", resolutions: ["day", "week", "month"], now: new Date("2026-10-05T16:00:00Z"),
                })}
                // Each machine drawn as what it is: the presses and the crews.
                series={[Plan.series.kinds(CaseMachine, "what", {
                    press: { title: "Presses", icon: "print", label: (press) => press.name },
                    crew: { title: "Crews", icon: "users", label: (crew) => crew.name },
                })]}
                // A kind of event per case of the steps' `kind`, each drawn its own way on the machines of its kind; what is
                // the record's — its lifecycle, its read by key, the source they are read through — given once, beside them.
                events={Schedule.events.kinds(steps, "kind", {
                    run: {
                        name: "Print run", icon: "print", title: (_step, _key, run) => run.title, start: "start", end: "end",
                        resource: { field: "on", of: { press: "press" } },
                    },
                    setup: {
                        name: "Setup", icon: "wrench", draw: "marks", title: (_step, _key, setup) => East.str`${setup.plates} plates`,
                        start: "start", end: "end", resource: { field: "on", of: { press: "press" } },
                    },
                    shift: {
                        name: "Crew shift", icon: "users", draw: "cards", title: (_step, _key, shift) => East.str`Crew of ${shift.people}`,
                        start: "start", end: "end", resource: { field: "on", of: { crew: "crew" } },
                    },
                }, { state: "state", entries: stepEntries, source: "step" })}
                library={[Plan.library.series()]}
                inspector
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});
