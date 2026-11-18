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
 * clears it; and a page a click opens holds the clicked group as its filter
 * when its host is told.
 */

import { describe, expect, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { ArrayType, StringType, StructType, none, printJq, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { decodeBeast2For } from "@elaraai/east/internal";
import { Studio, StudioFiltersType, StudioSourceType, studioFiltersKey } from "@elaraai/e3-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { createInMemoryQueryCall } from "../query/in-memory-call.js";
import { DATASETS, PAGE, SOURCE, cell, page, sized } from "./tile.test-utils.js";

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
/** A click on a row, as a pointer makes it. */
const click = async (row: HTMLElement, init: { metaKey?: boolean } = {}) => { await act(async () => { fireEvent.click(row, init); }); };
/** The page's filters, as the UI store holds them under a page's key. */
const filtersOf = (key: { project: string; page: string }) => {
    const bytes = StateRuntime.getStore().read(studioFiltersKey(key));
    return bytes === undefined ? [] : decodeBeast2For(StudioFiltersType)(bytes).map((filter) => [filter.source, printJq(filter.where).text]);
};

describe("a click that selects, and a visual that follows it (LNK-1 to LNK-5)", () => {
    test("a list's row is a button; a click selects it — `--paper-3` by its mark — and the visual that follows narrows to it, on e3, its eyebrow saying the value", async () => {
        const { container } = page([cell("c-regions", regions()), cell("c-orders", orders(following("all")))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        // With nothing selected a follower that shows all counts every order, and says so.
        await waitFor(() => expect(count(container)).toBe("3"));
        expect(tag(container)).toEqual(["nothing", "nothing selected"]);
        expect([rowOf(container, "SA").getAttribute("role"), rowOf(container, "SA").getAttribute("aria-pressed")]).toEqual(["button", "false"]);
        await click(rowOf(container, "SA"));
        expect(selected(container)).toEqual(["SA"]);
        expect(rowOf(container, "SA").getAttribute("aria-pressed")).toBe("true");
        await waitFor(() => expect(count(container)).toBe("2"));
        expect(tag(container)).toEqual(["selected", "SA"]);
    });

    test("a list on one source leads a visual on another: its click narrows the follower's own rows on its own field (LNK-4)", async () => {
        // A second source: each region and who manages it. The orders count follows its list on the region.
        const Manager = StructType({ region: StringType, manager: StringType });
        const path = [variant("field", "inputs"), variant("field", "managers")];
        const managers: ValueTypeOf<typeof StudioSourceType> = {
            key: "managers", name: "Managers", icon: "user", description: none,
            binding: { name: "managers", source: variant("value", path), type: toEastTypeValue(ArrayType(Manager)) },
            fields: [], range: none,
        };
        const datasets = [...DATASETS, { path, type: ArrayType(Manager), value: [{ region: "SA", manager: "Avery" }, { region: "NSW", manager: "Blake" }] }];
        const leader = v.of("managers", v.list({ item: v.group("region"), values: [v.count()] }));
        const { container } = page([cell("c-regions", leader), cell("c-orders", orders(following("all")))], createInMemoryQueryCall(datasets), [SOURCE, managers]);
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
        const { container } = page([cell("c-regions", regions()), cell("c-orders", orders(following("all")))], createInMemoryQueryCall(DATASETS));
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
        const { container } = page([cell("c-regions", regions()), cell("c-orders", orders(following("all")))], createInMemoryQueryCall(DATASETS));
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
        const { container } = page([cell("c-regions", regionsTable), cell("c-orders", orders(following("all")))], createInMemoryQueryCall(DATASETS));
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

    test("a follower that asks for a pick draws its prompt, naming the field and its leader, until one is picked (LNK-5)", async () => {
        const { container } = page([cell("c-regions", regions()), cell("c-orders", orders(following("prompt")))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        expect(count(container)).toBeUndefined();
        // A list is named by what its rows stand for: Regions.
        expect(container.textContent).toContain("Pick a region in Regions");
        expect(container.textContent).toContain("This visual shows the region you select.");
        await click(rowOf(container, "NSW"));
        await waitFor(() => expect(count(container)).toBe("1"));
        expect(container.textContent).not.toContain("Pick a region");
    });

    test("a follower whose leader is no longer on the page falls back to what it shows with nothing selected, and says its leader is removed (LNK-5)", async () => {
        const all = page([cell("c-orders", orders(following("all")))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(count(all.container)).toBe("3"));
        expect(tag(all.container)).toEqual(["removed", "leader removed"]);
        all.unmount();
        const prompt = page([cell("c-orders", orders(following("prompt")))], createInMemoryQueryCall(DATASETS));
        expect(count(prompt.container)).toBeUndefined();
        expect(prompt.container.textContent).toContain("The visual this one follows was removed");
    });
});

describe("a click that filters, opens, or does nothing (LNK-1, LNK-9)", () => {
    test("filters: the clicked group joins the page's filters as a chip, every visual of the source narrows, and the row is no selection", async () => {
        const { container } = page([cell("c-regions", regions({ click: variant("filter", null) })), cell("c-orders", orders())], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        await click(rowOf(container, "SA"));
        expect(filtersOf(PAGE)).toEqual([["orders", `.region == "SA"`]]);
        await waitFor(() => expect(count(container)).toBe("2"));
        // The list reads the page's filters too: South Australia alone, and its chip on the rail.
        await waitFor(() => expect(rows(container)).toHaveLength(1));
        expect([...container.querySelectorAll("[data-studio-filters] [data-slice-clause]")].map((chip) => chip.getAttribute("title"))).toEqual(["region is SA"]);
        expect(selected(container)).toEqual([]);
    });

    test("opens: the clicked group is the target page's filter on the source — in place of what it held there — and its host is told the page's key, once", async () => {
        const detail = { project: "Sales desk", page: "Region detail" };
        const opened: unknown[] = [];
        const { container } = page([cell("c-regions", regions({ click: variant("open", detail) }))], createInMemoryQueryCall(DATASETS), undefined, (key) => { opened.push(key); });
        await waitFor(() => expect(rows(container)).toHaveLength(2));
        await click(rowOf(container, "NSW"));
        expect(opened).toEqual([detail]);
        expect(filtersOf(detail)).toEqual([["orders", `.region == "NSW"`]]);
        // This page's own filters are as they were.
        expect(filtersOf(PAGE)).toEqual([]);
        await click(rowOf(container, "SA"));
        expect(opened).toEqual([detail, detail]);
        expect(filtersOf(detail)).toEqual([["orders", `.region == "SA"`]]);
    });

    test("a click that opens a page no host is told of, and one that does nothing, make no button of a row", async () => {
        const detail = { project: "Sales desk", page: "Region detail" };
        const { container } = page([
            cell("c-regions", regions({ click: variant("open", detail) })),
            cell("c-quiet", v.of("orders", v.list({ item: v.group("units"), values: [v.count()] }), { click: variant("none", null) })),
        ], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(rows(container).length).toBeGreaterThan(2));
        expect(rows(container).filter((row) => row.getAttribute("role") === "button")).toEqual([]);
    });
});
