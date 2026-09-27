/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A rotated token reaches a memoized preview: its next request carries the new
 * token. A memo that ignores the request options keeps the preview on the
 * render that captured the old one.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrayType, IntegerType, encodeBeast2For, toEastTypeValue } from "@elaraai/east";
import { datasetGetPage, taskGet, type DatasetPage } from "@elaraai/e3-api-client";
import { system, type ValueTreePaging } from "@elaraai/east-ui-components";
import { TaskPreview } from "./TaskPreview.js";
import { PagedDatasetPreview } from "./PagedDatasetPreview.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    taskGet: vi.fn(),
    datasetGetPage: vi.fn(),
}));

/** The paging the preview's tree was last given. */
const shown: { paging?: ValueTreePaging | undefined } = {};
vi.mock("@elaraai/east-ui-components", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/east-ui-components")>(),
    EastChakraValueTree: ({ paging }: { paging?: ValueTreePaging }) => { shown.paging = paging; return null; },
}));

afterEach(() => {
    cleanup();
    vi.mocked(taskGet).mockReset();
    vi.mocked(datasetGetPage).mockReset();
    delete shown.paging;
});

const API = "http://e3.test";

function inProviders(client: QueryClient, children: React.ReactNode) {
    return (
        <ChakraProvider value={system}>
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </ChakraProvider>
    );
}

describe("a rotated token", () => {
    test("reaches TaskPreview's next request", async () => {
        // The task's details fail, so the preview renders its error alone, and
        // a refetch runs with the options it last rendered.
        vi.mocked(taskGet).mockRejectedValue(new Error("unreachable"));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const preview = (token: string) => inProviders(client,
            <TaskPreview apiUrl={API} repo="default" workspace="w" task="t" requestOptions={{ token }} />);
        const { rerender } = render(preview("old"));
        expect(await screen.findByText("unreachable")).not.toBe(null);

        rerender(preview("new"));
        await client.invalidateQueries({ queryKey: ["taskDetails"] });
        expect(vi.mocked(taskGet)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(taskGet).mock.lastCall?.[4]).toEqual({ token: "new" });
    });

    test("reaches PagedDatasetPreview's next page", async () => {
        const RowsType = ArrayType(IntegerType);
        vi.mocked(datasetGetPage).mockImplementation(async (_url, _repo, _ws, _path, { offset, limit }) => ({
            data: encodeBeast2For(RowsType)(Array.from({ length: limit }, (_, i) => BigInt(offset + i))),
            totalElements: 1000, totalBytes: 8000, totalExact: true, segmentCount: 2, offset, count: limit, hash: "3".repeat(64),
        } as DatasetPage));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const preview = (token: string) => inProviders(client,
            <PagedDatasetPreview apiUrl={API} repo="default" workspace="w" path="rows" type={toEastTypeValue(RowsType)}
                hash={"3".repeat(64)} sizeBytes={8000} requestOptions={{ token }} onDownload={() => {}} />);
        const { rerender } = render(preview("old"));
        expect(await screen.findByText(/^1,000 items/)).not.toBe(null);

        rerender(preview("new"));
        shown.paging!.onNeedRows(500, 1000);
        await vi.waitFor(() => expect(vi.mocked(datasetGetPage)).toHaveBeenCalledTimes(2));
        expect(vi.mocked(datasetGetPage).mock.lastCall?.[5]).toEqual({ token: "new" });
    });
});
