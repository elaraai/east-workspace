/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Builder>` rendered — linking two visuals on the canvas (#1673,
 * LNK-6, LNK-7): a visual's menu's Link puts the canvas in pick mode — a
 * banner, the visuals that can lead marked, the rest not; a click on a leader
 * whose click selects, over one source, links at once, the follower's tile
 * saying so, and Save writes it; a leader whose click was not select is
 * confirmed in a popover that says it will be switched; a placement that can
 * lead nothing says why; Esc and Cancel leave the mode. The record and the
 * builders are `builder.test-utils.tsx`'s.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { East, NullType, none, some, variant } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Studio, StudioKeyType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, settle } from "../e3-web-mount.test-utils.js";
import { components, PAGES, h, ASKED, withEntry, readRecord, tile, placed, press, pickFromMenu, type Key, type Entry } from "./builder.test-utils.js";

describe("<Studio.Builder> — linking on the canvas (#1673)", () => {
    const LINKS: Key = { project: "ops", page: "h-links" };
    const v = Studio.visual;
    /** The Links page, never published: the regions as a list, whose click selects; the sales as bars, whose click filters; their count; and a note. */
    const LINKS_PAGE: Entry = variant("page", {
        draft: {
            title: "Links",
            cells: [
                placed("l-regions", "r1", 4n, v.of("sales", v.list({ item: v.group("region"), values: [v.sum("revenue")] }))),
                placed("l-channels", "r1", 4n, v.of("sales", v.bar({ x: v.group("channel"), values: [v.sum("revenue")] }))),
                placed("l-count", "r1", 4n, v.of("sales", v.kpi({ value: v.count() }))),
                placed("l-note", "r2", 12n, v.text("Figures are to last night.")),
            ],
        },
        live: none,
    });

    /** A builder over the sales, its surface holding the Links page open. */
    const linksBuilder = {
        fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            const record = $.let(Record.bind(ex.studioPages, ["patch"]));
            const sales = $.let(Data.bind(ex.studioSales));
            const asked = $.let(State.bind([StudioKeyType], ASKED, { project: "", page: "" }));
            const heard = $.const(East.function([StudioKeyType], NullType, ($2, key) => { $2(asked.write(key)); }));
            return Studio.Builder({
                pages: record, components: listed, project: "ops", page: LINKS, onOpen: heard,
                sources: { sales: Studio.source(sales, { name: "Sales", icon: "receipt" }) },
            });
        }))),
    };

    async function mountLinks() {
        await h.patch(ex.studioPages, withEntry(LINKS, LINKS_PAGE)(PAGES));
        return h.mount(linksBuilder, { storageKey: "studio-builder" });
    }
    /** The Links page's visuals as the record holds them, by their placements' keys. */
    async function saved() {
        const stored = (await readRecord()).get(LINKS)!;
        if (stored.type !== "page") throw new Error("expected a page");
        return new Map(stored.value.draft.cells.flatMap((cell) => (cell.content.type === "visual" ? [[cell.key, cell.content.value] as const] : [])));
    }
    const visualMenu = (c: HTMLElement, key: string) => within(tile(c, key)).getByRole("button", { name: "Visual menu" });
    /** A content's visual. */
    const visualOf = (content: ReturnType<typeof v.of>) => {
        if (content.type !== "visual") throw new Error("not a visual");
        return content.value;
    };
    const canvas = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-studio-canvas]")!;
    /** The banner's words while a leader is picked; `undefined` outside the mode. */
    const banner = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-studio-linking]")?.textContent ?? undefined;
    /** What each tile is while a leader is picked. */
    const picks = (c: HTMLElement) => ["l-regions", "l-channels", "l-count", "l-note"].map((key) => tile(c, key).querySelector("[data-pick]")?.getAttribute("data-pick") ?? null);
    /** A click on a tile, as a pointer makes it. */
    const clickTile = async (c: HTMLElement, key: string) => {
        await act(async () => { fireEvent.click(tile(c, key)); });
        await settle();
    };
    /** A follower's tag on its tile. */
    const follows = (c: HTMLElement, key: string) => tile(c, key).querySelector("[data-studio-visual-follow]")?.textContent;

    test("LNK-6: Link puts the canvas in pick mode — a banner saying what to do, the visuals that can lead marked; a click on a leader whose click selects links at once, and Save writes it", async () => {
        const { container } = await mountLinks();
        await waitFor(() => expect(tile(container, "l-count")).not.toBeNull());
        expect([canvas(container).hasAttribute("data-linking"), banner(container)]).toEqual([false, undefined]);
        await pickFromMenu(visualMenu(container, "l-count"), "Link on the canvas");
        await settle();
        expect(canvas(container).hasAttribute("data-linking")).toBe(true);
        expect(banner(container)).toContain("Click the visual Sales should follow");
        expect(banner(container)).toContain("The outlined visuals can lead. Esc cancels.");
        // The list and the bars can lead; the visual being linked stands as it is; a text block is neither.
        expect(picks(container)).toEqual(["leader", "leader", "follower", null]);
        await clickTile(container, "l-regions");
        // Linked: the mode left, the follower saying what it follows, the click never the canvas's selection of the leader.
        expect([canvas(container).hasAttribute("data-linking"), banner(container)]).toEqual([false, undefined]);
        // On the canvas a follower names its leader, and its leader says how many follow it.
        await waitFor(() => expect(follows(container, "l-count")).toBe("follows Regions"));
        expect(tile(container, "l-regions").querySelector("[data-studio-visual-leads]")?.textContent).toBe("leads 1");
        expect(tile(container, "l-channels").querySelector("[data-studio-visual-leads]")).toBeNull();
        await press("Save");
        expect((await saved()).get("l-count")!.follow).toEqual(some({ leader: "l-regions", from: "region", to: "region", empty: variant("all", null) }));
        // The leader's click selected already: nothing of it changes.
        expect((await saved()).get("l-regions")!.click).toEqual(variant("select", null));
    });

    test("LNK-7: a leader whose click was not select is confirmed in a popover that says it will be switched; Link writes both", async () => {
        const { container } = await mountLinks();
        await waitFor(() => expect(tile(container, "l-count")).not.toBeNull());
        await pickFromMenu(visualMenu(container, "l-count"), "Link on the canvas");
        await settle();
        await clickTile(container, "l-channels");
        // Still in the mode: the popover proposes the match, and says what linking changes.
        expect(canvas(container).hasAttribute("data-linking")).toBe(true);
        const confirm = document.querySelector<HTMLElement>("[data-studio-link-confirm]")!;
        expect(confirm).not.toBeNull();
        expect(document.querySelector("[data-studio-link-match]")!.textContent).toBe("Revenue by channel's channel matches this visual's");
        expect(document.querySelector("[data-studio-link-note=click]")!.textContent).toBe("Revenue by channel will select on click instead of filtering the page.");
        // One source: the match is sure, and says nothing of names.
        expect(document.querySelector("[data-studio-link-note=match]")).toBeNull();
        await act(async () => { fireEvent.click(confirm); });
        await settle();
        expect(canvas(container).hasAttribute("data-linking")).toBe(false);
        await waitFor(() => expect(follows(container, "l-count")).toBe("follows Revenue by channel"));
        await press("Save");
        const now = await saved();
        expect(now.get("l-count")!.follow).toEqual(some({ leader: "l-channels", from: "channel", to: "channel", empty: variant("all", null) }));
        expect(now.get("l-channels")!.click).toEqual(variant("select", null));
    });

    test("LNK-8: a leader's menu's Add a linked visual places a new chart in a new row after it, on its source, already following it, selected; a leader whose click was not select is switched; a KPI offers none", async () => {
        const { container } = await mountLinks();
        await waitFor(() => expect(tile(container, "l-regions")).not.toBeNull());
        const rows = () => [...container.querySelectorAll("[data-snap-grid-rows] [data-snap-grid-row]")].map((row) => [...row.querySelectorAll(":scope > [data-snap-grid-tile]")].map((el) => el.getAttribute("data-snap-grid-tile")));
        expect(rows()).toEqual([["l-regions", "l-channels", "l-count"], ["l-note"]]);
        await pickFromMenu(visualMenu(container, "l-regions"), "Add a linked visual");
        await settle();
        // A new row after the leader's, before the note's; the new chart selected, saying what it follows.
        await waitFor(() => expect(rows()).toEqual([["l-regions", "l-channels", "l-count"], ["linked-1"], ["l-note"]]));
        expect(tile(container, "linked-1").hasAttribute("data-selected")).toBe(true);
        expect(follows(container, "linked-1")).toBe("follows Regions");
        // The bars' click filters: adding a chart that follows them switches it to select.
        await pickFromMenu(visualMenu(container, "l-channels"), "Add a linked visual");
        await settle();
        await waitFor(() => expect(rows()).toEqual([["l-regions", "l-channels", "l-count"], ["linked-2"], ["linked-1"], ["l-note"]]));
        // A KPI's clicks tell no field: nothing can follow it, and its menu offers none.
        await act(async () => { visualMenu(container, "l-count").focus(); fireEvent.keyDown(visualMenu(container, "l-count"), { key: "ArrowDown" }); });
        expect(within(screen.getByRole("menu")).queryByText("Add a linked visual")).toBeNull();
        await act(async () => { fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" }); });
        await press("Save");
        const now = await saved();
        expect(now.get("linked-1")).toEqual(visualOf(v.of("sales", v.column({ x: v.group(""), values: [] }), { follow: { leader: "l-regions", from: "region", to: "region", empty: variant("all", null) } })));
        expect(now.get("linked-2")!.follow).toEqual(some({ leader: "l-channels", from: "channel", to: "channel", empty: variant("all", null) }));
        expect([now.get("l-regions")!.click, now.get("l-channels")!.click]).toEqual([variant("select", null), variant("select", null)]);
    });

    test("a click on a placement that can lead nothing says why and stays in the mode; Esc, and Cancel, leave it with nothing linked", async () => {
        const { container } = await mountLinks();
        await waitFor(() => expect(tile(container, "l-regions")).not.toBeNull());
        await pickFromMenu(visualMenu(container, "l-regions"), "Link on the canvas");
        await settle();
        // A KPI's clicks tell no field: nothing can follow it.
        await clickTile(container, "l-count");
        expect(banner(container)).toContain("Sales has nothing to select, so nothing can follow it.");
        expect(canvas(container).hasAttribute("data-linking")).toBe(true);
        // Esc, pressed on the canvas: the mode is left, and the visual being linked is still the canvas's selection.
        await act(async () => { fireEvent.keyDown(tile(container, "l-regions"), { key: "Escape" }); });
        expect([canvas(container).hasAttribute("data-linking"), follows(container, "l-regions")]).toEqual([false, undefined]);
        expect(tile(container, "l-regions").hasAttribute("data-selected")).toBe(true);
        await pickFromMenu(visualMenu(container, "l-regions"), "Link on the canvas");
        await settle();
        expect(canvas(container).hasAttribute("data-linking")).toBe(true);
        await act(async () => { fireEvent.click(document.querySelector("[data-studio-link-cancel]")!); });
        expect(canvas(container).hasAttribute("data-linking")).toBe(false);
    });
});
