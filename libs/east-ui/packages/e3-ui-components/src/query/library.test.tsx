/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Query.Library>` (#1063, #1761), rendered through its carrier over the
 * saved queries record and the query examples' orders and customers on e3
 * (#1376):
 *
 * - **The frame**: one `BuilderFrame` — its toolbar holding the rail and New
 *   query, over the cards — with no pane, no history bar, and no search, Sort
 *   or layout switch of its own.
 * - **The cards**: a card a saved query, in the order e3 pages them — a
 *   wireframe of its query, its name, its description, its tags, and what it
 *   reads and gives and when it was saved — the Library's gallery card; one
 *   whose data sources aren't bound here says why, in the warning tone, and is
 *   no button; the query the host says is open is marked.
 * - **Opening**: a press on a card, or ⏎ or Space on it, tells the host its
 *   query and does nothing else; ⌘ or Ctrl ⏎ is left as it came.
 * - **What it reads**: its rows a window at a time through the record's
 *   indexes — never the record whole, and no dataset — and again when the
 *   record moves.
 * - **New query and the rail** (L11): a menu of the bound data sources, or the
 *   one data source the rail narrows to; the rail narrows the cards and their
 *   count, and a narrowing that leaves none says so, with Clear filters.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import {
    StringType, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import { system } from "@elaraai/east-ui-components";
import { TreePathType, pathToString } from "@elaraai/e3-types";
import { ReactiveDatasetCache } from "../platform/index.js";
import { slot } from "../e3-web-mount.test-utils.js";
import { queryRoot } from "./one-shot.js";
import { CustomersType, savedQuery } from "./fixture.test-utils.js";
import { act, firstQuery, hostQuery, libraryRail, queryHarness, settle, sharedEntry } from "./query.test-utils.js";
import type { SavedQuery } from "./session.js";

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

/** A root that binds regions, which no binding of the library's has. */
const REGIONS_ROOT = queryRoot([{ name: "regions", path: [variant("field", "inputs"), variant("field", "regions")], type: toEastTypeValue(CustomersType) }]);
/** Orders read at another path. */
const ARCHIVE: TreePath = [variant("field", "inputs"), variant("field", "archive"), variant("field", "orders")];

const TOP: SavedQuery = { ...savedQuery("Top shipped orders, 2026", DEFAULT_PROGRAM), tags: new Set(["sales", "weekly"]), saved_at: new Date("2026-09-29T10:00:00Z") };
const BIG: SavedQuery = { ...savedQuery("Big orders", ".orders\n| map(select(.total >= 1000))", some("Orders of 1,000 or more.")), saved_at: new Date("2026-10-01T09:30:00Z") };
const COUNT: SavedQuery = { ...savedQuery("Customer count", ".customers\n| length"), saved_at: new Date("2026-09-12T10:00:00Z") };
const MISSING: SavedQuery = { ...savedQuery("Customers by region", ".regions\n| length", none, REGIONS_ROOT), saved_at: new Date("2025-12-01T10:00:00Z") };
const ELSEWHERE: SavedQuery = { ...savedQuery("Archived orders", ".orders\n| length"), root: [{ name: "orders", path: ARCHIVE }], saved_at: new Date("2026-09-30T10:00:00Z") };
/** This viewer's runs: one never saved, and one of Big orders. */
const CANCELLED: SavedQuery = { ...savedQuery("Cancelled orders", ".orders\n| map(select(.status.type == \"cancelled\"))\n| length"), saved_at: new Date("2026-10-01T11:00:00Z") };
const BIG_RUN: SavedQuery = { ...BIG, saved_at: new Date("2026-10-01T10:00:00Z") };

/** The saved queries' names, in the order e3 pages them: the record's key order. */
const NAMES = ["Archived orders", "Big orders", "Customer count", "Customers by region", "Top shipped orders, 2026"];

const printName = printFor(StringType);

// The cards are read a window at a time into a measured view: the harness measures one.
const h = queryHarness({ measure: true });

beforeEach(async () => {
    await h.seed([TOP, BIG, COUNT, MISSING, ELSEWHERE]);
});

// ─── What the library shows ──────────────────────────────────────────────────

/** The cards, in order. */
const cards = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-library-gallery] [data-library-card]")];
/** The cards' queries' names, in order. */
const names = (container: HTMLElement) => cards(container).map((card) => card.getAttribute("data-library-card"));
/** A query's card. */
const cardOf = (container: HTMLElement, name: string) => cards(container).find((card) => card.getAttribute("data-library-card") === name)!;
/** A part of a query's card — the Library's gallery card's — as it reads; `undefined` where the card draws none. */
const partOf = (container: HTMLElement, name: string, part: string) => cardOf(container, name).querySelector(`[data-library-${part}]`)?.textContent;
/** A card's wireframe: what it draws, and its lines. */
const wireOf = (card: HTMLElement) => {
    const wire = card.querySelector<HTMLElement>("[data-query-wireframe]")!;
    return [wire.getAttribute("data-query-wireframe"), [...wire.children].map((line) => line.textContent)];
};
/** A card's tags. */
const tagsOf = (container: HTMLElement, name: string) => [...cardOf(container, name).querySelectorAll('[data-library-dim="tags"] > *')].map((tag) => tag.textContent);
/** The cards the host's open query marks. */
const marked = (container: HTMLElement) => cards(container).filter((card) => card.hasAttribute("data-placed")).map((card) => card.getAttribute("data-library-card"));
/** What the surface says its `onOpen` was told. */
const told = () => screen.getByText(/^told /).textContent;
/** The toolbar's words. */
const toolbarSays = (container: HTMLElement) => slot(container, "toolbar").textContent ?? "";

/** A press on an element, and what it leads to settled. */
async function press(el: Element) {
    await act(async () => { fireEvent.click(el); });
    await settle();
}
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
/** Mounts the library, and waits for its first cards. */
async function mount(options: Parameters<typeof h.mountLibrary>[0] = {}) {
    const mounted = await h.mountLibrary(options);
    await vi.waitFor(() => expect(cards(mounted.container).length).toBeGreaterThan(0));
    await settle();
    return mounted;
}

// ─── The frame ───────────────────────────────────────────────────────────────

describe("<Query.Library> — its frame (#1761)", () => {
    test("one BuilderFrame: the toolbar holding the rail's fields and New query, over the cards — with no pane, no history bar, and no search, Sort or layout switch of its own", async () => {
        const { container } = await mount();
        expect(container.querySelectorAll("[data-builder-frame]")).toHaveLength(1);
        const toolbar = slot(container, "toolbar");
        expect([...toolbar.querySelectorAll("[data-record-slice-field]")].map((field) => field.textContent)).toEqual(["Name", "Data source", "Tag", "Saved"]);
        expect(within(toolbar).getByRole("button", { name: "New query" })).toBeTruthy();
        // The rail counts its rows while it narrows them, and says nothing of them while it does not.
        expect(toolbarSays(container)).not.toContain("queries");
        expect(slot(container, "main").querySelector("[data-library-gallery]")).not.toBeNull();
        // No pane, and nothing to save: the library writes nothing.
        expect([container.querySelector('[data-frame-slot="start"]'), container.querySelector('[data-frame-slot="end"]')]).toEqual([null, null]);
        expect(screen.queryAllByRole("tab")).toEqual([]);
        expect([screen.queryByRole("button", { name: "Save" }), screen.queryByRole("button", { name: "Undo" })]).toEqual([null, null]);
        expect(screen.queryByRole("textbox", { name: "Search queries" })).toBeNull();
        expect(container.querySelector("[data-query-library-sort]")).toBeNull();
        expect(screen.queryByRole("radiogroup", { name: "Layout" })).toBeNull();
        // Its recipe frames nothing and draws no card: what it styles is a card's wireframe, and New query's glyphs.
        const recipe = system.getSlotRecipe("queryLibrary") as { base: Record<string, Record<string, unknown>> };
        expect(Object.keys(recipe.base).filter((slot) => slot === "root" || slot.startsWith("card"))).toEqual([]);
    });
});

// ─── The cards ───────────────────────────────────────────────────────────────

describe("<Query.Library> — its cards (#1761)", () => {
    test("a card a saved query, in the order e3 pages them: a wireframe of its query, its name, its description — the author's, else the sentence from its steps — its tags, and what it reads and gives and when it was saved", async () => {
        const { container } = await mount();
        expect(names(container)).toEqual(NAMES);
        expect(wireOf(cardOf(container, TOP.name))).toEqual(["steps", ["orders", "Keep rows where", "Look up from another dataset", "Show only these fields", "+2 more"]]);
        expect(wireOf(cardOf(container, BIG.name))).toEqual(["steps", ["orders", "Keep rows where"]]);
        expect(partOf(container, BIG.name, "title")).toBe("Big orders");
        expect(partOf(container, BIG.name, "sublabel")).toBe("Orders of 1,000 or more.");
        expect(partOf(container, TOP.name, "sublabel")).toMatch(/^Top 10 orders by total where status is shipped/);
        expect([tagsOf(container, TOP.name), tagsOf(container, BIG.name)]).toEqual([["sales", "weekly"], []]);
        expect(partOf(container, TOP.name, "byline")).toMatch(/^orders · 5 steps · up to 10 orders · saved /);
        expect(partOf(container, COUNT.name, "byline")).toMatch(/^customers · 1 step · one whole number · saved /);
        expect(cardOf(container, BIG.name).querySelector("[data-library-action]")!.textContent).toBe("Open in builder →");
    });

    test("a query whose data sources aren't bound here says why on its card, in the warning tone, in its description's place; it is no button, and a press on it asks for nothing", async () => {
        const { container } = await mount();
        expect([partOf(container, MISSING.name, "note"), partOf(container, ELSEWHERE.name, "note"), partOf(container, BIG.name, "note")]).toEqual([
            "Reads regions, which isn't here", `Reads ${pathToString(ARCHIVE)}, not this builder's orders`, undefined,
        ]);
        expect(wireOf(cardOf(container, MISSING.name))).toEqual(["problems", ["1 problem", "Reads regions, which isn't here"]]);
        const refused = cardOf(container, MISSING.name);
        expect([partOf(container, MISSING.name, "sublabel"), refused.querySelector("[data-library-note]")!.getAttribute("data-tone")]).toEqual([undefined, "warning"]);
        expect([refused.querySelector("[data-library-action]"), refused.getAttribute("role"), refused.hasAttribute("tabindex")]).toEqual([null, null, false]);
        expect(within(refused).getByRole("img", { name: "Reads regions, which isn't here" }).getAttribute("data-tone")).toBe("warning");
        await press(refused);
        expect([told(), hostQuery()]).toEqual(["told nothing", firstQuery("orders")]);
    });
});

// ─── Opening ─────────────────────────────────────────────────────────────────

describe("<Query.Library> — opening a query (#1761)", () => {
    test("a press on a card tells the host its query, and writes nothing itself; the query the host says is open is marked on its card", async () => {
        const { container } = await mount();
        expect(marked(container)).toEqual([]);
        await press(cardOf(container, BIG.name));
        expect([told(), hostQuery(), marked(container)]).toEqual(["told Big orders", variant("saved", "Big orders"), [BIG.name]]);
        expect(partOf(container, BIG.name, "status")).toBe("Open");
        expect(sharedEntry()).toBeUndefined();
    });

    test("⏎ and Space on a card, the keyboard on it, each tell the host its query; ⌘ or Ctrl ⏎ tells nothing", async () => {
        const { container } = await mount();
        const card = cardOf(container, COUNT.name);
        expect([card.getAttribute("role"), card.tabIndex]).toEqual(["button", 0]);
        // A chord is a builder's shortcut: the card leaves it as it came.
        await act(async () => { card.focus(); fireEvent.keyDown(card, { key: "Enter", metaKey: true }); fireEvent.keyDown(card, { key: "Enter", ctrlKey: true }); });
        await settle();
        expect(told()).toBe("told nothing");
        await act(async () => { fireEvent.keyDown(card, { key: "Enter" }); });
        await settle();
        expect(told()).toBe("told Customer count");
        const other = cardOf(container, TOP.name);
        await act(async () => { other.focus(); fireEvent.keyDown(other, { key: " " }); });
        await settle();
        expect([told(), marked(container)]).toEqual(["told Top shipped orders, 2026", [TOP.name]]);
    });

    test("given no open query it marks no card, and a card's press still tells its host", async () => {
        const { container } = await mount({ marked: false });
        await press(cardOf(container, BIG.name));
        expect([told(), marked(container)]).toEqual(["told Big orders", []]);
    });

    test("a builder its host shows the open query in — a surface of its own — opens the query the library asks for, with “Opened …”, and runs it", async () => {
        const { container } = await mount({ id: "top", builder: true });
        const builder = document.querySelector<HTMLElement>("[data-query-builder]")!;
        const ran = h.oneShots().length;
        await press(cardOf(container, BIG.name));
        expect(builder.getAttribute("data-query-open")).toBe(`query.saved:"Big orders"`);
        expect([...builder.querySelectorAll("[data-query-tab=query] [role=status]")].map((n) => n.textContent)).toEqual(["Opened “Big orders”."]);
        expect(h.oneShots()).toHaveLength(ran + 1);
    });
});

// ─── What it reads ───────────────────────────────────────────────────────────

describe("<Query.Library> — what it reads (#1761)", () => {
    test("opening the library and a query from it reads no dataset and never the saved queries whole — its cards are e3's pages", async () => {
        // A bound value and a record read whole come from the dataset cache, which also reads itself to say what it holds
        // (`has`) — the page's polls of what the surface reads.
        const read = Object.getOwnPropertyDescriptor(ReactiveDatasetCache.prototype, "read")!.value as ReactiveDatasetCache["read"];
        const has = Object.getOwnPropertyDescriptor(ReactiveDatasetCache.prototype, "has")!.value as ReactiveDatasetCache["has"];
        let holding = 0;
        const surfaceReads = new Set<string>();
        vi.spyOn(ReactiveDatasetCache.prototype, "has").mockImplementation(function (this: ReactiveDatasetCache, ws, path) {
            holding++;
            try { return has.call(this, ws, path); } finally { holding--; }
        });
        vi.spyOn(ReactiveDatasetCache.prototype, "read").mockImplementation(function (this: ReactiveDatasetCache, ws, path) {
            if (holding === 0) surfaceReads.add(pathToString(path));
            return read.call(this, ws, path);
        });
        const { container } = await mount();
        await press(cardOf(container, BIG.name));
        expect(told()).toBe("told Big orders");
        expect(surfaceReads).toEqual(new Set());
        // No read of the record whole, none of a data source's rows, and no write.
        expect(h.requests("read").filter((request) => request.record === ex.queries.name)).toEqual([]);
        expect([h.requests("rows"), h.requests("runs"), h.requests("mutate")]).toEqual([[], [], []]);
    });

    test("a query saved meanwhile — in a builder, on another page — shows as the record moves", async () => {
        const { container } = await mount();
        expect(names(container)).toEqual(NAMES);
        await act(async () => { await h.seed([TOP, BIG, COUNT, MISSING, ELSEWHERE, CANCELLED]); });
        await vi.waitFor(() => expect(names(container)).toEqual(["Archived orders", "Big orders", "Cancelled orders", "Customer count", "Customers by region", "Top shipped orders, 2026"]));
    });

    test("with no saved query it says so, and what to do", async () => {
        await h.seed([]);
        const mounted = await h.mountLibrary();
        await vi.waitFor(() => expect(mounted.container.querySelector("[data-library-empty]")).not.toBeNull());
        expect(mounted.container.querySelector("[data-library-empty]")!.textContent).toContain("No queries yet");
        expect(mounted.container.querySelector("[data-library-empty]")!.textContent).toContain("Save a query in the builder");
    });
});

// ─── L11 ─────────────────────────────────────────────────────────────────────

describe("<Query.Library> — New query and the rail (#1761 L11)", () => {
    test("L11: with no data source chosen, New query opens a menu of the bound data sources, and a pick asks the host for a new query on it — its own, each pick", async () => {
        const { container } = await mount();
        await pickFromMenu(within(slot(container, "toolbar")).getByRole("button", { name: "New query" }), "customers");
        const open = hostQuery();
        if (open?.type !== "new") throw new Error("expected a new query");
        expect([open.value.source, open.value.from, told()]).toEqual(["customers", none, "told a new query on customers"]);
        await pickFromMenu(within(slot(container, "toolbar")).getByRole("button", { name: "New query" }), "customers");
        const again = hostQuery();
        if (again?.type !== "new") throw new Error("expected a new query");
        expect(again.value.id).not.toBe(open.value.id);
    });

    test("L11: the rail narrowed to one data source, New query names it and starts on it, and the rail narrows the cards and their count; a data source not bound here offers the menu again", async () => {
        const { container } = await mount();
        await act(async () => { libraryRail().choose("sources", [printName("customers")]); });
        await vi.waitFor(() => expect(names(container)).toEqual([COUNT.name, TOP.name]));
        expect(toolbarSays(container)).toContain("2 of 5 queries");
        await press(within(slot(container, "toolbar")).getByRole("button", { name: "New query on customers" }));
        const open = hostQuery();
        if (open?.type !== "new") throw new Error("expected a new query");
        expect([open.value.source, told()]).toEqual(["customers", "told a new query on customers"]);
        // A data source this surface does not bind is no place to start: New query offers its menu again.
        await act(async () => { libraryRail().choose("sources", [printName("regions")]); });
        await vi.waitFor(() => expect(names(container)).toEqual([MISSING.name]));
        expect(within(slot(container, "toolbar")).getByRole("button", { name: "New query" })).toBeTruthy();
    });

    test("a narrowing that leaves no query says so, and its Clear filters brings every card back", async () => {
        const { container } = await mount();
        await act(async () => { libraryRail().choose("tags", [printName("nothing-tagged-so")]); });
        await vi.waitFor(() => expect(container.querySelector("[data-library-empty]")).not.toBeNull());
        const empty = container.querySelector<HTMLElement>("[data-library-empty]")!;
        expect(empty.textContent).toContain("No queries match the filters");
        await press(within(empty).getByRole("button", { name: /Clear filters/ }));
        await vi.waitFor(() => expect(names(container)).toEqual(NAMES));
    });
});
