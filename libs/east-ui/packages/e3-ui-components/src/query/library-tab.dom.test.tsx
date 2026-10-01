/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The builder's Library tab (#939, `Query Editor Spec.md` §4.10, §7 D3–D4),
 * through `<Query.Builder>`'s carrier over a saved queries record in memory and
 * this viewer's recent runs:
 *
 * - **D3**: Recent, then the saved queries by the data source they start from,
 *   each by name, with its description — the author's, else the generated
 *   sentence; a click opens a query, which runs, with its notice — a saved
 *   query as itself, a recent run never saved as a new query begun as it, a
 *   recent run of a saved query as the saved query; the open query placed.
 * - **D4**: a query whose data sources aren't bound here carries its reason,
 *   in the warning tone, and a click says so instead of opening.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { SavedQueryType, queryKeys } from "@elaraai/e3-ui/internal";
import { TreePathType, pathToString } from "@elaraai/e3-types";
import { CUSTOMERS, fixtureCall, mountBuilder, recordHarness, savedQuery, savedRecord, settle } from "./query.test-utils.js";

type TreePath = ValueTypeOf<typeof TreePathType>;

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
const BIG = savedQuery("Big orders", ".orders\n| map(select(.total >= 1000))", some("Orders of 1,000 or more."));
/** A saved query that reads a data source under a name no binding here has. */
const MISSING = { ...savedQuery("Customers by region", ".customers\n| length"), root: [{ name: "regions", path: CUSTOMERS }] };
/** One that reads orders at another path. */
const ARCHIVE: TreePath = [variant("field", "inputs"), variant("field", "archive"), variant("field", "orders")];
const ELSEWHERE = { ...savedQuery("Archived orders", ".orders\n| length"), root: [{ name: "orders", path: ARCHIVE }] };
/** A run of this viewer's, never saved. */
const CANCELLED = savedQuery("Cancelled orders", ".orders\n| map(select(.status.type == \"cancelled\"))\n| length");

const printSaved = printFor(SavedQueryType);

/** This viewer's recent runs, the most recent first, as the builder keeps them in the browser. */
function remember(...runs: ValueTypeOf<typeof SavedQueryType>[]) {
    localStorage.setItem(queryKeys(undefined).recent, JSON.stringify(runs.map((run) => printSaved(run))));
}

beforeEach(() => {
    recordHarness(savedRecord([TOP, BIG, MISSING, ELSEWHERE]));
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

// ─── What the tab shows ──────────────────────────────────────────────────────

/** The Library tab. */
const tab = () => document.querySelector<HTMLElement>("[data-query-tab=library]")!;
/** Shows a tab of the pane. */
async function show(name: "Query" | "Datasets" | "Library") {
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name })); });
    await settle();
}
/** The tab's groups, each its head's label and its cards' names, in order. */
const groups = () => [...tab().querySelector("[data-library] > [data-scrollable]")!.children].map((group) => [
    group.firstElementChild!.firstElementChild!.textContent,
    [...group.querySelectorAll<HTMLElement>("[role=button][data-clickable]")].map((c) => c.firstElementChild!.nextElementSibling!.firstElementChild!.textContent),
]);
/** The tab's cards. */
const cards = () => [...tab().querySelectorAll<HTMLElement>("[role=button][data-clickable]")];
/** A card by its name: the first of that name, a recent run's before a saved query's. */
const card = (name: string) => cards().find((c) => within(c).queryByText(name, { exact: true }) !== null)!;
/** A card's description, under its name. */
const descriptionOf = (c: HTMLElement) => c.firstElementChild!.nextElementSibling!.children[1]?.textContent ?? null;
/** A card's trailing glyph: what it says, and its tone. */
const glyphOf = (c: HTMLElement) => {
    const glyph = c.querySelector("[role=img][aria-label]");
    return glyph === null ? null : [glyph.getAttribute("aria-label"), glyph.getAttribute("data-tone")];
};
/** Clicks a card. */
async function pick(c: HTMLElement) {
    await act(async () => { fireEvent.click(c); });
    await settle();
}
/** The open query, as the builder names its session. */
const openQueryId = () => document.querySelector("[data-query-builder]")!.getAttribute("data-query-open");
/** The Query tab's notices. */
const notices = () => [...document.querySelectorAll("[data-query-tab=query] [role=status]")].map((n) => n.textContent);

// ─── D3 ──────────────────────────────────────────────────────────────────────

describe("the builder's Library tab (#939 D3)", () => {
    test("Recent first, then the saved queries by the data source they start from, each by name, with the author's description or the generated sentence", async () => {
        remember(CANCELLED);
        await mountBuilder(fixtureCall().call);
        await show("Library");
        expect(groups()).toEqual([
            ["Recent", ["Cancelled orders"]],
            ["From customers", ["Customers by region"]],
            ["From orders", ["Archived orders", "Big orders", "Top shipped orders, 2026"]],
        ]);
        expect([descriptionOf(card("Cancelled orders")), descriptionOf(card("Big orders")), descriptionOf(card("Archived orders"))])
            .toEqual(["Count of orders where status is cancelled.", "Orders of 1,000 or more.", "Count of orders."]);
        expect(descriptionOf(card("Top shipped orders, 2026"))).toMatch(/^Top 10 orders by total where status is shipped/);
    }, 30_000);

    test("a click opens a saved query, which runs, with its notice; the open query is placed", async () => {
        const fixture = fixtureCall();
        await mountBuilder(fixture.call);
        await show("Library");
        await pick(card("Big orders"));
        expect(openQueryId()).toBe(`query.saved:"Big orders"`);
        expect(screen.getByRole("tab", { name: "Query" }).getAttribute("aria-selected")).toBe("true");
        expect(notices()).toEqual(["Opened “Big orders” from the library."]);
        expect(fixture.requests).toHaveLength(1);
        await show("Library");
        expect([card("Big orders").hasAttribute("data-placed"), card("Top shipped orders, 2026").hasAttribute("data-placed")]).toEqual([true, false]);
    }, 30_000);

    test("a recent run never saved opens as a new query begun as it, which runs; a recent run of a saved query opens the saved query", async () => {
        remember(CANCELLED, { ...BIG, saved_at: new Date(Date.UTC(2026, 9, 1, 8, 0)) });
        const fixture = fixtureCall();
        const { container } = await mountBuilder(fixture.call);
        await show("Library");
        await pick(card("Cancelled orders"));
        expect(openQueryId()).toMatch(/^query\.new:/);
        expect([...container.querySelectorAll("[data-step-id]")].map((s) => s.getAttribute("aria-label"))).toEqual(["Keep rows where", "Count the rows"]);
        expect(container.querySelector("[data-query-status] [data-query-name]")!.textContent).toBe("Cancelled orders");
        expect(notices()).toEqual(["Opened “Cancelled orders” from the library."]);
        expect(fixture.requests).toHaveLength(1);
        await show("Library");
        expect(card("Cancelled orders").hasAttribute("data-placed")).toBe(true);
        // The recent run of Big orders is its saved query.
        const recentBig = cards().filter((c) => within(c).queryByText("Big orders", { exact: true }) !== null)[0]!;
        await pick(recentBig);
        expect(openQueryId()).toBe(`query.saved:"Big orders"`);
    }, 30_000);
});

// ─── D4 ──────────────────────────────────────────────────────────────────────

describe("the builder's Library tab (#939 D4)", () => {
    test("a query whose data sources aren't bound here carries its reason in the warning tone, and a click says so instead of opening", async () => {
        const fixture = fixtureCall();
        await mountBuilder(fixture.call);
        await show("Library");
        expect([glyphOf(card("Customers by region")), glyphOf(card("Archived orders")), glyphOf(card("Big orders"))]).toEqual([
            ["Reads regions, which isn't here", "warning"],
            [`Reads ${pathToString(ARCHIVE)}, not this builder's orders`, "warning"],
            null,
        ]);
        const before = openQueryId();
        await pick(card("Customers by region"));
        expect(tab().querySelector("[data-query-library-notice]")!.textContent).toBe("Reads regions, which isn't here");
        expect([openQueryId(), fixture.requests.length]).toEqual([before, 0]);
    }, 30_000);
});
