/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A page's clicks (#1673, LNK-1 to LNK-5, LNK-9), drawn: a click on a
 * visual's row selects, filters or opens, as the visual says; a visual that
 * follows another narrows to what its leader has selected, on e3, and says
 * so in its eyebrow; with nothing selected it shows everything, or asks for a
 * pick; ⌘-click selects several; Esc, or a click on the selection again,
 * clears it; a click that filters narrows every other visual of the source and
 * marks the group on the visual clicked; and a page a click opens holds the
 * clicked group as its filter when its host is told. On e3 itself, over the
 * tile tests' own orders (`tile.test-utils.tsx`).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { none, printJq, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { decodeBeast2For } from "@elaraai/east/internal";
import { Studio, StudioFiltersType, StudioSourceType, studioFiltersKey } from "@elaraai/e3-ui/internal";
import * as tiles from "@elaraai/e3-ui/examples/studio/tiles";
import { StateRuntime } from "@elaraai/east-ui-components";
import { markOf } from "@elaraai/east-ui-components/testing";
import { act } from "../e3-web-mount.test-utils.js";
import { PAGE, SOURCE, cell, page, sized, tileHarness } from "./tile.test-utils.js";

tileHarness();

const v = Studio.visual;

/** A list of the regions by revenue: SA 160 over two orders, NSW 50 over one. */
const regions = (options: Parameters<typeof v.of>[2] = {}) => v.of("orders", v.list({ item: v.group("region", { sort: "high" }), values: [v.sum("revenue")] }), options);
/** How many orders there are: 3 in all, 2 in SA, 1 in NSW. */
const orders = (options: Parameters<typeof v.of>[2] = {}) => v.of("orders", v.kpi({ value: v.count() }), options);
/** A follower of the regions list, on the region. */
const following = (empty: "all" | "prompt") => ({ follow: { leader: "c-regions", from: "region", to: "region", empty: variant(empty, null) } });

/** A list's rows, by their names. */
const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-studio-list-row]")];
const rowOf = (container: HTMLElement, name: string) => rows(container).find((row) => row.querySelector("[data-studio-list-name]")?.textContent === name)!;
/** The rows selected, by their names. */
const selected = (container: HTMLElement) => rows(container).filter((row) => row.hasAttribute("data-selected")).map((row) => row.querySelector("[data-studio-list-name]")?.textContent);
/** The page's KPI's number. */
const count = (container: HTMLElement) => container.querySelector("[data-studio-kpi-value]")?.textContent;
/** A follower's tag: what it reads of its leader, and what it says. */
const tag = (container: HTMLElement) => {
    const el = container.querySelector<HTMLElement>("[data-studio-visual-follow]");
    return el === null ? undefined : [el.getAttribute("data-following"), el.textContent];
};
/** A follower's prompt (LNK-5), as it is drawn: its icon, its title and what it says under it. */
const prompted = (container: HTMLElement, state: "prompt" | "leader-removed") => {
    const prompt = container.querySelector<HTMLElement>(`[data-studio-visual=${state}]`)!;
    const title = prompt.querySelector("h4")!;
    return [markOf(title.previousElementSibling)?.split(" ").slice(0, 2).join(" "), title.textContent, prompt.querySelector("[data-studio-visual-hint]")!.textContent];
};
/** What a placement's eyebrow says in its meta; `null` where it draws none — a follower's, whose tag stands in its place. */
const meta = (container: HTMLElement, placement: string) => container.querySelector(`[data-studio-placement="${placement}"] [data-studio-visual-meta]`)?.textContent ?? null;
/** A click on a row, as a pointer makes it. */
const click = async (row: HTMLElement, init: { metaKey?: boolean } = {}) => { await act(async () => { fireEvent.click(row, init); }); };
/** The page's filters, as the UI store holds them under a page's key: each one's source, its jq, and the placement whose click made it. */
const filtersOf = (key: { project: string; page: string }) => {
    const bytes = StateRuntime.getStore().read(studioFiltersKey(key));
    return bytes === undefined ? [] : decodeBeast2For(StudioFiltersType)(bytes)
        .map((filter) => [filter.source, printJq(filter.where).text, filter.from.type === "some" ? filter.from.value : undefined]);
};

describe("a click that selects, and a visual that follows it (LNK-1 to LNK-5)", () => {
    test("a list's row is a button; a click selects it — `--paper-3` by its mark — and the visual that follows narrows to it, on e3, its eyebrow saying the value and nothing more", async () => {
        const { container } = await page([cell("c-regions", regions()), cell("c-orders", orders(following("all")))]);
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        // With nothing selected a follower that shows all counts every order, and says so: its tag in place of its meta.
        await waitFor(() => expect(count(container)).toBe("3"));
        expect([tag(container), meta(container, "c-orders")]).toEqual([["nothing", "nothing selected"], null]);
        expect([rowOf(container, "SA").getAttribute("role"), rowOf(container, "SA").getAttribute("aria-pressed")]).toEqual(["button", "false"]);
        await click(rowOf(container, "SA"));
        expect(selected(container)).toEqual(["SA"]);
        expect(rowOf(container, "SA").getAttribute("aria-pressed")).toBe("true");
        await waitFor(() => expect(count(container)).toBe("2"));
        expect([tag(container), meta(container, "c-orders")]).toEqual([["selected", "SA"], null]);
        // The leader's eyebrow keeps its meta.
        expect(meta(container, "c-regions")).not.toBeNull();
    });

    test("a list on one source leads a visual on another: its click narrows the follower's own rows on its own field (LNK-4)", async () => {
        // A second source: each region and who manages it. The orders count follows its list on the region.
        const managers: ValueTypeOf<typeof StudioSourceType> = {
            key: "managers", name: "Managers", icon: "user", description: none,
            binding: { name: "managers", source: variant("value", tiles.tileTestManagers.path), type: toEastTypeValue(tiles.tileTestManagers.type) },
            fields: [], range: none,
        };
        const leader = v.of("managers", v.list({ item: v.group("region"), values: [v.count()] }));
        const { container } = await page([cell("c-regions", leader), cell("c-orders", orders(following("all")))], [SOURCE, managers]);
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        await waitFor(() => expect(count(container)).toBe("3"));
        await click(rowOf(container, "NSW"));
        await waitFor(() => expect(count(container)).toBe("1"));
        expect(tag(container)).toEqual(["selected", "NSW"]);
        await click(rowOf(container, "SA"), { metaKey: true });
        await waitFor(() => expect(count(container)).toBe("3"));
        // In the order they were picked.
        expect(tag(container)).toEqual(["selected", "NSW, SA"]);
    });

    test("⌘-click adds to the selection, and the follower narrows to them all; a click on one of several selects it alone; a click on the selection again clears it (LNK-2)", async () => {
        const { container } = await page([cell("c-regions", regions()), cell("c-orders", orders(following("all")))]);
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        await click(rowOf(container, "NSW"));
        await waitFor(() => expect(count(container)).toBe("1"));
        await click(rowOf(container, "SA"), { metaKey: true });
        expect(selected(container)).toEqual(["SA", "NSW"]);
        await waitFor(() => expect(count(container)).toBe("3"));
        expect(tag(container)).toEqual(["selected", "NSW, SA"]);
        await click(rowOf(container, "SA"));
        expect(selected(container)).toEqual(["SA"]);
        await click(rowOf(container, "SA"));
        expect(selected(container)).toEqual([]);
        await waitFor(() => expect(tag(container)).toEqual(["nothing", "nothing selected"]));
    });

    test("Esc clears the selection — the one of the tile it is pressed in — and never an Esc a field takes for itself (LNK-2)", async () => {
        const { container } = await page([cell("c-regions", regions()), cell("c-orders", orders(following("all")))]);
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        await click(rowOf(container, "SA"));
        expect(selected(container)).toEqual(["SA"]);
        // An Escape typed in a field is the field's.
        const field = document.createElement("input");
        document.body.append(field);
        await act(async () => { fireEvent.keyDown(field, { key: "Escape" }); });
        field.remove();
        expect(selected(container)).toEqual(["SA"]);
        await act(async () => { fireEvent.keyDown(rowOf(container, "SA"), { key: "Escape" }); });
        expect(selected(container)).toEqual([]);
        // Pressed with nothing focused, it clears every selection of the page.
        await click(rowOf(container, "NSW"));
        await act(async () => { fireEvent.keyDown(document.body, { key: "Escape" }); });
        expect(selected(container)).toEqual([]);
    });

    test("a summary table's row takes the click and is marked — the selected row's ground, no checkbox — and what follows it narrows (TBL-6)", () => sized(async () => {
        const regionsTable = v.of("orders", v.summary({ rows: [v.group("region", { sort: "high" })], values: [v.sum("revenue")] }));
        const { container } = await page([cell("c-regions", regionsTable), cell("c-orders", orders(following("all")))]);
        const tableRows = () => [...container.querySelectorAll<HTMLElement>("[data-studio-summary] tbody tr")];
        await waitFor(() => expect(tableRows()).toHaveLength(2));
        await waitFor(() => expect(count(container)).toBe("3"));
        const marked = () => tableRows().filter((row) => row.getAttribute("data-selected") === "true").map((row) => row.querySelector("td")!.textContent);
        expect(marked()).toEqual([]);
        // SA is the first row: the most revenue.
        await click(tableRows()[0]!);
        await waitFor(() => expect(marked()).toEqual(["SA"]));
        await waitFor(() => expect(count(container)).toBe("2"));
        expect(tag(container)).toEqual(["selected", "SA"]);
        expect(container.querySelectorAll("[data-studio-summary] input")).toHaveLength(0);
        // A click on it again clears it.
        await click(tableRows()[0]!);
        await waitFor(() => expect(marked()).toEqual([]));
    }));

    test("a follower that asks for a pick draws its prompt — a pointer's hand, what to pick in which visual, what it then shows — its eyebrow saying nothing selected and no more, until one is picked (LNK-5)", async () => {
        const { container } = await page([cell("c-regions", regions()), cell("c-orders", orders(following("prompt")))]);
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        expect(count(container)).toBeUndefined();
        // A list is named by what its rows stand for, Regions; the follower by what it draws.
        expect(prompted(container, "prompt")).toEqual(["fas hand-pointer", "Pick a region in Regions", "This KPI shows the region you select."]);
        expect([tag(container), meta(container, "c-orders")]).toEqual([["nothing", "nothing selected"], null]);
        await click(rowOf(container, "NSW"));
        await waitFor(() => expect(count(container)).toBe("1"));
        expect(container.querySelector("[data-studio-visual=prompt]")).toBeNull();
    });

    test("a follower whose leader is no longer on the page falls back to what it shows with nothing selected, and says its leader is removed (LNK-5)", async () => {
        const all = await page([cell("c-orders", orders(following("all")))]);
        await waitFor(() => expect(count(all.container)).toBe("3"));
        expect(tag(all.container)).toEqual(["removed", "leader removed"]);
        all.unmount();
        const prompt = await page([cell("c-orders", orders(following("prompt")))]);
        expect(count(prompt.container)).toBeUndefined();
        expect(prompted(prompt.container, "leader-removed")).toEqual(["fas link-slash", "The visual this one follows was removed", "Link it to another visual, or stop following."]);
        expect([tag(prompt.container), meta(prompt.container, "c-orders")]).toEqual([["removed", "leader removed"], null]);
    });
});

describe("a click that filters, opens, or does nothing (LNK-1, LNK-9)", () => {
    test("filters: the clicked group is the filter the list's click made, a chip on the rail; every other visual of the source narrows to it, and the list marks it, never narrowing itself; ⌘-click adds one, a click on it again clears it, and so does its chip's × (#1673)", async () => {
        const { container } = await page([cell("c-regions", regions({ click: variant("filter", null) })), cell("c-orders", orders())]);
        const chips = () => [...container.querySelectorAll("[data-studio-filters] [data-slice-clause]")].map((chip) => chip.getAttribute("title"));
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        await click(rowOf(container, "SA"));
        expect(filtersOf(PAGE)).toEqual([["orders", `.region == "SA"`, "c-regions"]]);
        await waitFor(() => expect(count(container)).toBe("2"));
        // The list keeps every region, the one clicked marked; its chip on the rail.
        expect([rows(container).length, selected(container), chips()]).toEqual([2, ["SA"], ["region is SA"]]);
        // ⌘-click adds a region: any of them a row may pass.
        await click(rowOf(container, "NSW"), { metaKey: true });
        expect(filtersOf(PAGE)).toEqual([["orders", `.region == "SA" or .region == "NSW"`, "c-regions"]]);
        await waitFor(() => expect(count(container)).toBe("3"));
        expect(selected(container)).toEqual(["SA", "NSW"]);
        // A plain click takes one alone; a click on it again clears it.
        await click(rowOf(container, "NSW"));
        await waitFor(() => expect(count(container)).toBe("1"));
        expect(selected(container)).toEqual(["NSW"]);
        await click(rowOf(container, "NSW"));
        expect(filtersOf(PAGE)).toEqual([]);
        await waitFor(() => expect(count(container)).toBe("3"));
        expect([selected(container), chips()]).toEqual([[], []]);
        // The chip's × clears the mark with the filter.
        await click(rowOf(container, "SA"));
        expect(selected(container)).toEqual(["SA"]);
        await act(async () => { fireEvent.click(container.querySelector("[data-studio-filters] [data-slice-clause] [data-chip-remove]")!); });
        expect([filtersOf(PAGE), selected(container)]).toEqual([[], []]);
        await waitFor(() => expect(count(container)).toBe("3"));
    });

    test("opens: the clicked group is the target page's filter on the source — in place of what it held there — and its host is told the page's key, once", async () => {
        const detail = { project: "Sales desk", page: "Region detail" };
        const opened: unknown[] = [];
        const { container } = await page([cell("c-regions", regions({ click: variant("open", detail) }))], undefined, (key) => { opened.push(key); });
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        await click(rowOf(container, "NSW"));
        expect(opened).toEqual([detail]);
        expect(filtersOf(detail)).toEqual([["orders", `.region == "NSW"`, undefined]]);
        // This page's own filters are as they were.
        expect(filtersOf(PAGE)).toEqual([]);
        await click(rowOf(container, "SA"));
        expect(opened).toEqual([detail, detail]);
        expect(filtersOf(detail)).toEqual([["orders", `.region == "SA"`, undefined]]);
    });

    test("a click that opens a page no host is told of, and one that does nothing, make no button of a row", async () => {
        const detail = { project: "Sales desk", page: "Region detail" };
        const { container } = await page([
            cell("c-regions", regions({ click: variant("open", detail) })),
            cell("c-quiet", v.of("orders", v.list({ item: v.group("units"), values: [v.count()] }), { click: variant("none", null) })),
        ]);
        await waitFor(() => expect(rows(container).length).toBeGreaterThan(2));
        expect(rows(container).filter((row) => row.getAttribute("role") === "button")).toEqual([]);
    });
});
