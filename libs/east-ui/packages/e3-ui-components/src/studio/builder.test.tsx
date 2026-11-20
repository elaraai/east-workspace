/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Builder>` rendered (#1000) over the studio examples' pages record on
 * e3 (#1376), its patch door e3's own and its pages the test's, committed as
 * another session's — every part drawn by the builder's renderer
 * (`builder.test-utils.tsx` holds the record, the builders and how a test
 * reaches them). The palette (#994): its tabs and rail (B1), the search, the
 * grouping and the Filter menu (B2), the cards by category (B3), the placed
 * component (B4), a card's click and the drag source (B5), the Pages tab (B6),
 * what is hidden and narrowed (B7). The page it shows (#1668): its host's,
 * which its palette's Pages tab asks to change; or, given none, its own, kept
 * for a reload while it stands. The canvas (#995): the one toolbar and the
 * page's status (B8), the selection bar (B9), the grid panel (B10), a dropped
 * card's cell (B11), Save as one patch commit and a save another session's
 * overtakes (B12), the panes (B13), Preview, Publish, Desktop, Tablet and
 * Mobile — the page laid out as a phone shows it (B14). The inspector (#996): its pane and rail (B15), the selected placement
 * (B16–B18), its layout edits (B20, B12) — the height select's chevron and
 * check Font Awesome's (#1263) — nothing selected (B21), and the palette
 * counting unsaved drafts.
 *
 * Its other parts are tested beside it: `builder-publish.test.tsx`,
 * `builder-toolbar.test.tsx`, `builder-content.test.tsx` and
 * `builder-configure.test.tsx`.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { SortedMap, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { foreignIcons, markOf } from "@elaraai/east-ui-components/testing";
import { Studio } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, reloadPage, settle } from "../e3-web-mount.test-utils.js";
import {
    RECORD_NAMED, keys, OVERVIEW, PAGES, h, before, ASKED, heldBuilder, ownBuilder, twoBuilders, mountBuilder, withEntry, openPage, held, sharedEntry, readRecord, commits, click,
    toolbarItems, item, tile, palette, cardOf, inspectorPane, inspector, openTabName, openTab, groupHeads, spanOf, rowsDrawn, select, keyOn, press,
    pickFromMenu, dropCard, type Entry,
} from "./builder.test-utils.js";

describe("<Studio.Builder> — the palette (#994)", () => {
    test("B1: the row holds the Components and Pages tabs and the collapse control; collapsed, the rail shows the icon, the count and the name", async () => {
        const { container } = await mountBuilder();
        const pane = within(palette(container));
        expect(pane.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Components", "Pages"]);
        expect(pane.getAllByRole("tab")[0]!.getAttribute("aria-selected")).toBe("true");

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Components" })); });
        expect(screen.getByRole("button", { name: "Expand Components" })).toBeTruthy();
        expect(pane.queryAllByRole("tab")).toHaveLength(0);
        expect(palette(container).querySelector("svg[data-icon=shapes]")).not.toBeNull();
        // Four components offered — the deprecated one is not counted — and the text block: no source is listed, so no
        // visual of data is offered (#1672).
        expect(palette(container).querySelector("[data-dock-badge]")!.textContent).toBe("5");
        expect(pane.getByText("Components")).toBeTruthy();
    });

    test("B2: the search counts the cards, with its key; the grouping is by who configures a card; the Filter menu", async () => {
        const { container } = await mountBuilder();
        const pane = within(palette(container));
        expect(pane.getByPlaceholderText("Search 5 components…")).toBeTruthy();
        expect(within(pane.getByRole("tabpanel", { name: "Components" })).getByText("⌘ /")).toBeTruthy();
        expect(pane.getByRole("button", { name: "Group by" }).textContent).toBe("Group · Configured by");
        expect(pane.getByRole("button", { name: "Filter" })).toBeTruthy();
    });

    test("B3, BLD-1: the cards group by who configures them — the text block over the developers' components — or by category, each group counted; a component's card holds its icon, its name, what it reads and a lock", async () => {
        const { container } = await mountBuilder();
        expect(groupHeads(container, ["Visuals · you configure", "Built by developers"])).toEqual(["Visuals · you configure 1", "Built by developers 4"]);
        await pickFromMenu(within(palette(container)).getByRole("button", { name: "Group by" }), "Category");
        await settle();
        expect(groupHeads(container, ["Visuals", "Display", "Charts"])).toEqual(["Visuals 1", "Display 2", "Charts 2"]);
        const trend = cardOf(container, "Revenue trend");
        expect(trend.querySelector("svg[data-icon=chart-area]")).not.toBeNull();
        expect(within(trend).getByText(RECORD_NAMED)).toBeTruthy();
        expect(within(cardOf(container, "KPI rail")).getByText("no data")).toBeTruthy();
        expect(within(trend).getByRole("img", { name: "Logic fixed by the developer" })).toBeTruthy();
        expect(within(palette(container)).getAllByRole("img", { name: "Logic fixed by the developer" })).toHaveLength(4);
        // The text block's card: its icon and its name, and no lock — what it shows is the operator's.
        const text = cardOf(container, "Text");
        expect(text.querySelector("svg[data-icon=heading]")).not.toBeNull();
        expect(within(text).queryByRole("img", { name: "Logic fixed by the developer" })).toBeNull();
    });

    test("B4: the component the canvas has selected is placed, and counts its placements on the page", async () => {
        const { container } = await mountBuilder();
        await openPage("d-double");
        expect(cardOf(container, "Revenue trend").hasAttribute("data-placed")).toBe(false);
        await select(container, "d-trend-2");
        const trend = cardOf(container, "Revenue trend");
        expect(trend.hasAttribute("data-placed")).toBe(true);
        expect(within(trend).getByText("ON CANVAS · ×2")).toBeTruthy();
        expect(cardOf(container, "KPI rail").hasAttribute("data-placed")).toBe(false);
    });

    test("B5: a click selects the component's first placement; one the page does not place selects nothing new; the cards are drag sources", async () => {
        const { container } = await mountBuilder();
        expect(container.querySelector("[data-snap-grid-tile][data-selected]")).toBeNull();
        await act(async () => { fireEvent.click(cardOf(container, "Revenue trend")); });
        await settle();
        expect(tile(container, "c-trend").hasAttribute("data-selected")).toBe(true);
        await act(async () => { fireEvent.click(cardOf(container, "Orders by week")); });
        await settle();
        expect(tile(container, "c-trend").hasAttribute("data-selected")).toBe(true);
        expect(cardOf(container, "Orders by week").hasAttribute("data-draggable")).toBe(true);
    });

    test("B6: the Pages tab lists the project's pages with their status dots; the open page is placed; a click opens a page, with nothing selected", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await act(async () => { fireEvent.click(within(palette(container)).getByRole("tab", { name: "Pages" })); });
        const pages = within(within(palette(container)).getByRole("tabpanel", { name: "Pages" }));
        expect(["Overview", "Weekly", "Monthly", "Double", "Regional"].every((title) => pages.queryByText(title) !== null)).toBe(true);
        expect(pages.queryByText("Starter")).toBeNull();
        expect(pages.queryByText("Home")).toBeNull();
        expect(pages.getByText("LIVE · V1")).toBeTruthy();
        expect(pages.getAllByText("DRAFT · V3 LIVE")).toHaveLength(2);
        expect(pages.getAllByRole("img", { name: "Live" })).toHaveLength(1);
        expect(pages.getAllByRole("img", { name: "Draft" })).toHaveLength(4);
        expect(cardOf(container, "Overview").hasAttribute("data-placed")).toBe(true);

        await act(async () => { fireEvent.click(pages.getByText("Weekly")); });
        await settle();
        expect([...container.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile"))).toEqual(["w-orders"]);
        expect(cardOf(container, "Weekly").hasAttribute("data-placed")).toBe(true);
        expect(cardOf(container, "Overview").hasAttribute("data-placed")).toBe(false);
        expect(container.querySelector("[data-snap-grid-selection]")!.textContent).toBe("No selectionClick a component on the grid to arrange it");
        // The Weekly places no trend, so the trend's card has no placement to select.
        await act(async () => { fireEvent.click(within(palette(container)).getByRole("tab", { name: "Components" })); });
        await act(async () => { fireEvent.click(cardOf(container, "Revenue trend")); });
        await settle();
        expect(container.querySelector("[data-snap-grid-tile][data-selected]")).toBeNull();
    });

    test("B7: a deprecated component is hidden; the search and the Filter narrow the cards, and the counts follow", async () => {
        const { container } = await mountBuilder();
        const pane = within(palette(container));
        expect(pane.queryByText("Legacy table")).toBeNull();

        await act(async () => { fireEvent.change(pane.getByPlaceholderText("Search 5 components…"), { target: { value: "trend" } }); });
        expect(pane.getByText("Revenue trend")).toBeTruthy();
        expect(pane.queryByText("KPI rail")).toBeNull();
        expect(pane.queryByText("Orders by week")).toBeNull();
        expect(pane.queryByText("Text")).toBeNull();
        expect(groupHeads(container, ["Visuals · you configure", "Built by developers"])).toEqual(["Built by developers 1"]);
        await act(async () => { fireEvent.change(pane.getByPlaceholderText("Search 5 components…"), { target: { value: "" } }); });

        await pickFromMenu(pane.getByRole("button", { name: "Filter" }), "orders");
        expect(pane.getByText("Orders by week")).toBeTruthy();
        expect(pane.queryByText("Revenue trend")).toBeNull();
        expect(pane.queryByText("KPI rail")).toBeNull();
    });
});

describe("<Studio.Builder> — the page it shows (#1668)", () => {
    /** The canvas's tiles, by key. */
    const tiles = (c: HTMLElement) => [...c.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile"));
    /** Press a page of the palette's Pages tab. */
    async function pressPage(c: HTMLElement, title: string) {
        await act(async () => { fireEvent.click(within(palette(c)).getByRole("tab", { name: "Pages" })); });
        await act(async () => { fireEvent.click(within(within(palette(c)).getByRole("tabpanel", { name: "Pages" })).getByText(title)); });
        await settle();
    }

    test("given its page, it shows that page and changes only when its host changes it: its palette's Pages tab tells the host the page asked for, and opens nothing itself", async () => {
        const { container } = await h.mount(heldBuilder, { storageKey: "studio-builder" });
        expect(tiles(container)).toEqual(["p-kpi", "p-trend", "p-bars"]);
        await select(container, "p-trend");
        await pressPage(container, "Weekly");
        // The host is told, once, the page asked for.
        expect(held(ASKED)).toEqual({ project: "ops", page: "b-weekly" });
        // No page opened, so nothing else moved: what was selected is selected still.
        expect(tile(container, "p-trend").hasAttribute("data-selected")).toBe(true);
        // It holds its page still, so the builder shows the Regional yet, and marks it open.
        expect(tiles(container)).toEqual(["p-kpi", "p-trend", "p-bars"]);
        expect(cardOf(container, "Regional").hasAttribute("data-placed")).toBe(true);
        expect(cardOf(container, "Weekly").hasAttribute("data-placed")).toBe(false);
        // Nothing of its own is kept or shared: a reload shows the host's page again.
        expect(sharedEntry()).toBeUndefined();
        reloadPage();
        const again = await h.mount(heldBuilder, { storageKey: "studio-builder" });
        expect(tiles(again.container)).toEqual(["p-kpi", "p-trend", "p-bars"]);
    });

    test("its host's page changing — a page library's click, a route — opens that page, with nothing selected", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await openPage("d-double");
        expect(tiles(container)).toEqual(["d-trend-1", "d-trend-2"]);
        expect(container.querySelector("[data-snap-grid-tile][data-selected]")).toBeNull();
        expect(sharedEntry()).toBeUndefined();
    });

    test("given no page, it holds its own — the project's first to begin with: its palette opens a page in it, it tells a host given to tell, and a reload shows that page again", async () => {
        const { container } = await h.mount(ownBuilder, { storageKey: "studio-builder" });
        expect(tiles(container)).toEqual(["c-kpi", "c-trend"]);
        // Nothing asked for yet: the surface's note is as it began.
        expect(held(ASKED)).toEqual({ project: "", page: "" });
        await pressPage(container, "Weekly");
        expect(tiles(container)).toEqual(["w-orders"]);
        expect(cardOf(container, "Weekly").hasAttribute("data-placed")).toBe(true);
        expect(held(ASKED)).toEqual({ project: "ops", page: "b-weekly" });
        expect(sharedEntry()).toBeUndefined();

        reloadPage();
        const again = await h.mount(ownBuilder, { storageKey: "studio-builder" });
        expect(tiles(again.container)).toEqual(["w-orders"]);
    });

    test("the page it kept is shown only while it stands: one the record no longer holds gives way to the project's first", async () => {
        const { container } = await h.mount(ownBuilder, { storageKey: "studio-builder" });
        await pressPage(container, "Weekly");
        expect(tiles(container)).toEqual(["w-orders"]);

        reloadPage();
        // Another session removes the Weekly while the page is away.
        await h.patch(ex.studioPages, new SortedMap([...PAGES].filter(([key]) => keys(key, { project: "ops", page: "b-weekly" }) !== 0), keys));
        const again = await h.mount(ownBuilder, { storageKey: "studio-builder" });
        expect(tiles(again.container)).toEqual(["c-kpi", "c-trend"]);
    });

    test("two builders on one surface, each given no page, each hold their own: a page one opens is not the other's, then or after a reload", async () => {
        /** Each builder's tiles, in the surface's order. */
        const shown = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-studio-builder]")].map(tiles);
        const { container } = await h.mount(twoBuilders, { storageKey: "studio-builders" });
        expect(shown(container)).toEqual([["c-kpi", "c-trend"], ["c-kpi", "c-trend"]]);
        // The first opens the Weekly: the second, beside it, hears nothing of it.
        await pressPage(container.querySelector<HTMLElement>("[data-studio-builder]")!, "Weekly");
        expect(shown(container)).toEqual([["w-orders"], ["c-kpi", "c-trend"]]);
        reloadPage();
        const again = await h.mount(twoBuilders, { storageKey: "studio-builders" });
        expect(shown(again.container)).toEqual([["w-orders"], ["c-kpi", "c-trend"]]);
    });
});

describe("<Studio.Builder> — the canvas (#995)", () => {
    test("B8: one toolbar — the page's status and the grid chip; the width readout, the zoom, the history item, Desktop · Tablet · Mobile, Save as template, Preview and Publish", async () => {
        const { container } = await mountBuilder();
        expect(toolbarItems(container)).toEqual(["status", "grid", "readout", "zoom", "rule", "history", "widths", "save-template", "preview", "publish"]);
        expect(item(container, "status").textContent).toBe("Draft");
        expect(item(container, "grid").textContent).toBe("12 col · snap on");
        expect(item(container, "readout").textContent).toBe("1440 px");
        expect(item(container, "zoom").textContent).toBe("100%");
        expect(within(item(container, "widths")).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
            .toEqual([["Desktop", "true"], ["Tablet", "false"], ["Mobile", "false"]]);
        expect(["save-template", "preview", "publish"].map((key) => item(container, key).textContent)).toEqual(["Save as template", "Preview", "Publish"]);
        // Headerless: nothing above the toolbar in the canvas's frame — the builder frame (#1125).
        const frame = container.querySelector("[data-snap-grid-editor]")!.firstElementChild!;
        expect(frame.hasAttribute("data-builder-frame")).toBe(true);
        expect(frame.firstElementChild!.getAttribute("data-frame-slot")).toBe("toolbar");
    });

    test("B8: the status is ○ Draft until a page is published, ● Live while its draft is its live layout, Live · edited once they differ, and Template for a template", async () => {
        const { container } = await mountBuilder();
        const status = () => item(container, "status").textContent;
        expect(status()).toBe("Draft");
        await openPage("b-weekly");
        expect(status()).toBe("Live");
        await openPage("c-monthly");
        expect(status()).toBe("Live · edited");
        await openPage("e-starter");
        expect(status()).toBe("Template");
    });

    test("B9: the selection bar names the selected placement — its component's icon and name, and what it reads, never its key; with none, what to do", async () => {
        const { container } = await mountBuilder();
        const bar = () => container.querySelector<HTMLElement>("[data-snap-grid-selection]")!;
        expect(bar().textContent).toBe("No selectionClick a component on the grid to arrange it");
        await select(container, "c-trend");
        expect(bar().querySelector("svg")!.getAttribute("data-icon")).toBe("chart-area");
        expect([...bar().children].slice(1).map((el) => el.textContent)).toEqual(["Revenue trend", RECORD_NAMED]);
    });

    test("B10: the grid panel holds the page's cells on the editing canvas — each its component's own UI — with its guides and its end zone", async () => {
        const { container } = await mountBuilder();
        const main = container.querySelector("[data-snap-grid-main]")!;
        expect(main.querySelector("[data-snap-grid-canvas] [data-snap-grid-ruler]")).not.toBeNull();
        expect(main.querySelector("[data-snap-grid-end]")).not.toBeNull();
        expect([...main.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile"))).toEqual(["c-kpi", "c-trend"]);
        expect(tile(container, "c-kpi").textContent).toBe("KPIs");
        await waitFor(() => expect(tile(container, "c-trend").textContent).toBe("7 pages"));
    });

    test("B11: a component dropped from the palette becomes a cell at its span — Save commits it", async () => {
        const { container } = await mountBuilder();
        await dropCard(container, "Orders by week");
        const rows = rowsDrawn(container);
        expect(rows).toHaveLength(3);
        const dropped = rows[2]![0]!;
        expect(spanOf(container, dropped)).toBe("6");
        await press("Save");
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        const cell = overview.value.draft.cells.at(-1)!;
        expect([cell.key, cell.content, cell.span]).toEqual([dropped, Studio.visual.component("orders_by_week"), 6n]);
    });

    test("B12: Save is one patch commit on the page, and the toolbar says when it saved", async () => {
        const { container } = await mountBuilder();
        await keyOn(container, "c-trend", { key: "]" });
        expect(spanOf(container, "c-trend")).toBe("9");
        await press("Save");
        expect(await commits()).toEqual(["patch", ...before]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        expect(overview.value.draft.cells.map((c) => [c.key, c.span])).toEqual([["c-kpi", 12n], ["c-trend", 9n]]);
        expect(container.querySelector("[data-snap-grid-saved]")!.textContent).toMatch(/^Saved · \d\d:\d\d$/);
        expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    });

    test("B12: a save another session's overtakes, removing the tile this one changed, is a conflict: Save waits until it is settled — and the other save stands", async () => {
        const { container } = await mountBuilder();
        await keyOn(container, "c-trend", { key: "[" });
        // Another operator's save lands between this Save's read and its commit: the Overview's trend removed.
        const stored = (await readRecord()).get(OVERVIEW)!;
        if (stored.type !== "page") throw new Error("expected a page");
        const after: Entry = variant("page", { draft: { ...stored.value.draft, cells: stored.value.draft.cells.slice(0, 1) }, live: stored.value.live });
        await h.race(ex.studioPages, () => click(screen.getByRole("button", { name: "Save" })), withEntry(OVERVIEW, after));
        // The commit is refused, and the canvas, reading the page back, carries its drafts over to it: the tile it moved,
        // the other save removed — a conflict, and Save waits for it.
        expect(container.querySelector("[data-slot=history]")!.textContent).not.toContain("Source changed");
        // Save waits aria-disabled while a conflict does, never disabled: it keeps the focus, and its tooltip says why.
        expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).getAttribute("aria-disabled")).toBe("true");
        expect(await commits()).toEqual(["patch", ...before]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        expect(overview.value.draft.cells.map((c) => c.key)).toEqual(["c-kpi"]);
    });

    test("B12: two Saves at once, of different fields of one tile: the one that lands first reads its own back beside the other's and is done, never left waiting on it", async () => {
        const { container } = await mountBuilder();
        await keyOn(container, "c-trend", { key: "]" });
        // The other session's alignment of the same tile commits just after this Save, before this session has read its own back.
        await h.followed(ex.studioPages, () => click(screen.getByRole("button", { name: "Save" })), (now) => {
            const stored = now.get(OVERVIEW)!;
            if (stored.type !== "page") throw new Error("expected a page");
            const cells = stored.value.draft.cells.map((cell) => (cell.key === "c-trend" ? { ...cell, align: variant("center", null) } : cell));
            return withEntry(OVERVIEW, variant("page", { draft: { ...stored.value.draft, cells }, live: stored.value.live }))(now);
        });
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        const trend = overview.value.draft.cells.find((c) => c.key === "c-trend")!;
        expect([trend.span, trend.align.type]).toEqual([9n, "center"]);
        await waitFor(() => {
            expect(container.querySelector("[data-frame-slot=toolbar]")!.textContent).not.toContain(editingMessages.historyStatus({ status: "reconciling" }));
            expect([spanOf(container, "c-trend"), tile(container, "c-trend").getAttribute("data-align")]).toEqual(["9", "center"]);
        });
        expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
        expect(container.querySelector("[data-session-banner]")).toBeNull();
    });

    test("B13: the palette and the inspector sit either side of the canvas under the toolbar, and the palette collapses to its rail", async () => {
        const { container } = await mountBuilder();
        // Under the toolbar the session's banners, then the panes.
        const banners = container.querySelector("[data-frame-slot=toolbar]")!.nextElementSibling!;
        expect(banners.getAttribute("data-frame-slot")).toBe("banners");
        const body = banners.nextElementSibling!;
        expect([...body.children].map((el) => el.getAttribute("data-frame-slot"))).toEqual(["start", "main", "end"]);
        expect(body.querySelector('[data-frame-slot="main"] > [data-snap-grid-main]')).not.toBeNull();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Components" })); });
        expect(body.querySelector('[data-frame-slot="start"] [data-collapsed]')).not.toBeNull();
        expect(screen.getByRole("button", { name: "Expand Components" })).toBeTruthy();
        expect(body.querySelector("[data-snap-grid-main] [data-snap-grid-tile]")).not.toBeNull();
    });

    test("B14: Preview and Publish open the publish preview in the canvas's place, the canvas kept as it was; Tablet draws the canvas at 1024px, and Mobile at 390px, stacked as a phone shows the page", async () => {
        const { container } = await mountBuilder();
        const canvas = () => container.querySelector<HTMLElement>("[data-studio-canvas]")!;
        expect(container.querySelector("[data-studio-publish]")).toBeNull();
        await press("Preview");
        expect(container.querySelector("[data-studio-publish]")).not.toBeNull();
        expect(canvas().hidden).toBe(true);
        expect(canvas().querySelector("[data-snap-grid-tile]")).not.toBeNull();
        await act(async () => { fireEvent.click(container.querySelector("[data-publish-exit]")!); });
        await settle();
        expect(container.querySelector("[data-studio-publish]")).toBeNull();
        expect(canvas().hidden).toBe(false);
        await press("Publish");
        expect(container.querySelector("[data-studio-publish]")).not.toBeNull();
        await act(async () => { fireEvent.click(container.querySelector("[data-publish-exit]")!); });
        await settle();

        const width = () => container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style.maxWidth;
        expect(width()).toBe("1440px");
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tablet" })); });
        await settle();
        expect(width()).toBe("1024px");
        expect(item(container, "readout").textContent).toBe("1024 px");
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mobile" })); });
        await settle();
        const canvasEl = container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!;
        expect([width(), item(container, "readout").textContent, canvasEl.hasAttribute("data-stacked"), canvasEl.querySelector("[data-snap-grid-ruler]")])
            .toEqual(["390px", "390 px", true, null]);
    });
});

describe("<Studio.Builder> — the inspector (#996)", () => {
    test("B15, B21: a headerless pane — its one row the Configure and Layout tabs and its collapse control; with nothing selected each says what to do", async () => {
        const { container } = await mountBuilder();
        expect(within(inspectorPane(container)).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Configure", "Layout"]);
        expect(openTabName(container)).toBe("Configure");
        expect(screen.getByRole("button", { name: "Collapse Inspector" }).getAttribute("aria-expanded")).toBe("true");
        for (const tab of ["Configure", "Layout"] as const) {
            await openTab(container, tab);
            expect(inspector(container).querySelector('[data-inspector="empty"]')!.textContent)
                .toBe("Nothing selectedClick a component on the grid to see what it reads and its layout.");
        }
    });

    test("B15: collapsed, the rail — the sliders tile and the span badge in the brand while a placement is selected, and its name; else Nothing selected", async () => {
        const { container } = await mountBuilder();
        await press("Collapse Inspector");
        const detail = () => inspectorPane(container).querySelector<HTMLElement>("[data-dock-detail]")!;
        expect(detail().textContent).toBe("Nothing selected");
        expect(detail().parentElement!.hasAttribute("data-active")).toBe(false);
        await select(container, "c-trend");
        const rail = detail().parentElement!;
        expect(rail.hasAttribute("data-active")).toBe(true);
        expect([...rail.children].map((el) => el.textContent)).toEqual(["", "8/12", "Inspector", "Revenue trend"]);
        expect(rail.querySelector("svg[data-icon=sliders]")).not.toBeNull();
    });

    test("B16–B18, B21: the selected placement's name, never its component's key, what its code reads in words, never a keypath, its description fixed by its developer, and the footer", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        const b = inspector(container);
        expect(b.querySelector("[data-inspector-name]")!.textContent).toBe("Revenue trend");
        expect(b.querySelector("[data-inspector-meta]")).toBeNull();
        expect(b.querySelector('[data-inspector="selection"]')!.textContent).not.toContain("revenue_trend");
        // What its code reads, each named in words: never a keypath.
        expect([...b.querySelectorAll('[data-inspector="data"] li')].map((li) => li.textContent)).toEqual([RECORD_NAMED]);
        expect(b.querySelector('[data-inspector="config"]')!.textContent).toBe("Configurationfixed by developerWeekly revenue, as an area.");
        expect(b.querySelector('[data-inspector="footer"]')!.textContent).toBe("Published component · logic immutable");
        await select(container, "c-kpi");
        expect(inspector(container).querySelector('[data-inspector="data"]')!.textContent).toBe("Datareads no data");
        expect(inspector(container).querySelector('[data-inspector="config"] p')!.textContent).toBe("No description");
    });

    test("B20: the span stepper asks the canvas — each step a draft, held to the row's room — and Undo takes one back", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await openTab(container, "Layout");
        const span = () => inspector(container).querySelector("[data-inspector-span]")!.textContent;
        expect(span()).toBe("8 / 12");
        await press("Increase span");
        expect(spanOf(container, "c-trend")).toBe("9");
        expect(span()).toBe("9 / 12");
        // A row of its own leaves it all 12, and no more.
        for (let i = 0; i < 3; i++) await press("Increase span");
        expect(spanOf(container, "c-trend")).toBe("12");
        expect((screen.getByRole("button", { name: "Increase span" }) as HTMLButtonElement).disabled).toBe(true);
        await press("Undo");
        expect(spanOf(container, "c-trend")).toBe("11");
        expect(span()).toBe("11 / 12");
    });

    test("B20: the row field moves the placement — into row 1, beside the KPI rail and fitted to it", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await openTab(container, "Layout");
        const row = inspector(container).querySelector<HTMLInputElement>("[data-inspector-row]")!;
        expect(row.value).toBe("2");
        await act(async () => {
            fireEvent.change(row, { target: { value: "1" } });
            fireEvent.keyDown(row, { key: "Enter" });
        });
        await settle();
        expect(rowsDrawn(container)).toEqual([["c-kpi", "c-trend"]]);
        expect([spanOf(container, "c-kpi"), spanOf(container, "c-trend")]).toEqual(["6", "6"]);
        expect(inspector(container).querySelector<HTMLInputElement>("[data-inspector-row]")!.value).toBe("1");
    });

    test("B20: the height select sets the placement's height, and Auto returns it to its content's", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await openTab(container, "Layout");
        const frame = () => tile(container, "c-trend").firstElementChild as HTMLElement;
        const pick = async (name: string) => {
            await act(async () => { fireEvent.click(inspector(container).querySelector("[data-inspector-height]")!); });
            await act(async () => { fireEvent.click(screen.getByRole("option", { name })); });
            await settle();
        };
        await pick("240 px");
        expect(frame().style.height).toBe("240px");
        await pick("Auto");
        expect(frame().style.height).toBe("");
    });

    test("B20: the height select's chevron and the picked height's check are Font Awesome's, never Chakra's own (#1263)", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await openTab(container, "Layout");
        const trigger = inspector(container).querySelector<HTMLElement>("[data-inspector-height]")!;
        const control = trigger.closest<HTMLElement>('[data-scope="select"][data-part="control"]')!;
        expect(markOf(control.querySelector('[data-part="indicator"]'))).toBe("fas chevron-down");
        await act(async () => { fireEvent.click(trigger); });
        const checks = screen.getAllByRole("option").map((option) => [option.textContent, option.querySelector<HTMLElement>('[data-part="item-indicator"]')!] as const);
        expect([...new Set(checks.map(([, check]) => markOf(check)))]).toEqual(["fas check"]);
        // Shown on the height the placement has: its content's.
        expect(checks.filter(([, check]) => !check.hidden).map(([name]) => name)).toEqual(["Auto"]);
        expect([...foreignIcons(control), ...foreignIcons(screen.getByRole("listbox"))]).toEqual([]);
    });

    test("B20: the alignment segments set where the placement sits in a taller row", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await openTab(container, "Layout");
        expect(screen.getByRole("button", { name: "Top" }).getAttribute("aria-pressed")).toBe("true");
        await press("Center");
        expect(tile(container, "c-trend").getAttribute("data-align")).toBe("center");
        expect(screen.getByRole("button", { name: "Center" }).getAttribute("aria-pressed")).toBe("true");
    });

    test("B12: the inspector's edits are drafts of the page's session — Save commits them in the page's one patch", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await openTab(container, "Layout");
        await press("Increase span");
        await press("Stretch");
        await press("Save");
        expect(await commits()).toEqual(["patch", ...before]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        const trend = overview.value.draft.cells.find((c) => c.key === "c-trend")!;
        expect([trend.span, trend.align.type]).toEqual([9n, "stretch"]);
    });

    test("the palette counts the canvas's unsaved drafts: a placement removed and not yet saved leaves ON CANVAS · ×1", async () => {
        const { container } = await mountBuilder();
        await openPage("d-double");
        await select(container, "d-trend-2");
        expect(within(palette(container)).getByText("ON CANVAS · ×2")).toBeTruthy();
        await keyOn(container, "d-trend-1", { key: "Delete" });
        await select(container, "d-trend-2");
        expect(within(palette(container)).getByText("ON CANVAS · ×1")).toBeTruthy();
        // Nothing saved yet: the record still places it twice.
        const double = (await readRecord()).get({ project: "ops", page: "d-double" })!;
        if (double.type !== "page") throw new Error("expected a page");
        expect(double.value.draft.cells).toHaveLength(2);
    });
});
