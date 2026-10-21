/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A host's words and card parts on the shared Library (#1330): its search's
 * words, what it says when a search hides every card, each compact card's
 * tooltip, figure, note, look and ×, and a group head's mark — and none of
 * them on a Library whose host gives none; and what it says, with its Clear
 * filters, when its host's narrowing leaves it no item (#1339), or none of its
 * own beside cards the narrowing does not touch (#1342).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { Library, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { system } from "../../theme/index.js";
import { EastChakraLibrary, type LibraryCardExtras, type LibraryItemValue, type LibraryValue } from "./index.js";
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= s => s.replace(/[^\w-]/g, "\\$&");
afterEach(() => { cleanup(); localStorage.clear(); });

const program = East.compile(East.function([], UIComponentType, _$ => Library.Root([
    { key: "a", name: "Alder", late: "Late" }, { key: "b", name: "Birch", late: "On time" }, { key: "c", name: "Cedar", late: "On time" },
], { id: "trees", item: t => ({ key: t.key, label: t.name }), groupBy: [{ key: "late", label: "Late", value: t => t.late }], search: t => t.name })), getRegisteredPlatformImplementations());
function library(): LibraryValue {
    initializeStore(new UIStore());
    const component = program() as ValueTypeOf<typeof UIComponentType>;
    if (component.type !== "Library") throw new Error("Expected Library");
    return component.value as LibraryValue;
}
const card = (key: string) => document.querySelector<HTMLElement>(`[data-library-item="${key}"]`)!;

describe("a host's words and card parts on the shared Library (#1330)", () => {
    test("its search's words, its tooltips, figures, notes in their tone, looks, a group's mark, and an × that is its own target", async () => {
        const removed = vi.fn();
        const extras = (item: LibraryItemValue): LibraryCardExtras | undefined => item.key === "a"
            ? { title: "Alder · overdue", figure: "21 m³", note: { text: "was due Sun 9", tone: "warning" }, look: "dashed", remove: { label: "Return Alder", onRemove: removed } }
            : item.key === "b" ? { figure: "8 m³", note: { text: "due Tue 11" }, look: "sunken" } : undefined;
        const value = library();
        render(<ChakraProvider value={system}><EastChakraLibrary value={value} storageKey="host" search="Find a tree or grove" extras={extras}
            groupMark={label => label === "Late" ? { icon: "triangle-exclamation", label: "Late", tone: "warning" } : undefined}
            noMatch={{ title: "No trees match", description: "Clear the search to see all 3 trees." }} /></ChakraProvider>);
        const search = screen.getByRole("textbox", { name: "Find a tree or grove" });
        expect(search.getAttribute("placeholder")).toBe("Find a tree or grove");
        const alder = card("a");
        expect([alder.title, alder.getAttribute("data-look"), alder.querySelector("[data-library-figure]")!.textContent]).toEqual(["Alder · overdue", "dashed", "21 m³"]);
        // The figure rides the name's line.
        expect(alder.querySelector("[data-library-figure]")!.previousElementSibling!.textContent).toBe("Alder");
        expect([alder.querySelector("[data-library-note]")!.textContent, alder.querySelector("[data-library-note]")!.getAttribute("data-tone")]).toEqual(["was due Sun 9", "warning"]);
        expect([card("b").getAttribute("data-look"), card("b").querySelector("[data-library-note]")!.hasAttribute("data-tone")]).toEqual(["sunken", false]);
        // A card its host gives nothing to keeps the shared face.
        expect([card("c").hasAttribute("title"), card("c").querySelector("[data-library-figure], [data-library-note], [data-library-remove]")]).toEqual([false, null]);
        const head = [...document.querySelectorAll<HTMLElement>("[data-library-head]")].find(h => h.textContent!.startsWith("Late"))!;
        expect([head.getAttribute("data-tone"), head.querySelector("[data-library-group-mark]")!.getAttribute("aria-label")]).toEqual(["warning", "Late"]);
        // The × runs its host's action, and neither picks up a drag nor clicks the card.
        await act(async () => { fireEvent.click(within(alder).getByRole("button", { name: "Return Alder" })); });
        expect(removed).toHaveBeenCalledTimes(1);
        // A search that hides every card says the host's words.
        await act(async () => { fireEvent.change(search, { target: { value: "no such tree" } }); });
        expect(screen.getByText("No trees match")).toBeTruthy();
        expect(screen.getByText("Clear the search to see all 3 trees.")).toBeTruthy();
    });

    test("with none of them, the Library's own: `Search 3 items…`, `No matches`, and no mark", async () => {
        render(<ChakraProvider value={system}><EastChakraLibrary value={library()} storageKey="bare" /></ChakraProvider>);
        const search = screen.getByRole("textbox", { name: "Search library" });
        expect(search.getAttribute("placeholder")).toBe("Search 3 items…");
        expect(document.querySelector("[data-library-group-mark], [data-library-figure], [data-look]")).toBeNull();
        await act(async () => { fireEvent.change(search, { target: { value: "no such tree" } }); });
        expect(screen.getByText("No matches")).toBeTruthy();
    });
});

describe("a host's narrowing on the shared Library (#1339)", () => {
    test("left with no item by its host's narrowing, it says the host's words and offers Clear filters; with items, the narrowing says nothing", async () => {
        const onClear = vi.fn();
        const narrowing = { empty: { title: "No trees match the filters", description: "Change or clear the filters to see more trees." }, onClear };
        const value = library();
        const { rerender } = render(<ChakraProvider value={system}><EastChakraLibrary value={{ ...value, items: [] }} storageKey="narrowed"
            empty={{ title: "No trees" }} narrowing={narrowing} /></ChakraProvider>);
        const empty = document.querySelector<HTMLElement>("[data-library-empty]")!;
        expect(empty.hasAttribute("data-narrowed")).toBe(true);
        expect(within(empty).getByText("No trees match the filters")).toBeTruthy();
        expect(within(empty).getByText("Change or clear the filters to see more trees.")).toBeTruthy();
        await act(async () => { fireEvent.click(within(empty).getByRole("button", { name: "Clear filters" })); });
        expect(onClear).toHaveBeenCalledTimes(1);
        // With items, the narrowing's words never show; a search that hides them says the search's.
        rerender(<ChakraProvider value={system}><EastChakraLibrary value={value} storageKey="narrowed" empty={{ title: "No trees" }} narrowing={narrowing} /></ChakraProvider>);
        expect(document.querySelector("[data-library-empty]")).toBeNull();
        await act(async () => { fireEvent.change(screen.getByRole("textbox"), { target: { value: "no such tree" } }); });
        expect(screen.getByText("No matches")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    });

    test("a narrowing that leaves none of its own says so above the cards it does not touch; one that clears elsewhere offers no Clear filters (#1342)", async () => {
        const onClear = vi.fn();
        const value = library();
        // The host still lists a card the narrowing does not touch — an action, as the Roster's agency requests are.
        const kept = { ...value, items: value.items.filter(item => item.key === "a") };
        const words = { title: "No trees match the filters", description: "Change or clear the filters to see more trees." };
        const shown = (narrowing: Parameters<typeof EastChakraLibrary>[0]["narrowing"]) =>
            <ChakraProvider value={system}><EastChakraLibrary value={kept} storageKey="emptied" empty={{ title: "No trees" }} narrowing={narrowing} /></ChakraProvider>;
        const { rerender } = render(shown({ empty: words, onClear, emptied: true }));
        const empty = document.querySelector<HTMLElement>("[data-library-empty]")!;
        expect([empty.hasAttribute("data-narrowed"), within(empty).getByText("No trees match the filters") !== null]).toEqual([true, true]);
        // The card the narrowing does not touch stays, below its words.
        expect(empty.compareDocumentPosition(card("a")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await act(async () => { fireEvent.click(within(empty).getByRole("button", { name: "Clear filters" })); });
        expect(onClear).toHaveBeenCalledTimes(1);
        // While it still shows some of its own, it says nothing.
        rerender(shown({ empty: words, onClear, emptied: false }));
        expect(document.querySelector("[data-library-empty]")).toBeNull();
        // A narrowing that clears elsewhere, as a Find's chip does: its words, and no Clear filters.
        rerender(shown({ empty: { title: "No one found" }, emptied: true }));
        const found = document.querySelector<HTMLElement>("[data-library-empty]")!;
        expect([found.hasAttribute("data-narrowed"), within(found).queryByRole("button", { name: "Clear filters" }), within(found).getByText("No one found") !== null])
            .toEqual([false, null, true]);
    });

    test("with no narrowing in force, an empty Library says its own words and offers no Clear filters", () => {
        render(<ChakraProvider value={system}><EastChakraLibrary value={{ ...library(), items: [] }} storageKey="plain" empty={{ title: "No trees" }} /></ChakraProvider>);
        const empty = document.querySelector<HTMLElement>("[data-library-empty]")!;
        expect([empty.hasAttribute("data-narrowed"), within(empty).getByText("No trees") !== null]).toEqual([false, true]);
        expect(within(empty).queryByRole("button", { name: "Clear filters" })).toBeNull();
    });
});
