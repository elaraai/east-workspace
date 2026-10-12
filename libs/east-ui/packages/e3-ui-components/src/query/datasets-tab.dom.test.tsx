/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The builder's Datasets tab (#939, `Query Editor Spec.md` §4.9, §7 D1–D2),
 * through `<Query.Builder>`'s carrier over the fixture's orders and customers:
 *
 * - **D1**: the bound data sources as a `Library`, grouped by kind with their
 *   counts, each its kind's icon and its name; with an e3 server, its size and
 *   hash from the dataset's status; Source and Looked up where the open query
 *   reads it.
 * - **D2**: a click starts a new query on it — not run, with its notice — and
 *   the query that was open keeps its drafts; ⌘/ opens the tab.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@elaraai/e3-api-client")>()),
    datasetGetStatus: vi.fn(),
}));

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { IntegerType, equalFor, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { datasetGetStatus } from "@elaraai/e3-api-client";
import { TreePathType, pathToString } from "@elaraai/e3-types";
import { formatters } from "@elaraai/east-ui-components";
import { queryWords } from "./model/words.js";
import { sourceKind, sourceSize } from "./datasets-tab.js";
import {
    act, CUSTOMERS, CustomersType, HASHES, ORDERS, OrdersType, fixtureCall, mountBuilder, openQuery, press, recordHarness, savedQuery, savedRecord, settle,
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

const samePath = equalFor(TreePathType);
const words = queryWords(formatters("en-US"));

beforeEach(() => {
    recordHarness(savedRecord([TOP]));
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.mocked(datasetGetStatus).mockReset();
});

// ─── What the tab shows ──────────────────────────────────────────────────────

/** The Datasets tab. */
const tab = () => document.querySelector<HTMLElement>("[data-query-tab=datasets]")!;
/** Shows a tab of the pane. */
async function show(name: "Query" | "Datasets" | "Library") {
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name })); });
    await settle();
}
/** The tab's groups, each its head's label and count, in order: the Library's scroller holds a group per head. */
const groups = () => [...tab().querySelector("[data-library] > [data-scrollable]")!.children]
    .map((group) => [...group.firstElementChild!.children].map((span) => span.textContent));
/** The tab's cards. */
const cards = () => [...tab().querySelectorAll<HTMLElement>("[role=button][data-clickable]")];
/** A card by its name. */
const card = (name: string) => cards().find((c) => within(c).queryByText(name, { exact: true }) !== null)!;
/** A card's icon. */
const iconOf = (c: HTMLElement) => c.querySelector("svg[data-icon]")?.getAttribute("data-icon");
/** A card's trailing glyph — the named image; the icon tile's is not named — what it says, and whether the card is placed. */
const roleOf = (c: HTMLElement) => [c.querySelector("[role=img][aria-label]")?.getAttribute("aria-label") ?? null, c.hasAttribute("data-placed")];

// ─── D1 ──────────────────────────────────────────────────────────────────────

describe("the builder's Datasets tab (#939 D1)", () => {
    test("a data source's kind and its size in words: a list's or a lookup table's count, a tree, a record, a calculation's inputs", () => {
        expect([sourceKind(OrdersType), sourceKind(CustomersType)]).toEqual([{ kind: "rows", icon: "table-list" }, { kind: "lookups", icon: "key" }]);
        expect([sourceSize("orders", OrdersType, 40, words), sourceSize("orders", OrdersType, 1, words), sourceSize("customers", CustomersType, 8, words)])
            .toEqual(["40 orders", "1 order", "8 customers by ID"]);
        // Not counted yet: nothing said.
        expect(sourceSize("orders", OrdersType, undefined, words)).toBe("");
        expect(sourceSize("total", IntegerType, undefined, words)).toBe("whole number");
    });

    test("the bound data sources, grouped by kind with their counts, each its kind's icon and its name; with no e3 server, nothing fetched", async () => {
        await mountBuilder(fixtureCall().call);
        await show("Datasets");
        expect(groups()).toEqual([["Rows", "1"], ["Lookups", "1"]]);
        expect(cards().map((c) => [c.textContent, iconOf(c)])).toEqual([["orders", "table-list"], ["customers", "key"]]);
        expect(datasetGetStatus).not.toHaveBeenCalled();
    }, 30_000);

    test("with an e3 server, each data source's size and hash from its status", async () => {
        vi.mocked(datasetGetStatus).mockImplementation(async (_url, _repo, _workspace, path) => {
            const orders = samePath(path, ORDERS);
            return {
                path: pathToString(path),
                type: toEastTypeValue(orders ? OrdersType : CustomersType),
                refType: "value",
                hash: some(HASHES.get(orders ? "orders" : "customers")!),
                size: some(4096n),
                segments: none,
                rows: some(orders ? 40n : 8n),
            };
        });
        await mountBuilder(fixtureCall().call, { e3: { apiUrl: "http://e3.test", workspace: "query-builder-test" } });
        await show("Datasets");
        await settle();
        expect(cards().map((c) => c.textContent)).toEqual(["orders40 orders · #4f2a1c8d", "customers8 customers by ID · #9b07e3a4"]);
        const asked = vi.mocked(datasetGetStatus).mock.calls.map(([, , workspace, path]) => [workspace, pathToString(path)]);
        expect(asked).toEqual(expect.arrayContaining([["query-builder-test", pathToString(ORDERS)], ["query-builder-test", pathToString(CUSTOMERS)]]));
    }, 30_000);

    test("Source and Looked up where the open query reads a data source, the card placed", async () => {
        await mountBuilder(fixtureCall().call);
        await show("Datasets");
        // A new query on orders reads orders alone.
        expect([roleOf(card("orders")), roleOf(card("customers"))]).toEqual([["Source", true], [null, false]]);
        await openQuery(variant("saved", TOP.name));
        await show("Datasets");
        expect([roleOf(card("orders")), roleOf(card("customers"))]).toEqual([["Source", true], ["Looked up", true]]);
    }, 30_000);
});

// ─── D2 ──────────────────────────────────────────────────────────────────────

describe("the builder's Datasets tab (#939 D2)", () => {
    test("a click starts a new query on the data source, not run, with its notice; the query that was open keeps its drafts", async () => {
        const fixture = fixtureCall();
        const { container } = await mountBuilder(fixture.call);
        await openQuery(variant("saved", TOP.name));
        const ran = fixture.requests.length;
        await press("Keep the first", container.querySelector<HTMLElement>("[data-query-foot]")!);
        expect(container.querySelectorAll("[data-step-id]")).toHaveLength(6);
        await show("Datasets");
        await act(async () => { fireEvent.click(card("customers")); });
        await settle();
        const builder = container.querySelector<HTMLElement>("[data-query-builder]")!;
        expect(builder.getAttribute("data-query-open")).toMatch(/^query\.new:/);
        expect(screen.getByRole("tab", { name: "Query" }).getAttribute("aria-selected")).toBe("true");
        expect(container.querySelector("[data-query-source]")!.textContent).toMatch(/^Start with customers/);
        expect(container.querySelector("[data-query-tab=query] [role=status]")!.textContent).toBe("Started a new query on customers.");
        expect(fixture.requests).toHaveLength(ran);
        // The query that was open: its drafts as they were.
        await openQuery(variant("saved", TOP.name));
        expect(container.querySelectorAll("[data-step-id]")).toHaveLength(6);
    }, 30_000);

    test("⌘/ opens the Datasets tab, the pane expanded", async () => {
        const { container } = await mountBuilder(fixtureCall().call);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Query" })); });
        await settle();
        await act(async () => { fireEvent.keyDown(container.querySelector<HTMLElement>("[data-query-builder]")!, { key: "/", ctrlKey: true }); });
        await settle();
        expect(container.querySelector("[data-query-builder] [data-collapsed]")).toBeNull();
        expect(screen.getByRole("tab", { name: "Datasets" }).getAttribute("aria-selected")).toBe("true");
    }, 30_000);
});
