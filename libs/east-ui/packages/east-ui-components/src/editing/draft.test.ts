/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * How a draft presents (#879) — an entry's, or one child row of a group —
 * in the words of the surface that shows it.
 */

import { expect, test } from "vitest";
import { ArrayType, DictType, FloatType, IntegerType, SortedMap, StringType, StructType, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { Editing } from "@elaraai/east-ui/internal";
import { fieldBreachIssue, fieldBreaches } from "../forms/field-form/index.js";
import { boundedReadiness, conflictMarks, kindOfIssue, liftDraft, presentDraft, raiseIssue, type BatchReadiness } from "./draft.js";
import { EntryMerger } from "./merge.js";
import { DRAFT_ISSUE_TEXT } from "./messages.js";

const Row = StructType({ id: StringType, qty: IntegerType });
const Draft = Editing.Types.Draft(Row);
const Group = StructType({ id: StringType, rows: ArrayType(Row) });
const GroupDraft = Editing.Types.DraftGroup(Group, "rows");
/** The surface's words: every issue marked, so a text that bypassed them shows. */
const text = (message: string) => `⟦${message}`;

test("an entry's own issues show by field, in the surface's words; a new draft is discardable while the session can take it", () => {
    const current = { id: variant("value", "n"), qty: variant("missing", null) };
    const fresh = presentDraft({ type: Draft, current, before: undefined, entry: "n", writable: true, text });
    expect(fresh).toMatchObject({ pending: true, incomplete: true, invalid: false, discardable: true });
    expect(fresh.issues.get("qty")).toBe(`⟦${DRAFT_ISSUE_TEXT.required}`);
    expect(presentDraft({ type: Draft, current, before: undefined, entry: "n", writable: false, text }).discardable).toBe(false);
    const applied = liftDraft(Draft, { id: "a", qty: 1n });
    const unchanged = presentDraft({ type: Draft, current: applied, before: applied, entry: "a", writable: true, text });
    expect(unchanged).toMatchObject({ pending: false, incomplete: false, invalid: false, discardable: false });
});

test("a batch issue addressed to a child row shows on that row alone, and an author's refusal makes it invalid", () => {
    const group = liftDraft(GroupDraft, { id: "g", rows: [{ id: "r0", qty: 1n }, { id: "r1", qty: 2n }] }) as { rows: unknown[] };
    const readiness: BatchReadiness = variant("invalid", [{ entry: "g", row: some(1n), field: some("qty"), message: "Too many" }]);
    const second = presentDraft({ type: Draft, current: group.rows[1], before: group.rows[1], entry: "g", row: 1, readiness, writable: true, text });
    expect(second).toMatchObject({ invalid: true, incomplete: false });
    expect(second.issues.get("qty")).toBe("⟦Too many");
    const first = presentDraft({ type: Draft, current: group.rows[0], before: group.rows[0], entry: "g", row: 0, readiness, writable: true, text });
    expect(first).toMatchObject({ invalid: false, incomplete: false });
    expect(first.issues.size).toBe(0);
    // The entry's own presentation takes only the entry's issues — not a child row's.
    const whole = presentDraft({ type: GroupDraft, current: group, before: group, entry: "g", readiness: variant("incomplete", [{ entry: "g", row: none, field: some("id"), message: "Name it" }]), writable: true, text });
    expect(whole.issues.get("id")).toBe("⟦Name it");
});

test("each draft is marked for its OWN issues' kind — an incomplete entry stays incomplete beside an invalid one (#880)", () => {
    const a = liftDraft(Draft, { id: "a", qty: 1n });
    const b = liftDraft(Draft, { id: "b", qty: 2n });
    // One batch, one kind on the wire — but each issue raised with its own.
    const readiness: BatchReadiness = variant("invalid", [
        raiseIssue("invalid", { entry: "a", row: none, field: some("qty"), message: "Refused" }),
        raiseIssue("incomplete", { entry: "b", row: none, field: some("qty"), message: "Needs review" }),
    ]);
    expect(presentDraft({ type: Draft, current: a, before: a, entry: "a", readiness, writable: true, text })).toMatchObject({ invalid: true, incomplete: false });
    expect(presentDraft({ type: Draft, current: b, before: b, entry: "b", readiness, writable: true, text })).toMatchObject({ invalid: false, incomplete: true });
    // An issue raised without a kind — a host's, read back — takes its batch's.
    const hosts: BatchReadiness = variant("invalid", [{ entry: "b", row: none, field: some("qty"), message: "Refused upstream" }]);
    expect(presentDraft({ type: Draft, current: b, before: b, entry: "b", readiness: hosts, writable: true, text })).toMatchObject({ invalid: true });
});

test("a conflict marks the field it is in, and says where in it: a keyed map's key as East prints it, none for the field whole — and a child row's, that row's alone", () => {
    const Person = StructType({ name: StringType, crew: DictType(StringType, FloatType) });
    const PersonDraft = Editing.Types.Draft(Person);
    const crew = (hours: [string, number][]) => new SortedMap(hours, compareFor(StringType));
    const person = (value: ValueTypeOf<typeof Person>) => some(liftDraft(PersonDraft, value));
    // Both sides changed the name, and crew a's hours; crew b's they left.
    const was = person({ name: "A. Morgan", crew: crew([["a", 1], ["b", 2]]) });
    const ours = person({ name: "A. Morgan, lead", crew: crew([["a", 5], ["b", 2]]) });
    const theirs = person({ name: "A. Morgan, nights", crew: crew([["a", 6], ["b", 2]]) });
    const marks = conflictMarks(new EntryMerger(PersonDraft).merge(was, ours, theirs).points, PersonDraft);
    expect(marks).toEqual({ fields: new Set(["name", "crew"]), within: new Map([["name", [[]]], ["crew", [[{ kind: "key", key: '"a"' }]]]]), whole: false });
    // A group's second row's quantity, changed on both sides: that row's mark, and none on the first.
    const group = (qty: bigint) => some(liftDraft(GroupDraft, { id: "g", rows: [{ id: "r0", qty: 1n }, { id: "r1", qty }] }));
    const lines = new EntryMerger(GroupDraft).merge(group(2n), group(3n), group(4n)).points;
    expect(conflictMarks(lines, GroupDraft, { field: "rows", index: 1 })).toEqual({ fields: new Set(["qty"]), within: new Map([["qty", [[]]]]), whole: false });
    expect(conflictMarks(lines, GroupDraft, { field: "rows", index: 0 })).toBeUndefined();
});

test("a changed entry's number its bounds don't hold waits as a field still missing does, naming the entry and the field in the hint's words — never one drafted back to what it began from, nor a field not given yet (#1585)", () => {
    const specs = Fields.specs(Row, { qty: Fields.number({ min: 1n, max: 9n }) });
    const draft = (id: string, qty: bigint | undefined) => ({ id: variant("value", id), qty: qty === undefined ? variant("missing", null) : variant("value", qty) });
    const originals = new Map([["a", { draft: draft("a", 1n) }], ["b", { draft: draft("b", 0n) }]]);
    const breaches = (id: string, held: unknown) => fieldBreaches(specs, held).map((breach) => fieldBreachIssue(breach, { entry: id }));
    const ready = boundedReadiness(Draft, breaches, () => originals);
    // A: 1 drafted to 0. B: stored at 0 and drafted back to it. C: new, its quantity not given yet. D: new, at 10.
    const entries = new Map([["a", { draft: draft("a", 0n) }], ["b", { draft: draft("b", 0n) }], ["c", { draft: draft("c", undefined) }], ["d", { draft: draft("d", 10n) }]]);
    const readiness = ready(entries);
    expect(readiness.type).toBe("incomplete");
    const issues = readiness.type === "ready" ? [] : readiness.value;
    expect(issues.map((issue) => [issue.entry, issue.field, issue.message])).toEqual([["a", some("qty"), "at least 1"], ["d", some("qty"), "at most 9"]]);
    expect(issues.map((issue) => kindOfIssue(issue, readiness as Exclude<BatchReadiness, { type: "ready" }>))).toEqual(["incomplete", "incomplete"]);
    // Beside the builder's own refusal, the batch is the refusal's kind and holds both.
    const refused = boundedReadiness(Draft, breaches, () => originals, () => variant("invalid", [raiseIssue("invalid", { entry: "b", row: none, field: none, message: "Refused" })]));
    const both = refused(entries);
    expect([both.type, both.type === "ready" ? 0 : both.value.length]).toEqual(["invalid", 3]);
});
