/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Builder>` rendered (#1000), what a placement holds (#1669): a text
 * block bare, a visual's tile naming its view and its source, on the canvas
 * and in the preview; what the selection bar and the inspector say of each;
 * and a placement configured since the live version, in the preview's change
 * list. The record and the builders are `builder.test-utils.tsx`'s.
 */

import { describe, test, expect } from "vitest";
import { waitFor, within } from "@testing-library/react";
import { East, NullType, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { markOf } from "@elaraai/east-ui-components/testing";
import { Data, Record, Studio, StudioFiltersType, StudioKeyType, studioFiltersKey } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, settle } from "../e3-web-mount.test-utils.js";
import { condition } from "../query/visual/visual.test-utils.js";
import {
    components, PAGES, h, ASKED, withEntry, readRecord, tile, inspector, openTabName, openTab, spanOf, textIn, placed, select, keyOn, press, type Key,
    type Entry,
} from "./builder.test-utils.js";

/** A page's reader's filters, as the UI store holds them. */
const encodeFilters = encodeBeast2For(StudioFiltersType);

describe("<Studio.Builder> — what a placement holds (#1669)", () => {
    const NOTES: Key = { project: "ops", page: "g-notes" };
    /** The sales by region as columns, and as bars with a second value, over the listed source; a KPI over a source the surface does not list; a note, and the note edited. */
    const byRegion = Studio.visual.group("region");
    const columns = Studio.visual.of("sales", Studio.visual.column({ x: byRegion, values: [Studio.visual.sum("revenue")] }));
    const bars = Studio.visual.of("sales", Studio.visual.bar({ x: byRegion, values: [Studio.visual.sum("revenue"), Studio.visual.count()] }));
    const stock = Studio.visual.of("stock", Studio.visual.kpi({ value: Studio.visual.sum("units") }));
    const noteWas = Studio.visual.text("Figures are to last night.", "About these numbers");
    const note = Studio.visual.text("Figures are to last night.\nRefreshed at six.\n\n\nAsk the desk for more.", "About these numbers");
    /** The Notes page: live as v1 — the note over the sales as columns — and its draft since: the note edited, the sales as bars, the KPI beside them, and a component under them. */
    const NOTES_PAGE: Entry = variant("page", {
        draft: {
            title: "Notes",
            cells: [
                placed("n-note", "r1", 12n, note), placed("n-sales", "r2", 8n, bars), placed("n-stock", "r2", 4n, stock),
                placed("n-kpi", "r3", 12n, Studio.visual.component("kpi_rail")),
            ],
            filters: [],
        },
        live: some({ version: 1n, page: { title: "Notes", cells: [placed("n-note", "r1", 12n, noteWas), placed("n-sales", "r2", 8n, columns)], filters: [] } }),
    });

    /** A builder that lists the sales as a source, its surface holding the Notes page open. */
    const notesBuilder = {
        fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            const record = $.let(Record.bind(ex.studioPages, ["patch"]));
            const sales = $.let(Data.bind(ex.studioSales));
            const asked = $.let(State.bind([StudioKeyType], ASKED, { project: "", page: "" }));
            const heard = $.const(East.function([StudioKeyType], NullType, ($2, key) => { $2(asked.write(key)); }));
            return Studio.Builder({
                pages: record, components: listed, project: "ops", page: NOTES, onOpen: heard,
                sources: { sales: Studio.source(sales, { name: "Sales", icon: "receipt" }) },
            });
        }))),
    };

    /** Mount it over the record with the Notes page in it. */
    async function mountNotes() {
        await h.patch(ex.studioPages, withEntry(NOTES, NOTES_PAGE)(PAGES));
        return h.mount(notesBuilder, { storageKey: "studio-builder" });
    }
    /** Whether a canvas tile draws a frame. */
    const framed = (c: HTMLElement, key: string) => tile(c, key).querySelector("[data-frame]") !== null;

    test("on the canvas: a text block is its heading over its paragraphs, bare — a blank line starts a new one; a visual is a tile naming its view and its source, one whose source the surface does not list says so; a component is its own UI", async () => {
        const { container } = await mountNotes();
        expect([...container.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile"))).toEqual(["n-note", "n-sales", "n-stock", "n-kpi"]);
        expect(textIn(tile(container, "n-note"))).toEqual(["About these numbers", "Figures are to last night.\nRefreshed at six.", "Ask the desk for more."]);
        expect(tile(container, "n-note").querySelector("[data-studio-text-heading]")!.tagName).toBe("H3");
        expect([framed(container, "n-note"), framed(container, "n-sales"), framed(container, "n-stock")]).toEqual([false, true, true]);
        // Its eyebrow names it (#1671, TIL-1): with no title of its own, by its wells, and its meta says what it groups by.
        const eyebrow = tile(container, "n-sales").querySelector("[data-studio-visual-head]")!;
        expect([...eyebrow.querySelectorAll("[data-studio-visual-name], [data-studio-visual-meta]")].map((el) => el.textContent)).toEqual(["Revenue by region", "by region"]);
        expect(within(tile(container, "n-stock")).getByText('No source "stock" is listed')).toBeTruthy();
        expect(within(tile(container, "n-stock")).getByText("This surface lists no source with this key.")).toBeTruthy();
        expect(tile(container, "n-kpi").textContent).toContain("KPIs");
    });

    test("the content example (studioContent): a text block, two visuals over the listed sales — one under its own title — a component, and two visuals over the listed returns, on the canvas of a record that declares the migration step", async () => {
        const { container } = await h.mount(ex.studioContent, { storageKey: "studio-content" });
        await settle();
        await waitFor(() => expect(container.querySelector('[data-snap-grid-tile="s-note"]')).not.toBeNull());
        expect([...container.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile"))).toEqual([
            "s-note", "s-revenue", "s-top", "s-kpi", "s-reasons", "s-returned",
        ]);
        expect(textIn(tile(container, "s-note"))).toEqual(["About these numbers", "Figures are to last night's close.", "Revenue is in US dollars, before returns."]);
        // Each visual's eyebrow names it (#1671, TIL-1): its own title, else a name made from its wells.
        const named = (key: string) => tile(container, key).querySelector("[data-studio-visual-name]")!.textContent;
        expect(["s-revenue", "s-top", "s-reasons", "s-returned"].map(named)).toEqual(["Revenue by region", "Regions", "Refunds by reason", "Items returned"]);
        await select(container, "s-revenue");
        expect(inspector(container).querySelector("[data-inspector-name]")!.textContent).toBe("Revenue by region");
    });

    test("the selection bar and the inspector say what is selected: a visual by its view and its source, its Configure tab its source, its view and its kind, no developer's lock; a text block by Text, its form and its layout", async () => {
        const { container } = await mountNotes();
        const bar = () => container.querySelector<HTMLElement>("[data-snap-grid-selection]")!;
        const block = (name: string) => inspector(container).querySelector(`[data-inspector="${name}"]`);
        const part = (name: string) => inspector(container).querySelector<HTMLElement>(`[data-configure="${name}"]`);
        /** The segments pressed in a part, by their names: the view's, then the kind's. */
        const pressed = (el: HTMLElement) => [...el.querySelectorAll("[aria-pressed=true]")].map((b) => b.getAttribute("aria-label") ?? b.textContent);

        await select(container, "n-sales");
        expect(openTabName(container)).toBe("Configure");
        expect(bar().querySelector("svg")!.getAttribute("data-icon")).toBe("chart-bar");
        expect([...bar().children].slice(1).map((el) => el.textContent)).toEqual(["Bar chart · Sales", "Sales"]);
        // Under its name, what it is: its view, its kind and its source's key.
        expect([...block("selection")!.children].map((el) => el.textContent)).toEqual(["Selected visual", "Bar chart · Sales", "chart · bar · sales"]);
        expect(part("source")!.querySelector("[data-configure-source]")!.textContent).toBe("Sales");
        expect([pressed(part("view")!), pressed(part("kind")!)]).toEqual([["Chart"], ["Bar"]]);
        expect([block("data"), block("config"), block("footer")]).toEqual([null, null, null]);
        await openTab(container, "Layout");
        expect(inspector(container).querySelector("[data-inspector-span]")!.textContent).toBe("8 / 12");

        // A visual selected opens its Configure tab (EDT-1); a source the surface does not list is named by its key.
        await select(container, "n-stock");
        expect(openTabName(container)).toBe("Configure");
        expect([...block("selection")!.children].map((el) => el.textContent)).toEqual(["Selected visual", "KPI · stock", "kpi · stock"]);
        expect(part("source")!.querySelector("[data-configure-source]")!.textContent).toBe("stock");
        expect(pressed(part("view")!)).toEqual(["KPI"]);

        await select(container, "n-note");
        expect([...bar().children].slice(1).map((el) => el.textContent)).toEqual(["Text"]);
        expect(block("selection")!.textContent).toBe("Selected textText");
        expect(part("text")).not.toBeNull();
        expect([block("data"), part("source"), block("config"), block("footer")]).toEqual([null, null, null, null]);
        await openTab(container, "Layout");
        expect(block("layout")).not.toBeNull();

        // A component leaves the tab open as it is; its Configure tab holds what it held before.
        await select(container, "n-kpi");
        expect(openTabName(container)).toBe("Layout");
        await openTab(container, "Configure");
        expect(block("selection")!.textContent).toBe("Selected componentKPI rail");
        expect(block("footer")!.textContent).toBe("Published component · logic immutable");
    });

    test("a layout edit of a visual is a draft like any other, and Save keeps what it holds", async () => {
        const { container } = await mountNotes();
        await keyOn(container, "n-sales", { key: "[" });
        expect(spanOf(container, "n-sales")).toBe("7");
        await press("Save");
        const notes = (await readRecord()).get(NOTES)!;
        if (notes.type !== "page") throw new Error("expected a page");
        expect(notes.value.draft.cells.map((c) => [c.key, c.span, c.content])).toEqual([
            ["n-note", 12n, note], ["n-sales", 7n, bars], ["n-stock", 4n, stock], ["n-kpi", 12n, Studio.visual.component("kpi_rail")],
        ]);
    });

    test("the publish preview: the page as it will publish, its text block bare; and a placement configured since the live version, named by what it holds, its change in words", async () => {
        const { container } = await mountNotes();
        await press("Preview");
        const frame = container.querySelector<HTMLElement>("[data-studio-publish] [data-publish-frame]")!;
        const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-snap-grid-cell="${key}"]`)!;
        expect(textIn(cell("n-note"))).toEqual(["About these numbers", "Figures are to last night.\nRefreshed at six.", "Ask the desk for more."]);
        expect([cell("n-note").hasAttribute("data-frame"), cell("n-sales").hasAttribute("data-frame")]).toEqual([false, true]);
        // Named as the canvas names it: by its wells (TIL-1).
        expect(cell("n-sales").querySelector("[data-studio-visual-name]")!.textContent).toBe("Revenue by region");
        expect([...container.querySelectorAll("[data-studio-publish] [data-publish-change]")].map((row) => [row.getAttribute("data-publish-change"), row.textContent])).toEqual([
            ["configured", "Configured Texttext edited"],
            ["configured", "Configured Bar chart · Salesview Column chart → Bar chart · values 1 → 2"],
            ["added", "Added KPI · stockrow 2 · span 4"],
            ["added", "Added KPI railrow 3 · span 12"],
        ]);
        expect(markOf(container.querySelector('[data-publish-change="configured"] [data-sign]'))).toBe("fas plus-minus");
    });

    test("the builder's toolbar holds no filter rail, and its canvas is the page as designed: a reader's filter narrows its Preview, never its canvas (ruled 19 November 2026)", async () => {
        const { container } = await mountNotes();
        // A reader's filter of the Notes page that no sale passes, as its Preview's rail sets it.
        await act(async () => {
            StateRuntime.getStore().write(studioFiltersKey(NOTES), encodeFilters([{ source: "sales", where: condition(`.region == "Nowhere"`), from: none }]));
        });
        await settle();
        expect(container.querySelector("[data-frame-slot=toolbar] [data-slice-rail='studio-filters']")).toBeNull();
        // The canvas's tile draws the sales whole.
        await waitFor(() => expect(tile(container, "n-sales").querySelector("[data-studio-chart]")).not.toBeNull());
        expect(tile(container, "n-sales").querySelector("[data-studio-visual=no-rows]")).toBeNull();
        // Its Preview is the page as a reader sees it: the rail over its grid, and the reader's filter narrowing it.
        await press("Preview");
        const frame = container.querySelector<HTMLElement>("[data-studio-publish] [data-publish-frame]")!;
        expect(frame.querySelector("[data-studio-filters] [data-slice-rail='studio-filters']")).not.toBeNull();
        await waitFor(() => expect(frame.querySelector('[data-snap-grid-cell="n-sales"] [data-studio-visual=no-rows]')).not.toBeNull());
    });

    test("the publish preview's change list says a component by its name, never its key: one swapped for another names both", async () => {
        // The Notes page, live with the KPI rail; its draft holds the revenue trend in its place.
        const swapped: Entry = variant("page", {
            draft: { title: "Notes", cells: [placed("n-kpi", "r1", 12n, Studio.visual.component("revenue_trend"))], filters: [] },
            live: some({ version: 1n, page: { title: "Notes", cells: [placed("n-kpi", "r1", 12n, Studio.visual.component("kpi_rail"))], filters: [] } }),
        });
        await h.patch(ex.studioPages, withEntry(NOTES, swapped)(PAGES));
        const { container } = await h.mount(notesBuilder, { storageKey: "studio-builder" });
        await press("Preview");
        expect([...container.querySelectorAll("[data-studio-publish] [data-publish-change]")].map((row) => [row.getAttribute("data-publish-change"), row.textContent]))
            .toEqual([["configured", "Configured Revenue trendKPI rail → Revenue trend"]]);
    });
});
