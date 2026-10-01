/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Runs and results (#938, `Query Editor Spec.md` §4.11, §7 R1–R8), through
 * `<Query.Builder>`'s carrier over a saved queries record in memory, each
 * call answered here as e3 answers it — its body run over the fixture's
 * datasets, pinned at their hashes:
 *
 * - **R1**: a run is one one-shot call over the root, the counting program in
 *   the visual view and the jq in the jq view; a new run abandons the old;
 *   opening a saved query runs it, an edit or a new query never does.
 * - **R2, R8**: a fresh visual run counts the shape lines — 40, 16, 16, 16, 16
 *   and 10 for the default query.
 * - **R3**: an edit makes the result stale — the banner, the dashed body, the
 *   shape lines plain again.
 * - **R4**: each way a run gives no result, worded.
 * - **R5**: the footer — the count, the fields, the run, what it read.
 * - **R6**: downloads — the CSV's text and name, the BEAST2's bytes.
 * - **R7**: the Table and the Value tree through the production renderers,
 *   picked by the result and overridden by the toolbar until the next run.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ArrayType, IntegerType, StructType, decodeBeast2, decodeEastIR, equalFor, evaluateJq, fromEastTypeValue, isTypeEqual, variant } from "@elaraai/east";
import { ApiError } from "@elaraai/e3-api-client";
import type { ExecuteResult } from "@elaraai/e3-types";
import type { QueryCall } from "./hooks.js";
import {
    FIXTURE_VALUE, FixtureType, fixtureCall, mountBuilder, offlineCall, openQuery, press, recordHarness, savedQuery, savedRecord, settle,
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
const BIG = savedQuery("Big orders", ".orders\n| map(select(.total >= 1000))");
const COUNT = savedQuery("Order count", ".orders | length");

beforeEach(() => {
    recordHarness(savedRecord([TOP, BIG, COUNT]));
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

// ─── What the results show ───────────────────────────────────────────────────

/** The results region. */
const results = () => document.querySelector<HTMLElement>("[data-query-results]")!;
/** The footer's parts: the count, the fields, the run's line and what it read. */
function footer() {
    const el = results().querySelector<HTMLElement>("[data-query-results-footer]")!;
    const text = (sel: string) => el.querySelector(sel)?.textContent ?? "";
    return { count: text("[data-query-result-count]"), fields: text("[data-query-result-fields]"), run: text("[data-query-result-run]"), reads: text("[data-query-result-reads]") };
}
/** The banners at the top of the results: each title, and the words under it. */
const banners = () => [...results().querySelectorAll<HTMLElement>("[role=alert], [role=status]")].map((b) => b.textContent ?? "");
/** The shape lines' words, in order. */
const shapes = () => [...document.querySelectorAll<HTMLElement>("[data-query-shape-text]")].map((el) => el.textContent);
/** How the result shows: `table`, `tree`, or none. */
const shownAs = () => results().querySelector("[data-query-results-view]")?.getAttribute("data-query-results-view") ?? null;
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
        const fixture = fixtureCall({ hold: true });
        await mountBuilder(fixture.call);
        expect([fixture.requests.length, results().querySelector("[data-query-results-idle]") !== null, footer().count]).toEqual([0, true, "No result yet"]);
        await openQuery(variant("saved", TOP.name));
        expect(fixture.requests).toHaveLength(1);
        expect(results().querySelector("[data-query-results-running]")!.textContent).toBe("Reading customers and orders");
        expect([footer().count, document.querySelector("[data-query-run]")!.textContent]).toEqual(["Running…", "Running"]);
        await fixture.release();
        expect(shownAs()).toBe("table");
        // The run that answered is this viewer's most recent query, by its name.
        await waitFor(() => expect(localStorage.getItem("query.builder.recent") ?? "").toContain("Top shipped orders, 2026"));
        await press("Keep the first", document.querySelector<HTMLElement>("[data-query-foot]")!);
        expect(fixture.requests).toHaveLength(1);
    }, 30_000);

    test("the visual view sends the counting program; the jq view the jq, canonically", async () => {
        const fixture = fixtureCall();
        await mountBuilder(fixture.call);
        await openQuery(variant("saved", BIG.name));
        const counting = answers(fixture.requests[0]!.bodyIr);
        expect(counting.type === "Struct" && Object.keys(counting.fields)).toEqual(["counts", "result"]);
        await typeJq(".orders   |   length");
        await run();
        expect(isTypeEqual(answers(fixture.requests[1]!.bodyIr), IntegerType)).toBe(true);
        // One value is counted in its shape's words.
        expect(footer().count).toBe("One whole number");
    }, 30_000);

    test("a new run abandons the one before: only the last one's answer shows, however late the others answer", async () => {
        const fixture = fixtureCall({ hold: true });
        await mountBuilder(fixture.call);
        await openQuery(variant("saved", COUNT.name));
        await runKeys();
        await runKeys();
        expect(fixture.requests).toHaveLength(3);
        // The last run answers first; the two it abandoned answer after it, and change nothing.
        await fixture.release({ newestFirst: true });
        expect(footer().run).toMatch(/^run #3 · /);
    }, 30_000);
});

// ─── R2, R3, R8 ──────────────────────────────────────────────────────────────

describe("<Query.Builder> — counted shape lines and staleness (#938 R2, R3, R8)", () => {
    test("R8: after a fresh run the default query's shape lines read 40, 16, 16, 16, 16 and 10", async () => {
        await mountBuilder(fixtureCall().call);
        await openQuery(variant("saved", TOP.name));
        expect(shapes()).toEqual([
            "40 orders",
            "16 shipped orders",
            "16 shipped orders+ name, region",
            "16 ordersorder, customer, region, total, shipped",
            "16 orders",
            "10 orders",
        ]);
    }, 30_000);

    test("R3: an edit makes the result stale — the banner with Run again, the body dashed, the shape lines plain — and Run again freshens it", async () => {
        await mountBuilder(fixtureCall().call);
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
    }, 30_000);
});

// ─── R4 ──────────────────────────────────────────────────────────────────────

/** A call that answers every request with one outcome, and what the runner said on stderr, as e3 does. */
function answering(outcome: ExecuteResult["outcome"], stderr = ""): QueryCall {
    return async () => ({ outcome, stdout: "", stderr, stdoutTruncated: false, stderrTruncated: false, inputs: [] });
}

describe("<Query.Builder> — a run that gives no result (#938 R4)", () => {
    test("the checker's problems, and a runtime error, are Not run", async () => {
        const fixture = fixtureCall();
        await mountBuilder(fixture.call);
        await openQuery(variant("saved", COUNT.name));
        await typeJq(".orders | map(.totl)");
        await run();
        expect(banners()).toEqual([expect.stringMatching(/^Not run — the checker found problemsunknown_field: \.totl is not a field of /)]);
        expect(fixture.requests).toHaveLength(1);
        await typeJq(".orders | length | . % 0");
        await run();
        expect(banners()).toEqual([expect.stringMatching(/^Not run.*Division by zero/)]);
    }, 30_000);

    test("the time limit, the size limit and a platform function the server lacks", async () => {
        const cases: readonly (readonly [ExecuteResult["outcome"], string])[] = [
            [variant("timed_out", { ms: 30_000n }), "Stopped after 30 sNarrow the query, or ask for fewer rows."],
            [variant("too_large", { bytes: 1_468_006n, limit: 1_048_576n }), "The result is too large1.4 MB is over the 1 MB limit. Total or narrow the query."],
        ];
        for (const [outcome, banner] of cases) {
            await mountBuilder(answering(outcome));
            await openQuery(variant("saved", COUNT.name));
            expect(banners()).toEqual([banner]);
            expect(footer().count).toBe("No result");
            cleanup();
        }
        // A runner that cannot find a platform function the data calls says so on stderr.
        await mountBuilder(answering(variant("failed", { exitCode: 1n }), "Error: Unknown platform function: sales_lookup\n"));
        await openQuery(variant("saved", COUNT.name));
        expect(banners()).toEqual(["Not run — the query calls a function this server can't runIt needs sales_lookup."]);
        cleanup();
        // A failure the runner gave no words for is Not run, with its exit code.
        await mountBuilder(answering(variant("failed", { exitCode: 3n })));
        await openQuery(variant("saved", COUNT.name));
        expect(banners()).toEqual([expect.stringMatching(/^Not run.*exit code 3/)]);
    }, 30_000);

    test("a call that never reached the server, and one the server refused", async () => {
        await mountBuilder(offlineCall().call);
        await openQuery(variant("saved", COUNT.name));
        expect(banners()).toEqual(["Couldn't reach the serveroffline"]);
        cleanup();
        await mountBuilder(async () => { throw new ApiError("permission_denied"); });
        await openQuery(variant("saved", COUNT.name));
        expect(banners()).toEqual(["Not runAPI error: permission_denied"]);
    }, 30_000);
});

// ─── R5 ──────────────────────────────────────────────────────────────────────

describe("<Query.Builder> — the footer (#938 R5)", () => {
    test("the count in words and the fields; the run's number, time and duration; each data source read, with its hash", async () => {
        await mountBuilder(fixtureCall().call);
        await openQuery(variant("saved", TOP.name));
        const f = footer();
        expect([f.count, f.fields]).toEqual(["10 orders", "· order, customer, region, total, shipped"]);
        expect(f.run).toMatch(/^run #1 · \d{2}:\d{2} · \d+ ms$/);
        expect(f.reads).toBe("reads customers #9b07e3a4 · orders #4f2a1c8d");
    }, 30_000);

    test("a jq run cut at the call's most outputs says there are more", async () => {
        await mountBuilder(fixtureCall().call);
        await openQuery(variant("saved", COUNT.name));
        await typeJq("range(0; 2000)");
        await run();
        expect(footer().count).toBe("1,000+ rows");
    }, 30_000);
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
            const fixture = fixtureCall();
            await mountBuilder(fixture.call);
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
            // A text with a comma is quoted, RFC 4180's way; and a jq run's BEAST2 is the bytes the run returned.
            await typeJq(".orders[:2] | map({order: .id, note: \"big, shipped\"})");
            await run();
            for (const format of ["csv", "beast2"] as const) {
                await openMenu(document.querySelector<HTMLElement>("[data-query-download]")!);
                await pick(format);
            }
            expect((await saved[2]!.blob.text()).split("\r\n")).toEqual(["order,note", "1001,\"big, shipped\"", "1002,\"big, shipped\""]);
            const returned = fixture.answers.at(-1)!.outcome;
            if (returned.type !== "success") throw new Error("the jq run answered");
            expect(new Uint8Array(await saved[3]!.blob.arrayBuffer())).toEqual(returned.value.value);
        } finally {
            click.mockRestore();
            Reflect.deleteProperty(URL, "createObjectURL");
            Reflect.deleteProperty(URL, "revokeObjectURL");
        }
    }, 30_000);
});

// ─── R7 ──────────────────────────────────────────────────────────────────────

describe("<Query.Builder> — the Table and the Value tree (#938 R7)", () => {
    test("rows open as a Table, one value as a tree; the toolbar's switch overrides it until the next run", async () => {
        await mountBuilder(fixtureCall().call);
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
    }, 30_000);

    test("without a result the switch and Download are off", async () => {
        await mountBuilder(offlineCall().call);
        expect([resultButton("Table").hasAttribute("disabled"), (document.querySelector("[data-query-download]") as HTMLButtonElement).disabled]).toEqual([true, true]);
    }, 30_000);
});
