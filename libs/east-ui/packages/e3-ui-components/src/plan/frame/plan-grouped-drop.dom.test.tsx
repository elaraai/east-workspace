/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A job dropped under another hall (#1710), on e3 itself: two halls, each with
 * one press and its one task, and a job read through a series index in time
 * order led by the hall — the Plan reads a hall's presses' jobs under that
 * hall, so a job whose `hall` names another is drawn nowhere. Carried from the
 * first hall's press onto the second's, the drop writes the job's hall from
 * the hall it lands under, beside its press and its task: saved, the record
 * holds it there, and the Plan reads it there again and draws it.
 */

import { describe, test, expect } from "vitest";
import { waitFor, within } from "@testing-library/react";
import { DateTimeType, DictType, East, StringType, StructType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { carryRun, carrySaid } from "../plan-move.test-utils.js";
import { act, el, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const Task = StructType({ name: StringType });
const Press = StructType({ name: StringType, tasks: DictType(StringType, Task) });
const Hall = StructType({ name: StringType, presses: DictType(StringType, Press) });
const Halls = DictType(StringType, Hall);
const Job = StructType({ hall: StringType, press: StringType, task: StringType, title: StringType, start: DateTimeType, end: DateTimeType });
const Jobs = DictType(StringType, Job);

const AT = new Date("2026-10-06T06:00:00Z");
const UNTIL = new Date("2026-10-06T12:00:00Z");

/** Two halls, each one press with one task: the first's job carried onto the second's. */
const HALLS: ValueTypeOf<typeof Halls> = new Map([
    ["H-1", { name: "Hall 1", presses: new Map([["P-11", { name: "Press 1.1", tasks: new Map([["T1", { name: "Print on 1.1" }]]) }]]) }],
    ["H-2", { name: "Hall 2", presses: new Map([["P-21", { name: "Press 2.1", tasks: new Map([["T1", { name: "Print on 2.1" }]]) }]]) }],
]);

export const dropHalls = e3.record("plan_drop_halls", Halls, {
    initial: HALLS,
    indexes: (index) => ({ plan_drop_halls_by_name: index.on(["name"]) }),
});

export const dropJobs = e3.record("plan_drop_jobs", Jobs, {
    initial: new Map([["J-1", { hall: "H-1", press: "P-11", task: "T1", title: "Brochures", start: AT, end: UNTIL }]]),
    indexes: (index) => ({
        plan_drop_jobs_by_time: index.interval({ from: "start", to: "end" }),
        // A week's jobs together under their hall, in their presses' order.
        plan_drop_jobs_by_hall_week: index.series({ on: ["hall"], key: "press", from: "start", to: "end", tile: "week", order: "time" }),
        plan_drop_jobs_by_press_day: index.summary({ key: "press", from: "start", to: "end", tile: "day" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const h = planHarness({ "plan/grouped-drop": { dropHalls, dropJobs } });

/** The halls, each its press and its task, and the job on the task rows through the series index in time order. */
const page = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const jobs = $.let(Record.bind(dropJobs, ["patch"]));
    const entries = $.let(Data.bindPaged(dropJobs));
    const slice = $.let(Slice.bindRecords("plan.grouped.drop", {
        rows: { source: Data.bindPaged(dropHalls, { indexes: ["plan_drop_halls_by_name"] }), fields: { name: { label: "Hall" } } },
        job: {
            source: Data.bindPaged(dropJobs, { indexes: ["plan_drop_jobs_by_time", "plan_drop_jobs_by_hall_week", "plan_drop_jobs_by_press_day"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-12T00:00:00Z") }, resolution: "day" }),
        slice: { slice },
        series: [Plan.series.group(Hall, {
            key: "halls", title: "Halls", label: (hall) => hall.name,
            children: Plan.children("presses", [Plan.series.resources(Press, {
                key: "press", title: "Presses", label: (press) => press.name,
                children: Plan.children("tasks", [Plan.series.resources(Task, { key: "tasks", title: "Tasks", label: (task) => task.name })]),
            })]),
        })],
        events: {
            job: Schedule.events(jobs, {
                name: "Job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "press" }, child: { field: "task", of: "tasks" }, entries,
            }),
        },
    });
}))) };

/** The job's bar on a hall's task row. */
const barUnder = (c: HTMLElement, hall: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(entry("tasks", hall, press, "T1"))} ${el("data-run", "job", "J-1")}`);
/** The footer's count of the changes waiting on Save. */
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;

describe("a job dropped under another hall (#1710)", () => {
    test("carried from the first hall's press onto the second's, its hall is written from the hall it lands under: saved, the record holds it there, and the Plan draws it there", async () => {
        const { container: c } = await h.mount(page, { drag: true });
        await settle();
        await waitFor(() => expect(barUnder(c, "H-1", "P-11")).not.toBeNull());
        // Down a row that takes it: the second hall's press's task.
        await carryRun(barUnder(c, "H-1", "P-11")!, { key: "ArrowDown" });
        expect(carrySaid(c)).toMatch(/^Dropped Brochures on Print on 2\.1/);
        expect(pending(c)).toBe("1 pending");
        await act(async () => { within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() }).click(); });
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        await settle();
        // The record holds it under the second hall, on its press and its task.
        const saved = ((await h.read(dropJobs)) as ReadonlyMap<string, ValueTypeOf<typeof Job>>).get("J-1");
        expect(saved !== undefined && equalFor(Job)(saved, { hall: "H-2", press: "P-21", task: "T1", title: "Brochures", start: AT, end: UNTIL })).toBe(true);
        // And the Plan, reading the second hall's press's jobs under that hall, draws it there.
        await waitFor(() => expect(barUnder(c, "H-2", "P-21")).not.toBeNull());
        expect(barUnder(c, "H-1", "P-11")).toBeNull();
    });
});
