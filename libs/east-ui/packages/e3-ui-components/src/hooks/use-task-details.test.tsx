/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A task's details as `useTaskDetails` reads them: from the server once, under
 * the key `useTaskGet` reads by, so a preview and the host that opened it
 * share one read; and from the host that holds them, without a request, and
 * again as the host's change.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { taskGet } from "@elaraai/e3-api-client";
import type { TaskDetailsType } from "@elaraai/e3-types";
import { useTaskGet } from "./tasks.js";
import { useTaskDetails } from "./useTaskDetails.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    taskGet: vi.fn(),
}));

afterEach(() => {
    cleanup();
    vi.mocked(taskGet).mockReset();
});

const API = "http://e3.test";

/** A data task, `report`, whose output is `.tasks.report.output`, by its hash. */
function details(hash: string): ValueTypeOf<typeof TaskDetailsType> {
    return {
        name: "report",
        hash,
        body: variant("east", { program: "3".repeat(64) }),
        runner: variant("east_node", { platforms: [], decode: variant("lazy", null) }),
        inputs: [],
        output: { path: [variant("field", "tasks"), variant("field", "report"), variant("field", "output")], kind: variant("value", null) },
        role: variant("data", null),
    };
}

/** A client, as a host and the preview it opened share one. */
function client(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("useTaskDetails", () => {
    test("reads the task once for a host and the preview it opened, under one key", async () => {
        vi.mocked(taskGet).mockResolvedValue(details("1".repeat(64)) as never);
        const shared = client();
        const { result } = renderHook(() => ({
            host: useTaskGet(API, "default", "w", "report"),
            preview: useTaskDetails(API, "default", "w", "report"),
        }), { wrapper: ({ children }) => <QueryClientProvider client={shared}>{children}</QueryClientProvider> });
        await vi.waitFor(() => expect(result.current.preview.data?.hash).toBe("1".repeat(64)));
        expect(result.current.host.data?.hash).toBe("1".repeat(64));
        expect(vi.mocked(taskGet)).toHaveBeenCalledTimes(1);
    });

    test("answers from the details the host holds, without a request, and follows them as they change", async () => {
        const shared = client();
        const { result, rerender } = renderHook(
            ({ held }: { held: ValueTypeOf<typeof TaskDetailsType> }) => useTaskDetails(API, "default", "w", "report", { details: held }),
            { initialProps: { held: details("1".repeat(64)) }, wrapper: ({ children }) => <QueryClientProvider client={shared}>{children}</QueryClientProvider> },
        );
        expect(result.current.data?.hash, "the details the host holds, at once").toBe("1".repeat(64));

        // The host read the task again: what it hands over now is shown.
        rerender({ held: details("2".repeat(64)) });
        await vi.waitFor(() => expect(result.current.data?.hash).toBe("2".repeat(64)));
        expect(vi.mocked(taskGet), "the server is never asked").not.toHaveBeenCalled();
    });
});
