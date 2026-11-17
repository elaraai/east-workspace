/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Group and total step groups by (#1670), as every edit sets it — a
 * field picked, a field added, one taken out, a check's fix: none chosen, one
 * field, or several in their order, one replaced in its place.
 */

import { describe, expect, it } from "vitest";
import { OptionType, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { QueryGroupByType } from "@elaraai/e3-ui/internal";
import { groupFields, groupedBy, withGroupField, type GroupBy } from "./values.js";

const GroupByType = OptionType(QueryGroupByType);
const sameBy = equalFor(GroupByType);
const printBy = printFor(GroupByType);

const field = (ref: string): GroupBy => some(variant("field", ref)) as GroupBy;
const fields = (...refs: string[]): GroupBy => some(variant("fields", refs)) as GroupBy;
const ALL: GroupBy = some(variant("all", null)) as GroupBy;

/** Expects what a step groups by, saying both as East prints them. */
function expectBy(actual: GroupBy, expected: GroupBy): void {
    expect(sameBy(actual, expected), `${printBy(actual)} is not ${printBy(expected)}`).toBe(true);
}

describe("groupedBy", () => {
    it("groups by nothing chosen for no fields, the field for one, and the fields in order for several", () => {
        expectBy(groupedBy([]), none);
        expectBy(groupedBy(["region"]), field("region"));
        expectBy(groupedBy(["region", "status", "customer_id"]), fields("region", "status", "customer_id"));
    });

    it("gives back the fields it was given, as groupFields reads them", () => {
        for (const refs of [[], ["region"], ["region", "status"], ["a", "b", "c"]]) expect(groupFields(groupedBy(refs))).toEqual(refs);
        expect(groupFields(ALL)).toEqual([]);
    });
});

describe("withGroupField", () => {
    it("replaces one of several fields in its place, the others kept in their order", () => {
        expectBy(withGroupField(fields("region", "status", "customer_id"), "status", "channel"), fields("region", "channel", "customer_id"));
        expectBy(withGroupField(fields("region", "status"), "region", "channel"), fields("channel", "status"));
    });

    it("groups by the field alone over one field, all rows together, nothing chosen, or several with none named", () => {
        expectBy(withGroupField(field("region"), "region", "channel"), field("channel"));
        expectBy(withGroupField(field("region"), undefined, "channel"), field("channel"));
        expectBy(withGroupField(ALL, undefined, "channel"), field("channel"));
        expectBy(withGroupField(none, undefined, "channel"), field("channel"));
        expectBy(withGroupField(fields("region", "status"), undefined, "channel"), field("channel"));
    });

    it("leaves several fields as they are when the one named is not among them", () => {
        expectBy(withGroupField(fields("region", "status"), "customer_id", "channel"), fields("region", "status"));
    });
});
