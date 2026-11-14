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
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import { card, layOutCanvas } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
layOutCanvas();

/** The racks' record, as its dataset's requests name it. */
const RACKS_DATASET = `records.${ex.schematicRacks.name}`;

/** The racks the floor places. */
const PLACED = ["A01", "A02", "A03", "A04", "A05"];

/** An owner's page: its key, the owner it is for, and how the viewer's narrowing draws. */
interface OwnerPage {
    readonly key: string;
    readonly owner: string;
    readonly show: "hide" | "dim";
}

/**
 * The data centre's racks on an owner's own page: read by area — their source lists the area index, the one the owner
 * leads and the index by owner the scope asks for — scoped to the owner, editable through their patch door, with the
 * Backlog in the library. The rail offers no field: the scope holds the only one a listed index leads first.
 */
const ownerFloor = ({ key, owner, show }: OwnerPage) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const slice = $.let(Slice.bindRecords(`schematic.scope.${key}`, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: ["schematic_racks_by_owner", "schematic_racks_by_area", "schematic_racks_by_owner_area"] }),
            scope: { owner: [owner] },
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
        const { container, unmount } = await open({ key: `elmway-${show}`, owner: "Elmway College", show }, "A05");
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

test("its Backlog pages the owner's racks with no position and counts them alone: `Backlog 1`, never `1 of 2`, every owner's (#1621)", async () => {
    const { container } = await open({ key: "elmway-backlog", owner: "Elmway College", show: "hide" }, "A05");
    await waitFor(() => expect(cards(container).map((c) => c.key)).toEqual([rack("A06")]));
    expect(tab(container)).toBe("Backlog 1");
    expect(cards(container).map((c) => [c.context, c.drags])).toEqual([[false, true]]);
});

test("emptied, its Backlog says so plainly — never that the filters match nothing, and no Clear filters, which could not clear the scope (#1621)", async () => {
    const { container } = await open({ key: "northwind", owner: "Northwind Media", show: "hide" }, "A03");
    expect(drawnRacks(container)).toEqual(["A03", "A04"]);
    await waitFor(() => expect(tab(container)).toBe("Backlog 0"));
    const backlog = pane(container).querySelector<HTMLElement>('[role="tab"]')!;
    await act(async () => { fireEvent.click(backlog); });
    await settle();
    await waitFor(() => expect(emptyState(container)).not.toBeNull());
    expect(emptyState(container)).toEqual(["Nothing in the backlog", null]);
    expect(panel(container).querySelector("[data-library-empty][data-narrowed]")).toBeNull();
});
