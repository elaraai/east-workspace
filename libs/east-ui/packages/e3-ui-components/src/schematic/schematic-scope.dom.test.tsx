/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Schematic on an owner's own page (#1621), on e3 itself: the data centre's
 * racks read by area, their source scoped to the racks one owner is let — a
 * narrowing the page holds and the viewer cannot clear.
 *
 * - **The canvas** draws the owner's racks alone, read through the area index
 *   the owner leads, hidden or dimmed alike: dimmed draws what the viewer's
 *   choices leave out as context, and the scope is no choice, so no other
 *   owner's rack is drawn faded, nor read.
 * - **Its Backlog** pages the owner's racks with no position and counts them
 *   alone — `1`, never `1 of 2`, every owner's.
 * - **Emptied**, the Backlog says so plainly: never that the filters match
 *   nothing, and no Clear filters, which could not clear the scope.
 * - **A run to a rack beyond the scope**, dimmed, is no run of this page: its
 *   far end, read by key as a run reaching the view draws it, is held to the
 *   scope and drawn nowhere — not as context — and the frame it reaches is
 *   joined to none of them.
 * - **Find** lists the racks the scope holds alone, by their keys: on a page of
 *   two owners, each owner's in turn, in the order their index files them.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin, and each card a test presses answers at
 * its centre.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import { card, fitted, layOutCanvas, near, tap } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The camera the canvas fits the 28 × 14 m floor with. */
const CAM = fitted(28, 14);

/** The racks' record, as its dataset's requests name it. */
const RACKS_DATASET = `records.${ex.schematicRacks.name}`;

/** The racks the floor places. */
const PLACED = ["A01", "A02", "A03", "A04", "A05"];

/** An owner's page: its key, the owners it is for, and how the viewer's narrowing draws. */
interface OwnerPage {
    readonly key: string;
    readonly owners: readonly string[];
    readonly show: "hide" | "dim";
}

/**
 * As many owners as a scope may hold (the record Slice's bound on its runs): Elmway College, and tenants no rack is let
 * to. A window's searches across them all pass the bound on the searches one read lands, so their page's window is read
 * through the area index over every owner's racks.
 */
const MANY_OWNERS = ["Elmway College", ...Array.from({ length: 63 }, (_, i) => `Tenant ${i + 1}`)];

/**
 * The data centre's racks on an owner's own page: read by area — their source lists the area index, the one the owner
 * leads and the index by owner the scope asks for — scoped to the owner, editable through their patch door, with the
 * Backlog in the library. The rail offers no field: the scope holds the only one a listed index leads first.
 */
const ownerFloor = ({ key, owners, show }: OwnerPage) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const slice = $.let(Slice.bindRecords(`schematic.scope.${key}`, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: ["schematic_racks_by_owner", "schematic_racks_by_area", "schematic_racks_by_owner_area"] }),
            scope: { owner: [...owners] },
            fields: {},
        },
    }));
    return Schematic({
        id: `scope-${key}`,
        extent: { width: 28, height: 14 },
        slice: { slice },
        narrowed: { show },
        items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries }) },
        library: [Schematic.library.backlog()],
    });
}))) });

/** Mounts an owner's page and waits until the given rack is drawn. */
async function open(page: OwnerPage, drawn: string) {
    const ui = await h.mount(ownerFloor(page));
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", drawn)).not.toBeNull());
    await settle();
    return ui;
}

/** Which of the placed racks the canvas draws, by key. */
const drawnRacks = (container: HTMLElement) => PLACED.filter((key) => card(container, "racks", key) !== null);

/** The indexes the racks were read through, each read's. */
const indexesRead = () => h.requests(undefined, RACKS_DATASET).flatMap((request) => {
    const index = request.query.get("index");
    return index === null ? [] : [index];
});

/** The library pane. */
const pane = (container: HTMLElement) => slot(container, "start");

/** The Backlog's tab, as its row draws it: its name and its count. */
const tab = (container: HTMLElement) => pane(container).querySelector('[role="tab"]')?.textContent;

/** The open panel. */
const panel = (container: HTMLElement) => pane(container).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** The Backlog's cards, in order: each its key, whether it draws as context, and whether it drags. */
const cards = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")].map((el) => ({
    key: el.getAttribute("data-library-item"),
    context: el.hasAttribute("data-filtered"),
    drags: el.hasAttribute("data-draggable"),
}));

/** The open panel's empty state: its title and its action, or `null` while it shows none. */
const emptyState = (container: HTMLElement) => {
    const empty = panel(container).querySelector<HTMLElement>("[data-library-empty]");
    return empty === null ? null : [within(empty).getByRole("heading").textContent, empty.querySelector("button")?.textContent ?? null];
};

/** A rack's id, as the canvas and the Backlog's cards name it. */
const rack = (key: string) => entityId({ kind: "racks", key });

test("an owner's page draws that owner's racks alone, read through the area index the owner leads — hidden or dimmed alike, no other owner's rack drawn as context, nor read: the scope is no choice of the viewer's (#1621)", async () => {
    for (const show of ["hide", "dim"] as const) {
        const before = indexesRead().length;
        const { container, unmount } = await open({ key: `elmway-${show}`, owners: ["Elmway College"], show }, "A05");
        expect(drawnRacks(container), show).toEqual(["A05"]);
        expect(card(container, "racks", "A05")!.hasAttribute("data-context"), show).toBe(false);
        // Every read of the racks by area went through the index the owner leads: never the one over every owner's racks.
        const read = indexesRead().slice(before);
        expect(read, show).toContain("schematic_racks_by_owner_area");
        expect(read.filter((index) => index === "schematic_racks_by_area"), show).toEqual([]);
        expect(h.requests("read", RACKS_DATASET), show).toEqual([]);
        unmount();
    }
});

test("a page for more owners than a window's read asks of the index they lead draws their racks alone all the same — hidden or dimmed: its window is read over every owner's racks, the scope is asked of them, and none beyond it is drawn, as itself or as context (#1621)", async () => {
    for (const show of ["hide", "dim"] as const) {
        const before = indexesRead().length;
        const { container, unmount } = await open({ key: `many-${show}`, owners: MANY_OWNERS, show }, "A05");
        await settle();
        expect(drawnRacks(container), show).toEqual(["A05"]);
        expect(card(container, "racks", "A05")!.hasAttribute("data-context"), show).toBe(false);
        // The window went through the index over every owner's racks: through the one the owners lead it takes too many searches.
        expect(indexesRead().slice(before), show).toContain("schematic_racks_by_area");
        expect(h.requests("read", RACKS_DATASET), show).toEqual([]);
        unmount();
    }
});

test("its Backlog pages the owner's racks with no position and counts them alone: `Backlog 1`, never `1 of 2`, every owner's (#1621)", async () => {
    const { container } = await open({ key: "elmway-backlog", owners: ["Elmway College"], show: "hide" }, "A05");
    await waitFor(() => expect(cards(container).map((c) => c.key)).toEqual([rack("A06")]));
    expect(tab(container)).toBe("Backlog 1");
    expect(cards(container).map((c) => [c.context, c.drags])).toEqual([[false, true]]);
});

test("emptied, its Backlog says so plainly — never that the filters match nothing, and no Clear filters, which could not clear the scope (#1621)", async () => {
    const { container } = await open({ key: "northwind", owners: ["Northwind Media"], show: "hide" }, "A03");
    expect(drawnRacks(container)).toEqual(["A03", "A04"]);
    await waitFor(() => expect(tab(container)).toBe("Backlog 0"));
    const backlog = pane(container).querySelector<HTMLElement>('[role="tab"]')!;
    await act(async () => { fireEvent.click(backlog); });
    await settle();
    await waitFor(() => expect(emptyState(container)).not.toBeNull());
    expect(emptyState(container)).toEqual(["Nothing in the backlog", null]);
    expect(panel(container).querySelector("[data-library-empty][data-narrowed]")).toBeNull();
});

/** Find's box, in the toolbar's row. */
const findBox = (container: HTMLElement) => slot(container, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
/** The keys Find's lines name, in order. */
const foundKeys = () => [...document.querySelectorAll('[role="option"]')].map((option) => (option.textContent ?? "").split(" · ")[0]);
/** A query put in Find's box at once, as a paste is. */
async function find(container: HTMLElement, typed: string) {
    const input = findBox(container).querySelector<HTMLInputElement>("input")!;
    await act(async () => { input.focus(); fireEvent.input(input, { target: { value: typed } }); });
    await settle();
}

test("Find lists the racks the page's scope holds alone, by their keys — the one with no position among them — and on a page of two owners, each owner's in turn, in the order their index files them (#1621)", async () => {
    const one = await open({ key: "elmway-find", owners: ["Elmway College"], show: "hide" }, "A05");
    await find(one.container, "A");
    await waitFor(() => expect(foundKeys()).toEqual(["A05", "A06"]), { timeout: 10_000 });
    // A06 is the record's sixth rack and the page's second: found at its place among the page's.
    await find(one.container, "A06");
    await waitFor(() => expect(foundKeys()).toEqual(["A06"]), { timeout: 10_000 });
    one.unmount();
    // Listed Northwind first, the owners are filed by name: Elmway's racks, then Northwind's.
    const two = await open({ key: "two-owners-find", owners: ["Northwind Media", "Elmway College"], show: "hide" }, "A05");
    await find(two.container, "A0");
    await waitFor(() => expect(foundKeys()).toEqual(["A05", "A06", "A03", "A04"]), { timeout: 10_000 });
    // From A04 on: Elmway's two, then Northwind's A04 — matches no one run of the page's rows holds.
    await find(two.container, '"A04"..');
    await waitFor(() => expect(foundKeys()).toEqual(["A05", "A06", "A04"]), { timeout: 10_000 });
    expect(h.requests("read", RACKS_DATASET)).toEqual([]);
});

/**
 * The owner's page, dimmed, with the floor's network beside its racks: the frames read whole, and the fibre runs that join
 * them to the racks — A01 to A04's to ODF-1, every one of a rack another owner is let.
 */
const ownerNetwork = (owner: string) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const fibre = $.let(Record.bind(ex.schematicFibre, ["patch"]));
    const slice = $.let(Slice.bindRecords("schematic.scope.network", {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: ["schematic_racks_by_owner", "schematic_racks_by_area", "schematic_racks_by_owner_area"] }),
            scope: { owner: [owner] },
            fields: {},
        },
    }));
    return Schematic({
        id: "scope-network",
        inspector: true,
        extent: { width: 28, height: 14 },
        slice: { slice },
        narrowed: { show: "dim" },
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
        links: {
            fibre: Schematic.links(fibre, {
                name: "Fibre run", icon: "bolt",
                from: { field: "from", of: { rack: "racks", frame: "network" } }, to: { field: "to", of: { rack: "racks", frame: "network" } },
            }),
        },
    });
}))) });

/** What Details lists an item joined to, by the entities' ids. */
const joins = (container: HTMLElement) => [...slot(container, "end").querySelectorAll("[role='tabpanel']:not([hidden]) [data-inspector-join]")]
    .map((el) => el.getAttribute("data-inspector-join"));

test("dimmed, a fibre run from a rack the page's scope leaves out is no run of this page: its far end, read by key, is held to the scope — drawn neither as itself nor as context — and the frame it reaches is joined to none (#1621)", async () => {
    const before = h.requests("rows", RACKS_DATASET).length;
    const { container } = await h.mount(ownerNetwork("Elmway College"));
    await settle();
    await waitFor(() => expect(card(container, "network", "ODF-1")).not.toBeNull());
    await waitFor(() => expect(card(container, "racks", "A05")).not.toBeNull());
    // The runs reach ODF-1, which the view draws: their far ends, A01 to A04, read by key.
    await waitFor(() => expect(h.requests("rows", RACKS_DATASET).length).toBeGreaterThan(before));
    await settle();
    // Held to the scope, none of them is drawn: the owner's rack alone, as itself.
    expect(drawnRacks(container)).toEqual(["A05"]);
    expect(card(container, "racks", "A05")!.hasAttribute("data-context")).toBe(false);
    // ODF-1, tapped: it is joined to no run, each running from a rack this page does not hold.
    const canvas = container.querySelector<HTMLElement>("[data-schematic-canvas]")!;
    const odf = card(container, "network", "ODF-1")!;
    canvasLayout.hits((px, py) => (near(CAM, px, py, 8.4, 9.6) ? odf : px >= 0 && px < 1080 && py >= 0 && py < 540 ? canvas : null));
    fireEvent.pointerEnter(canvas);
    await tap(canvas, CAM, 8.4, 9.6);
    await waitFor(() => expect(odf.hasAttribute("data-selected")).toBe(true));
    expect(joins(container)).toEqual([]);
});
