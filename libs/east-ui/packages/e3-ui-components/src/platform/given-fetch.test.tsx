/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host that answers e3's API itself — e3 running in a page — gives
 * `E3Config.fetch`, and the requests this package makes go through it: the
 * dataset cache and the `Func.bind`, `Data.bindPaged` and `Record.bind`
 * adapters the provider installs, and the previews. The global `fetch` refuses
 * every request here, and each test names any request that reached it.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntegerType, encodeBeast2For, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { DatasetStatusDetailType, ResponseType, TaskDetailsType } from "@elaraai/e3-types";
import { system } from "@elaraai/east-ui-components";
import { E3Provider, e3RequestOptions } from "./e3-config.js";
import { ReactiveDatasetProvider, useReactiveDatasetCache } from "./dataset-hooks.js";
import { defaultFuncRuntime, type FunctionApi } from "./func-runtime.js";
import { defaultPagedRuntime, type PagedApi } from "./paged-runtime.js";
import { defaultRecordRuntime, type RecordApi } from "./record-runtime.js";
import type { ReactiveDatasetCacheInterface } from "./dataset-store.js";
import { UITaskPreview } from "../components/UITaskPreview.js";
import { TaskPreview } from "../components/TaskPreview.js";

const API = "http://e3.test";
const HASH = "1".repeat(64);

/** A dataset holding an Integer value, as the status route answers it. */
const STATUS = encodeBeast2For(ResponseType(DatasetStatusDetailType))(variant("success", {
    path: ".out",
    type: toEastTypeValue(IntegerType),
    refType: "value",
    hash: some(HASH),
    size: some(9n),
    segments: none,
    rows: none,
}));

/** A ui task binding nothing, whose output is `.out`. */
const TASK = encodeBeast2For(ResponseType(TaskDetailsType))(variant("success", {
    name: "view",
    hash: "2".repeat(64),
    body: variant("east", { program: "3".repeat(64) }),
    runner: variant("east_node", { platforms: [], decode: variant("lazy", null) }),
    inputs: [],
    output: { path: [variant("field", "out")], kind: variant("value", null) },
    role: variant("ui", { paths: [], functions: [], records: [], pages: [] }),
}));

/** The requests that reached the global fetch. */
let escaped: string[] = [];

beforeEach(() => {
    escaped = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        escaped.push(url);
        throw new Error(`a request went to the global fetch: ${url}`);
    }));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

/** A server as the `fetch` a host gives: it serves the ui task `view` and its
 *  output's status, fails everything else, and records each request with the
 *  token it carried. */
function givenServer(): { requests: { path: string; auth: string | null }[]; fetch: typeof globalThis.fetch } {
    const requests: { path: string; auth: string | null }[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push({ path: `${url.pathname}${url.search}`, auth: new Headers(init?.headers).get("authorization") });
        if (url.pathname.endsWith("/tasks/view")) return new Response(TASK.slice(), { status: 200 });
        if (url.search.includes("status=true")) return new Response(STATUS.slice(), { status: 200 });
        return new Response(JSON.stringify({ error: { type: "internal", message: "not served here" } }), { status: 500 });
    }) as typeof globalThis.fetch;
    return { requests, fetch };
}

/** The adapter the provider installed in a process-global runtime. */
function installed<A>(runtime: unknown): A {
    return (runtime as { api: A }).api;
}

describe("e3RequestOptions", () => {
    test("gives the token, and the fetch only when the config gives one", () => {
        const given = givenServer().fetch;
        expect(e3RequestOptions({ token: "tok" })).toEqual({ token: "tok" });
        expect(e3RequestOptions({})).toEqual({ token: null });
        expect(e3RequestOptions({ token: "tok", fetch: given })).toEqual({ token: "tok", fetch: given });
    });
});

describe("E3Config.fetch", () => {
    test("carries the requests of the adapters the provider installs, and a rotated one carries the next at once", async () => {
        const first = givenServer();
        let cache: ReactiveDatasetCacheInterface | null = null;
        function Grab() {
            cache = useReactiveDatasetCache();
            return null;
        }
        const tree = (fetch: typeof globalThis.fetch, token: string) => (
            <E3Provider config={{ apiUrl: API, workspace: "w", token, fetch }}>
                <ReactiveDatasetProvider><Grab /></ReactiveDatasetProvider>
            </E3Provider>
        );
        const { rerender } = render(tree(first.fetch, "one"));
        const out = [variant("field", "out")];

        await expect(cache!.preload("w", out)).rejects.toThrow();
        await expect(installed<FunctionApi>(defaultFuncRuntime).list("w")).rejects.toThrow();
        await expect(installed<PagedApi>(defaultPagedRuntime).getRevision("w", out)).resolves.toBe(HASH);
        await expect(installed<RecordApi>(defaultRecordRuntime).describe("w", "tasks")).rejects.toThrow();
        expect(first.requests).toHaveLength(4);
        for (const request of first.requests) {
            expect(request.path.startsWith("/api/repos/default/workspaces/w/")).toBe(true);
            expect(request.auth).toBe("Bearer one");
        }

        // The same server identity with another fetch and token: the adapters
        // stay as they are, and their next request goes through the new ones.
        const second = givenServer();
        rerender(tree(second.fetch, "two"));
        await expect(installed<PagedApi>(defaultPagedRuntime).getRevision("w", out)).resolves.toBe(HASH);
        expect(second.requests).toEqual([{ path: "/api/repos/default/workspaces/w/datasets/out?status=true", auth: "Bearer two" }]);
        expect(first.requests).toHaveLength(4);
        expect(escaped).toEqual([]);
    });

    test("carries UITaskPreview's requests, from its config or from the provider", async () => {
        const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const fromConfig = givenServer();
        render(
            <ChakraProvider value={system}>
                <QueryClientProvider client={client()}>
                    <UITaskPreview task="view" config={{ apiUrl: API, workspace: "w", fetch: fromConfig.fetch }} />
                </QueryClientProvider>
            </ChakraProvider>,
        );
        // The task and its status are served, and its value fails.
        expect(await screen.findByText("Load failed")).not.toBe(null);
        cleanup();

        const fromProvider = givenServer();
        render(
            <ChakraProvider value={system}>
                <E3Provider config={{ apiUrl: API, workspace: "w", fetch: fromProvider.fetch }} queryClient={client()}>
                    <UITaskPreview task="view" />
                </E3Provider>
            </ChakraProvider>,
        );
        expect(await screen.findByText("Load failed")).not.toBe(null);

        for (const server of [fromConfig, fromProvider]) {
            const paths = server.requests.map((request) => request.path);
            expect(paths).toContain("/api/repos/default/workspaces/w/tasks/view");
            expect(paths).toContain("/api/repos/default/workspaces/w/datasets/out?status=true");
        }
        expect(escaped).toEqual([]);
    });

    test("TaskPreview hands its request options' fetch to the UI task's preview", async () => {
        const server = givenServer();
        render(
            <ChakraProvider value={system}>
                <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                    <TaskPreview apiUrl={API} repo="default" workspace="w" task="view" requestOptions={{ token: "tok", fetch: server.fetch }} />
                </QueryClientProvider>
            </ChakraProvider>,
        );
        // The UI preview's own reads — its output's status, then its value —
        // go through the fetch TaskPreview was given.
        expect(await screen.findByText("Load failed")).not.toBe(null);
        expect(server.requests.map((request) => request.path)).toContain("/api/repos/default/workspaces/w/datasets/out?status=true");
        for (const request of server.requests) expect(request.auth).toBe("Bearer tok");
        expect(escaped).toEqual([]);
    });
});
