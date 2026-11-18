/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The optimiser over jobs the Plan never holds whole (east-workspace#1622, the
 * epic's done test), on e3: the print works of 2,000 presses, its jobs read a
 * cell at a time, and the works' maintenance optimiser — every job on a press
 * that is down goes back to the backlog — which reads that press's jobs over
 * the window through the jobs' series index. A job dragged from the backlog
 * onto the press that is down, and not saved, is sent with the run as a draft
 * of the jobs' record: the function reads it on that press, and its answer
 * sends it back beside the press's saved job. The answer lands as unsaved
 * edits in one step; one Undo reverts it, the drag standing; Save commits the
 * drag and the answer together; and the record is never written before Save.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, equalFor, none, some, variant } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { layOut } from "@elaraai/east-ui-components/testing";
import { Data, Func, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as windows from "@elaraai/e3-ui/examples/plan/plan-windows";
import * as ex from "@elaraai/e3-ui/examples/plan/optimise-windows";
import { PrintJob, PrintPress } from "@elaraai/e3-ui/examples/plan/plan-events";
import { fitCalls } from "../../shared/func/fit-calls.test-utils.js";
import { carry } from "../plan-move.test-utils.js";
import { act, el, elementKey, entry, planHarness, rowAt, settle, slot, tabs } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-windows": windows, "plan/optimise-windows": ex });
const calls = fitCalls(h, { request: Plan.Types.OptimiseRequest, result: ex.PlanWindowsOptimiseResult });

/**
 * The example's Plan (`planOptimiseWindows`), unbounded — jsdom lays nothing out, so the canvas draws every row it
 * holds: the presses paged, the jobs read a cell at a time through the rail's `job` source, and the works' maintenance
 * optimiser.
 */
const cellsPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Data.bindPaged(windows.planWindowPresses));
    const jobs = $.const(Record.bind(windows.planWindowJobs, ["patch"]));
    const jobEntries = $.const(Data.bindPaged(windows.planWindowJobs));
    const slice = $.const(Slice.bindRecords("plan.optimise.windows.dom", {
        job: {
            source: Data.bindPaged(windows.planWindowJobs, { indexes: ["plan_window_jobs_by_time", "plan_window_jobs_by_press_week", "plan_window_jobs_by_press_month"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    const optimise = $.const(Func.bind(ex.clearDownPresses));
    return Plan({
        axis: Plan.axis({
            window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-19T00:00:00Z") },
            resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: new Date("2026-10-14T09:00:00Z"),
        }),
        slice: { slice }, optimise,
        // The presses are the canvas's rows, read a page at a time, a landing row each (#1541).
        data: presses,
        series: [Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
        library: [Plan.library.backlog()],
    });
}))) };

/** The press down for maintenance, as the workspace's input says it. */
const DOWN = "P-1003";
const sameJob = equalFor(PrintJob);
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")!).getByRole("button", { name }) as HTMLButtonElement;
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(entry("presses", press))} ${el("data-run", "job", key)}`);
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;
const commits = async () => (await h.history(windows.planWindowJobs)).commits.map((commit) => commit.mutation);
async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }

describe("the optimiser over jobs read a cell at a time (east-workspace#1622)", () => {
    test("a job dragged onto the press that is down, and not saved; the eye: the function reads that press's jobs through the series index and sees the drag; its answer lands as unsaved edits in one step, which Undo reverts; Save commits the drag and the answer together, and the record is never written before it", async () => {
        const { container: c } = await h.mount(cellsPlan, { drag: true });
        await settle();
        const before = await h.read(windows.planWindowJobs);
        const deployed = await commits();
        // The press that is down holds the course handbooks, 7–9 October; the order forms wait in the backlog.
        await waitFor(() => expect(bar(c, "W-0004", DOWN)).not.toBeNull(), { timeout: 10_000 });
        const pane = slot(c, "start")!;
        fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith("Backlog "))!);
        await settle();
        expect(tabs(pane)).toEqual(["Backlog 4"]);
        // The presses' plots, stacked 40px apart across the fortnight, a day 100px wide from x 200.
        const rects = new Map<Element, { left: number; top: number; width: number; height: number }>();
        ["P-1001", "P-1002", DOWN].forEach((p, i) => {
            rects.set(c.querySelector(`${rowAt(entry("presses", p))} [data-plan-plot]`)!, { left: 200, top: 40 * i, width: 1400, height: 32 });
        });
        layOut(rects);
        // The drag: the order forms onto the press's Monday, 12 October — a draft, saved nowhere.
        const card = pane.querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-library-item=${JSON.stringify(elementKey("job", "W-0017"))}]`)!;
        const letGo = await carry(card, { x: 20, y: 900 }, { x: 200 + 7.5 * 100, y: 80 + 16 });
        await letGo();
        await settle();
        expect([bar(c, "W-0017", DOWN) !== null, tabs(pane), pending(c)]).toEqual([true, ["Backlog 3"], "1 pending"]);

        // The eye, on while the canvas holds the jobs a cell at a time: one call, the drag sent as a draft of the jobs' record.
        expect(eye(c)!.disabled).toBe(false);
        await press(eye(c));
        await waitFor(() => expect(banner(c, "done")).not.toBeNull(), { timeout: 15_000 });
        const asked = calls.requests()[0]!;
        expect(Object.keys(asked).sort()).toEqual(["from", "period", "run", "slice", "to"]);
        expect(calls.drafts()).toEqual([[{ record: windows.planWindowJobs.name, mutation: "patch" }]]);
        // The function read the press's jobs through the series index with the draft laid: the saved job, and the dragged one.
        const answered = calls.answers()[0]!.events.job;
        expect(answered.type === "patch" ? [...answered.value].map(([key, change]) => [key, change.type]) : answered.type).toEqual([["W-0004", "update"], ["W-0017", "update"]]);
        // One step: both off the press and waiting in the backlog; and nothing written by the call.
        expect(banner(c, "done")!.querySelector("[data-banner-body]")!.textContent).toBe("2 changes: 2 removed. Undo or apply them like any edit.");
        expect([bar(c, "W-0004", DOWN), bar(c, "W-0017", DOWN), tabs(pane)]).toEqual([null, null, ["Backlog 5"]]);
        expect(await commits()).toEqual(deployed);

        // One Undo reverts the answer, the drag standing; Redo brings it back.
        await press(history(c, editingMessages.undo()));
        expect([bar(c, "W-0004", DOWN) !== null, bar(c, "W-0017", DOWN) !== null, tabs(pane), pending(c)]).toEqual([true, true, ["Backlog 3"], "1 pending"]);
        await press(history(c, editingMessages.redo()));
        expect([bar(c, "W-0004", DOWN), bar(c, "W-0017", DOWN), tabs(pane)]).toEqual([null, null, ["Backlog 5"]]);

        // Save commits the drag and the answer together, as one patch: the handbooks waiting, booked for the press still; the
        // order forms waiting too, and booked for the press the drag put them on.
        expect(await commits()).toEqual(deployed);
        await press(history(c, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]), { timeout: 15_000 });
        const saved = await h.read(windows.planWindowJobs);
        expect(sameJob(saved.get("W-0004")!, { ...before.get("W-0004")!, start: none, end: none })).toBe(true);
        expect(sameJob(saved.get("W-0017")!, { ...before.get("W-0017")!, press: some(DOWN) })).toBe(true);
        expect([...saved].filter(([key]) => key !== "W-0004" && key !== "W-0017").every(([key, job]) => sameJob(job, before.get(key)!))).toBe(true);
    });
});
