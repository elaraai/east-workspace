/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, East, IntegerType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Sheet } from "@elaraai/east-ui/internal";

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
