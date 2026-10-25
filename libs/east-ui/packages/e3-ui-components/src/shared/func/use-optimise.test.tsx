/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A run of the app's optimiser (#1409, #1414; R1–R6, R10, O4, D5) on e3: the
 * jobs calendar's optimiser, called by name through the shared `Func`
 * runtime, from a probe under the file's e3 — one call per run, with the
 * request made for the run's number; the seconds from 1; a result landed,
 * told once with its request, and counted — changes, none with a blink, an
 * answer the builder cannot use; a failed call; Stop, and an answer arriving
 * after it ignored; a change of scope stops the run, a change of anything
 * else does not; unmount aborts; the run counter outlives a remount; and no
 * optimiser bound offers nothing.
 */

import { useEffect } from "react";
import { describe, expect, test, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { SortedMap, StringType, compareFor, equalFor, type ValueTypeOf } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import * as opt from "@elaraai/e3-ui/examples/calendar/optimise";
import { E3Surface, act, e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { fitCalls } from "./fit-calls.test-utils.js";
import { OPTIMISE_STOPPED_MS, useOptimise, type OptimiseCounts, type OptimiseRun } from "./use-optimise.js";

const h = e3Harness({ "calendar/calendar": ex, "calendar/optimise": opt });
const calls = fitCalls(h, { request: opt.CalendarOptimiseRequest, result: opt.CalendarOptimiseResult });
/** The shop's optimiser, by its `e3.function` name. */
const NAME = "calendar_schedule_backlog";
type Request = ValueTypeOf<typeof opt.CalendarOptimiseRequest>;
type Result = ValueTypeOf<typeof opt.CalendarOptimiseResult>;
type Job = ValueTypeOf<typeof ex.CalendarJob>;
type Machine = ValueTypeOf<typeof ex.CalendarMachine>;
const byString = compareFor(StringType);
const sameRequest = equalFor(opt.CalendarOptimiseRequest);
const FROM = new Date("2026-09-28T00:00:00Z"), TO = new Date("2026-10-05T00:00:00Z");
/** A run's request over an empty window: nothing for the optimiser to schedule, so its answer is the request's rows back. */
const request = (run: number): Request => ({ from: FROM, to: TO, run: BigInt(run), events: { job: new SortedMap<string, Job>([], byString) }, resources: { machines: new SortedMap<string, Machine>([], byString) } });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const COUNTS: OptimiseCounts = { added: 1, changed: 0, removed: 0 };

function Probe({ name, scope, layout, onLanded, onRun }: {
    name: string | null; scope: string; layout: string; onLanded: (result: Result, request: Request, run: number) => OptimiseCounts | undefined; onRun: (run: OptimiseRun<Request>) => void;
}) {
    const run = useOptimise<Request, Result>({ name, requestType: opt.CalendarOptimiseRequest, resultType: opt.CalendarOptimiseResult, scope, storageKey: "test.optimise", onLanded });
    onRun(run);
    useEffect(() => { void layout; });
    return null;
}

/** The probe under the file's e3, its run read as it renders. */
function mount(onLanded: (result: Result, request: Request, run: number) => OptimiseCounts | undefined = () => COUNTS, name: string | null = NAME) {
    let latest!: OptimiseRun<Request>;
    const tree = (scope: string, layout = "week") => <E3Surface><Probe name={name} scope={scope} layout={layout} onLanded={onLanded} onRun={(run) => { latest = run; }} /></E3Surface>;
    const view = render(tree("W11"));
    const start = async (period = "W11") => { await act(async () => { latest.start(request, period); }); };
    /** Waits for the run out to land, e3 having run the optimiser for it. */
    const landed = () => waitFor(() => expect(latest.running).toBe(false), { timeout: 10_000 });
    return { ...view, run: () => latest, tree, start, landed };
}

describe("useOptimise", () => {
    test("R1 — a run sends one call with the request made for its number, from 1; the seconds count from 1; the result lands once, with its request, and is counted", async () => {
        const seen: [Result, Request, number][] = [];
        const { run, start, landed } = mount((result, asked, n) => { seen.push([result, asked, n]); return { added: 2, changed: 1, removed: 0 }; });
        await settle();
        expect([run().offered, run().running, run().run, run().outcome]).toEqual([true, false, 0, undefined]);
        const hold = calls.hold(NAME);
        await start();
        await hold.holding;
        expect([run().running, run().run, run().seconds]).toEqual([true, 1, 1]);
        expect(calls.requests(NAME)).toHaveLength(1);
        expect(sameRequest(calls.requests(NAME)[0]!, request(1))).toBe(true);
        // A second click while a call is out sends nothing.
        await start();
        expect([calls.requests(NAME).length, run().run]).toEqual([1, 1]);
        // The seconds, from 1, each whole second the call is out.
        await sleep(2100);
        expect(run().seconds).toBeGreaterThanOrEqual(2);
        hold.release();
        await landed();
        expect(seen).toHaveLength(1);
        expect([sameRequest(seen[0]![1], request(1)), seen[0]![2], seen[0]![0].events.job.size]).toEqual([true, 1, 0]);
        expect(run().outcome).toEqual({ kind: "done", run: 1, period: "W11", counts: { added: 2, changed: 1, removed: 0 } });
    });

    test("R10 — a result with nothing to change is the none outcome and one blink; an answer the builder cannot use, and a failed call, are failures", async () => {
        let counts: OptimiseCounts | undefined = { added: 0, changed: 0, removed: 0 };
        const { run, start, landed } = mount(() => counts);
        await settle();
        await start();
        await landed();
        expect([run().outcome, run().blinks]).toEqual([{ kind: "none", run: 1, period: "W11" }, 1]);
        counts = undefined;
        await start("W12");
        await landed();
        expect([run().outcome, run().blinks]).toEqual([{ kind: "fail", run: 2, period: "W12", message: "the optimiser's answer could not be used" }, 1]);
        const restore = calls.fail(NAME);
        await start();
        await landed();
        const failed = run().outcome;
        expect(failed?.kind === "fail" ? [failed.run, failed.period, failed.message !== ""] : failed).toEqual([3, "W11", true]);
        restore();
        act(() => { run().dismiss(); });
        expect(run().outcome).toBeUndefined();
    });

    test("R3 — Stop cancels the call: an answer arriving after it is ignored, nothing is counted, and the footer's note holds for 2.5s", async () => {
        const seen = vi.fn(() => COUNTS);
        const { run, start, landed } = mount(seen);
        await settle();
        const hold = calls.hold(NAME);
        await start();
        await hold.holding;
        act(() => { run().stop(); });
        expect([run().running, run().stopped, run().outcome]).toEqual([false, true, undefined]);
        hold.release();
        await settle();
        expect([seen.mock.calls.length, run().outcome]).toEqual([0, undefined]);
        await sleep(OPTIMISE_STOPPED_MS + 200);
        expect(run().stopped).toBe(false);
        // The next run lands as any does.
        await start();
        await landed();
        expect([seen.mock.calls.length, run().outcome?.kind, run().run]).toEqual([1, "done", 2]);
    });

    test("O4 — a change of scope stops the run as Stop does; a change of anything else does not", async () => {
        const seen = vi.fn(() => COUNTS);
        const { run, start, tree, rerender } = mount(seen);
        await settle();
        const hold = calls.hold(NAME);
        await start();
        await hold.holding;
        rerender(tree("W11", "month"));
        expect(run().running).toBe(true);
        rerender(tree("W12"));
        expect([run().running, run().stopped]).toEqual([false, true]);
        hold.release();
        await settle();
        expect(seen).not.toHaveBeenCalled();
    });

    test("R4 — unmount aborts the call; D5 — the run counter outlives a remount", async () => {
        const seen = vi.fn(() => COUNTS);
        const first = mount(seen);
        await settle();
        const hold = calls.hold(NAME);
        await first.start();
        await hold.holding;
        first.unmount();
        hold.release();
        await settle();
        expect(seen).not.toHaveBeenCalled();
        const second = mount(seen);
        await settle();
        expect(second.run().run).toBe(1);
        await second.start();
        expect(second.run().run).toBe(2);
        await second.landed();
    });

    test("R6 — with no optimiser bound nothing is offered, and a start sends nothing", async () => {
        const { run, start } = mount(() => COUNTS, null);
        await settle();
        expect(run().offered).toBe(false);
        await start();
        expect([run().running, run().run, calls.requests(NAME).length]).toEqual([false, 0, 0]);
    });
});
