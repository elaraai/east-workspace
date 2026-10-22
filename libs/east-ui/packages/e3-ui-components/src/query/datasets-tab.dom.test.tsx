/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The builder's Datasets tab (#939, `Query Editor Spec.md` §4.9, §7 D1–D2),
 * through `<Query.Builder>`'s carrier over the query examples' orders and
 * customers on e3 (#1376):
 *
 * - **D1**: the bound data sources as a `Library`, grouped by kind with their
 *   counts, each its kind's icon and its name, its size and hash from the
 *   dataset's status on e3; with no e3 server, the tab alone fetches nothing,
 *   and an item says only what its type says; Source and Looked up where the
 *   open query reads it.
 * - **D2**: a click starts a new query on it — not run, with its notice — and
 *   the query that was open keeps its drafts; ⌘/ opens the tab.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { IntegerType, variant } from "@elaraai/east";
import { formatters, system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import { queryWords } from "./model/words.js";
import { DatasetsTab, sourceKind, sourceSize } from "./datasets-tab.js";
import { CustomersType, OrdersType, ROOT, savedQuery } from "./fixture.test-utils.js";
import type { E3Dataset } from "../e3-web.test-utils.js";
import { act, openQuery, press, queryHarness, settle } from "./query.test-utils.js";

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

const words = queryWords(formatters("en-US"));

const h = queryHarness();

beforeEach(async () => {
    await h.seed([TOP]);
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
const groups = (root: HTMLElement = tab()) => [...root.querySelector("[data-library] > [data-scrollable]")!.children]
    .map((group) => [...group.firstElementChild!.children].map((span) => span.textContent));
/** The tab's cards. */
const cards = (root: HTMLElement = tab()) => [...root.querySelectorAll<HTMLElement>("[role=button][data-clickable]")];
/** A card by its name. */
const card = (name: string) => cards().find((c) => within(c).queryByText(name, { exact: true }) !== null)!;
/** A card's icon. */
const iconOf = (c: HTMLElement) => c.querySelector("svg[data-icon]")?.getAttribute("data-icon");
/** A card's trailing glyph — the named image; the icon tile's is not named — what it says, and whether the card is placed. */
const roleOf = (c: HTMLElement) => [c.querySelector("[role=img][aria-label]")?.getAttribute("aria-label") ?? null, c.hasAttribute("data-placed")];
/** The first characters of a dataset's hash on e3, as an item shows it. */
async function hashOf(dataset: E3Dataset): Promise<string> {
    const status = await h.statusOf(dataset);
    if (status.hash.type !== "some") throw new Error(`${status.path} holds no value`);
    return status.hash.value.slice(0, 8);
}

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

    test("the bound data sources, grouped by kind with their counts, each its kind's icon, its name, and its size and hash from e3's status of it", async () => {
        await h.mountBuilder();
        await show("Datasets");
        expect(groups()).toEqual([["Rows", "1"], ["Lookups", "1"]]);
        expect(cards().map((c) => iconOf(c))).toEqual(["table-list", "key"]);
        expect(cards().map((c) => c.textContent)).toEqual([
            `orders40 orders · #${await hashOf(ex.orders)}`, `customers8 customers by ID · #${await hashOf(ex.customers)}`,
        ]);
        // Each read through the dataset's status on e3, in the test's workspace.
        expect(h.requests("dataset-status").filter((r) => r.query.get("status") === "true").map((r) => r.dataset))
            .toEqual(expect.arrayContaining(["inputs.orders", "inputs.customers"]));
    });

    test("with no e3 server — an offline host — the tab fetches nothing, and each item says only what its type says", async () => {
        const started = h.e3.started();
        const { container } = render(
            <ChakraProvider value={system}>
                <DatasetsTab root={ROOT} reads={new Map()} onStart={() => {}} id="datasets" words={words} storageKey="datasets-offline" />
            </ChakraProvider>,
        );
        await settle();
        expect(groups(container)).toEqual([["Rows", "1"], ["Lookups", "1"]]);
        expect(cards(container).map((c) => [c.textContent, iconOf(c)])).toEqual([["orders", "table-list"], ["customers", "key"]]);
        expect(h.e3.started()).toBe(started);
    });

    test("Source and Looked up where the open query reads a data source, the card placed", async () => {
        await h.mountBuilder();
        await show("Datasets");
        // A new query on orders reads orders alone.
        expect([roleOf(card("orders")), roleOf(card("customers"))]).toEqual([["Source", true], [null, false]]);
        await openQuery(variant("saved", TOP.name));
        await show("Datasets");
        expect([roleOf(card("orders")), roleOf(card("customers"))]).toEqual([["Source", true], ["Looked up", true]]);
    });
});

// ─── D2 ──────────────────────────────────────────────────────────────────────

describe("the builder's Datasets tab (#939 D2)", () => {
    test("a click starts a new query on the data source, not run, with its notice; the query that was open keeps its drafts", async () => {
        const { container } = await h.mountBuilder();
        await openQuery(variant("saved", TOP.name));
        const ran = h.oneShots().length;
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
        expect(h.oneShots()).toHaveLength(ran);
        // The query that was open: its drafts as they were.
        await openQuery(variant("saved", TOP.name));
        expect(container.querySelectorAll("[data-step-id]")).toHaveLength(6);
    });

    test("⌘/ opens the Datasets tab, the pane expanded", async () => {
        const { container } = await h.mountBuilder();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Query" })); });
        await settle();
        await act(async () => { fireEvent.keyDown(container.querySelector<HTMLElement>("[data-query-builder]")!, { key: "/", ctrlKey: true }); });
        await settle();
        expect(container.querySelector("[data-query-builder] [data-collapsed]")).toBeNull();
        expect(screen.getByRole("tab", { name: "Datasets" }).getAttribute("aria-selected")).toBe("true");
    });
});
