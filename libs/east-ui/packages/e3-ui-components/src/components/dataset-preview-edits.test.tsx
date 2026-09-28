/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Two edits in an editable preview, the second made before the value the first
 * wrote has loaded, both reach the dataset. Applied to the value on screen, the
 * second edit would write the first away.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { DictType, IntegerType, StringType, decodeBeast2For, encodeBeast2For, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { datasetGet, datasetGetStatus, datasetSet } from "@elaraai/e3-api-client";
import { system, type ValueTreeValue } from "@elaraai/east-ui-components";
import { E3Provider } from "../platform/e3-config.js";
import { DatasetPreview } from "./DatasetPreview.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    datasetGetStatus: vi.fn(),
    datasetGet: vi.fn(),
    datasetSet: vi.fn(),
}));

/** The tree the preview renders, as it last rendered it. */
const shown: { tree?: ValueTreeValue } = {};
vi.mock("@elaraai/east-ui-components", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/east-ui-components")>(),
    EastChakraValueTree: ({ value }: { value: ValueTreeValue }) => { shown.tree = value; return null; },
}));

afterEach(() => {
    cleanup();
    vi.mocked(datasetGetStatus).mockReset();
    vi.mocked(datasetGet).mockReset();
    vi.mocked(datasetSet).mockReset();
    delete shown.tree;
});

const API = "http://e3.test";
const CountsType = DictType(StringType, IntegerType);

describe("an editable preview", () => {
    test("applies an edit made before the last edit's value has loaded to that value", async () => {
        vi.mocked(datasetGetStatus).mockResolvedValue({
            path: ".counts", type: toEastTypeValue(CountsType), refType: "value",
            hash: some("1".repeat(64)), size: some(16n), segments: none, rows: none,
        } as never);
        vi.mocked(datasetGet).mockResolvedValue({ data: encodeBeast2For(CountsType)(new Map()), hash: "1".repeat(64) } as never);
        // Each write is still in flight when the next edit is made.
        vi.mocked(datasetSet).mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <ChakraProvider value={system}>
                <E3Provider config={{ apiUrl: API, workspace: "w" }} queryClient={client}>
                    <DatasetPreview apiUrl={API} repo="default" workspace="w" path="counts" pollInterval={60_000} editable />
                </E3Provider>
            </ChakraProvider>,
        );
        await vi.waitFor(() => expect(shown.tree?.onInsert.type).toBe("some"));

        const insert = (shown.tree!.onInsert as unknown as { value: (path: unknown[]) => Promise<void> }).value;
        void insert([variant("key", "x")]);
        void insert([variant("key", "y")]);
        await vi.waitFor(() => expect(vi.mocked(datasetSet)).toHaveBeenCalledTimes(2));

        const written = vi.mocked(datasetSet).mock.calls.map((call) => [...(decodeBeast2For(CountsType)(call[4]) as Map<string, bigint>).keys()]);
        expect(written).toEqual([["x"], ["x", "y"]]);
    });
});
