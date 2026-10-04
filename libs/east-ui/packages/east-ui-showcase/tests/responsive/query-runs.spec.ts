/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The query builder's runs on the e3 the page runs (#1132), measured in a real
 * browser. Nothing stands in for e3: each run is a one-shot call or a split
 * call that e3-web runs on the page's workers, its pieces cut by e3 at the
 * showcase's piece size (`showcase-pieces.ts`):
 *
 * - a saved query over the fixture's small datasets runs as one call, its
 *   dataset within one piece;
 * - the order history the query examples' tasks generate — 36,000 orders, the
 *   20,000 accounts that place them and their credit limits — runs larger:
 *   revenue by region joins the history with the accounts, both more than one
 *   piece, and re-keys it as two split calls; revenue by month runs as one
 *   split call over the history's pieces; and credit by region joins the
 *   accounts with their credit limits, keyed alike, cut at the same keys.
 *
 * Each run's answer is the one East's own query engine (`evaluateJq`) gives
 * over the same data, generated here by the examples' own functions. Every
 * measurement is polled until it holds, never read after a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test query-runs --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { East, IntegerType, StructType, evaluateJq, isVariant, printJq, printFor, type EastType } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import { settled } from "./settle";

const FIXTURE = "e3/query/query/queryBuilder";
const HISTORY = "e3/query/query/queryBuilderHistory";

const printInteger = printFor(IntegerType);

/** An input's value, as the example seeds it. */
function seedOf<T>(def: { readonly name: string; readonly source?: { readonly type: string; readonly value?: unknown } }): T {
    if (def.source?.type !== "value") throw new Error(`${def.name} is seeded with a value`);
    return def.source.value as T;
}

/** The fixture's datasets the builder binds, as their examples seed them. */
const FIXTURE_ROOT = StructType({ orders: ex.orders.type, customers: ex.customers.type });
const FIXTURE_DATA = { orders: seedOf(ex.orders), customers: seedOf(ex.customers) };

/** The order history's datasets, generated from the examples' counts by the examples' own functions, as the showcase's dataflow generates them. */
const HISTORY_ROOT = StructType({ order_history: ex.historyTask.output.type, accounts: ex.accountsTask.output.type, credit: ex.creditTask.output.type });
const HISTORY_DATA = (() => {
    const count = seedOf<bigint>(ex.historyCount);
    const accountCount = seedOf<bigint>(ex.accountCount);
    return {
        order_history: East.compile(ex.generateHistory, [])(count, accountCount),
        accounts: East.compile(ex.generateAccounts, [])(accountCount),
        credit: East.compile(ex.generateCredit, [])(accountCount),
    };
})();

/** A saved query's program, as its record holds it. */
function programOf(record: typeof ex.queries.default, name: string): string {
    const saved = record?.get(name);
    if (saved === undefined) throw new Error(`no saved query ${name}`);
    return printJq(saved.program).text;
}

/** A text cell as the results' Table shows it: a string as it is, an option's value, or "—" for none. */
function textCell(value: unknown): string {
    if (isVariant(value)) return value.type === "some" ? textCell(value.value) : "—";
    return value as string;
}

/** What a saved query answers over its data, as East's query engine runs it: each row's first field's text and its last, an Integer, as the Table prints them. */
function answerOf(record: typeof ex.queries.default, name: string, root: EastType, data: unknown): string[][] {
    const rows = evaluateJq(programOf(record, name), data, { inputType: root, root: true }) as Record<string, unknown>[];
    return rows.map((row) => {
        const fields = Object.values(row);
        return [textCell(fields[0]), printInteger(fields.at(-1) as bigint)];
    });
}

/**
 * Opens an example's builder and returns it once it has run the saved query it
 * opens on, set to the mock's width, 1240px, as the builder's own spec sets it:
 * there its pane is pinned beside the results, its tabs shown.
 */
async function openBuilder(page: Page, hash: string): Promise<Locator> {
    await page.goto(`/?theme=light#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await settled(page);
    const builder = entry.locator("[data-query-builder]").first();
    await expect(builder.locator("[data-query-results-view]")).toBeVisible({ timeout: 60_000 });
    await builder.evaluate((root) => { (root as HTMLElement).style.width = "1240px"; });
    await settled(page);
    return builder;
}

/** The results' rows: each row's first cell and its last. */
function rowsOf(builder: Locator): Promise<string[][]> {
    return builder.evaluate((root) => [...root.querySelectorAll("[data-query-results] tbody tr")].map((tr) => {
        const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "");
        return [cells[0] ?? "", cells.at(-1) ?? ""];
    }));
}

/** The plan's explanation, a line per sentence, as its popover shows it once the read-out is pressed. */
async function explanationOf(page: Page, builder: Locator): Promise<string[]> {
    await builder.locator("[data-query-result-plan]").click();
    const lines = page.locator("[data-query-plan-line]");
    await expect(lines.first()).toBeVisible();
    const text = await lines.evaluateAll((items) => items.map((li) => li.querySelector("span")?.textContent ?? ""));
    await page.keyboard.press("Escape");
    return text;
}

/** How many pieces a split run cut, once its read-out says: the run's own count, from e3. */
async function piecesOf(builder: Locator, word: string): Promise<number> {
    const plan = builder.locator("[data-query-result-plan]");
    const pattern = new RegExp(`^${word} · (\\d+) pieces$`);
    await expect(plan).toHaveText(pattern, { timeout: 60_000 });
    return Number(pattern.exec((await plan.textContent()) ?? "")![1]);
}

/** The number of the run the results show, from the footer's run line — `run #3 · 14:02 · 412 ms` — which a run has once it has answered; 0 before. */
function runNumber(builder: Locator): Promise<number> {
    return builder.evaluate((root) => {
        const line = root.querySelector("[data-query-result-run]")?.textContent ?? "";
        const n = /^run #(\d+) · /.exec(line)?.[1];
        return n === undefined ? 0 : Number(n);
    });
}

/**
 * Opens a saved query from the builder's Library tab, and waits for the run
 * opening it starts to answer: the run after the one the results showed. The
 * tab lists a saved query's card under each dataset it reads, by its name.
 */
async function openSaved(builder: Locator, name: string): Promise<void> {
    const before = await runNumber(builder);
    await builder.getByRole("tab", { name: "Library" }).click();
    const card = builder.locator("[data-query-tab=library] [role=button][data-clickable]", { has: builder.page().getByText(name, { exact: true }) });
    await card.first().click();
    await expect(builder.locator("[data-query-status] [data-query-name]")).toHaveText(name);
    await expect.poll(() => runNumber(builder), { timeout: 60_000 }).toBeGreaterThan(before);
    await expect(builder.locator("[data-query-results-view]")).toBeVisible({ timeout: 60_000 });
}

test.describe("the query builder's runs, on the e3 the page runs (#1132)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "run once, at the desktop width");

    test("a saved query over the fixture runs as one call — its dataset within one of e3's pieces — and answers as East's query engine does", async ({ page }) => {
        const builder = await openBuilder(page, FIXTURE);
        const plan = builder.locator("[data-query-result-plan]");
        await expect(plan).toHaveAttribute("data-query-result-plan", "one_shot");
        await expect(plan).toHaveText("One call");
        expect((await explanationOf(page, builder))[0]).toMatch(/^One call: orders weighs [\d.]+ KB, within one piece \(16 KB\)\.$/);
        // Top shipped orders, 2026: the ten orders' ids, as the Table prints an Integer.
        const top = evaluateJq(programOf(ex.queries.default, "Top shipped orders, 2026"), FIXTURE_DATA, { inputType: FIXTURE_ROOT, root: true }) as { order: bigint }[];
        await expect.poll(async () => (await rowsOf(builder)).map(([first]) => first)).toEqual(top.map((row) => printInteger(row.order)));
    });

    test("the order history: a join with the accounts, both more than one piece, re-keyed as two split calls; revenue by month split over the history's pieces; credit by region cut at the same keys as the accounts — each answering as East's query engine does", async ({ page }) => {
        test.setTimeout(240_000);
        const record = ex.historyQueries.default;

        // The example opens on History revenue by region: the history joined with the accounts, re-keyed.
        const builder = await openBuilder(page, HISTORY);
        await expect(builder.locator("[data-query-result-plan]")).toHaveAttribute("data-query-result-plan", "rekey");
        expect(await piecesOf(builder, "Re-keyed join")).toBeGreaterThan(1);
        expect(await explanationOf(page, builder)).toContain("Re-key: both sides large and unaligned — accounts weighs more than one piece too.");
        await expect.poll(() => rowsOf(builder)).toEqual(answerOf(record, "History revenue by region", HISTORY_ROOT, HISTORY_DATA));

        // History revenue by month: one split call over the history's pieces, its months in order.
        await openSaved(builder, "History revenue by month");
        await expect(builder.locator("[data-query-result-plan]")).toHaveAttribute("data-query-result-plan", "split");
        expect(await piecesOf(builder, "Split call")).toBeGreaterThan(1);
        expect((await explanationOf(page, builder))[0]).toMatch(/^Split call over order_history: it weighs [\d.]+ (KB|MB), more than one piece \(16 KB\)\.$/);
        // The Table mounts the rows its frame shows: the first months, in order.
        const months = answerOf(record, "History revenue by month", HISTORY_ROOT, HISTORY_DATA);
        await expect.poll(async () => {
            const rows = await rowsOf(builder);
            return rows.length > 0 && rows.every((row, i) => months[i]?.[0] === row[0] && months[i]?.[1] === row[1]);
        }).toBe(true);

        // Credit by region: the accounts and their credit limits, keyed alike, cut at the same keys.
        await openSaved(builder, "Credit by region");
        await expect(builder.locator("[data-query-result-plan]")).toHaveAttribute("data-query-result-plan", "split");
        expect(await piecesOf(builder, "Split call")).toBeGreaterThan(1);
        expect(await explanationOf(page, builder)).toContain("Credit is cut at the same keys as accounts: each piece reads only its own keys of it.");
        await expect.poll(() => rowsOf(builder)).toEqual(answerOf(record, "Credit by region", HISTORY_ROOT, HISTORY_DATA));
    });
});
