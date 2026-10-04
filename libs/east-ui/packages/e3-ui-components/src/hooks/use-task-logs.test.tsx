/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A task's log as `useTaskLogs` polls it: each poll reads on from where the
 * last stopped, every second while the log grows and less often while it does
 * not, down to every 5 s; a poll that fails keeps what was read and waits
 * longer; and another task's log is read from its first byte, every second.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, defaultScheduler, notifyManager } from "@tanstack/react-query";
import { taskLogs, type LogOptions } from "@elaraai/e3-api-client";
import { LOG_POLL_BACKOFF_MS, LOG_POLL_MS, useTaskLogs } from "./useTaskLogsHook.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    taskLogs: vi.fn(),
}));

/** The real `setTimeout`, taken before the fake clock replaces it. */
const realSetTimeout = globalThis.setTimeout;

const API = "http://e3.test";
const [FIRST, SECOND] = ["01993c00-0000-7000-8000-000000000001", "01993c00-0000-7000-8000-000000000002"];

/** Each task's current execution's log as the server holds it, and how many
 *  reads of it are still to fail. */
let logs: Map<string, { executionId: string; text: string; failures: number }>;
/** The offset of each read of each task's log the hook asked for. */
let reads: Map<string, number[]>;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    // TanStack tells a view of a query's change on a zero-delay timer, which
    // the fake clock would hold until it moves. Told at once, a poll's wait is
    // timed from the poll before it.
    notifyManager.setScheduler(queueMicrotask);
    logs = new Map();
    reads = new Map();
    vi.mocked(taskLogs).mockImplementation((_url, _repo, _workspace, task, options: LogOptions = {}) => {
        const log = logs.get(task)!;
        const offset = options.offset ?? 0;
        reads.set(task, [...reads.get(task) ?? [], offset]);
        if (log.failures > 0) {
            log.failures--;
            return Promise.reject(new Error("the server is away"));
        }
        const data = log.text.slice(offset, offset + (options.limit ?? 65536));
        return Promise.resolve({
            data, offset: BigInt(offset), size: BigInt(data.length), totalSize: BigInt(log.text.length),
            complete: offset + data.length >= log.text.length,
            inputsHash: "a".repeat(64), executionId: log.executionId, ended: false,
        });
    });
});

afterEach(() => {
    cleanup();
    notifyManager.setScheduler(defaultScheduler);
    vi.useRealTimers();
    vi.mocked(taskLogs).mockReset();
});

/** Lets what is in flight settle as real time passes, the fake clock
 *  standing still. */
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await act(async () => {
            await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
        });
    }
}

/** Moves the fake clock on by `ms` once what is in flight has settled, and
 *  lets what that starts settle. */
async function advance(ms: number): Promise<void> {
    await settle();
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
    await settle();
}

/** Expects no read of the task's log before `wait` ms have passed, and one at it. */
async function readAfter(task: string, wait: number): Promise<void> {
    const before = reads.get(task)?.length ?? 0;
    await advance(wait - 1);
    expect(reads.get(task)?.length ?? 0, `nothing is read before ${wait} ms have passed`).toBe(before);
    await advance(1);
    expect(reads.get(task)?.length ?? 0, `a read at ${wait} ms`).toBe(before + 1);
}

/** The hook, polling the stdout of `task`, under a client that tries no
 *  failed query again itself. */
function renderLogs(task: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderHook(({ task }: { task: string }) => useTaskLogs(API, "default", "w", task, "stdout"), {
        initialProps: { task },
        wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
}

describe("useTaskLogs", () => {
    test("reads on from where the last poll stopped, every second while the log grows, backing off to 5 s while it does not", async () => {
        logs.set("t", { executionId: FIRST, text: "one\n", failures: 0 });
        const { result } = renderLogs("t");
        await settle();
        expect(result.current.data?.data).toBe("one\n");

        logs.get("t")!.text += "two\n";
        await readAfter("t", LOG_POLL_MS);
        expect(result.current.data?.data).toBe("one\ntwo\n");
        // Nothing new: each wait twice the last, up to 5 s
        for (const wait of [LOG_POLL_MS, 2 * LOG_POLL_MS, 4 * LOG_POLL_MS, LOG_POLL_BACKOFF_MS, LOG_POLL_BACKOFF_MS]) await readAfter("t", wait);

        // Something new: every second again
        logs.get("t")!.text += "three\n";
        await readAfter("t", LOG_POLL_BACKOFF_MS);
        expect(result.current.data?.data).toBe("one\ntwo\nthree\n");
        await readAfter("t", LOG_POLL_MS);
        expect(reads.get("t")).toEqual([0, 4, 8, 8, 8, 8, 8, 8, 14]);
    });

    test("keeps what it read when a poll fails, and waits longer before the next", async () => {
        logs.set("t", { executionId: FIRST, text: "one\n", failures: 0 });
        const { result } = renderLogs("t");
        await settle();

        logs.get("t")!.failures = 1;
        await readAfter("t", LOG_POLL_MS);
        expect(result.current.data?.data).toBe("one\n");

        logs.get("t")!.text += "two\n";
        await readAfter("t", 2 * LOG_POLL_MS);
        expect(result.current.data?.data).toBe("one\ntwo\n");
        expect(reads.get("t")).toEqual([0, 4, 4]);
    });

    test("reads another task's log from its first byte, every second", async () => {
        logs.set("t", { executionId: FIRST, text: "one\n", failures: 0 });
        logs.set("u", { executionId: SECOND, text: "another\n", failures: 0 });
        const { result, rerender } = renderLogs("t");
        await settle();
        // The first task's log backs off while nothing changes
        await readAfter("t", LOG_POLL_MS);
        await readAfter("t", 2 * LOG_POLL_MS);

        rerender({ task: "u" });
        await settle();
        expect(result.current.data?.data).toBe("another\n");
        await readAfter("u", LOG_POLL_MS);
        expect(reads.get("u")).toEqual([0, 8]);
    });
});
