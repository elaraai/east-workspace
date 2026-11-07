/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic over records keyed by number and by text (#1549), on e3
 * itself: a bakehouse's floor (`schematic-keys.fixtures.ts`) — its ovens keyed
 * by number, its mixers by name. Every key travels as its text; the renderer
 * orders and seeks each kind's keys at its type, never by their texts, which
 * would put 10 before 2.
 *
 * - **Issues** lists the ovens past the floor's edge by their numbers: 2, 9,
 *   then 10.
 * - **The Backlog** holds the ovens with no position by their numbers: 3, 20,
 *   then 100.
 * - **Find**, over kinds keyed by two types, reads the text at String — a
 *   mixer's key by its start — and each oven's as typed: `10` is oven 10, and
 *   the start of mixer 10B's key; `2..11` the ovens from 2 up to 11 — among
 *   their rows where they are read whole, and in their record through e3 where
 *   the rail reads them.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Schematic } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/schematic/schematic-keys";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import { card, layOutCanvas } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic-keys.fixtures": fx }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
layOutCanvas();

/** The ovens' record, as its dataset's requests name it. */
const OVENS = `records.${fx.keyedOvens.name}`;

/** The floor, read whole: its ovens and its mixers, the Backlog in the library, and the inspector. */
const floor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const ovens = $.let(Data.bind(fx.keyedOvens));
    const mixers = $.let(Data.bind(fx.keyedMixers));
    return Schematic({
        id: "keyed",
        inspector: true,
        extent: fx.KEYED_FLOOR,
        items: {
            ovens: Schematic.items(ovens, { name: "Oven", icon: "server", x: "x", y: "y", label: "name" }),
            mixers: Schematic.items(mixers, { name: "Mixer", icon: "network-wired", x: "x", y: "y", label: "name" }),
        },
        library: [Schematic.library.backlog()],
    });
}))) };

/** The floor, its ovens read through their source of the rail. */
const railedFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const slice = $.let(Slice.bindRecords("schematic.keyed", {
        ovens: { source: Data.bindPaged(fx.keyedOvens, { indexes: ["schematic_keyed_ovens_by_name"] }) },
    }));
    const ovens = $.let(Data.bindPaged(fx.keyedOvens));
    const mixers = $.let(Data.bind(fx.keyedMixers));
    return Schematic({
        id: "keyedRail",
        extent: fx.KEYED_FLOOR,
        slice: { slice },
        items: {
            ovens: Schematic.items(ovens, { name: "Oven", icon: "server", x: "x", y: "y", label: "name" }),
            mixers: Schematic.items(mixers, { name: "Mixer", icon: "network-wired", x: "x", y: "y", label: "name" }),
        },
    });
}))) };

/** Mounts a floor and waits until oven 11, on it, is drawn. */
async function open(example: { fn: { toIR(): unknown } }): Promise<HTMLElement> {
    const ui = await h.mount(example);
    await settle();
    await waitFor(() => expect(card(ui.container, "ovens", "11")).not.toBeNull());
    await settle();
    return ui.container;
}

/** An oven's id, as the canvas and the Backlog's cards name it. */
const oven = (key: string): string => entityId({ kind: "ovens", key });

/** The inspector's open tab. */
const inspector = (c: HTMLElement): HTMLElement => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;

/** The library's open tab. */
const library = (c: HTMLElement): HTMLElement => slot(c, "start").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;

/** The Issues tab's rows: each what it names, and what it says. */
const issueRows = (c: HTMLElement): (string | null)[][] => [...inspector(c).querySelectorAll("[data-inspector-issue]")]
    .map((el) => [el.children[0]?.textContent ?? null, el.children[1]?.textContent ?? null]);

/** The Backlog's cards, by id, in order. */
const backlogIds = (c: HTMLElement): (string | null)[] => [...library(c).querySelectorAll("[data-library-item]")].map((el) => el.getAttribute("data-library-item"));

/** Find's box, in the toolbar's row. */
const findBox = (c: HTMLElement): HTMLElement => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;

/** Types into Find's box, a key at a time, as a person does. */
async function typeIntoFind(c: HTMLElement, text: string): Promise<void> {
    const input = findBox(c).querySelector<HTMLInputElement>("input")!;
    for (const key of text) {
        const typed = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(typed));
    }
}

/** Clears Find's box, as its clear button does. */
async function clearFind(c: HTMLElement): Promise<void> {
    await act(async () => { fireEvent.click(findBox(c).querySelector("button[aria-label='Clear search']")!); });
    await settle();
}

/** Find's list, its lines as they read. */
const lines = (): (string | null)[] => [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);

test("Issues lists the ovens past the floor's edge by their numbers — 2, 9, then 10 — and the Backlog holds the ovens with no position by theirs: 3, 20, then 100 (#1549)", async () => {
    const c = await open(floor);
    const tab = [...slot(c, "end").querySelectorAll("[role='tab']")].find((each) => each.textContent?.startsWith("Issues"));
    if (tab === undefined) throw new Error("the inspector holds no Issues tab");
    await act(async () => { fireEvent.click(tab); });
    await settle();
    await waitFor(() => expect(issueRows(c)).toEqual([
        ["Oven · Deck 2", "Outside the drawing"],
        ["Oven · Deck 9", "Outside the drawing"],
        ["Oven · Deck 10", "Outside the drawing"],
    ]));
    await waitFor(() => expect(backlogIds(c)).toEqual([oven("3"), oven("20"), oven("100")]));
});

test("read whole, Find over ovens keyed by number and mixers by name reads a mixer's key by its start and each oven's as typed: `10` is oven 10 and the start of mixer 10B's key; `2..11` the ovens from 2 up to 11, in their numbers' order (#1549)", async () => {
    const c = await open(floor);
    await typeIntoFind(c, "10");
    await waitFor(() => expect(lines()).toEqual(["10 · Deck 10 · Oven", "10B · Mixer"]), { timeout: 5_000 });
    await clearFind(c);
    // No oven's number starts so: the mixers alone.
    await typeIntoFind(c, "M");
    await waitFor(() => expect(lines()).toEqual(["M1 · Mixer", "M2 · Mixer"]), { timeout: 5_000 });
    await clearFind(c);
    await typeIntoFind(c, "2..11");
    await waitFor(() => expect(lines()).toEqual(["2 · Deck 2 · Oven", "3 · Deck 3 · Oven · no position", "9 · Deck 9 · Oven", "10 · Deck 10 · Oven"]), { timeout: 5_000 });
});

test("read through the rail, an oven is sought in its record through e3 at its number: `10` is oven 10, beside the start of mixer 10B's key (#1549)", async () => {
    const c = await open(railedFloor);
    const before = h.requests("find", OVENS).length;
    await typeIntoFind(c, "10");
    await waitFor(() => expect(lines()).toEqual(["10 · Deck 10 · Oven", "10B · Mixer"]), { timeout: 5_000 });
    expect(h.requests("find", OVENS).length).toBeGreaterThan(before);
    await clearFind(c);
    await typeIntoFind(c, "2..11");
    await waitFor(() => expect(lines()).toEqual(["2 · Deck 2 · Oven", "3 · Deck 3 · Oven · no position", "9 · Deck 9 · Oven", "10 · Deck 10 · Oven"]), { timeout: 5_000 });
});
