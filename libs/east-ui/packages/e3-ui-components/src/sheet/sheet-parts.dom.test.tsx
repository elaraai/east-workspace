/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet's parts in its frame (SB4, SB5, #1181, #1216): the toolbar's
 * items in the frame's toolbar, the grid with its strip in main, and the
 * footer in the frame's footer, each in a region of its own under one
 * `SheetProvider`, drive one grid. A tab switched in the toolbar narrows the
 * grid — its view's narrowing of the rail's `rows` source drawn over the
 * record's rows as the lens (#1345, #1349) — the history item's Undo undoes
 * the grid's typed cell, the footer's message
 * follows a paste, and ⌘F and ⌘/ in the grid find the key search in the
 * toolbar. Every value is built by `<Sheet>`'s factory and COMPILED, the
 * narrowed sheet over its records on e3 itself (#1376).
 */

import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { fireEvent, render, waitFor, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, IntegerType, StringType, StructType, none, variant } from "@elaraai/east";
import { Data, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { Reactive, Slice, State, UIComponentType } from "@elaraai/east-ui/internal";
import { system, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { EastChakraSheet, type SheetValue } from "./frame/index.js";
import { act, settle, sheetHarness } from "./frame/harness.test-utils.js";

// The harness's frame, its store, and the examples' records on e3.
const h = sheetHarness();

const Row = StructType({ id: StringType, activity: StringType, qty: IntegerType });

/** Fixtures at MODULE scope: East bodies never call host helpers. */
const ROWS = [
    { id: "a", activity: "Routing", qty: 1n },
    { id: "b", activity: "Spraying", qty: 2n },
    { id: "c", activity: "Wrapping", qty: 3n },
];
/** A view of the PLANNED orders: the `rows` source's status, a value its `.east` literal. */
const VIEWS = [{ id: "planned", name: "PLANNED", context: 0n, reveals: [], folds: new Map<string, boolean>(),
    narrowing: new Map([["rows", { where: new Map([["status", variant("values", ["\"PLANNED\""])]]), preset: none, resolution: none }]]) }];

/** An editable sheet over a bound State. */
const editable = East.compile(East.function([], SheetPayloadType, ($) => {
    const data = $.const(State.bind([ArrayType(Row)], "sheet-parts-dom", ROWS));
    return Sheet.Payload({
        data,
        columns: {
            activity: Sheet.column.text(Row, { header: "Activity" }),
            qty: Sheet.column.integer(Row, { header: "Quantity" }),
        },
        id: "id", onUpdate: data.write,
    });
}), getRegisteredPlatformImplementations());
/**
 * The workshop's orders, through the rail's `rows` source, with one saved view kept per viewer, opening on the whole
 * sheet — in a Reactive root, as a ui task draws it: a narrowing written to the rail is drawn over the orders as the
 * lens (#1349).
 */
const narrowed = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const orders = $.let(Record.bind(ex.sheetWorkshopOrders, [ex.sheetWorkshopOrdersPatch]));
    const views = $.let(State.bind([ArrayType(Sheet.Types.RecordView)], "sheet-parts-views", VIEWS));
    const slice = $.let(Slice.bindRecords("sheet_parts_dom", {
        rows: { source: Data.bindPaged(ex.sheetWorkshopOrders, { indexes: [ex.sheetWorkshopOrdersByStatus] }), fields: { status: { label: "Status" } } },
    }));
    return Sheet({
        slice: { slice }, group: Sheet.group(ex.WorkshopOrder, "ops", { title: "name" }),
        columns: { activity: Sheet.column.text(ex.WorkshopOperation, { header: "Activity" }) },
        views, onApply: Record.onApply(orders, { keyed: true }),
    });
}))) };

/** The editable sheet's payload, mounted as the Sheet's renderer takes it. */
const sheetOf = (value: SheetValue): ReactNode => <EastChakraSheet value={value} storageKey="sheet-parts-test" />;
/** The narrowed sheet, mounted as a surface mounts a ui task's component, over its records on e3. */
const mountNarrowed = async () => partsOf(await h.mount(narrowed, { storageKey: "sheet-parts-test" }));
/** A sheet's payload, mounted as given. */
const mount = (node: ReactNode) => partsOf(render(<ChakraProvider value={system}>{node}</ChakraProvider>));

/** A render's regions of the frame, its parts in them, and what drives them. */
function partsOf(utils: RenderResult) {
    const region = (name: "toolbar" | "main" | "footer") => utils.container.querySelector(`[data-builder-frame] [data-frame-slot="${name}"]`) as HTMLElement;
    const root = () => region("main").querySelector("[data-sheet]") as HTMLElement;
    const card = () => region("main").querySelector("[data-sheet-card]") as HTMLElement;
    const cell = (id: string, key: string) => region("main").querySelector<HTMLElement>(`[data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`);
    const numbers = () => [...region("main").querySelectorAll('[data-slot="row"]:not([data-blank]) [data-slot="gutterNumber"]')].map((n) => n.textContent);
    const bands = () => [...region("main").querySelectorAll<HTMLElement>('[data-slot="row"][data-band-row]')].map((band) => band.dataset["rowId"]);
    const flush = () => act(async () => { await Promise.resolve(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    const press = async (name: string) => {
        const button = within(region("toolbar")).getByRole("button", { name });
        await act(async () => {
            fireEvent.mouseDown(button, { button: 0 });
            fireEvent.click(button);
        });
    };
    return { ...utils, region, root, card, cell, numbers, bands, flush, press };
}

test("each part draws in its region of the frame, and a tab switched in the toolbar draws its view's narrowing over the grid as the lens (SB4, SB5, #1345, #1349)", async () => {
    const ui = await mountNarrowed();
    await waitFor(() => expect(ui.bands()[0]).toBe("WO-2201"));
    expect(ui.region("main").querySelector('[data-slot="tab"]')).toBeNull();
    expect(ui.region("main").querySelector('[data-slot="footer"]')).toBeNull();
    expect(ui.region("toolbar").querySelector('[data-slot="row"]')).toBeNull();
    expect(ui.region("footer").querySelector('[data-slot="footer"]')).not.toBeNull();
    fireEvent.mouseDown(ui.region("toolbar").querySelector('[data-slot="tab"][data-tab="planned"]')!, { button: 0 });
    await settle();
    expect(ui.root().getAttribute("data-view")).toBe("planned");
    // WO-2201 is RELEASED: the view's narrowing, drawn over the orders as the lens (#1349), hides it in a gap of one.
    await waitFor(() => expect(ui.bands()[0]).toBe("WO-2202"));
    expect(ui.bands()).not.toContain("WO-2201");
    expect(ui.root().hasAttribute("data-lens")).toBe(true);
    expect(ui.region("main").querySelector('[data-slot="band"][data-band="lens"]')?.getAttribute("data-hidden")).toBe("1");
});

test("Undo in the history item, in the toolbar, commits the grid's open editor and undoes it; Redo restores it (SB5)", async () => {
    const ui = mount(sheetOf(editable()));
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

test("the footer's message, in the frame's footer, follows a paste in the grid", async () => {
    const ui = mount(sheetOf(editable()));
    expect(ui.numbers()).toEqual(["1", "2", "3"]);
    fireEvent.mouseDown(ui.cell("c", "qty")!, { button: 0 });
    await act(async () => { fireEvent.paste(ui.card(), { clipboardData: { getData: () => "9" } }); });
    expect(ui.cell("c", "qty")!.textContent).toBe("9");
    expect(ui.region("footer").querySelector('[data-slot="footerMessage"]')!.textContent).toBe("Pasted 1×1 from clipboard");
});

test("⌘F and ⌘/ in the grid put the focus on the key search in the frame's toolbar", async () => {
    const ui = await mountNarrowed();
    await waitFor(() => expect(ui.bands()[0]).toBe("WO-2201"));
    const search = within(ui.region("toolbar")).getByPlaceholderText("Search Records");
    for (const key of ["f", "/"]) {
        fireEvent.mouseDown(ui.region("main").querySelector<HTMLElement>('[data-band-row][data-row-id="WO-2201"] [data-key="$title"]')!, { button: 0 });
        ui.card().focus();
        expect(document.activeElement).not.toBe(search);
        fireEvent.keyDown(ui.card(), { key, metaKey: true });
        await waitFor(() => expect(document.activeElement).toBe(search));
    }
});
