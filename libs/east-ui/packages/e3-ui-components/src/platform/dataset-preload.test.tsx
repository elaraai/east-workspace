/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A preload that fails recovers by itself. It is tried again 1 s after the
 * failure and then at doubling waits up to 30 s, for as long as the view is
 * mounted, and its failure ends as soon as the cache holds the dataset,
 * whoever brought it in. So a preview showing "Preload failed" after a
 * transient error renders without a remount.
 */

import { useMemo } from "react";
import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { IntegerType, encodeBeast2For, none, some, toEastTypeValue, variant } from "@elaraai/east";
import {
    BEAST2_CONTENT_TYPE, DatasetStatusDetailType, ResponseType, TaskDetailsType, WorkspaceStatusResultType, type TreePath,
} from "@elaraai/e3-types";
import { system } from "@elaraai/east-ui-components";
import { E3Provider } from "./e3-config.js";
import { ReactiveDatasetProvider, usePreloadReactiveDatasets } from "./dataset-hooks.js";
import { getReactiveDatasetCache } from "./bind-runtime.js";
import { UITaskPreview } from "../components/UITaskPreview.js";

/** The real `setTimeout`, taken before the fake clock replaces it. */
const realSetTimeout = globalThis.setTimeout;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    // A status poll that fails here says so on the console.
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const API = "http://e3.test";
const X: TreePath = [variant("field", "inputs"), variant("field", "x")];
const HASH = "4".repeat(64);
const VALUE = encodeBeast2For(IntegerType)(42n);
const FAILURE = () => new Response(JSON.stringify({ error: { type: "internal", message: "the server fell over" } }), { status: 500 });

/** The workspace's status, naming `.inputs.x`'s value. */
const WORKSPACE_STATUS = encodeBeast2For(ResponseType(WorkspaceStatusResultType))(variant("success", {
    workspace: "w",
    lock: none,
    datasets: [{ path: ".inputs.x", status: variant("up-to-date", null), hash: some(HASH), isTaskOutput: false, producedBy: none }],
    tasks: [],
    summary: {
        datasets: { total: 1n, unset: 0n, stale: 0n, upToDate: 1n },
        tasks: { total: 0n, upToDate: 0n, ready: 0n, waiting: 0n, inProgress: 0n, failed: 0n, error: 0n, staleRunning: 0n },
    },
}));

/** Answers the workspace's status route, whatever datasets it names. */
const statusRoute = (url: string): Response | undefined =>
    new URL(url).pathname.endsWith("/workspaces/w/status") ? new Response(WORKSPACE_STATUS.slice(), { status: 200 }) : undefined;

type Outcome = "fail" | "read";

/**
 * A server whose dataset `.inputs.x` answers its `n`th read as `outcome(n)`
 * says, once that settles, and whose other routes answer as `routes` says, or
 * fail.
 *
 * @returns The reads of `.inputs.x`, counted as they are made
 */
function serve(
    outcome: (n: number) => Outcome | Promise<Outcome>,
    routes: (url: string, init?: RequestInit) => Response | undefined = () => undefined,
): { reads: number } {
    const counted = { reads: 0 };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        const answer = routes(url, init);
        if (answer !== undefined) return answer;
        if (url.includes("/datasets/inputs/x?segments=true")) {
            counted.reads++;
            if (await outcome(counted.reads) === "fail") return FAILURE();
            return new Response(VALUE.slice(), { status: 200, headers: { "Content-Type": BEAST2_CONTENT_TYPE, "X-Content-SHA256": HASH } });
        }
        return FAILURE();
    }));
    return counted;
}

/** A read held until the test opens it. */
function gate(): { opened: Promise<void>; open: () => void } {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { opened, open };
}

/** Lets what is in flight settle as real time passes, the fake clock standing
 *  still: a response's body is read on real ticks, and a retry is timed from
 *  when its failure lands. */
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await act(async () => {
            await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
        });
    }
}

/** Moves the fake clock on by `ms` once what is in flight has settled, and
 *  lets what that starts settle. */
async function advance(ms: number): Promise<void> {
    await settle();
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
    await settle();
}

/** Preloads `.inputs.x`, and says how it stands. */
function Preloaded() {
    const datasets = useMemo(() => [{ workspace: "w", path: X }], []);
    const { loading, error } = usePreloadReactiveDatasets(datasets);
    return <div>{loading ? "loading" : error !== null ? `failed: ${error.message}` : "ready"}</div>;
}

/** A provider, and the view preloading in it while `shown`. */
const tree = (shown = true) => (
    <E3Provider config={{ apiUrl: API, workspace: "w" }}>
        <ReactiveDatasetProvider>{shown ? <Preloaded /> : null}</ReactiveDatasetProvider>
    </E3Provider>
);

function renderPreloaded() {
    return render(tree());
}

/** Watches `.inputs.x` with the cache's status poll, which reads a watched
 *  dataset the cache lacks. */
async function poll(): Promise<void> {
    await act(async () => {
        getReactiveDatasetCache().setRefetchInterval("w", X, 60_000);
    });
    await settle();
}

describe("a preload that fails", () => {
    test("is tried again 1 s after the failure, then at doubling waits up to 30 s, until it reads", async () => {
        const server = serve((n) => (n <= 7 ? "fail" : "read"));
        renderPreloaded();
        await advance(0);
        expect(server.reads).toBe(1);
        expect(screen.getByText(/^failed: /)).toBeTruthy();

        for (const wait of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
            const reads = server.reads;
            await advance(wait - 1);
            expect(server.reads, `nothing is read before ${wait} ms have passed`).toBe(reads);
            await advance(1);
            expect(server.reads).toBe(reads + 1);
        }
        expect(screen.getByText("ready")).toBeTruthy();
        expect(server.reads).toBe(8);
    });

    test("shows the failure while a try is in flight, never going back to loading", async () => {
        const second = gate();
        serve((n) => (n === 2 ? second.opened.then(() => "read" as const) : "fail"));
        renderPreloaded();
        await advance(0);
        await advance(1_000);
        expect(screen.getByText(/^failed: /)).toBeTruthy();
        expect(screen.queryByText("loading")).toBe(null);

        second.open();
        await settle();
        expect(screen.getByText("ready")).toBeTruthy();
    });

    test("ends as soon as the cache holds the dataset, whoever brought it in: a status poll, before the next try", async () => {
        const server = serve((n) => (n === 1 ? "fail" : "read"), statusRoute);
        renderPreloaded();
        await advance(0);
        expect(screen.getByText(/^failed: /)).toBeTruthy();

        await poll();
        expect(screen.getByText("ready")).toBeTruthy();
        expect(server.reads, "the poll's read, and no try of the preload's own").toBe(2);
    });

    test("ends with the try that fails, when the dataset came in while that try was in flight", async () => {
        const first = gate();
        const server = serve((n) => (n === 1 ? first.opened.then(() => "fail" as const) : "read"), statusRoute);
        renderPreloaded();
        await settle();
        await poll();
        expect(server.reads, "the preload's read, held, and the poll's").toBe(2);

        first.open();
        await settle();
        expect(screen.getByText("ready")).toBeTruthy();
        expect(server.reads, "no try waits for its time").toBe(2);
    });

    test("is tried no more once the view unmounts, its provider staying", async () => {
        const server = serve(() => "fail");
        const { rerender } = renderPreloaded();
        await advance(0);
        rerender(tree(false));
        await advance(60_000);
        expect(server.reads).toBe(1);
    });
});

describe("a UITaskPreview whose preload fails", () => {
    /** A dataset holding an Integer value, as the status route answers it. */
    const STATUS = encodeBeast2For(ResponseType(DatasetStatusDetailType))(variant("success", {
        path: ".out",
        type: toEastTypeValue(IntegerType),
        refType: "value",
        hash: some("1".repeat(64)),
        size: some(9n),
        segments: none,
        rows: none,
    }));

    /** A ui task binding `.inputs.x`, whose output is `.out`. */
    const TASK = encodeBeast2For(ResponseType(TaskDetailsType))(variant("success", {
        name: "view",
        hash: "2".repeat(64),
        body: variant("east", { program: "3".repeat(64) }),
        runner: variant("east_node", { platforms: [], decode: variant("lazy", null) }),
        inputs: [],
        output: { path: [variant("field", "out")], kind: variant("value", null) },
        role: variant("ui", { paths: [X], functions: [], records: [], pages: [] }),
    }));

    test("goes on from \"Preload failed\" once the preload reads, without a remount", async () => {
        // The output's value fails, so a preview that went on shows that.
        serve((n) => (n === 1 ? "fail" : "read"), (url) => {
            if (url.includes("/tasks/view")) return new Response(TASK.slice(), { status: 200 });
            if (url.includes("/datasets/out?status=true")) return new Response(STATUS.slice(), { status: 200 });
            return undefined;
        });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <ChakraProvider value={system}>
                <E3Provider config={{ apiUrl: API, workspace: "w" }} queryClient={client}>
                    <ReactiveDatasetProvider><UITaskPreview task="view" pollInterval={60_000} /></ReactiveDatasetProvider>
                </E3Provider>
            </ChakraProvider>,
        );
        for (let i = 0; i < 10 && screen.queryByText("Preload failed") === null; i++) await advance(10);
        expect(screen.getByText("Preload failed")).toBeTruthy();

        await advance(1_000);
        for (let i = 0; i < 10 && screen.queryByText("Load failed") === null; i++) await advance(10);
        expect(screen.queryByText("Preload failed")).toBe(null);
        expect(screen.getByText("Load failed")).toBeTruthy();
    });
});
