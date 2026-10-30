/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * One entry's three-way merge (merge.ts): a draft carried over to the value
 * its source holds now — what combines, what conflicts, and what each choice
 * leaves — over real drafts of a row with text, a number, a keyed map and a
 * choice.
 */

import { describe, test, expect } from "vitest";
import { DictType, FloatType, NullType, SortedMap, StringType, StructType, VariantType, compareFor, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { EditingDraftTypeFor } from "@elaraai/east-ui/internal";
import { liftDraft } from "./draft.js";
import { EntryMerger, conflictSteps } from "./merge.js";

const Row = StructType({
    name: StringType,
    hours: FloatType,
    crew: DictType(StringType, FloatType),
    status: VariantType({ running: NullType, down: StringType }),
});
const Draft = EditingDraftTypeFor(Row);
type RowValue = ValueTypeOf<typeof Row>;
/** A crew's hours, keyed by crew. */
const crewOf = (hours: [string, number][]) => new SortedMap(hours, compareFor(StringType));

const merger = new EntryMerger(Draft);
const row = (patch: Partial<RowValue> = {}): RowValue => ({
    name: "Works 10012", hours: 442, crew: crewOf([["a", 1], ["b", 2]]), status: variant("running", null), ...patch,
});
const draft = (value: RowValue): option<unknown> => some(liftDraft(Draft, value));

describe("one entry's three-way merge", () => {
    test("changes of different parts combine: the source's value with the draft's change, and no conflict", () => {
        const merged = merger.merge(draft(row()), draft(row({ hours: 500 })), draft(row({ name: "Works 10013" })));
        expect(merged.points).toEqual([]);
        expect(merged.ancestor).toBeUndefined();
        expect(merger.equal(merged.draft, draft(row({ name: "Works 10013", hours: 500 })))).toBe(true);
    });

    test("the same change on both sides combines into it: the draft carried over is the source's value", () => {
        const merged = merger.merge(draft(row()), draft(row({ hours: 500 })), draft(row({ hours: 500 })));
        expect(merged.points).toEqual([]);
        expect(merger.equal(merged.draft, draft(row({ hours: 500 })))).toBe(true);
    });

    test("a part both changed differently conflicts: the draft keeps its value, and what both began from is rewound there alone", () => {
        const was = draft(row());
        const source = draft(row({ hours: 450, name: "Works 10013" }));
        const merged = merger.merge(was, draft(row({ hours: 500 })), source);
        expect(merged.points.map((p) => [p.kind, conflictSteps(Draft, p.at)])).toEqual([["changed", [{ kind: "field", name: "hours" }]]]);
        expect(merger.equal(merged.draft, draft(row({ hours: 500, name: "Works 10013" })))).toBe(true);
        // The source's value, the hours put back to 442: the name it changed stands.
        expect(merger.equal(merged.ancestor!, draft(row({ hours: 442, name: "Works 10013" })))).toBe(true);
        // Read again from the three values, the conflicts are the same.
        expect(merger.conflicts(merged.ancestor!, merged.draft, source).map((p) => p.path)).toEqual(merged.points.map((p) => p.path));
    });

    test("a keyed map merges key by key: different keys combine, one key changed differently conflicts at that key", () => {
        const was = draft(row());
        const apart = merger.merge(was, draft(row({ crew: crewOf([["a", 5], ["b", 2]]) })), draft(row({ crew: crewOf([["a", 1], ["b", 7]]) })));
        expect(apart.points).toEqual([]);
        expect(merger.equal(apart.draft, draft(row({ crew: crewOf([["a", 5], ["b", 7]]) })))).toBe(true);
        const clash = merger.merge(was, draft(row({ crew: crewOf([["a", 5], ["b", 2]]) })), draft(row({ crew: crewOf([["a", 6], ["b", 2]]) })));
        expect(clash.points.map((p) => conflictSteps(Draft, p.at))).toEqual([[{ kind: "field", name: "crew" }, { kind: "key", key: '"a"' }]]);
    });

    test("a choice changed to another case conflicts with a change of its own case's value", () => {
        const was = draft(row({ status: variant("down", "pump") }));
        const merged = merger.merge(was, draft(row({ status: variant("down", "valve") })), draft(row({ status: variant("running", null) })));
        expect(merged.points.map((p) => p.kind)).toEqual(["changed"]);
        expect(conflictSteps(Draft, merged.points[0]!.at)[0]).toEqual({ kind: "field", name: "status" });
    });

    test("an entry the source removed while the draft changed it conflicts at the entry itself", () => {
        const merged = merger.merge(draft(row()), draft(row({ hours: 500 })), none);
        expect(merged.points.map((p) => [p.kind, p.at])).toEqual([["removed-by-source", []]]);
        expect(merger.equal(merged.draft, draft(row({ hours: 500 })))).toBe(true);
    });

    test("an entry the draft removed while the source changed it conflicts at the entry itself", () => {
        const merged = merger.merge(draft(row()), none, draft(row({ hours: 450 })));
        expect(merged.points.map((p) => p.kind)).toEqual(["removed-by-draft"]);
        expect(merged.draft.type).toBe("none");
    });

    test("an entry both added differently conflicts at the entry itself", () => {
        const merged = merger.merge(none, draft(row({ hours: 1 })), draft(row({ hours: 2 })));
        expect(merged.points.map((p) => p.kind)).toEqual(["added-by-both"]);
    });

    test("taking the source's value at a conflict writes it into the draft, and the conflict reads no more", () => {
        const source = draft(row({ hours: 450 }));
        const merged = merger.merge(draft(row()), draft(row({ hours: 500, name: "Mine" })), source);
        const taken = merger.takeSource(merged.draft, source, merged.points[0]!.path);
        expect(merger.equal(taken, draft(row({ hours: 450, name: "Mine" })))).toBe(true);
        expect(merger.conflicts(merged.ancestor!, taken, source)).toEqual([]);
    });

    test("keeping the draft's value moves what both began from to the source's there, and the conflict reads no more", () => {
        const source = draft(row({ hours: 450 }));
        const merged = merger.merge(draft(row()), draft(row({ hours: 500 })), source);
        const was = merger.keepDraft(merged.ancestor!, source, merged.points[0]!.path);
        expect(merger.conflicts(was, merged.draft, source)).toEqual([]);
        expect(merger.equal(was, source)).toBe(true);
    });

    test("a later change of the source's to another part is no conflict: carried over again, only the first conflict stands", () => {
        const first = draft(row({ hours: 450, name: "Works 10013" }));
        const merged = merger.merge(draft(row()), draft(row({ hours: 500 })), first);
        const later = draft(row({ hours: 450, name: "Works 10014", crew: crewOf([["a", 9], ["b", 2]]) }));
        const again = merger.merge(merged.ancestor!, merged.draft, later);
        expect(again.points.map((p) => conflictSteps(Draft, p.at))).toEqual([[{ kind: "field", name: "hours" }]]);
        expect(merger.equal(again.draft, draft(row({ hours: 500, name: "Works 10014", crew: crewOf([["a", 9], ["b", 2]]) })))).toBe(true);
    });
});
