/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A value read after its dataset moved on — the status named one hash, and the
 * read answered another's value — is kept under the hash the response names,
 * and never shown as the hash that was asked for: a return to that hash (a
 * toggled input) would show the other value.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntegerType, encodeBeast2For, toEastTypeValue } from "@elaraai/east";
import { datasetGet } from "@elaraai/e3-api-client";
import { useDatasetValue } from "./useDatasetValue.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    datasetGet: vi.fn(),
}));

afterEach(() => {
    cleanup();
    vi.mocked(datasetGet).mockReset();
});

const API = "http://e3.test";
const ASKED = "1".repeat(64);
const HELD = "2".repeat(64);
const key = (hash: string) => ["datasetValue", API, "default", "w", "x", hash];

describe("useDatasetValue", () => {
    test("keeps a value under the hash its response names, and fetches the status again", async () => {
        vi.mocked(datasetGet).mockResolvedValue({ data: encodeBeast2For(IntegerType)(7n), hash: HELD } as never);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(["datasetStatus", API, "default", "w", "x"], { hash: ASKED });
        const { result, rerender } = renderHook(
            ({ hash }: { hash: string }) => useDatasetValue(API, "default", "w", "x", { type: toEastTypeValue(IntegerType), hash }),
            {
                initialProps: { hash: ASKED },
                wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
            },
        );
        await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(result.current.data).toBe(undefined);
        expect((client.getQueryData(key(HELD)) as { decoded: unknown }).decoded).toBe(7n);
        expect(client.getQueryState(["datasetStatus", API, "default", "w", "x"])?.isInvalidated).toBe(true);

        // The status, fetched again, names the value that was read, which is
        // served from the cache at once.
        rerender({ hash: HELD });
        expect(result.current.data?.decoded).toBe(7n);
    });
});
