/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What a record Slice's entry holds of its row (D29, east-workspace#1772): the
 * row its read joined, else the whole row its index carries, else none.
 */

import { describe, expect, test } from "vitest";
import { none, some, variant } from "@elaraai/east";
import type { RecordSliceEntry } from "@elaraai/east-ui/internal";
import { entryRow } from "./entry-row.js";

/** Two rows, as a read decodes them: what an entry joins, and what an index carries. */
const JOINED = { name: "Big orders", sources: new Set(["orders"]) };
const CARRIED = { name: "Customer count", sources: new Set(["customers"]) };
/** An entry of an index's, its key and its tagged index key. */
const entry = (held: Pick<RecordSliceEntry, "row" | "value">): RecordSliceEntry => ({ ik: variant("queries_by_name", "big"), key: "big", ...held });

describe("an entry's row (D29)", () => {
    test("the row its read joined, before the row its index carries", () => {
        expect(entryRow(entry({ row: some(JOINED) }))).toBe(JOINED);
        expect(entryRow(entry({ row: some(JOINED), value: some(CARRIED) }))).toBe(JOINED);
    });

    test("the row its index carries, where its read joined none: a page that reads one such entry draws its row", () => {
        expect(entryRow(entry({ value: some(CARRIED) }))).toBe(CARRIED);
        expect(entryRow(entry({ row: none, value: some(CARRIED) }))).toBe(CARRIED);
    });

    test("none, for an entry that carries no row", () => {
        expect([entryRow(entry({})), entryRow(entry({ row: none, value: none }))]).toEqual([undefined, undefined]);
    });
});
