/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Library>` (#997, #1762) rendered over the studio examples' pages
 * record on e3 (#1376), its pages the test's, committed as another session's:
 *
 * - **The frame**: one `BuilderFrame` — its toolbar holding Pages · Templates,
 *   the rail's fields of the view shown and New page, over the cards — with no
 *   pane, and no search, Sort or layout switch of its own; nothing says Live
 *   or Draft (L9).
 * - **The cards**: a page a card, in the order e3 pages them — a wireframe of
 *   its layout, its title, what it places, its tags, and its project and how
 *   many components it places; the templates the same, under Templates.
 * - **Opening** (L6): a press on a page's card, or ⏎ or Space on it, tells the
 *   host its page and does nothing else; the page the host says is open is
 *   marked.
 * - **A new page** (L10, L12): from New page or a template's card, a name, the
 *   project where the rail has chosen none, and tags; one commit, the page the
 *   template's layout or a blank grid; then the host is told. A name the
 *   project holds is refused by the commit, in the popover.
 * - **What it reads**: the record a window at a time through its indexes —
 *   never whole — and again as it moves; with no row, and with a narrowing
 *   that leaves none, it says so.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East, NullType, SortedSet, StringType, compareFor, decodeBeast2For, equalFor, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import {
    Reactive, RecordSlicesChromeType, Slice, Stack, State, Text, UIComponentType, recordSlicesChrome, type RecordSliceBindType,
} from "@elaraai/east-ui/internal";
import { StateRuntime, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { Data, Record, Studio, StudioKeyType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
// The page library is an extension: its renderer registers as it loads.
import "./library.js";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Pages = ValueTypeOf<typeof Studio.Types.Pages>;

const sameEntry = equalFor(Studio.Types.Entry);
const printText = printFor(StringType);
const tagsOf = (...tags: string[]) => new SortedSet<string>(tags, compareFor(StringType));

/** The listed components. */
const components = [
    Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" },
        East.function([], UIComponentType, (_$) => Text.Root("KPIs"))),
    Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
        East.function([], UIComponentType, (_$) => Text.Root("Trend"))),
];

/** In ops, the Detail never published, the Overview live and tagged, the Weekly drafted past its live version, and two templates; a retail page. */
const ENTRIES: Parameters<typeof Studio.value>[0] = [
    {
        key: { project: "ops", page: "a-detail" },
        draft: {
            title: "Detail",
            cells: [
                { key: "c-trend", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        },
    },
    {
        key: { project: "ops", page: "b-overview" },
        tags: ["operations", "weekly"],
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi-1", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-kpi-2", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        },
        live: {
            version: 2n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi-1", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "c-kpi-2", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                ],
                filters: [],
            },
        },
    },
    {
        key: { project: "ops", page: "c-weekly" },
        draft: { title: "Weekly", cells: [], filters: [] },
        live: { version: 1n, page: { title: "Weekly (old)", cells: [], filters: [] } },
    },
    { key: { project: "ops", page: "t-empty" }, template: { title: "Empty", cells: [], filters: [] } },
    {
        key: { project: "ops", page: "t-summary" },
        template: {
            title: "Summary",
            cells: [
                { key: "c-kpi-1", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-kpi-2", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        },
    },
    {
        key: { project: "retail", page: "home" },
        draft: { title: "Home", cells: [], filters: [] },
        live: { version: 1n, page: { title: "Home", cells: [], filters: [] } },
    },
];
const PAGES: Pages = Studio.value(ENTRIES);

/** The pages' titles, and the templates', in the order e3 pages them: each kind's in its keys' order. */
const PAGE_TITLES = ["Detail", "Overview", "Weekly", "Home"];
const TEMPLATE_TITLES = ["Empty", "Summary"];

// The cards are read a window at a time into a measured view: the harness measures one.
const h = e3Harness({ "studio/studio": ex }, { measure: true });

/** The pages record's commits once the test's own pages were made: what a new page adds to. */
let before: string[] = [];

beforeEach(async () => {
    await h.patch(ex.studioPages, PAGES);
    before = await commits();
});

/** The indexes the examples' pages record declares: what the rail's sources page through. */
const INDEXES = ["pages_by_kind", "pages_by_kind_project", "pages_by_kind_tag", "pages_by_kind_title"] as const;
/** The rail's key: the mounted library's, and the one a test narrows through. */
const RAIL = "library-test.rail";

/** The rail: the pages and — unless asked otherwise — the templates, each scoped to its kind of entry. */
function rail(templates = true) {
    const rows = {
        source: Data.bindPaged(ex.studioPages, { indexes: [...INDEXES] }), label: "Pages", scope: { kind: ["page" as const] }, search: ["title" as const, "project" as const, "tags" as const],
        fields: { title: { label: "Name" }, project: { label: "Project" }, tags: { label: "Tag" } },
    };
    return templates
        ? Slice.bindRecords(RAIL, {
            rows,
            templates: {
                source: Data.bindPaged(ex.studioPages, { indexes: [...INDEXES] }), label: "Templates", scope: { kind: ["template" as const] }, search: ["title" as const],
                fields: { title: { label: "Name" } },
            },
        })
        : Slice.bindRecords(RAIL, { rows });
}

/** The rail as a test writes it: the same sources under the library's key, its controls as the toolbar's chips use them. */
const railChrome = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({ slice: rail() }))), getRegisteredPlatformImplementations());

/**
 * The pages' part of the mounted library's rail: what a test chooses a field's values through, as a chip does.
 *
 * @returns Its controls
 */
function pagesRail(): ValueTypeOf<RecordSliceBindType> {
    return railChrome().slice.parts.find((part) => part.source === "rows")!.slice;
}

/** Where the surface holds the page open in its builder. */
const OPEN = "library-test.open";

/**
 * The page library over the record, as a surface mounts it: the record bound to write, its rows paged through the rail,
 * and the open page the surface holds — the Detail to begin with — given to it, and written when told of another, with
 * a line saying which page is open. Given no open page, it is told which page was asked for, and says so.
 */
function surface(options: { marked?: boolean; templates?: boolean } = {}) {
    return {
        fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            const record = $.let(Record.bind(ex.studioPages, ["patch"]));
            const slice = $.let(rail(options.templates !== false));
            const open = $.let(State.bind([StudioKeyType], OPEN, { project: "ops", page: "a-detail" }));
            const onOpen = $.const(East.function([StudioKeyType], NullType, ($2, key) => { $2(open.write(key)); }));
            const page = $.let(open.read());
            const library = $.let(options.marked === false
                ? Studio.Library({ pages: record, components: listed, project: "ops", slice: { slice }, onOpen })
                : Studio.Library({ pages: record, components: listed, project: "ops", slice: { slice }, page, onOpen }));
            return Stack.VStack([Text.Root(East.str`open ${page.project}/${page.page}`), library]);
        }))),
    };
}

/** The page the surface holds as open. */
function hostPage(): Key | undefined {
    const bytes = StateRuntime.getStore().read(OPEN);
    return bytes === undefined ? undefined : decodeBeast2For(StudioKeyType)(bytes);
}

/** The entry a page library and a builder once shared by id: nothing writes it (#1668). */
const sharedEntry = () => StateRuntime.getStore().read("studio.builder.page");

/** The record as e3 holds it now. */
const readRecord = (): Promise<Pages> => h.read(ex.studioPages);

/** The mutations the record committed, newest first. */
async function commits(): Promise<string[]> {
    return (await h.history(ex.studioPages)).commits.map((c) => c.mutation);
}

/** The cards, in order. */
const cards = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-library-gallery] [data-library-card]")];
/** The cards' titles, in order. */
const titles = (container: HTMLElement) => cards(container).map((card) => card.querySelector("[data-library-title]")!.textContent);
/** A card, by its title. */
const cardOf = (container: HTMLElement, title: string) => cards(container).find((card) => card.querySelector("[data-library-title]")!.textContent === title)!;
/** A part of a card — the Library's gallery card's — as it reads; `undefined` where the card draws none. */
const partOf = (card: HTMLElement, part: string) => card.querySelector(`[data-library-${part}]`)?.textContent;
/** A card's tags. */
const tagsShownOn = (card: HTMLElement) => [...card.querySelectorAll('[data-library-dim="tags"] > *')].map((tag) => tag.textContent);
/** The cards marked as the page open in the builder. */
const marked = (container: HTMLElement) => cards(container).filter((card) => card.hasAttribute("data-placed")).map((card) => card.querySelector("[data-library-title]")!.textContent);
/** The toolbar's words. */
const toolbarSays = (container: HTMLElement) => slot(container, "toolbar").textContent ?? "";
/** The New page popover. */
const popover = () => within(screen.getByRole("dialog"));
/** A field of the popover's form, by its label. */
const fieldOf = (label: string) => popover().getByText(label).closest<HTMLElement>("[data-field]")!;
/** The popover's project field's box, by its label; `null` while it has none. */
const projectBox = () => popover().queryByText("Project")?.closest<HTMLElement>("[data-field]")!.querySelector<HTMLInputElement>("input") ?? null;
/** The popover's tags box. */
const tagsBox = () => fieldOf("Tags").querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;
/** Whether the popover has closed. */
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

/** A press on an element, and what it leads to settled. */
async function press(el: Element) {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** Mounts the library, and waits for its first cards. */
async function mount(options: { marked?: boolean; templates?: boolean } = {}) {
    const mounted = await h.mount(surface(options), { storageKey: "studio-library" });
    await vi.waitFor(() => expect(cards(mounted.container).length).toBeGreaterThan(0));
    await settle();
    return mounted;
}

/** Shows the templates, and waits for their cards. */
async function showTemplates(container: HTMLElement) {
    await press(within(slot(container, "toolbar")).getByRole("radio", { name: "Templates" }));
    await vi.waitFor(() => expect(titles(container)).toEqual(TEMPLATE_TITLES));
}

/** Names the page in the open popover, and presses Create page. */
async function create(name: string) {
    await act(async () => { fireEvent.change(popover().getByRole("textbox", { name: "Page name" }), { target: { value: name } }); });
    await press(popover().getByRole("button", { name: "Create page" }));
}

describe("<Studio.Library> — its frame (#1762)", () => {
    test("one BuilderFrame: the toolbar holding Pages · Templates, the pages' rail fields and New page, over the cards — with no pane, and no search, Sort or layout switch of its own; nothing says Live or Draft (L9)", async () => {
        const { container } = await mount();
        expect(container.querySelectorAll("[data-builder-frame]")).toHaveLength(1);
        const toolbar = slot(container, "toolbar");
        const views = within(toolbar).getByRole("radiogroup", { name: "Pages or templates" });
        expect(within(views).getAllByRole("radio").map((radio) => [radio.textContent, radio.getAttribute("aria-checked")])).toEqual([["Pages", "true"], ["Templates", "false"]]);
        expect([...toolbar.querySelectorAll("[data-record-slice-field]")].map((field) => field.textContent)).toEqual(["Name", "Project", "Tag"]);
        expect(within(toolbar).getByRole("button", { name: "New page" })).toBeTruthy();
        expect(slot(container, "main").querySelector("[data-library-gallery]")).not.toBeNull();
        expect([container.querySelector('[data-frame-slot="start"]'), container.querySelector('[data-frame-slot="end"]')]).toEqual([null, null]);
        expect([screen.queryByRole("textbox", { name: "Search pages and templates" }), screen.queryByRole("button", { name: "Sort · Name" }), screen.queryByRole("radiogroup", { name: "Layout" })])
            .toEqual([null, null, null]);
        expect(container.textContent).not.toMatch(/\b(Live|Draft)\b/);
        // It has no recipe of its own: the frame, the grid, a card and New page are the shared ones'.
        expect(system._config.theme?.slotRecipes?.["studioLibrary"]).toBeUndefined();
    });

    test("a slice with no `templates` source has no Pages · Templates: its cards are the pages", async () => {
        const { container } = await mount({ templates: false });
        expect(within(slot(container, "toolbar")).queryByRole("radiogroup", { name: "Pages or templates" })).toBeNull();
        expect(titles(container)).toEqual(PAGE_TITLES);
    });
});

describe("<Studio.Library> — its cards (#1762)", () => {
    test("a page a card, in the order e3 pages them: a wireframe of its layout, its title, what it places, its tags, and its project and how many components it places, with Open in builder", async () => {
        const { container } = await mount();
        expect(titles(container)).toEqual(PAGE_TITLES);
        const overview = cardOf(container, "Overview");
        expect([partOf(overview, "sublabel"), partOf(overview, "byline"), partOf(overview, "action")])
            .toEqual(["KPI rail ×2 · Revenue trend", "ops · 3 components", "Open in builder →"]);
        expect(tagsShownOn(overview)).toEqual(["operations", "weekly"]);
        expect(overview.querySelectorAll("[data-library-media] [data-snap-grid-variant=wireframe] [data-snap-grid-cell]")).toHaveLength(3);
        const detail = cardOf(container, "Detail");
        expect([partOf(detail, "sublabel"), partOf(detail, "byline"), tagsShownOn(detail)]).toEqual(["Revenue trend", "ops · 1 component", []]);
        // A layout that places nothing says so; a page of another project names it.
        expect([partOf(cardOf(container, "Weekly"), "sublabel"), partOf(cardOf(container, "Home"), "byline")]).toEqual(["12-col · empty", "retail · 0 components"]);
    });

    test("under Templates, a template a card — its wireframe, its title, what it places — with Start a page; the rail is the templates'", async () => {
        const { container } = await mount();
        await showTemplates(container);
        const summary = cardOf(container, "Summary");
        expect([partOf(summary, "sublabel"), partOf(summary, "byline"), partOf(summary, "action")]).toEqual(["KPI rail ×2 · Revenue trend", "ops · 3 components", "Start a page →"]);
        expect(summary.querySelectorAll("[data-library-media] [data-snap-grid-cell]")).toHaveLength(3);
        expect([...slot(container, "toolbar").querySelectorAll("[data-record-slice-field]")].map((field) => field.textContent)).toEqual(["Name"]);
        // No page's card is marked among the templates.
        expect(marked(container)).toEqual([]);
    });
});

describe("<Studio.Library> — opening a page (#1762 L6)", () => {
    test("the page its host says is open is marked; a press on another page's card tells the host its page, and writes nothing itself", async () => {
        const { container } = await mount();
        expect(marked(container)).toEqual(["Detail"]);
        expect(partOf(cardOf(container, "Detail"), "status")).toBe("Open");
        await press(cardOf(container, "Overview"));
        expect([hostPage(), screen.getByText(/^open /).textContent, marked(container)]).toEqual([{ project: "ops", page: "b-overview" }, "open ops/b-overview", ["Overview"]]);
        expect(sharedEntry()).toBeUndefined();
    });

    test("⏎ and Space on a card, the keyboard on it, each tell the host its page; ⌘ or Ctrl ⏎ tells nothing", async () => {
        const { container } = await mount();
        const weekly = cardOf(container, "Weekly");
        expect([weekly.getAttribute("role"), weekly.tabIndex]).toEqual(["button", 0]);
        await act(async () => { weekly.focus(); fireEvent.keyDown(weekly, { key: "Enter", metaKey: true }); fireEvent.keyDown(weekly, { key: "Enter", ctrlKey: true }); });
        await settle();
        expect(hostPage()).toEqual({ project: "ops", page: "a-detail" });
        await act(async () => { fireEvent.keyDown(weekly, { key: "Enter" }); });
        await settle();
        expect(hostPage()).toEqual({ project: "ops", page: "c-weekly" });
        await act(async () => { fireEvent.keyDown(cardOf(container, "Home"), { key: " " }); });
        await settle();
        expect([hostPage(), marked(container)]).toEqual([{ project: "retail", page: "home" }, ["Home"]]);
    });

    test("#1668: given no open page it marks none, and a card's press still tells its host", async () => {
        const { container } = await mount({ marked: false });
        expect(marked(container)).toEqual([]);
        await press(cardOf(container, "Weekly"));
        expect([hostPage(), marked(container), sharedEntry()]).toEqual([{ project: "ops", page: "c-weekly" }, [], undefined]);
    });
});

describe("<Studio.Library> — a new page (#1762 L10, L12)", () => {
    test("from New page: a blank grid, the project offered, and tags — one commit inserting the page, its tags kept, never published; the popover closes, and the host is told the new page", async () => {
        const { container } = await mount();
        await press(within(slot(container, "toolbar")).getByRole("button", { name: "New page" }));
        expect(screen.getByRole("button", { name: "New page" }).closest("[data-part=trigger]")!.getAttribute("data-state")).toBe("open");
        expect(popover().getByText("Starts as a blank grid.")).toBeTruthy();
        expect(projectBox()!.value).toBe("ops");
        await act(async () => { fireEvent.change(projectBox()!, { target: { value: "retail" } }); });
        const user = userEvent.setup();
        await user.click(tagsBox());
        await user.type(tagsBox(), "floor {Enter}");
        await settle();
        await create("Q3 review");
        await closed();
        expect(await commits()).toEqual(["patch", ...before]);
        const key: Key = { project: "retail", page: "Q3 review" };
        const expected: Entry = {
            kind: variant("page", null), project: "retail", title: "Q3 review", tags: tagsOf("floor"),
            draft: { title: "Q3 review", cells: [], filters: [] }, live: none,
        };
        expect(sameEntry((await readRecord()).get(key)!, expected)).toBe(true);
        expect([hostPage(), screen.getByText(/^open /).textContent]).toEqual([key, "open retail/Q3 review"]);
        await vi.waitFor(() => expect(titles(container)).toContain("Q3 review"));
    });

    test("from a template's card: New page opens, starting from it — the page's draft its placements — and the host is told the new page", async () => {
        const { container } = await mount();
        await showTemplates(container);
        await press(cardOf(container, "Summary"));
        expect(screen.getByRole("button", { name: "New page" }).closest("[data-part=trigger]")!.getAttribute("data-state")).toBe("open");
        expect(popover().getByText("Starts from Summary.")).toBeTruthy();
        await create("Board");
        await closed();
        const page = (await readRecord()).get({ project: "ops", page: "Board" })!;
        expect([page.kind.type, page.draft.cells.map((c) => c.key), page.live.type]).toEqual(["page", ["c-kpi-1", "c-kpi-2", "c-trend"], "none"]);
        expect(hostPage()).toEqual({ project: "ops", page: "Board" });
    });

    test("a name the project holds — a page's or a template's — is refused by the commit, in the popover, which stays open; a page with no project is refused before it is written", async () => {
        const { container } = await mount();
        await press(within(slot(container, "toolbar")).getByRole("button", { name: "New page" }));
        await create("a-detail");
        await vi.waitFor(() => expect(popover().getByRole("alert").textContent).toBe("Another write took the name a-detail first — choose another"));
        await create("t-summary");
        await vi.waitFor(() => expect(popover().getByRole("alert").textContent).toBe("Another write took the name t-summary first — choose another"));
        await act(async () => { fireEvent.change(projectBox()!, { target: { value: "  " } }); });
        await create("Somewhere");
        await vi.waitFor(() => expect(popover().getByRole("alert").textContent).toBe("Give the page a project to create it."));
        expect(await commits()).toEqual(before);
        expect(hostPage()).toEqual({ project: "ops", page: "a-detail" });
    });

    test("L12: the rail narrowed to one project, New page names it, asks for no project, and makes the page there; the rail narrows the cards and their count", async () => {
        const { container } = await mount();
        await act(async () => { pagesRail().choose("project", [printText("retail")]); });
        await vi.waitFor(() => expect(titles(container)).toEqual(["Home"]));
        expect(toolbarSays(container)).toContain("1 of 4 pages");
        await press(within(slot(container, "toolbar")).getByRole("button", { name: "New page in retail" }));
        expect(popover().getByText("New page ·").textContent).toBe("New page · retail");
        expect(projectBox()).toBeNull();
        await create("Shop floor");
        await closed();
        expect((await readRecord()).get({ project: "retail", page: "Shop floor" })?.kind.type).toBe("page");
        expect(hostPage()).toEqual({ project: "retail", page: "Shop floor" });
    });
});

describe("<Studio.Library> — what it reads (#1762)", () => {
    test("opening the library and a page from it never reads the record whole, and writes nothing: its cards are e3's pages", async () => {
        const { container } = await mount();
        await press(cardOf(container, "Overview"));
        expect(h.requests("read").filter((request) => request.record === ex.studioPages.name)).toEqual([]);
        expect(h.requests("mutate")).toEqual([]);
    });

    test("a page made meanwhile — in another session — shows as the record moves", async () => {
        const { container } = await mount();
        const next = Studio.value([...ENTRIES, { key: { project: "ops", page: "d-later" }, draft: { title: "Later", cells: [], filters: [] } }]);
        await act(async () => { await h.patch(ex.studioPages, next); });
        await vi.waitFor(() => expect(titles(container)).toEqual(["Detail", "Overview", "Weekly", "Later", "Home"]));
    });

    test("with no page it says so, and what to do; a narrowing that leaves none says so, and its Clear filters brings every card back", async () => {
        const { container } = await mount();
        await act(async () => { pagesRail().choose("tags", [printText("nothing-tagged-so")]); });
        await vi.waitFor(() => expect(container.querySelector("[data-library-empty]")).not.toBeNull());
        const empty = container.querySelector<HTMLElement>("[data-library-empty]")!;
        expect(empty.textContent).toContain("No pages match the filters");
        await press(within(empty).getByRole("button", { name: /Clear filters/ }));
        await vi.waitFor(() => expect(titles(container)).toEqual(PAGE_TITLES));

        const templatesOnly = Studio.value([{ key: { project: "ops", page: "t-empty" }, template: { title: "Empty", cells: [], filters: [] } }]);
        await act(async () => { await h.patch(ex.studioPages, templatesOnly); });
        await vi.waitFor(() => expect(container.querySelector("[data-library-empty]")?.textContent).toContain("No pages yet"));
        expect(container.querySelector("[data-library-empty]")!.textContent).toContain("Start one with New page.");
    });
});
