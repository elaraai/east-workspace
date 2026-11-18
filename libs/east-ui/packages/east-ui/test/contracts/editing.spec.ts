/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, AsyncFunctionType, BlobType, DictType, East, Expr, FunctionType, IntegerType, NullType, OptionType, StringType, StructType,
    decodeBeast2For, diffFor, encodeBeast2For, equalFor, isTypeEqual, none, printFor, some, variant, walkIR,
    type EastType, type ExprType, type IR, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, describeEast, TestImpl } from "@elaraai/east-node-std";
import {
    Editing, EditingPatchEventTypeWith, EditingSaveTypeFor, EditingSessionFields, EditingToDraftResultTypeFor, EditingWireApplyType, EditingWireToDraftType,
    buildWireApply, buildWireObserver, buildWireToDraft, checkedEditingCallback, withEditingSave,
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

// ── A session's doors over a batch's bytes: its Save, its draft form, its observers ──

/** A restatement of the session's batch as a Save may take it in other words: here, its label alone. */
const labelOf = East.function([_Batch], StringType, (_$, asked) => asked.label);
/** An edit of one entry, as a session's batch carries it. */
const oneEdit = (): BatchValue => batch([{ id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none }]);
const sameResult = equalFor(Editing.Types.ApplyResult);

test("buildWireApply hands the batch's bytes to the Save, sync or async as the Save is", async () => {
    const answered = (asked: ExprType<typeof _Batch>) => variant("applied", { revision: some(asked.label) });
    const syncSave = East.function([_Batch], Editing.Types.ApplyResult, (_$, asked) => answered(asked));
    const asyncSave = East.asyncFunction([_Batch], Editing.Types.ApplyResult, (_$, asked) => answered(asked));
    const bytes = encodeBeast2For(_Batch)(oneEdit());

    const syncWire = East.compile(East.function([], EditingWireApplyType, (_$) => buildWireApply(_Batch, syncSave)), [])();
    if (syncWire.type !== "sync") assert.fail("a sync Save is applied synchronously");
    assert.ok(sameResult(syncWire.value(bytes), variant("applied", { revision: some("Edit jobs") })), "the batch the bytes carry, as the Save is handed it");

    const asyncWire = East.compile(East.function([], EditingWireApplyType, (_$) => buildWireApply(_Batch, asyncSave)), [])();
    if (asyncWire.type !== "async") assert.fail("an async Save is awaited");
    assert.ok(sameResult(await asyncWire.value(bytes), variant("applied", { revision: some("Edit jobs") })));
});

test("buildWireApply restates the batch first where the Save takes it in other words", () => {
    const byLabel = East.function([StringType], Editing.Types.ApplyResult, (_$, label) => variant("applied", { revision: some(label) }));
    const wire = East.compile(East.function([], EditingWireApplyType, (_$) => buildWireApply(_Batch, byLabel, labelOf)), [])();
    if (wire.type !== "sync") assert.fail("a sync Save is applied synchronously");
    assert.ok(sameResult(wire.value(encodeBeast2For(_Batch)({ ...oneEdit(), label: "Restated" })), variant("applied", { revision: some("Restated") })));
});

test("buildWireApply refuses a Save of another batch than it is handed, one that answers anything else, and a restatement of another batch", () => {
    const refusal = /a session's Save must be an East function of the batch it takes, sync or async, answering Editing.Types.ApplyResult/;
    const answer = variant("applied", { revision: none });
    const unkeyed = East.function([Editing.Types.ChangeSet(Job)], Editing.Types.ApplyResult, (_$, _asked) => answer);
    assert.throws(() => buildWireApply(_Batch, unkeyed), refusal);
    const byLabel = East.function([StringType], Editing.Types.ApplyResult, (_$, _label) => answer);
    assert.throws(() => buildWireApply(_Batch, byLabel), refusal, "a Save of the restated batch, handed the batch as it is");
    const drafted = East.function([_Batch], Drafted, (_$, asked) => variant("draft", asked.label));
    assert.throws(() => buildWireApply(_Batch, drafted), refusal);
    const ofAnother = East.function([Editing.Types.ChangeSet(Job)], StringType, (_$, asked) => asked.label);
    assert.throws(() => buildWireApply(_Batch, byLabel, ofAnother), /a session's restatement must be an East function of its batch/);
});

test("buildWireToDraft restates the batch first where its draft form takes it in other words, as its Save does", () => {
    const byLabel = East.function([StringType], Drafted, (_$, label) => variant("draft", label));
    const wire = East.compile(East.function([], EditingWireToDraftType, (_$) => buildWireToDraft(_Batch, byLabel, labelOf)), [])();
    const drafted = wire(encodeBeast2For(_Batch)({ ...oneEdit(), label: "Restated" }));
    if (drafted.type !== "draft") assert.fail(`expected a draft, got ${drafted.type}`);
    assert.equal(decodeBeast2For(StringType)(drafted.value), "Restated");
    assert.throws(() => buildWireToDraft(_Batch, byLabel), /a session's toDraft must be an East function of its batch/,
        "a draft form of the restated batch, handed the batch as it is");
});

test("buildWireObserver hands the event's bytes to the observer, and refuses one that hears another event or answers anything", () => {
    // The observer is heard through what it throws: it names the event it was handed.
    const heard = East.function([_Batch], NullType, ($, asked) => { $.error(East.str`heard ${asked.label}`); });
    const hear = East.compile(East.function([], FunctionType([BlobType], NullType), (_$) => buildWireObserver(_Batch, heard)), [])();
    assert.throws(() => hear(encodeBeast2For(_Batch)(oneEdit())), /heard Edit jobs/);
    const refusal = /a session's observer must be an East function of the event it hears, returning Null/;
    assert.throws(() => buildWireObserver(Editing.Types.ChangeSet(Job), heard), refusal);
    assert.throws(() => buildWireObserver(_Batch, labelOf), refusal);
});

test("checkedEditingCallback holds a callback to its signature as East compares types, and names the prop as the author writes it", () => {
    // A batch type built again is the same type to East: a callback over it is the collection's.
    const again = East.function([Editing.Types.ChangeSet(Job, StringType)], NullType, (_$, _asked) => null);
    assert.equal(checkedEditingCallback("Sheet", again, [_Batch], NullType, "onPatch", false, "over this sheet's batch"), again);
    assert.throws(() => checkedEditingCallback("Sheet", again, [Editing.Types.ChangeSet(Job)], NullType, "onPatch", false, "over this sheet's batch"),
        /^Error: Sheet: onPatch must be an East function over this sheet's batch$/);
    assert.throws(() => checkedEditingCallback("Plan", labelOf, [_Batch], NullType, "editing.onApply", true, "over its batch"),
        /Plan: editing.onApply must be an East sync or async function over its batch/);
});

// ── A Save that carries its draft form (#1620) ───────────────────────────────

/** A source whose draft is a line of text. */
const Drafted = EditingToDraftResultTypeFor(StringType);
const Save = EditingSaveTypeFor(_Batch, StringType);
type SaveFunction = ExprType<AsyncFunctionType<[typeof _Batch], typeof Editing.Types.ApplyResult>>;
/** A session as a collection builds one over its `onApply`: its Save, which two of its functions call, and its draft form. */
const Session = StructType({
    save: AsyncFunctionType([_Batch], Editing.Types.ApplyResult),
    again: AsyncFunctionType([_Batch], Editing.Types.ApplyResult),
    draft: OptionType(FunctionType([_Batch], Drafted)),
});
/** Builds that session from the apply and the draft form `withEditingSave` hands a collection. */
const buildSession = (apply: ExprType<EastType> | undefined, toDraft: ExprType<EastType> | undefined): ExprType<typeof Session> => East.value({
    save: East.asyncFunction([_Batch], Editing.Types.ApplyResult, ($, asked) => {
        const commit = $.const(apply as SaveFunction);
        return commit(asked);
    }),
    again: East.asyncFunction([_Batch], Editing.Types.ApplyResult, ($, asked) => {
        const commit = $.const(apply as SaveFunction);
        return commit(asked);
    }),
    draft: toDraft === undefined ? none : some(toDraft),
} as never, Session);
/** What marks the Save's own code in a program: its apply answers under it. */
const SAVED_AS = "saved by the source";
/** How many times a program writes out a String literal. */
function literals(ir: IR, text: string): number {
    let count = 0;
    walkIR(ir, (node) => {
        if (node.type === "Value" && node.value.value.type === "String" && node.value.value.value === text) count++;
    });
    return count;
}

test("a Save that carries its draft form is one struct: the write, awaited, and the same batch as a draft of it", () => {
    assert.ok(isTypeEqual(Save, StructType({
        apply: AsyncFunctionType([_Batch], Editing.Types.ApplyResult),
        toDraft: FunctionType([_Batch], Drafted),
    })));
});

test("withEditingSave builds a session over a Save from its apply and its draft form, the Save made once however many of the session's functions call it", async () => {
    const program = East.function([], Session, (_$) => {
        // A Save as a source makes one: built where it is asked for, as e3-ui's Record.onApply builds a record's.
        const made = East.function([], Save, (_$2) => ({
            apply: East.asyncFunction([_Batch], Editing.Types.ApplyResult, (_$3, _asked) => variant("applied", { revision: some(SAVED_AS) })),
            toDraft: East.function([_Batch], Drafted, (_$3, asked) => variant("draft", asked.label)),
        }));
        return withEditingSave(made(), Session, buildSession);
    });
    assert.equal(literals(program.toIR().ir, SAVED_AS), 1, "the Save is written out once: bound where the session is made");
    const session = East.compile(program, [])();
    const edit = batch([{ id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none }]);
    const applied = variant("applied", { revision: some(SAVED_AS) });
    assert.ok(equalFor(Editing.Types.ApplyResult)(await session.save(edit), applied));
    assert.ok(equalFor(Editing.Types.ApplyResult)(await session.again(edit), applied));
    if (session.draft.type !== "some") assert.fail("a Save's session carries its draft form");
    assert.ok(equalFor(Drafted)(session.draft.value(edit), variant("draft", "Edit jobs")));
});

test("withEditingSave hands a function on as it is, with no draft form, and builds the session with no block of its own; with no onApply it hands on none", async () => {
    const own = East.asyncFunction([_Batch], Editing.Types.ApplyResult, (_$, asked) => variant("applied", { revision: some(asked.requestId) }));
    const seen: [unknown, unknown][] = [];
    const returned: ExprType<typeof Session>[] = [];
    const spied = (apply: ExprType<EastType> | undefined, toDraft: ExprType<EastType> | undefined) => {
        seen.push([apply, toDraft]);
        returned.push(buildSession(apply, toDraft));
        return returned[0]!;
    };
    const built = withEditingSave(own, Session, spied);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]![0], own, "the function itself");
    assert.equal(seen[0]![1], undefined, "and no draft form");
    assert.equal(built, returned[0], "the session as it was built: no block of its own");
    const session = East.compile(East.function([], Session, (_$) => withEditingSave(own, Session, buildSession)), [])();
    assert.equal(session.draft.type, "none", "a Save of the host's own carries no draft form");
    const edit = batch([{ id: "a", patch: diff(some(cut), some({ ...cut, qty: 3n })), place: none }]);
    assert.ok(equalFor(Editing.Types.ApplyResult)(await session.save(edit), variant("applied", { revision: some("keyed-request") })));
    // With no onApply the collection builds its session with neither.
    const none_: [unknown, unknown][] = [];
    withEditingSave(undefined, NullType, (apply, toDraft) => {
        none_.push([apply, toDraft]);
        return East.value(null);
    });
    assert.deepEqual(none_, [[undefined, undefined]]);
});

test("withEditingSave hands a struct that is no Save on as it is, for the collection to refuse in its own words", () => {
    const handed: (EastType | undefined)[] = [];
    const spied = (apply: ExprType<EastType> | undefined, toDraft: ExprType<EastType> | undefined) => {
        handed.push(apply === undefined ? undefined : Expr.type(apply as unknown as Expr) as EastType, toDraft === undefined ? undefined : Expr.type(toDraft as unknown as Expr) as EastType);
        return East.value(null);
    };
    const Half = StructType({ apply: AsyncFunctionType([_Batch], Editing.Types.ApplyResult) });
    const More = StructType({ ...Save.fields, label: StringType });
    East.function([Half, More], NullType, (_$, half, more) => {
        withEditingSave(half, NullType, spied);
        withEditingSave(more, NullType, spied);
        return null;
    });
    assert.equal(handed.length, 4);
    assert.ok(isTypeEqual(handed[0]!, Half) && handed[1] === undefined, "a struct of an apply alone");
    assert.ok(isTypeEqual(handed[2]!, More) && handed[3] === undefined, "a struct of more than the two");
});

test("an origin names every gesture of every collection — the Plan's resize, drop and verdict among them, a run of the app's optimiser (#1409), a conflict chosen, and a Sheet action column's step (#1480)", () => {
    assert.deepEqual(Object.keys(Editing.Types.Origin.cases).sort(), [
        "action", "discard", "drop", "fill", "insert", "move", "optimise", "pasted", "pattern", "redo", "remove", "resize", "row", "settle", "typed", "undo", "verdict",
    ]);
});
