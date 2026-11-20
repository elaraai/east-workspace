/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Builder>` rendered (#1000), its Configure tab (#1672): the palette's
 * visuals (BLD-1) and where a dropped one lands (BLD-2); the tab a selection
 * opens (EDT-1), and the canvas's and a visual's Edit and Duplicate; a text
 * block's form; a visual's kind, view, options, click and source, each one
 * gesture of the page's session, tinted until saved (EDT-8–EDT-10); its wells
 * — a field dropped on one, placed from the keyboard, moved, changed and taken
 * out (EDT-3–EDT-5), a field a well refuses (EDT-4), a pill's menu (EDT-6,
 * EDT-7), a field its source lacks (MOD-5) — its own filter, written with the
 * condition rows in place (ruled 19 November 2026), and the Fields list. The
 * record and the builders are `builder.test-utils.tsx`'s; the tab drawn from a
 * declaration alone (EDT-2) is `configure.test.tsx`'s.
 */

const { offers, openSlot, pick } = slotActions(act, settle);

import { describe, test, expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { East, NullType, none, some, variant } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Studio, StudioKeyType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, settle } from "../e3-web-mount.test-utils.js";
import { slotActions } from "../query/slots.test-utils.js";
import { condition } from "../query/visual/visual.test-utils.js";
import {
    components, PAGES, h, ASKED, withEntry, readRecord, commits, tile, palette, cardOf, inspector, openTabName, openTab, groupHeads, spanOf,
    rowsDrawn, textIn, placed, select, press, pickFromMenu, dragOnto, dropCard, type Key, type Entry,
} from "./builder.test-utils.js";

describe("<Studio.Builder> — the Configure tab (#1672)", () => {
    const BOARD: Key = { project: "ops", page: "h-board" };
    const bars = Studio.visual.of("sales", Studio.visual.bar({ x: Studio.visual.group("region"), values: [Studio.visual.sum("revenue")] }));
    const note = Studio.visual.text("Figures are to last night.", "About these numbers");
    /** The Board, never published: a note over the sales as bars, the KPI rail beside them. */
    const BOARD_PAGE: Entry = variant("page", {
        draft: {
            title: "Board",
            cells: [placed("b-note", "r1", 12n, note), placed("b-sales", "r2", 8n, bars), placed("b-kpi", "r2", 4n, Studio.visual.component("kpi_rail"))],
            filters: [],
        },
        live: none,
    });

    /** A builder that lists two sources — the revenue by day first, then the sales — its surface holding the Board open. */
    const boardBuilder = {
        fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            const record = $.let(Record.bind(ex.studioPages, ["patch"]));
            const daily = $.let(Data.bind(ex.studioRevenueDaily));
            const sales = $.let(Data.bind(ex.studioSales));
            const asked = $.let(State.bind([StudioKeyType], ASKED, { project: "", page: "" }));
            const heard = $.const(East.function([StudioKeyType], NullType, ($2, key) => { $2(asked.write(key)); }));
            return Studio.Builder({
                pages: record, components: listed, project: "ops", page: BOARD, onOpen: heard,
                sources: {
                    daily: Studio.source(daily, { name: "Daily revenue", icon: "calendar-day" }),
                    sales: Studio.source(sales, { name: "Sales", icon: "receipt" }),
                },
            });
        }))),
    };

    /** Mount it over the record with the Board in it; the record's commits once it is. */
    async function mountBoard() {
        await h.patch(ex.studioPages, withEntry(BOARD, BOARD_PAGE)(PAGES));
        const was = await commits();
        return { ...(await h.mount(boardBuilder, { storageKey: "studio-builder" })), was };
    }
    /** The Board's placements as the record holds them. */
    async function boardCells() {
        const stored = (await readRecord()).get(BOARD)!;
        if (stored.type !== "page") throw new Error("expected a page");
        return stored.value.draft.cells;
    }
    /** A visual's menu, on its tile. */
    const visualMenu = (c: HTMLElement, key: string) => within(tile(c, key)).getByRole("button", { name: "Visual menu" });
    /** A part of the open Configure tab. */
    const configurePart = (c: HTMLElement, name: string) => inspector(c).querySelector<HTMLElement>(`[data-configure="${name}"]`)!;
    /** A well of the selected visual, by the field of its kind it fills. */
    const well = (c: HTMLElement, field: string) => inspector(c).querySelector<HTMLElement>(`[data-well="${field}"]`)!;
    /** Where a well takes a drop. */
    const wellCell = (c: HTMLElement, field: string) => well(c, field).querySelector<HTMLElement>("[data-drag-cell]")!;
    /** A well's pills, by their names. */
    const pillNames = (c: HTMLElement, field: string) => [...well(c, field).querySelectorAll("[data-pill-name]")].map((el) => el.textContent);
    /** A well's pills' chips' words. */
    const chips = (c: HTMLElement, field: string) => [...well(c, field).querySelectorAll("[data-pill-chip]")].map((el) => el.textContent);
    /** A field's card in the Fields list. */
    const fieldCard = (c: HTMLElement, name: string) => within(configurePart(c, "fields")).getByText(name).closest<HTMLElement>("[data-draggable]")!;
    /** Press a button, as a pointer does. */
    const pressOn = async (button: Element) => {
        await act(async () => { fireEvent.click(button); });
        await settle();
    };
    /** Choose a source of the selected visual's picker. */
    async function chooseSource(c: HTMLElement, name: string) {
        await pressOn(configurePart(c, "source").querySelector("[data-configure-source]")!);
        await pressOn(screen.getByRole("option", { name: new RegExp(name) }));
    }

    test("BLD-1: with a source listed, the palette offers each kind an operator configures — the KPI, the seven charts, the three tables and the list — and the text block, in order, over the developers' components", async () => {
        const { container } = await mountBoard();
        expect(within(palette(container)).getByPlaceholderText("Search 17 components…")).toBeTruthy();
        expect(groupHeads(container, ["Visuals · you configure", "Built by developers"])).toEqual(["Visuals · you configure 13", "Built by developers 4"]);
        const visuals = [
            ["KPI", "gauge-high"], ["Column", "chart-column"], ["Bar", "chart-bar"], ["Line", "chart-line"], ["Area", "chart-area"],
            ["Combo", "chart-simple"], ["Scatter", "braille"], ["Pie", "chart-pie"], ["Records", "table-list"], ["Summary", "table"],
            ["Pivot", "table-cells"], ["List", "list"], ["Text", "heading"],
        ] as const;
        // In the declarations' order, before the first developer's component.
        const cards = [...visuals.map(([name]) => cardOf(container, name)), cardOf(container, "KPI rail")];
        expect(cards.every((card, at) => at === 0 || (cards[at - 1]!.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)).toBe(true);
        expect(visuals.filter(([name, icon]) => cardOf(container, name).querySelector(`svg[data-icon="${icon}"]`) === null)).toEqual([]);
        expect(visuals.filter(([name]) => within(cardOf(container, name)).queryByRole("img", { name: "Logic fixed by the developer" }) !== null)).toEqual([]);
    });

    test("BLD-2: a visual dropped from the palette is placed at its kind's span, empty, over the source the page's visuals read most — not the first listed; the text block at the full width — and Save commits them", async () => {
        const { container, was } = await mountBoard();
        for (const name of ["Column", "KPI", "Text"]) await dropCard(container, name);
        const rows = rowsDrawn(container);
        expect(rows).toHaveLength(5);
        const dropped = rows.slice(2).map((row) => row[0]!);
        expect(dropped.map((key) => spanOf(container, key))).toEqual(["6", "3", "12"]);
        await press("Save");
        expect(await commits()).toEqual(["patch", ...was]);
        expect((await boardCells()).slice(3).map((cell) => [cell.key, cell.span, cell.content])).toEqual([
            [dropped[0], 6n, Studio.visual.of("sales", Studio.visual.column({ x: Studio.visual.group(""), values: [] }))],
            [dropped[1], 3n, Studio.visual.of("sales", Studio.visual.kpi({ value: Studio.visual.count() }))],
            [dropped[2], 12n, Studio.visual.text("Write here what the page says.")],
        ]);
    });

    test("EDT-1: a visual or a text block selected opens the Configure tab, a component leaves the tab as it is; the canvas's Edit and a visual's Edit visual open Configure, the pane expanded", async () => {
        const { container } = await mountBoard();
        await select(container, "b-sales");
        expect(openTabName(container)).toBe("Configure");
        await openTab(container, "Layout");
        await select(container, "b-kpi");
        expect(openTabName(container)).toBe("Layout");
        await select(container, "b-note");
        expect(openTabName(container)).toBe("Configure");

        // The canvas's Edit, on the selected tile's bar, the pane collapsed on Layout.
        await openTab(container, "Layout");
        await press("Collapse Inspector");
        await act(async () => { fireEvent.click(within(tile(container, "b-note")).getByRole("button", { name: "Edit" })); });
        await settle();
        expect(screen.getByRole("button", { name: "Collapse Inspector" })).toBeTruthy();
        expect(openTabName(container)).toBe("Configure");

        // A visual's menu's Edit visual: the visual selected, on Configure.
        await openTab(container, "Layout");
        await pickFromMenu(visualMenu(container, "b-sales"), "Edit visual");
        await settle();
        expect(tile(container, "b-sales").hasAttribute("data-selected")).toBe(true);
        expect(openTabName(container)).toBe("Configure");
    });

    test("a visual's menu's Duplicate is the canvas's copy: after it — in a row of its own, its row being full — selected, one gesture Undo takes back", async () => {
        const { container } = await mountBoard();
        await pickFromMenu(visualMenu(container, "b-sales"), "Duplicate");
        await settle();
        expect(rowsDrawn(container)).toEqual([["b-note"], ["b-sales", "b-kpi"], ["b-sales-1"]]);
        expect(tile(container, "b-sales-1").hasAttribute("data-selected")).toBe(true);
        expect(spanOf(container, "b-sales-1")).toBe("8");
        await press("Undo");
        expect(rowsDrawn(container)).toEqual([["b-note"], ["b-sales", "b-kpi"]]);
    });

    test("a text block's heading and body are a form over it — each one edit as the keyboard leaves it, never one a key: a draft drawn on the canvas at once, Undo taking it back, tinted until Save stores it (EDT-10)", async () => {
        const { container, was } = await mountBoard();
        await select(container, "b-note");
        const field = (name: string) => inspector(container).querySelector<HTMLElement>(`[data-field="${name}"]`)!;
        const heading = within(field("heading")).getByRole("textbox") as HTMLInputElement;
        expect(heading.value).toBe("About these numbers");
        await act(async () => { fireEvent.change(heading, { target: { value: "About the figures" } }); });
        await act(async () => { fireEvent.focusOut(heading); });
        await settle();
        expect(textIn(tile(container, "b-note"))).toEqual(["About the figures", "Figures are to last night."]);
        expect([field("heading").hasAttribute("data-dirty"), field("body").hasAttribute("data-dirty")]).toEqual([true, false]);

        const body = within(field("body")).getByRole("textbox") as HTMLTextAreaElement;
        expect(body.value).toBe("Figures are to last night.");
        await act(async () => { fireEvent.change(body, { target: { value: "Figures are to last night.\n\nAsk the desk for more." } }); });
        expect(textIn(tile(container, "b-note"))).toEqual(["About the figures", "Figures are to last night."]);
        await act(async () => { fireEvent.focusOut(body); });
        await settle();
        expect(textIn(tile(container, "b-note"))).toEqual(["About the figures", "Figures are to last night.", "Ask the desk for more."]);
        expect(field("body").hasAttribute("data-dirty")).toBe(true);

        await press("Undo");
        expect(textIn(tile(container, "b-note"))).toEqual(["About the figures", "Figures are to last night."]);
        await press("Save");
        expect(await commits()).toEqual(["patch", ...was]);
        expect((await boardCells())[0]!.content).toEqual(Studio.visual.text("Figures are to last night.", "About the figures"));
        await waitFor(() => expect(field("heading").hasAttribute("data-dirty")).toBe(false));
    });

    test("a visual's kind, view, options, click and source are each one gesture — drawn on the canvas at once, Undo taking it back, tinted until Save writes them in the page's one patch (EDT-8, EDT-9, EDT-10)", async () => {
        const { container, was } = await mountBoard();
        await select(container, "b-sales");
        const part = (name: string) => inspector(container).querySelector<HTMLElement>(`[data-configure="${name}"]`)!;
        /** The segments pressed in a part, by their names. */
        const pressed = (name: string) => [...part(name).querySelectorAll("[aria-pressed=true]")].map((b) => b.getAttribute("aria-label") ?? b.textContent);
        /** The parts tinted as changed: a visual's own parts, then the options' fields. */
        const tinted = () => [
            ...[...inspector(container).querySelectorAll("[data-changed]")].map((el) => el.getAttribute("data-changed")),
            ...[...inspector(container).querySelectorAll("[data-dirty]")].map((el) => el.getAttribute("data-field")),
        ];
        const pressIn = async (name: string, button: string) => {
            await act(async () => { fireEvent.click(within(part(name)).getByRole("button", { name: button })); });
            await settle();
        };
        expect([...inspector(container).querySelectorAll("[data-configure]")].map((el) => el.getAttribute("data-configure")))
            .toEqual(["source", "view", "kind", "wells", "where", "options", "click", "follow", "fields"]);
        /** What a click does, as its select says it. */
        const click = () => part("click").querySelector("[data-configure-click]")!.textContent;
        expect(tinted()).toEqual([]);

        // Another kind of its view keeps every well that fits (EDT-8): the tile is still the revenue by region, and the
        // kind is all that changed.
        await pressIn("kind", "Column");
        expect([pressed("view"), pressed("kind")]).toEqual([["Chart"], ["Column"]]);
        // Under a group of icons, what the chosen one is for.
        expect([...inspector(container).querySelectorAll("[data-configure-hint]")].map((el) => el.textContent))
            .toEqual([
                "Switching view resets the wells.", "Column · categories or periods side by side",
                // Its own filter says what it narrows; the Follows field what following does, while the visual follows none (#1673).
                "Narrows this visual alone, before the page's filters.",
                "Pick a visual whose click selects: this one then shows what is selected there.",
            ]);
        expect(tile(container, "b-sales").querySelector("[data-studio-visual-name]")!.textContent).toBe("Revenue by region");
        expect(tinted()).toEqual(["kind"]);
        // Another view starts its kind empty; Undo brings the column back.
        await pressIn("view", "Table");
        // A table's three kinds say their names, so the group needs no hint.
        expect([pressed("view"), pressed("kind")]).toEqual([["Table"], ["Records"]]);
        // Every well and option of the new kind is changed: the saved bar held none of them.
        expect(tinted()).toEqual(["view", "kind", "columns", "sort", "descending"]);
        await press("Undo");
        expect([pressed("view"), pressed("kind")]).toEqual([["Chart"], ["Column"]]);

        // Its stack, among its declared words; what a click does; and the source, from those the surface lists.
        const stack = part("options").querySelector<HTMLElement>('[data-seg-strip="stack"]')!;
        expect([...stack.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Clustered", "Stacked", "Percent"]);
        await pressIn("options", "Stacked");
        // A chart filters the page by its click unless told otherwise.
        expect(click()).toBe("Filter this page");
        await pressOn(part("click").querySelector("[data-configure-click]")!);
        await pressOn(screen.getByRole("option", { name: "Select it" }));
        expect(click()).toBe("Select it");
        await act(async () => { fireEvent.click(part("source").querySelector("[data-configure-source]")!); });
        await settle();
        await act(async () => { fireEvent.click(screen.getByRole("option", { name: /Daily revenue/ })); });
        await settle();
        expect(part("source").querySelector("[data-configure-source]")!.textContent).toBe("Daily revenue");
        expect(tinted()).toEqual(["source", "kind", "click", "stack"]);

        await press("Save");
        expect(await commits()).toEqual(["patch", ...was]);
        const sales = (await boardCells()).find((cell) => cell.key === "b-sales")!;
        if (sales.content.type !== "visual") throw new Error("expected a visual");
        expect([sales.content.value.source, sales.content.value.view, sales.content.value.click.type]).toEqual([
            "daily", Studio.visual.column({ x: Studio.visual.group("region"), values: [Studio.visual.sum("revenue")], stack: "stacked" }), "select",
        ]);
        await waitFor(() => expect(tinted()).toEqual([]));
    });

    test("a visual's own filter is written with the condition rows in place — a field, then a value its source holds — one gesture, tinted until Save writes it; Undo takes it back and starts the rows afresh; Remove filter takes it off (ruled 19 November 2026)", async () => {
        const { container, was } = await mountBoard();
        await select(container, "b-sales");
        const rows = () => configurePart(container, "where").querySelector<HTMLElement>("[data-studio-filter-rows]")!;
        const lines = () => [...rows().querySelectorAll<HTMLElement>("[data-query-line=row]")].map((row) => row.textContent ?? "");
        const tinted = () => [...inspector(container).querySelectorAll("[data-changed]")].map((el) => el.getAttribute("data-changed"));
        const remove = () => inspector(container).querySelector<HTMLElement>("[data-configure-remove-filter]");
        // With no filter of its own: one row still to be written, nothing to remove.
        expect([lines().length, remove()]).toEqual([1, null]);
        // Its field, then one of the values the sales hold: the condition is the visual's at once.
        await openSlot(rows(), "field");
        await pick("region");
        await waitFor(() => expect(offers()).toContain("North"));
        await pick("North");
        expect([tinted(), lines()[0]!.includes("North"), remove() !== null]).toEqual([["where"], true, true]);
        // Undo takes it back, and the rows start afresh over no filter; Redo brings it again.
        await press("Undo");
        expect([tinted(), lines().length, lines()[0]!.includes("North"), remove()]).toEqual([[], 1, false, null]);
        await press("Redo");
        expect([tinted(), lines()[0]!.includes("North")]).toEqual([["where"], true]);
        await press("Save");
        expect(await commits()).toEqual(["patch", ...was]);
        const sales = (await boardCells()).find((cell) => cell.key === "b-sales")!;
        if (sales.content.type !== "visual") throw new Error("expected a visual");
        expect(sales.content.value.where).toEqual(some(condition(`.region == "North"`)));
        await waitFor(() => expect(tinted()).toEqual([]));
        // Remove filter: the filter off, one gesture, the rows empty again.
        await pressOn(remove()!);
        expect([tinted(), lines().length, lines()[0]!.includes("North"), remove()]).toEqual([["where"], 1, false, null]);
    });

    test("an operator places a column chart, picks a source, drops a date on its X axis and a number on its values — the canvas draws it, each a gesture Undo takes back, and Save writes one patch (EDT-3, EDT-5, MOD-6)", async () => {
        const { container, was } = await mountBoard();
        await dropCard(container, "Column");
        const key = rowsDrawn(container)[2]![0]!;
        await select(container, key);
        await chooseSource(container, "Daily revenue");
        await dragOnto(fieldCard(container, "Day"), wellCell(container, "x"));
        await dragOnto(fieldCard(container, "Revenue"), wellCell(container, "values"));
        expect([pillNames(container, "x"), pillNames(container, "values")]).toEqual([["Day"], ["Revenue"]]);
        // A date on an axis is bucketed by month; a number in a value well, summed (MOD-6).
        expect([chips(container, "x"), chips(container, "values")]).toEqual([["Month"], ["Sum"]]);
        await waitFor(() => expect(tile(container, key).querySelector("[data-studio-visual-name]")?.textContent).toBe("Revenue by month"));

        await press("Undo");
        expect([pillNames(container, "x"), pillNames(container, "values")]).toEqual([["Day"], []]);
        await press("Redo");
        expect(pillNames(container, "values")).toEqual(["Revenue"]);
        await press("Save");
        expect(await commits()).toEqual(["patch", ...was]);
        expect((await boardCells()).find((cell) => cell.key === key)!.content).toEqual(Studio.visual.of("daily", Studio.visual.column({
            x: Studio.visual.group("day", { bucket: "month" }), values: [Studio.visual.sum("revenue")],
        })));
    });

    test("every drag has a keyboard path that makes the same edit: a well's slot adds a field from its chooser, a single well's pill's kind mark changes its field, ⌥↑ and ⌥↓ move a list well's pill, keeping the keyboard, and its × takes it out (EDT-3, EDT-5)", async () => {
        const { container, was } = await mountBoard();
        await select(container, "b-sales");
        // Values' slot: Channel — any field but a number counted by its values (MOD-6).
        await pressOn(well(container, "values").querySelector("[data-well-add]")!);
        await pressOn(screen.getByRole("option", { name: /Channel/ }));
        expect(pillNames(container, "values")).toEqual(["Revenue", "Different channels"]);
        const grip = (at: number) => well(container, "values").querySelectorAll<HTMLElement>("[data-pill-grip]")[at]!;
        expect(grip(1).getAttribute("aria-label")).toBe("Move Different channels");
        await act(async () => { grip(1).focus(); fireEvent.keyDown(grip(1), { key: "ArrowUp", altKey: true }); });
        await settle();
        expect(pillNames(container, "values")).toEqual(["Different channels", "Revenue"]);
        expect(document.activeElement).toBe(grip(0));
        await act(async () => { fireEvent.keyDown(grip(0), { key: "ArrowDown", altKey: true }); });
        await settle();
        expect(pillNames(container, "values")).toEqual(["Revenue", "Different channels"]);
        expect(document.activeElement).toBe(grip(1));
        // X's field, changed in place: Channel, highest first.
        await pressOn(within(well(container, "x")).getByRole("button", { name: "Change Region" }));
        await pressOn(screen.getByRole("option", { name: /Channel/ }));
        expect(pillNames(container, "x")).toEqual(["Channel"]);
        await pressOn(within(well(container, "values")).getByRole("button", { name: "Remove Different channels from Values" }));
        expect(pillNames(container, "values")).toEqual(["Revenue"]);
        await press("Save");
        expect(await commits()).toEqual(["patch", ...was]);
        const sales = (await boardCells()).find((cell) => cell.key === "b-sales")!;
        if (sales.content.type !== "visual") throw new Error("expected a visual");
        expect(sales.content.value.view).toEqual(Studio.visual.bar({ x: Studio.visual.group("channel", { sort: "high" }), values: [Studio.visual.sum("revenue")] }));
    });

    test("a well takes only the fields it accepts: a KPI's trend a date — its chooser offers another refused, saying why, and a drag of one over it is refused (EDT-4)", async () => {
        const { container } = await mountBoard();
        await select(container, "b-sales");
        await pressOn(within(configurePart(container, "view")).getByRole("button", { name: "KPI" }));
        expect([...inspector(container).querySelectorAll("[data-well]")].map((el) => el.getAttribute("data-well"))).toEqual(["value", "compare", "trend"]);
        await pressOn(well(container, "trend").querySelector("[data-well-add]")!);
        const region = screen.getByRole("option", { name: /Region/ });
        expect([region.getAttribute("aria-disabled"), region.textContent]).toEqual(["true", "RegionTrend cannot take Region"]);
        await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); });
        await settle();
        await dragOnto(fieldCard(container, "Region"), wellCell(container, "trend"), false);
        expect(wellCell(container, "trend").hasAttribute("data-drop-invalid")).toBe(true);
        expect(document.querySelector("[data-drag-caption]")?.textContent).toBe("Trend cannot take Region");
        await act(async () => { fireEvent.pointerUp(document, { clientX: 10, clientY: 10 }); });
        await settle();
        expect(pillNames(container, "trend")).toEqual([]);
    });

    test("a value pill's menu sets its aggregate, its period, which way is better and its label; a group pill's popover its order (EDT-6, EDT-7)", async () => {
        const { container, was } = await mountBoard();
        await select(container, "b-sales");
        // A pill's name and what it is set to are one button, which opens its menu.
        expect(within(well(container, "values")).getByRole("button", { name: "Edit Revenue" }).textContent).toBe("RevenueSum");
        await pressOn(well(container, "values").querySelector("[data-pill-chip]")!);
        const menu = () => within(document.querySelector<HTMLElement>("[data-pill-menu=value]")!);
        const aggregates = () => [...menu().getByRole("radiogroup", { name: "Aggregate" }).querySelectorAll("button")]
            .map((b) => `${b.textContent?.trim()}${b.getAttribute("aria-checked") === "true" ? " (on)" : ""}`);
        expect(aggregates()).toEqual(["Sum (on)", "Mean", "Min", "Max", "Distinct", "Count", "Per another field…"]);
        await pressOn(menu().getByRole("radio", { name: "Mean" }));
        // An edit keeps the menu open.
        expect(aggregates()[1]).toBe("Mean (on)");
        await pressOn(menu().getByRole("button", { name: "Yr ago" }));
        await pressOn(menu().getByRole("button", { name: "Lower" }));
        expect([chips(container, "values"), [...well(container, "values").querySelectorAll("[data-pill-meta]")].map((el) => el.textContent)])
            .toEqual([["Mean"], ["year ago"]]);
        const label = within(document.querySelector<HTMLElement>("[data-pill-menu=value] [data-field=label]")!).getByRole("textbox");
        await act(async () => { fireEvent.change(label, { target: { value: "Takings" } }); });
        await act(async () => { fireEvent.focusOut(label); });
        await settle();
        expect(pillNames(container, "values")).toEqual(["Takings"]);

        // A group by a text field has no chip — only a date's bucket has one: its name opens its popover.
        expect(chips(container, "x")).toEqual([]);
        await pressOn(within(well(container, "x")).getByRole("button", { name: "Edit Region" }));
        const group = () => within(document.querySelector<HTMLElement>("[data-pill-menu=group]")!);
        // Its order is the shared form's choice of four: a radio group.
        expect((group().getAllByRole("radio") as HTMLInputElement[]).map((radio) => radio.checked)).toEqual([true, false, false, false]);
        await pressOn(group().getByRole("radio", { name: "A to Z" }));
        await press("Save");
        expect(await commits()).toEqual(["patch", ...was]);
        const sales = (await boardCells()).find((cell) => cell.key === "b-sales")!;
        if (sales.content.type !== "visual") throw new Error("expected a visual");
        expect(sales.content.value.view).toEqual(Studio.visual.bar({
            x: Studio.visual.group("region", { sort: "label" }),
            values: [Studio.visual.mean("revenue", { label: "Takings", period: "year_ago", better: "lower" })],
        }));
    });

    test("a value pill's menu sets how its numbers are shown: as its field's until it takes a format of its own — a currency's code under the choice, three letters — each one gesture, Save writing it", async () => {
        const { container, was } = await mountBoard();
        await select(container, "b-sales");
        await pressOn(well(container, "values").querySelector("[data-pill-chip]")!);
        const field = (name: string) => document.querySelector<HTMLElement>(`[data-pill-menu=value] [data-field="${name}"]`);
        const strip = () => field("format")!.querySelector<HTMLElement>('[data-seg-strip="format"]')!;
        const formats = () => [...strip().querySelectorAll("button")].map((b) => `${b.textContent}${b.getAttribute("aria-pressed") === "true" ? " (on)" : ""}`);
        const pick = (name: string) => pressOn(within(strip()).getByRole("button", { name }));
        // After which way is better, before its label; as its field's until it has one of its own, which its help line says.
        const order = [...document.querySelectorAll("[data-pill-menu=value] [data-field]")].map((el) => el.getAttribute("data-field"));
        expect(order).toEqual(["period", "goal", "better", "format", "label"]);
        expect(formats()).toEqual(["Auto (on)", "Number", "Percent", "Money"]);
        expect(field("format")!.textContent).toContain("Auto shows it as its field's format says.");
        await pick("Percent");
        expect([formats(), field("format.currency")]).toEqual([["Auto", "Number", "Percent (on)", "Money"], null]);

        // A currency: its code in a block under the choice — its field's, here none's.
        await pick("Money");
        const code = () => within(field("format.currency")!).getByRole("textbox", { name: "Currency code" }) as HTMLInputElement;
        expect([formats()[3], code().value]).toEqual(["Money (on)", "USD"]);
        // Typed in small letters, it is taken in capitals; what is no code is refused, the field saying why.
        await act(async () => { fireEvent.change(code(), { target: { value: "aud" } }); });
        await act(async () => { fireEvent.focusOut(code()); });
        await settle();
        expect(code().value).toBe("AUD");
        await act(async () => { fireEvent.change(code(), { target: { value: "dollars" } }); });
        await act(async () => { fireEvent.focusOut(code()); });
        await settle();
        expect(field("format.currency")!.textContent).toContain("A currency's code is three letters, as AUD");

        // Each a gesture Undo takes back: the code, then the choice of a currency.
        await press("Undo");
        expect(code().value).toBe("USD");
        await press("Redo");
        expect(code().value).toBe("AUD");
        await press("Save");
        expect(await commits()).toEqual(["patch", ...was]);
        const sales = (await boardCells()).find((cell) => cell.key === "b-sales")!;
        if (sales.content.type !== "visual") throw new Error("expected a visual");
        expect(sales.content.value.view).toEqual(Studio.visual.bar({
            x: Studio.visual.group("region"), values: [Studio.visual.sum("revenue", { format: { currency: { code: "AUD" } } })],
        }));

        // As its field's again: the value holds no format of its own.
        await pick("Auto");
        expect([formats()[0], field("format.currency")]).toEqual(["Auto (on)", null]);
        await press("Save");
        const back = (await boardCells()).find((cell) => cell.key === "b-sales")!;
        expect(back.content).toEqual(bars);
    });

    test("a chart's legend is an option of its kind: drawn where it names more than one series, or hidden; a pie's its values, its names or hidden — one gesture, Save writing it", async () => {
        const { container, was } = await mountBoard();
        await select(container, "b-sales");
        const options = () => configurePart(container, "options");
        const strip = (name: string) => options().querySelector<HTMLElement>(`[data-seg-strip="${name}"]`)!;
        const words = (name: string) => [...strip(name).querySelectorAll("button")].map((b) => `${b.textContent}${b.getAttribute("aria-pressed") === "true" ? " (on)" : ""}`);
        expect(words("legend")).toEqual(["Auto (on)", "Hidden"]);
        await pressOn(within(strip("legend")).getByRole("button", { name: "Hidden" }));
        expect(words("legend")).toEqual(["Auto", "Hidden (on)"]);
        // A pie keeps it hidden, and offers its names alone.
        await pressOn(within(configurePart(container, "kind")).getByRole("button", { name: "Pie" }));
        expect(words("legend")).toEqual(["Values", "Names", "Hidden (on)"]);
        await pressOn(within(strip("legend")).getByRole("button", { name: "Names" }));
        await press("Save");
        expect(await commits()).toEqual(["patch", ...was]);
        const sales = (await boardCells()).find((cell) => cell.key === "b-sales")!;
        if (sales.content.type !== "visual") throw new Error("expected a visual");
        expect(sales.content.value.view).toEqual(Studio.visual.pie({ slice: Studio.visual.group("region"), value: Studio.visual.sum("revenue"), legend: "names" }));
    });

    test("a source changed keeps the wells whose fields it has; a pill whose field it lacks is marked in its well, which says which, and so does the tile (EDT-9, MOD-5)", async () => {
        const { container } = await mountBoard();
        await select(container, "b-sales");
        await chooseSource(container, "Daily revenue");
        expect([well(container, "x").querySelector("[data-well-pill]")!.hasAttribute("data-missing"), well(container, "values").querySelector("[data-well-pill]")!.hasAttribute("data-missing")])
            .toEqual([true, false]);
        expect(well(container, "x").querySelector("[data-well-missing]")!.textContent).toBe("Daily revenue has no field region. Pick another or remove it.");
        // The tile says so in its missing-field state, the field's name as code, its meta `needs a field` (TIL-3).
        await waitFor(() => expect(tile(container, "b-sales").querySelector("[data-studio-visual=missing] code")?.textContent).toBe("region"));
        const state = tile(container, "b-sales").querySelector<HTMLElement>("[data-studio-visual=missing]")!;
        expect([state.textContent, tile(container, "b-sales").querySelector("[data-studio-visual-meta]")?.textContent])
            .toEqual(["Daily revenue has no field regionPick another field", "needs a field"]);
    });

    test("the Fields list: its source's fields, what a visual groups by then numbers, each a well holds checked (EDT-3)", async () => {
        const { container } = await mountBoard();
        await select(container, "b-sales");
        const fields = configurePart(container, "fields");
        // Under its source's name and how many it has, each group's fields in order.
        expect([fields.getAttribute("aria-label"), fields.querySelector("[data-fields-count]")!.textContent]).toEqual(["Sales fields", "3"]);
        expect([...fields.querySelectorAll("ul")].map((list) => [list.getAttribute("aria-label"), ...[...list.querySelectorAll("[data-field-row]")].map((row) => row.textContent)]))
            .toEqual([["Dimensions", "Region", "Channel"], ["Numbers", "Revenue"]]);
        // Its search narrows them, by a field's label.
        await act(async () => { fireEvent.change(within(fields).getByRole("searchbox", { name: "Find a field" }), { target: { value: "chan" } }); });
        expect([...fields.querySelectorAll("[data-field-row]")].map((row) => row.textContent)).toEqual(["Channel"]);
        await act(async () => { fireEvent.change(within(fields).getByRole("searchbox", { name: "Find a field" }), { target: { value: "" } }); });
        expect(["Region", "Channel", "Revenue"].map((name) => fieldCard(container, name).hasAttribute("data-placed"))).toEqual([true, false, true]);
        expect(within(fieldCard(container, "Region")).getByRole("img", { name: "In use" })).toBeTruthy();
        expect(within(fieldCard(container, "Channel")).queryByRole("img", { name: "In use" })).toBeNull();
    });
});
