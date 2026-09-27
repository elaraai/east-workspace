/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A paged preview whose dataset moves on — a run of its producer writes a new
 * value — follows it. A page pinned to the old value is refused with a 409,
 * which is no failure: the preview fetches the status again and reads the new
 * value. A page of the old value still in flight when the new one arrives
 * never lands among the new value's pages.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { ArrayType, IntegerType, encodeBeast2For, none, some, toEastTypeValue } from "@elaraai/east";
import { DatasetHashMismatchError, datasetGetPage, datasetGetStatus, type DatasetPage } from "@elaraai/e3-api-client";
import { system } from "@elaraai/east-ui-components";
import { E3Provider } from "../platform/e3-config.js";
import { DatasetPreview } from "./DatasetPreview.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    datasetGetStatus: vi.fn(),
    datasetGetPage: vi.fn(),
}));

afterEach(() => {
    cleanup();
    vi.mocked(datasetGetStatus).mockReset();
    vi.mocked(datasetGetPage).mockReset();
});

const API = "http://e3.test";
const OLD = "1".repeat(64);
const NEW = "2".repeat(64);
const RowsType = ArrayType(IntegerType);

/** The status route's answer for a value of `hash`. */
function statusOf(hash: string) {
    return { path: ".rows", type: toEastTypeValue(RowsType), refType: "value", hash: some(hash), size: some(64n), segments: none, rows: none };
}

/** The first page of a value of `n` rows. */
function pageOf(n: number, hash: string): DatasetPage {
    const rows = Array.from({ length: n }, (_, i) => BigInt(i));
    return { data: encodeBeast2For(RowsType)(rows), totalElements: n, totalBytes: 64, totalExact: true, segmentCount: 1, offset: 0, count: n, hash } as DatasetPage;
}

function renderPreview() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: API, workspace: "w" }} queryClient={client}>
                <DatasetPreview apiUrl={API} repo="default" workspace="w" path="rows" pollInterval={60_000} />
            </E3Provider>
        </ChakraProvider>,
    );
    return client;
}

describe("a paged preview whose dataset moves on", () => {
    test("a page refused as stale fetches the status again and reads the new value, showing no failure", async () => {
        vi.mocked(datasetGetStatus).mockResolvedValueOnce(statusOf(OLD) as never).mockResolvedValue(statusOf(NEW) as never);
        vi.mocked(datasetGetPage).mockImplementation(async (_url, _repo, _ws, _path, { hash }) => {
            if (hash === OLD) throw new DatasetHashMismatchError(`Dataset content is ${NEW}, not ${OLD}`, NEW);
            return pageOf(3, NEW);
        });
        renderPreview();
        expect(await screen.findByText(/^3 items/)).not.toBe(null);
        expect(screen.queryByText("Paged load failed")).toBe(null);
        expect(vi.mocked(datasetGetStatus)).toHaveBeenCalledTimes(2);
    });

    test("a page of the old value still in flight when the new one arrives never lands", async () => {
        vi.mocked(datasetGetStatus).mockResolvedValueOnce(statusOf(OLD) as never).mockResolvedValue(statusOf(NEW) as never);
        let landOld!: () => void;
        vi.mocked(datasetGetPage).mockImplementation(async (_url, _repo, _ws, _path, { hash }) => {
            if (hash === OLD) {
                await new Promise<void>((resolve) => { landOld = resolve; });
                return pageOf(5, OLD);
            }
            return pageOf(3, NEW);
        });
        const client = renderPreview();
        await vi.waitFor(() => expect(landOld).toBeDefined());
        // The dataset moves on while the old value's first page is in flight.
        await client.invalidateQueries({ queryKey: ["datasetStatus", API, "default", "w", "rows"] });
        expect(await screen.findByText(/^3 items/)).not.toBe(null);
        landOld();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.queryByText(/^5 items/)).toBe(null);
        expect(screen.queryByText(/^3 items/)).not.toBe(null);
    });
});
