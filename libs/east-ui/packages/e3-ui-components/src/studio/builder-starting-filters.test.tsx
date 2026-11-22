/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Builder>` rendered — the page's starting filters (#1673): what
 * every reader of the page starts with, on a rail of their own over the
 * canvas's grid, captioned, which the canvas narrows by; each edit of them a
 * step of the canvas's one history, in order with the placements', and Save
 * each one's own patch; their change first in the publish preview's list; and
 * the preview starting on them — the reader's filters this browser holds of the
 * page forgotten by an edit of them; and a filter whose last condition is
 * removed in its chip's rows removed with it (ruled 22 November 2026). The
 * record and the builders are `builder.test-utils.tsx`'s.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, NullType, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Data, Record, Studio, StudioFiltersType, StudioKeyType, studioFiltersKey } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, settle } from "../e3-web-mount.test-utils.js";
import { condition } from "../query/visual/visual.test-utils.js";
import {
    components, PAGES, h, ASKED, withEntry, readRecord, commits, mountBuilder, tile, spanOf, placed, keyOn, press, type Key, type Entry,
} from "./builder.test-utils.js";

/** A page's reader's filters, as the UI store holds them. */
const encodeFilters = encodeBeast2For(StudioFiltersType);

describe("<Studio.Builder> — the page's starting filters (#1673)", () => {
    const FILTERED: Key = { project: "ops", page: "g-filtered" };
    const v = Studio.visual;
    /** The sales by region as bars, and how many sales there are: six in all, two in the North. */
    const cells = [
        placed("g-bars", "r1", 8n, v.of("sales", v.bar({ x: v.group("region"), values: [v.sum("revenue")] }))),
        placed("g-count", "r1", 4n, v.of("sales", v.kpi({ value: v.count() }))),
    ];
    const NORTH = { key: "f-north", source: "sales", where: condition(`.region == "North"`) };
    /** The Filtered page, live as v1 as it is drafted: its readers start on the North's sales. */
    const FILTERED_PAGE: Entry = variant("page", {
        draft: { title: "Filtered", cells, filters: [NORTH] },
        live: some({ version: 1n, page: { title: "Filtered", cells, filters: [NORTH] } }),
    });

    /** A builder over the sales, its surface holding the Filtered page open. */
    const filteredBuilder = {
        fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            const record = $.let(Record.bind(ex.studioPages, ["patch"]));
            const sales = $.let(Data.bind(ex.studioSales));
            const asked = $.let(State.bind([StudioKeyType], ASKED, { project: "", page: "" }));
            const heard = $.const(East.function([StudioKeyType], NullType, ($2, key) => { $2(asked.write(key)); }));
            return Studio.Builder({
                pages: record, components: listed, project: "ops", page: FILTERED, onOpen: heard,
                sources: { sales: Studio.source(sales, { name: "Sales", icon: "receipt" }) },
            });
        }))),
    };

    /** Mount it over the record with the Filtered page in it, its rail drawn: the record's commits then. */
    async function mountFiltered() {
        await h.patch(ex.studioPages, withEntry(FILTERED, FILTERED_PAGE)(PAGES));
        const mounted = await h.mount(filteredBuilder, { storageKey: "studio-builder" });
        await waitFor(() => expect(chips(mounted.container)).toEqual(["Region: North"]));
        return { ...mounted, at: await commits() };
    }
    /** The starting filters' rail, in the canvas's band over its grid. */
    const rail = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-snap-grid-head] [data-studio-starting-filters]");
    /** Its chips' words. */
    const chips = (c: HTMLElement) => [...(rail(c)?.querySelectorAll<HTMLElement>("[data-slice-clause]") ?? [])].map((chip) => chip.textContent);
    /** A chip's ×, as a pointer presses it. */
    async function removeChip(c: HTMLElement) {
        await act(async () => { fireEvent.click(rail(c)!.querySelector<HTMLElement>("[data-slice-clause] [data-chip-remove]")!); });
        await settle();
    }
    /** How many sales the canvas's count tile draws. */
    const countOn = (c: HTMLElement) => tile(c, "g-count").querySelector("[data-studio-kpi-value]")?.textContent;
    /** The page the publish preview draws. */
    const previewFrame = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-studio-publish] [data-publish-frame]")!;
    /** How many sales the preview's count tile draws. */
    const countPreviewed = (c: HTMLElement) => previewFrame(c).querySelector('[data-snap-grid-cell="g-count"] [data-studio-kpi-value]')?.textContent;

    test("stand on a rail of their own over the canvas's grid — in its band, captioned as what every reader starts with — never in its toolbar; the canvas narrows by them", async () => {
        const { container } = await mountFiltered();
        const caption = rail(container)!.querySelector<HTMLElement>("[data-studio-starting-caption]")!;
        expect([caption.textContent, caption.title]).toEqual(["Starting filters", "Every reader starts with these filters, and can change or clear them."]);
        expect(container.querySelector("[data-frame-slot=toolbar] [data-slice-rail='studio-filters']")).toBeNull();
        // The North's two sales of the six.
        await waitFor(() => expect(countOn(container)).toBe("2"));
    });

    test("each edit of them is a step of the canvas's one history, in the order made with the placements': Undo takes them back in turn, Redo replays them — all drafts", async () => {
        const { container, at } = await mountFiltered();
        await keyOn(container, "g-bars", { key: "[" });
        await removeChip(container);
        expect([spanOf(container, "g-bars"), chips(container)]).toEqual(["7", []]);
        await waitFor(() => expect(countOn(container)).toBe("6"));
        await press("Undo");
        expect([spanOf(container, "g-bars"), chips(container)]).toEqual(["7", ["Region: North"]]);
        await press("Undo");
        expect([spanOf(container, "g-bars"), chips(container)]).toEqual(["8", ["Region: North"]]);
        await press("Redo");
        await press("Redo");
        expect([spanOf(container, "g-bars"), chips(container)]).toEqual(["7", []]);
        expect(await commits()).toEqual(at);
    });

    test("a filter's last condition removed in its chip's rows removes the filter — its chip and its editor go, as its Remove filter does — one step Undo takes back", async () => {
        const { container } = await mountFiltered();
        await act(async () => { fireEvent.click(rail(container)!.querySelector<HTMLElement>("[data-slice-clause]")!); });
        await settle();
        const rows = await waitFor(() => {
            const found = document.querySelector<HTMLElement>("[data-studio-filter-rows]");
            if (found === null) throw new Error("the chip's editor draws no rows");
            return found;
        });
        expect([...rows.querySelectorAll("[data-query-line=row]")].map((row) => row.textContent?.includes("North"))).toEqual([true]);
        await act(async () => { fireEvent.click(within(rows).getByRole("button", { name: "Remove" })); });
        await settle();
        expect([chips(container), document.querySelector("[data-studio-filter-rows]")]).toEqual([[], null]);
        await waitFor(() => expect(countOn(container)).toBe("6"));
        await press("Undo");
        expect(chips(container)).toEqual(["Region: North"]);
    });

    test("Save sends each its own request — one patch on the starting filters, one on the placements — and the record holds both", async () => {
        const { container, at } = await mountFiltered();
        await keyOn(container, "g-bars", { key: "[" });
        await removeChip(container);
        await press("Save");
        await waitFor(async () => expect(await commits()).toEqual(["patch", "patch", ...at]));
        const stored = (await readRecord()).get(FILTERED)!;
        if (stored.type !== "page") throw new Error("expected a page");
        expect([stored.value.draft.filters, stored.value.draft.cells.map((c) => [c.key, c.span])]).toEqual([[], [["g-bars", 7n], ["g-count", 4n]]]);
    });

    test("the preview starts a reader this browser holds no filters for on them, as drafted — the North's, a chip of the reader's to change", async () => {
        const { container } = await mountFiltered();
        await press("Preview");
        await waitFor(() => expect(countPreviewed(container)).toBe("2"));
        expect([...previewFrame(container).querySelectorAll("[data-studio-filters] [data-slice-clause]")].map((chip) => chip.textContent)).toEqual(["Region: North"]);
        // Up to date: the page is live as it is drafted.
        expect([...container.querySelectorAll("[data-studio-publish] [data-publish-change]")]).toEqual([]);
    });

    test("an edit of them forgets the reader's filters this browser holds of the page, so the preview starts on them as drafted; its change list says theirs first, in its words", async () => {
        const { container } = await mountFiltered();
        // A reader's filters of the page, as the preview's rail and the published page set them: the South's.
        await act(async () => {
            StateRuntime.getStore().write(studioFiltersKey(FILTERED), encodeFilters([{ source: "sales", where: condition(`.region == "South"`), from: none }]));
        });
        await removeChip(container);
        expect(StateRuntime.getStore().read(studioFiltersKey(FILTERED))).toBeUndefined();
        await press("Preview");
        // None to start on: every sale.
        await waitFor(() => expect(countPreviewed(container)).toBe("6"));
        expect([...container.querySelectorAll("[data-studio-publish] [data-publish-change]")].map((row) => [row.getAttribute("data-publish-change"), row.textContent]))
            .toEqual([["filters", "Changed Starting filters1 → 0"]]);
    });

    test("a page whose visuals read no source the surface can filter has no rail of them", async () => {
        const { container } = await mountBuilder();
        await waitFor(() => expect(tile(container, "c-kpi")).not.toBeNull());
        expect(container.querySelector("[data-studio-starting-filters]")).toBeNull();
    });
});
