/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Query.Library>` (#1063, `Query Editor Spec.md` §5, §7 L1–L7), rendered
 * through its carrier over a saved queries record in memory and the shared
 * fixture's orders and customers, at a fixed moment in UTC:
 *
 * - **L1**: headerless, with one toolbar row — the search, Sort, Grid · List, a
 *   rule and New query — and no border; the gallery draws no toolbar of its own.
 * - **L2**: the pane — All queries and each bound data source with its count
 *   of the saved queries that start from it, Recent at its foot; a click shows
 *   a data source's queries, or the recent runs.
 * - **L3**: the gallery — each card a wireframe of its query, its name, its
 *   description and its byline; a query with problems here, and one whose data
 *   sources aren't bound here, which says why instead of opening.
 * - **L4**: the search, Sort and Grid · List; the empty states, each marked
 *   by Font Awesome's open box (#1263).
 * - **L5**: Recent — this viewer's runs, newest first, a run of a saved query
 *   opening the saved query.
 * - **L6**: Open in builder → and New query on — the builder's open query, the
 *   host told, the open query placed; a builder sharing the id opens it, with
 *   its notice.
 * - **L7**: it reads no dataset; its cards drag under the library's id.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import {
    OptionType, checkJq, decodeBeast2For, equalFor, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { SavedQueryType, queryKeys } from "@elaraai/e3-ui/internal";
import { StateRuntime, formatters, system } from "@elaraai/east-ui-components";
import { markOf } from "@elaraai/east-ui-components/testing";
import { TreePathType, pathToString } from "@elaraai/e3-types";
import { clearPagedApi, initializePagedApi, type PagedApi } from "../platform/index.js";
import { whenWords } from "./about.js";
import { queryRoot, type QueryRoot } from "./one-shot.js";
import { QueryOpenType, type QueryOpen } from "./open-query.js";
import {
    act, CustomersType, RECORD, WORKSPACE, fixtureCall, mountLibrary, recordHarness, savedQuery, savedRecord, settle, type RecordHarness,
} from "./query.test-utils.js";
import type { SavedQuery } from "./session.js";

type TreePath = ValueTypeOf<typeof TreePathType>;

/** The moment the tests run at: a Thursday, noon UTC. */
const NOW = new Date("2026-10-01T12:00:00Z");

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

/** A saved query over another root, checked as a save there checks it. */
function savedOver(name: string, program: string, root: QueryRoot): SavedQuery {
    const checked = checkJq(program, root.type, { root: true });
    if (checked.program === null) throw new Error(`${program}: ${checked.diagnostics.map((d) => d.message).join("; ")}`);
    return {
        name, description: none, program: checked.program, saved_at: NOW,
        root: root.entries.filter((e) => checked.reads.includes(e.name)).map((e) => ({ name: e.name, path: e.path })),
    };
}

/** A root that binds regions, which no binding of the library's has. */
const REGIONS_ROOT = queryRoot([{ name: "regions", path: [variant("field", "inputs"), variant("field", "regions")], type: toEastTypeValue(CustomersType) }]);
/** Orders read at another path. */
const ARCHIVE: TreePath = [variant("field", "inputs"), variant("field", "archive"), variant("field", "orders")];

const TOP: SavedQuery = { ...savedQuery("Top shipped orders, 2026", DEFAULT_PROGRAM), saved_at: new Date("2026-09-29T10:00:00Z") };
const BIG: SavedQuery = { ...savedQuery("Big orders", ".orders\n| map(select(.total >= 1000))", some("Orders of 1,000 or more.")), saved_at: new Date("2026-10-01T09:30:00Z") };
const COUNT: SavedQuery = { ...savedQuery("Customer count", ".customers\n| length"), saved_at: new Date("2026-09-12T10:00:00Z") };
const MISSING: SavedQuery = { ...savedOver("Customers by region", ".regions\n| length", REGIONS_ROOT), saved_at: new Date("2025-12-01T10:00:00Z") };
const ELSEWHERE: SavedQuery = { ...savedQuery("Archived orders", ".orders\n| length"), root: [{ name: "orders", path: ARCHIVE }], saved_at: new Date("2026-09-30T10:00:00Z") };
/** This viewer's runs: one never saved, and one of Big orders. */
const CANCELLED: SavedQuery = { ...savedQuery("Cancelled orders", ".orders\n| map(select(.status.type == \"cancelled\"))\n| length"), saved_at: new Date("2026-10-01T11:00:00Z") };
const BIG_RUN: SavedQuery = { ...BIG, saved_at: new Date("2026-10-01T10:00:00Z") };

const printSaved = printFor(SavedQueryType);
const decodeOpen = decodeBeast2For(QueryOpenType);
const fromEqual = equalFor(OptionType(SavedQueryType));

/** This viewer's recent runs, the most recent first, as the builder keeps them in the browser. */
function remember(...runs: SavedQuery[]) {
    localStorage.setItem(queryKeys(undefined).recent, JSON.stringify(runs.map((run) => printSaved(run))));
}

let harness: RecordHarness;

beforeEach(() => {
    // A fixed moment, read in UTC: a card's byline says when, in the viewer's time.
    vi.stubEnv("TZ", "UTC");
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    harness = recordHarness(savedRecord([TOP, BIG, COUNT, MISSING, ELSEWHERE]));
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

// ─── What the library shows ──────────────────────────────────────────────────

/** The query library. */
const library = () => document.querySelector<HTMLElement>("[data-query-library]")!;
/** Its pane's rows: what each shows, its words and count, and whether it is the one shown. */
const paneRows = () => [...library().querySelectorAll<HTMLElement>("[data-query-library-shows]")]
    .map((row) => [row.getAttribute("data-query-library-shows"), row.textContent, row.hasAttribute("data-active")]);
/** The gallery's cards, in their order. */
const cards = () => [...library().querySelectorAll<HTMLElement>("[data-library-card]")];
/** A card by its key: a saved query's name, or `recent:<n>`. */
const card = (key: string) => cards().find((c) => c.getAttribute("data-library-card") === key)!;
/** A card's face: its name, its description and its foot. */
const face = (c: HTMLElement) => c.querySelector("[data-library-media]")!.nextElementSibling!;
/** A card's name. */
const nameOf = (c: HTMLElement) => face(c).firstElementChild!.firstElementChild!.textContent;
/** The names of the cards, in their order. */
const names = () => cards().map(nameOf);
/** A card's description, under its name. */
const descriptionOf = (c: HTMLElement) => [...face(c).children].find((el) => el.tagName === "SPAN")?.textContent ?? null;
/** A card's byline. */
const bylineOf = (c: HTMLElement) => c.querySelector("[data-library-foot]")!.firstElementChild!.textContent;
/** A card's action. */
const actionOf = (c: HTMLElement) => c.querySelector("[data-library-action]")?.textContent ?? null;
/** A card's trailing glyph: what it says, and its tone. */
const glyphOf = (c: HTMLElement) => {
    const glyph = c.querySelector("[role=img][aria-label]");
    return glyph === null ? null : [glyph.getAttribute("aria-label"), glyph.getAttribute("data-tone")];
};
/** A card's wireframe: what it draws, and its lines. */
const wireframeOf = (c: HTMLElement) => {
    const frame = c.querySelector<HTMLElement>("[data-query-wireframe]")!;
    return [frame.getAttribute("data-query-wireframe"), [...frame.children].map((line) => line.textContent)];
};
/** Clicks something, and lets the writes and the renders settle. */
async function click(el: Element) {
    await act(async () => { fireEvent.click(el); });
    await settle();
}
/** Shows a pane row. */
const show = (at: string) => click(library().querySelector(`[data-query-library-shows="${at}"]`)!);
/** Types in the search. */
async function search(text: string) {
    await act(async () => { fireEvent.change(screen.getByRole("textbox", { name: "Search queries" }), { target: { value: text } }); });
    await settle();
}
/** The query the builder has open, as the library and the builder share it. */
function opened(): QueryOpen | undefined {
    const bytes = StateRuntime.getStore().read(queryKeys(undefined).query);
    return bytes === undefined ? undefined : decodeOpen(bytes);
}
/** The empty state: its mark (each Font Awesome icon it draws, then any text), its title and hints. */
const emptyState = () => {
    const empty = library().querySelector<HTMLElement>("[data-query-library-empty]");
    if (empty === null) return null;
    const title = within(empty).getByRole("heading");
    return [markOf(title.parentElement!.previousElementSibling), title.textContent, [...empty.querySelectorAll("li")].map((li) => li.textContent)];
};

/** Opens a menu from the keyboard, then arrows down to an item and picks it — Zag's pointer handling needs a real pointer. */
async function pickFromMenu(trigger: HTMLElement, name: string) {
    await act(async () => { trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" }); });
    const menu = screen.getByRole("menu");
    for (let step = 0; step < 20 && menu.querySelector("[data-highlighted]")?.textContent !== name; step++) {
        await act(async () => { fireEvent.keyDown(menu, { key: "ArrowDown" }); });
    }
    await act(async () => { fireEvent.keyDown(menu, { key: "Enter" }); });
    await settle();
}

describe("when a query was saved, in a card's words (#1063)", () => {
    test("today its time, within six days its weekday, this year its month and day, else its date", () => {
        const f = formatters("en-US");
        expect([
            whenWords(new Date("2026-10-01T09:30:00Z"), NOW, f),
            whenWords(new Date("2026-09-29T10:00:00Z"), NOW, f),
            whenWords(new Date("2026-09-12T10:00:00Z"), NOW, f),
            whenWords(new Date("2025-12-01T10:00:00Z"), NOW, f),
        ]).toEqual(["09:30", "Tue", "Sep 12", "Dec 1, 2025"]);
    });
});

// ─── L1–L2 ───────────────────────────────────────────────────────────────────

describe("<Query.Library> — its toolbar and its pane (#1063 L1, L2)", () => {
    test("L1: headerless, with one toolbar row — the search counting the saved queries, Sort · Recent, Grid · List, a rule and New query on the first data source; the gallery draws no toolbar of its own, and the library no border", async () => {
        await mountLibrary();
        expect(library().firstElementChild!.getAttribute("data-slot")).toBe("toolbar");
        expect(library().querySelectorAll("[data-toolbar]")).toHaveLength(1);
        const items = [...library().firstElementChild!.querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"));
        expect(items).toEqual(["search", "sort", "layout", "rule", "new"]);
        expect(screen.getByRole("textbox", { name: "Search queries" }).getAttribute("placeholder")).toBe("Search 5 queries…");
        expect(screen.getByRole("button", { name: "Sort · Recent" })).toBeTruthy();
        expect(screen.getByRole("radiogroup", { name: "Layout" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "New query on orders" }).textContent).toBe("New query on orders");
        expect(library().querySelector("[data-library] [data-toolbar]")).toBeNull();
        const recipe = system.getSlotRecipe("queryLibrary") as { base: Record<string, Record<string, unknown>> };
        expect(Object.keys(recipe.base["root"]!).filter((k) => /^border/i.test(k) || /^(outline|boxShadow)$/.test(k))).toEqual([]);
    }, 30_000);

    test("L2: All queries and each bound data source with the count of saved queries that start from it, Recent at the foot with its count; a click shows a data source's queries — New query starting on it — or the recent runs", async () => {
        remember(CANCELLED, BIG_RUN);
        await mountLibrary();
        // Customers by region reads regions, which isn't bound here: it counts in All queries alone.
        expect(paneRows()).toEqual([
            ["all", "All queries5", true], ["source:orders", "orders3", false], ["source:customers", "customers1", false], ["recent", "Recent2", false],
        ]);
        expect(names()).toEqual(["Big orders", "Archived orders", "Top shipped orders, 2026", "Customer count", "Customers by region"]);
        await show("source:customers");
        expect(paneRows().map(([at, , active]) => [at, active])).toEqual([["all", false], ["source:orders", false], ["source:customers", true], ["recent", false]]);
        expect(names()).toEqual(["Customer count"]);
        expect(screen.getByRole("button", { name: "New query on customers" })).toBeTruthy();
        await show("source:orders");
        expect(names()).toEqual(["Big orders", "Archived orders", "Top shipped orders, 2026"]);
        await show("recent");
        expect(cards().map((c) => c.getAttribute("data-library-card"))).toEqual(["recent:0", "recent:1"]);
        expect(names()).toEqual(["Cancelled orders", "Big orders"]);
        // Recent starts a new query on the first data source.
        expect(screen.getByRole("button", { name: "New query on orders" })).toBeTruthy();
        await show("all");
        expect(names()).toHaveLength(5);
    }, 30_000);
});

// ─── L3 ──────────────────────────────────────────────────────────────────────

describe("<Query.Library> — its gallery (#1063 L3)", () => {
    test("L3: three across, each card a wireframe of its query — its source and a bar per step, the rest counted — with its name, the author's description or the generated sentence, its byline and Open in builder →", async () => {
        await mountLibrary();
        const grid = library().querySelector<HTMLElement>("[data-library] [data-layout]")!;
        expect([grid.getAttribute("data-layout"), grid.getAttribute("data-media"), grid.style.getPropertyValue("--library-columns")]).toEqual(["grid", "top", "3"]);
        expect(wireframeOf(card(TOP.name))).toEqual(["steps", ["orders", "Keep rows where", "Look up from another dataset", "Show only these fields", "+2 more"]]);
        expect(wireframeOf(card(BIG.name))).toEqual(["steps", ["orders", "Keep rows where"]]);
        expect(descriptionOf(card(TOP.name))).toMatch(/^Top 10 orders by total where status is shipped/);
        expect(descriptionOf(card(BIG.name))).toBe("Orders of 1,000 or more.");
        // What it gives is the builder's shape: Show only these fields leaves the rows unnarrowed.
        expect(bylineOf(card(TOP.name))).toBe("orders · 5 steps · up to 10 orders · saved Tue");
        expect(bylineOf(card(BIG.name))).toBe("orders · 1 step · many orders · saved 09:30");
        expect(bylineOf(card(COUNT.name))).toBe("customers · 1 step · one whole number · saved Sep 12");
        expect([actionOf(card(TOP.name)), actionOf(card(BIG.name))]).toEqual(["Open in builder →", "Open in builder →"]);
        expect([glyphOf(card(TOP.name)), glyphOf(card(BIG.name))]).toEqual([null, null]);
    }, 30_000);

    test("L3: a query with problems here draws their count, dashed, and why; one whose data sources aren't bound here carries the reason in the warning tone, has no action, and its click says why in a notice instead of opening", async () => {
        await mountLibrary();
        expect(wireframeOf(card(MISSING.name))).toEqual(["problems", ["1 problem", "Reads regions, which isn't here"]]);
        expect(bylineOf(card(MISSING.name))).toBe("regions · jq · 1 problem · saved Dec 1, 2025");
        expect([glyphOf(card(MISSING.name)), glyphOf(card(ELSEWHERE.name))]).toEqual([
            ["Reads regions, which isn't here", "warning"],
            [`Reads ${pathToString(ARCHIVE)}, not this builder's orders`, "warning"],
        ]);
        expect([actionOf(card(MISSING.name)), actionOf(card(ELSEWHERE.name))]).toEqual([null, null]);
        await click(card(ELSEWHERE.name));
        expect(library().querySelector("[data-query-library-notice]")!.textContent).toBe(`Reads ${pathToString(ARCHIVE)}, not this builder's orders`);
        expect([opened(), screen.getByText(/^told /).textContent]).toEqual([undefined, "told nothing"]);
        // Another view clears it.
        await show("source:orders");
        expect(library().querySelector("[data-query-library-notice]")).toBeNull();
    }, 30_000);
});

// ─── L4 ──────────────────────────────────────────────────────────────────────

describe("<Query.Library> — search, sort, layout and the empty states (#1063 L4)", () => {
    test("L4: the search narrows the cards by name, description and data source, and Esc clears it; Sort · Name orders them by name; List lays them out a row each", async () => {
        await mountLibrary();
        await search("big");
        expect(names()).toEqual(["Big orders"]);
        await search("1,000 or more");
        expect(names()).toEqual(["Big orders"]);
        // By its data source alone: Customers by region reads regions.
        await search("regions");
        expect(names()).toEqual(["Customers by region"]);
        // Top shipped orders looks up customers, as its description says.
        await search("customers");
        expect(names()).toEqual(["Top shipped orders, 2026", "Customer count", "Customers by region"]);
        await act(async () => { fireEvent.keyDown(screen.getByRole("textbox", { name: "Search queries" }), { key: "Escape" }); });
        await settle();
        expect(names()).toHaveLength(5);

        await pickFromMenu(screen.getByRole("button", { name: "Sort · Recent" }), "Name");
        expect(names()).toEqual(["Archived orders", "Big orders", "Customer count", "Customers by region", "Top shipped orders, 2026"]);
        expect(screen.getByRole("button", { name: "Sort · Name" })).toBeTruthy();

        await click(screen.getByRole("radio", { name: "List view" }));
        expect(library().querySelector("[data-library] [data-layout]")!.getAttribute("data-layout")).toBe("list");
        expect(screen.getByRole("radio", { name: "List view" }).getAttribute("aria-checked")).toBe("true");
    }, 30_000);

    test("L4: nothing matching the search says so, with what to try — every query's search, or a filter's; no recent runs; no queries yet", async () => {
        await mountLibrary();
        await search("zzz");
        expect(emptyState()).toEqual(["fas box-open", "No queries match “zzz”", ["Check the spelling", "Search by query name, description or data source"]]);
        await show("source:orders");
        expect(emptyState()).toEqual(["fas box-open", "No queries match “zzz”", ["Check the spelling", "Clear the filter to search every query"]]);
        await search("");
        await show("recent");
        expect(emptyState()).toEqual(["fas box-open", "No recent runs", ["Run a query in the builder to see it here"]]);
        cleanup();
        harness = recordHarness(savedRecord([]));
        await mountLibrary();
        expect(emptyState()).toEqual(["fas box-open", "No queries yet", ["Save a query in the builder"]]);
        expect(screen.getByRole("textbox", { name: "Search queries" }).getAttribute("placeholder")).toBe("Search 0 queries…");
    }, 30_000);
});

// ─── L5–L6 ───────────────────────────────────────────────────────────────────

describe("<Query.Library> — opening queries (#1063 L5, L6)", () => {
    test("L6: Open in builder → writes the builder's open query and tells the host; the open query's card is placed", async () => {
        await mountLibrary();
        await click(card(BIG.name));
        expect(opened()).toEqual(variant("saved", "Big orders"));
        expect(screen.getByText(/^told /).textContent).toBe("told Big orders");
        expect(cards().filter((c) => c.hasAttribute("data-placed")).map(nameOf)).toEqual(["Big orders"]);
    }, 30_000);

    test("L6: New query on the data source the pane shows opens a new query on it, and tells the host its name", async () => {
        await mountLibrary();
        await show("source:customers");
        await click(screen.getByRole("button", { name: "New query on customers" }));
        const open = opened();
        if (open?.type !== "new") throw new Error("expected a new query");
        expect([open.value.source, open.value.from]).toEqual(["customers", none]);
        expect(screen.getByText(/^told /).textContent).toBe("told Untitled customers query");
    }, 30_000);

    test("L5: a recent run of a saved query opens the saved query; one never saved opens as a new query begun as it — each byline saying when it ran, the open one placed", async () => {
        remember(CANCELLED, BIG_RUN);
        await mountLibrary();
        await show("recent");
        expect([bylineOf(card("recent:0")), bylineOf(card("recent:1"))]).toEqual([
            "orders · 2 steps · one whole number · ran 11:00",
            "orders · 1 step · many orders · ran 10:00",
        ]);
        await click(card("recent:1"));
        expect(opened()).toEqual(variant("saved", "Big orders"));
        await click(card("recent:0"));
        const open = opened();
        if (open?.type !== "new") throw new Error("expected a new query");
        expect(open.value.source).toBe("orders");
        expect(fromEqual(open.value.from, some(CANCELLED))).toBe(true);
        expect(screen.getByText(/^told /).textContent).toBe("told Cancelled orders");
        expect(cards().filter((c) => c.hasAttribute("data-placed")).map((c) => c.getAttribute("data-library-card"))).toEqual(["recent:0"]);
    }, 30_000);

    test("L6: a builder sharing the library's id opens the query the library opens — with “Opened … from the query library.” — and runs it", async () => {
        const fixture = fixtureCall();
        await mountLibrary({ id: "top", builder: fixture.call });
        const builder = document.querySelector<HTMLElement>("[data-query-builder]")!;
        const ran = fixture.requests.length;
        await click(card(BIG.name));
        expect(builder.getAttribute("data-query-open")).toBe(`query.saved:"Big orders"`);
        expect([...builder.querySelectorAll("[data-query-tab=query] [role=status]")].map((n) => n.textContent)).toEqual(["Opened “Big orders” from the query library."]);
        expect(fixture.requests).toHaveLength(ran + 1);
        await click(screen.getByRole("button", { name: "New query on orders" }));
        expect(builder.getAttribute("data-query-open")).toMatch(/^query\.new:/);
        expect([...builder.querySelectorAll("[data-query-tab=query] [role=status]")].map((n) => n.textContent)).toEqual(["Started a new query on orders."]);
    }, 30_000);
});

// ─── L7 ──────────────────────────────────────────────────────────────────────

describe("<Query.Library> — what it reads, and its drag source (#1063 L7)", () => {
    test("L7: opening the library, and a query from it, reads the saved queries alone — no data source's value, bound or paged", async () => {
        // Every bound value and the record are read from the dataset cache; a paged source's rows through the paging API.
        const pages: string[] = [];
        const paging: PagedApi = {
            async getPage(_ws, path) { pages.push(pathToString(path)); throw new Error("no rows here"); },
            async findKey(_ws, path) { pages.push(pathToString(path)); throw new Error("no keys here"); },
            async getRevision() { return null; },
            watchRevision() { return () => {}; },
        };
        initializePagedApi(paging, WORKSPACE);
        const reads = vi.spyOn(harness.cache, "read");
        try {
            remember(CANCELLED);
            await mountLibrary();
            await click(card(BIG.name));
            await show("recent");
            await click(card("recent:0"));
            expect(new Set(reads.mock.calls.map(([, path]) => pathToString(path)))).toEqual(new Set([`.records.${RECORD}`]));
            expect(pages).toEqual([]);
        } finally {
            clearPagedApi(paging);
        }
    }, 30_000);

    test("L7: under a drag layer a saved query's card drags, from the library's id — its builder's — and a recent run's does not", async () => {
        remember(CANCELLED);
        await mountLibrary({ drag: true });
        expect(library().querySelector("[data-library]")!.getAttribute("data-library")).toBe("query.library");
        expect(cards().every((c) => c.hasAttribute("data-draggable"))).toBe(true);
        await show("recent");
        expect(cards().map((c) => c.hasAttribute("data-draggable"))).toEqual([false]);
        cleanup();
        harness = recordHarness(savedRecord([BIG]));
        await mountLibrary({ id: "top", drag: true });
        expect(library().querySelector("[data-library]")!.getAttribute("data-library")).toBe("query.library.top");
    }, 30_000);
});
