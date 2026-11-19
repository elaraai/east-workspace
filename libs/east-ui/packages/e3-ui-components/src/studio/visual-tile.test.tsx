/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A visual's tile (#1670), on e3 itself over the tile tests' own three orders
 * (`tile.test-utils.tsx`): it asks its programs through the query builder's
 * calls and draws each of its states — waiting, a well empty, a field
 * missing, a source with no date to compare periods by, its source's error
 * with a Retry, a source the page cannot query, no rows — and its answer; two
 * tiles with one program make one call, and so do two pages over the same
 * sources, one inside the other; an answer outlives its calls' identity.
 */

import { useState, type ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Studio, type StudioSourceType } from "@elaraai/e3-ui/internal";
import * as tiles from "@elaraai/e3-ui/examples/studio/tiles";
import { markOf } from "@elaraai/east-ui-components/testing";
import { act, settle } from "../e3-web-mount.test-utils.js";
import { E3Provider } from "../platform/index.js";
import { VisualAnswersProvider } from "../query/visual/answers.js";
import { condition } from "../query/visual/visual.test-utils.js";
import { StudioLayout } from "./page.js";
import { PAGE, SOURCE, cell, filterPage, filterSources, onE3, page, pageWithoutServer, sized, tileHarness } from "./tile.test-utils.js";

const h = tileHarness();

const v = Studio.visual;

/** The one-shot calls the page has launched of e3: each a call started, or run within one request. */
const launched = () => h.requests("one-shot").filter((request) => request.method === "POST").length;

/** Shows what it is given once the test says so: a page that mounts, its reads loaded, and draws later. */
let show: (() => void) | undefined;
function Later({ children }: { children: ReactNode }) {
    const [shown, setShown] = useState(false);
    show = () => setShown(true);
    return shown ? children : null;
}

/** Refreshes the host's token: its `E3Provider` drawn with a new config. */
let refresh: ((token: string) => void) | undefined;
function Tokened({ children }: { children: ReactNode }) {
    const [token, setToken] = useState("first");
    refresh = setToken;
    return <E3Provider config={{ apiUrl: h.e3.apiUrl, fetch: h.e3.fetch, repo: h.e3.repo, workspace: h.workspace, token }}>{children}</E3Provider>;
}

/** The charts a page has drawn its answers as, by kind, in order (#1671). */
const charts = (container: HTMLElement) => [...container.querySelectorAll("[data-studio-chart]")].map((el) => el.getAttribute("data-studio-chart"));

/** A page's first tile's eyebrow: its name, and its meta. */
const eyebrow = (container: HTMLElement) =>
    [container.querySelector("[data-studio-visual-name]")?.textContent, container.querySelector("[data-studio-visual-meta]")?.textContent];

describe("a visual's tile", () => {
    test("asks its program and draws what it answered, under its eyebrow: a name made from its wells, and a meta that says what it groups by (TIL-1)", async () => {
        const { container } = await page([cell("c1", v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] })))]);
        await waitFor(() => expect(charts(container)).toEqual(["column"]));
        expect(eyebrow(container)).toEqual(["Revenue by region", "by region"]);
    });

    test("names a tile by its placement's own title before its wells, and by its view while its wells are empty (TIL-1)", async () => {
        const { container } = await page([
            { ...cell("c1", v.of("orders", v.kpi({ value: v.count() }))), title: some("Orders this quarter") },
            cell("c2", v.of("orders", v.column({ x: v.group("region"), values: [] }))),
        ]);
        const names = [...container.querySelectorAll("[data-studio-visual-name]")].map((el) => el.textContent);
        expect(names).toEqual(["Orders this quarter", "Column chart"]);
    });

    test("waits on the shared loading clock: once the wait passes the delay its meta says loading over blocks in its own shape", async () => {
        const { container } = await onE3(<Later><StudioLayout cells={[
            cell("c1", v.of("orders", v.kpi({ value: v.count() }))),
            cell("c2", v.of("orders", v.column({ x: v.group("region"), values: [v.count()] }))),
            cell("c3", v.of("orders", v.list({ item: v.group("region"), values: [v.count()] }))),
        ]} components={[]} sources={[SOURCE]} page={PAGE} storageKey="tile" /></Later>);
        // Its calls held at e3, never answered: the page shown, its wait begins.
        h.e3.hold((request) => request.kind === "one-shot");
        await act(async () => { show!(); });
        expect(container.querySelector("[data-studio-visual=waiting]")).toBeNull();
        // Until then its eyebrow says nothing of it.
        expect(eyebrow(container)).toEqual(["Orders", ""]);
        await waitFor(() => expect(container.querySelectorAll("[data-studio-visual=waiting]")).toHaveLength(3), { timeout: 2_000 });
        expect([...container.querySelectorAll("[data-studio-visual-meta]")].map((meta) => meta.textContent)).toEqual(["loading", "loading", "loading"]);
        // A KPI's number over its line; a chart's legend line over its plot; a list's rows.
        const blocks = [...container.querySelectorAll("[data-studio-visual=waiting]")].map((state) => [...state.querySelectorAll("[data-block]")].map((block) => block.getAttribute("data-block")));
        expect(blocks).toEqual([["number", "line"], ["line", "plot"], ["row", "row", "row", "row"]]);
    });

    test("lists the wells it needs filled as a checklist — its source chosen, each well it needs missing — under its source's name (TIL-3)", async () => {
        const { container } = await page([cell("c1", v.of("orders", v.column({ x: v.group("region"), values: [] })))]);
        const state = container.querySelector<HTMLElement>("[data-studio-visual=empty]")!;
        expect(within(state).getByRole("heading", { name: "Add fields to draw it" })).toBeTruthy();
        // A check for what is chosen, a dot for what is missing; the view's icon over them.
        expect([...state.querySelectorAll("li")].map((item) => [item.textContent, item.hasAttribute("data-done"), markOf(item)?.split(" ").slice(0, 2).join(" ")])).toEqual([
            ["Pick a source", true, "fas circle-check"], ["A number in Values", false, "fas circle"],
        ]);
        expect(markOf(state.querySelector("h4")!.previousElementSibling)).toBe("fas chart-column");
        expect(eyebrow(container)).toEqual(["Column chart", "Orders"]);
    });

    test("names a field its source does not have, as code, and its meta says it needs a field; a published page offers no link to pick another (TIL-3)", async () => {
        const { container } = await page([cell("c1", v.of("orders", v.kpi({ value: v.sum("net_revenue") })))]);
        const state = container.querySelector<HTMLElement>("[data-studio-visual=missing]")!;
        expect([state.textContent, state.querySelector("code")?.textContent, markOf(state)?.split(" ").slice(0, 2).join(" ")]).toEqual(["Orders has no field net_revenue", "net_revenue", "fas circle-exclamation"]);
        expect(state.querySelector("button")).toBeNull();
        expect(eyebrow(container)[1]).toBe("needs a field");
    });

    test("says no data where its value would be when it reads no rows, never a zero, and under it what emptied it — its own filter, then the page's, each once — or that its source has none (TIL-3, #1673)", async () => {
        const said = (container: HTMLElement) => {
            const state = container.querySelector<HTMLElement>("[data-studio-visual=no-rows]");
            return state === null ? undefined : [...state.firstElementChild!.children].map((part) => [part.textContent, part.getAttribute("title")]);
        };
        const own = await page([cell("c1", v.of("orders", v.kpi({ value: v.sum("revenue") }), { where: condition(`.region == "WA"`) }))]);
        await waitFor(() => expect(said(own.container)).toEqual([["no data", null], ["No orders for region is WA", "No orders for region is WA"]]));
        own.unmount();
        const filtered = await page([cell("c1", v.of("orders", v.kpi({ value: v.count() }), { where: condition(".units > 1") }))]);
        await filterPage(`.region == "NSW"`, `.region == "NSW"`);
        await waitFor(() => expect(said(filtered.container)?.[1]?.[0]).toBe("No orders for units is more than 1 · region is NSW"));
        filtered.unmount();
        await filterPage();
        // A source with no rows: nothing emptied it.
        await h.write(tiles.tileTestOrders, []);
        const none_ = await page([cell("c1", v.of("orders", v.kpi({ value: v.count() })))]);
        await waitFor(() => expect(said(none_.container)?.[1]?.[0]).toBe("Orders has no rows"));
    });

    test("shows its source's error when there is no server to ask", async () => {
        pageWithoutServer([cell("c1", v.of("orders", v.kpi({ value: v.count() })))]);
        expect(await screen.findByText("Orders could not be read")).toBeTruthy();
    });

    test("two tiles with one program make one call", async () => {
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        const { container } = await page([cell("c1", content), cell("c2", content)]);
        await waitFor(() => expect(charts(container)).toEqual(["bar", "bar"]));
        await settle();
        expect(launched()).toBe(1);
    });

    test("offers Retry when its call failed, and asks again", async () => {
        // e3 unreachable, then back: the network fails each try, and e3's client tries again after a pause, a timer the
        // harness's settle cannot see, so the test waits for what the user sees then.
        const down = h.e3.fail((request) => request.kind === "one-shot", "network");
        const { container } = await page([cell("c1", v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] })))]);
        expect(await screen.findByText("Orders could not be read", {}, { timeout: 10_000 })).toBeTruthy();
        down();
        const asked = launched();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
        await waitFor(() => expect(charts(container)).toEqual(["bar"]));
        expect(launched()).toBeGreaterThan(asked);
    });

    test("says a source with no date range has no date to compare periods by", async () => {
        await page([cell("c1", v.of("orders", v.kpi({ value: v.sum("revenue", { period: "previous" }) })))], [{ ...SOURCE, range: none }]);
        expect(screen.getByText("Orders has no date to compare periods by")).toBeTruthy();
    });

    test("a source the page cannot query fails only the visuals that read it, with no Retry", async () => {
        const lines: ValueTypeOf<typeof StudioSourceType> = {
            ...SOURCE, key: "lines", name: "Lines",
            binding: { name: "lines", source: variant("paged", "not-bound"), type: SOURCE.binding.type },
        };
        const { container } = await page([
            cell("c1", v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }))),
            cell("c2", v.of("lines", v.bar({ x: v.group("region"), values: [v.count()] }))),
        ], [SOURCE, lines]);
        await waitFor(() => expect(charts(container)).toEqual(["bar"]));
        expect(await screen.findByText("Lines could not be read")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    test("a page inside another over the same sources asks through it: what one has answered, the other draws", async () => {
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        // A builder's canvas, and its preview beside it.
        const { container } = await onE3(
            <VisualAnswersProvider sources={[SOURCE]}>
                <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} page={PAGE} storageKey="canvas" />
                <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} page={PAGE} storageKey="preview" />
            </VisualAnswersProvider>,
        );
        await waitFor(() => expect(charts(container)).toEqual(["bar", "bar"]));
        await settle();
        expect(launched()).toBe(1);
    });

    test("keeps its answer when the host's calls change identity — a token refreshed — and asks nothing again; what it asks next goes with the new token", async () => {
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        const layout = <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} page={PAGE} storageKey="tile" />;
        // The host's own E3Provider, nearest the page, whose token it refreshes.
        const { container } = await onE3(layout, (example) => <Tokened>{example}</Tokened>);
        await waitFor(() => expect(charts(container)).toEqual(["bar"]));
        await settle();
        expect(launched()).toBe(1);
        await act(async () => { refresh!("second"); });
        // Still drawn as it was: no answer dropped, so no wait, and nothing asked again.
        expect(charts(container)).toEqual(["bar"]);
        await settle();
        expect(launched()).toBe(1);
        // A program of its own — a filter set — is asked through the refreshed calls.
        await filterPage(`.region == "SA"`);
        await settle();
        expect(h.requests("one-shot").filter((request) => request.method === "POST").map((request) => request.authorization)).toEqual(["Bearer first", "Bearer second"]);
    });
});

describe("a KPI's tile (#1671)", () => {
    test("draws its value and unit under its name, its change a pill in its valence with a caret at their row's end, its goal, its trend and one line of annotation", async () => {
        // Revenue: 210 against an average order of 70; a goal of 300; a month a bucket, July's and August's.
        const kpi = v.kpi({ value: v.sum("revenue", { goal: 300 }), compare: v.mean("revenue"), trend: "ordered_at" });
        const { container } = await page([cell("c1", v.of("orders", kpi))]);
        expect(await screen.findByText("210")).toBeTruthy();
        // The eyebrow names it; the KPI draws no label of its own.
        // A KPI's unit stands beside its number: its meta says nothing more.
        expect([eyebrow(container), screen.getAllByText("Revenue")]).toEqual([["Revenue", ""], [container.querySelector("[data-studio-visual-name]")]]);
        // Its number, and its change at the end of its row; this source's revenue declares no unit to say beside it.
        const row = container.querySelector("[data-studio-kpi-value]")!.parentElement!.parentElement!;
        expect([...row.children].map((part) => part.textContent)).toEqual(["210", "+200%"]);
        const change = container.querySelector("[data-studio-kpi-change]")!;
        expect([change.getAttribute("data-studio-kpi-change"), change.textContent]).toEqual(["positive", "+200%"]);
        expect(change.querySelector("svg[data-icon=caret-up]")).not.toBeNull();
        expect(container.querySelector("[data-studio-kpi-goal] [data-studio-kpi-goal-tick]")).not.toBeNull();
        expect(container.querySelectorAll("[data-studio-kpi-trend] svg path")).toHaveLength(1);
        // One line says what the change is against, then the goal and the gap.
        expect([...container.querySelectorAll("[data-studio-kpi-note]")].map((note) => note.textContent)).toEqual(["vs average revenue 70 · by month · 70% of goal 300 · 90 to go"]);
        // In the mock's order: the row, the goal's bar, the trend, the annotation.
        expect([...container.querySelector("[data-studio-kpi]")!.children].map((part) => [...part.attributes].find((a) => a.name.startsWith("data-studio-kpi-"))?.name ?? "row"))
            .toEqual(["row", "data-studio-kpi-goal", "data-studio-kpi-trend", "data-studio-kpi-note"]);
    });

    test("says a count's unit beside its number: its source, mid-sentence", async () => {
        const { container } = await page([cell("c1", v.of("orders", v.kpi({ value: v.count() })))]);
        await waitFor(() => expect(container.querySelector("[data-studio-kpi-unit]")).not.toBeNull());
        const value = container.querySelector("[data-studio-kpi-value]")!;
        expect([...value.parentElement!.children].map((part) => [part === value, part.textContent === "orders"])).toEqual([[true, false], [false, true]]);
    });

    test("is narrowed by the reader's filters of its page, held in the UI store under the page's key: set, changed and cleared, every visual of the source follows (#1673)", async () => {
        const { container } = await page([
            cell("c1", v.of("orders", v.kpi({ value: v.count() }))),
            cell("c2", v.of("orders", v.kpi({ value: v.sum("revenue") }), { where: condition(".units > 1") })),
        ]);
        const values = () => [...container.querySelectorAll("[data-studio-kpi-value]")].map((el) => el.textContent);
        // Three orders; two of more than one unit, 160 between them.
        await waitFor(() => expect(values()).toEqual(["3", "160"]));
        // South Australia's alone: two orders, both of more than one unit.
        await filterPage(`.region == "SA"`);
        await waitFor(() => expect(values()).toEqual(["2", "160"]));
        // Each filter a row must pass, after the visual's own: August's South Australian order.
        await filterPage(`.region == "SA"`, `.ordered_at >= "2026-08-01"`);
        await waitFor(() => expect(values()).toEqual(["1", "60"]));
        await filterPage();
        await waitFor(() => expect(values()).toEqual(["3", "160"]));
    });

    test("compares a value with another period once the page's filters hold its date to a window, and says it needs one until they do (#1673)", async () => {
        const { container } = await page([cell("c1", v.of("orders", v.kpi({ value: v.count(), compare: v.count({ period: "previous" }) })))]);
        expect(await screen.findByText("Comparing periods needs a date filter on Orders")).toBeTruthy();
        // August, against July: one order against two.
        await filterPage(`(.ordered_at | strftime("%Y-%m")) == "2026-08"`);
        await waitFor(() => expect(container.querySelector("[data-studio-kpi-value]")?.textContent).toBe("1"));
        await waitFor(() => expect(container.querySelector("[data-studio-kpi-change]")?.textContent).toBe("-1"));
        // A filter of another field alone leaves the date no window.
        await filterPage(`.region == "SA"`);
        expect(await screen.findByText("Comparing periods needs a date filter on Orders")).toBeTruthy();
    });

    test("a page's filters are its own: another page's tiles, over the same sources, are not narrowed by them (#1673)", async () => {
        const content = v.of("orders", v.kpi({ value: v.count() }));
        const other = { project: "Sales desk", page: "Stock" };
        const { container } = await onE3(
            <VisualAnswersProvider sources={[SOURCE]}>
                <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} page={PAGE} storageKey="one" />
                <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} page={other} storageKey="two" />
            </VisualAnswersProvider>,
        );
        const values = () => [...container.querySelectorAll("[data-studio-kpi-value]")].map((el) => el.textContent);
        await waitFor(() => expect(values()).toEqual(["3", "3"]));
        await filterPage(`.region == "NSW"`);
        await waitFor(() => expect(values()).toEqual(["1", "3"]));
    });

    test("the page's rail says each filter as a chip over the grid, short — its field, then what it holds — and whole on its hover, in the query builder's words; its × takes the filter out, and every visual follows (#1673)", async () => {
        const { container } = await page([cell("c1", v.of("orders", v.kpi({ value: v.count() })))]);
        const rail = () => container.querySelector<HTMLElement>("[data-studio-filters]")!;
        const chips = () => [...rail().querySelectorAll<HTMLElement>("[data-slice-clause]")].map((chip) => [chip.textContent, chip.getAttribute("title")]);
        const datasets = () => [...rail().querySelectorAll("[data-slice-chip-group]")].map((name) => name.textContent);
        await waitFor(() => expect(container.querySelector("[data-studio-kpi-value]")?.textContent).toBe("3"));
        // With no filter the rail is its + FILTER chip alone, before the grid: no dataset named.
        expect([chips(), datasets(), rail().querySelector("[data-slice-add=filter]") !== null]).toEqual([[], [], true]);
        expect(rail().compareDocumentPosition(container.querySelector("[data-studio-kpi-value]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await filterPage(`.region == "SA"`, ".units > 1");
        await waitFor(() => expect(chips()).toEqual([["Region: SA", "region is SA"], ["Units: more than 1", "units is more than 1"]]));
        // The page's one dataset, named once before its chips (ruled 19 November 2026).
        expect(datasets()).toEqual(["Orders"]);
        await waitFor(() => expect(container.querySelector("[data-studio-kpi-value]")?.textContent).toBe("2"));
        // A chip's ×, as a pointer presses it.
        const remove = rail().querySelector<HTMLElement>("[data-slice-clause] [data-chip-remove]");
        expect(remove).not.toBeNull();
        await act(async () => { fireEvent.click(remove!); });
        await waitFor(() => expect(chips()).toEqual([["Units: more than 1", "units is more than 1"]]));
        // A filter of two conditions, one of them twice: its first short, how many more, each said once on its hover.
        await filterPage(`.region == "SA" and .units > 1 and .region == "SA"`);
        await waitFor(() => expect(chips()).toEqual([["Region: SA +1", "region is SA and units is more than 1"]]));
    });

    test("over two datasets the rail draws each dataset's chips together after its name, said once, the datasets in the order the surface lists them — whatever order the filters came in (ruled 19 November 2026)", async () => {
        // The returns: a second dataset, over the same rows.
        const returns: ValueTypeOf<typeof StudioSourceType> = { ...SOURCE, key: "returns", name: "Returns", binding: { ...SOURCE.binding, name: "returns" } };
        const { container } = await page([
            cell("c1", v.of("orders", v.kpi({ value: v.count() }))),
            cell("c2", v.of("returns", v.kpi({ value: v.count() }))),
        ], [SOURCE, returns]);
        const drawn = () => [...container.querySelectorAll("[data-studio-filters] [data-slice-chip-group], [data-studio-filters] [data-slice-clause]")]
            .map((el) => el.textContent);
        await waitFor(() => expect(container.querySelector("[data-studio-filters] [data-slice-add=filter]")).not.toBeNull());
        // A filter on the returns first, then two on the orders: the orders, listed first, draw first; each chip its condition alone.
        await filterSources({ source: "returns", where: `.region == "SA"` }, { source: "orders", where: ".units > 1" }, { source: "orders", where: `.region == "NSW"` });
        await waitFor(() => expect(drawn()).toEqual(["Orders", "Units: more than 1", "Region: NSW", "Returns", "Region: SA"]));
        // Each chip still the page's filter by its place: the returns' is the first.
        expect([...container.querySelectorAll("[data-studio-filters] [data-slice-clause]")].map((chip) => chip.getAttribute("data-slice-clause"))).toEqual(["1", "2", "0"]);
    });

    test("a page whose placements read no source has no rail (#1673)", async () => {
        const { container } = await page([cell("c1", v.text("Notes"))]);
        expect(container.querySelector("[data-studio-filters]")).toBeNull();
    });

    test("draws only its value when its compare, trend and goal are empty, and says an absent value in words", async () => {
        const { container } = await page([cell("c1", v.of("orders", v.kpi({ value: v.max("units") }), { where: condition(`.region == "SA"`) }))]);
        expect(await screen.findByText("4")).toBeTruthy();
        expect(container.querySelector("[data-studio-kpi-change], [data-studio-kpi-trend], [data-studio-kpi-goal], [data-studio-kpi-note], [data-studio-kpi-unit]")).toBeNull();
    });
});

/** Opens a chip's menu, as a pointer does. */
async function openMenu(chip: HTMLElement) {
    await act(async () => { fireEvent.click(chip); });
    await waitFor(() => expect(chip.getAttribute("aria-expanded")).toBe("true"));
}

/** Picks an item of a chip's open menu as a pointer does: pressed on it, then its click. */
async function pick(chip: HTMLElement, words: string) {
    const menu = document.getElementById(chip.getAttribute("aria-controls")!)!;
    const item = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")].find((el) => el.textContent === words);
    if (item === undefined) throw new Error(`no item “${words}”`);
    await act(async () => { fireEvent.pointerDown(item); });
    await act(async () => { fireEvent.click(item); });
}

/** Saves what the page downloads, in order: each file's name and its text. */
function capturing(): { saved: { name: string; blob: Blob }[]; restore: () => void } {
    const saved: { name: string; blob: Blob }[] = [];
    let last: Blob | undefined;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { last = blob; return "blob:rows"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        saved.push({ name: this.download, blob: last! });
    });
    return {
        saved,
        restore: () => {
            click.mockRestore();
            Reflect.deleteProperty(URL, "createObjectURL");
            Reflect.deleteProperty(URL, "revokeObjectURL");
        },
    };
}

describe("a records table's tile, and a tile's menu (#1671)", () => {
    test("draws a page of its rows in the Table, its columns in their well order under their labels, and where the page stands (TBL-1)", async () => {
        const records = v.records({ columns: ["region", "revenue"], sort: "revenue", descending: true });
        const { container } = await page([cell("c1", v.of("orders", records))]);
        await waitFor(() => expect(container.querySelector("[data-studio-records='']")).not.toBeNull());
        const records_ = container.querySelector<HTMLElement>("[data-studio-records]")!;
        expect([...records_.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Region", "Revenue"]);
        expect(records_.querySelector("[data-studio-visual-note]")!.textContent).toBe("Showing 1–3 of 3");
        // A table's rows run edge to edge in its tile.
        expect(container.querySelector("[data-studio-visual-tile] > [data-flush]")).not.toBeNull();
    });

    test("Show rows lists the rows under a visual as a value tree in a popover hanging from its menu — never a drawer — newest first, how many at its foot; its Export CSV writes every one, named after the visual (TIL-2)", () => sized(async () => {
        const downloads = capturing();
        try {
            const { container } = await page([cell("c1", v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] })))]);
            await waitFor(() => expect(charts(container)).toEqual(["column"]));
            const chip = container.querySelector<HTMLElement>("[data-studio-visual-menu]")!;
            await openMenu(chip);
            await pick(chip, "Show rows");
            const popover = await screen.findByRole("dialog");
            // A popover of the menu's, its head saying whose rows they are: no drawer, no scrim.
            expect([popover.getAttribute("data-scope"), document.querySelector("[data-scope=drawer]")]).toEqual(["popover", null]);
            expect(within(popover).getByText("Rows · Revenue by region")).toBeTruthy();
            // The rows as a tree of East values, a row a line; how many there are at its foot.
            await waitFor(() => expect(within(popover).getByText("3 rows")).toBeTruthy());
            const tree = within(popover).getByRole("tree");
            await waitFor(() => expect(within(tree).getAllByRole("treeitem").length).toBeGreaterThanOrEqual(3));
            // Newest first: a row a line that previews its values, over its fields — every field of the rows, as its source
            // lists none — each a value of its own East type.
            const said = within(tree).getAllByRole("treeitem").map((row) => row.textContent ?? "");
            expect(said.filter((line) => line.includes(" · "))).toEqual([
                "SA2026-08-02 10:00:00 · SA · 60", "NSW2026-07-20 10:00:00 · NSW · 50", "SA2026-07-03 10:00:00 · SA · 100",
            ]);
            expect(said.slice(1, 5)).toEqual(["Ordered at2026-08-02 10:00:00", "RegionSA", "Revenue60", "Units2"]);
            await act(async () => { fireEvent.click(within(popover).getByRole("button", { name: "Export CSV" })); });
            await waitFor(() => expect(downloads.saved).toHaveLength(1));
            const [head, ...lines] = (await downloads.saved[0]!.blob.text()).split("\r\n").filter((line) => line !== "");
            expect([downloads.saved[0]!.name, head, lines.map((line) => line.split(",")[1])])
                .toEqual(["revenue-by-region.csv", "ordered_at,region,revenue,units", ["SA", "NSW", "SA"]]);
        } finally {
            downloads.restore();
        }
    }));

    test("a summary draws each region's head over its months, with its count; the total row after its function; a cell short of its goal marked (TBL-2, TBL-3)", () => sized(async () => {
        const summary = v.summary({ rows: [v.group("region"), v.group("ordered_at", { bucket: "month" })], values: [v.sum("revenue", { goal: 80 })], total: true });
        const { container } = await page([cell("c1", v.of("orders", summary))]);
        await waitFor(() => expect(container.querySelector("[data-studio-summary] tbody tr")).not.toBeNull());
        const table = container.querySelector<HTMLElement>("[data-studio-summary]")!;
        // Each head its label alone; the value's goal a small label of its own after it.
        expect([...table.querySelectorAll("thead th")].map((th) => [...th.querySelectorAll("button > span")].map((part) => part.textContent))).toEqual([["Region · month"], ["Revenue", "goal 80"]]);
        expect(table.querySelectorAll("thead [data-control]")).toHaveLength(0);
        // New South Wales over July; South Australia over July and August — each head's first cell, its count after it.
        expect([...table.querySelectorAll("tbody tr[data-row-head]")].map((tr) => tr.querySelector("td")!.textContent)).toEqual(["NSW1", "SA2"]);
        expect([...table.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-depth"))).toEqual(["0", "1", "0", "1", "1"]);
        expect([...table.querySelectorAll("tfoot tr[data-table-total] td")].map((td) => td.textContent)).toEqual(["Total", "sum210"]);
        // Under 80: New South Wales' 50, its July's, and South Australia's August, 60.
        expect(within(table).getAllByRole("img", { name: "below goal" })).toHaveLength(3);
    }));

    test("a pivot puts each region's month in the Matrix, shaded on the heat steps — paper on the top two — a pair with no rows in words, the legend under it (TBL-4)", () => sized(async () => {
        const pivot = v.pivot({ rows: v.group("region"), columns: v.group("ordered_at", { bucket: "month" }), value: v.sum("revenue"), heat: true });
        const { container } = await page([cell("c1", v.of("orders", pivot))]);
        await waitFor(() => expect(container.querySelector("[data-studio-pivot] [data-slot=seg]")).not.toBeNull());
        const grid = container.querySelector<HTMLElement>("[data-studio-pivot]")!;
        const rows = [...grid.querySelectorAll("[data-row-key]")].map((row) => [
            row.querySelector("[data-slot=rowHeaderName]")!.textContent,
            ...[...row.querySelectorAll("[data-slot=seg]")].map((seg) => [seg.textContent, seg.getAttribute("data-fill")]),
        ]);
        // July: NSW 50, SA 100; August: SA 60 — the 95th percentile 100, so steps of 20.
        expect(rows).toEqual([["NSW", ["50", "neutral"], ["no data", "free"]], ["SA", ["100", "brand"], ["60", "brand"]]]);
        const legend = grid.querySelector<HTMLElement>("[data-studio-heat]")!;
        expect([...legend.querySelectorAll("[data-step]")].map((swatch) => swatch.getAttribute("aria-label"))).toEqual(["0–20", "20–40", "40–60", "60–80", "≥80"]);
        expect([...legend.querySelectorAll("[aria-hidden] span")].map((tick) => tick.textContent)).toEqual(["0", "20", "40", "60", "≥80"]);
    }));

    test("a list draws a two-line row an item, its values at the end, and its ranking bar against the largest (LST-1, LST-2)", async () => {
        const list = v.list({ item: v.group("region", { sort: "high" }), values: [v.sum("revenue")], bar: true });
        const { container } = await page([cell("c1", v.of("orders", list))]);
        await waitFor(() => expect(container.querySelector("[data-studio-list-row]")).not.toBeNull());
        const rows = [...container.querySelectorAll<HTMLElement>("[data-studio-list-row]")].map((row) => [
            row.querySelector("[data-studio-list-name]")!.textContent,
            row.querySelector("[data-studio-list-value]")!.textContent,
            // The bar's fill: its width its share.
            (row.querySelector("[data-studio-list-bar]")!.firstElementChild as HTMLElement).style.width,
        ]);
        // South Australia 100 + 60, New South Wales 50: its share of 160.
        expect(rows).toEqual([["SA", "160", "100%"], ["NSW", "50", "31.25%"]]);
        expect(container.querySelector("[data-studio-visual-tile] > [data-flush]")).not.toBeNull();
    });

    test("a visual holding fewer groups than its source has says how many of how many under it (CHT-9)", async () => {
        // A list keeps its first N, with no Other: South Australia, of two regions.
        const list = v.list({ item: v.group("region", { sort: "high", top: 1n }), values: [v.sum("revenue")] });
        const { container } = await page([cell("c1", v.of("orders", list))]);
        await waitFor(() => expect(container.querySelector("[data-studio-list-row]")).not.toBeNull());
        expect([container.querySelectorAll("[data-studio-list-row]").length, container.querySelector("[data-studio-visual-note]")?.textContent])
            .toEqual([1, "Showing 1 of 2 groups"]);
    });

    test("an export that could not be made says why over the tile's body, until it is put away", async () => {
        const { container } = await page([cell("c1", v.of("orders", v.kpi({ value: v.count() })))]);
        expect(await screen.findByText("3")).toBeTruthy();
        // The tile's call answered; the export's finds e3 unreachable.
        h.e3.fail((request) => request.kind === "one-shot", "network");
        const chip = container.querySelector<HTMLElement>("[data-studio-visual-menu]")!;
        await openMenu(chip);
        await pick(chip, "Export CSV");
        expect(await screen.findByText("The rows could not be exported", {}, { timeout: 10_000 })).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); });
        expect(screen.queryByText("The rows could not be exported")).toBeNull();
    });
});
