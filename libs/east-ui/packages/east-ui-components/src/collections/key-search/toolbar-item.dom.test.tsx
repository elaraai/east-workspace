/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The key search as one item of a builder's toolbar (#1193): the search box,
 * folding at its rank to its icon, which opens the same box in the edit
 * popover with the focus in its input; while a query is typed the item keeps
 * its form, and a search keyed afresh lets it go. jsdom lays nothing out, so
 * widths are stubbed from the form each item shows: the box 200px, the icon
 * 44; a peer item 300, or 100 once folded; the gap 10px. The icon is Font
 * Awesome's magnifying glass and its caret (#1263).
 */

import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { toEastTypeValue, StringType } from "@elaraai/east";
import type { ReactNode } from "react";
import { system } from "../../theme/index.js";
import { faIcons } from "../../testing/icons.js";
import { Toolbar, type ToolbarItem } from "../../toolbar/index.js";
import { focusKeySearch, useKeySearchToolbarItem, type KeySearchSource, type KeySearchToolbarOptions } from "./toolbar-item.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar and Ark's positioner observe through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

function widthOf(el: Element): number {
    if (el.hasAttribute("data-toolbar")) return row.px;
    switch (el.getAttribute("data-toolbar-item")) {
        case "seek": return el.querySelector('[data-key-search="icon"]') !== null ? 44 : 200;
        case "peer": return el.querySelector('[data-peer="short"]') !== null ? 100 : 300;
        default: return 0;
    }
}

const originalRect = Element.prototype.getBoundingClientRect;
const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = widthOf(this);
        return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
    };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
        const style = computed(el, pseudo);
        if (!el.hasAttribute("data-toolbar")) return style;
        return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
    });
});
afterAll(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    vi.restoreAllMocks();
});

/** A keyed source's search over three String keys from row 100, every call recorded. */
function search(resetKey = "r1"): KeySearchSource & { jumps: number[]; clears: number[] } {
    const jumps: number[] = [];
    const clears: number[] = [];
    return {
        resetKey,
        keyType: toEastTypeValue(StringType),
        find: async () => ({ found: true, row: 100, count: 3 }),
        listRange: async (from: number, limit: number) => Array.from({ length: Math.min(limit, 3) }, (_x, i) => `key-${from + i}`),
        jump: (r: number) => { jumps.push(r); },
        clear: () => { clears.push(1); },
        jumps,
        clears,
    };
}

/** A collection's own item, which folds first. */
const PEER: ToolbarItem = { key: "peer", forms: [<span data-peer="long" />, <span data-peer="short" />], rank: 5 };

/** The search's step folds at 20, after the peer's. */
const OPTIONS: KeySearchToolbarOptions = { rank: 20, label: "Find a job" };

function Bar({ source, options }: { source: KeySearchSource | undefined; options: KeySearchToolbarOptions }) {
    const item = useKeySearchToolbarItem(source, options);
    return <Toolbar items={[PEER, item]} />;
}

const wrap = (node: ReactNode) => <ChakraProvider value={system}>{node}</ChakraProvider>;

function mount(px: number, source: KeySearchSource | undefined, options: KeySearchToolbarOptions = OPTIONS) {
    row.px = px;
    const view = render(wrap(<Bar source={source} options={options} />));
    return {
        ...view,
        /** The search item's form, as the toolbar says it chose it. */
        form: () => view.container.querySelector('[data-toolbar-item="seek"]')?.getAttribute("data-toolbar-form") ?? null,
        /** Renders again at another row width, as a resize does. */
        resize: (to: number, next: KeySearchSource | undefined = source) => {
            row.px = to;
            view.rerender(wrap(<Bar source={next} options={options} />));
        },
    };
}

test("no search is no item", () => {
    const { result } = renderHook(() => useKeySearchToolbarItem(undefined, OPTIONS), { wrapper: ({ children }) => wrap(children) });
    expect(result.current).toBeUndefined();
});

test("the item is keyed seek, on the side it is given, its one step at its rank — the default rank and words when none are given", () => {
    const given = renderHook(() => useKeySearchToolbarItem(search(), { ...OPTIONS, side: "end" }), { wrapper: ({ children }) => wrap(children) });
    expect({ key: given.result.current?.key, side: given.result.current?.side, forms: given.result.current?.forms.length, rank: given.result.current?.rank })
        .toEqual({ key: "seek", side: "end", forms: 2, rank: 20 });
    cleanup();
    const view = mount(44, search(), {});
    expect(view.container.querySelector('[data-key-search="icon"]')?.getAttribute("aria-label")).toBe("Search keys");
    const plain = renderHook(() => useKeySearchToolbarItem(search()), { wrapper: ({ children }) => wrap(children) });
    expect(plain.result.current?.rank).toBe(100);
});

test("the box, then its icon: the search folds at its rank, after the row's other items", () => {
    // The whole row: 300 + 200 + 10.
    const view = mount(510, search());
    expect(view.form()).toBe("0");
    expect(view.container.querySelector('[data-toolbar-item="seek"] [data-part="dataset-key-search"]')).not.toBeNull();
    // A pixel less: the peer folds first (rank 5), the box stays.
    view.resize(509);
    expect(view.container.querySelector('[data-peer="short"]')).not.toBeNull();
    expect(view.form()).toBe("0");
    // Past that (100 + 200 + 10 = 310): the icon, named in the host's words.
    view.resize(309);
    expect(view.form()).toBe("1");
    const icon = view.container.querySelector('[data-key-search="icon"]')!;
    expect(icon.getAttribute("aria-label")).toBe("Find a job");
    // Its face is Font Awesome's magnifying glass and its caret, never a written ▾ (#1263).
    expect([icon.textContent, faIcons(icon, "magnifying-glass").length, faIcons(icon, "caret-down").length]).toEqual(["", 1, 1]);
    expect(view.container.querySelector('[data-toolbar-item="seek"] [data-part="dataset-key-search"]')).toBeNull();
    // Wide again, the box is back.
    view.resize(510);
    expect(view.form()).toBe("0");
});

test("its icon opens the box in the edit popover, the focus in its input, headed in the host's words; a match picked there jumps the host", async () => {
    const source = search();
    const view = mount(154, source);
    expect(view.form()).toBe("1");
    const icon = view.container.querySelector<HTMLElement>('[data-key-search="icon"]')!;
    await act(async () => { fireEvent.click(icon); });
    const popover = await waitFor(() => {
        const el = document.querySelector('[data-key-search="popover"]');
        if (el === null) throw new Error("no popover");
        return el;
    });
    expect(icon.getAttribute("data-state")).toBe("open");
    expect(screen.getByText("Find a job")).toBeTruthy();
    const input = popover.querySelector<HTMLInputElement>("input")!;
    await waitFor(() => expect(document.activeElement).toBe(input));
    await userEvent.type(input, "key");
    await waitFor(() => expect(screen.getByText("key-100")).toBeTruthy());
    fireEvent.click(screen.getByText("key-100"));
    await waitFor(() => expect(source.jumps).toEqual([100]));
});

test("while a query is typed the item keeps its form however narrow the row — the row folds its other items around it; cleared, it folds", async () => {
    const source = search();
    const view = mount(510, source);
    const input = screen.getByPlaceholderText("Search keys");
    await userEvent.type(input, "key");
    await waitFor(() => expect(screen.getByText("3 matches")).toBeTruthy());
    // The suggestions closed — an open list holds the item anyway — the query stands, as it does while its matches are stepped through.
    await act(async () => { fireEvent.keyDown(input, { key: "Escape" }); });
    await waitFor(() => expect(view.container.querySelector('[data-toolbar-item="seek"] [data-part="trigger"][data-state="open"], [data-toolbar-item="seek"] [aria-expanded="true"]')).toBeNull());
    expect(screen.getByText("3 matches")).toBeTruthy();
    // Narrower than the box and the folded peer: the peer folds, the box stays.
    view.resize(154);
    expect(view.container.querySelector('[data-peer="short"]')).not.toBeNull();
    expect(view.form()).toBe("0");
    expect((screen.getByPlaceholderText("Search keys") as HTMLInputElement).value).toBe("key");
    // Cleared, the query no longer holds it: it folds to its icon.
    await act(async () => { fireEvent.click(screen.getByLabelText("Clear search")); });
    await waitFor(() => expect(view.form()).toBe("1"));
    expect(source.clears).toEqual([1]);
});

test("a search keyed afresh starts empty, and the query typed into the one before no longer holds the item", async () => {
    const view = mount(510, search("r1"));
    await userEvent.type(screen.getByPlaceholderText("Search keys"), "key");
    await waitFor(() => expect(screen.getByText("3 matches")).toBeTruthy());
    view.resize(154);
    expect(view.form()).toBe("0");
    // The source moved to another revision: a new box, empty, and the item folds.
    view.resize(154, search("r2"));
    await waitFor(() => expect(view.form()).toBe("1"));
    view.resize(510, search("r2"));
    expect((screen.getByPlaceholderText("Search keys") as HTMLInputElement).value).toBe("");
});

test("a host's key for its search reaches it in either form: the box, its text selected; folded, the box in its popover, opened — or focused there when open; a toolbar with none, false", async () => {
    // The box: focused, its text selected.
    const wide = mount(510, search());
    const input = screen.getByPlaceholderText("Search keys") as HTMLInputElement;
    await userEvent.type(input, "key");
    input.blur();
    expect(focusKeySearch(wide.container.querySelector<HTMLElement>("[data-toolbar]"))).toBe(true);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
    cleanup();
    // Folded: its popover opens, the focus in its box.
    const narrow = mount(154, search());
    const bar = narrow.container.querySelector<HTMLElement>("[data-toolbar]");
    const icon = narrow.container.querySelector<HTMLElement>('[data-key-search="icon"]')!;
    await act(async () => { expect(focusKeySearch(bar)).toBe(true); });
    const box = await waitFor(() => {
        const el = document.querySelector<HTMLInputElement>('[data-key-search="popover"] input');
        if (el === null) throw new Error("no popover");
        return el;
    });
    await waitFor(() => expect(document.activeElement).toBe(box));
    // Open already: the focus goes back to its box, and the popover stays open.
    icon.focus();
    await act(async () => { expect(focusKeySearch(bar)).toBe(true); });
    expect(document.activeElement).toBe(box);
    expect(icon.getAttribute("data-state")).toBe("open");
    cleanup();
    // No key search in the toolbar, or no toolbar: nothing to reach.
    expect(focusKeySearch(null)).toBe(false);
    const bare = render(wrap(<Toolbar items={[PEER]} />));
    expect(focusKeySearch(bare.container.querySelector<HTMLElement>("[data-toolbar]"))).toBe(false);
});
