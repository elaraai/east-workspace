/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The benchmark of a Plan over paged rows read a cell at a time (#1438;
 * `E3_UI_PERF=1`, never in CI): machines written into the test's workspace
 * through the harness, never an example's seed — `E3_NESTED_MACHINES` of them
 * (50,000 unless given), the first `E3_NESTED_HEAVY` (200) each holding
 * `E3_NESTED_HEAVY_JOBS` jobs (10,000) over three years beside its own — then
 * opening, a scroll, a zoom to a year, a drag of a heavy machine's job, its
 * preview, and its Save, each one's time and requests: never a row read
 * whole but the one dragged. Each phase is printed, and written as a Markdown
 * table to `E3_UI_PERF_OUT` where it is given.
 */

import { appendFileSync } from "node:fs";
import { describe, test, expect, onTestFinished } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, StringType, compareFor, some, type ValueTypeOf } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { layOut } from "@elaraai/east-ui-components/testing";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan-nested/plan-nested";
import type { TreePath } from "@elaraai/e3-types";
import { PLAN_GEOMETRY } from "../geometry.js";
import { carry } from "../plan-move.test-utils.js";
import { emulateWindowScroll } from "../window-scroll.test-utils.js";
import { act, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan-nested/plan-nested": ex });

/** The machines' record, as e3's requests name it. */
const MACHINES = (ex.machines.path as TreePath).map((step) => step.value).join(".");
type MachineValue = ValueTypeOf<typeof ex.Machine>;
const compareKeys = compareFor(StringType);

/** Monday 2 to Monday 16 March 2026, a day at a time. */
const FROM = new Date("2026-03-02T00:00:00Z");
const TO = new Date("2026-03-16T00:00:00Z");

/** The machines through a rail, their jobs moving; every Save one commit through the patch door, by key. */
const perfPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.const(Record.bind(ex.machines, ["patch"]));
    const slice = $.const(Slice.bindRecords("plan.nested.perf", {
        rows: { source: Data.bindPaged(ex.machines, { indexes: ["machines_by_name", "machines_by_site_status", "machines_in_time"] }), fields: { site: { label: "Site" } } },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FROM, max: TO }, resolution: "day", resolutions: ["day", "week", "month", "quarter", "year"] }),
        slice: { slice },
        series: [
            Plan.series.span(ex.Machine, {
                key: "presses", title: "Presses", label: (m) => m.name, edit: true,
                runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
                decisions: Plan.items("alarms", { at: "at" }, () => ({ applied: false })),
            }),
            Plan.series.heat(ex.Machine, { key: "load", title: "Load", label: (m) => m.name, cells: Plan.heatCells(Plan.values("load", (fraction) => ({ value: some(fraction) }))) }),
        ],
        editing: { onApply: Record.onApply(record, { keyed: true }) },
    });
}))) };

/** A phase: its time, and the requests it made of the machines. */
interface Phase {
    readonly phase: string;
    readonly ms: number;
    readonly requests: string;
}

describe.skipIf(process.env["E3_UI_PERF"] !== "1")("a Plan over paged rows at scale (#1438; E3_UI_PERF=1, never in CI)", () => {
    test("opening, a scroll, a zoom to a year, a heavy machine's job dragged, previewed and saved: never a row read whole but the one dragged", { timeout: 3_600_000 }, async () => {
        onTestFinished(emulateWindowScroll());
        const count = BigInt(process.env["E3_NESTED_MACHINES"] ?? "50000");
        const heavy = Number(process.env["E3_NESTED_HEAVY"] ?? "200");
        const heavyJobs = Number(process.env["E3_NESTED_HEAVY_JOBS"] ?? "10000");
        const phases: Phase[] = [];
        let mark = h.requests().length;
        // Each phase written as it ends, so a run cut short keeps what it timed.
        const out = process.env["E3_UI_PERF_OUT"];
        if (out !== undefined) appendFileSync(out, [`| ${count} machines, ${heavy} × ${heavyJobs} jobs: phase | ms | requests |`, "|---|---:|---|", ""].join("\n"));
        const timed = async (phase: string, run: () => Promise<void>) => {
            const t0 = performance.now();
            await run();
            const asked = h.requests().slice(mark).filter((request) => request.dataset === MACHINES)
                .map((request) => (request.kind === "find" ? `find ${request.searches.length}` : request.kind));
            mark = h.requests().length;
            const done = { phase, ms: Math.round(performance.now() - t0), requests: asked.join(", ") };
            phases.push(done);
            if (out !== undefined) appendFileSync(out, `| ${done.phase} | ${done.ms} | ${done.requests} |\n`);
        };
        await timed(`write ${count} machines, the first ${heavy} with ${heavyJobs} more jobs`, async () => {
            const machines = East.compile(ex.generateMachines, [])(count) as Map<string, MachineValue>;
            const DAY = 86_400_000;
            const start = Date.UTC(2026, 0, 5);
            let n = 0;
            for (const [key, machine] of machines) {
                if (n++ >= heavy) break;
                const sample = [...machine.jobs.values()][0]!;
                const jobs = new Map(machine.jobs);
                // Its jobs over three years, an hour each, a day apart in turn.
                for (let j = 0; j < heavyJobs; j++) {
                    const at = start + (j % 1_095) * DAY + Math.floor(j / 1_095) * 3_600_000;
                    jobs.set(`H-${key}-${String(j).padStart(6, "0")}`, { ...sample, product: "heavy", start: new Date(at), end: new Date(at + 3_600_000) });
                }
                machines.set(key, { ...machine, jobs: new Map([...jobs].sort(([a], [b]) => compareKeys(a, b))) });
            }
            await h.patch(ex.machines, machines);
        });
        let c!: HTMLElement;
        await timed("open", async () => {
            c = (await h.mount(perfPlan, { drag: true })).container;
            await waitFor(() => expect(c.querySelector(`${rowAt(entry("presses", "M-10001"))} [data-run]`)).not.toBeNull(), { timeout: 600_000 });
            await settle();
        });
        await timed("scroll 100 machines down", async () => {
            act(() => { window.scrollTo({ top: 100 * PLAN_GEOMETRY.default.row }); });
            await waitFor(() => expect(c.querySelector(rowAt(entry("presses", "M-10101")))).not.toBeNull(), { timeout: 600_000 });
            await settle();
        });
        await timed("back to the top", async () => {
            act(() => { window.scrollTo({ top: 0 }); });
            await waitFor(() => expect(c.querySelector(`${rowAt(entry("presses", "M-10001"))} [data-run]`)).not.toBeNull(), { timeout: 600_000 });
            await settle();
        });
        const resolution = async (index: number) => {
            const seg = slot(c, "toolbar")!.querySelector<HTMLElement>("[data-plan-seg='resolution']")!;
            const radio = [...seg.querySelectorAll<HTMLElement>("[role='radio']")][index]!;
            await act(async () => { fireEvent.mouseDown(radio, { button: 0 }); fireEvent.click(radio); });
            await settle();
        };
        await timed("zoom to a year", async () => { await resolution(4); });
        await timed("back to the day", async () => {
            await resolution(0);
            await waitFor(() => expect(c.querySelector(`${rowAt(entry("presses", "M-10001"))} [data-run]`)).not.toBeNull(), { timeout: 600_000 });
        });
        // A heavy machine's job that starts in the fortnight, dragged a day on: the machine read whole once, its preview, its
        // Save.
        const job = [...c.querySelectorAll<HTMLElement>(`${rowAt(entry("presses", "M-10001"))} [data-run]`)]
            .find((run) => { const at = Number(run.getAttribute("data-plan-frac")); return at > 0.05 && at < 0.8; })!;
        const key = job.getAttribute("data-run")!;
        const frac = Number(job.getAttribute("data-plan-frac"));
        const rowsRead = h.requests("rows", MACHINES).length;
        await timed("drag a heavy machine's job a day on, previewed", async () => {
            const plot = c.querySelector(`${rowAt(entry("presses", "M-10001"))} [data-plan-plot]`)!;
            layOut(new Map([[plot, { left: 200, top: 0, width: 1400, height: 32 }]]));
            const x = 200 + frac * 1400 + 10;
            const letGo = await carry(job, { x, y: 16 }, { x: x + 100, y: 16 });
            await letGo();
            await waitFor(() => expect(Number(c.querySelector(`${rowAt(entry("presses", "M-10001"))} [data-run="${key}"]`)!.getAttribute("data-plan-frac"))).toBeCloseTo(frac + 1 / 14, 3), { timeout: 600_000 });
            await settle();
        });
        expect(h.requests("rows", MACHINES).length - rowsRead).toBe(1);
        await timed("save", async () => {
            await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
            await settle();
        });
        console.table(phases);
    });
});
