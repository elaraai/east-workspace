/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A paged gallery (east-workspace#1761): a paged palette's reads drawn as its
 * host's own cards in a responsive grid — as many across as fit at the cards'
 * least width between its margins, and one at least; each line of the grid one
 * virtual row, so a gallery over ten thousand rows reads the pages its view
 * needs and mounts a screenful; and, with no row, its host's words — a
 * narrowing's with Clear filters.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { some, type option } from "@elaraai/east";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { system } from "../../theme/index.js";
import { PAGED_LIBRARY_PAGE, PagedGallery, type LibraryPageSource, type PagedLibraryGallery } from "./paged.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// jsdom lays nothing out: the gallery gets a viewport, as a frame's main gives it one — 480 tall, and as wide as the test says.
let width = 1000;
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
const boundingBox = HTMLElement.prototype.getBoundingClientRect;
const inGallery = (el: HTMLElement) => el.closest("[data-library-gallery]") !== null;
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return inGallery(this) ? 480 : offsetHeight.get!.call(this); } });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get(this: HTMLElement) { return inGallery(this) ? width : offsetWidth.get!.call(this); } });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        return inGallery(this) ? new DOMRect(0, 0, width, 480) : boundingBox.call(this);
    };
});
afterAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
    HTMLElement.prototype.getBoundingClientRect = boundingBox;
});
beforeEach(() => { initializeStore(new UIStore()); width = 1000; });
afterEach(() => { cleanup(); localStorage.clear(); });

/** A gallery's row: a tree, by its name. */
interface Tree { readonly name: string }
const trees = (n: number): Tree[] => Array.from({ length: n }, (_, i) => ({ name: `tree-${i}` }));

/** A source holding these rows, which says each page it is asked. */
function source(rows: readonly Tree[], asked: bigint[] = []): LibraryPageSource<Tree> {
    return {
        id: `trees.${rows.length}`, total: () => some(BigInt(rows.length)), revision: () => some("r1"),
        page: (offset, limit): option<Tree[]> => { asked.push(offset); return some(rows.slice(Number(offset), Number(offset + limit))); },
    };
}
/** A gallery whose cards stand 300 wide at least and 200 tall, each a button of the tree's name. */
const GALLERY: PagedLibraryGallery<Tree> = { least: 300, cardPx: 200, card: (tree) => <button type="button" data-tree={tree.name}>{tree.name}</button> };
const view = (rows: LibraryPageSource<Tree>, props: Partial<Parameters<typeof PagedGallery<Tree>>[0]> = {}) => (
    <ChakraProvider value={system}><PagedGallery source={rows} id="trees" gallery={GALLERY} {...props} /></ChakraProvider>
);
/** The grid's lines: each line's cards, by name, in order. */
const lines = () => [...document.querySelectorAll<HTMLElement>("[data-library-gallery] [data-library-across]")]
    .map((line) => [...line.querySelectorAll<HTMLElement>("[data-tree]")].map((card) => card.dataset["tree"]));
/** How many cards a line holds, as the grid lays it out. */
const across = () => document.querySelector<HTMLElement>("[data-library-gallery] [data-library-across]")?.dataset["libraryAcross"];

describe("a paged gallery (east-workspace#1761)", () => {
    test("its host's cards in a grid, as many across as fit at their least width between its margins — three in 1000px, in order, a line the grid's row", async () => {
        render(view(source(trees(7))));
        await waitFor(() => expect(lines().flat()).toHaveLength(7));
        // 1000 wide inside its scrollbar's gutter, 20 and 8 at its sides, 12 between: 300 + 12 + 300 + 12 + 300 fits, a fourth does not.
        expect(across()).toBe("3");
        expect(lines()).toEqual([["tree-0", "tree-1", "tree-2"], ["tree-3", "tree-4", "tree-5"], ["tree-6"]]);
        const line = document.querySelector<HTMLElement>("[data-library-gallery] [data-library-across]")!;
        expect([line.style.gridTemplateColumns, line.style.height]).toEqual(["repeat(3, minmax(0, 1fr))", "212px"]);
    });

    test("a narrower gallery holds fewer across, and one at least: a card is never squeezed out", async () => {
        width = 700;
        const first = render(view(source(trees(4))));
        await waitFor(() => expect(lines().flat()).toHaveLength(4));
        expect([across(), lines()]).toEqual(["2", [["tree-0", "tree-1"], ["tree-2", "tree-3"]]]);
        first.unmount();
        // Narrower than one card's least width with its margins: one across still.
        width = 280;
        render(view(source(trees(3))));
        await waitFor(() => expect(lines().flat()).toHaveLength(3));
        expect([across(), lines()]).toEqual(["1", [["tree-0"], ["tree-1"], ["tree-2"]]]);
    });

    test("over ten thousand rows it reads the pages its view needs, and mounts a screenful", async () => {
        const asked: bigint[] = [];
        render(view(source(trees(10_000), asked)));
        await waitFor(() => expect(lines().flat().length).toBeGreaterThan(0));
        // The first windows alone: never a page far down the rows, and never every row.
        expect(Math.max(...asked.map(Number))).toBeLessThanOrEqual(2 * PAGED_LIBRARY_PAGE);
        expect(document.querySelectorAll("[data-library-gallery] [data-tree]").length).toBeLessThan(60);
        expect(lines()[0]).toEqual(["tree-0", "tree-1", "tree-2"]);
    });

    test("with no row it says its host's words; while a narrowing pages it, the narrowing's, with Clear filters", () => {
        const first = render(view(source([]), { empty: { title: "No trees yet", description: "Plant one." } }));
        const said = () => document.querySelector<HTMLElement>("[data-library-empty]")!;
        expect(said().textContent).toContain("No trees yet");
        expect(within(said()).queryByRole("button")).toBeNull();
        first.unmount();
        const onClear = vi.fn();
        render(view(source([]), { narrowing: { empty: { title: "No trees match the filters" }, onClear } }));
        expect(said().textContent).toContain("No trees match the filters");
        within(said()).getByRole("button", { name: /Clear filters/ }).click();
        expect(onClear).toHaveBeenCalledTimes(1);
    });
});
