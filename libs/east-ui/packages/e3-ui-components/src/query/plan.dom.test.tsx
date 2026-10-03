/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A run's plan in the builder (#941, `Query Editor Spec.md` §4.11), through
 * `<Query.Builder>`'s carrier over a saved queries record in memory, each
 * call answered here as e3 answers it — a one-shot call's body, or a split
 * call's pieces, run over the fixture's datasets — and each data source's
 * status read in memory, the orders weighed as large or as they are:
 *
 * - a visual run over a dataset larger than one piece is a split call, its
 *   result the one-shot call's; the source counted from its stored rows and
 *   the result by the call, nothing between;
 * - a jq run likewise, the jq as typed;
 * - a join both of whose sides weigh more than one piece, re-keyed (#942):
 *   two split calls, the second over the first's output by its hash;
 * - the plan's read-out in the footer, and its explanation in a popover;
 * - a split run's progress while it goes, then its pieces;
 * - a small dataset one call, as the showcase's always are; the plan's
 *   options' own piece; a status that cannot be read; no split call to make;
 * - a new run abandoning a split call by its signal; a split call refused,
 *   and one that never reached the server; the run a saved query starts as
 *   the builder mounts, under React's mount → unmount → mount (`StrictMode`,
 *   as the showcase's dev server mounts it), started again and answering;
 * - under an `E3Provider` that gives its own `fetch` — e3 running in the page —
 *   a run's status, its split call's launch and polls, and a one-shot call all
 *   go through that `fetch`, with the provider's token, and none reaches the
 *   global one.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import {
    decodeBeast2, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, none, some, toEastTypeValue, variant,
    type EastType,
} from "@elaraai/east";
import {
    DatasetStatusDetailType, ExecuteResultType, OneShotRequestType, PackageJobResponseType, ResponseType, SplitCallRequestType, SplitCallStatusType,
    pathToString,
    type ExecuteResult,
} from "@elaraai/e3-types";
import { formatters } from "@elaraai/east-ui-components";
import type { SplitCallAnswer } from "@elaraai/e3-api-client";
import type { QuerySplitCall } from "./hooks.js";
import { createInMemoryQueryCall, createInMemorySourceStatus, createInMemorySplitCall } from "./in-memory-call.js";
import { byteWords, queryWords } from "./model/words.js";
import { prepareQuery, queryResultOf } from "./one-shot.js";
import {
    ORDERS, ROOT, fixtureCall, fixtureDatasets, fixtureSplit, fixtureStatus, mountBuilder, openQuery, recordHarness, savedQuery, savedRecord, settle,
    type FixtureWeights,
} from "./query.test-utils.js";

/** The shared fixture's default query (`Query Editor Spec.md` §4.7). */
const DEFAULT_PROGRAM = [
    ".customers as $customers",
    ".orders",
    "map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
    "map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
    "map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
    "sort_by(-.total)",
    ".[:10]",
].join("\n| ");
const TOP = savedQuery("Top shipped orders, 2026", DEFAULT_PROGRAM);

/** A jq query that groups, counts and adds whole numbers: its answer exact however its pieces are cut. */
const BY_CUSTOMER = ".orders | group_by(.customer_id) | map({customer: .[0].customer_id, n: length, lines: (map(.lines | length) | add)})";

/** A join of the orders with the customers, read only at the order's customer, whose answer the rows' order cannot change: re-keyed when both are large (#942). */
const BY_REGION = ".customers as $c | .orders | map($c[.customer_id].region) | unique";

/** 1 GiB: the orders weighed as far larger than one piece. */
const LARGE = 1 << 30;

const words = queryWords(formatters("en-US"));

beforeEach(() => {
    recordHarness(savedRecord([TOP]));
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

// ─── What the builder shows ──────────────────────────────────────────────────

/** The results region. */
const results = () => document.querySelector<HTMLElement>("[data-query-results]")!;
/** The footer's parts: the count, the plan's read-out, the run's line and what it read. */
function footer() {
    const el = results().querySelector<HTMLElement>("[data-query-results-footer]")!;
    const text = (sel: string) => el.querySelector(sel)?.textContent ?? "";
    return { count: text("[data-query-result-count]"), plan: text("[data-query-result-plan]"), run: text("[data-query-result-run]"), reads: text("[data-query-result-reads]") };
}
/** The result's strips' words. */
const banners = () => [...document.querySelectorAll<HTMLElement>("[data-query-strips] [role=alert], [data-query-strips] [role=status]")].map((b) => b.textContent ?? "");
/** The shape lines' words, in order. */
const shapes = () => [...document.querySelectorAll<HTMLElement>("[data-query-shape-text]")].map((el) => el.textContent);
/** The jq field. */
const jqField = () => screen.getByRole("textbox", { name: "jq query" }) as HTMLTextAreaElement;
/** Shows the jq view, types the jq, and runs it. */
async function runJq(text: string) {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "jq" })); });
    await settle();
    await act(async () => { fireEvent.change(jqField(), { target: { value: text } }); });
    await act(async () => { fireEvent.click(document.querySelector<HTMLElement>("[data-query-run]")!); });
    await settle();
}
/** Runs the query with ⌘⏎, which runs anywhere in the builder — while a run goes too. */
async function runKeys() {
    await act(async () => { fireEvent.keyDown(document.querySelector<HTMLElement>("[data-query-builder]")!, { key: "Enter", ctrlKey: true }); });
    await settle();
}
/** Opens the plan's explanation, and gives its lines: each one's kind, sentence and jq. */
async function explanation(): Promise<(string | undefined)[][]> {
    await act(async () => { fireEvent.click(document.querySelector<HTMLElement>("[data-query-result-plan]")!); });
    await settle();
    const popover = screen.getByRole("dialog");
    return [...popover.querySelectorAll<HTMLElement>("[data-query-plan-line]")].map((line) => [
        line.getAttribute("data-kind") ?? "", line.firstElementChild!.textContent ?? "", line.querySelector("code")?.textContent,
    ]);
}

/** An answer's value, decoded with its type. */
function decoded(answer: ExecuteResult): { type: EastType; value: unknown } {
    if (answer.outcome.type !== "success") throw new Error(`the call answered ${answer.outcome.type}`);
    const value = decodeBeast2(answer.outcome.value.value);
    return { type: fromEastTypeValue(value.type), value: value.value };
}

/** The query's one-shot call's answer, run in memory over the fixture: what a split run's result must equal. */
async function oneShot(program: string): Promise<{ type: EastType; value: unknown }> {
    const prepared = prepareQuery(program, ROOT);
    if ("result" in prepared) throw new Error(`${program} does not check`);
    const answer = await createInMemoryQueryCall(fixtureDatasets())(prepared.prepared.request);
    const result = queryResultOf(prepared.prepared, answer);
    if (result.outcome.type !== "ok") throw new Error(`the one-shot call answered ${result.outcome.type}`);
    return decoded(answer);
}

// ─── A split run ─────────────────────────────────────────────────────────────

describe("<Query.Builder> — a run over a dataset larger than one piece is a split call (#941)", () => {
    test("in the visual view: the one-shot call's result; the source counted from its stored rows and the result by the call, nothing between", async () => {
        const one = fixtureCall();
        const split = fixtureSplit({ pieces: 4 });
        await mountBuilder(one.call, { split: split.split, status: fixtureStatus({ orders: LARGE }) });
        await openQuery(variant("saved", TOP.name));
        expect([split.requests.length, one.requests.length]).toEqual([1, 0]);
        // The orders are cut into pieces, and the customers reach each whole.
        expect(split.requests[0]!.args.map((a) => a.partition.type)).toEqual(["none", "some"]);
        // Its answer is the rows and their count: the rows the one-shot call gives.
        const answer = decoded(split.answers[0]!);
        if (answer.type.type !== "Struct") throw new Error("a visual split run answers {counts, result}");
        const expected = await oneShot(DEFAULT_PROGRAM);
        const value = answer.value as { counts: bigint[]; result: unknown };
        expect(equalFor(expected.type)(value.result as never, expected.value as never)).toBe(true);
        expect(value.counts).toEqual([10n]);
        expect(shapes()).toEqual([
            "40 orders",
            "Many shipped orders",
            "Many shipped orders+ name, region",
            "Many ordersorder, customer, region, total, shipped",
            "Many orders",
            "10 orders",
        ]);
        expect(footer()).toEqual({ count: "10 orders", plan: "Split call · 4 pieces", run: expect.stringMatching(/^run #1 · /), reads: "reads customers #9b07e3a4 · orders #4f2a1c8d" });
        expect(results().querySelector("table")).not.toBeNull();
    }, 30_000);

    test("in the jq view: the jq as typed, its result the one-shot call's", async () => {
        const one = fixtureCall();
        const split = fixtureSplit({ pieces: 7 });
        await mountBuilder(one.call, { split: split.split, status: fixtureStatus({ orders: LARGE }) });
        await runJq(BY_CUSTOMER);
        expect([split.requests.length, one.requests.length]).toEqual([1, 0]);
        expect(split.requests[0]!.output.type).toBe("dict");
        const expected = await oneShot(BY_CUSTOMER);
        const answer = decoded(split.answers[0]!);
        expect(equalFor(expected.type)(answer.value as never, expected.value as never)).toBe(true);
        expect([footer().count, footer().plan]).toEqual(["8 rows", "Split call · 7 pieces"]);
    }, 30_000);

    test("a join both of whose sides weigh more than one piece is re-keyed (#942): two split calls, the second over the first's output by its hash; the one-shot call's result", async () => {
        const one = fixtureCall();
        const split = fixtureSplit({ pieces: 4 });
        await mountBuilder(one.call, { split: split.split, status: fixtureStatus({ orders: LARGE, customers: LARGE }) });
        await runJq(BY_REGION);
        expect([split.requests.length, one.requests.length]).toEqual([2, 0]);
        // The join call reads the re-key call's output by its hash.
        expect(split.outputs[0]).not.toBeNull();
        expect(split.requests[1]!.args.map((a) => a.arg)).toContainEqual(variant("object", split.outputs[0]!));
        const expected = await oneShot(BY_REGION);
        const answer = decoded(split.answers[1]!);
        expect(equalFor(expected.type)(answer.value as never, expected.value as never)).toBe(true);
        // The pieces are the join call's; what the run read, the orders the re-key call read, then the customers.
        expect(footer()).toEqual({ count: "5 rows", plan: "Re-keyed join · 4 pieces", run: expect.stringMatching(/^run #1 · /), reads: "reads orders #4f2a1c8d · customers #9b07e3a4" });
        expect(await explanation()).toEqual([
            ["path", "Split call over orders: it weighs 1 GB, more than one piece (16 MB).", undefined],
            ["rekey", "Re-key: both sides large and unaligned — customers weighs more than one piece too.", undefined],
            ["rekey", "First, orders is re-keyed by this, about 1 GB, and each piece then reads customers cut at the same keys:", ".customer_id"],
            ["piece", "Each piece of orders runs:", ".orders\n| map($c[.customer_id].region)"],
            ["combine", "Their distinct rows are kept:", "unique"],
            ["pieces", "Orders is cut into 4 pieces, about 256 MB each.", undefined],
        ]);
    }, 30_000);

    test("the plan's explanation: the path and why, what each piece runs, how the pieces combine, what runs once after, what each reads whole, and the pieces", async () => {
        await mountBuilder(fixtureCall().call, { split: fixtureSplit({ pieces: 4 }).split, status: fixtureStatus({ orders: LARGE }) });
        await openQuery(variant("saved", TOP.name));
        const lines = await explanation();
        expect(screen.getByRole("dialog").textContent).toContain("How this run reads its data");
        expect(lines).toEqual([
            ["path", "Split call over orders: it weighs 1 GB, more than one piece (16 MB).", undefined],
            ["piece", "Each piece of orders runs:", [
                ".orders",
                "map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
                "map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
                "map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
            ].join("\n| ")],
            // The sort's first 10 rows kept in each piece, then across them (#942): never every shipped order.
            ["combine", "The first 10 rows of the sort are kept, each piece's and then theirs together, by:", "-.total"],
            ["then", "Then, once, over what they combine to:", ".[:10]"],
            ["broadcast", "Every piece reads customers whole.", undefined],
            ["pieces", "Orders is cut into 4 pieces, about 256 MB each.", undefined],
        ]);
    }, 30_000);

    test("its progress while it goes — pieces done of all, in the running head and the read-out — then its pieces", async () => {
        const split = fixtureSplit({ pieces: 4, hold: true });
        await mountBuilder(fixtureCall().call, { split: split.split, status: fixtureStatus({ orders: LARGE }) });
        await openQuery(variant("saved", TOP.name));
        expect(results().querySelector("[data-query-results-progress]")!.textContent).toBe("2 of 4 pieces done");
        expect([footer().count, footer().plan]).toEqual(["Running…", "Split call · 2 of 4 pieces done"]);
        expect((await explanation()).at(-1)).toEqual(["pieces", "2 of 4 pieces done", undefined]);
        await split.release();
        expect([footer().count, footer().plan]).toEqual(["10 orders", "Split call · 4 pieces"]);
    }, 30_000);
});

// ─── One call ────────────────────────────────────────────────────────────────

describe("<Query.Builder> — one call, and when a split run can't be made (#941)", () => {
    test("a dataset within one piece is one call, as the showcase's always are — its read-out One call, and why", async () => {
        const one = fixtureCall();
        const split = fixtureSplit({ pieces: 4 });
        await mountBuilder(one.call, { split: split.split, status: fixtureStatus() });
        await openQuery(variant("saved", TOP.name));
        expect([split.requests.length, one.requests.length]).toEqual([0, 1]);
        // A one-shot visual run counts every shape line.
        expect(shapes()).toEqual(["40 orders", "16 shipped orders", "16 shipped orders+ name, region", "16 ordersorder, customer, region, total, shipped", "16 orders", "10 orders"]);
        expect(footer().plan).toBe("One call");
        const weighed = (await createInMemorySourceStatus(fixtureDatasets())(ORDERS)).bytes!;
        expect(await explanation()).toEqual([["path", `One call: orders weighs ${byteWords(weighed, words)}, within one piece (16 MB).`, undefined]]);
    }, 30_000);

    test("the plan's options' own piece: a small dataset splits over a small one", async () => {
        const one = fixtureCall();
        const split = fixtureSplit({ pieces: 3 });
        await mountBuilder(one.call, { split: split.split, status: fixtureStatus(), pieceBytes: 1024 });
        await openQuery(variant("saved", TOP.name));
        expect([split.requests.length, one.requests.length]).toEqual([1, 0]);
        expect([footer().count, footer().plan]).toEqual(["10 orders", "Split call · 3 pieces"]);
    }, 30_000);

    test("a status that can't be read leaves the dataset's weight unknown: one call, which says so", async () => {
        const one = fixtureCall();
        await mountBuilder(one.call, { split: fixtureSplit({ pieces: 4 }).split, status: async () => { throw new Error("no status"); } });
        await openQuery(variant("saved", TOP.name));
        expect([one.requests.length, footer().count, footer().plan]).toEqual([1, "10 orders", "One call"]);
        expect(await explanation()).toEqual([["path", "One call: what orders weighs isn't known.", undefined]]);
    }, 30_000);

    test("a query that runs as one unit is one call however much its dataset weighs, and says why", async () => {
        const one = fixtureCall();
        const split = fixtureSplit({ pieces: 4 });
        await mountBuilder(one.call, { split: split.split, status: fixtureStatus({ orders: LARGE }) });
        await runJq(".orders | length");
        expect([split.requests.length, one.requests.length, footer().plan]).toEqual([0, 1, "One call"]);
        expect(await explanation()).toEqual([
            ["path", "One call: it reads a count, a key or a value of orders, and works through none of its rows.", undefined],
            ["pruning", "Reads the count from the index of orders, and no segment:", ".orders\n| length"],
        ]);
    }, 30_000);
});

// ─── Abandoned, refused, unreachable ─────────────────────────────────────────

describe("<Query.Builder> — a split run abandoned, refused, or never reaching the server (#941)", () => {
    test("a new run abandons a split call by its signal: only the last run's answer shows", async () => {
        const split = fixtureSplit({ pieces: 4, hold: true });
        await mountBuilder(fixtureCall().call, { split: split.split, status: fixtureStatus({ orders: LARGE }) });
        await openQuery(variant("saved", TOP.name));
        await runKeys();
        expect(split.signals.map((s) => s.aborted)).toEqual([true, false]);
        await split.release();
        expect(footer().run).toMatch(/^run #2 · /);
        expect([footer().count, footer().plan]).toEqual(["10 orders", "Split call · 4 pieces"]);
    }, 30_000);

    test("the run a saved query starts as the builder mounts, under React's mount → unmount → mount: abandoned by the unmount, started again under its number, and answering", async () => {
        const split = fixtureSplit({ pieces: 4 });
        await mountBuilder(fixtureCall().call, { split: split.split, status: fixtureStatus({ orders: LARGE }), query: TOP.name, strict: true });
        expect(banners()).toEqual([]);
        expect(footer()).toEqual({ count: "10 orders", plan: "Split call · 4 pieces", run: expect.stringMatching(/^run #1 · /), reads: "reads customers #9b07e3a4 · orders #4f2a1c8d" });
        // The unmount abandoned the run while it weighed the orders, before it called: the one split call is the run's again.
        expect(split.signals.map((s) => s.aborted)).toEqual([false]);
    }, 30_000);

    test("a split call e3 could not run is Not run, with e3's words; one that never reached the server, Couldn't reach the server", async () => {
        const refusing: QuerySplitCall = async () => { throw new Error("Split call failed: the pieces could not be planned"); };
        await mountBuilder(fixtureCall().call, { split: refusing, status: fixtureStatus({ orders: LARGE }) });
        await openQuery(variant("saved", TOP.name));
        expect(banners()).toEqual(["Not runSplit call failed: the pieces could not be planned"]);
        // The read-out still says how the run was to read its data.
        expect([footer().count, footer().plan]).toEqual(["No result", "Split call"]);
        cleanup();
        const offline: QuerySplitCall = async () => { throw new TypeError("fetch failed"); };
        await mountBuilder(fixtureCall().call, { split: offline, status: fixtureStatus({ orders: LARGE }) });
        await openQuery(variant("saved", TOP.name));
        expect(banners()).toEqual(["Couldn't reach the serverfetch failed"]);
    }, 30_000);

    test("a split run with no split call to make never reached a server", async () => {
        const one = fixtureCall();
        await mountBuilder(one.call, { status: fixtureStatus({ orders: LARGE }) });
        await openQuery(variant("saved", TOP.name));
        expect([one.requests.length, banners()]).toEqual([0, ["Couldn't reach the server"]]);
    }, 30_000);
});

// ─── Through the provider's fetch ────────────────────────────────────────────

/** Each route's answer, as e3's API encodes it: beast2 of the route's response, a success. */
const answerExecute = encodeBeast2For(ResponseType(ExecuteResultType));
const answerJob = encodeBeast2For(ResponseType(PackageJobResponseType));
const answerSplitStatus = encodeBeast2For(ResponseType(SplitCallStatusType));
const answerStatus = encodeBeast2For(ResponseType(DatasetStatusDetailType));
const readOneShot = decodeBeast2For(OneShotRequestType);
const readSplit = decodeBeast2For(SplitCallRequestType);

/** A request as the server saw it: its method, its path and query, and the token it carried. */
interface Seen {
    readonly method: string;
    readonly path: string;
    readonly auth: string | null;
}

/**
 * An e3 as the `fetch` a host gives — e3 running in the page: it answers the
 * fixture's datasets' statuses, weighed as given, one-shot calls, and split
 * calls — each launched as a job, its poll answering it completed — over the
 * fixture in memory, cut into 3 pieces; it fails every other request, and
 * records each.
 */
function givenE3(weights: FixtureWeights): { seen: Seen[]; fetch: typeof globalThis.fetch } {
    const seen: Seen[] = [];
    const datasets = fixtureDatasets(weights);
    const status = createInMemorySourceStatus(datasets);
    const oneShot = createInMemoryQueryCall(datasets);
    const split = createInMemorySplitCall(datasets, { pieces: 3 });
    const jobs = new Map<string, Promise<SplitCallAnswer>>();
    const respond = (bytes: Uint8Array) => new Response(bytes.slice(), { status: 200 });
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const method = init?.method ?? "GET";
        seen.push({ method, path: `${url.pathname}${url.search}`, auth: new Headers(init?.headers).get("authorization") });
        const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array(0);
        if (method === "POST" && url.pathname.endsWith("/one-shot")) {
            return respond(answerExecute(variant("success", await oneShot(readOneShot(body)))));
        }
        if (method === "POST" && url.pathname.endsWith("/one-shot/split")) {
            const id = `job-${jobs.size + 1}`;
            jobs.set(id, split(readSplit(body), { signal: new AbortController().signal, onProgress: () => {} }));
            return respond(answerJob(variant("success", { id })));
        }
        const job = jobs.get(/\/one-shot\/split\/([^/]+)$/.exec(url.pathname)?.[1] ?? "");
        if (method === "GET" && job !== undefined) {
            const { result, output } = await job;
            return respond(answerSplitStatus(variant("success", variant("completed", { result, output: output === null ? none : some(output) }))));
        }
        const dataset = datasets.find((d) => url.pathname.endsWith(`/datasets/${d.path.map((segment) => segment.value).join("/")}`));
        if (url.searchParams.get("status") === "true" && dataset !== undefined) {
            const { rows, hash, bytes } = await status(dataset.path);
            return respond(answerStatus(variant("success", {
                path: pathToString(dataset.path), type: toEastTypeValue(dataset.type), refType: "value",
                hash: hash === undefined ? none : some(hash), size: bytes === undefined ? none : some(BigInt(bytes)),
                segments: none, rows: rows === undefined ? none : some(BigInt(rows)),
            })));
        }
        return new Response(JSON.stringify({ error: { type: "internal", message: "not served here" } }), { status: 500 });
    }) as typeof globalThis.fetch;
    return { seen, fetch };
}

describe("<Query.Builder> — under an E3Provider that gives its own fetch, every call goes through it (#941)", () => {
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
        vi.unstubAllGlobals();
    });

    test("a run's status, its split call's launch and polls, and a one-shot call — each with the provider's token", async () => {
        const e3 = givenE3({ orders: LARGE });
        await mountBuilder(undefined, { e3: { apiUrl: "http://e3.test", workspace: "w", token: "tok", fetch: e3.fetch } });
        // A split run: the orders weighed, then the call launched and polled. Its job answered at its first poll — a run
        // served from the cache — so no progress told how many pieces it cut.
        await openQuery(variant("saved", TOP.name));
        expect([footer().count, footer().plan]).toEqual(["10 orders", "Split call"]);
        // One call: a query that runs as one unit.
        await runJq(".orders | length");
        expect(footer().plan).toBe("One call");
        const asked = e3.seen.map((request) => `${request.method} ${request.path}`);
        expect(asked).toEqual(expect.arrayContaining([
            "GET /api/repos/default/workspaces/w/datasets/inputs/orders?status=true",
            "POST /api/repos/default/workspaces/w/one-shot/split",
            "GET /api/repos/default/workspaces/w/one-shot/split/job-1",
            "POST /api/repos/default/workspaces/w/one-shot",
        ]));
        expect(e3.seen.filter((request) => request.auth !== "Bearer tok")).toEqual([]);
        expect(escaped).toEqual([]);
    }, 30_000);
});
