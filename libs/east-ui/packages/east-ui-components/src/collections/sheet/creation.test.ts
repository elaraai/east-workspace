/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Seeding at the gesture boundary on a sheet with loose rows between its
 * groups (#846): an entry's draft is a variant — a loose row seeded by
 * `newRow` at its entry placement, a group by `newGroup` — and a new line
 * gets its id field minted, the field a loose row is identified by, unless
 * `newRow` supplied one. A sheet of groups alone never mints.
 */

import { describe, expect, test } from "vitest";
import { ArrayType, East, StringType, StructType, fromEastTypeValue, none, some, variant } from "@elaraai/east";
import { Sheet, UIComponentType } from "@elaraai/east-ui/internal";
import { prepareCreation } from "./creation.js";
import { liftDraft } from "./draft-values.js";
import type { EntryVersion } from "./transactions.js";
import type { SheetRowValue } from "./values.js";

const Task = StructType({ id: StringType, task: StringType, note: StringType });
const Pkg = StructType({ id: StringType, name: StringType, tasks: ArrayType(Task) });
const Entry = Sheet.Types.Entry(Pkg, "tasks");

/** The editing declaration of a compiled sheet — entries of packages and loose tasks, or packages alone; `newRow` notes the destination it was asked for. */
function editingOf(entries: boolean, supplyId: boolean) {
    const noteDestination = East.function([Sheet.Types.NewRow], Sheet.Types.Patch(Task), (_$, at) => Sheet.patch(Task, { note: at.destination.getTag() }));
    const withId = East.function([Sheet.Types.NewRow], Sheet.Types.Patch(Task), (_$, at) => Sheet.patch(Task, { id: "given", note: at.destination.getTag() }));
    const newGroup = East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(Pkg), () => Sheet.patch(Pkg, { name: "New package", tasks: [] }));
    const program = entries
        ? East.function([], UIComponentType, ($) => {
            const rows = $.const([], ArrayType(Entry));
            return Sheet.Root(rows, { task: Sheet.column.text(Task) }, {
                id: "id", group: Sheet.group(Pkg, "tasks", { title: "name" }), newRow: supplyId ? withId : noteDestination, newGroup,
            });
        })
        : East.function([], UIComponentType, ($) => {
            const rows = $.const([], ArrayType(Pkg));
            return Sheet.Root(rows, { task: Sheet.column.text(Task) }, {
                id: "id", group: Sheet.group(Pkg, "tasks", { title: "name" }), newRow: noteDestination, newGroup,
            });
        });
    const root = program.toIR().compile([])();
    if (root.type !== "Sheet") throw new Error("Expected a Sheet");
    return { editing: root.value.editing, draftType: fromEastTypeValue(root.value.editing.draftType) };
}

const PLACE = some(variant("ordered", variant("before", "p")));
const ABSENT: EntryVersion = { draft: undefined, wire: undefined, place: none };
const BAND = some({ sub: "", folded: false });

describe("an entry's draft is a variant", () => {
    const { editing, draftType } = editingOf(true, false);

    test("a loose row — a wire row with no band — is seeded by newRow at its entry placement: the entry's row arm", () => {
        const input: SheetRowValue = { id: "new", owned: false, cells: new Map([["task", variant("String", "Stage parts")]]), lines: [], band: none, subRows: [] };
        const prepared = prepareCreation(input, ABSENT, undefined, PLACE, editing, draftType, () => "unused");
        expect(prepared.draft).toEqual(variant("row", { id: variant("missing", null), task: variant("missing", null), note: variant("value", "entry") }));
        expect(prepared.row.cells.get("task")).toEqual(variant("String", "Stage parts"));
    });

    test("a group — a wire row with a band — is seeded by newGroup: the entry's group arm", () => {
        const input: SheetRowValue = { id: "g", owned: false, cells: new Map(), lines: [], band: BAND, subRows: [] };
        const prepared = prepareCreation(input, ABSENT, undefined, PLACE, editing, draftType, () => "unused");
        expect(prepared.draft).toEqual(variant("group", { id: variant("missing", null), name: variant("value", "New package"), tasks: [] }));
    });

    test("a new line takes newRow's child defaults and a minted id; the lines already there keep their drafts", () => {
        const wire: SheetRowValue = { id: "p", owned: false, cells: new Map(), band: BAND, subRows: [], lines: [{ key: "0", cells: new Map([["task", variant("String", "Cut")]]), subRows: [] }] };
        const current: EntryVersion = { draft: liftDraft(draftType, variant("group", { id: "p", name: "Pkg", tasks: [{ id: "t1", task: "Cut", note: "" }] })), wire, place: PLACE };
        const input: SheetRowValue = { ...wire, lines: [...wire.lines, { key: "+1", cells: new Map(), subRows: [] }] };
        let minted = 0;
        const prepared = prepareCreation(input, current, undefined, PLACE, editing, draftType, () => `minted-${++minted}`);
        expect(prepared.draft).toEqual(variant("group", {
            id: variant("value", "p"), name: variant("value", "Pkg"),
            tasks: [
                { id: variant("value", "t1"), task: variant("value", "Cut"), note: variant("value", "") },
                { id: variant("value", "minted-1"), task: variant("missing", null), note: variant("value", "child") },
            ],
        }));
        expect(minted).toBe(1);
    });

    test("a line whose newRow supplies its id keeps it — nothing is minted", () => {
        const given = editingOf(true, true);
        const wire: SheetRowValue = { id: "p", owned: false, cells: new Map(), band: BAND, subRows: [], lines: [] };
        const current: EntryVersion = { draft: liftDraft(given.draftType, variant("group", { id: "p", name: "Pkg", tasks: [] })), wire, place: PLACE };
        const input: SheetRowValue = { ...wire, lines: [{ key: "+1", cells: new Map(), subRows: [] }] };
        const prepared = prepareCreation(input, current, undefined, PLACE, given.editing, given.draftType, () => { throw new Error("minted"); });
        expect((prepared.draft as { value: { tasks: { id: unknown }[] } }).value.tasks[0]!.id).toEqual(variant("value", "given"));
    });
});

test("on a sheet of groups alone a new line's id is the author's to supply — never minted", () => {
    const { editing, draftType } = editingOf(false, false);
    const wire: SheetRowValue = { id: "p", owned: false, cells: new Map(), band: BAND, subRows: [], lines: [] };
    const current: EntryVersion = { draft: liftDraft(draftType, { id: "p", name: "Pkg", tasks: [] }), wire, place: PLACE };
    const input: SheetRowValue = { ...wire, lines: [{ key: "+1", cells: new Map(), subRows: [] }] };
    const prepared = prepareCreation(input, current, undefined, PLACE, editing, draftType, () => "minted");
    expect((prepared.draft as { tasks: { id: unknown }[] }).tasks[0]!.id).toEqual(variant("missing", null));
});
