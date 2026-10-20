/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A UITaskPreview recovers by itself from a failure at each stage, for as long
 * as it is mounted: its task's details, and its output's status and value, are
 * read again after the waits a failed read takes, the failure showing until a
 * read lands. So a preview on a screen no one touches goes on once the server
 * answers again. Over the ui task e3 itself deploys (#1377), `preview_view`:
 * each failure a fault at the harness's fetch, each read counted from its
 * request log, the clock fake.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, defaultScheduler, notifyManager } from "@tanstack/react-query";
import { system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { E3Provider } from "../platform/e3-config.js";
import { UITaskPreview } from "./UITaskPreview.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    // Each wait is its least, half its backoff: 500 ms after the first
    // failure in a row, 1 s after the second.
    vi.spyOn(Math, "random").mockReturnValue(0);
    // TanStack tells a view of a query's change on a zero-delay timer, which
    // the fake clock would hold until it moves. Told at once, a preview shows
    // a read as it lands, and a wait is timed from the failure that started it.
    notifyManager.setScheduler(queueMicrotask);
});

afterEach(() => {
    notifyManager.setScheduler(defaultScheduler);
    vi.useRealTimers();
});

/** The ui task: a view reading "the view". */
const VIEW = ex.previewView.name;
/** Its output's dotted path. */
const OUTPUT = `tasks.${VIEW}.output`;

/** What the preview reads, in turn. */
type Stage = "task" | "status" | "value";
const STAGES: readonly Stage[] = ["task", "status", "value"];

/** Whether a request reads a stage. */
function reads(stage: Stage): (request: E3Request) => boolean {
    switch (stage) {
        case "task": return (request) => request.kind === "task" && request.name === VIEW;
        case "status": return (request) => request.kind === "dataset-status" && request.dataset === OUTPUT;
        case "value": return (request) => request.kind === "read" && request.dataset === OUTPUT;
    }
}

/** How many reads of a stage have been made, the one being made among them. */
const readsOf = (stage: Stage) => h.requests().filter(reads(stage)).length;

/**
 * e3's task, output status and output value, their `n`th read failing as e3
 * answers a failure while `fails(stage, n)` says so; a read `held(stage, n)`
 * names held on its way to e3 until the test lets it go.
 *
 * @returns The hold of the reads `held` names
 */
function serve(fails: (stage: Stage, n: number) => boolean, held: (stage: Stage, n: number) => boolean = () => false) {
    const hold = h.e3.hold((request) => STAGES.some((stage) => reads(stage)(request) && held(stage, readsOf(stage))));
    h.e3.fail((request) => STAGES.some((stage) => reads(stage)(request) && fails(stage, readsOf(stage))),
        { status: 500, type: "internal", message: "the server fell over" });
    return hold;
}

/** The preview, under a client that tries no failed query again itself. */
function renderPreview() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, fetch: h.e3.fetch }} queryClient={client}>
                <UITaskPreview task={VIEW} />
            </E3Provider>
        </ChakraProvider>,
    );
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

/** Expects `text` to show once the reads in flight land, the clock standing
 *  still. */
async function shows(text: string): Promise<void> {
    for (let i = 0; i < 10 && screen.queryByText(text) === null; i++) await settle();
    expect(screen.getByText(text)).toBeTruthy();
}

/** Expects no read of `stage` before `wait` ms have passed, and one at it. */
async function readAfter(stage: Stage, wait: number): Promise<void> {
    const before = readsOf(stage);
    await advance(wait - 1);
    expect(readsOf(stage), `nothing is read before ${wait} ms have passed`).toBe(before);
    await advance(1);
    expect(readsOf(stage), `a read at ${wait} ms`).toBe(before + 1);
}

describe("a UITaskPreview recovers by itself", () => {
    test("from \"Error\", once its task's details read", async () => {
        serve((stage, n) => stage === "task" && n === 1);
        renderPreview();
        await shows("Error");

        await readAfter("task", 500);
        await shows("the view");
        expect(screen.queryByText("Error")).toBe(null);
    });

    test("from \"Error\" on its output's status, once it reads", async () => {
        serve((stage, n) => stage === "status" && n === 1);
        renderPreview();
        await shows("Error");

        await readAfter("status", 500);
        await shows("the view");
    });

    test("from \"Load failed\", once its output's value reads, backing off while it fails", async () => {
        serve((stage, n) => stage === "value" && n <= 2);
        renderPreview();
        await shows("Load failed");

        await readAfter("value", 500);
        await shows("Load failed");
        await readAfter("value", 1_000);
        await shows("the view");
        expect(readsOf("value")).toBe(3);
    });

    test("showing the failure while a read is in flight, never going back to loading", async () => {
        const second = serve((stage, n) => stage === "task" && n <= 2, (stage, n) => stage === "task" && n === 2);
        renderPreview();
        await shows("Error");

        await readAfter("task", 500);
        expect(screen.getByText("Error")).toBeTruthy();
        expect(screen.queryByText("Loading task...")).toBe(null);

        await act(async () => { second.releaseOne(); });
        await settle();
        expect(screen.getByText("Error")).toBeTruthy();
        await readAfter("task", 1_000);
        await shows("the view");
    });

    test("and tries no more once it unmounts", async () => {
        serve((stage) => stage === "task");
        const { unmount } = renderPreview();
        await shows("Error");

        unmount();
        await advance(60_000);
        expect(readsOf("task")).toBe(1);
    });
});
