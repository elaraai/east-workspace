/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, East, IntegerType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Sheet } from "@elaraai/east-ui";

const Job = StructType({ id: StringType, task: StringType, qty: IntegerType });

export const sheetApplyBatch = example({
    keywords: ["Sheet", "apply", "ChangeSet", "patch", "atomic", "snapshot", "batch"],
    description: "Apply an entry patch against the complete inline snapshot",
    fn: East.function([], ArrayType(Job), ($) => {
        const before = $.const({ id: "a", task: "Cut", qty: 2n }, Job);
        const after = $.const({ id: "a", task: "Cut", qty: 3n }, Job);
        const rows = $.const([before], ArrayType(Job));
        const oldEntry = $.const(some(before), OptionType(Job));
        const newEntry = $.const(some(after), OptionType(Job));
        const batch = $.const({
            requestId: "example-request", base: variant("snapshot", rows), label: "Set quantity",
            changes: [{ id: "a", patch: East.diff(oldEntry, newEntry), place: none }],
        }, Sheet.Types.ChangeSet(Job));
        const apply = $.const(Sheet.apply(Job, "id"));
        return apply(rows, batch, none).unwrap("applied");
    }),
    inputs: [],
    returns: [{ id: "a", task: "Cut", qty: 3n }],
});

export const sheetApplyEntries = example({
    keywords: ["Sheet", "Types", "Entry", "group", "row", "child", "variant", "apply", "ChangeSet", "batch", "atomic"],
    description: "Apply a batch to work packages and loose tasks in one collection — Sheet.Types.Entry names the group-or-row union by its child field, and one entry patch reorders a package's tasks",
    fn: East.function([], ArrayType(StringType), ($) => {
        const TaskType = StructType({ id: StringType, task: StringType });
        const PackageType = StructType({ id: StringType, name: StringType, tasks: ArrayType(TaskType) });
        const Entry = Sheet.Types.Entry(PackageType, "tasks");
        const before = $.const(variant("group", { id: "p1", name: "P-40 roughing", tasks: [
            { id: "t1", task: "Machine blanks" }, { id: "t2", task: "Inspect lots" },
        ] }), Entry);
        const after = $.const(variant("group", { id: "p1", name: "P-40 roughing", tasks: [
            { id: "t2", task: "Inspect lots" }, { id: "t1", task: "Machine blanks" },
        ] }), Entry);
        const loose = $.const(variant("row", { id: "t9", task: "Pack for shipping" }), Entry);
        const entries = $.const([before, loose], ArrayType(Entry));
        const oldEntry = $.const(some(before), OptionType(Entry));
        const newEntry = $.const(some(after), OptionType(Entry));
        const batch = $.const({
            requestId: "reorder-roughing", base: variant("snapshot", entries), label: "Move a task",
            changes: [{ id: "p1", patch: East.diff(oldEntry, newEntry), place: none }],
        }, Sheet.Types.ChangeSet(Entry));
        const apply = $.const(Sheet.apply(Entry, "id"));
        const applied = $.const(apply(entries, batch, none).unwrap("applied"));
        return applied.map((_$, entry) => entry.match({
            group: (_$2, p) => East.str`${p.name}: ${p.tasks.map((_$3, t) => t.task).stringJoin(" → ")}`,
            row:   (_$2, t) => t.task,
        }));
    }),
    inputs: [],
    returns: ["P-40 roughing: Inspect lots → Machine blanks", "Pack for shipping"],
});
