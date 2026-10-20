/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A poll of a run from its cursor: the cursor, an East integer, keys the
 * query printed, so each window is a query of its own, and react-query, which
 * hashes a key as JSON, is never handed a bigint. Over a run on e3 itself
 * (#1377): another session's, after it wrote the counts the report reads.
 */

import { describe, test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntegerType, printFor } from "@elaraai/east";
import { dataflowExecutePoll, type DataflowExecutionState, type ExecutionStateOptions } from "@elaraai/e3-api-client";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { useDataflowExecution } from "./executions.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

const printSeq = printFor(IntegerType);

/** A window of the run, as e3 answers another session's poll of it: no request of the hook's. */
const windowOf = (window: ExecutionStateOptions) => dataflowExecutePoll(h.e3.apiUrl, h.e3.repo, h.workspace, window, h.e3.direct);

/** The windows the hook polled, each its cursor and its limit, as the requests spell them. */
const polled = () => h.requests("dataflow").filter((request) => request.path.endsWith("/dataflow/execution"))
    .map((request) => [request.query.get("since"), request.query.get("limit")]);

describe("useDataflowExecution", () => {
    test("polls from the cursor it is given, each window a query of its own", async () => {
        // Another session writes the counts and runs the dataflow: the report and the counts' view run again.
        await h.write(ex.previewCountsInput, new Map([["a", 4n], ["d", 5n]]));
        await h.run();
        const first = await windowOf({ since: 0n, limit: 2 });
        const second = await windowOf({ since: first.nextSeq, limit: 2 });
        expect(second.events.length, "the run has events past its first window").toBeGreaterThan(0);

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { result, rerender } = renderHook(
            ({ window }: { window: ExecutionStateOptions }) => useDataflowExecution(h.e3.apiUrl, h.e3.repo, h.workspace, window, { token: null, fetch: h.e3.fetch }),
            {
                initialProps: { window: { since: 0n, limit: 2 } },
                wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
            },
        );
        await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.nextSeq).toBe(first.nextSeq);
        expect(polled()).toEqual([["0", "2"]]);

        // The next window is polled, and the first stays under its own key.
        rerender({ window: { since: first.nextSeq, limit: 2 } });
        await vi.waitFor(() => expect(result.current.data?.nextSeq).toBe(second.nextSeq));
        expect(polled()).toEqual([["0", "2"], [printSeq(first.nextSeq), "2"]]);
        expect(client.getQueryData<DataflowExecutionState>(["dataflowExecution", h.e3.apiUrl, h.e3.repo, h.workspace, "0", 2])?.nextSeq).toBe(first.nextSeq);
    });
});
