/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A number outside its field's bounds (#1585), over the joinery's pieces on e3
 * itself: an app's write leaves the window seat at bench 10, past the bench's
 * most, 9, and the hall door's paint at no coats, under their least, 1. The
 * window seat's bench cell wears the warn wash a field still missing wears,
 * saying the bound; the hall door's Details say it once, in Coats' help line,
 * as a warning; Issues lists both as warnings, and neither holds Save. Once the
 * hall door is changed, its issue is its own, as a field still missing is, Save
 * waits, and Coats' help line is an error.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, variant } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** The joinery's pieces, each one's bench a number from 1 to 9, and a paint's coats from 1 to 4. */
const piecesBounded = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pieces = $.let(Record.bind(ex.recordPieces));
    return Record({
        record: pieces,
        title: "Joinery",
        noun: { singular: "piece", plural: "pieces" },
        columns: {
            name: Record.column.title(ex.Piece, { header: "Piece" }),
            room: Record.column.text(ex.Piece, { header: "Room" }),
            bench: Record.column.integer(ex.Piece, { header: "Bench" }),
        },
        fields: {
            bench: Record.field.number({ min: 1n, max: 9n }),
            finish: Record.field.select({
                labels: { bare: "Bare", stain: "Stain", paint: "Paint" },
                cases: { stain: Record.field.text({ label: "Shade" }), paint: { colour: Record.field.text(), coats: Record.field.number({ min: 1n, max: 4n }) } },
            }),
        },
        inspector: true,
        name: "piecesBounded",
    });
})));

/** A piece's cell, by its key and the column's. */
const cell = (c: HTMLElement, id: string, key: string) =>
    c.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** The grid: what takes the keys. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** The inspector pane. */
const pane = (c: HTMLElement) => slot(c, "end")!;
/** Whether Save waits: its button takes no press. */
const saveWaits = (c: HTMLElement) => within(slot(c, "toolbar")!).getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled;
/** The inspector's Issues tab, by its words. */
const issuesTab = (c: HTMLElement) => within(pane(c)).getByRole("tab", { name: /^Issues/ });
/** The Issues tab's entries: where each is, what it says, and its kind. */
const listed = (c: HTMLElement) => [...pane(c).querySelectorAll<HTMLElement>("[data-inspector-issue]")].map((issue) => {
    const message = issue.querySelector<HTMLElement>("[data-kind]")!;
    return [issue.firstElementChild?.textContent, message.textContent, message.getAttribute("data-kind")];
});

/** What the hall door's Coats says of its bound: the part of its help line said in a tone, and that tone — never a line of its own. */
const coatsSaid = async (c: HTMLElement) => {
    const coats = await waitFor(() => {
        const field = pane(c).querySelector<HTMLElement>('[data-field="finish.paint.coats"]');
        expect(field).not.toBeNull();
        return field!;
    });
    expect(coats.querySelector("[data-scope=field][data-part=error-text]")).toBeNull();
    const toned = coats.querySelector("[data-scope=field][data-part=helper-text] [data-breach]");
    return toned === null ? undefined : [toned.textContent, toned.getAttribute("data-breach")];
};

/** Presses an element, as a pointer does. */
async function press(el: Element) {
    fireEvent.mouseDown(el, { button: 0 });
    fireEvent.click(el);
    await settle();
}

/** Types a text cell's new value, the ring on it first, committed with ⇥. */
async function typeInto(c: HTMLElement, id: string, key: string, text: string) {
    await press(cell(c, id, key));
    fireEvent.keyDown(grid(c), { key: text[0]! });
    await settle();
    const input = await waitFor(() => {
        const open = cell(c, id, key).querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(open).not.toBeNull();
        return open!;
    });
    fireEvent.input(input, { target: { value: text } });
    await settle();
    fireEvent.keyDown(input, { key: "Tab" });
    await settle();
}

test("a stored number outside its bounds is washed and said once, as a warning, and Issues lists it as a warning, holding no Save; changed, the issue is the row's own, Save waits and Details says it as an error (#1585)", async () => {
    const pieces = await h.read(ex.recordPieces);
    pieces.set("J-103", { ...pieces.get("J-103")!, bench: 10n });
    pieces.set("J-101", { ...pieces.get("J-101")!, finish: variant("paint", { colour: "Teal", coats: 0n, gloss: variant("matt", null) }) });
    await h.patch(ex.recordPieces, pieces);
    const { container } = await h.mount({ fn: piecesBounded }, { storageKey: "record-bounds" });
    // The window seat's bench, past its most: washed, and saying it.
    const bench = () => cell(container, "J-103", "bench");
    expect([bench().hasAttribute("data-bounds"), bench().getAttribute("title")]).toEqual([true, "at most 9"]);
    expect(cell(container, "J-101", "bench").hasAttribute("data-bounds")).toBe(false);
    // The hall door's Details: its coats under their least, said once, in the field's help line, as a warning.
    await press(cell(container, "J-101", "room"));
    expect(await coatsSaid(container)).toEqual(["1–4", "warn"]);
    // The stair rail changed: neither stored piece holds Save, and Issues lists both as warnings.
    await typeInto(container, "J-102", "room", "Stairs, east");
    expect([saveWaits(container), issuesTab(container).textContent]).toEqual([false, "Issues 2"]);
    await act(async () => { fireEvent.click(issuesTab(container)); });
    await settle();
    expect(listed(container)).toEqual([["Hall door · Coats", "at least 1", "warning"], ["Window seat · Bench", "at most 9", "warning"]]);
    // The hall door changed: its coats are its own issue, as a field still missing is, Save waits, and Details says it as
    // an error.
    await typeInto(container, "J-101", "room", "Hall, east");
    expect([saveWaits(container), issuesTab(container).textContent]).toEqual([true, "Issues 2"]);
    expect(listed(container)).toEqual([["Hall door · Coats", "at least 1", "incomplete"], ["Window seat · Bench", "at most 9", "warning"]]);
    await act(async () => { fireEvent.click(within(pane(container)).getByRole("tab", { name: "Details" })); });
    await settle();
    expect(await coatsSaid(container)).toEqual(["1–4", "error"]);
});
