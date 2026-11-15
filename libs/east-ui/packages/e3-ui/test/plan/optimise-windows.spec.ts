/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Plan's optimiser over jobs read a cell at a time (east-workspace#1622):
 * the example builds — a function that reads the jobs through their series
 * index alone, and lists them in `drafts`, is taken over a Plan that never
 * holds the jobs whole — and the works' maintenance optimiser over the jobs'
 * series index: every job on a press that is down, over the window, sent back
 * to the backlog with its press kept; a job on another press, and one of the
 * down press outside the window, left as they are; and a job a draft puts on
 * the down press read among them, as the index holds it with the draft laid.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    PatchType, SortedMap, SortedSet, StringType, compareFor, diffFor, equalFor, none, printFor, some, variant,
    type EastIR, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { Plan } from "@elaraai/e3-ui/internal";
import { indexEntries } from "../index-entries.js";
import type { PrintJob } from "./plan-events.examples.js";
import { planWindowJobs } from "./plan-windows.examples.js";
import * as ex from "./optimise-windows.examples.js";

describeEast("Plan — the optimiser's example over jobs read a cell at a time (#1622)", test => {
    Assert.examples(test, { planOptimiseWindows: ex.planOptimiseWindows });
}, { platformFns: TestImpl });

type Request = ValueTypeOf<typeof Plan.Types.OptimiseRequest>;
type Job = ValueTypeOf<typeof PrintJob>;
const byString = compareFor(StringType);

describe("the works' maintenance optimiser over the jobs' series index", () => {
    const from = new Date("2026-10-05T00:00:00Z"), to = new Date("2026-10-19T00:00:00Z");
    const job = (title: string, start: Date | null, hours: number, press: string | null): Job => ({
        title, start: start === null ? none : some(start), end: start === null ? none : some(new Date(start.getTime() + hours * 3_600_000)),
        press: press === null ? none : some(press), state: variant("confirmed", null), sheets: hours * 8000, customer: "A customer", stock: variant("coated", null), due: none,
    });
    const jobs = new SortedMap<string, Job>([
        ["J-1", job("On the press that is down", new Date("2026-10-07T06:00:00Z"), 60, "P-1003")],
        ["J-2", job("On it too, the week after", new Date("2026-10-13T06:00:00Z"), 4, "P-1003")],
        ["J-3", job("On it, after the window", new Date("2026-10-21T06:00:00Z"), 4, "P-1003")],
        ["J-4", job("On another press", new Date("2026-10-07T06:00:00Z"), 8, "P-1004")],
        ["J-5", job("Waiting, booked for the press that is down", null, 4, "P-1003")],
    ], byString);
    const down = new SortedSet<string>(["P-1003"], byString);
    const request: Request = { from, to, period: variant("day", null), run: 1n, slice: new Map() };
    const optimise = (ex.clearDownPresses.body as EastIR<EastType[], EastType>).compile([]) as unknown as
        (byPress: unknown, down: unknown, request: Request) => ValueTypeOf<typeof ex.PlanWindowsOptimiseResult>;
    /** The answer over the jobs as the index holds them: its series entries, built as e3 builds them. */
    const run = (held: SortedMap<string, Job>, presses: SortedSet<string> = down) =>
        optimise(indexEntries(planWindowJobs, planWindowJobs.indexes.plan_window_jobs_by_press_week, held).entries, presses, request);
    const patchOf = diffFor(ex.WindowJobs);
    const samePatch = equalFor(PatchType(ex.WindowJobs));
    const printPatch = printFor(PatchType(ex.WindowJobs));
    /** A job sent back to the backlog: its start and its end cleared, the rest as it was. */
    const cleared = (row: Job): Job => ({ ...row, start: none, end: none });
    /** The patch that clears the jobs named, of the jobs held. */
    const clearing = (held: SortedMap<string, Job>, keys: readonly string[]) => patchOf(
        new SortedMap(keys.map((key) => [key, held.get(key)!] as const), byString),
        new SortedMap(keys.map((key) => [key, cleared(held.get(key)!)] as const), byString));

    test("every job on a press that is down, over the window, goes back to the backlog with its press kept; one after the window, one on another press and one waiting already are none of the answer", () => {
        const answer = run(jobs).events.job;
        assert.ok(samePatch(answer, clearing(jobs, ["J-1", "J-2"])), printPatch(answer));
    });

    test("a job a draft puts on the press that is down is read among them: the index holds it there with the draft laid", () => {
        // The planner's unsaved drag, laid over the record: the job of another press now on the press that is down.
        const drafted = new SortedMap<string, Job>([...jobs], byString);
        drafted.set("J-4", { ...jobs.get("J-4")!, press: some("P-1003") });
        const answer = run(drafted).events.job;
        assert.ok(samePatch(answer, clearing(drafted, ["J-1", "J-2", "J-4"])), printPatch(answer));
    });

    test("with no press down, and with a press down that holds no job, the answer changes nothing", () => {
        const nothing = patchOf(new SortedMap([], byString), new SortedMap([], byString));
        const none_ = run(jobs, new SortedSet<string>([], byString)).events.job;
        assert.ok(samePatch(none_, nothing), printPatch(none_));
        const idle = run(jobs, new SortedSet<string>(["P-1999"], byString)).events.job;
        assert.ok(samePatch(idle, nothing), printPatch(idle));
    });
});
