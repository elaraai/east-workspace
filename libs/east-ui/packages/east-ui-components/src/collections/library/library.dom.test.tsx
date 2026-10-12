/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Library>`'s card additions and its Filter menu: a trailing glyph that
 * names itself and takes its tone; a placed card; a click that reports the
 * card, from the keyboard too when the card cannot be dragged; facets that
 * narrow the cards (AND across facets, OR within one) with the counts
 * following; the noun the search box counts the items by; and the one
 * toolbar row its controls share. The gallery (#1030): its cards' media, face
 * and foot, its layout and columns, the toolbar's Grid · List switch, its
 * dashed card to add one, and the compact card's behaviour kept. With nothing
 * to show (#1186), the shared empty state: the host's words for no items, or
 * `No matches` for a search or a filter that hides every card, its mark Font
 * Awesome's open box (#1263). A host that takes a draggable card's ⏎ (#1187)
 * gets it, while Space still picks the card up. A compact Library's add action
 * is Font Awesome's plus beside its words (#1263).
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, NullType, StringType, none, some, type ValueTypeOf } from "@elaraai/east";
import { Library, Reactive, State, Stack, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { UIStore } from "../../platform/state-store.js";
import { DragLayerProvider } from "../../dnd/drag-layer.js";
import { announced, pointAt, press, stubScrollIntoView, tick } from "../../testing/drag-layer.js";
import { faIcons, loneGlyphs, markOf } from "../../testing/icons.js";
import { EastChakraLibrary, type LibraryItemValue, type LibraryValue } from "./index.js";

// jsdom lacks the ResizeObserver the menu's positioner reaches for, and the
// CSS.escape the menu finds its items with.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");

// Each test's toolbar — its grouping among them — persists under one storage key.
afterEach(() => {
    cleanup();
    localStorage.clear();
});

function mount(value: ValueTypeOf<typeof UIComponentType>) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="library-test" />
        </ChakraProvider>,
    );
}

/** Opens a menu from the keyboard, as its trigger's arrow key does. */
async function open(trigger: HTMLElement) {
    await act(async () => { trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" }); });
}

/** Picks a menu item from the keyboard: arrows down to it, a step at a time, then Enter. */
async function pick(name: string) {
    const menu = screen.getByRole("menu");
    for (let step = 0; step < 20 && menu.querySelector("[data-highlighted]")?.textContent !== name; step++) {
        await act(async () => { fireEvent.keyDown(menu, { key: "ArrowDown" }); });
    }
    await act(async () => { fireEvent.keyDown(menu, { key: "Enter" }); });
}

describe("Library — card additions", () => {
    test("a trailing glyph names itself, and a toned glyph carries its tone", () => {
        initializeStore(new UIStore());
        mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail", live: false },
            { id: "home", name: "Home", live: true },
        ], {
            id: "things",
            item: r => ({
                key: r.id,
                label: r.name,
                trailing: r.live.ifElse(
                    () => some(Library.glyph("circle", "Live", "success")),
                    () => some(Library.glyph("lock", "Logic fixed by the developer")),
                ),
            }),
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        const lock = screen.getByRole("img", { name: "Logic fixed by the developer" });
        expect(lock.hasAttribute("data-tone")).toBe(false);
        expect(lock.querySelector("svg[data-icon=lock]")).not.toBeNull();
        const dot = screen.getByRole("img", { name: "Live" });
        expect(dot.getAttribute("data-tone")).toBe("success");
    });

    test("a placed card carries the placed state, and the others do not", () => {
        initializeStore(new UIStore());
        const { container } = mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail" },
            { id: "trend", name: "Revenue trend" },
        ], {
            id: "things",
            item: r => ({ key: r.id, label: r.name, placed: r.id.equal("trend") }),
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        const placed = container.querySelectorAll("[data-placed]");
        expect(placed).toHaveLength(1);
        expect(within(placed[0] as HTMLElement).getByText("Revenue trend")).toBeTruthy();
    });

    test("a click reports the card's key; a card that cannot be dragged is a button the keyboard clicks", async () => {
        initializeStore(new UIStore());
        mount(East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const picked = $.let(State.bind([StringType], "library.test.picked", ""));
            const onCardClick = $.const(East.function([StringType], NullType, ($2, key) => { $2(picked.write(key)); }));
            return Stack.VStack([
                Text.Root(East.str`picked ${picked.read()}`),
                Library.Root([
                    { id: "kpi", name: "KPI rail", pinned: false },
                    { id: "home", name: "Home", pinned: true },
                ], {
                    id: "things",
                    item: r => ({ key: r.id, label: r.name, draggable: r.pinned.not() }),
                    onCardClick,
                }),
            ]);
        }))), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        await act(async () => { fireEvent.click(screen.getByText("KPI rail")); });
        expect(screen.getByText("picked kpi")).toBeTruthy();

        const home = screen.getByRole("button", { name: /Home/ });
        await act(async () => { fireEvent.keyDown(home, { key: "Enter" }); });
        expect(screen.getByText("picked home")).toBeTruthy();
    });
});

describe("Library — the Filter menu and the noun", () => {
    test("checked values keep the cards that hold one — OR within a facet, AND across facets — and the counts follow", async () => {
        initializeStore(new UIStore());
        mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail", category: "Display", tags: ["kpi", "sales"] },
            { id: "trend", name: "Revenue trend", category: "Charts", tags: ["sales"] },
            { id: "orders", name: "Orders by week", category: "Charts", tags: ["orders"] },
        ], {
            id: "things",
            item: r => ({ key: r.id, label: r.name }),
            groupBy: [{ key: "category", label: "Category", value: r => r.category }],
            filters: [
                { key: "category", label: "Category", values: r => [r.category] },
                { key: "tags", label: "Tags", values: r => r.tags },
            ],
            search: r => r.name,
            noun: { singular: "component", plural: "components" },
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        expect(screen.getByPlaceholderText("Search 3 components…")).toBeTruthy();
        await open(screen.getByRole("button", { name: "Filter" }));
        await pick("Charts");
        // One category checked: the Charts pair stays, the Display card hides.
        expect(screen.queryByText("KPI rail")).toBeNull();
        expect(screen.getByText("Revenue trend")).toBeTruthy();
        expect(screen.getByText("Orders by week")).toBeTruthy();
        expect(screen.getByText("1 hidden by filter ·")).toBeTruthy();

        // AND across facets: Charts and the sales tag keep the trend alone.
        await pick("sales");
        expect(screen.queryByText("Orders by week")).toBeNull();
        expect(screen.getByText("Revenue trend")).toBeTruthy();
        // OR within a facet: the orders tag as well brings the orders back.
        await pick("orders");
        expect(screen.getByText("Orders by week")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Filter · 3" })).toBeTruthy();

        await act(async () => { fireEvent.click(screen.getByText("Show all")); });
        expect(screen.getByText("KPI rail")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
    });

    test("without a noun the search box counts items", () => {
        initializeStore(new UIStore());
        mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail" },
        ], {
            id: "things",
            item: r => ({ key: r.id, label: r.name }),
            search: r => r.name,
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);
        expect(screen.getByPlaceholderText("Search 1 item…")).toBeTruthy();
    });

    test("one toolbar row: the search and the grouping, then at its end the caption, the secondary facts and the filter — no header band", () => {
        initializeStore(new UIStore());
        const { container } = mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail", category: "Display", hours: 4.0 },
        ], {
            id: "things",
            item: r => ({ key: r.id, label: r.name }),
            hint: "Drag onto the canvas",
            dimensions: [{ kind: "meter", key: "hours", label: "Hours", value: r => r.hours, max: 8.0 }],
            groupBy: [{ key: "category", label: "Category", value: r => r.category }],
            filters: [{ key: "category", label: "Category", values: r => [r.category] }],
            search: r => r.name,
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        const rows = container.querySelectorAll("[data-toolbar]");
        expect(rows).toHaveLength(1);
        const items = [...rows[0]!.querySelectorAll<HTMLElement>(":scope > [data-toolbar-item]")];
        expect(items.map(i => i.dataset["toolbarItem"])).toEqual(["search", "group", "hint", "dims", "filter"]);
        // The end cluster starts at the caption.
        expect(items.filter(i => i.hasAttribute("data-toolbar-end")).map(i => i.dataset["toolbarItem"])).toEqual(["hint"]);
        const row = within(rows[0] as HTMLElement);
        expect(row.getByRole("textbox", { name: "Search library" })).toBeTruthy();
        expect(row.getByRole("button", { name: "Group by" }).textContent).toBe("Group · Category");
        expect(row.getByText("Drag onto the canvas")).toBeTruthy();
        expect(row.getByRole("button", { name: "Secondary" })).toBeTruthy();
        expect(row.getByRole("button", { name: "Filter" })).toBeTruthy();
    });

    test("a compact Library's add action is Font Awesome's plus beside its words, never a written + (#1263)", async () => {
        initializeStore(new UIStore());
        const { container } = mount(East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const said = $.let(State.bind([StringType], "library.test.add", ""));
            const onAdd = $.const(East.function([], NullType, ($2) => { $2(said.write("added")); }));
            return Stack.VStack([
                Text.Root(East.str`said ${said.read()}`),
                Library.Root([{ id: "kpi", name: "KPI rail" }], {
                    id: "things",
                    item: r => ({ key: r.id, label: r.name }),
                    addLabel: "New component",
                    onAdd,
                }),
            ]);
        }))), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        const add = screen.getByRole("button", { name: "New component" });
        expect([add.hasAttribute("data-library-footer-add"), add.textContent, faIcons(add, "plus").length]).toEqual([true, "New component", 1]);
        expect(loneGlyphs(container, ["+"])).toEqual([]);
        await act(async () => { fireEvent.click(add); });
        expect(screen.getByText("said added")).toBeTruthy();
    });
});

describe("Library — the gallery (#1030)", () => {
    /** A gallery of pages under the drag layer, with a click and an add reported into State. */
    function mountPages(layout: "grid" | "list") {
        initializeStore(new UIStore());
        const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const said = $.let(State.bind([StringType], "library.test.gallery", ""));
            const onCardClick = $.const(East.function([StringType], NullType, ($2, key) => { $2(said.write(East.str`opened ${key}`)); }));
            const onAdd = $.const(East.function([], NullType, ($2) => { $2(said.write("added")); }));
            return Stack.VStack([
                Text.Root(East.str`said ${said.read()}`),
                Library.Root([
                    { id: "overview", title: "Overview", live: true, owner: "Jamie Lee", team: "Ops" },
                    { id: "detail", title: "Account detail", live: false, owner: "Robin Kaur", team: "Ops" },
                    { id: "rollup", title: "Regional rollup", live: true, owner: "Alex Fox", team: "Finance" },
                ], {
                    id: "pages",
                    variant: "gallery",
                    layout,
                    item: r => ({
                        key: r.id,
                        label: r.title,
                        sublabel: East.str`${r.team} page`,
                        status: r.live.ifElse(
                            () => some(Library.status("Live", "success")),
                            () => some(Library.status("Draft", "neutral", true)),
                        ),
                        media: Text.Root(East.str`wire:${r.id}`),
                        avatar: r.owner,
                        byline: r.owner,
                        action: "Open in builder →",
                        placed: r.id.equal("detail"),
                        draggable: r.id.equal("rollup"),
                    }),
                    groupBy: [{ key: "team", label: "Team", value: r => r.team }],
                    search: r => r.title,
                    onCardClick,
                    addLabel: "New page from template",
                    onAdd,
                    style: { columns: 2n, mediaPlacement: "start", mediaSize: "156px" },
                }),
            ]);
        }))), getRegisteredPlatformImplementations());
        return render(
            <ChakraProvider value={system}>
                <DragLayerProvider>
                    <EastChakraComponent value={program() as ValueTypeOf<typeof UIComponentType>} storageKey="library-test" />
                </DragLayerProvider>
            </ChakraProvider>,
        );
    }

    /** A gallery card, by its key. */
    const card = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-library-card="${key}"]`)!;

    test("LG1: a gallery draws the large card; a compact Library, the default, draws today's", () => {
        const { container } = mountPages("grid");
        expect(container.querySelectorAll("[data-library-card]")).toHaveLength(3);
        cleanup();
        initializeStore(new UIStore());
        const compact = mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail" },
        ], { id: "things", item: r => ({ key: r.id, label: r.name }) })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);
        expect(compact.container.querySelector("[data-library-card]")).toBeNull();
        expect(screen.getByText("KPI rail")).toBeTruthy();
    });

    test("LG2: a card's media is its UI component, inert and hidden from assistive technology; a click on it is the card's", async () => {
        const { container } = mountPages("grid");
        const media = card(container, "overview").querySelector<HTMLElement>("[data-library-media]")!;
        expect(within(media).getByText("wire:overview")).toBeTruthy();
        expect(media.hasAttribute("inert")).toBe(true);
        expect(media.getAttribute("aria-hidden")).toBe("true");
        await act(async () => { fireEvent.click(within(media).getByText("wire:overview")); });
        expect(screen.getByText("said opened overview")).toBeTruthy();
    });

    test("LG3: the face — the name and its status as a dot and the word, the meta line, and a foot with the avatar, the byline and the action", () => {
        const { container } = mountPages("grid");
        const overview = card(container, "overview");
        expect(within(overview).getByText("Overview")).toBeTruthy();
        expect(within(overview).getByText("Ops page")).toBeTruthy();
        const live = overview.querySelector<HTMLElement>("[data-library-status]")!;
        expect([live.getAttribute("data-library-status"), live.textContent]).toEqual(["success", "Live"]);
        const draft = card(container, "detail").querySelector<HTMLElement>("[data-library-status]")!;
        expect([draft.getAttribute("data-library-status"), draft.textContent]).toEqual(["neutral", "Draft"]);
        const foot = overview.querySelector<HTMLElement>("[data-library-foot]")!;
        expect(foot.textContent).toBe("JLJamie LeeOpen in builder →");
        expect(foot.querySelector("[data-library-action]")!.textContent).toBe("Open in builder →");
    });

    test("LG4: the grid carries its columns and the media's place and size", () => {
        const { container } = mountPages("grid");
        const grid = card(container, "overview").parentElement!;
        expect([grid.getAttribute("data-layout"), grid.getAttribute("data-media")]).toEqual(["grid", "start"]);
        expect(grid.style.getPropertyValue("--library-columns")).toBe("2");
        expect(grid.style.getPropertyValue("--library-media")).toBe("156px");
    });

    test("LG5: a list puts each card on a row, its media at the start", () => {
        const { container } = mountPages("list");
        const grid = card(container, "overview").parentElement!;
        expect([grid.getAttribute("data-layout"), grid.getAttribute("data-media")]).toEqual(["list", "start"]);
        // The layout the author gives is where the toolbar's switch starts.
        expect(screen.getByRole("radio", { name: "List view" }).getAttribute("aria-checked")).toBe("true");
    });

    test("LG8: the toolbar's Grid · List switch lays the gallery out, from the pointer and the keyboard, and keeps the pick", async () => {
        const { container } = mountPages("grid");
        const layout = () => card(container, "overview").parentElement!.getAttribute("data-layout");
        const group = screen.getByRole("radiogroup", { name: "Layout" });
        // It sits at the row's end.
        expect(group.closest("[data-toolbar-item]")!.getAttribute("data-toolbar-item")).toBe("layout");
        const gridView = screen.getByRole("radio", { name: "Grid view" });
        const listView = screen.getByRole("radio", { name: "List view" });
        // One tab stop, on the checked layout.
        expect([gridView.tabIndex, listView.tabIndex]).toEqual([0, -1]);
        await act(async () => { fireEvent.click(listView); });
        expect(layout()).toBe("list");
        expect(screen.getByRole("radio", { name: "List view" }).getAttribute("aria-checked")).toBe("true");
        // ← moves to Grid and picks it.
        await act(async () => { fireEvent.keyDown(screen.getByRole("radio", { name: "List view" }), { key: "ArrowLeft" }); });
        expect(layout()).toBe("grid");
        // The pick is kept with the toolbar: mounted again, the list it was left in.
        await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "List view" })); });
        cleanup();
        const again = mountPages("grid");
        expect(card(again.container, "overview").parentElement!.getAttribute("data-layout")).toBe("list");
    });

    test("LG9: `toolbar: false` draws no toolbar row, and the gallery lays out as its host's `layout` says", () => {
        initializeStore(new UIStore());
        const { container } = mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "blank", title: "Blank grid" },
            { id: "summary", title: "Summary" },
        ], {
            id: "templates",
            variant: "gallery",
            layout: "list",
            toolbar: false,
            item: r => ({ key: r.id, label: r.title, draggable: false }),
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);
        expect(container.querySelector("[data-toolbar]")).toBeNull();
        expect(container.querySelector("[data-slot='toolbar']")).toBeNull();
        expect(screen.queryByRole("radiogroup", { name: "Layout" })).toBeNull();
        expect(card(container, "blank").parentElement!.getAttribute("data-layout")).toBe("list");
    });

    test("LG6: the dashed last card adds one, and the footer holds no add action", async () => {
        const { container } = mountPages("grid");
        const add = container.querySelector<HTMLElement>("[data-library-add]")!;
        expect(add.textContent).toBe("New page from template");
        // The last group's grid ends with it.
        expect(add.parentElement!.lastElementChild).toBe(add);
        expect(container.querySelector("[data-library-footer-add]")).toBeNull();
        await act(async () => { fireEvent.click(add); });
        expect(screen.getByText("said added")).toBeTruthy();
    });

    test("LG7: grouping, search, the placed state, drag and the keyboard click behave as the compact card's", async () => {
        const { container } = mountPages("grid");
        // Grouped by team, each group its own grid.
        expect(screen.getByText("Ops")).toBeTruthy();
        expect(screen.getByText("Finance")).toBeTruthy();
        expect(card(container, "detail").hasAttribute("data-placed")).toBe(true);
        expect(card(container, "rollup").hasAttribute("data-draggable")).toBe(true);
        // A card that cannot be dragged is a button the keyboard clicks.
        await act(async () => { fireEvent.keyDown(card(container, "overview"), { key: "Enter" }); });
        expect(screen.getByText("said opened overview")).toBeTruthy();
        // The search hides the cards it does not match.
        await act(async () => { fireEvent.change(screen.getByPlaceholderText("Search 3 items…"), { target: { value: "roll" } }); });
        expect(container.querySelectorAll("[data-library-card]")).toHaveLength(1);
        expect(screen.getByText("2 hidden by filter ·")).toBeTruthy();
    });
});

describe("Library — nothing to show (#1186)", () => {
    /** A card of a kind in a bay, as a host renderer builds it. */
    const card = (key: string, kind: string, bay: string): LibraryItemValue => ({
        key, label: key, sublabel: none, icon: none, status: none, trailing: none, draggable: false, filtered: false, placed: false,
        media: none, avatar: none, byline: none, action: none, search: some(key), groups: new Map(),
        facets: new Map([["kind", [kind]], ["bay", [bay]]]), dims: new Map(),
    });
    /** A host's Library over its cards, filtered by kind and by bay. */
    const library = (items: LibraryItemValue[]): LibraryValue => ({
        id: "things", hint: none, items, groupOptions: [], groupSummaries: new Map(), dimOptions: [], defaultDimensions: [],
        filterOptions: [{ key: "kind", label: "Kind" }, { key: "bay", label: "Bay" }], searchable: true, noun: none, addLabel: none,
        onAdd: none, onCardClick: none, slice: none, style: none, variant: none, layout: none, toolbar: true,
    });
    /** What the empty state says — its mark (each Font Awesome icon it draws, then any text), its title and the line under it — or `null` while cards show. */
    const said = (container: HTMLElement): [string | null, string, string | null] | null => {
        const empty = container.querySelector<HTMLElement>("[data-library-empty]");
        if (empty === null) return null;
        const title = within(empty).getByRole("heading");
        return [markOf(title.parentElement!.previousElementSibling), title.textContent ?? "", title.nextElementSibling?.textContent ?? null];
    };

    test("no items: the host's words as the shared empty state, and nothing when the host gives none", () => {
        const given = render(
            <ChakraProvider value={system}>
                <EastChakraLibrary value={library([])} storageKey="library-test" empty={{ title: "No templates", description: "The builder declares none." }} />
            </ChakraProvider>,
        );
        expect(said(given.container)).toEqual(["fas box-open", "No templates", "The builder declares none."]);
        expect(loneGlyphs(given.container)).toEqual([]);
        cleanup();
        const silent = render(<ChakraProvider value={system}><EastChakraLibrary value={library([])} storageKey="library-test" /></ChakraProvider>);
        expect(said(silent.container)).toBeNull();
    });

    test("a search that hides every card names what matches nothing; a filter that does says so; showing a card again clears it", async () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraLibrary value={library([card("S101", "saw", "Bay 1"), card("F401", "booth", "Bay 4")])} storageKey="library-test"
                    empty={{ title: "No registers" }} />
            </ChakraProvider>,
        );
        expect(said(container)).toBeNull();
        const search = screen.getByRole("textbox", { name: "Search library" });
        await act(async () => { fireEvent.change(search, { target: { value: " zz " } }); });
        expect(said(container)).toEqual(["fas box-open", "No matches", 'Nothing matches "zz".']);
        await act(async () => { fireEvent.change(search, { target: { value: "S1" } }); });
        expect(said(container)).toBeNull();
        await act(async () => { fireEvent.change(search, { target: { value: "" } }); });
        // A saw in Bay 4: no card is both.
        await open(screen.getByRole("button", { name: "Filter" }));
        await pick("saw");
        expect(said(container)).toBeNull();
        await pick("Bay 4");
        expect(said(container)).toEqual(["fas box-open", "No matches", "No item holds every value the filter checks."]);
        await pick("Bay 1");
        expect(said(container)).toBeNull();
    });
});

describe("Library — a host's ⏎ (#1187)", () => {
    stubScrollIntoView();
    // No drop target lies anywhere: the layer hit-tests through `elementFromPoint`, which jsdom lacks.
    beforeEach(() => { pointAt(null); });

    /** A template card: draggable, or pinned where it is. */
    const card = (key: string, draggable: boolean): LibraryItemValue => ({
        key, label: key, sublabel: none, icon: none, status: none, trailing: none, draggable, filtered: false, placed: false,
        media: none, avatar: none, byline: none, action: none, search: some(key), groups: new Map(), facets: new Map(), dims: new Map(),
    });
    /** A palette of templates whose clicks are counted. */
    const palette = (clicked: string[]): LibraryValue => ({
        id: "templates", hint: none, items: [card("edge", true), card("spray", true), card("pinned", false)],
        groupOptions: [], groupSummaries: new Map(), dimOptions: [], defaultDimensions: [], filterOptions: [], searchable: false, noun: none,
        addLabel: none, onAdd: none, onCardClick: some((key: string) => { clicked.push(key); return null; }), slice: none, style: none,
        variant: none, layout: none, toolbar: false,
    });
    /** A card, by its key. */
    const cardOf = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-library-item="${key}"]`)!;

    test("⏎ on a draggable card is the host's, and picks nothing up; Space still picks it up, and ⏎ then drops it; a card that cannot be dragged still clicks", async () => {
        const entered: string[] = [];
        const clicked: string[] = [];
        const onCardEnter = (key: string) => { entered.push(key); };
        const { container } = render(
            <ChakraProvider value={system}>
                <DragLayerProvider>
                    <EastChakraLibrary value={palette(clicked)} storageKey="library-test" onCardEnter={onCardEnter} />
                </DragLayerProvider>
            </ChakraProvider>,
        );
        const edge = cardOf(container, "edge");
        expect(edge.getAttribute("aria-keyshortcuts")).toBe("Enter");
        edge.focus();
        press("Enter");
        await tick();
        expect(entered).toEqual(["edge"]);
        expect(edge.hasAttribute("data-dragging")).toBe(false);
        expect(clicked).toEqual([]);

        // Space picks the card up, as on every draggable; ⏎ drops it — no drop target here, so not dropped — and is not the host's.
        cardOf(container, "spray").focus();
        press("Space");
        await tick();
        expect(cardOf(container, "spray").hasAttribute("data-dragging")).toBe(true);
        press("Enter");
        await tick();
        expect(cardOf(container, "spray").hasAttribute("data-dragging")).toBe(false);
        expect(announced()).toBe("spray was not dropped.");
        expect(entered).toEqual(["edge"]);

        // A card that cannot be dragged is a button: ⏎ clicks it.
        const pinned = cardOf(container, "pinned");
        expect(pinned.hasAttribute("aria-keyshortcuts")).toBe(false);
        await act(async () => { fireEvent.keyDown(pinned, { key: "Enter" }); });
        expect(clicked).toEqual(["pinned"]);
        expect(entered).toEqual(["edge"]);
    });

    test("without a host's ⏎, Enter picks a draggable card up, as it always has", async () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <DragLayerProvider>
                    <EastChakraLibrary value={palette([])} storageKey="library-test" />
                </DragLayerProvider>
            </ChakraProvider>,
        );
        const edge = cardOf(container, "edge");
        expect(edge.hasAttribute("aria-keyshortcuts")).toBe(false);
        edge.focus();
        press("Enter");
        await tick();
        expect(edge.hasAttribute("data-dragging")).toBe(true);
        press("Escape");
        await tick();
        expect(edge.hasAttribute("data-dragging")).toBe(false);
    });
});
