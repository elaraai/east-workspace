/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * What a paged palette says when its source holds no row (#1341): its host's
 * narrowing's words and Clear filters while a builder's rail pages it, else its
 * host's words, else its own — the Library's empty state in each. And its own
 * search (#1340, ruling 11): the Library's search box, finding within the tab
 * alone — through its source's part of the rail, by a prefix of a field the
 * source lists in `search`, within the rail's choices — its text the tab's own,
 * never the rail's state; what it hides counted in its footer with Show all; a
 * search that finds nothing, or one the rail's choices block, saying so.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, StringType, decodeBeast2For, encodeBeast2For, none, printFor, some, variant, type option, type ValueTypeOf } from "@elaraai/east";
import {
    Library, RecordSliceConfigType, RecordSliceStateType, RecordSliceWhereType, UIComponentType, recordChoiceWhere,
    type RecordSliceBindType, type RecordSliceChoiceType, type RecordSliceFieldType,
} from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { getStore, initializeStore, trackKey } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity.js";
import { system } from "../../theme/index.js";
import type { LibraryItemValue, LibraryValue } from "./index.js";
import { PagedLibrary, type LibraryPageSource, type PagedLibrarySearch } from "./paged.js";
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom lays nothing out: the palette's rows get a viewport, as a pane gives them one.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return this.closest("[data-library-paged]") === null ? offsetHeight.get!.call(this) : 480; } });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) { return this.closest("[data-library-paged]") === null ? offsetWidth.get!.call(this) : 272; } });
});
afterAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
});
beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => { cleanup(); localStorage.clear(); });

const program = East.compile(East.function([], UIComponentType, _$ => Library.Root([
    { key: "a", name: "Alder" }, { key: "b", name: "Birch" },
], { id: "trees", item: t => ({ key: t.key, label: t.name }) })), getRegisteredPlatformImplementations());
function cards(): LibraryItemValue[] {
    const component = program() as ValueTypeOf<typeof UIComponentType>;
    if (component.type !== "Library") throw new Error("Expected Library");
    return (component.value as LibraryValue).items;
}
/** A source holding these rows, read whole. */
function source(rows: readonly LibraryItemValue[]): LibraryPageSource<LibraryItemValue> {
    return { id: `trees.${rows.length}`, page: (offset, limit) => some(rows.slice(Number(offset), Number(offset + limit))), total: () => some(BigInt(rows.length)), revision: () => some("r1") };
}
const narrowing = (onClear: () => void) => ({ empty: { title: "No trees match the filters", description: "Change or clear the filters to see more trees." }, onClear });
function paged(rows: readonly LibraryItemValue[], props: Partial<Parameters<typeof PagedLibrary<LibraryItemValue>>[0]> = {}) {
    return <ChakraProvider value={system}><PagedLibrary source={source(rows)} id="trees" item={row => row} onOpen={() => {}} {...props} /></ChakraProvider>;
}
const emptyState = () => document.querySelector<HTMLElement>("[data-library-empty]");

describe("a paged palette with no row (#1341)", () => {
    test("while its host's narrowing pages it: the narrowing's words, the Library's open box, and Clear filters", async () => {
        const onClear = vi.fn();
        render(paged([], { empty: { title: "No trees" }, narrowing: narrowing(onClear) }));
        const empty = emptyState()!;
        expect(empty.hasAttribute("data-narrowed")).toBe(true);
        expect(within(empty).getByText("No trees match the filters")).toBeTruthy();
        expect(within(empty).getByText("Change or clear the filters to see more trees.")).toBeTruthy();
        expect(empty.querySelector("svg")!.getAttribute("data-icon")).toBe("box-open");
        await act(async () => { fireEvent.click(within(empty).getByRole("button", { name: "Clear filters" })); });
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    test("with no narrowing in force, its host's words and no Clear filters; with neither, its own", () => {
        const { unmount } = render(paged([], { empty: { title: "No trees" } }));
        expect([emptyState()!.hasAttribute("data-narrowed"), within(emptyState()!).getByText("No trees") !== null]).toEqual([false, true]);
        expect(within(emptyState()!).queryByRole("button", { name: "Clear filters" })).toBeNull();
        unmount();
        render(paged([]));
        expect(within(emptyState()!).getByText("No matches")).toBeTruthy();
        expect(within(emptyState()!).getByText("Change or clear the filters to see more records.")).toBeTruthy();
    });

    test("with rows, the narrowing says nothing", () => {
        render(paged(cards(), { narrowing: narrowing(() => {}) }));
        expect(emptyState()).toBeNull();
        expect(document.querySelector("[data-library-paged]")).not.toBeNull();
    });
});

// ── A new narrowing on its way (#1398, CL8; #1424) ──────────────────────────

describe("a new narrowing on its way never blinks (#1398, CL8; #1424)", () => {
    const GATE = "trees.gate";
    const gate = encodeBeast2For(StringType);
    /**
     * A live source — one id under every narrowing — whose narrowing `query` is read at `revision` once the gate opens:
     * until then its count and its pages are on their way.
     */
    function live(query: string, rows: readonly LibraryItemValue[], open: () => boolean, revision = "r1"): LibraryPageSource<LibraryItemValue> {
        const landed = () => { trackKey(GATE); return open(); };
        return {
            id: "trees", query: () => query, revision: () => some(revision),
            total: () => (landed() ? some(BigInt(rows.length)) : none),
            page: (offset, limit) => (landed() ? some(rows.slice(Number(offset), Number(offset + limit))) : none),
        };
    }
    const keys = () => [...document.querySelectorAll<HTMLElement>("[data-library-paged] [data-library-item]")].map(card => card.dataset.libraryItem);
    const busy = () => document.querySelector<HTMLElement>("[data-library-paged] [aria-busy]");
    const skeletons = () => document.querySelectorAll('[data-library-paged] [aria-label="Loading record"]').length;

    test("the rows that last landed stand in, retained — aria-disabled in a busy region, no pending rows — until the new narrowing's count and first rows land, then its own, swapped whole", async () => {
        getStore().write(GATE, gate("shut"));
        let open = false;
        const trees = cards();
        const view = (source: LibraryPageSource<LibraryItemValue>) => <ChakraProvider value={system}><PagedLibrary source={source} id="trees" item={row => row} onOpen={() => {}} /></ChakraProvider>;
        const { rerender } = render(view(live("all", trees, () => true)));
        await waitFor(() => expect(keys()).toEqual(["a", "b"]));
        expect(busy()).toBeNull();
        // The rail chooses Birch: its count and its rows on their way, Alder and Birch stand in, retained.
        rerender(view(live("birch", [trees[1]!], () => open)));
        expect(keys()).toEqual(["a", "b"]);
        expect([busy()?.getAttribute("aria-busy"), busy()?.getAttribute("aria-disabled")]).toEqual(["true", "true"]);
        expect(skeletons()).toBe(0);
        // Landed: Birch alone, its own, nothing retained.
        open = true;
        await act(async () => { getStore().write(GATE, gate("open")); });
        await waitFor(() => expect(keys()).toEqual(["b"]));
        expect([busy(), skeletons()]).toEqual([null, 0]);
    });

    test("a new revision of the same narrowing — a commit's — keeps the rows that landed standing in, retained, until its own land, then shows them", async () => {
        getStore().write(GATE, gate("shut"));
        let open = false;
        const trees = cards();
        const view = (source: LibraryPageSource<LibraryItemValue>) => <ChakraProvider value={system}><PagedLibrary source={source} id="trees" item={row => row} onOpen={() => {}} /></ChakraProvider>;
        const { rerender } = render(view(live("all", trees, () => true)));
        await waitFor(() => expect(keys()).toEqual(["a", "b"]));
        // A commit: the same narrowing at a new revision, Alder gone, its rows on their way.
        rerender(view(live("all", [trees[1]!], () => open, "r2")));
        expect(keys()).toEqual(["a", "b"]);
        expect([busy()?.getAttribute("aria-busy"), busy()?.getAttribute("aria-disabled"), skeletons()]).toEqual(["true", "true", 0]);
        open = true;
        await act(async () => { getStore().write(GATE, gate("open")); });
        await waitFor(() => expect(keys()).toEqual(["b"]));
        expect([busy(), skeletons()]).toEqual([null, 0]);
    });

    test("a read again of the rows it showed — the same narrowing at the same revision, its windows let go meanwhile — keeps them, never the pending rows over them, until they land again", async () => {
        getStore().write(GATE, gate("shut"));
        let open = false;
        const trees = cards();
        const view = (source: LibraryPageSource<LibraryItemValue>) => <ChakraProvider value={system}><PagedLibrary source={source} id="trees" item={row => row} onOpen={() => {}} /></ChakraProvider>;
        const { rerender } = render(view(live("all", trees, () => true)));
        await waitFor(() => expect(keys()).toEqual(["a", "b"]));
        // Its host makes it again over the same narrowing and revision, whose count and windows are read again.
        rerender(view(live("all", trees, () => open)));
        expect([keys(), skeletons(), busy()]).toEqual([["a", "b"], 0, null]);
        open = true;
        await act(async () => { getStore().write(GATE, gate("open")); });
        await waitFor(() => expect(keys()).toEqual(["a", "b"]));
        expect([skeletons(), busy()]).toEqual([0, null]);
    });

    test("a new count at the same revision — its host's drafts moving its rows, its windows let go meanwhile — keeps the rows that landed standing in, retained, never at places they no longer hold, until its own land", async () => {
        getStore().write(GATE, gate("shut"));
        let open = false;
        const trees = cards();
        const cedar: LibraryItemValue = { ...trees[0]!, key: "c", label: "Cedar" };
        const view = (source: LibraryPageSource<LibraryItemValue>) => <ChakraProvider value={system}><PagedLibrary source={source} id="trees" item={row => row} onOpen={() => {}} /></ChakraProvider>;
        const { rerender } = render(view(live("all", trees, () => true)));
        await waitFor(() => expect(keys()).toEqual(["a", "b"]));
        // A draft puts Cedar first: the same narrowing at the same revision, counted at once, its rows on their way.
        const moved = [cedar, ...trees];
        rerender(view({ ...live("all", moved, () => open), total: () => some(BigInt(moved.length)) }));
        expect([keys(), skeletons()]).toEqual([["a", "b"], 0]);
        expect([busy()?.getAttribute("aria-busy"), busy()?.getAttribute("aria-disabled")]).toEqual(["true", "true"]);
        open = true;
        await act(async () => { getStore().write(GATE, gate("open")); });
        await waitFor(() => expect(keys()).toEqual(["c", "a", "b"]));
        expect([skeletons(), busy()]).toEqual([0, null]);
    });

    test("only the first read draws the pending rows: with nothing landed yet, a narrowing on its way shows them", async () => {
        getStore().write(GATE, gate("shut"));
        render(<ChakraProvider value={system}><PagedLibrary source={live("all", cards(), () => false)} id="trees" item={row => row} onOpen={() => {}} /></ChakraProvider>);
        expect(skeletons()).toBeGreaterThan(0);
        expect([keys(), busy()]).toEqual([[], null]);
    });
});

// ── Its own search (#1340, ruling 11) ───────────────────────────────────────

type Bind = ValueTypeOf<RecordSliceBindType>;
type Field = ValueTypeOf<RecordSliceFieldType>;
type Choice = ValueTypeOf<RecordSliceChoiceType>;
type Where = ValueTypeOf<RecordSliceWhereType>;
type State = ValueTypeOf<RecordSliceStateType>;

const KEY = "depot.flows";
const encodeState = encodeBeast2For(RecordSliceStateType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const printWhere = printFor(RecordSliceWhereType);
const printString = printFor(StringType);

/** A flow of the depot's: its name, its lane and its kind. */
interface Flow { readonly name: string; readonly lane: string; readonly kind: string }
const FLOWS: readonly Flow[] = [
    { name: "FLOW-100", lane: "intake", kind: "inbound" },
    { name: "FLOW-101", lane: "review", kind: "inbound" },
    { name: "FLOW-110", lane: "review", kind: "returns" },
    { name: "FLOW-200", lane: "intake", kind: "returns" },
    { name: "ROUTE-1", lane: "review", kind: "inbound" },
];

const field = (fieldId: string, label: string, hints: readonly string[]): Field => ({ fieldId, label, kind: "string", optional: false, multiple: true, set: false,
    values: hints.map(value => ({ value: printString(value), label: value })), format: none });

/** Whether a flow holds the narrowing — the stand-in server's own reading, as e3 answers a narrowing from its indexes. */
function holds(flow: Flow, where: Where): boolean {
    for (const [name, choice] of where) {
        const value = flow[name as keyof Flow];
        if (choice.type === "values" && !choice.value.includes(printString(value))) return false;
        if (choice.type === "prefix" && !value.startsWith(choice.value)) return false;
    }
    return true;
}
const served = (where: Where) => FLOWS.filter(flow => holds(flow, where));

/**
 * The flows' part of a builder's rail, over the shared store: by name, by lane then name, and by kind alone — so a
 * name's prefix follows a lane's choice, and never a kind's. Its counts and pages are the stand-in server's.
 */
function flowsPart(): Bind & { countWhere: ReturnType<typeof vi.fn<Bind["countWhere"]>> } {
    const config = decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)({
        fields: [field("name", "Name", []), field("lane", "Lane", ["intake", "review"]), field("kind", "Kind", ["inbound", "returns"])],
        indexes: [
            { name: "name", fields: ["name"], sets: new Set<string>(), structured: false, interval: none, area: none, series: none, summary: none },
            { name: "lane_name", fields: ["lane", "name"], sets: new Set<string>(), structured: true, interval: none, area: none, series: none, summary: none },
            { name: "kind", fields: ["kind"], sets: new Set<string>(), structured: false, interval: none, area: none, series: none, summary: none },
        ],
        range: none, search: ["name"], presets: [],
    }));
    if (getStore().read(KEY) === undefined) getStore().write(KEY, encodeState({ where: new Map(), preset: none, resolution: none }));
    const read = (): State => { trackKey(KEY); return decodeState(getStore().read(KEY)!); };
    const write = (state: State) => { getStore().write(KEY, encodeState(state)); return null; };
    const choose = (id: string, choice: Choice | undefined) => {
        const where = recordChoiceWhere(config.indexes, read().where, id, choice);
        if (where === null) throw new Error("Choose a preceding field");
        return write({ ...read(), where, preset: none });
    };
    const countWhere = vi.fn<Bind["countWhere"]>((where) => some(BigInt(served(where).length)));
    const clearAll = () => write({ ...read(), where: new Map(), preset: none });
    return { key: KEY, config, sourceId: "depot_flows", read, write,
        choose: (id, values) => choose(id, values.length === 0 ? undefined : variant("values", values)),
        range: (id, from, to) => choose(id, variant("range", { from, to })), prefix: (id, value) => choose(id, variant("prefix", value)),
        clear: id => choose(id, undefined), clearAll,
        count: () => some(BigInt(served(read().where).length)), countWhere, total: () => some(BigInt(FLOWS.length)),
        domain: () => none, values: () => [], suggest: () => none, replaces: () => [], togglePreset: () => null,
        setResolution: resolution => write({ ...read(), resolution }), retry: () => null,
        readEntry: () => some(none), contains: () => some(false), containsRow: () => some(false),
    };
}

/** A flow's card: its name, its lane under it. */
function flowCard(flow: Flow): LibraryItemValue {
    return {
        key: flow.name, label: flow.name, sublabel: some(flow.lane), icon: none, status: none, trailing: none, draggable: false, filtered: false, placed: false,
        media: none, avatar: none, byline: none, action: none, search: none, groups: new Map(), facets: new Map(), dims: new Map(),
    };
}

/**
 * The Flows tab as a builder draws it: its rows what the rail narrows the flows to — a source the rail's choices
 * name, built again as they move, as a builder's payload is — and its search over the flows' part.
 */
function FlowsTab({ part, pageWhere }: { part: Bind; pageWhere: (where: Where, offset: bigint, limit: bigint) => option<Flow[]> }) {
    useSliceReactivity(part.key);
    const where = part.read().where;
    const shown = served(where);
    const rows: LibraryPageSource<Flow> = {
        id: `flows@${printWhere(where)}`, revision: () => some("r1"), total: () => some(BigInt(shown.length)),
        page: (offset, limit) => some(shown.slice(Number(offset), Number(offset + limit))),
    };
    const search: PagedLibrarySearch<Flow> = { part, page: pageWhere };
    return <PagedLibrary source={rows} id="flows" item={flowCard} onOpen={() => {}} search={search} noun={{ singular: "flow", plural: "flows" }}
        narrowing={where.size === 0 ? undefined : { empty: { title: "No flows match the filters" }, onClear: () => { part.clearAll(); } }} />;
}

/** The tab, mounted; its search's pages the stand-in server's, each counted. */
function mountFlows() {
    const part = flowsPart();
    const pageWhere = vi.fn((where: Where, offset: bigint, limit: bigint) => some(served(where).slice(Number(offset), Number(offset + limit))));
    render(<ChakraProvider value={system}><FlowsTab part={part} pageWhere={pageWhere} /></ChakraProvider>);
    return { part, pageWhere };
}

const box = () => document.querySelector<HTMLInputElement>("[data-library-paged] [data-slot='toolbar'] input")!;
const names = () => [...document.querySelectorAll<HTMLElement>("[data-library-paged] [data-library-item]")].map(card => card.dataset.libraryItem);
const hiddenNote = () => document.querySelector<HTMLElement>("[data-library-search-hidden]");
async function type(text: string) {
    await act(async () => { fireEvent.change(box(), { target: { value: text } }); });
}

describe("a paged palette's own search (#1340, ruling 11)", () => {
    test("draws the Library's search box, counting the rows the rail shows and naming the field it searches by", async () => {
        mountFlows();
        await waitFor(() => expect(names()).toEqual(["FLOW-100", "FLOW-101", "FLOW-110", "FLOW-200", "ROUTE-1"]));
        expect(box().placeholder).toBe("Search 5 flows by name…");
        expect(box().getAttribute("aria-label")).toBe("Search flows by name");
        expect(box().getAttribute("aria-keyshortcuts")).toBe("Meta+/ Control+/");
    });

    test("finds within the tab alone: a prefix of the field, read through the part — the rail's state and its count untouched; its footer counts what it hides, and Show all clears it", async () => {
        const { part, pageWhere } = mountFlows();
        await waitFor(() => expect(names()).toHaveLength(5));
        const rail = getStore().read(KEY);
        await type("FLOW-1");
        await waitFor(() => expect(names()).toEqual(["FLOW-100", "FLOW-101", "FLOW-110"]));
        // Read as one narrowing of the tab's own: the rail's choices — none — and the text's prefix of the name.
        const where = pageWhere.mock.lastCall![0];
        expect([...where.keys()]).toEqual(["name"]);
        expect(where.get("name")).toEqual(variant("prefix", "FLOW-1"));
        expect(part.countWhere).toHaveBeenLastCalledWith(where);
        // The rail never moved: its state, its count.
        expect(getStore().read(KEY)).toBe(rail);
        expect(part.read().where.size).toBe(0);
        expect(part.count()).toEqual(some(5n));
        expect(hiddenNote()!.textContent).toBe("2 hidden by filter · Show all");
        await act(async () => { fireEvent.click(within(hiddenNote()!).getByRole("button", { name: "Show all" })); });
        await waitFor(() => expect(names()).toHaveLength(5));
        expect([box().value, hiddenNote()]).toEqual(["", null]);
    });

    test("reads within the rail's choices: a lane chosen on the rail narrows the tab, and the search finds within what it shows", async () => {
        const { part, pageWhere } = mountFlows();
        await waitFor(() => expect(names()).toHaveLength(5));
        await act(async () => { part.choose("lane", [printString("review")]); });
        await waitFor(() => expect(names()).toEqual(["FLOW-101", "FLOW-110", "ROUTE-1"]));
        expect(box().placeholder).toBe("Search 3 flows by name…");
        await type("FLOW");
        await waitFor(() => expect(names()).toEqual(["FLOW-101", "FLOW-110"]));
        const where = pageWhere.mock.lastCall![0];
        expect([...where.keys()]).toEqual(["lane", "name"]);
        expect([where.get("lane"), where.get("name")]).toEqual([variant("values", [printString("review")]), variant("prefix", "FLOW")]);
        // The rail keeps its one choice; its search text is the tab's.
        expect([...part.read().where.keys()]).toEqual(["lane"]);
        expect(hiddenNote()!.textContent).toBe("1 hidden by filter · Show all");
    });

    test("a search that finds nothing says No matches, and offers no Clear filters: the rail did not empty the tab", async () => {
        mountFlows();
        await waitFor(() => expect(names()).toHaveLength(5));
        await type("TRAILER");
        await waitFor(() => expect(emptyState()).not.toBeNull());
        expect(within(emptyState()!).getByText("No matches")).toBeTruthy();
        expect(within(emptyState()!).getByText('Nothing matches "TRAILER".')).toBeTruthy();
        expect(within(emptyState()!).queryByRole("button", { name: "Clear filters" })).toBeNull();
    });

    test("one the rail's choices block says which, and offers the rail's Clear filters — which clears the rail, and the search then reads", async () => {
        const { part, pageWhere } = mountFlows();
        await waitFor(() => expect(names()).toHaveLength(5));
        await act(async () => { part.choose("kind", [printString("returns")]); });
        await waitFor(() => expect(names()).toEqual(["FLOW-110", "FLOW-200"]));
        pageWhere.mockClear();
        await type("FLOW");
        await waitFor(() => expect(emptyState()).not.toBeNull());
        expect(within(emptyState()!).getByText("No search with these filters")).toBeTruthy();
        expect(within(emptyState()!).getByText("Clear the filters on Kind to search by Name.")).toBeTruthy();
        // Nothing read: no index answers a name's prefix after a kind.
        expect(pageWhere).not.toHaveBeenCalled();
        await act(async () => { fireEvent.click(within(emptyState()!).getByRole("button", { name: "Clear filters" })); });
        await waitFor(() => expect(names()).toEqual(["FLOW-100", "FLOW-101", "FLOW-110", "FLOW-200"]));
        expect(part.read().where.size).toBe(0);
    });

    test("Escape and the box's × clear it, and the rows the rail shows come back", async () => {
        mountFlows();
        await waitFor(() => expect(names()).toHaveLength(5));
        await type("ROUTE");
        await waitFor(() => expect(names()).toEqual(["ROUTE-1"]));
        await act(async () => { fireEvent.keyDown(box(), { key: "Escape" }); });
        await waitFor(() => expect(names()).toHaveLength(5));
        await type("ROUTE");
        await waitFor(() => expect(names()).toEqual(["ROUTE-1"]));
        await act(async () => { fireEvent.click(document.querySelector<HTMLElement>("[data-library-paged] [aria-label='Clear search']")!); });
        await waitFor(() => expect(names()).toHaveLength(5));
    });

    test("with no String field its source lists in `search`, no search box", () => {
        const part = flowsPart();
        const unsearched = { ...part, config: { ...part.config, search: [] } };
        render(<ChakraProvider value={system}><FlowsTab part={unsearched} pageWhere={() => none} /></ChakraProvider>);
        expect(document.querySelector("[data-library-paged] [data-slot='toolbar']")).toBeNull();
    });
});
