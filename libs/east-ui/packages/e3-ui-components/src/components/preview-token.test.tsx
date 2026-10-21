/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A rotated token, or another fetch, reaches a memoized preview: its next
 * request carries the new one. A memo that ignores the request options keeps
 * the preview on the render that captured the old one. On e3 itself (#1377):
 * the token each request carried is the request log's, and each fetch a host
 * gives counts what it carried.
 */

import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrayType, IntegerType, toEastTypeValue } from "@elaraai/east";
import { datasetGetPage } from "@elaraai/e3-api-client";
import { system, type ValueTreePaging } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { act, e3Harness } from "../e3-web-mount.test-utils.js";
import { taskDetailsQueryKey } from "../hooks/tasks.js";
import { TaskPreview } from "./TaskPreview.js";
import { PagedDatasetPreview } from "./PagedDatasetPreview.js";

/** The paging the preview's tree was last given. */
const shown: { paging?: ValueTreePaging | undefined } = {};
vi.mock("@elaraai/east-ui-components", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/east-ui-components")>(),
    EastChakraValueTree: ({ paging }: { paging?: ValueTreePaging }) => { shown.paging = paging; return null; },
}));

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** The task whose details the previews read. */
const REPORT = ex.previewReportTask.name;
/** The rows the paged preview reads. */
const ROWS = "inputs.preview_rows";
const RowsType = ArrayType(IntegerType);

function inProviders(client: QueryClient, children: React.ReactNode) {
    return (
        <ChakraProvider value={system}>
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </ChakraProvider>
    );
}

/** The task's details failing as e3 answers a failure, so the preview renders its error alone, and a refetch runs with the options it last rendered. */
const failDetails = () => h.e3.fail((request) => request.kind === "task" && request.name === REPORT, { status: 500, type: "internal", message: "unreachable" });
/** The reads of the task's details. */
const detailReads = () => h.requests("task").filter((request) => request.name === REPORT);

/** A thousand rows another session wrote, and their first page's hash. */
async function thousandRows(): Promise<string> {
    await h.write(ex.previewRowsInput, Array.from({ length: 1_000 }, (_, i) => BigInt(i)));
    return (await datasetGetPage(h.e3.apiUrl, h.e3.repo, h.workspace, ex.previewRowsInput.path, { offset: 0, limit: 1 }, h.e3.direct)).hash;
}

/** A fetch a host gives: the harness's, counting what it carries. */
function counted(): { fetch: typeof globalThis.fetch; carried: number } {
    const given = {
        carried: 0,
        fetch: ((input: RequestInfo | URL, init?: RequestInit) => { given.carried++; return h.e3.fetch(input, init); }) as typeof globalThis.fetch,
    };
    return given;
}

describe("a rotated token", () => {
    test("reaches TaskPreview's next request", async () => {
        failDetails();
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const preview = (token: string) => inProviders(client,
            <TaskPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} task={REPORT} requestOptions={{ token, fetch: h.e3.fetch }} />);
        const { rerender } = render(preview("old"));
        expect(await screen.findByText("API error: internal")).not.toBe(null);

        rerender(preview("new"));
        await act(async () => { await client.invalidateQueries({ queryKey: taskDetailsQueryKey(h.e3.apiUrl, h.e3.repo, h.workspace, REPORT) }); });
        expect(detailReads().map((request) => request.authorization)).toEqual(["Bearer old", "Bearer new"]);
    });

    test("reaches PagedDatasetPreview's next page", async () => {
        const hash = await thousandRows();
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const preview = (token: string) => inProviders(client,
            <PagedDatasetPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} path={ROWS} type={toEastTypeValue(RowsType)}
                hash={hash} sizeBytes={8000} requestOptions={{ token, fetch: h.e3.fetch }} onDownload={() => {}} />);
        const { rerender } = render(preview("old"));
        expect(await screen.findByText(/^1,000 items/)).not.toBe(null);

        rerender(preview("new"));
        await act(async () => { shown.paging!.onNeedRows(500, 1000); });
        await vi.waitFor(() => expect(h.requests("page", ROWS)).toHaveLength(2));
        expect(h.requests("page", ROWS).map((request) => request.authorization)).toEqual(["Bearer old", "Bearer new"]);
    });
});

describe("another fetch", () => {
    test("reaches TaskPreview's next request", async () => {
        failDetails();
        const before = counted();
        const after = counted();
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const preview = (fetch: typeof globalThis.fetch) => inProviders(client,
            <TaskPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} task={REPORT} requestOptions={{ token: "tok", fetch }} />);
        const { rerender } = render(preview(before.fetch));
        expect(await screen.findByText("API error: internal")).not.toBe(null);

        rerender(preview(after.fetch));
        await act(async () => { await client.invalidateQueries({ queryKey: taskDetailsQueryKey(h.e3.apiUrl, h.e3.repo, h.workspace, REPORT) }); });
        expect(detailReads()).toHaveLength(2);
        expect([before.carried, after.carried]).toEqual([1, 1]);
        expect(detailReads().at(-1)?.authorization).toBe("Bearer tok");
    });

    test("reaches PagedDatasetPreview's next page", async () => {
        const hash = await thousandRows();
        const before = counted();
        const after = counted();
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const preview = (fetch: typeof globalThis.fetch) => inProviders(client,
            <PagedDatasetPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} path={ROWS} type={toEastTypeValue(RowsType)}
                hash={hash} sizeBytes={8000} requestOptions={{ token: "tok", fetch }} onDownload={() => {}} />);
        const { rerender } = render(preview(before.fetch));
        expect(await screen.findByText(/^1,000 items/)).not.toBe(null);

        rerender(preview(after.fetch));
        await act(async () => { shown.paging!.onNeedRows(500, 1000); });
        await vi.waitFor(() => expect(h.requests("page", ROWS)).toHaveLength(2));
        expect([before.carried, after.carried]).toEqual([1, 1]);
    });
});
