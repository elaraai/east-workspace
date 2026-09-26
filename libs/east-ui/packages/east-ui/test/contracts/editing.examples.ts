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
            ["c", { task: "Weld", qty: 1n }],
        ]), DictType(StringType, KeyedJob));
        const cut = $.const(some({ task: "Cut", qty: 2n }), OptionType(KeyedJob));
        const cutMore = $.const(some({ task: "Cut", qty: 3n }), OptionType(KeyedJob));
        const weld = $.const(some({ task: "Weld", qty: 1n }), OptionType(KeyedJob));
        const paint = $.const(some({ task: "Paint", qty: 4n }), OptionType(KeyedJob));
        const absent = $.const(none, OptionType(KeyedJob));
        const batch = $.const({
            requestId: "keyed-request", base: variant("snapshot", jobs), label: "Edit jobs",
            changes: [
                { id: "a", patch: East.diff(cut, cutMore), place: none },
                { id: "b", patch: East.diff(absent, paint), place: some(variant("keyOrder", null)) },
                { id: "c", patch: East.diff(weld, absent), place: none },
            ],
        }, Editing.Types.ChangeSet(KeyedJob, StringType));
        const apply = $.const(Editing.apply(DictType(StringType, KeyedJob)));
        return apply(jobs, batch, none).unwrap("applied");
    }),
    inputs: [],
    returns: new Map([
        ["a", { task: "Cut", qty: 3n }],
        ["b", { task: "Paint", qty: 4n }],
    ]),
});
