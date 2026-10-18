/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * What a paged palette says when its source holds no row (#1341): its host's
 * narrowing's words and Clear filters while a builder's rail pages it, else its
 * host's words, else its own — the Library's empty state in each.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, some, type ValueTypeOf } from "@elaraai/east";
import { Library, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { system } from "../../theme/index.js";
import type { LibraryItemValue, LibraryValue } from "./index.js";
import { PagedLibrary, type LibraryPageSource } from "./paged.js";
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
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
