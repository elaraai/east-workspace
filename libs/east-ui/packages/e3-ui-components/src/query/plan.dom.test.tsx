/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A run's plan in the builder (#941, `Query Editor Spec.md` §4.11), through
 * `<Query.Builder>`'s carrier on e3 itself (#1376): over the order history the
 * query examples' tasks generate — 36,000 orders, the 20,000 accounts that
 * place them and their credit limits, each of more than e3's smallest piece
 * here — beside the fixture's customers, and over the fixture's orders, within
 * one piece. Each run is e3's: a one-shot call, or a split call e3 cuts into
 * pieces as the showcase's e3 does; each data source weighed by its status on
 * e3; and what a result must equal, e3's own one-shot answer to the test:
 *
 * - a visual run over a dataset larger than one piece is a split call, its
 *   result the one-shot call's; the source counted from its stored rows and
 *   the result by the call, nothing between;
 * - a jq run likewise, the jq as typed;
 * - a join both of whose sides weigh more than one piece, re-keyed (#942):
 *   two split calls, the second over the first's output by its hash;
 * - the plan's read-out in the footer, and its explanation in a popover;
 * - a split run's progress while it goes — e3's units held — then its pieces;
 * - a split run that answered before e3 said how many pieces it cut — its
 *   polls held until e3 says it ended — counted by e3's explain of the call
 *   once it has answered (#1132); a re-keyed join's join call's; one whose
 *   progress named them never explained; an explain refused leaving the count
 *   unknown; a new run abandoning the one before's; and a host's split calls
 *   never explained by the server's;
 * - a small dataset one call, as the fixture's always are; the plan's
 *   options' own piece; a status that cannot be read; a query that runs as one
 *   unit; and no split call to make;
 * - a new run abandoning a split call by its signal; a split call e3 could not
 *   run, and one that never reached the server; the run a saved query starts
 *   as the builder mounts, under React's mount → unmount → mount
 *   (`StrictMode`, as the showcase mounts it), started again and answering;
 * - under its `E3Provider`, whose `fetch` is e3's in the page, a run's status,
 *   its split call's launch and polls, its explain, and a one-shot call all go
 *   through that `fetch`, with the provider's token, and none reaches the
 *   global one.
 *
 * e3's execution cache is the file's: a test whose run must be caught going
 * runs a program no other test runs.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { checkJq, decodeBeast2, equalFor, fromEastTypeValue, none, variant, type EastType } from "@elaraai/east";
import { SplitCallRequestType, type ExecuteResult, type SplitCallRequest, type SplitCallStatus } from "@elaraai/e3-types";
import { datasetGetStatus, splitCallStatus } from "@elaraai/e3-api-client";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import { formatters } from "@elaraai/east-ui-components";
import { EXAMPLES_PIECE_MIN, type E3Dataset } from "../e3-web.test-utils.js";
import { QueryPlanOptionsProvider, QuerySplitCallProvider, sourceStatusOf, type QuerySplitCall } from "./hooks.js";
import { createInMemorySplitCall } from "./in-memory-call.js";
import { byteWords, queryWords } from "./model/words.js";
import { prepareQuery, type QueryRoot } from "./one-shot.js";
import { savedQuery } from "./fixture.test-utils.js";
import {
    HISTORY_ROOT, act, isExplain, isPoll, isSplitLaunch, openQuery, queryHarness, settle,
} from "./query.test-utils.js";
import { runFailure } from "./results.js";
import { planRun, useQueryRun } from "./run.js";
import { QUERY_HEADER_ID } from "./session.js";
import { parseSteps } from "./steps/parse.js";

/** The fixture's default query (`Query Editor Spec.md` §4.7), over the orders: within one piece. */
const DEFAULT_PROGRAM = [
    ".customers as $customers",
    ".orders",
    "map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
    "map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
    "map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
    "sort_by(-.total)",
    ".[:10]",
].join("\n| ");
const DEFAULT = savedQuery("Top shipped orders, 2026", DEFAULT_PROGRAM);

/** The history's top shipped orders, each with its customer's name — a lookup of the customers, read whole: rows exact however the pieces are cut. */
const TOP_PROGRAM = [
    ".customers as $customers",
    ".order_history",
    "map(select(.status.type == \"shipped\"))",
    "map(. + {name: $customers[.customer_id].name})",
    "sort_by(-.total)",
    ".[:10]",
].join("\n| ");
const TOP = savedQuery("Top shipped history orders", TOP_PROGRAM, none, HISTORY_ROOT);

/** A jq query that groups, counts and adds whole numbers: its answer exact however its pieces are cut. */
const BY_STATUS = ".order_history | group_by(.status.type) | map({status: .[0].status.type, n: length, lines: (map(.lines | length) | add)})";

/** A join of the history with the accounts, read only at the order's account, whose answer the rows' order cannot change: re-keyed, both large (#942). */
const BY_REGION = ".accounts as $a | .order_history | map($a[.customer_id].region) | unique";

/** A grouping of the history of its own, for each test that runs one: e3's cache serves a program another test ran. */
const grouped = (over: number) => `.order_history | map(select(.total >= ${over})) | group_by(.status.type) | map({status: .[0].status.type, n: length})`;

const words = queryWords(formatters("en-US"));
/** More than the least time e3 keeps between two writes of a split call's progress (half a second, e3-core's `transfer/process.ts`). */
const PROGRESS_WRITES_MS = 1000;
/** e3's smallest piece here, in words: what a dataset is weighed against. */
const PIECE = byteWords(EXAMPLES_PIECE_MIN, words);
const sameRequest = equalFor(SplitCallRequestType);

const h = queryHarness();

beforeEach(async () => {
    await h.seed([DEFAULT]);
    await h.seedHistory([TOP]);
});
afterEach(() => {
    // A test that moves the clock has it back however it ends.
    vi.useRealTimers();
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
/**
 * Waits for run `n` to answer: a split call is polled with pauses between its
 * polls, timers the harness's settle cannot see, so the test waits for what the
 * user sees then.
 */
async function ran(n: number) {
    await waitFor(() => expect(footer().run).toMatch(new RegExp(`^run #${n} · `)), { timeout: 30_000 });
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

/** A program's one-shot call over a root, as e3 answers the test itself: what a split run's result must equal. */
async function oneShot(program: string, root: QueryRoot): Promise<{ type: EastType; value: unknown }> {
    const prepared = prepareQuery(program, root);
    if ("result" in prepared) throw new Error(`${program} does not check`);
    return decoded(await h.oneShot(prepared.prepared.request));
}

/** What the poll that found a split call's job completed carried: its result and its assembled output's hash. */
function completedOf(polled: readonly { readonly job: string; readonly status: SplitCallStatus }[], job: string): { result: ExecuteResult; output: string | undefined } {
    const done = polled.find((poll) => poll.job === job && poll.status.type === "completed");
    if (done === undefined || done.status.type !== "completed") throw new Error(`no poll found the job ${job} completed`);
    const { result, output } = done.status.value;
    return { result, output: output.type === "some" ? output.value : undefined };
}

/** A dataset's status on e3, in what the read-outs show of it: its weight, its hash's first characters, its rows. */
async function weighed(dataset: E3Dataset): Promise<{ bytes: number; hash: string; rows: number }> {
    const status = await h.statusOf(dataset);
    if (status.size.type !== "some" || status.hash.type !== "some" || status.rows.type !== "some") throw new Error(`${status.path} has no weight, hash or rows`);
    return { bytes: Number(status.size.value), hash: status.hash.value.slice(0, 8), rows: Number(status.rows.value) };
}

/** How many pieces e3 cuts a call into, as its explain of it says. */
const piecesOf = async (request: SplitCallRequest): Promise<number> => Number((await h.explain(request)).pieces);

/** A read-out's last line: how many pieces a dataset is cut into, and about what each weighs. */
const piecesLine = (source: string, pieces: number, bytes: number) =>
    ["pieces", `${source} is cut into ${pieces} pieces, about ${byteWords(Math.round(bytes / pieces), words)} each.`, undefined];

/**
 * Holds every poll of a split call's job until e3 says the job ended, then
 * lets it go: the job answers its run before any poll said how many pieces it
 * cut, as a job e3's cache served whole does, or one that ended between two
 * polls. An explain's polls go on.
 *
 * @returns What waits on the `n`th split call launched from now, and lets its poll go once e3 says its job ended
 */
function answeredBeforeItSaid(): { end: (n: number) => Promise<void> } {
    const splits = h.splitJobs();
    const polls = h.e3.hold((request) => isPoll()(request) && splits().includes(request.name!));
    return {
        async end(n) {
            await waitFor(() => expect(splits().length).toBeGreaterThan(n), { timeout: 10_000 });
            await h.jobEnded(splits()[n]!);
            await waitFor(() => expect(polls.held).toBeGreaterThan(0), { timeout: 10_000 });
            await act(async () => { while (polls.held > 0) polls.releaseOne(); });
        },
    };
}

// ─── A split run ─────────────────────────────────────────────────────────────

describe("<Query.Builder> — a run over a dataset larger than one piece is a split call (#941)", () => {
    test("in the visual view: the one-shot call's result; the source counted from its stored rows and the result by the call, nothing between", async () => {
        const polled = h.splitResults();
        const jobs = h.jobs();
        await h.mountHistory();
        await openQuery(variant("saved", TOP.name));
        await ran(1);
        expect([h.splitCalls().length, h.oneShots().length]).toEqual([1, 0]);
        // The history is cut into pieces, and the customers reach each whole.
        const [call] = h.splitCalls();
        expect(call!.args.map((a) => a.partition.type)).toEqual(["none", "some"]);
        // Its answer is the rows and their count: the rows the one-shot call gives.
        const answer = decoded(completedOf(polled(), jobs()[0]!).result);
        if (answer.type.type !== "Struct") throw new Error("a visual split run answers {counts, result}");
        const expected = await oneShot(TOP_PROGRAM, HISTORY_ROOT);
        const value = answer.value as { counts: bigint[]; result: unknown };
        expect(equalFor(expected.type)(value.result as never, expected.value as never)).toBe(true);
        expect(value.counts).toEqual([10n]);
        const history = await weighed(ex.historyTask.output);
        expect(shapes()).toEqual([
            `${words.formatters.number(history.rows)} order histories`,
            "Many shipped order histories",
            "Many shipped order histories+ name",
            "Many shipped order histories",
            "10 shipped order histories",
        ]);
        const pieces = await piecesOf(call!);
        await waitFor(() => expect(footer().plan).toBe(`Split call · ${pieces} pieces`));
        expect(footer()).toEqual({
            count: "10 shipped order histories", plan: `Split call · ${pieces} pieces`, run: expect.stringMatching(/^run #1 · /),
            reads: `reads customers #${(await weighed(ex.customers)).hash} · order_history #${history.hash}`,
        });
        expect(results().querySelector("table")).not.toBeNull();
    });

    test("in the jq view: the jq as typed, its result the one-shot call's", async () => {
        const polled = h.splitResults();
        const jobs = h.jobs();
        await h.mountHistory();
        await runJq(BY_STATUS);
        await ran(1);
        expect([h.splitCalls().length, h.oneShots().length]).toEqual([1, 0]);
        expect(h.splitCalls()[0]!.output.type).toBe("dict");
        const expected = await oneShot(BY_STATUS, HISTORY_ROOT);
        const answer = decoded(completedOf(polled(), jobs()[0]!).result);
        expect(equalFor(expected.type)(answer.value as never, expected.value as never)).toBe(true);
        const pieces = await piecesOf(h.splitCalls()[0]!);
        await waitFor(() => expect([footer().count, footer().plan]).toEqual(["3 rows", `Split call · ${pieces} pieces`]));
    });

    test("a join both of whose sides weigh more than one piece is re-keyed (#942): two split calls, the second over the first's output by its hash; the one-shot call's result", async () => {
        const polled = h.splitResults();
        const jobs = h.jobs();
        await h.mountHistory();
        await runJq(BY_REGION);
        await ran(1);
        expect([h.splitCalls().length, h.oneShots().length]).toEqual([2, 0]);
        // The join call reads the re-key call's output by its hash.
        const first = completedOf(polled(), jobs()[0]!);
        expect(first.output).toBeDefined();
        expect(h.splitCalls()[1]!.args.map((a) => a.arg)).toContainEqual(variant("object", first.output!));
        const expected = await oneShot(BY_REGION, HISTORY_ROOT);
        const answer = decoded(completedOf(polled(), jobs().at(-1)!).result);
        expect(equalFor(expected.type)(answer.value as never, expected.value as never)).toBe(true);
        // The pieces are the join call's; what the run read, the history the re-key call read, then the accounts.
        const pieces = await piecesOf(h.splitCalls()[1]!);
        const [history, accounts] = [await weighed(ex.historyTask.output), await weighed(ex.accountsTask.output)];
        await waitFor(() => expect(footer().plan).toBe(`Re-keyed join · ${pieces} pieces`));
        expect(footer()).toEqual({
            count: "8 rows", plan: `Re-keyed join · ${pieces} pieces`, run: expect.stringMatching(/^run #1 · /),
            reads: `reads order_history #${history.hash} · accounts #${accounts.hash}`,
        });
        const weight = byteWords(history.bytes, words);
        expect(await explanation()).toEqual([
            ["path", `Split call over order_history: it weighs ${weight}, more than one piece (${PIECE}).`, undefined],
            ["rekey", "Re-key: both sides large and unaligned — accounts weighs more than one piece too.", undefined],
            ["rekey", `First, order_history is re-keyed by this, about ${weight}, and each piece then reads accounts cut at the same keys:`, ".customer_id"],
            ["piece", "Each piece of order_history runs:", ".order_history\n| map($a[.customer_id].region)"],
            ["combine", "Their distinct rows are kept:", "unique"],
            piecesLine("Order_history", pieces, history.bytes),
        ]);
    });

    test("the plan's explanation: the path and why, what each piece runs, how the pieces combine, what runs once after, what each reads whole, and the pieces", async () => {
        await h.mountHistory();
        await openQuery(variant("saved", TOP.name));
        await ran(1);
        const pieces = await piecesOf(h.splitCalls()[0]!);
        await waitFor(() => expect(footer().plan).toBe(`Split call · ${pieces} pieces`));
        const history = await weighed(ex.historyTask.output);
        const lines = await explanation();
        expect(screen.getByRole("dialog").textContent).toContain("How this run reads its data");
        expect(lines).toEqual([
            ["path", `Split call over order_history: it weighs ${byteWords(history.bytes, words)}, more than one piece (${PIECE}).`, undefined],
            ["piece", "Each piece of order_history runs:", [
                ".order_history",
                "map(select(.status.type == \"shipped\"))",
                "map(. + {name: $customers[.customer_id].name})",
            ].join("\n| ")],
            // The sort's first 10 rows kept in each piece, then across them (#942): never every shipped order.
            ["combine", "The first 10 rows of the sort are kept, each piece's and then theirs together, by:", "-.total"],
            ["then", "Then, once, over what they combine to:", ".[:10]"],
            ["broadcast", "Every piece reads customers whole.", undefined],
            piecesLine("Order_history", pieces, history.bytes),
        ]);
    });

    test("its progress while it goes — pieces done of all, in the running head and the read-out — then its pieces", async () => {
        // e3's units are held before they run, so the run is seen with two of its pieces done; e3 writes a call's
        // progress at most once each half second, dropping what comes between, so the test's clock moves past that
        // before each piece runs.
        vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
        const units = h.e3.holdUnits();
        const splits = h.splitJobs();
        await h.mountHistory();
        await runJq(".order_history | group_by(.status.type) | map({status: .[0].status.type, most: (map(.total) | max)})");
        await units.holding;
        for (let piece = 1; piece <= 2; piece++) {
            vi.setSystemTime(Date.now() + PROGRESS_WRITES_MS);
            await units.releaseOne();
            // e3 has written the piece done before the clock moves on to the next.
            await waitFor(async () => {
                const status = await splitCallStatus(h.e3.apiUrl, h.e3.repo, h.workspace, splits()[0]!, h.e3.direct);
                expect(status.type === "processing" && status.value.type === "some" ? Number(status.value.value.done) : undefined).toBe(piece);
            }, { timeout: 10_000 });
        }
        const pieces = await piecesOf(h.splitCalls()[0]!);
        await waitFor(() => expect(footer().plan).toBe(`Split call · 2 of ${pieces} pieces done`), { timeout: 10_000 });
        expect(results().querySelector("[data-query-results-progress]")!.textContent).toBe(`2 of ${pieces} pieces done`);
        expect(footer().count).toBe("Running…");
        expect((await explanation()).at(-1)).toEqual(["pieces", `2 of ${pieces} pieces done`, undefined]);
        units.release();
        await ran(1);
        expect([footer().count, footer().plan]).toEqual(["3 rows", `Split call · ${pieces} pieces`]);
    });
});

// ─── Its pieces, counted by its explain ──────────────────────────────────────

describe("<Query.Builder> — a split run that answered before e3 said how many pieces it cut has them counted by e3's explain of the call (#1132)", () => {
    test("once it has answered: its read-out and its explanation name the pieces, and the call explained is the one that ran", async () => {
        const quiet = answeredBeforeItSaid();
        await h.mountHistory();
        await runJq(grouped(500));
        await quiet.end(0);
        await ran(1);
        const pieces = await piecesOf(h.splitCalls()[0]!);
        await waitFor(() => expect([footer().count, footer().plan]).toEqual(["3 rows", `Split call · ${pieces} pieces`]));
        expect(h.explains()).toHaveLength(1);
        expect(sameRequest(h.explains()[0]!, h.splitCalls()[0]!)).toBe(true);
        expect((await explanation()).at(-1)).toEqual(piecesLine("Order_history", pieces, (await weighed(ex.historyTask.output)).bytes));
    });

    test("a run whose progress named its pieces is never explained: an explain is work in proportion to the dataset", async () => {
        // e3's units are held until a poll has said how many pieces the call cuts.
        const units = h.e3.holdUnits();
        await h.mountHistory();
        await runJq(grouped(400));
        await units.holding;
        await waitFor(() => expect(footer().plan).toMatch(/^Split call · 0 of \d+ pieces done$/), { timeout: 10_000 });
        units.release();
        await ran(1);
        const pieces = await piecesOf(h.splitCalls()[0]!);
        expect([footer().plan, h.explains().length]).toEqual([`Split call · ${pieces} pieces`, 0]);
    });

    test("a re-keyed join's pieces are its join call's: that call explained, the re-key call's output read by its hash", async () => {
        const quiet = answeredBeforeItSaid();
        await h.mountHistory();
        await runJq(".accounts as $a | .order_history | map($a[.customer_id].tier.type) | unique");
        await quiet.end(0);
        await quiet.end(1);
        await ran(1);
        const pieces = await piecesOf(h.splitCalls()[1]!);
        await waitFor(() => expect(footer().plan).toBe(`Re-keyed join · ${pieces} pieces`));
        expect([h.splitCalls().length, footer().count]).toEqual([2, "2 rows"]);
        expect(h.explains()).toHaveLength(1);
        expect(sameRequest(h.explains()[0]!, h.splitCalls()[1]!)).toBe(true);
    });

    test("an explain e3 refuses leaves the count unknown: the read-out says Split call, and nothing is wrong with the run", async () => {
        h.e3.fail(isExplain, { status: 500, type: "internal", message: "the pieces could not be planned" });
        const quiet = answeredBeforeItSaid();
        await h.mountHistory();
        await runJq(grouped(300));
        await quiet.end(0);
        await ran(1);
        await waitFor(() => expect(h.requests("split").filter(isExplain)).toHaveLength(1));
        await settle();
        expect([footer().count, footer().plan, banners()]).toEqual(["3 rows", "Split call", []]);
    });

    test("a new run abandons the explain of the run before with it: that count never lands, and the new run's does", async () => {
        const explains = h.e3.hold(isExplain);
        const explained = h.explainJobs();
        const quiet = answeredBeforeItSaid();
        await h.mountHistory();
        await runJq(grouped(200));
        await quiet.end(0);
        await ran(1);
        await explains.holding;
        expect([footer().run, footer().plan]).toEqual([expect.stringMatching(/^run #1 · /), "Split call"]);
        await runKeys();
        await quiet.end(1);
        await ran(2);
        await waitFor(() => expect(explains.held).toBe(2));
        await act(async () => { explains.release(); });
        const pieces = await piecesOf(h.splitCalls()[1]!);
        await waitFor(() => expect([footer().run, footer().plan]).toEqual([expect.stringMatching(/^run #2 · /), `Split call · ${pieces} pieces`]));
        // The first run's explain was abandoned with its run: it stopped before it polled its job.
        const [first, second] = explained();
        expect([h.requests("split").filter(isPoll(first)).length, h.requests("split").filter(isPoll(second)).length > 0]).toEqual([0, true]);
    });

    test("a host's split calls are explained by the host, or not at all: with no explain of its own, the server's is never asked", async () => {
        // The host's own split call — the calls in memory, over the history as e3 holds it — which reports no progress.
        const sources: readonly E3Dataset[] = [ex.historyTask.output, ex.accountsTask.output, ex.creditTask.output, ex.customers];
        const datasets = await Promise.all(sources.map(async (dataset) => ({ path: dataset.path, type: dataset.type, value: await h.read(dataset) as unknown })));
        const host = createInMemorySplitCall(datasets, { pieces: 4 });
        const quiet: QuerySplitCall = (request, options) => host(request, { ...options, onProgress: () => {} });
        await h.mountHistory({ host: (builder) => <QuerySplitCallProvider call={quiet}>{builder}</QuerySplitCallProvider> });
        await runJq(grouped(150));
        await ran(1);
        expect([footer().count, footer().plan]).toEqual(["3 rows", "Split call"]);
        expect(h.requests("split")).toEqual([]);
    });
});

// ─── One call ────────────────────────────────────────────────────────────────

describe("<Query.Builder> — one call, and when a split run can't be made (#941)", () => {
    test("a dataset within one piece is one call, as the fixture's always are — its read-out One call, and why", async () => {
        await h.mountBuilder();
        await openQuery(variant("saved", DEFAULT.name));
        expect([h.splitCalls().length, h.oneShots().length]).toEqual([0, 1]);
        // A one-shot visual run counts every shape line.
        expect(shapes()).toEqual(["40 orders", "16 shipped orders", "16 shipped orders+ name, region", "16 ordersorder, customer, region, total, shipped", "16 orders", "10 orders"]);
        expect(footer().plan).toBe("One call");
        const orders = await weighed(ex.orders);
        expect(await explanation()).toEqual([["path", `One call: orders weighs ${byteWords(orders.bytes, words)}, within one piece (${PIECE}).`, undefined]]);
    });

    test("the plan's options' own piece: a small dataset splits over a small one", async () => {
        await h.mountBuilder({ host: (builder) => <QueryPlanOptionsProvider pieceBytes={1024}>{builder}</QueryPlanOptionsProvider> });
        await openQuery(variant("saved", DEFAULT.name));
        await ran(1);
        expect([h.splitCalls().length, h.oneShots().length]).toEqual([1, 0]);
        // e3 cuts no piece smaller than its own: the fixture's forty orders are one.
        expect(await piecesOf(h.splitCalls()[0]!)).toBe(1);
        expect([footer().count, footer().plan]).toEqual(["10 orders", "Split call · 1 piece"]);
    });

    test("a status that can't be read leaves the dataset's weight unknown: one call, which says so", async () => {
        h.e3.fail((request) => request.kind === "dataset-status" && request.dataset === "inputs.orders" && request.query.get("status") === "true");
        await h.mountBuilder();
        await openQuery(variant("saved", DEFAULT.name));
        await ran(1);
        expect([h.oneShots().length, footer().count, footer().plan]).toEqual([1, "10 orders", "One call"]);
        expect(await explanation()).toEqual([["path", "One call: what orders weighs isn't known.", undefined]]);
    });

    test("a query that runs as one unit is one call however much its dataset weighs, and says why", async () => {
        await h.mountHistory();
        await runJq(".order_history | length");
        await ran(1);
        expect([h.splitCalls().length, h.oneShots().length, footer().plan]).toEqual([0, 1, "One call"]);
        expect(await explanation()).toEqual([
            ["path", "One call: it reads a count, a key or a value of order_history, and works through none of its rows.", undefined],
            ["pruning", "Reads the count from the index of order_history, and no segment:", ".order_history\n| length"],
        ]);
    });

    test("a split run with no split call to make never reached a server", async () => {
        // A host that weighs its data sources by their statuses on e3, and makes neither call.
        const status = async (path: Parameters<typeof datasetGetStatus>[3]) =>
            sourceStatusOf(await datasetGetStatus(h.e3.apiUrl, h.e3.repo, h.workspace, path, h.e3.direct));
        const { result } = renderHook(() => useQueryRun(HISTORY_ROOT, { call: undefined, split: undefined, explain: undefined, status, options: { pieceBytes: EXAMPLES_PIECE_MIN } }));
        const program = ".order_history | map(.id)";
        const parsed = parseSteps(".order_history", HISTORY_ROOT.type);
        if ("error" in parsed) throw new Error(parsed.error.message);
        const plan = planRun({
            view: "jq", header: { id: QUERY_HEADER_ID, name: "Order ids", description: none, source: "order_history", jq: none },
            query: parsed.query, checked: undefined, jqText: program, jqChecked: checkJq(program, HISTORY_ROOT.type, { root: true }),
        }, HISTORY_ROOT);
        await act(async () => { result.current.run(plan); });
        await waitFor(() => expect(result.current.state.status).toBe("failed"));
        expect(runFailure(result.current.state, words)).toEqual({ title: "Couldn't reach the server", message: "" });
    });
});

// ─── Abandoned, refused, unreachable ─────────────────────────────────────────

describe("<Query.Builder> — a split run abandoned, refused, or never reaching the server (#941)", () => {
    test("a new run abandons a split call by its signal: only the last run's answer shows", async () => {
        // e3's units are held, so the first run's call is going when the second starts.
        const units = h.e3.holdUnits();
        const polled = h.splitResults();
        const jobs = h.jobs();
        await h.mountHistory();
        await runJq(grouped(100));
        await units.holding;
        await runKeys();
        await waitFor(() => expect(jobs()).toHaveLength(2));
        units.release();
        await ran(2);
        const pieces = await piecesOf(h.splitCalls()[1]!);
        await waitFor(() => expect([footer().count, footer().plan]).toEqual(["3 rows", `Split call · ${pieces} pieces`]));
        // The first run's call stopped polling as the second began: no poll found its job ended.
        expect(polled().filter((poll) => poll.job === jobs()[0] && poll.status.type !== "processing")).toEqual([]);
    });

    test("the run a saved query starts as the builder mounts, under React's mount → unmount → mount: abandoned by the unmount, started again under its number, and answering", async () => {
        await h.mountHistory({ query: TOP.name, strict: true });
        await ran(1);
        const pieces = await piecesOf(h.splitCalls()[0]!);
        await waitFor(() => expect(footer().plan).toBe(`Split call · ${pieces} pieces`));
        expect(banners()).toEqual([]);
        expect(footer()).toEqual({
            count: "10 shipped order histories", plan: `Split call · ${pieces} pieces`, run: expect.stringMatching(/^run #1 · /),
            reads: `reads customers #${(await weighed(ex.customers)).hash} · order_history #${(await weighed(ex.historyTask.output)).hash}`,
        });
        // The unmount abandoned the run while it weighed the history, before it called: the one split call is the run's again.
        expect(h.splitCalls()).toHaveLength(1);
    });

    test("a split call e3 could not run is Not run, with e3's words; one that never reached the server, Couldn't reach the server", async () => {
        await h.mountHistory();
        // Every piece divides by zero.
        await runJq(".order_history | map(.id % 0)");
        await ran(1);
        expect(banners()).toEqual([expect.stringMatching(/^Not run.*Division by zero/)]);
        // The read-out still says how the run was to read its data: the pieces e3 cut.
        const pieces = await piecesOf(h.splitCalls()[0]!);
        await waitFor(() => expect([footer().count, footer().plan]).toEqual(["No result", `Split call · ${pieces} pieces`]));
        // The network fails each try: e3's client tries again after a pause, a timer the harness's settle cannot see.
        h.e3.fail(isSplitLaunch, "network");
        await runJq(".order_history | map(.id % 2)");
        await waitFor(() => expect(banners()).toEqual([
            `Couldn't reach the serverfetch failed: the test failed the network for POST /repos/default/workspaces/${h.workspace}/one-shot/split`,
        ]), { timeout: 10_000 });
    });
});

// ─── Through the provider's fetch ────────────────────────────────────────────

describe("<Query.Builder> — under its E3Provider, whose fetch is e3's in the page, every call goes through it (#941)", () => {
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

    test("a run's status, its split call's launch and polls, its explain, and a one-shot call — each with the provider's token", async () => {
        const jobs = h.jobs();
        const quiet = answeredBeforeItSaid();
        await h.mountHistory({ token: "tok" });
        // A split run: the history weighed, then the call launched and polled. Its job answered at its first poll — as a
        // run e3's cache served does — so no progress told how many pieces it cut: its explain, launched and polled
        // through the same fetch, counts them (#1132).
        await runJq(grouped(50));
        await quiet.end(0);
        await ran(1);
        const pieces = await piecesOf(h.splitCalls()[0]!);
        await waitFor(() => expect([footer().count, footer().plan]).toEqual(["3 rows", `Split call · ${pieces} pieces`]));
        // One call: a query that runs as one unit.
        await runJq(".order_history | length");
        await ran(2);
        expect(footer().plan).toBe("One call");
        const ws = h.workspace;
        const asked = h.requests().map((request) => `${request.method} ${request.path}${request.query.size > 0 ? `?${request.query}` : ""}`);
        expect(asked).toEqual(expect.arrayContaining([
            `GET /repos/default/workspaces/${ws}/datasets/tasks/order_history/output?status=true`,
            `POST /repos/default/workspaces/${ws}/one-shot/split`,
            `GET /repos/default/workspaces/${ws}/one-shot/split/${jobs()[0]}`,
            `POST /repos/default/workspaces/${ws}/one-shot/split?explain=1`,
            `GET /repos/default/workspaces/${ws}/one-shot/split/${jobs()[1]}`,
            `POST /repos/default/workspaces/${ws}/one-shot`,
        ]));
        expect(h.requests().filter((request) => request.authorization !== "Bearer tok").map((request) => request.path)).toEqual([]);
        expect(escaped).toEqual([]);
    });
});
