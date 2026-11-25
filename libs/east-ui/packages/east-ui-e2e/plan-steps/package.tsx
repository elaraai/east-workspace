/** @jsxImportSource @elaraai/e3-ui */
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-steps lab's package (#1710): one Plan over a print works' halls and every step of work on its machines —
 * millions of them over five years, one record of every kind, each step a row of its own (`generate.ts`).
 *
 * The halls are a record made as the package is exported, and the canvas's rows: each hall a group, its machines rows
 * beneath it, each drawn as what it is — a press, a crew or a bay. Nothing dated is stored in them. The steps are a
 * record with no initial value, seeded from the generator's file (`e3 seed`): keyed by a variant of the keys each kind
 * of step is made under, each naming its hall, the machine it is on, its times, its lifecycle, and what it is — a run
 * or a setup on a press, a crew's shift, a bay's delivery — each kind with its own details, and each drawn its own way
 * (`Schedule.events.kinds`). The Plan reads every kind a cell at a time through one source and its one series index
 * in time order, led by the hall, so a screen of a hall's machines is one range a tile; the window and its count are
 * the interval index's, the shading zoomed out a machine's summary, and the horizon's bars the record's totals.
 * Nothing reads them whole.
 *
 * @packageDocumentation
 */

import { ArrayType, East, IntegerType, StringType, variant } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule, ui } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import {
    LAB_FIRST_BAY, LAB_FIRST_CREW, LAB_FIRST_HALL, LAB_FIRST_PRESS, LAB_HALLS, LAB_HALL_BAYS, LAB_HALL_CREWS, LAB_HALL_PRESSES, LAB_NOW,
    LabHall, LabHalls, LabMachine, LabSteps,
} from "./types.ts";

/** The works' sites: what the rail offers to narrow the halls by. */
const SITES = ["North", "South", "East", "West"];

/** How many machines a hall holds: its presses, then its crews, then its bays. */
const HALL_MACHINES = LAB_HALL_PRESSES + LAB_HALL_CREWS + LAB_HALL_BAYS;

/**
 * The halls, from their count, by key: each named by its number, on one of four sites in turn, holding its presses,
 * crews and bays — each kind's numbers running on from the hall before's, as the generator's steps name them.
 */
const generateHalls = East.function([IntegerType], LabHalls, ($, count) => {
    const sites = $.const(SITES, ArrayType(StringType));
    return East.Array.range(0n, count).toDict(
        (_$2, h) => East.str`H${h.add(LAB_FIRST_HALL)}`,
        (_$2, h) => ({
            name: East.str`Hall ${h.add(LAB_FIRST_HALL)}`,
            site: sites.get(h.remainder(4n)),
            machines: East.Array.range(0n, HALL_MACHINES).toDict(
                (_$3, m) => m.less(LAB_HALL_PRESSES).ifElse(
                    () => East.str`P-${h.multiply(LAB_HALL_PRESSES).add(m).add(LAB_FIRST_PRESS)}`,
                    () => m.less(LAB_HALL_PRESSES + LAB_HALL_CREWS).ifElse(
                        () => East.str`C-${h.multiply(LAB_HALL_CREWS).add(m).subtract(LAB_HALL_PRESSES).add(LAB_FIRST_CREW)}`,
                        () => East.str`B-${h.multiply(LAB_HALL_BAYS).add(m).subtract(LAB_HALL_PRESSES + LAB_HALL_CREWS).add(LAB_FIRST_BAY)}`,
                    ),
                ),
                (_$3, m) => m.less(LAB_HALL_PRESSES).ifElse(
                    () => ({ name: East.str`Press ${h.multiply(LAB_HALL_PRESSES).add(m).add(LAB_FIRST_PRESS)}`, what: variant("press", null) }),
                    () => m.less(LAB_HALL_PRESSES + LAB_HALL_CREWS).ifElse(
                        () => ({ name: East.str`Crew ${h.multiply(LAB_HALL_CREWS).add(m).subtract(LAB_HALL_PRESSES).add(LAB_FIRST_CREW)}`, what: variant("crew", null) }),
                        () => ({ name: East.str`Bay ${h.multiply(LAB_HALL_BAYS).add(m).subtract(LAB_HALL_PRESSES + LAB_HALL_CREWS).add(LAB_FIRST_BAY)}`, what: variant("bay", null) }),
                    ),
                ),
            ),
        }),
    );
});

/** The halls, made as the package is exported: the canvas's rows, narrowed by name and site. */
const halls = e3.record("lab_halls", LabHalls, {
    initial: () => East.compile(generateHalls, [])(LAB_HALLS),
    indexes: (index) => ({
        // The rail's default order, and its search.
        lab_halls_by_name: index.on(["name"]),
        lab_halls_by_site: index.on(["site"]),
    }),
});

/** Every step of work on the machines: unassigned until `e3 seed` commits the generator's file, and read only through its indexes. */
const steps = e3.record("lab_steps", LabSteps, {
    indexes: (index) => ({
        // What the rail's `step` source narrows them through: the window and its count.
        lab_steps_by_time: index.interval({ from: "start", to: "end" }),
        // The cells the canvas reads them by: each step filed once, at the level its length fits from the week up, under
        // its hall, then its tile, then its machine — so a screen of a hall's machines is one range a tile.
        lab_steps_by_hall_week: index.flatSeries({ on: ["hall"], key: "on", from: "start", to: "end", tile: "week", order: "time" }),
        // What the canvas shades zoomed out past what it draws: each machine's busy share a month.
        lab_steps_by_machine_month: index.summary({ key: "on", from: "start", to: "end", tile: "month" }),
        // What the horizon's bars read, at the period that fits the strip: how many steps touch each.
        lab_steps_day_totals: index.totals({ from: "start", to: "end", tile: "day" }),
        lab_steps_week_totals: index.totals({ from: "start", to: "end", tile: "week" }),
        lab_steps_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        lab_steps_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        lab_steps_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({
        // The steps' patch door: every Save commits through it.
        patch: mutation.patch(),
    }),
});

/**
 * The Plan: the halls the rail's narrowing keeps, two to a window as it scrolls, each a group over its machines; every
 * step on its machine's row, read a cell at a time; four weeks to the window at day columns, zoomed out to a year.
 */
const planLab = ui("plan_lab", [], East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const stepsBound = $.let(Record.bind(steps));
        const stepEntries = $.let(Data.bindPaged(steps));
        const slice = $.let(Slice.bindRecords("lab.steps", {
            rows: {
                source: Data.bindPaged(halls, { indexes: ["lab_halls_by_name", "lab_halls_by_site"] }),
                label: "Halls", icon: { prefix: "fas", name: "industry" },
                fields: { name: { label: "Hall" }, site: { label: "Site", hints: SITES } },
                search: ["name"],
            },
            step: {
                source: Data.bindPaged(steps, {
                    indexes: ["lab_steps_by_time", "lab_steps_by_hall_week", "lab_steps_by_machine_month"],
                    totals: ["lab_steps_day_totals", "lab_steps_week_totals", "lab_steps_month_totals", "lab_steps_quarter_totals", "lab_steps_year_totals"],
                }),
                label: "Steps", fields: { start: { label: "Dates" } }, range: "start",
            },
        }));
        const axis = $.let(Plan.axis({
            window: { min: new Date("2026-11-02T00:00:00Z"), max: new Date("2026-11-30T00:00:00Z") },
            resolution: "day", resolutions: ["day", "week", "month", "quarter", "year"], now: LAB_NOW,
        }));
        return (
            <Plan
                id="steps-lab"
                axis={axis}
                slice={{ slice }}
                // A hall holds a hundred machines: two halls to a window, so the canvas makes no more rows than it shows.
                paging={{ entries: 2 }}
                vocabulary={{ rows: { one: "Machine", other: "Machines" }, groups: { one: "Hall", other: "Halls" } }}
                series={[Plan.series.group(LabHall, {
                    key: "halls", title: "Halls", label: (hall) => hall.name,
                    // Each machine a row beneath its hall, drawn as what it is.
                    children: Plan.children("machines", [Plan.series.kinds(LabMachine, "what", {
                        press: { title: "Presses", icon: "print", label: (machine) => machine.name },
                        crew: { title: "Crews", icon: "users", label: (machine) => machine.name },
                        bay: { title: "Bays", icon: "warehouse", label: (machine) => machine.name },
                    })]),
                })]}
                // A kind of event per kind of step, each drawn its own way on the machines of its kind (#1769): the runs as
                // bars and the setups as marks on the presses, the crews' shifts as chips, the bays' deliveries as tiles —
                // every kind read through the rail's one `step` source, its one series index.
                events={Schedule.events.kinds(stepsBound, "kind", {
                    run: {
                        name: "Print run", icon: "print", title: (_step, _key, run) => run.title, start: "start", end: "end",
                        resource: { field: "on", of: { press: "press" } },
                    },
                    setup: {
                        name: "Setup", icon: "wrench", draw: "marks", title: (_step, _key, setup) => East.str`Setup, ${setup.plates} plates`,
                        start: "start", end: "end", resource: { field: "on", of: { press: "press" } },
                    },
                    labour: {
                        name: "Crew shift", icon: "users", draw: "cards", title: (_step, _key, labour) => East.str`Crew of ${labour.people}`,
                        start: "start", end: "end", resource: { field: "on", of: { crew: "crew" } },
                    },
                    delivery: {
                        name: "Delivery", icon: "truck", draw: "buckets", title: (_step, _key, delivery) => East.str`${delivery.pallets} pallets`,
                        start: "start", end: "end", resource: { field: "on", of: { bay: "bay" } },
                    },
                }, { state: "state", entries: stepEntries, source: "step" })}
                // The page's own height, less the harness's bar of workspaces over it.
                style={{ height: "calc(100vh - 48px)" }}
            />
        );
    }}</Reactive>
)));

export default e3.package("plan_steps_lab", "1.0.0", planLab, halls, steps);
