/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A task's details as `useTaskDetails` reads them, from e3 itself (#1377):
 * from the server once, under the key `useTaskGet` reads by, so a preview and
 * the host that opened it share one read; and from the host that holds them,
 * without a request, and again as the host's change.
 */

import { describe, test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { taskGet, type RequestOptions, type TaskDetails } from "@elaraai/e3-api-client";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { useTaskGet } from "./tasks.js";
import { useTaskDetails } from "./useTaskDetails.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** The data task the preview shows, `preview_report`. */
const REPORT = ex.previewReportTask.name;
/** The ui task beside it. */
const VIEW = ex.previewView.name;

/** The requests' options: their token, and the harness's fetch they go through. */
const options = (): RequestOptions => ({ token: null, fetch: h.e3.fetch });

/** A task's details, read as another session would: no request of the hooks'. */
const detailsOf = (task: string): Promise<TaskDetails> => taskGet(h.e3.apiUrl, h.e3.repo, h.workspace, task, h.e3.direct);

/** A client, as a host and the preview it opened share one. */
function client(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** The requests made of the task's details. */
const detailReads = (task: string) => h.requests("task").filter((request) => request.name === task);

describe("useTaskDetails", () => {
    test("reads the task once for a host and the preview it opened, under one key", async () => {
        const shared = client();
        const requestOptions = options();
        const { result } = renderHook(() => ({
            host: useTaskGet(h.e3.apiUrl, h.e3.repo, h.workspace, REPORT, requestOptions),
            preview: useTaskDetails(h.e3.apiUrl, h.e3.repo, h.workspace, REPORT, { requestOptions }),
        }), { wrapper: ({ children }) => <QueryClientProvider client={shared}>{children}</QueryClientProvider> });
        const stored = await detailsOf(REPORT);
        await vi.waitFor(() => expect(result.current.preview.data?.hash).toBe(stored.hash));
        expect(result.current.host.data?.hash).toBe(stored.hash);
        expect(detailReads(REPORT)).toHaveLength(1);
    });

    test("answers from the details the host holds, without a request, and follows them as they change", async () => {
        const shared = client();
        const report = await detailsOf(REPORT);
        const { result, rerender } = renderHook(
            ({ held }: { held: TaskDetails }) => useTaskDetails(h.e3.apiUrl, h.e3.repo, h.workspace, REPORT, { requestOptions: options(), details: held }),
            { initialProps: { held: report }, wrapper: ({ children }) => <QueryClientProvider client={shared}>{children}</QueryClientProvider> },
        );
        expect(result.current.data?.hash, "the details the host holds, at once").toBe(report.hash);

        // The host hands over other details — another task's, so the change shows: they are shown.
        const view = await detailsOf(VIEW);
        rerender({ held: view });
        await vi.waitFor(() => expect(result.current.data?.hash).toBe(view.hash));
        expect(detailReads(REPORT), "the server is never asked").toEqual([]);
    });
});
