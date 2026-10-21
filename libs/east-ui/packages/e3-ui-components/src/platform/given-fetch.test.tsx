/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host that answers e3's API itself — e3 running in a page — gives
 * `E3Config.fetch`, and the requests this package makes go through it: the
 * dataset cache and the `Func.bind`, `Data.bindPaged` and `Record.bind`
 * adapters the provider installs, and the previews. On e3 itself (#1377): each
 * fetch a host gives here is the harness's, saying what it carried and the
 * token each request did; and nothing reaches the global `fetch`, which
 * refuses every request a test makes (`vitest.setup.ts`).
 */

import { describe, test, expect } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { datasetGet } from "@elaraai/e3-api-client";
import { system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { E3Provider, e3RequestOptions } from "./e3-config.js";
import { ReactiveDatasetProvider, useReactiveDatasetCache } from "./dataset-hooks.js";
import { defaultFuncRuntime, type FunctionApi } from "./func-runtime.js";
import { defaultPagedRuntime, type PagedApi } from "./paged-runtime.js";
import { defaultRecordRuntime, type RecordApi } from "./record-runtime.js";
import type { ReactiveDatasetCacheInterface } from "./dataset-store.js";
import { UITaskPreview } from "../components/UITaskPreview.js";
import { TaskPreview } from "../components/TaskPreview.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** The ui task binding nothing, and the counts every adapter here reads. */
const VIEW = ex.previewView.name;
const COUNTS = ex.previewCountsInput.path;

/** A fetch a host gives: the harness's, recording each request it carries and the token it carried. */
function givenServer(): { requests: { path: string; auth: string | null }[]; fetch: typeof globalThis.fetch } {
    const requests: { path: string; auth: string | null }[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push({ path: `${url.pathname}${url.search}`, auth: new Headers(init?.headers).get("authorization") });
        return h.e3.fetch(input, init);
    }) as typeof globalThis.fetch;
    return { requests, fetch };
}

/** The workspace's routes, as a request's path starts. */
const workspaceRoutes = () => `/api/repos/${h.e3.repo}/workspaces/${h.workspace}/`;

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
            <E3Provider config={{ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, token, fetch }}>
                <ReactiveDatasetProvider><Grab /></ReactiveDatasetProvider>
            </E3Provider>
        );
        const { rerender } = render(tree(first.fetch, "one"));
        const { hash } = await datasetGet(h.e3.apiUrl, h.e3.repo, h.workspace, COUNTS, h.e3.direct);

        await cache!.preload(h.workspace, COUNTS);
        await expect(installed<FunctionApi>(defaultFuncRuntime).list(h.workspace)).resolves.toEqual([]);
        await expect(installed<PagedApi>(defaultPagedRuntime).getRevision(h.workspace, COUNTS)).resolves.toBe(hash);
        await installed<RecordApi>(defaultRecordRuntime).describe(h.workspace, ex.workOrders.name);
        // Every request the adapters made went through the fetch given, with its token: the workspace's routes, and
        // the repository's objects a whole read fetches.
        expect(first.requests.length).toBeGreaterThanOrEqual(4);
        expect(first.requests.map((request) => request.path)).toEqual(h.e3.requests.map((request) => `/api${request.path}${request.query.size === 0 ? "" : `?${request.query}`}`));
        for (const request of first.requests) {
            expect(request.path.startsWith(`/api/repos/${h.e3.repo}/`)).toBe(true);
            expect(request.auth).toBe("Bearer one");
        }

        // The same server identity with another fetch and token: the adapters
        // stay as they are, and their next request goes through the new ones.
        const second = givenServer();
        const carried = first.requests.length;
        rerender(tree(second.fetch, "two"));
        await expect(installed<PagedApi>(defaultPagedRuntime).getRevision(h.workspace, COUNTS)).resolves.toBe(hash);
        expect(second.requests).toEqual([{ path: `${workspaceRoutes()}datasets/inputs/preview_counts?status=true`, auth: "Bearer two" }]);
        expect(first.requests).toHaveLength(carried);
    });

    test("carries UITaskPreview's requests, from its config or from the provider", async () => {
        const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const fromConfig = givenServer();
        render(
            <ChakraProvider value={system}>
                <QueryClientProvider client={client()}>
                    <UITaskPreview task={VIEW} config={{ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, fetch: fromConfig.fetch }} />
                </QueryClientProvider>
            </ChakraProvider>,
        );
        // The task, its output's status and its value are served: the view draws.
        expect(await screen.findByText("the view")).not.toBe(null);
        cleanup();

        const fromProvider = givenServer();
        render(
            <ChakraProvider value={system}>
                <E3Provider config={{ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, fetch: fromProvider.fetch }} queryClient={client()}>
                    <UITaskPreview task={VIEW} />
                </E3Provider>
            </ChakraProvider>,
        );
        expect(await screen.findByText("the view")).not.toBe(null);

        for (const server of [fromConfig, fromProvider]) {
            const paths = server.requests.map((request) => request.path);
            expect(paths).toContain(`${workspaceRoutes()}tasks/${VIEW}`);
            expect(paths).toContain(`${workspaceRoutes()}datasets/tasks/${VIEW}/output?status=true`);
        }
    });

    test("TaskPreview hands its request options' fetch to the UI task's preview", async () => {
        const server = givenServer();
        render(
            <ChakraProvider value={system}>
                <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                    <TaskPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} task={VIEW} requestOptions={{ token: "tok", fetch: server.fetch }} />
                </QueryClientProvider>
            </ChakraProvider>,
        );
        // The UI preview's own reads — its output's status, then its value —
        // go through the fetch TaskPreview was given.
        expect(await screen.findByText("the view")).not.toBe(null);
        expect(server.requests.map((request) => request.path)).toContain(`${workspaceRoutes()}datasets/tasks/${VIEW}/output?status=true`);
        for (const request of server.requests) expect(request.auth).toBe("Bearer tok");
    });
});
