/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A result too large for one answer, read a page at a time (#1113), through
 * `<Query.Builder>`'s carrier on e3 itself (#1376), over the order history the
 * query examples' tasks generate — 36,000 orders, more than one piece here —
 * each order's lines as rows of their own, with their order's lines as text:
 * some 72,000 rows, 1.7 MB in beast2, over a run's answer of 1 MiB:
 *
 * - a split call with no final step that e3 answered `too_large` has its
 *   output opened by the hash the answer names (e3-api-client's
 *   `collectionOpen`, #1106), through the page's fetch, and shows no banner:
 *   the footer counts every row, and Download is off;
 * - as a Table, east-ui's paged row source over it, each window the history's
 *   rows at its offset;
 * - as a Tree, the ValueTree's paging over every row, a page far down read
 *   when the Tree asks for its rows;
 * - an answer too large that a final step made stays too large, worded.
 *
 * jsdom lays nothing out, so a virtualised Table or Tree mounts no rows: the
 * renderers are e3-ui-components' own, and the test reads the value and the
 * paging each was handed, as the paged preview's test does.
 */

import { createElement } from "react";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ArrayType, checkJq, decodeEastIR, encodeEastIR, equalFor, toEastTypeValue, translateJq, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import { ValueTree } from "@elaraai/east-ui";
import type { Table } from "@elaraai/east-ui/internal";
import type { TableRootValue, ValueTreePaging } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import type { SplitCallStatus } from "@elaraai/e3-types";
import { HISTORY_ROOT, act, isSplitLaunch, queryHarness, settle } from "./query.test-utils.js";

const mocks = vi.hoisted(() => ({
    /** The value the results last handed the Table. */
    table: undefined as TableRootValue | undefined,
    /** The paging the results last handed the Tree. */
    paging: undefined as ValueTreePaging | undefined,
}));

// The renderers are the production ones; each value and paging they are handed is kept, for the test to read.
vi.mock("@elaraai/east-ui-components", async (importOriginal) => {
    const real = await importOriginal<typeof import("@elaraai/east-ui-components")>();
    return {
        ...real,
        EastChakraTable: (props: Parameters<typeof real.EastChakraTable>[0]) => {
            mocks.table = props.value;
            return createElement(real.EastChakraTable, props);
        },
        EastChakraValueTree: (props: Parameters<typeof real.EastChakraValueTree>[0]) => {
            mocks.paging = props.paging;
            return createElement(real.EastChakraValueTree, props);
        },
    };
});

/** A row of the Table. */
type TableRow = ValueTypeOf<typeof Table.Types.Row>;

/** Each order's lines as rows of their own, the assembled output itself: no final step makes the answer. */
const LINES = ".order_history | map(.lines[] as $l | . + {line: $l, s: (.status | tostring), l: (.lines | tostring)})";

/** The same rows reversed: a final step makes the answer. */
const REVERSED = `${LINES} | reverse`;

/** A row the query gives: an order, with one of its lines and its words. */
type LineRow = { readonly id: bigint };

/** What a query gives over the history, as the one unit gives it, run here: what the result's pages must hold. */
async function expected(program: string): Promise<{ rows: readonly LineRow[]; row: EastType }> {
    const translation = translateJq(checkJq(program, HISTORY_ROOT.type, { root: true }));
    const values: Readonly<Record<string, unknown>> = { order_history: await h.read(ex.historyTask.output) };
    const fn = decodeEastIR(encodeEastIR(translation.fn().toIR())).compile([]) as (...args: unknown[]) => unknown;
    const type = translation.resultType;
    if (type.type !== "Array") throw new Error("the query gives an array of rows");
    return { rows: fn(...translation.inputs.map((input) => values[input.name!])) as LineRow[], row: type.value as EastType };
}

const h = queryHarness();

beforeEach(async () => {
    mocks.table = undefined;
    mocks.paging = undefined;
    await h.seedHistory([]);
});

/** The results region. */
const results = () => document.querySelector<HTMLElement>("[data-query-results]")!;
/** The footer's count. */
const count = () => results().querySelector("[data-query-results-footer] [data-query-result-count]")?.textContent ?? "";
/** The result's strips' words. */
const banners = () => [...document.querySelectorAll<HTMLElement>("[data-query-strips] [role=alert], [data-query-strips] [role=status]")].map((b) => b.textContent ?? "");
/** The result view strip's buttons, by name. */
const resultButton = (name: "Table" | "Tree") => within(screen.getByRole("group", { name: "Result view" })).getByRole("button", { name });

/** Shows the jq view, types the jq, and runs it, until its run answers. */
async function runJq(text: string, n: number) {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "jq" })); });
    await settle();
    await act(async () => { fireEvent.change(screen.getByRole("textbox", { name: "jq query" }), { target: { value: text } }); });
    await act(async () => { fireEvent.click(document.querySelector<HTMLElement>("[data-query-run]")!); });
    await waitFor(() => expect(results().querySelector("[data-query-result-run]")?.textContent ?? "").toMatch(new RegExp(`^run #${n} · `)), { timeout: 30_000 });
    await settle();
}

/** What the poll that found a job ended carried. */
function endedWith(polled: readonly { readonly job: string; readonly status: SplitCallStatus }[], job: string): SplitCallStatus {
    const done = polled.find((poll) => poll.job === job && poll.status.type !== "processing");
    if (done === undefined) throw new Error(`no poll found the job ${job} ended`);
    return done.status;
}

/** A window of the Table's paged rows, once it has landed: the Table, and the test, ask for it. */
async function windowOf(offset: number, limit: number): Promise<TableRow[]> {
    let rows: TableRow[] | undefined;
    await waitFor(() => {
        const table = mocks.table;
        if (table?.rows.type !== "paged") throw new Error(`the Table's rows are ${table?.rows.type ?? "not handed yet"}`);
        const window = table.rows.value.page(BigInt(offset), BigInt(limit));
        if (window.type !== "some") throw new Error(`the window at ${offset} has not landed`);
        rows = window.value;
    }, { timeout: 10_000 });
    return rows!;
}

describe("<Query.Builder> — a result too large for one answer is read a page at a time (#1113)", () => {
    test("a split call with no final step: its output opened by the hash its answer names, no banner, every row counted, and Download off", async () => {
        const polled = h.splitResults();
        const jobs = h.splitJobs();
        const { rows } = await expected(LINES);
        // The repository's own reads — its objects — are no workspace's: the log of every request, from here.
        const before = h.e3.requests.length;
        await h.mountHistory();
        await runJq(LINES, 1);
        expect(h.requests("split").filter(isSplitLaunch)).toHaveLength(1);
        expect(h.splitCalls()[0]!.then.type).toBe("none");
        const status = endedWith(polled(), jobs()[0]!);
        if (status.type !== "completed") throw new Error(`the call ended ${status.type}`);
        expect([status.value.result.outcome.type, status.value.output.type]).toEqual(["too_large", "some"]);
        const hash = status.value.output.type === "some" ? status.value.output.value : "";
        expect(banners()).toEqual([]);
        expect(count()).toMatch(new RegExp(`^${rows.length.toLocaleString("en-US")} `));
        expect((document.querySelector("[data-query-download]") as HTMLButtonElement).disabled).toBe(true);
        // The manifest is read once, by its hash, through the page's fetch: the repository's objects route.
        await windowOf(0, 200);
        expect(h.e3.requests.slice(before).filter((request) => request.path === `/repos/${h.e3.repo}/objects/${hash}`)).toHaveLength(1);
    });

    test("as a Table: east-ui's paged row source over it, each window the result's rows at its offset", async () => {
        const { rows } = await expected(LINES);
        await h.mountHistory();
        await runJq(LINES, 1);
        expect(mocks.table?.rows.type).toBe("paged");
        const id = (row: TableRow) => row.cells.get("id");
        for (const offset of [0, 3_800, 41_950]) {
            expect((await windowOf(offset, 200)).map(id)).toEqual(rows.slice(offset, offset + 200).map((row) => variant("Integer", row.id)));
        }
        // The last window holds what is left.
        expect((await windowOf(rows.length - 50, 200)).length).toBe(50);
    });

    test("as a Tree: the ValueTree's paging over every row, a page far down read when the Tree asks for its rows", async () => {
        const { rows, row } = await expected(LINES);
        await h.mountHistory();
        await runJq(LINES, 1);
        await act(async () => { fireEvent.click(resultButton("Tree")); });
        await settle();
        await waitFor(() => expect(mocks.paging?.totalRows).toBe(rows.length));
        await act(async () => { mocks.paging!.onNeedRows(50_500, 50_600); });
        await waitFor(() => expect(mocks.paging!.pages.has(50)).toBe(true), { timeout: 10_000 });
        const page = mocks.paging!.pages.get(50)!;
        expect([page.length, page[0]!.step, page[999]!.step]).toEqual([1000, variant("index", 50_000n), variant("index", 50_999n)]);
        const type = toEastTypeValue(row);
        expect(equalFor(ArrayType(ValueTree.Types.Node))(page.map((r) => r.node), rows.slice(50_000, 51_000).map((r) => ValueTree.materialize(type, r)))).toBe(true);
    });

    test("an answer too large that a final step made stays too large, worded", async () => {
        await h.mountHistory();
        await runJq(REVERSED, 1);
        expect(h.requests("split").filter(isSplitLaunch)).toHaveLength(1);
        expect(banners()).toEqual([expect.stringMatching(/^The result is too large/)]);
        expect(mocks.table).toBeUndefined();
    });
});
