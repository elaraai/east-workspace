/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, DictType, East, IntegerType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";

const Job = StructType({ id: StringType, task: StringType, qty: IntegerType });
const KeyedJob = StructType({ task: StringType, qty: IntegerType });

export const editingApplyBatch = example({
    keywords: ["Editing", "apply", "ChangeSet", "patch", "atomic", "snapshot", "batch", "Array", "identity field"],
    description: "Apply a checked batch to an Array source with the shared editing contract — the entry addressed by its identity field",
    fn: East.function([], ArrayType(Job), ($) => {
        const before = $.const({ id: "a", task: "Cut", qty: 2n }, Job);
        const after = $.const({ id: "a", task: "Cut", qty: 3n }, Job);
        const rows = $.const([before], ArrayType(Job));
        const oldEntry = $.const(some(before), OptionType(Job));
        const newEntry = $.const(some(after), OptionType(Job));
        const batch = $.const({
            requestId: "example-request", base: variant("snapshot", rows), label: "Set quantity",
            changes: [{ id: "a", patch: East.diff(oldEntry, newEntry), place: none }],
        }, Editing.Types.ChangeSet(Job));
        const apply = $.const(Editing.apply(Job, "id"));
        return apply(rows, batch, none).unwrap("applied");
    }),
    inputs: [],
    returns: [{ id: "a", task: "Cut", qty: 3n }],
});

export const editingApplyKeyed = example({
    keywords: ["Editing", "apply", "ChangeSet", "Dict", "keyed", "key", "keyOrder", "insert", "update", "remove", "atomic", "batch"],
    description: "Apply a checked batch to a keyed Dict source — entries addressed by key: one updated, one inserted in key order, one removed, as one result",
    fn: East.function([], DictType(StringType, KeyedJob), ($) => {
        const jobs = $.const(new Map([
            ["a", { task: "Cut", qty: 2n }],
            ["c", { task: "Glue", qty: 1n }],
        ]), DictType(StringType, KeyedJob));
        const cut = $.const(some({ task: "Cut", qty: 2n }), OptionType(KeyedJob));
        const cutMore = $.const(some({ task: "Cut", qty: 3n }), OptionType(KeyedJob));
        const glue = $.const(some({ task: "Glue", qty: 1n }), OptionType(KeyedJob));
        const spray = $.const(some({ task: "Spray", qty: 4n }), OptionType(KeyedJob));
        const absent = $.const(none, OptionType(KeyedJob));
        const batch = $.const({
            requestId: "keyed-request", base: variant("snapshot", jobs), label: "Edit jobs",
            changes: [
                { id: "a", patch: East.diff(cut, cutMore), place: none },
                { id: "b", patch: East.diff(absent, spray), place: some(variant("keyOrder", null)) },
                { id: "c", patch: East.diff(glue, absent), place: none },
            ],
        }, Editing.Types.ChangeSet(KeyedJob, StringType));
        const apply = $.const(Editing.apply(DictType(StringType, KeyedJob)));
        return apply(jobs, batch, none).unwrap("applied");
    }),
    inputs: [],
    returns: new Map([
        ["a", { task: "Cut", qty: 3n }],
        ["b", { task: "Spray", qty: 4n }],
    ]),
});

export const editingApplyEntries = example({
    keywords: ["Editing", "Types", "Entry", "group", "row", "child", "variant", "apply", "ChangeSet", "batch", "atomic"],
    description: "Apply a batch to work packages and loose tasks in one collection — Editing.Types.Entry names the group-or-row union by its child field, and one entry patch reorders a package's tasks",
    fn: East.function([], ArrayType(StringType), ($) => {
        const TaskType = StructType({ id: StringType, task: StringType });
        const PackageType = StructType({ id: StringType, name: StringType, tasks: ArrayType(TaskType) });
        const Entry = Editing.Types.Entry(PackageType, "tasks");
        const before = $.const(variant("group", { id: "p1", name: "C-18 nesting", tasks: [
            { id: "t1", task: "Cut panels" }, { id: "t2", task: "Inspect batches" },
        ] }), Entry);
        const after = $.const(variant("group", { id: "p1", name: "C-18 nesting", tasks: [
            { id: "t2", task: "Inspect batches" }, { id: "t1", task: "Cut panels" },
        ] }), Entry);
        const loose = $.const(variant("row", { id: "t9", task: "Pack for delivery" }), Entry);
        const entries = $.const([before, loose], ArrayType(Entry));
        const oldEntry = $.const(some(before), OptionType(Entry));
        const newEntry = $.const(some(after), OptionType(Entry));
        const batch = $.const({
            requestId: "reorder-nesting", base: variant("snapshot", entries), label: "Move a task",
            changes: [{ id: "p1", patch: East.diff(oldEntry, newEntry), place: none }],
        }, Editing.Types.ChangeSet(Entry));
        const apply = $.const(Editing.apply(Entry, "id"));
        const applied = $.const(apply(entries, batch, none).unwrap("applied"));
        return applied.map((_$, entry) => entry.match({
            group: (_$2, p) => East.str`${p.name}: ${p.tasks.map((_$3, t) => t.task).stringJoin(" → ")}`,
            row:   (_$2, t) => t.task,
        }));
    }),
    inputs: [],
    returns: ["C-18 nesting: Inspect batches → Cut panels", "Pack for delivery"],
});
