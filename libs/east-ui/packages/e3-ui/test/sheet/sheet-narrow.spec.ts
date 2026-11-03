/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet on a phone (`Mobile Sheet Spec.md` §9, ruled 3 Nov 2026):
 * `narrow` names a column a phone pins at the left — none unless it names
 * one — and how many columns its window shows at once; a pin that is no
 * column, and a count outside 1 to 3, are refused as the root is built.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Sheet } from "@elaraai/e3-ui/internal";
import { ArrayType, East, StringType, StructType, IntegerType } from "@elaraai/east";

const JobType = StructType({ id: StringType, task: StringType, count: IntegerType });
const rows = East.value([{ id: "a", task: "Routing", count: 2n }], ArrayType(JobType));
const columns = { task: Sheet.column.text(JobType), count: Sheet.column.integer(JobType) };

describe("Sheet narrow", () => {
    test("a pin that names a column, and a count of 1 to 3, build", () => {
        assert.doesNotThrow(() => Sheet.Root(rows, columns, { id: "id", narrow: { pin: "task", columns: 1 } }));
        assert.doesNotThrow(() => Sheet.Root(rows, columns, { id: "id", narrow: { columns: 3 } }));
        assert.doesNotThrow(() => Sheet.Root(rows, columns, { id: "id" }));
    });

    test("a pin that is no column is refused, naming the columns", () => {
        assert.throws(() => Sheet.Root(rows, columns, { id: "id", narrow: { pin: "owner" as never } }), /`narrow\.pin` names "owner", which is not a column \(task, count\)/);
    });

    test("a count outside 1 to 3 is refused", () => {
        assert.throws(() => Sheet.Root(rows, columns, { id: "id", narrow: { columns: 4 as never } }), /`narrow\.columns`.*1 to 3/);
    });
});
