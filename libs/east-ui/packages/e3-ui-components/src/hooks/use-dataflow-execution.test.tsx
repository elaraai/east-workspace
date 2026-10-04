/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A poll of a run from its cursor: the cursor, an East integer, keys the
 * query printed, so each window is a query of its own, and react-query, which
 * hashes a key as JSON, is never handed a bigint.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { none, variant } from "@elaraai/east";
import { dataflowExecutePoll, type DataflowExecutionState, type ExecutionStateOptions } from "@elaraai/e3-api-client";
import { useDataflowExecution } from "./executions.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    dataflowExecutePoll: vi.fn(),
}));

afterEach(() => {
    cleanup();
    vi.mocked(dataflowExecutePoll).mockReset();
});

const API = "http://e3.test";

/** A running run's state, served with the cursor past its events, which are all it has. */
const running = (nextSeq: bigint): DataflowExecutionState => ({
    runId: "run-1", status: variant("running", null), startedAt: "2026-10-02T00:00:00.000Z", completedAt: none, summary: none,
    events: [], nextSeq, lastSeq: nextSeq, budget: none, waiting: [], splits: [],
});

describe("useDataflowExecution", () => {
    test("polls from the cursor it is given, each window a query of its own", async () => {
        vi.mocked(dataflowExecutePoll).mockResolvedValueOnce(running(5n)).mockResolvedValueOnce(running(7n));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { result, rerender } = renderHook(
            ({ window }: { window: ExecutionStateOptions }) => useDataflowExecution(API, "default", "w", window),
            {
                initialProps: { window: { since: 3n, limit: 2 } },
                wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
            },
        );
        await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.nextSeq).toBe(5n);
        expect(vi.mocked(dataflowExecutePoll).mock.calls.map((call) => call[3])).toEqual([{ since: 3n, limit: 2 }]);

        // The next window is polled, and the first stays under its own key.
        rerender({ window: { since: 5n, limit: 2 } });
        await vi.waitFor(() => expect(result.current.data?.nextSeq).toBe(7n));
        expect(vi.mocked(dataflowExecutePoll).mock.calls.map((call) => call[3])).toEqual([{ since: 3n, limit: 2 }, { since: 5n, limit: 2 }]);
        expect(client.getQueryData<DataflowExecutionState>(["dataflowExecution", API, "default", "w", "3", 2])?.nextSeq).toBe(5n);
    });
});
