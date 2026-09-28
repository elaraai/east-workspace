/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DictType, East, IntegerType, OptionType, StringType, StructType, diffFor, equalFor, isTypeEqual, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Assert, describeEast, TestImpl } from "@elaraai/east-node-std";
import { Editing, EditingPatchEventTypeWith, EditingSessionFields, Plan, Sheet, SheetEditingType } from "@elaraai/east-ui/internal";
import * as ex from "./editing.examples.js";

describeEast("Editing contract examples", test => {
    Assert.examples(test, { editingApplyBatch: ex.editingApplyBatch, editingApplyKeyed: ex.editingApplyKeyed });
}, { platformFns: TestImpl });

// ── A keyed Dict source (#879) — entries addressed by key ────────────────────

const Job = StructType({ task: StringType, qty: IntegerType, tags: ArrayType(StringType) });
const Jobs = DictType(StringType, Job);
const _Batch = Editing.Types.ChangeSet(Job, StringType);
type BatchValue = ValueTypeOf<typeof _Batch>;
type JobValue = ValueTypeOf<typeof Job>;
const apply = East.compile(Editing.apply(Jobs), []);
const diff = diffFor(OptionType(Job));
const cut: JobValue = { task: "Cut", qty: 2n, tags: ["keep"] };
const weld: JobValue = { task: "Weld", qty: 1n, tags: [] };
const paint: JobValue = { task: "Paint", qty: 4n, tags: ["new"] };
const jobs = (): Map<string, JobValue> => new Map([["a", structuredClone(cut)], ["c", structuredClone(weld)]]);
const batch = (changes: BatchValue["changes"], base: BatchValue["base"] = variant("snapshot", jobs())): BatchValue => ({
    requestId: "keyed-request", base, label: "Edit jobs", changes,
});
const keyOrder = some(variant("keyOrder", null));
const ordered = some(variant("ordered", variant("start", null)));
const issueOf = (result: ReturnType<typeof apply>) => (result.type === "conflict" ? result.value[0] : undefined);
/** A result is compared as East compares it — a compiled Dict comes back as East's own sorted map. */
function assertApplied<K extends typeof StringType | typeof IntegerType>(keyType: K, actual: unknown, expected: unknown): void {
    const type = Editing.Types.Applied(Job, keyType);
    assert.ok(equalFor(type)(actual as never, expected as never), `applied ${printFor(type)(actual as never)}`);
}

test("a keyed batch updates, inserts in key order and removes, as one result — the input left detached", () => {
    const source = jobs();
    const result = apply(source, batch([
        { id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none },
        { id: "b", patch: diff(none, some(paint)), place: keyOrder },
        { id: "c", patch: diff(some(weld), none), place: none },
    ]), none);
    assertApplied(StringType, result, variant("applied", new Map([["a", { ...cut, qty: 3n }], ["b", paint]])));
    if (result.type !== "applied") return;
    result.value.get("a")!.tags.push("output only");
    assert.deepEqual(source.get("a")!.tags, ["keep"]);
    assert.deepEqual([...source.keys()], ["a", "c"]);
});

test("a stale base conflicts before any patch — a changed snapshot, a missing or another revision", () => {
    const edit = [{ id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none }];
    const moved = new Map([["a", cut], ["c", { ...weld, qty: 9n }]]);
    assert.equal(apply(moved, batch(edit), none).type, "conflict");
    const pinned = batch(edit, variant("revision", "r1"));
    assert.equal(apply(jobs(), pinned, none).type, "conflict");
    assert.equal(apply(jobs(), pinned, some("r2")).type, "conflict");
    assert.equal(apply(jobs(), pinned, some("r1")).type, "applied");
});

test("placement is keyOrder: a new entry without it, or any entry with an ordered position, is refused", () => {
    const unplaced = apply(jobs(), batch([{ id: "b", patch: diff(none, some(paint)), place: none }]), none);
    assert.equal(unplaced.type, "conflict");
    assert.match(issueOf(unplaced)!.message, /explicit placement/);
    const positioned = apply(jobs(), batch([{ id: "b", patch: diff(none, some(paint)), place: ordered }]), none);
    assert.match(issueOf(positioned)!.message, /keyOrder/);
    const moved = apply(jobs(), batch([{ id: "a", patch: diff(some(cut), some(cut)), place: ordered }]), none);
    assert.match(issueOf(moved)!.message, /keyOrder/);
    // An existing entry may restate its key order.
    assert.equal(apply(jobs(), batch([{ id: "a", patch: diff(some(cut), some({ ...cut, qty: 5n })), place: keyOrder }]), none).type, "applied");
});

test("a removal carries no placement, and a batch composes each entry once", () => {
    const placed = apply(jobs(), batch([{ id: "c", patch: diff(some(weld), none), place: keyOrder }]), none);
    assert.match(issueOf(placed)!.message, /removed entry/);
    const change = { id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none };
    assert.match(issueOf(apply(jobs(), batch([change, change]), none))!.message, /Compose each entry/);
});

test("a late conflict rolls back every earlier change, and names the entry it arose at", () => {
    const source = jobs();
    const result = apply(source, batch([
        { id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none },
        { id: "b", patch: diff(none, some(paint)), place: none },
    ]), none);
    assert.equal(result.type, "conflict");
    assert.equal(issueOf(result)!.entry, "b");
    assert.deepEqual(source, jobs());
});

test("a key of another type is addressed by its .east text, parsed back", () => {
    const ByNumber = DictType(IntegerType, Job);
    const run = East.compile(Editing.apply(ByNumber), []);
    const source = new Map([[2n, cut], [7n, weld]]);
    const request = (changes: BatchValue["changes"]) => ({
        requestId: "numbered", base: variant("snapshot", source), label: "Edit numbered jobs", changes,
    });
    const result = run(source, request([
        { id: "2", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none },
        { id: "5", patch: diff(none, some(paint)), place: keyOrder },
    ]), none);
    assertApplied(IntegerType, result, variant("applied", new Map([[2n, { ...cut, qty: 3n }], [5n, paint], [7n, weld]])));
    const unreadable = run(source, request([{ id: "two", patch: diff(some(cut), some(cut)), place: none }]), none);
    assert.equal(unreadable.type, "conflict");
    if (unreadable.type === "conflict") assert.equal(unreadable.value[0]!.entry, "two");
});

test("the keyed types hold a Dict; an Array source needs its identity field", () => {
    assert.equal(Editing.Types.Base(Job, StringType).cases.snapshot.type, "Dict");
    assert.equal(Editing.Types.Base(Job).cases.snapshot.type, "Array");
    assert.equal(Editing.Types.Applied(Job, IntegerType).cases.applied.type, "Dict");
    assert.throws(() => (Editing.apply as (t: unknown) => unknown)(Job), /identity field/);
});

// ── The Sheet speaks the shared contract ─────────────────────────────────────

test("the Sheet's transaction names are the shared contract's own values", () => {
    assert.equal(Sheet.apply, Editing.apply);
    const shared: Record<string, keyof typeof Editing.Types> = {
        Entry: "Entry", DraftGroup: "DraftGroup", DraftEntry: "DraftEntry", DraftChange: "DraftChange",
        PatchEvent: "PatchEvent", Position: "Position", EntryPlacement: "Placement", FieldIssue: "FieldIssue",
        Readiness: "Readiness", Issue: "Issue", BatchReadiness: "BatchReadiness", Origin: "Origin",
        ApplyResult: "ApplyResult", Draft: "Draft", Base: "Base", Change: "Change", ChangeSet: "ChangeSet",
        Applied: "Applied",
    };
    for (const [sheetName, editingName] of Object.entries(shared)) {
        assert.equal((Sheet.Types as Record<string, unknown>)[sheetName], Editing.Types[editingName], `Sheet.Types.${sheetName}`);
    }
    // The Sheet's editing wire carries every field of the shared session's, at the same type.
    for (const [field, type] of Object.entries(EditingSessionFields)) {
        assert.equal(SheetEditingType.fields[field as keyof typeof SheetEditingType.fields], type, `SheetEditingType.${field}`);
    }
});

test("the Plan's editing wire carries every field of the shared session's, at the same type (#880)", () => {
    for (const [field, type] of Object.entries(EditingSessionFields)) {
        assert.equal(Plan.Types.Editing.fields[field as keyof typeof Plan.Types.Editing.fields], type, `Plan.Types.Editing.${field}`);
    }
});

test("a patch event is one shape over any draft — field by field for the Sheet, whole entries for the Plan (#880)", () => {
    // PatchEvent(E) is PatchEventWith over E's field-by-field draft…
    assert.ok(isTypeEqual(Editing.Types.PatchEvent(Job), EditingPatchEventTypeWith(Job, Editing.Types.Draft(Job))));
    // …and a whole-entry draft changes only what the draft changes carry.
    const whole = EditingPatchEventTypeWith(Job, Editing.Types.DraftField(Job));
    assert.ok(isTypeEqual(whole.fields.draftChanges, ArrayType(Editing.Types.Change(Editing.Types.DraftField(Job)))));
    assert.ok(isTypeEqual(whole.fields.domainChanges, Editing.Types.PatchEvent(Job).fields.domainChanges));
    assert.ok(isTypeEqual(whole.fields.readiness, Editing.Types.PatchEvent(Job).fields.readiness));
});

test("an origin names every gesture of every collection — the Plan's resize, drop and verdict among them", () => {
    assert.deepEqual(Object.keys(Editing.Types.Origin.cases).sort(), [
        "discard", "drop", "fill", "insert", "move", "pasted", "pattern", "redo", "remove", "resize", "row", "typed", "undo", "verdict",
    ]);
});
