/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A record whose rows' keys the app builds from them (`key`,
 * east-workspace#1709), in a browser, on e3: racks keyed by the code a person
 * types. A rack Add drafts stands under the key its row builds at once, its
 * code still empty read as empty, and moves under its code as it is typed —
 * in the step of the edit, which Undo takes back with it — and is saved under
 * it. A second rack that builds a key another stands under is refused, and
 * the status line says why, in the Record's word for its rows and in the
 * danger tone. A code typed over moves its rack; one another rack has is
 * refused, the rack marked where it stands, again each time; and a rack stored
 * apart from the key its row builds stays where it is until its code changes.
 * A rack moved and then discarded is one change dropped.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DictType, East, StringType, StructType, equalFor, printFor } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Record } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

/** A rack: its code, which its key is built from, and its bay. */
const Rack = StructType({ code: StringType, bay: StringType });
/** The racks: two under the keys their codes build, and one stored under a key of another scheme. */
const racks = e3.record("built_key_racks", DictType(StringType, Rack), {
    initial: new Map([["OLD", { code: "R-9", bay: "Yard" }], ["R-1", { code: "R-1", bay: "North" }], ["R-2", { code: "R-2", bay: "South" }]]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const h = sheetHarness({ modules: { "record/built-key": { racks } }, frame: 2000 });
const rackEqual = equalFor(Rack);
const printRacks = printFor(racks.type);

/** The racks, each keyed by its code: a new one's bay given by `newRow`, its code left to its person. */
const racksKeyed = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const held = $.let(Record.bind(racks));
    const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(Rack), () => Record.patch(Rack, { bay: "Dock" })));
    return Record({
        record: held,
        key: (rack) => rack.code,
        title: "Racks",
        noun: { singular: "rack", plural: "racks" },
        columns: {
            code: Record.column.text(Rack, { header: "Code" }),
            bay: Record.column.text(Rack, { header: "Bay" }),
        },
        newRow,
        name: "racksKeyed",
    });
})));

/** The Record's rows, in order. */
const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')];
/** The grid's rows, by their keys, in order. */
const ids = (c: HTMLElement) => rows(c).map((row) => row.getAttribute("data-row-id"));
/** A row's cell under a column. */
const cellOf = (c: HTMLElement, id: string, key: string) =>
    rows(c).find((row) => row.getAttribute("data-row-id") === id)?.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`);
/** What a row's cell reads, by the row's key and the column's. */
const cell = (c: HTMLElement, id: string, key: string) => cellOf(c, id, key)?.textContent;
/** The grid: what takes the keys and the pastes. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** The toolbar's region. */
const toolbar = (c: HTMLElement) => slot(c, "toolbar")!;
/** The status line's words. */
const status = (c: HTMLElement) => toolbar(c).querySelector('[data-slot="status"]')?.textContent;
/** The status line's tone; `null` where it has none. */
const tone = (c: HTMLElement) => toolbar(c).querySelector('[data-slot="status"]')?.getAttribute("data-tone") ?? null;
/** The rows marked as refused, each by its key and the refusal's turn. */
const refused = (c: HTMLElement) => rows(c).filter((row) => row.hasAttribute("data-refused")).map((row) => [row.getAttribute("data-row-id"), row.getAttribute("data-refused")]);
/** A button of the history bar, by its name. */
const history = (c: HTMLElement, name: string) => within(toolbar(c)).getByRole("button", { name }) as HTMLButtonElement;

/** Add, pressed, and what it leads to settled. */
async function add(c: HTMLElement) {
    const button = toolbar(c).querySelector<HTMLButtonElement>('[data-record-action="add"]')!;
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.click(button);
    await settle();
}

/** Words typed over a rack's cell, as a paste types them. */
async function type(c: HTMLElement, id: string, key: string, words: string): Promise<void> {
    fireEvent.mouseDown(cellOf(c, id, key)!, { button: 0 });
    await act(async () => { fireEvent.paste(grid(c), { clipboardData: { getData: () => words } }); });
    await settle();
}

/** A press of a history button, and what it leads to settled. */
async function press(c: HTMLElement, name: string): Promise<void> {
    await act(async () => { fireEvent.click(history(c, name)); });
    await settle();
}

describe("a record whose rows' keys are built from them", () => {
    test("ruling 6 — a rack Add drafts stands under the key its row builds at once, its empty code read as empty, and moves under its code as it is typed; a second that builds a key another stands under is refused, saying so; Undo takes the move back with the edit, and Save writes the rack under its code", async () => {
        const { container: c } = await h.mount({ fn: racksKeyed }, { storageKey: "record-built-key" });
        expect(ids(c)).toEqual(["OLD", "R-1", "R-2"]);
        await add(c);
        // No code yet: the key an empty code builds, with the bay `newRow` gave.
        expect(ids(c)).toEqual(["", "OLD", "R-1", "R-2"]);
        expect(cell(c, "", "bay")).toBe("Dock");
        // Another new rack builds that key too: none is added.
        await add(c);
        expect(ids(c)).toEqual(["", "OLD", "R-1", "R-2"]);
        expect(status(c)).toBe('Another rack is keyed "" already');
        // …in the danger tone; the rack refused was never added, so no row is marked — never the rack that holds the key.
        expect([tone(c), refused(c)]).toEqual(["refused", []]);
        // Its code typed: the rack goes under it, in the step of the edit.
        await type(c, "", "code", "R-3");
        expect(ids(c)).toEqual(["OLD", "R-1", "R-2", "R-3"]);
        expect([cell(c, "R-3", "code"), cell(c, "R-3", "bay")]).toEqual(["R-3", "Dock"]);
        // A gesture taken says its own words, in the line's own ink.
        expect(tone(c)).toBeNull();
        await press(c, editingMessages.undo());
        expect(ids(c)).toEqual(["", "OLD", "R-1", "R-2"]);
        await press(c, editingMessages.redo());
        expect(ids(c)).toEqual(["OLD", "R-1", "R-2", "R-3"]);
        await press(c, editingMessages.apply());
        await waitFor(async () => expect([...(await h.read(racks)).keys()]).toEqual(["OLD", "R-1", "R-2", "R-3"]));
        const saved = await h.read(racks);
        expect(rackEqual(saved.get("R-3")!, { code: "R-3", bay: "Dock" }), printRacks(saved)).toBe(true);
        await waitFor(() => expect(ids(c)).toEqual(["OLD", "R-1", "R-2", "R-3"]));
    });

    test("ruling 1 — a code typed over moves its rack under the key it builds; a code another rack has is refused, saying so in the danger tone, the rack marked where it stands; a rack stored apart from the key its row builds stays until its code changes", async () => {
        const { container: c } = await h.mount({ fn: racksKeyed }, { storageKey: "record-built-key-moved" });
        expect(ids(c)).toEqual(["OLD", "R-1", "R-2"]);
        // A bay typed changes nothing the key reads: the rack stored under another scheme's key stays there.
        await type(c, "OLD", "bay", "East");
        expect(ids(c)).toEqual(["OLD", "R-1", "R-2"]);
        expect(cell(c, "OLD", "bay")).toBe("East");
        // R-1 is another rack's: R-2 keeps its code and its key.
        await type(c, "R-2", "code", "R-1");
        expect(status(c)).toBe('Another rack is keyed "R-1" already');
        expect(ids(c)).toEqual(["OLD", "R-1", "R-2"]);
        expect(cell(c, "R-2", "code")).toBe("R-2");
        // The line says so in the danger tone, and the rack is marked where it stands — again, on the other turn, as it
        // is refused again, so its flash starts over.
        expect([tone(c), refused(c)]).toEqual(["refused", [["R-2", "1"]]]);
        await type(c, "R-2", "code", "R-1");
        expect([tone(c), refused(c)]).toEqual(["refused", [["R-2", "0"]]]);
        await type(c, "R-2", "code", "R-5");
        expect(ids(c)).toEqual(["OLD", "R-1", "R-5"]);
        expect([cell(c, "R-5", "code"), cell(c, "R-5", "bay")]).toEqual(["R-5", "South"]);
        // The rack moved: its mark and the line's tone went with the refusal's words.
        expect([tone(c), refused(c)]).toEqual([null, []]);
        await press(c, editingMessages.apply());
        await waitFor(async () => expect([...(await h.read(racks)).keys()]).toEqual(["OLD", "R-1", "R-5"]));
        // The rack moved is the rack it was, changed: the Save says two racks changed — never one added and one deleted.
        await waitFor(() => expect(status(c)).toBe("Applied 2 changes to 2 racks"));
        const saved = await h.read(racks);
        expect([rackEqual(saved.get("R-5")!, { code: "R-5", bay: "South" }), rackEqual(saved.get("OLD")!, { code: "R-9", bay: "East" })], printRacks(saved)).toEqual([true, true]);
        // Its code typed over, the rack under another scheme's key goes under the key it builds now.
        await waitFor(() => expect(ids(c)).toEqual(["OLD", "R-1", "R-5"]));
        await type(c, "OLD", "code", "R-8");
        expect(ids(c)).toEqual(["R-1", "R-5", "R-8"]);
    });

    test("ruling 1 — a rack moved under another key and discarded is one change dropped: the status line counts the rack once — never the key it left and the key it stood under as two", async () => {
        const { container: c } = await h.mount({ fn: racksKeyed }, { storageKey: "record-built-key-discarded" });
        await type(c, "R-2", "code", "R-5");
        expect(ids(c)).toEqual(["OLD", "R-1", "R-5"]);
        await press(c, editingMessages.discard());
        expect([status(c), ids(c)]).toEqual(["Discarded 1 change", ["OLD", "R-1", "R-2"]]);
    });
});
