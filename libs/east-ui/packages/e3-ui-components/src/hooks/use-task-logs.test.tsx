/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A task's log as `useTaskLogs` polls it, on e3 itself (#1377): the Data.bind
 * examples' logging task (`preview_log`), whose run writes each of its lines
 * to standard output and how many there were to standard error. A run held
 * before its unit starts is an execution whose log is empty and has not
 * ended; once its unit runs, the same execution's log holds its lines, and
 * has ended. Each poll reads on from where the last stopped, every second
 * while the log grows and less often while it does not, down to every 5 s;
 * once the execution has ended and its log is read, every half minute, for
 * another execution, whose log it reads from its first byte; a poll that
 * fails keeps what was read and waits no less; a log the view comes back to
 * is read on from where it stopped, and one it goes to from its first byte;
 * and the intervals are the caller's when given. How long each poll waits is
 * the hook's `nextLogPollMs`, whose every case is held here too.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, defaultScheduler, notifyManager } from "@tanstack/react-query";
import { dataflowExecuteLaunch } from "@elaraai/e3-api-client";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { writeDataset, type E3Request, type E3UnitHold } from "../e3-web.test-utils.js";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { LOG_POLL_BACKOFF_MS, LOG_POLL_ENDED_MS, LOG_POLL_MS, nextLogPollMs, useTaskLogs, type LogPollOptions, type TaskLogRead } from "./useTaskLogsHook.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** The logging task. */
const TASK = ex.previewLogTask.name;

/** Whether a request reads the logging task's log of a stream. */
const readsLog = (stream: "stdout" | "stderr") => (request: E3Request) =>
    request.path.endsWith(`/dataflow/logs/${TASK}`) && request.query.get("stream") === stream;

/** The offset each read of a stream's log asked for, in order. */
const offsets = (stream: "stdout" | "stderr") => h.requests().filter(readsLog(stream)).map((request) => Number(request.query.get("offset")));

/**
 * Starts a run of the task over the given lines, as another session would,
 * its unit held before it starts: another execution, its log empty.
 *
 * @param lines - What the run writes
 * @returns The hold on its unit
 */
async function heldRun(lines: string[]): Promise<E3UnitHold> {
    const units = h.e3.holdUnits();
    await writeDataset(h.e3, h.workspace, ex.previewLogLinesInput, lines);
    await dataflowExecuteLaunch(h.e3.apiUrl, h.e3.repo, h.workspace, {}, h.e3.direct);
    await units.holding;
    return units;
}

/**
 * Moves the clock the hook's polls are timed by onto a fake one: TanStack
 * tells a view of a query's change on a zero-delay timer, which the fake clock
 * would hold until it moves, so it is told at once, and a poll's wait is timed
 * from the poll before it.
 */
function fakeClock(): void {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    notifyManager.setScheduler(queueMicrotask);
}

afterEach(() => {
    notifyManager.setScheduler(defaultScheduler);
    vi.useRealTimers();
});

/** Moves the fake clock on by `ms` once what is in flight has settled, and lets what that starts settle. */
async function advance(ms: number): Promise<void> {
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await settle();
}

/** Expects no read of a stream's log before `wait` ms have passed, and a poll at it. */
async function readAfter(stream: "stdout" | "stderr", wait: number): Promise<void> {
    const before = offsets(stream).length;
    await advance(wait - 1);
    expect(offsets(stream).length, `nothing is read before ${wait} ms have passed`).toBe(before);
    await advance(1);
    expect(offsets(stream).length, `a poll at ${wait} ms`).toBeGreaterThan(before);
}

/** The hook, polling a stream of the task's log over e3, under a client that tries no failed query again itself. */
function renderLogs(stream: "stdout" | "stderr", poll?: LogPollOptions) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderHook(({ stream }: { stream: "stdout" | "stderr" }) =>
        useTaskLogs(h.e3.apiUrl, h.e3.repo, h.workspace, TASK, stream, h.e3.options, undefined, poll), {
        initialProps: { stream },
        wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
}

describe("useTaskLogs, on e3", () => {
    test("reads a running execution's log as it grows, on from where the last poll stopped: every second while it grows, backing off to 5 s while it does not, every half minute once it has ended", async () => {
        const units = await heldRun(["three", "four", "five"]);
        fakeClock();
        const { result } = renderLogs("stdout");
        await settle();
        // The run's execution has begun, its unit held: its log is empty, and has not ended.
        expect(result.current.data?.data).toBe("");
        // Nothing new: each wait twice the last, up to 5 s.
        for (const wait of [LOG_POLL_MS, 2 * LOG_POLL_MS, 4 * LOG_POLL_MS, LOG_POLL_BACKOFF_MS]) await readAfter("stdout", wait);
        // The unit runs: its lines land in the same execution's log, which has ended.
        const ran = units.releaseOne();
        await advance(0);
        await ran;
        await readAfter("stdout", LOG_POLL_BACKOFF_MS);
        expect(result.current.data?.data).toBe("three\nfour\nfive\n");
        // Read whole, its execution ended: a poll every half minute, for another execution.
        await readAfter("stdout", LOG_POLL_ENDED_MS);
        expect(result.current.data?.data).toBe("three\nfour\nfive\n");
        expect(offsets("stdout")).toEqual([0, 0, 0, 0, 0, 0, 16]);
    });

    test("polls every half minute once the execution has ended and its log is read, and once a poll finds another execution, reads its log from its first byte, every second again", async () => {
        fakeClock();
        const { result } = renderLogs("stdout");
        await settle();
        // The deployed run's log, read whole: its execution has ended.
        expect(result.current.data?.data).toBe("one\ntwo\n");
        await readAfter("stdout", LOG_POLL_ENDED_MS);
        // The task runs again over another line, its unit held: another execution, its log empty.
        const units = await heldRun(["again"]);
        await readAfter("stdout", LOG_POLL_ENDED_MS);
        expect(result.current.data?.data).toBe("");
        await readAfter("stdout", LOG_POLL_MS);
        const ran = units.releaseOne();
        await advance(0);
        await ran;
        await readAfter("stdout", 2 * LOG_POLL_MS);
        expect(result.current.data?.data).toBe("again\n");
    });

    test("keeps what it read when a poll fails, and waits longer before the next: twice the last while the log grows, no less once its execution has ended; each poll one request", async () => {
        const units = await heldRun(["three"]);
        fakeClock();
        const { result } = renderLogs("stdout");
        await settle();
        const away = () => h.e3.fail(readsLog("stdout"), { status: 503, type: "unavailable", message: "the log is away" });
        // While the log may grow, a failed poll's next waits twice as long.
        let stop = away();
        await readAfter("stdout", LOG_POLL_MS);
        stop();
        await readAfter("stdout", 2 * LOG_POLL_MS);
        expect(result.current.data?.data).toBe("");
        // The unit runs, and the next poll reads what it wrote: the log is whole, its execution ended.
        const ran = units.releaseOne();
        await advance(0);
        await ran;
        await readAfter("stdout", 4 * LOG_POLL_MS);
        expect(result.current.data?.data).toBe("three\n");
        // Once it has ended, a failed poll keeps what was read, and its next waits the half minute still.
        stop = away();
        await readAfter("stdout", LOG_POLL_ENDED_MS);
        expect(result.current.data?.data).toBe("three\n");
        stop();
        await readAfter("stdout", LOG_POLL_ENDED_MS);
        expect(result.current.data?.data).toBe("three\n");
        expect(offsets("stdout"), "each poll asked once, a failed one too: its next poll is its retry").toEqual([0, 0, 0, 0, 6, 6]);
    });

    test("reads on from where it stopped in a log the view comes back to, and a log it goes to from its first byte", async () => {
        fakeClock();
        const { result, rerender } = renderLogs("stdout");
        await settle();
        expect(result.current.data?.data).toBe("one\ntwo\n");
        rerender({ stream: "stderr" });
        await settle();
        expect(result.current.data?.data).toBe("2 lines\n");
        rerender({ stream: "stdout" });
        await settle();
        expect(result.current.data?.data).toBe("one\ntwo\n");
        expect(offsets("stdout"), "the second read of the first log is from where the first stopped").toEqual([0, 8]);
        expect(offsets("stderr")).toEqual([0]);
    });

    test("polls at the intervals it is given", async () => {
        const units = await heldRun(["one more"]);
        fakeClock();
        renderLogs("stdout", { pollMs: 500, backoffMs: 2000, endedMs: 8000 });
        await settle();
        for (const wait of [500, 1000, 2000, 2000]) await readAfter("stdout", wait);
        const ran = units.releaseOne();
        await advance(0);
        await ran;
        await readAfter("stdout", 2000);
        await readAfter("stdout", 8000);
        expect(offsets("stdout")).toEqual([0, 0, 0, 0, 0, 0, 9]);
    });
});

describe("nextLogPollMs: how long a poll waits", () => {
    /** A log as a poll leaves it. */
    const log = (ended: boolean, complete: boolean): TaskLogRead => ({
        data: "one\n", inputsHash: "a".repeat(64), executionId: "01993c00-0000-7000-8000-000000000001",
        offset: 4, totalSize: 4, complete, ended,
    });

    test("a second after a poll that found something new; twice the last after each that found nothing, up to 5 s", () => {
        const growing = log(false, true);
        expect(nextLogPollMs(LOG_POLL_MS, growing, true)).toBe(LOG_POLL_MS);
        expect([LOG_POLL_MS, 2 * LOG_POLL_MS, 4 * LOG_POLL_MS, LOG_POLL_BACKOFF_MS].map((previous) => nextLogPollMs(previous, growing, false)))
            .toEqual([2 * LOG_POLL_MS, 4 * LOG_POLL_MS, LOG_POLL_BACKOFF_MS, LOG_POLL_BACKOFF_MS]);
        // Something new after a wait backed off: a second again.
        expect(nextLogPollMs(LOG_POLL_BACKOFF_MS, growing, true)).toBe(LOG_POLL_MS);
    });

    test("half a minute once the execution has ended and its log is read; an ended log still being read waits as a growing one", () => {
        expect(nextLogPollMs(LOG_POLL_MS, log(true, true), true)).toBe(LOG_POLL_ENDED_MS);
        expect(nextLogPollMs(LOG_POLL_ENDED_MS, log(true, true), false)).toBe(LOG_POLL_ENDED_MS);
        expect(nextLogPollMs(LOG_POLL_MS, log(true, false), true)).toBe(LOG_POLL_MS);
    });

    test("the caller's intervals, when given", () => {
        expect(nextLogPollMs(500, log(false, true), true, 500, 2000, 8000)).toBe(500);
        expect(nextLogPollMs(1500, log(false, true), false, 500, 2000, 8000)).toBe(2000);
        expect(nextLogPollMs(500, log(true, true), false, 500, 2000, 8000)).toBe(8000);
    });
});
