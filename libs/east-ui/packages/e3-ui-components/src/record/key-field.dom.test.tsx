/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A record whose rows hold their own key in a field (`keyField`,
 * east-workspace#1705): a crew keyed by staff id, each member's `staff` their
 * key. A member Add drafts shows their key in that field at once, though
 * `newRow` gave it nothing, and is saved with it; where another session's
 * Save takes the key first, the member goes on under the next the rule makes,
 * and their field follows. A member the record held already, whose field
 * never held their key, keeps what it holds through a change of their name.
 * Over a crew deployed to e3 itself, each test a workspace of its own.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DictType, East, SetType, StringType, StructType, equalFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Record } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

/** A member of the crew: their staff id, which is their key too, and their name. */
const Member = StructType({ staff: StringType, name: StringType });
/** The crew: Ada, whose row holds her key, and Lin, whose row was saved before it held his. */
const crew = e3.record("key_field_crew", DictType(StringType, Member), {
    initial: new Map([["S-1", { staff: "S-1", name: "Ada" }], ["S-2", { staff: "", name: "Lin" }]]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const h = sheetHarness({ modules: { "record/key-field": { crew } }, frame: 2000 });
const memberEqual = equalFor(Member);
const printCrew = printFor(crew.type);

/** The crew, a new member keyed after the crew's own — S-3 after S-2 — and named by `newRow`, which says nothing of their staff id. */
const crewKeyed = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(crew));
    const newKey = $.const(East.function([SetType(StringType)], StringType, (_$2, taken) => East.str`S-${taken.size().add(1n)}`));
    const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(Member), () => Record.patch(Member, { name: "Grace" })));
    return Record({
        record: members,
        keyField: "staff",
        title: "Crew",
        noun: { singular: "member", plural: "members" },
        columns: {
            name: Record.column.title(Member, { header: "Name" }),
            staff: Record.column.text(Member, { header: "Staff" }),
        },
        newKey,
        newRow,
        name: "crewKeyed",
    });
})));

/** The grid's rows, by their keys, in order. */
const ids = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')].map((row) => row.getAttribute("data-row-id"));
/** What a row's cell reads, by the row's key and the column's. */
const cell = (container: HTMLElement, id: string, key: string) =>
    container.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)?.textContent;
/** The toolbar's region. */
const toolbar = (container: HTMLElement) => slot(container, "toolbar")!;
/** The status line's words. */
const status = (container: HTMLElement) => toolbar(container).querySelector('[data-slot="status"]')?.textContent;
/** A button of the history bar, by its name. */
const history = (container: HTMLElement, name: string) => within(toolbar(container)).getByRole("button", { name }) as HTMLButtonElement;

/** Add, pressed, and what it leads to settled. */
async function add(container: HTMLElement) {
    const button = toolbar(container).querySelector<HTMLButtonElement>('[data-record-action="add"]')!;
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.click(button);
    await settle();
}

/** The member another session adds meanwhile, under the key this page's new member has. */
const PAT: ValueTypeOf<typeof Member> = { staff: "S-3", name: "Pat" };

describe("a record whose rows hold their own key in a field", () => {
    test("a member added shows their key in the field at once, though `newRow` gave it nothing, and is saved with it; a member whose field never held their key keeps what it holds", async () => {
        const { container } = await h.mount({ fn: crewKeyed }, { storageKey: "record-key-field" });
        expect([cell(container, "S-1", "staff"), cell(container, "S-2", "staff")]).toEqual(["S-1", ""]);
        await add(container);
        expect(ids(container)).toEqual(["S-1", "S-2", "S-3"]);
        expect([cell(container, "S-3", "name"), cell(container, "S-3", "staff")]).toEqual(["Grace", "S-3"]);
        fireEvent.click(history(container, editingMessages.apply()));
        await waitFor(async () => expect([...(await h.read(crew)).keys()]).toEqual(["S-1", "S-2", "S-3"]));
        const saved = await h.read(crew);
        expect([memberEqual(saved.get("S-3")!, { staff: "S-3", name: "Grace" }), memberEqual(saved.get("S-2")!, { staff: "", name: "Lin" })], printCrew(saved)).toEqual([true, true]);
        await waitFor(() => expect(cell(container, "S-3", "staff")).toBe("S-3"));
    });

    test("where another session's Save takes the key first, the member goes on under the next, their field with them: both saved, each holding the key they are saved under", async () => {
        const { container } = await h.mount({ fn: crewKeyed }, { storageKey: "record-key-field-taken" });
        await add(container);
        expect(cell(container, "S-3", "staff")).toBe("S-3");
        // Another session adds its own S-3 just as Save goes.
        await h.race(crew, () => { fireEvent.click(history(container, editingMessages.apply())); }, (now) => {
            now.set("S-3", PAT);
            return now;
        });
        await waitFor(() => expect(status(container)).toBe("S-3 was taken by another save — the new member is S-4"));
        const saved = await h.read(crew);
        expect([...saved.keys()]).toEqual(["S-1", "S-2", "S-3", "S-4"]);
        expect([memberEqual(saved.get("S-3")!, PAT), memberEqual(saved.get("S-4")!, { staff: "S-4", name: "Grace" })], printCrew(saved)).toEqual([true, true]);
        await waitFor(() => expect([cell(container, "S-3", "staff"), cell(container, "S-4", "staff")]).toEqual(["S-3", "S-4"]));
    });
});
