/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The renderer's parts (SB4, SB5, #1181): the toolbar's items, the grid with
 * its strip, and the footer, each placed in a container of its own under one
 * `SheetProvider` (as a builder places them in its frame's regions), drive
 * one grid. A tab switched in the toolbar narrows the grid, the history
 * item's Undo undoes the grid's typed cell, the footer's message follows a
 * paste, and ⌘F in the grid finds the search box wherever the toolbar is.
 * Every value built by the e3-ui factory and COMPILED, the slice bound
 * through the real `Slice.bind`.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, IntegerType, StringType, StructType, none, some } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { Slice, State } from "@elaraai/east-ui/internal";
import { system, Toolbar, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { SheetFooter } from "./Footer.js";
import { EastChakraSheet, SheetGrid, SheetProvider, SheetRoot, useSheetFooter, useSheetToolbarItems, useSheetToolbarRef } from "./index.js";
import type { SheetRootValue } from "./values.js";

afterEach(cleanup);
beforeEach(() => { initializeStore(new UIStore()); });

// jsdom lacks the browser APIs Chakra's Combobox positioner relies on.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const Row = StructType({ id: StringType, activity: StringType, qty: IntegerType });

/** Fixtures at MODULE scope: East bodies never call host helpers. */
const ROWS = [
    { id: "a", activity: "Routing", qty: 1n },
    { id: "b", activity: "Spraying", qty: 2n },
    { id: "c", activity: "Wrapping", qty: 3n },
];
const NARROWING = {
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, visible: none, selectedIndex: none, resolution: none,
};
const VIEWS = [
    { id: "spray", name: "SPRAY", narrowing: { ...NARROWING, search: some("spray") }, context: 0n, reveals: [], folds: new Map<string, boolean>() },
];

/** An editable sheet over a bound slice, with one saved view, opening on the whole sheet. */
const program = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const data = $.const(State.bind([ArrayType(Row)], "sheet-parts-dom", ROWS));
    const views = $.const(VIEWS, ArrayType(Sheet.Types.View));
    const cfg = $.const(Slice.config(Row, { fields: { activity: { label: "Activity" } }, searchFieldIds: ["activity"] }));
    const slice = $.let(Slice.bind([Row], "sheet_parts_dom", cfg, Slice.state(), data.read(), none));
    return Sheet.Payload(data, {
        activity: Sheet.column.text(Row, { header: "Activity" }),
        qty: Sheet.column.integer(Row, { header: "Quantity" }),
    }, { id: "id", onUpdate: data.write, slice, affordances: ["search"], views });
}), getRegisteredPlatformImplementations());
/** The sheet as the store holds it now. */
const buildSheet = (): SheetRootValue => program();

/** The toolbar's items laid out apart from the grid, as a builder's frame lays them out. */
function PlacedToolbar() {
    const items = useSheetToolbarItems();
    const ref = useSheetToolbarRef();
    return <div ref={ref}><Toolbar items={items} /></div>;
}

/** The footer, apart from the grid. */
function PlacedFooter() {
    return <SheetFooter {...useSheetFooter()} />;
}

function mount(value: SheetRootValue) {
    const utils = render(
        <ChakraProvider value={system}>
            <SheetProvider value={value} storageKey="sheet-parts-test">
                <section data-region="toolbar"><PlacedToolbar /></section>
                <section data-region="main"><SheetRoot><SheetGrid /></SheetRoot></section>
                <section data-region="footer"><PlacedFooter /></section>
            </SheetProvider>
        </ChakraProvider>,
    );
    const region = (name: "toolbar" | "main" | "footer") => utils.container.querySelector(`[data-region="${name}"]`) as HTMLElement;
    const root = () => region("main").querySelector("[data-sheet]") as HTMLElement;
    const card = () => region("main").querySelector("[data-sheet-card]") as HTMLElement;
    const cell = (id: string, key: string) => region("main").querySelector<HTMLElement>(`[data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`);
    const numbers = () => [...region("main").querySelectorAll('[data-slot="row"]:not([data-blank]) [data-slot="gutterNumber"]')].map((n) => n.textContent);
    const flush = () => act(async () => { await Promise.resolve(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    const press = async (name: string) => {
        const button = within(region("toolbar")).getByRole("button", { name });
        await act(async () => {
            fireEvent.mouseDown(button, { button: 0 });
            fireEvent.click(button);
        });
    };
    return { ...utils, region, root, card, cell, numbers, flush, press };
}

test("each part draws where it is placed, and a tab switched in the toolbar narrows the grid (SB4, SB5)", async () => {
    const ui = mount(buildSheet());
    expect(ui.region("main").querySelector('[data-slot="tab"]')).toBeNull();
    expect(ui.region("main").querySelector('[data-slot="footer"]')).toBeNull();
    expect(ui.region("toolbar").querySelector('[data-slot="row"]')).toBeNull();
    expect(ui.region("footer").querySelector('[data-slot="footer"]')).not.toBeNull();
    expect(ui.numbers()).toEqual(["1", "2", "3"]);
    expect(ui.root().hasAttribute("data-lens")).toBe(false);
    fireEvent.mouseDown(ui.region("toolbar").querySelector('[data-slot="tab"][data-tab="spray"]')!, { button: 0 });
    await waitFor(() => expect(ui.root().hasAttribute("data-lens")).toBe(true));
    expect(ui.root().getAttribute("data-view")).toBe("spray");
    expect(ui.numbers()).toEqual(["2"]);
});

test("Undo in the history item, placed apart, commits the grid's open editor and undoes it; Redo restores it (SB5)", async () => {
    const ui = mount(buildSheet());
    fireEvent.doubleClick(ui.cell("a", "qty")!);
    await ui.flush();
    fireEvent.input(ui.region("main").querySelector('[data-slot="editorInput"]')!, { target: { value: "7" } });
    await ui.flush();
    await ui.press("Undo");
    expect(ui.region("main").querySelector('[data-slot="editorInput"]')).toBeNull();
    expect(ui.cell("a", "qty")!.textContent).toBe("1");
    await ui.press("Redo");
    expect(ui.cell("a", "qty")!.textContent).toBe("7");
});

test("the footer's message, placed apart, follows a paste in the grid", async () => {
    const ui = mount(buildSheet());
    fireEvent.mouseDown(ui.cell("c", "qty")!, { button: 0 });
    await act(async () => { fireEvent.paste(ui.card(), { clipboardData: { getData: () => "9" } }); });
    expect(ui.cell("c", "qty")!.textContent).toBe("9");
    expect(ui.region("footer").querySelector('[data-slot="footerMessage"]')!.textContent).toBe("Pasted 1×1 from clipboard");
});

test("⌘F in the grid puts the focus on the search box wherever the toolbar is placed", async () => {
    const ui = mount(buildSheet());
    const search = ui.region("toolbar").querySelector<HTMLInputElement>('[data-slot="toolbarRail"] input');
    expect(search).not.toBeNull();
    fireEvent.mouseDown(ui.cell("a", "activity")!, { button: 0 });
    fireEvent.keyDown(ui.card(), { key: "f", metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(search));
});

test("⌘/ in Sheet.View puts the focus on its own toolbar's search box", async () => {
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={buildSheet()} storageKey="sheet-parts-view" />
        </ChakraProvider>,
    );
    const search = utils.container.querySelector<HTMLInputElement>('[data-slot="toolbar"] [data-slot="toolbarRail"] input');
    expect(search).not.toBeNull();
    fireEvent.mouseDown(utils.container.querySelector('[data-row-id="a"] [data-slot="cell"][data-key="activity"]')!, { button: 0 });
    fireEvent.keyDown(utils.container.querySelector("[data-sheet-card]")!, { key: "/", metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(search));
});
