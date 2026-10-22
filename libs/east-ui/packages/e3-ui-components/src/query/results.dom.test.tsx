/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Runs and results (#938, `Query Editor Spec.md` §4.11, §7 R1–R8), through
 * `<Query.Builder>`'s carrier over the saved queries record on e3 (#1376),
 * each run e3's one-shot call over the query examples' orders and customers,
 * pinned at their hashes:
 *
 * - **R1**: a run is one one-shot call over the root, the counting program in
 *   the visual view and the jq in the jq view; a new run abandons the old;
 *   opening a saved query runs it, an edit or a new query never does; before
 *   any run the empty state's mark is Font Awesome's play (#1263).
 * - **R2, R8**: a fresh visual run counts the shape lines — 40, 16, 16, 16, 16
 *   and 10 for the default query.
 * - **R3**: an edit makes the result stale — the banner, the dashed body, the
 *   shape lines plain again.
 * - **R4**: each way a run gives no result, worded — e3's own where a test can
 *   make it, and the words of an answer e3 gives past a test's time (a run
 *   stopped at its time limit) from the answer itself.
 * - **R5**: the footer — the count, the fields, the run, what it read.
 * - **R6**: downloads — the CSV's text and name, the BEAST2's typed value; the
 *   note after one closed by Font Awesome's xmark, named Close (#1263).
 * - **R7**: the Table and the Value tree through the production renderers,
 *   picked by the result and overridden by the toolbar until the next run.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
    ArrayType, IntegerType, StructType, checkJq, decodeBeast2, decodeEastIR, equalFor, evaluateJq, fromEastTypeValue, isTypeEqual, none, variant,
} from "@elaraai/east";
import type { ExecuteResult } from "@elaraai/e3-types";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import { formatters } from "@elaraai/east-ui-components";
import { foreignIcons, markOf } from "@elaraai/east-ui-components/testing";
import type { E3Dataset } from "../e3-web.test-utils.js";
import { FIXTURE_VALUE, FixtureType, ROOT, savedQuery } from "./fixture.test-utils.js";
import { queryWords } from "./model/words.js";
import { prepareQuery, queryResultOf } from "./one-shot.js";
import { act, isRun, openQuery, press, queryHarness, settle } from "./query.test-utils.js";
import { runFailure } from "./results.js";
import { planRun } from "./run.js";
import { QUERY_HEADER_ID } from "./session.js";
import { parseSteps } from "./steps/parse.js";

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
const BIG = savedQuery("Big orders", ".orders\n| map(select(.total >= 1000))");
const COUNT = savedQuery("Order count", ".orders | length");

const h = queryHarness();

beforeEach(async () => {
    await h.seed([TOP, BIG, COUNT]);
});

/** The first characters of a dataset's hash on e3, as the footer names it. */
async function hashOf(dataset: E3Dataset): Promise<string> {
    const status = await h.statusOf(dataset);
    if (status.hash.type !== "some") throw new Error(`${status.path} holds no value`);
    return status.hash.value.slice(0, 8);
}

// ─── What the results show ───────────────────────────────────────────────────

/** The results region. */
const results = () => document.querySelector<HTMLElement>("[data-query-results]")!;
/** The footer's parts: the count, the fields, the run's line and what it read. */
function footer() {
    const el = results().querySelector<HTMLElement>("[data-query-results-footer]")!;
    const text = (sel: string) => el.querySelector(sel)?.textContent ?? "";
    return { count: text("[data-query-result-count]"), fields: text("[data-query-result-fields]"), run: text("[data-query-result-run]"), reads: text("[data-query-result-reads]") };
}
/** The result's strips under the builder's toolbar: each one's words. */
const banners = () => [...document.querySelectorAll<HTMLElement>("[data-query-strips] [role=alert], [data-query-strips] [role=status]")].map((b) => b.textContent ?? "");
/** The shape lines' words, in order. */
const shapes = () => [...document.querySelectorAll<HTMLElement>("[data-query-shape-text]")].map((el) => el.textContent);
/** How the result shows: `table`, `tree`, or none — said by the results themselves, the builder frame's main (#1125). */
const shownAs = () => results().getAttribute("data-query-results-view");
/** The view strip's buttons, by name. */
const viewButton = (name: "Visual" | "jq") => within(screen.getByRole("group", { name: "View" })).getByRole("button", { name });
/** The result view strip's buttons, by name. */
const resultButton = (name: "Table" | "Tree") => within(screen.getByRole("group", { name: "Result view" })).getByRole("button", { name });
/** The output type of a call's body: what it answers. */
const answers = (bodyIr: Uint8Array) => {
    const type = fromEastTypeValue(decodeEastIR(bodyIr).ir.value.type);
    if (type.type !== "Function") throw new Error("a call's body is a function");
    return type.output;
};
/** The jq field. */
const jqField = () => screen.getByRole("textbox", { name: "jq query" }) as HTMLTextAreaElement;
/** Shows the jq view, and types the jq. */
async function typeJq(text: string) {
    await act(async () => { fireEvent.click(viewButton("jq")); });
    await settle();
    await act(async () => { fireEvent.change(jqField(), { target: { value: text } }); });
}
/** Runs the query, from the toolbar. */
async function run() {
    await act(async () => { fireEvent.click(document.querySelector<HTMLElement>("[data-query-run]")!); });
    await settle();
}
/** Runs the query with ⌘⏎, which runs anywhere in the builder — while a run goes too, when the toolbar's Run is busy. */
async function runKeys() {
    await act(async () => { fireEvent.keyDown(document.querySelector<HTMLElement>("[data-query-builder]")!, { key: "Enter", ctrlKey: true }); });
    await settle();
}
/** Opens a menu from the keyboard, as its trigger's arrow key does. */
async function openMenu(trigger: HTMLElement) {
    await act(async () => { trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" }); });
}
/** Picks a menu item from the keyboard, by its value: arrows down to it, a step at a time, then Enter. */
async function pick(value: string) {
    const menu = screen.getByRole("menu");
    for (let step = 0; step < 20 && menu.querySelector("[data-highlighted]")?.getAttribute("data-value") !== value; step++) {
        await act(async () => { fireEvent.keyDown(menu, { key: "ArrowDown" }); });
    }
    await act(async () => { fireEvent.keyDown(menu, { key: "Enter" }); });
    await settle();
}

// ─── R1 ──────────────────────────────────────────────────────────────────────

describe("<Query.Builder> — runs (#938 R1)", () => {
    test("nothing runs at the start or on an edit; opening a saved query runs it, naming what it reads while it goes", async () => {
        // Each run's call is held on its way to e3, so the run is seen while it goes.
        const runs = h.e3.hold(isRun);
        await h.mountBuilder();
        expect([h.oneShots().length, results().querySelector("[data-query-results-idle]") !== null, footer().count]).toEqual([0, true, "No result yet"]);
        // The idle state's mark is Font Awesome's play — Run is the way to a result — never a written ⏎ (#1263).
        const idle = results().querySelector<HTMLElement>("[data-query-results-idle]")!;
        expect(markOf(within(idle).getByRole("heading").parentElement!.previousElementSibling)).toBe("fas play");
        await openQuery(variant("saved", TOP.name));
        expect(h.oneShots()).toHaveLength(1);
        expect(results().querySelector("[data-query-results-running]")!.textContent).toBe("Reading customers and orders");
        expect([footer().count, document.querySelector("[data-query-run]")!.textContent]).toEqual(["Running…", "Running"]);
        await act(async () => { runs.release(); });
        await settle();
        expect(shownAs()).toBe("table");
        // The run that answered is this viewer's most recent query, by its name.
        await waitFor(() => expect(localStorage.getItem("query.builder.recent") ?? "").toContain("Top shipped orders, 2026"));
        await press("Keep the first", document.querySelector<HTMLElement>("[data-query-foot]")!);
        expect(h.oneShots()).toHaveLength(1);
    });

    test("the visual view sends the counting program; the jq view the jq, canonically", async () => {
        await h.mountBuilder();
        await openQuery(variant("saved", BIG.name));
        const counting = answers(h.oneShots()[0]!.bodyIr);
        expect(counting.type === "Struct" && Object.keys(counting.fields)).toEqual(["counts", "result"]);
        await typeJq(".orders   |   length");
        await run();
        expect(isTypeEqual(answers(h.oneShots()[1]!.bodyIr), IntegerType)).toBe(true);
        // One value is counted in its shape's words.
        expect(footer().count).toBe("One whole number");
    });

    test("a new run abandons the one before: only the last one's answer shows, however late the others answer", async () => {
        const runs = h.e3.hold(isRun);
        await h.mountBuilder();
        await openQuery(variant("saved", COUNT.name));
        await runKeys();
        await runKeys();
        expect(h.oneShots()).toHaveLength(3);
        // The last run answers first; the two it abandoned answer after it, and change nothing.
        for (let held = runs.held; held > 0; held--) {
            await act(async () => { runs.releaseLast(); });
            await settle();
        }
        expect(footer().run).toMatch(/^run #3 · /);
    });
});

// ─── R2, R3, R8 ──────────────────────────────────────────────────────────────

describe("<Query.Builder> — counted shape lines and staleness (#938 R2, R3, R8)", () => {
    test("R8: after a fresh run the default query's shape lines read 40, 16, 16, 16, 16 and 10", async () => {
        await h.mountBuilder();
        await openQuery(variant("saved", TOP.name));
        expect(shapes()).toEqual([
            "40 orders",
            "16 shipped orders",
            "16 shipped orders+ name, region",
            "16 ordersorder, customer, region, total, shipped",
            "16 orders",
            "10 orders",
        ]);
    });

    test("R3: an edit makes the result stale — the banner with Run again, the body dashed, the shape lines plain — and Run again freshens it", async () => {
        await h.mountBuilder();
        await openQuery(variant("saved", BIG.name));
        expect(banners()).toEqual([]);
        await press("Keep the first", document.querySelector<HTMLElement>("[data-query-foot]")!);
        expect(banners()).toEqual(["StaleThe query changed after this run.Run again⌘⏎"]);
        expect(results().querySelector("[data-stale]")).not.toBeNull();
        expect(shapes()).toEqual(["Many orders", "Many orders", "Up to 10 orders"]);
        // Its keys are part of its name, as the toolbar's Run's are.
        await press("Run again⌘⏎");
        expect([banners(), results().querySelector("[data-stale]")]).toEqual([[], null]);
        expect(shapes()).toEqual(["40 orders", "20 orders", "10 orders"]);
    });
});

// ─── R4 ──────────────────────────────────────────────────────────────────────

/** The builder's words: the message table, and the en-US formatters. */
const words = queryWords(formatters("en-US"));

/**
 * The banner a run of `.orders | length` shows for an answer e3 gives: the
 * answer read as a run reads it (`queryResultOf`), and worded as the results
 * word a run that gave no result (`runFailure`).
 */
function bannerFor(outcome: ExecuteResult["outcome"], stderr = ""): string {
    const program = ".orders | length";
    const parsed = parseSteps(program, ROOT.type);
    if ("error" in parsed) throw new Error(parsed.error.message);
    const plan = planRun({
        view: "jq", header: { id: QUERY_HEADER_ID, name: COUNT.name, description: none, source: "orders", jq: none },
        query: parsed.query, checked: undefined, jqText: program, jqChecked: checkJq(program, ROOT.type, { root: true }),
    }, ROOT);
    const prepared = prepareQuery(plan.program, ROOT);
    if ("result" in prepared) throw new Error(`${program} does not check`);
    const result = queryResultOf(prepared.prepared, { outcome, stdout: "", stderr, stdoutTruncated: false, stderrTruncated: false, inputs: [] });
    const failure = runFailure({ status: "done", n: 1, plan, result, output: undefined, at: new Date(0), ms: 0, planned: undefined, pieces: undefined }, words);
    if (failure === undefined) throw new Error(`a run answered ${outcome.type} gave a result`);
    return `${failure.title}${failure.message}`;
}

describe("<Query.Builder> — a run that gives no result (#938 R4)", () => {
    test("the checker's problems, and a runtime error, are Not run", async () => {
        await h.mountBuilder();
        await openQuery(variant("saved", COUNT.name));
        await typeJq(".orders | map(.totl)");
        await run();
        expect(banners()).toEqual([expect.stringMatching(/^Not run — the checker found problemsunknown_field: \.totl is not a field of /)]);
        // The checker's problems stop the run: e3 was asked to run the query only as it opened.
        expect(h.oneShots()).toHaveLength(1);
        await typeJq(".orders | length | . % 0");
        await run();
        expect(banners()).toEqual([expect.stringMatching(/^Not run.*Division by zero/)]);
    });

    test("the size limit: a result over the call's 1 MB is too large, its weight as e3 measured it, and no result", async () => {
        await h.mountBuilder();
        await openQuery(variant("saved", COUNT.name));
        await typeJq("[range(0; 800000)] | tostring");
        await run();
        expect(banners()).toEqual([expect.stringMatching(/^The result is too large[\d.]+ MB is over the 1 MB limit\. Total or narrow the query\.$/)]);
        expect(footer().count).toBe("No result");
    });

    test("the time limit, a platform function the server lacks, and a failure the runner gave no words for, each worded from e3's answer", () => {
        expect(bannerFor(variant("timed_out", { ms: 30_000n }))).toBe("Stopped after 30 sNarrow the query, or ask for fewer rows.");
        // A runner that cannot find a platform function the data calls says so on stderr.
        expect(bannerFor(variant("failed", { exitCode: 1n }), "Error: Unknown platform function: sales_lookup\n"))
            .toBe("Not run — the query calls a function this server can't runIt needs sales_lookup.");
        // A failure the runner gave no words for is Not run, with its exit code.
        expect(bannerFor(variant("failed", { exitCode: 3n }))).toMatch(/^Not run.*exit code 3/);
    });

    test("a call that never reached the server, and one the server refused", async () => {
        // The network fails each try: e3's client tries again after a pause, a timer the harness's settle cannot see, so
        // the test waits for what the user sees then.
        const stop = h.e3.fail(isRun, "network");
        await h.mountBuilder();
        await openQuery(variant("saved", COUNT.name));
        await waitFor(() => expect(banners()).toEqual([`Couldn't reach the serverfetch failed: the test failed the network for POST /repos/default/workspaces/${h.workspace}/one-shot`]), { timeout: 10_000 });
        stop();
        h.e3.fail(isRun, { status: 403, type: "permission_denied" });
        await runKeys();
        expect(banners()).toEqual(["Not runAPI error: permission_denied"]);
    });
});

// ─── R5 ──────────────────────────────────────────────────────────────────────

describe("<Query.Builder> — the footer (#938 R5)", () => {
    test("the count in words and the fields; the run's number, time and duration; each data source read, with its hash on e3", async () => {
        await h.mountBuilder();
        await openQuery(variant("saved", TOP.name));
        const f = footer();
        expect([f.count, f.fields]).toEqual(["10 orders", "· order, customer, region, total, shipped"]);
        expect(f.run).toMatch(/^run #1 · \d{2}:\d{2} · \d+ ms$/);
        expect(f.reads).toBe(`reads customers #${await hashOf(ex.customers)} · orders #${await hashOf(ex.orders)}`);
    });

    test("a jq run cut at the call's most outputs says there are more", async () => {
        await h.mountBuilder();
        await openQuery(variant("saved", COUNT.name));
        await typeJq("range(0; 2000)");
        await run();
        expect(footer().count).toBe("1,000+ rows");
    });
});

// ─── R6 ──────────────────────────────────────────────────────────────────────

describe("<Query.Builder> — downloads (#938 R6)", () => {
    test("CSV: the rows, named after the query, a value with a comma quoted; BEAST2: the result with its type, a jq run's the bytes it returned", async () => {
        const saved: { name: string; blob: Blob }[] = [];
        let lastBlob: Blob | undefined;
        Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { lastBlob = blob; return "blob:result"; } });
        Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
        const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            saved.push({ name: this.download, blob: lastBlob! });
        });
        try {
            const answered = h.oneShotResults();
            await h.mountBuilder();
            await openQuery(variant("saved", TOP.name));
            for (const format of ["csv", "beast2"] as const) {
                await openMenu(document.querySelector<HTMLElement>("[data-query-download]")!);
                await pick(format);
            }
            expect(saved.map((s) => s.name)).toEqual(["top-shipped-orders-2026.csv", "top-shipped-orders-2026.beast2"]);
            const csv = await saved[0]!.blob.text();
            const [head, ...rows] = csv.split("\r\n");
            expect([head, rows.length]).toEqual(["order,customer,region,total,shipped", 10]);
            const expected = evaluateJq(DEFAULT_PROGRAM, FIXTURE_VALUE, { inputType: FixtureType, root: true }) as { order: bigint }[];
            expect(rows.map((r) => r.split(",")[0])).toEqual(expected.map((r) => `${r.order}`));
            const typed = decodeBeast2(new Uint8Array(await saved[1]!.blob.arrayBuffer()));
            const Row = StructType({ order: IntegerType });
            expect(fromEastTypeValue(typed.type).type).toBe("Array");
            expect(equalFor(ArrayType(Row))((typed.value as { order: bigint }[]).map((r) => ({ order: r.order })), expected.map((r) => ({ order: r.order })))).toBe(true);
            expect(banners()).toEqual(["Downloaded top-shipped-orders-2026.beast2 — the result as the run returned it, with its type."]);
            // The note's close is Font Awesome's xmark, named Close, and closes it (#1263).
            const note = document.querySelector<HTMLElement>("[data-query-strips] [role=status]")!;
            const close = within(note).getByRole("button", { name: "Close" });
            expect([markOf(close), foreignIcons(note)]).toEqual(["fas xmark", []]);
            await act(async () => { fireEvent.click(close); });
            expect(banners()).toEqual([]);
            // A text with a comma is quoted, RFC 4180's way; and a jq run's BEAST2 is the result the run returned, with its
            // type — e3 answers it in its stored form, and the download writes the same value at the same type.
            await typeJq(".orders[:2] | map({order: .id, note: \"big, shipped\"})");
            await run();
            for (const format of ["csv", "beast2"] as const) {
                await openMenu(document.querySelector<HTMLElement>("[data-query-download]")!);
                await pick(format);
            }
            expect((await saved[2]!.blob.text()).split("\r\n")).toEqual(["order,note", "1001,\"big, shipped\"", "1002,\"big, shipped\""]);
            const returned = answered().at(-1)!.outcome;
            if (returned.type !== "success") throw new Error("the jq run answered");
            const [downloaded, ran] = [decodeBeast2(new Uint8Array(await saved[3]!.blob.arrayBuffer())), decodeBeast2(returned.value.value)];
            const ranType = fromEastTypeValue(ran.type);
            expect(isTypeEqual(fromEastTypeValue(downloaded.type), ranType)).toBe(true);
            expect(equalFor(ranType)(downloaded.value as never, ran.value as never)).toBe(true);
        } finally {
            click.mockRestore();
            Reflect.deleteProperty(URL, "createObjectURL");
            Reflect.deleteProperty(URL, "revokeObjectURL");
        }
    });
});

// ─── R7 ──────────────────────────────────────────────────────────────────────

describe("<Query.Builder> — the Table and the Value tree (#938 R7)", () => {
    test("rows open as a Table, one value as a tree; the toolbar's switch overrides it until the next run", async () => {
        await h.mountBuilder();
        await openQuery(variant("saved", TOP.name));
        expect(shownAs()).toBe("table");
        expect(results().querySelector("table")).not.toBeNull();
        expect(resultButton("Table").getAttribute("aria-pressed")).toBe("true");
        await act(async () => { fireEvent.click(resultButton("Tree")); });
        await settle();
        expect([shownAs(), results().querySelector("table")]).toEqual(["tree", null]);
        await run();
        expect(shownAs()).toBe("table");
        await openQuery(variant("saved", COUNT.name));
        await waitFor(() => expect(shownAs()).toBe("tree"));
    });

    test("without a result the switch and Download are off", async () => {
        await h.mountBuilder();
        expect([resultButton("Table").hasAttribute("disabled"), (document.querySelector("[data-query-download]") as HTMLButtonElement).disabled]).toEqual([true, true]);
    });
});
