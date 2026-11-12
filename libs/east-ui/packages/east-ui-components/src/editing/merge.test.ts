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

    test("what both began from, read again, is what a carry-over kept while each of its conflicts still reads", () => {
        const source = draft(row({ hours: 450, name: "Works 10013" }));
        const mine = draft(row({ hours: 500, name: "Mine" }));
        const merged = merger.merge(draft(row()), mine, source);
        expect(merged.points.length).toBe(2);
        expect(merger.equal(merger.began(merged.ancestor!, merged.draft, source), merged.ancestor!)).toBe(true);
    });

    test("a conflict the draft has left by hand — put at the source's value, no choice made — began from the source's value: a later change of the source's there is no conflict", () => {
        const source = draft(row({ hours: 450, name: "Works 10013" }));
        const merged = merger.merge(draft(row()), draft(row({ hours: 500, name: "Mine" })), source);
        // The hours typed to the source's own: the name's conflict still reads, the hours' no more.
        const byHand = draft(row({ hours: 450, name: "Mine" }));
        const began = merger.began(merged.ancestor!, byHand, source);
        expect(merger.equal(began, draft(row({ hours: 450, name: "Works 10012" })))).toBe(true);
        // Carried over again from there, the source's next change of the hours is the source's to make.
        const later = draft(row({ hours: 460, name: "Works 10013" }));
        const again = merger.merge(began, byHand, later);
        expect(again.points.map((p) => conflictSteps(Draft, p.at))).toEqual([[{ kind: "field", name: "name" }]]);
        expect(merger.equal(again.draft, draft(row({ hours: 460, name: "Mine" })))).toBe(true);
        // From what the carry-over kept — the hours put back to 442 — the same change would ask again, of no change of the draft's.
        expect(merger.merge(merged.ancestor!, byHand, later).points.map((p) => conflictSteps(Draft, p.at)))
            .toEqual([[{ kind: "field", name: "name" }], [{ kind: "field", name: "hours" }]]);
    });

    test("a draft removed by hand, as its source removed it, began from no entry: the source's new one is no conflict", () => {
        const merged = merger.merge(draft(row()), draft(row({ hours: 500 })), none);
        expect(merged.points.map((p) => p.kind)).toEqual(["removed-by-source"]);
        const began = merger.began(merged.ancestor!, none, none);
        expect(began.type).toBe("none");
        const added = draft(row({ hours: 7 }));
        expect(merger.merge(began, none, added).points).toEqual([]);
    });
});

describe("what both began from, where a request that changed the entry may or may not have landed", () => {
    // The request set the hours from 442 to 500. It was sent, no answer came, and sent again it was refused — which says
    // nothing of its first sending. What the source holds of the entry is all there is to judge it by.
    const before = draft(row());
    const sent = draft(row({ hours: 500 }));
    /** The draft carried over from what `eitherBegan` says both began from. */
    const carried = (mine: option<unknown>, source: option<unknown>) => merger.merge(merger.eitherBegan(before, sent, mine, source), mine, source);

    test("held as the request left it, it began from what was sent: a change put back since is a change from that, and nothing is asked", () => {
        expect(merger.equal(merger.eitherBegan(before, sent, before, sent), sent)).toBe(true);
        const merged = carried(before, sent);
        expect(merged.points).toEqual([]);
        expect(merger.equal(merged.draft, before)).toBe(true);
    });

    test("held as the request left it, a draft still as it was sent is no draft: the source's value holds it whole", () => {
        const merged = carried(sent, sent);
        expect([merged.points, merger.equal(merged.draft, sent)]).toEqual([[], true]);
    });

    test("held as the edit began, it began from that: the request did not land there, and the draft is its change still", () => {
        expect(merger.equal(merger.eitherBegan(before, sent, sent, before), before)).toBe(true);
        const merged = carried(sent, before);
        expect([merged.points, merger.equal(merged.draft, sent)]).toEqual([[], true]);
        // Changed again since, to another value: still one plain change, of a part no other write has touched.
        const again = carried(draft(row({ hours: 510 })), before);
        expect([again.points, merger.equal(again.draft, draft(row({ hours: 510 })))]).toEqual([[], true]);
    });

    test("held as neither, a draft still as it was sent is asked of: an unsaved change against another write's, where the request never landed", () => {
        const theirs = draft(row({ hours: 470 }));
        const merged = carried(sent, theirs);
        expect(merged.points.map((point) => point.kind)).toEqual(["changed"]);
        expect(merger.equal(merged.draft, sent)).toBe(true);
    });

    test("held as neither, a draft put back since is asked of too, never given up for the other write: an Undo of a saved change, where the request had landed", () => {
        const theirs = draft(row({ hours: 470 }));
        expect(merger.equal(merger.eitherBegan(before, sent, before, theirs), sent)).toBe(true);
        const merged = carried(before, theirs);
        expect(merged.points.map((point) => point.kind)).toEqual(["changed"]);
        expect(merger.equal(merged.draft, before)).toBe(true);
    });

    test("each part is judged on its own: one the source holds as sent and one it holds as the edit began, in one entry", () => {
        const both = draft(row({ hours: 500, name: "Works 10013" }));
        // The name landed; the hours did not, and its person has since put them at 510.
        const source = draft(row({ name: "Works 10013" }));
        const mine = draft(row({ hours: 510, name: "Works 10013" }));
        const began = merger.eitherBegan(before, both, mine, source);
        expect(merger.equal(began, source)).toBe(true);
        const merged = merger.merge(began, mine, source);
        expect([merged.points, merger.equal(merged.draft, mine)]).toEqual([[], true]);
    });

    test("a part the request left alone began as the edit did, whatever the source holds there", () => {
        const source = draft(row({ hours: 500, name: "Works 10099" }));
        const merged = carried(sent, source);
        // The hours are the source's, as sent; the name is another write's, taken with nothing asked.
        expect([merged.points, merger.equal(merged.draft, source)]).toEqual([[], true]);
    });

    test("a new entry held as the request left it began from what was sent: a field changed since is a change of that entry", () => {
        const made = draft(row({ name: "Works 20001" }));
        const mine = draft(row({ name: "Works 20001", hours: 12 }));
        expect(merger.equal(merger.eitherBegan(none, made, mine, made), made)).toBe(true);
        const merged = merger.merge(merger.eitherBegan(none, made, mine, made), mine, made);
        expect([merged.points, merger.equal(merged.draft, mine)]).toEqual([[], true]);
    });

    test("a new entry the source holds otherwise began from none, though a field of the draft has changed since: two entries under one key, a conflict of the whole — never one merged a part at a time", () => {
        const made = draft(row({ name: "Works 20001" }));
        const mine = draft(row({ name: "Works 20001", hours: 12 }));
        const theirs = draft(row({ name: "Works 30007", hours: 90 }));
        expect(merger.eitherBegan(none, made, mine, theirs)).toEqual(none);
        const merged = merger.merge(merger.eitherBegan(none, made, mine, theirs), mine, theirs);
        expect(merged.points.map((point) => point.kind)).toEqual(["added-by-both"]);
        expect(merger.equal(merged.draft, mine)).toBe(true);
    });

    test("an entry the request removed, gone from the source, began from none: put back since, it is the draft's to add, and nothing is asked", () => {
        expect(merger.eitherBegan(before, none, before, none)).toEqual(none);
        const merged = merger.merge(merger.eitherBegan(before, none, before, none), before, none);
        expect([merged.points, merger.equal(merged.draft, before)]).toEqual([[], true]);
    });

    test("an entry the request removed that the source still holds, changed by another write, began as the edit did: removed here and changed there, a conflict of the whole", () => {
        const theirs = draft(row({ hours: 470 }));
        expect(merger.equal(merger.eitherBegan(before, none, none, theirs), before)).toBe(true);
        const merged = merger.merge(merger.eitherBegan(before, none, none, theirs), none, theirs);
        expect(merged.points.map((point) => point.kind)).toEqual(["removed-by-draft"]);
    });
});
