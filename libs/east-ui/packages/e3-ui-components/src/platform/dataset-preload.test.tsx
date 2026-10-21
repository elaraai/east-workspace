/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A preload that fails recovers by itself. It is tried again after waits that
 * back off from 1 s to 30 s, each a random point in the second half of its
 * own, for as long as the view is mounted, and its failure ends as soon as the
 * cache holds the dataset, whoever brought it in. So a preview showing
 * "Preload failed" after a transient error renders without a remount. A
 * record its view reads a window at a time is no preload of it (#1199): it
 * is never fetched whole. On e3 itself (#1377): the counts' reads fail at the
 * harness's fetch while a test says so, its status poll is e3's, and the ui
 * tasks are those its module deploys; the clock is fake.
 */

import { useMemo } from "react";
import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { E3Provider } from "./e3-config.js";
import { ReactiveDatasetProvider, usePreloadReactiveDatasets } from "./dataset-hooks.js";
import { getReactiveDatasetCache } from "./bind-runtime.js";
import { UITaskPreview } from "../components/UITaskPreview.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    // A status poll that fails here says so on the console.
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
});

/** The counts, which the view preloads. */
const X = ex.previewCountsInput.path;
const COUNTS = "inputs.preview_counts";

/** Whether a request reads the counts whole. */
const readsCounts = (request: E3Request) => request.kind === "read" && request.dataset === COUNTS;
/** How many reads of the counts have been made, the one being made among them. */
const reads = () => h.requests("read", COUNTS).length;

/**
 * The counts' `n`th read failing as e3 answers a failure while `fails(n)` says
 * so; a read `held(n)` names held on its way to e3 until the test lets it go.
 *
 * @returns The hold of the reads `held` names
 */
function serve(fails: (n: number) => boolean, held: (n: number) => boolean = () => false) {
    const hold = h.e3.hold((request) => readsCounts(request) && held(reads()));
    h.e3.fail((request) => readsCounts(request) && fails(reads()), { status: 500, type: "internal", message: "the server fell over" });
    return hold;
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

/** Preloads the counts, and says how it stands. */
function Preloaded() {
    const datasets = useMemo(() => [{ workspace: h.workspace, path: X }], []);
    const { loading, error } = usePreloadReactiveDatasets(datasets);
    return <div>{loading ? "loading" : error !== null ? `failed: ${error.message}` : "ready"}</div>;
}

/** The test's e3, as a host's provider names it. */
const config = () => ({ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, fetch: h.e3.fetch });

/** A provider, and the view preloading in it while `shown`. */
const tree = (shown = true) => (
    <E3Provider config={config()}>
        <ReactiveDatasetProvider>{shown ? <Preloaded /> : null}</ReactiveDatasetProvider>
    </E3Provider>
);

function renderPreloaded() {
    return render(tree());
}

/** Watches the counts with the cache's status poll, which reads a watched
 *  dataset the cache lacks. */
async function poll(): Promise<void> {
    await act(async () => {
        getReactiveDatasetCache().setRefetchInterval(h.workspace, X, 60_000);
    });
    await settle();
}

describe("a preload that fails", () => {
    test("is tried again after waits that back off from 1 s to 30 s, each a random point in the second half of its own, until it reads", async () => {
        // Each wait halfway through the second half of its own (recovery.test
        // draws each anew).
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        serve((n) => n <= 7);
        renderPreloaded();
        await advance(0);
        expect(reads()).toBe(1);
        expect(screen.getByText(/^failed: /)).toBeTruthy();

        // Three quarters of 1, 2, 4, 8, 16, 30 and 30 s.
        for (const wait of [750, 1_500, 3_000, 6_000, 12_000, 22_500, 22_500]) {
            const before = reads();
            await advance(wait - 1);
            expect(reads(), `nothing is read before ${wait} ms have passed`).toBe(before);
            await advance(1);
            expect(reads()).toBe(before + 1);
        }
        expect(screen.getByText("ready")).toBeTruthy();
        expect(reads()).toBe(8);
    });

    test("shows the failure while a try is in flight, never going back to loading", async () => {
        const second = serve((n) => n === 1, (n) => n === 2);
        renderPreloaded();
        await advance(0);
        await advance(1_000);
        expect(screen.getByText(/^failed: /)).toBeTruthy();
        expect(screen.queryByText("loading")).toBe(null);

        await act(async () => { second.releaseOne(); });
        await settle();
        expect(screen.getByText("ready")).toBeTruthy();
    });

    test("ends as soon as the cache holds the dataset, whoever brought it in: a status poll, before the next try", async () => {
        serve((n) => n === 1);
        renderPreloaded();
        await advance(0);
        expect(screen.getByText(/^failed: /)).toBeTruthy();

        await poll();
        expect(screen.getByText("ready")).toBeTruthy();
        expect(reads(), "the poll's read, and no try of the preload's own").toBe(2);
    });

    test("ends with the try that fails, when the dataset came in while that try was in flight", async () => {
        const first = serve((n) => n === 1, (n) => n === 1);
        renderPreloaded();
        await settle();
        await poll();
        expect(reads(), "the preload's read, held, and the poll's").toBe(2);

        await act(async () => { first.releaseOne(); });
        await settle();
        expect(screen.getByText("ready")).toBeTruthy();
        expect(reads(), "no try waits for its time").toBe(2);
    });

    test("is tried no more once the view unmounts, its provider staying", async () => {
        serve(() => true);
        const { rerender } = renderPreloaded();
        await advance(0);
        rerender(tree(false));
        await advance(60_000);
        expect(reads()).toBe(1);
    });
});

describe("a UITaskPreview whose preload fails", () => {
    test("goes on from \"Preload failed\" once the preload reads, without a remount", async () => {
        // The ui task over the counts, which its preview preloads and its status poll follows: their first two reads
        // fail, the preload's and the poll's that follows it, so it is the preload's own try that reads them.
        serve((n) => n <= 2);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <ChakraProvider value={system}>
                <E3Provider config={config()} queryClient={client}>
                    <ReactiveDatasetProvider><UITaskPreview task={ex.previewCountsView.name} pollInterval={60_000} /></ReactiveDatasetProvider>
                </E3Provider>
            </ChakraProvider>,
        );
        for (let i = 0; i < 10 && screen.queryByText("Preload failed") === null; i++) await advance(10);
        expect(screen.getByText("Preload failed")).toBeTruthy();

        await advance(1_000);
        for (let i = 0; i < 10 && screen.queryByText("3 counts") === null; i++) await advance(10);
        expect(screen.queryByText("Preload failed")).toBe(null);
        expect(screen.getByText("3 counts")).toBeTruthy();
    });
});

describe("a UITaskPreview over a record it also reads a window at a time (#1199)", () => {
    test("preloads none of it and polls none of it: the record's content is never fetched whole", async () => {
        // The ui task over the work orders binds their record both ways: its manifest's `records` and `pages` name
        // it, and its `paths` do not.
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <ChakraProvider value={system}>
                <E3Provider config={config()} queryClient={client}>
                    <ReactiveDatasetProvider><UITaskPreview task={ex.previewOrdersView.name} pollInterval={60_000} /></ReactiveDatasetProvider>
                </E3Provider>
            </ChakraProvider>,
        );
        // Nothing to preload: it goes on to its view.
        for (let i = 0; i < 10 && screen.queryByText(/COMMITS$/) === null; i++) await advance(10);
        expect(screen.queryByText("Preload failed")).toBe(null);
        expect(screen.getByText(/COMMITS$/)).toBeTruthy();
        // A poll goes by, and still nothing of the record is read whole: its queue is read a window at a time.
        await advance(60_000);
        expect(h.requests("task").some((request) => request.name === ex.previewOrdersView.name)).toBe(true);
        expect(h.requests("read", `records.${ex.workOrders.name}`)).toEqual([]);
        expect(h.requests("page", `records.${ex.workOrders.name}`).length).toBeGreaterThan(0);
    });
});
