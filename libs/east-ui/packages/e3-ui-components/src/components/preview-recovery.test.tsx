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
 * answers again.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, defaultScheduler, notifyManager } from "@tanstack/react-query";
import { East, encodeBeast2For, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { Text, UIComponentType } from "@elaraai/east-ui/internal";
import { BEAST2_CONTENT_TYPE, DatasetStatusDetailType, ResponseType, TaskDetailsType } from "@elaraai/e3-types";
import { getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { E3Provider } from "../platform/e3-config.js";
import { UITaskPreview } from "./UITaskPreview.js";

/** The real `setTimeout`, taken before the fake clock replaces it. */
const realSetTimeout = globalThis.setTimeout;

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
    cleanup();
    notifyManager.setScheduler(defaultScheduler);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const API = "http://e3.test";
const HASH = "5".repeat(64);

/** The task's output: a view reading "the view". */
const VIEW = encodeBeast2For(UIComponentType)(East.compile(
    East.function([], UIComponentType, (_$) => Text.Root("the view")),
    getRegisteredPlatformImplementations(),
)() as ValueTypeOf<typeof UIComponentType>);

/** The output's status: the view, by its hash. */
const STATUS = encodeBeast2For(ResponseType(DatasetStatusDetailType))(variant("success", {
    path: ".out",
    type: toEastTypeValue(UIComponentType),
    refType: "value",
    hash: some(HASH),
    size: some(BigInt(VIEW.length)),
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

const FAILURE = () => new Response(JSON.stringify({ error: { type: "internal", message: "the server fell over" } }), { status: 500 });

/** What the preview reads, in turn. */
type Stage = "task" | "status" | "value";

/** A read held until the test opens it. */
function gate(): { opened: Promise<void>; open: () => void } {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { opened, open };
}

/**
 * A server whose task, output status and output value answer their `n`th read
 * failing while `fails(stage, n)` says so, and otherwise as they hold; a read
 * `held(stage, n)` names answers once the test opens it.
 *
 * @returns Each stage's reads, counted as they are made
 */
function serve(
    fails: (stage: Stage, n: number) => boolean,
    held: (stage: Stage, n: number) => Promise<void> | undefined = () => undefined,
): Record<Stage, number> {
    const reads: Record<Stage, number> = { task: 0, status: 0, value: 0 };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const stage: Stage | undefined = url.includes("/tasks/view") ? "task"
            : url.includes("/datasets/out?status=true") ? "status"
            : url.includes("/datasets/out?segments=true") ? "value"
            : undefined;
        if (stage === undefined) return FAILURE();
        reads[stage]++;
        const n = reads[stage];
        await held(stage, n);
        if (fails(stage, n)) return FAILURE();
        if (stage === "task") return new Response(TASK.slice(), { status: 200 });
        if (stage === "status") return new Response(STATUS.slice(), { status: 200 });
        return new Response(VIEW.slice(), { status: 200, headers: { "Content-Type": BEAST2_CONTENT_TYPE, "X-Content-SHA256": HASH } });
    }));
    return reads;
}

/** The preview, under a client that tries no failed query again itself. */
function renderPreview() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: API, workspace: "w" }} queryClient={client}>
                <UITaskPreview task="view" />
            </E3Provider>
        </ChakraProvider>,
    );
}

/** Lets what is in flight settle as real time passes, the fake clock standing
 *  still: a response's body is read on real ticks. */
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

/** Expects `text` to show once the reads in flight land, the clock standing
 *  still. */
async function shows(text: string): Promise<void> {
    for (let i = 0; i < 10 && screen.queryByText(text) === null; i++) await settle();
    expect(screen.getByText(text)).toBeTruthy();
}

/** Expects no read of `stage` before `wait` ms have passed, and one at it. */
async function readAfter(reads: Record<Stage, number>, stage: Stage, wait: number): Promise<void> {
    const before = reads[stage];
    await advance(wait - 1);
    expect(reads[stage], `nothing is read before ${wait} ms have passed`).toBe(before);
    await advance(1);
    expect(reads[stage], `a read at ${wait} ms`).toBe(before + 1);
}

describe("a UITaskPreview recovers by itself", () => {
    test("from \"Error\", once its task's details read", async () => {
        const reads = serve((stage, n) => stage === "task" && n === 1);
        renderPreview();
        await shows("Error");

        await readAfter(reads, "task", 500);
        await shows("the view");
        expect(screen.queryByText("Error")).toBe(null);
    });

    test("from \"Error\" on its output's status, once it reads", async () => {
        const reads = serve((stage, n) => stage === "status" && n === 1);
        renderPreview();
        await shows("Error");

        await readAfter(reads, "status", 500);
        await shows("the view");
    });

    test("from \"Load failed\", once its output's value reads, backing off while it fails", async () => {
        const reads = serve((stage, n) => stage === "value" && n <= 2);
        renderPreview();
        await shows("Load failed");

        await readAfter(reads, "value", 500);
        await shows("Load failed");
        await readAfter(reads, "value", 1_000);
        await shows("the view");
        expect(reads.value).toBe(3);
    });

    test("showing the failure while a read is in flight, never going back to loading", async () => {
        const second = gate();
        const reads = serve((stage, n) => stage === "task" && n <= 2, (stage, n) => (stage === "task" && n === 2 ? second.opened : undefined));
        renderPreview();
        await shows("Error");

        await readAfter(reads, "task", 500);
        expect(screen.getByText("Error")).toBeTruthy();
        expect(screen.queryByText("Loading task...")).toBe(null);

        second.open();
        await settle();
        expect(screen.getByText("Error")).toBeTruthy();
        await readAfter(reads, "task", 1_000);
        await shows("the view");
    });

    test("and tries no more once it unmounts", async () => {
        const reads = serve((stage) => stage === "task");
        const { unmount } = renderPreview();
        await shows("Error");

        unmount();
        await advance(60_000);
        expect(reads.task).toBe(1);
    });
});
