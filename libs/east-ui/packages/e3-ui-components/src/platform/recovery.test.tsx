/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A view whose read failed tries it again by itself, after waits that back off
 * from 1 s to 30 s, each a random point in the second half of its own, so views
 * that failed together do not try again together; and it shows the failure
 * until a try reads, never going back to loading.
 */

import { StrictMode } from "react";
import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, defaultScheduler, notifyManager, useQuery } from "@tanstack/react-query";
import { E3Provider } from "./e3-config.js";
import { recoveryDelay, useQueryRecovery } from "./recovery.js";

/** The real `setTimeout`, taken before the fake clock replaces it. */
const realSetTimeout = globalThis.setTimeout;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    // TanStack tells a view of a query's change on a zero-delay timer, which
    // the fake clock would hold until it moves. Told at once, a view shows a
    // try as it lands, and a wait is timed from the failure that started it.
    notifyManager.setScheduler(queueMicrotask);
});

afterEach(() => {
    cleanup();
    notifyManager.setScheduler(defaultScheduler);
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** Lets what is in flight settle as real time passes, the fake clock standing
 *  still. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
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

/** Draws `draw` for every wait. React's `act` draws once too, for its own. */
function drawing(draw: number): void {
    vi.spyOn(Math, "random").mockReturnValue(draw);
}

describe("recoveryDelay", () => {
    test("backs off from 1 s to 30 s, each wait a random point in the second half of its own", () => {
        const least = Array.from({ length: 8 }, (_, i) => recoveryDelay(i + 1, () => 0));
        const most = Array.from({ length: 8 }, (_, i) => recoveryDelay(i + 1, () => 1 - Number.EPSILON));
        expect(least).toEqual([500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
        expect(most).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
        expect(recoveryDelay(3, () => 0.25)).toBe(2_500);
    });

    test("draws each wait anew, so views that failed together try again apart", () => {
        const draws = [0.1, 0.9];
        vi.spyOn(Math, "random").mockImplementation(() => draws.shift()!);
        expect([recoveryDelay(1), recoveryDelay(1)]).toEqual([550, 950]);
        expect(draws).toEqual([]);
    });
});

/** A query's tries, counted as they start; each fails while `fails(n)` says
 *  so, and a try `held(n)` names waits for the test to let it go on. */
function source(fails: (n: number) => boolean, held: (n: number) => Promise<void> | undefined = () => undefined) {
    const counted = { tries: 0 };
    const fetch = async (): Promise<string> => {
        counted.tries++;
        const n = counted.tries;
        await held(n);
        if (fails(n)) throw new Error(`try ${n} failed`);
        return `read on try ${n}`;
    };
    return { counted, fetch };
}

/** A try held until the test opens it. */
function gate(): { opened: Promise<void>; open: () => void } {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { opened, open };
}

/** Reads `fetch` as a query that recovers, and says how it stands. */
function Recovering({ fetch }: { fetch: () => Promise<string> }) {
    const query = useQuery({ queryKey: ["recovering"], queryFn: fetch });
    const failure = useQueryRecovery(query);
    return <div>{failure !== null ? `failed: ${failure.message}` : query.data ?? "loading"}</div>;
}

/** The view, under a client that tries no failed query again itself. */
function renderRecovering(fetch: () => Promise<string>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (shown: boolean) => (
        <QueryClientProvider client={client}>{shown ? <Recovering fetch={fetch} /> : null}</QueryClientProvider>
    );
    const rendered = render(view(true));
    return { client, hide: () => rendered.rerender(view(false)) };
}

/** Expects nothing tried before `wait` ms have passed, and a try at it. */
async function triedAfter(counted: { tries: number }, wait: number): Promise<void> {
    const tries = counted.tries;
    await advance(wait - 1);
    expect(counted.tries, `nothing is tried before ${wait} ms have passed`).toBe(tries);
    await advance(1);
    expect(counted.tries, `a try at ${wait} ms`).toBe(tries + 1);
}

describe("a query that recovers", () => {
    test("is tried again after each wait, backing off, until it reads", async () => {
        drawing(0.5);
        const { counted, fetch } = source((n) => n <= 3);
        renderRecovering(fetch);
        await advance(0);
        expect(screen.getByText("failed: try 1 failed")).toBeTruthy();

        // Three quarters of 1, 2 and 4 s.
        await triedAfter(counted, 750);
        expect(screen.getByText("failed: try 2 failed")).toBeTruthy();
        await triedAfter(counted, 1_500);
        await triedAfter(counted, 3_000);
        expect(screen.getByText("read on try 4")).toBeTruthy();
        await advance(60_000);
        expect(counted.tries, "a query that reads is tried no more").toBe(4);
    });

    test("shows its failure while a try is in flight, never going back to loading, and starts no other", async () => {
        drawing(0);
        const second = gate();
        const { counted, fetch } = source((n) => n <= 2, (n) => (n === 2 ? second.opened : undefined));
        renderRecovering(fetch);
        await advance(0);
        await triedAfter(counted, 500);
        expect(screen.getByText("failed: try 1 failed")).toBeTruthy();
        await advance(60_000);
        expect(counted.tries, "the held try is the only one").toBe(2);
        expect(screen.getByText("failed: try 1 failed")).toBeTruthy();

        second.open();
        await settle();
        expect(screen.getByText("failed: try 2 failed")).toBeTruthy();
        await triedAfter(counted, 1_000);
        expect(screen.getByText("read on try 3")).toBeTruthy();
    });

    test("starts no try while one is in flight, for a query that holds data and keeps its failure meanwhile", async () => {
        drawing(0);
        const third = gate();
        const { counted, fetch } = source((n) => n === 2, (n) => (n === 3 ? third.opened : undefined));
        const { client } = renderRecovering(fetch);
        await advance(0);
        expect(screen.getByText("read on try 1")).toBeTruthy();

        await act(async () => {
            await client.refetchQueries({ queryKey: ["recovering"] });
        });
        await settle();
        expect(screen.getByText("failed: try 2 failed")).toBeTruthy();
        await triedAfter(counted, 500);
        await advance(60_000);
        expect(counted.tries, "the held try is the only one").toBe(3);

        third.open();
        await settle();
        expect(screen.getByText("read on try 3")).toBeTruthy();
    });

    test("counts a failure once, though StrictMode runs its effect twice for a view mounted over it", async () => {
        drawing(0);
        // A client that does not try a failed query again when a view mounts
        // over it, so the view's first effect sees the failure.
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
        const { counted, fetch } = source((n) => n === 1);
        await act(async () => {
            await client.prefetchQuery({ queryKey: ["recovering"], queryFn: fetch });
        });
        render(<StrictMode><QueryClientProvider client={client}><Recovering fetch={fetch} /></QueryClientProvider></StrictMode>);
        await settle();
        expect(screen.getByText("failed: try 1 failed")).toBeTruthy();
        // Half of 1 s: the failure counted once, not twice.
        await triedAfter(counted, 500);
        expect(screen.getByText("read on try 2")).toBeTruthy();
    });

    test("backs off from the start again once it has read", async () => {
        drawing(0);
        const { counted, fetch } = source((n) => n === 1 || n === 3);
        const { client } = renderRecovering(fetch);
        await advance(0);
        await triedAfter(counted, 500);
        expect(screen.getByText("read on try 2")).toBeTruthy();

        await act(async () => {
            await client.refetchQueries({ queryKey: ["recovering"] });
        });
        await settle();
        expect(screen.getByText("failed: try 3 failed")).toBeTruthy();
        await triedAfter(counted, 500);
        expect(screen.getByText("read on try 4")).toBeTruthy();
    });

    test("is tried no more once the view unmounts", async () => {
        drawing(0);
        const { counted, fetch } = source(() => true);
        const { hide } = renderRecovering(fetch);
        await advance(0);
        hide();
        await advance(60_000);
        expect(counted.tries).toBe(1);
    });
});

describe("an E3Provider's own client", () => {
    /** Reads `fetch` as a query of the provider's client, and says how it stands. */
    function Plain({ fetch }: { fetch: () => Promise<string> }) {
        const query = useQuery({ queryKey: ["plain"], queryFn: fetch });
        return <div>{query.error !== null ? `failed: ${query.error.message}` : query.data ?? "loading"}</div>;
    }

    test("tries a failed query twice more, after waits drawn as a view's own tries are", async () => {
        drawing(0.5);
        const { counted, fetch } = source(() => true);
        render(<E3Provider config={{ apiUrl: "http://e3.test" }}><Plain fetch={fetch} /></E3Provider>);
        await advance(0);
        expect(counted.tries).toBe(1);
        // Three quarters of 1 and 2 s.
        await triedAfter(counted, 750);
        await triedAfter(counted, 1_500);
        expect(screen.getByText("failed: try 3 failed")).toBeTruthy();
        await advance(60_000);
        expect(counted.tries, "the client tries no more itself").toBe(3);
    });
});
