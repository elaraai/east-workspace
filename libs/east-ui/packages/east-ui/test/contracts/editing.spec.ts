/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, DictType, East, FunctionType, IntegerType, OptionType, StringType, StructType,
    decodeBeast2For, diffFor, encodeBeast2For, equalFor, isTypeEqual, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, describeEast, TestImpl } from "@elaraai/east-node-std";
import {
    Editing, EditingPatchEventTypeWith, EditingSessionFields, EditingToDraftResultTypeFor, EditingWireToDraftType, buildWireToDraft,
} from "@elaraai/east-ui/internal";
import * as ex from "./editing.examples.js";

describeEast("Editing contract examples", test => {
    Assert.examples(test, {
        editingApplyBatch: ex.editingApplyBatch,
        editingApplyKeyed: ex.editingApplyKeyed,
        editingApplyEntries: ex.editingApplyEntries,
    });
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
const glue: JobValue = { task: "Glue", qty: 1n, tags: [] };
const spray: JobValue = { task: "Spray", qty: 4n, tags: ["new"] };
const jobs = (): Map<string, JobValue> => new Map([["a", structuredClone(cut)], ["c", structuredClone(glue)]]);
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
        { id: "b", patch: diff(none, some(spray)), place: keyOrder },
        { id: "c", patch: diff(some(glue), none), place: none },
    ]), none);
    assertApplied(StringType, result, variant("applied", new Map([["a", { ...cut, qty: 3n }], ["b", spray]])));
    if (result.type !== "applied") return;
    result.value.get("a")!.tags.push("output only");
    assert.deepEqual(source.get("a")!.tags, ["keep"]);
    assert.deepEqual([...source.keys()], ["a", "c"]);
});

test("a stale base conflicts before any patch — a changed snapshot, a missing or another revision", () => {
    const edit = [{ id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none }];
    const moved = new Map([["a", cut], ["c", { ...glue, qty: 9n }]]);
    assert.equal(apply(moved, batch(edit), none).type, "conflict");
    const pinned = batch(edit, variant("revision", "r1"));
    assert.equal(apply(jobs(), pinned, none).type, "conflict");
    assert.equal(apply(jobs(), pinned, some("r2")).type, "conflict");
    assert.equal(apply(jobs(), pinned, some("r1")).type, "applied");
});

test("placement is keyOrder: a new entry without it, or any entry with an ordered position, is refused", () => {
    const unplaced = apply(jobs(), batch([{ id: "b", patch: diff(none, some(spray)), place: none }]), none);
    assert.equal(unplaced.type, "conflict");
    assert.match(issueOf(unplaced)!.message, /explicit placement/);
    const positioned = apply(jobs(), batch([{ id: "b", patch: diff(none, some(spray)), place: ordered }]), none);
    assert.match(issueOf(positioned)!.message, /keyOrder/);
    const moved = apply(jobs(), batch([{ id: "a", patch: diff(some(cut), some(cut)), place: ordered }]), none);
    assert.match(issueOf(moved)!.message, /keyOrder/);
    // An existing entry may restate its key order.
    assert.equal(apply(jobs(), batch([{ id: "a", patch: diff(some(cut), some({ ...cut, qty: 5n })), place: keyOrder }]), none).type, "applied");
});

test("a removal carries no placement, and a batch composes each entry once", () => {
    const placed = apply(jobs(), batch([{ id: "c", patch: diff(some(glue), none), place: keyOrder }]), none);
    assert.match(issueOf(placed)!.message, /removed entry/);
    const change = { id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none };
    assert.match(issueOf(apply(jobs(), batch([change, change]), none))!.message, /Compose each entry/);
});

test("a late conflict rolls back every earlier change, and names the entry it arose at", () => {
    const source = jobs();
    const result = apply(source, batch([
        { id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none },
        { id: "b", patch: diff(none, some(spray)), place: none },
    ]), none);
    assert.equal(result.type, "conflict");
    assert.equal(issueOf(result)!.entry, "b");
    assert.deepEqual(source, jobs());
});

test("a key of another type is addressed by its .east text, parsed back", () => {
    const ByNumber = DictType(IntegerType, Job);
    const run = East.compile(Editing.apply(ByNumber), []);
    const source = new Map([[2n, cut], [7n, glue]]);
    const request = (changes: BatchValue["changes"]) => ({
        requestId: "numbered", base: variant("snapshot", source), label: "Edit numbered jobs", changes,
    });
    const result = run(source, request([
        { id: "2", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none },
        { id: "5", patch: diff(none, some(spray)), place: keyOrder },
    ]), none);
    assertApplied(IntegerType, result, variant("applied", new Map([[2n, { ...cut, qty: 3n }], [5n, spray], [7n, glue]])));
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

// e3-ui's Sheet speaks this contract under its own names, held to it in its
// own specs (`test/sheet/sheet-source.spec.ts`).

test("a patch event is one shape over any draft — field by field for the Sheet, whole entries for the Plan (#880)", () => {
    // PatchEvent(E) is PatchEventWith over E's field-by-field draft…
    assert.ok(isTypeEqual(Editing.Types.PatchEvent(Job), EditingPatchEventTypeWith(Job, Editing.Types.Draft(Job))));
    // …and a whole-entry draft changes only what the draft changes carry.
    const whole = EditingPatchEventTypeWith(Job, Editing.Types.DraftField(Job));
    assert.ok(isTypeEqual(whole.fields.draftChanges, ArrayType(Editing.Types.Change(Editing.Types.DraftField(Job)))));
    assert.ok(isTypeEqual(whole.fields.domainChanges, Editing.Types.PatchEvent(Job).fields.domainChanges));
    assert.ok(isTypeEqual(whole.fields.readiness, Editing.Types.PatchEvent(Job).fields.readiness));
});

// ── A batch handed over as a draft of the source's write (#1620) ─────────────

test("a session's fields carry toDraft beside onApply: the batch's bytes in, and out the draft's, no change, or the refusal a Save meets before it writes", () => {
    assert.ok(isTypeEqual(EditingSessionFields.toDraft, OptionType(EditingWireToDraftType)));
    assert.ok(isTypeEqual(EditingWireToDraftType, FunctionType([BlobType], EditingToDraftResultTypeFor(BlobType))));
    const answer = EditingToDraftResultTypeFor(StringType);
    assert.deepEqual(Object.keys(answer.cases).sort(), ["conflict", "draft", "rejected", "unchanged"]);
    assert.ok(isTypeEqual(answer.cases.draft, StringType), "the draft is the source's own");
    assert.ok(isTypeEqual(answer.cases.rejected, Editing.Types.ApplyResult.cases.rejected), "refused in a Save's issues");
    assert.ok(isTypeEqual(answer.cases.conflict, Editing.Types.ApplyResult.cases.conflict));
});

test("buildWireToDraft reads the batch at its type and answers the draft at the source's own; no change and a refusal cross as they are", () => {
    // A source whose draft is a line of text: how many entries the batch changes, under its label.
    const Answer = EditingToDraftResultTypeFor(StringType);
    const wire = East.compile(East.function([], EditingWireToDraftType, (_$) => buildWireToDraft(_Batch, East.function([_Batch], Answer, ($, asked) => {
        const answer = $.let(variant("unchanged", null), Answer);
        $.if(asked.changes.size().greater(0n), ($) => {
            $.assign(answer, variant("draft", East.str`${asked.label}: ${East.print(asked.changes.size())}`));
        });
        $.if(asked.label.equal("Refused"), ($) => {
            $.assign(answer, variant("rejected", [{ entry: "", row: none, field: none, message: "Not as asked" }]));
        });
        $.if(asked.label.equal("Moved"), ($) => {
            $.assign(answer, variant("conflict", [{ entry: "a", row: none, field: none, message: "Changed since this edit began" }]));
        });
        return answer;
    }))), [])();
    const encode = encodeBeast2For(_Batch);
    const same = equalFor(EditingToDraftResultTypeFor(BlobType));
    const edit: BatchValue["changes"] = [{ id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none }];

    const drafted = wire(encode(batch(edit)));
    if (drafted.type !== "draft") assert.fail(`expected a draft, got ${drafted.type}`);
    assert.equal(decodeBeast2For(StringType)(drafted.value), "Edit jobs: 1", "the draft's bytes, at the source's draft type");
    assert.ok(same(wire(encode(batch([]))), variant("unchanged", null)));
    assert.ok(same(wire(encode({ ...batch(edit), label: "Refused" })), variant("rejected", [{ entry: "", row: none, field: none, message: "Not as asked" }])));
    assert.ok(same(wire(encode({ ...batch(edit), label: "Moved" })), variant("conflict", [{ entry: "a", row: none, field: none, message: "Changed since this edit began" }])));
});

test("buildWireToDraft refuses a function that is not its batch's draft: another batch's, or one that answers anything else", () => {
    const refusal = /a session's toDraft must be an East function of its batch, answering the draft of the source's write or why there is none/;
    const Answer = EditingToDraftResultTypeFor(StringType);
    const unkeyed = East.function([Editing.Types.ChangeSet(Job)], Answer, (_$, _asked) => East.value(variant("unchanged", null), Answer));
    assert.throws(() => buildWireToDraft(_Batch, unkeyed), refusal);
    const saved = East.function([_Batch], Editing.Types.ApplyResult, (_$, _asked) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));
    assert.throws(() => buildWireToDraft(_Batch, saved), refusal);
    assert.throws(() => buildWireToDraft(_Batch, East.value("a draft", StringType)), refusal);
});

test("an origin names every gesture of every collection — the Plan's resize, drop and verdict among them, a run of the app's optimiser (#1409), a conflict chosen, and a Sheet action column's step (#1480)", () => {
    assert.deepEqual(Object.keys(Editing.Types.Origin.cases).sort(), [
        "action", "discard", "drop", "fill", "insert", "move", "optimise", "pasted", "pattern", "redo", "remove", "resize", "row", "settle", "typed", "undo", "verdict",
    ]);
});
