/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, IntegerType, OptionType, StringType, StructType, VariantType, diffFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Assert, describeEast, TestImpl } from "@elaraai/east-node-std";
import { Sheet } from "@elaraai/east-ui/internal";
import * as ex from "./sheet-transactions.examples.js";

describeEast("Sheet atomic batch examples", test => {
    Assert.examples(test, { sheetApplyBatch: ex.sheetApplyBatch, sheetApplyEntries: ex.sheetApplyEntries });
}, { platformFns: TestImpl });

const Row = StructType({ id: StringType, qty: IntegerType, hidden: ArrayType(StringType) });
const _Batch = Sheet.Types.ChangeSet(Row);
const apply = East.compile(Sheet.apply(Row, "id"), []);
const diff = diffFor(OptionType(Row));
const a = { id: "a", qty: 1n, hidden: ["keep"] };
const b = { id: "b", qty: 2n, hidden: ["other"] };
const c = { id: "c", qty: 3n, hidden: [] };
type BatchValue = ValueTypeOf<typeof _Batch>;
const batch = (changes: BatchValue["changes"], base: BatchValue["base"] = variant("snapshot", [a, b])): BatchValue => ({
    requestId: "test-request", base, label: "Edit rows", changes,
});
const ordered = (position: ValueTypeOf<typeof Sheet.Types.Position>) => some(variant("ordered", position));

test("patches preserve hidden fields and leave the input detached", () => {
    const updated = { ...a, qty: 9n };
    const result = apply([a, b], batch([{ id: "a", patch: diff(some(a), some(updated)), place: none }]), none);
    assert.deepEqual(result, variant("applied", [updated, b]));
    if (result.type !== "applied") return;
    result.value[0]!.hidden.push("output only");
    assert.deepEqual(a.hidden, ["keep"]);
});
test("an unrelated hidden-field change conflicts before applying any patch", () => {
    const result = apply([a, { ...b, hidden: ["changed"] }], batch([{ id: "a", patch: diff(some(a), some({ ...a, qty: 9n })), place: none }]), none);
    assert.equal(result.type, "conflict");
});
test("a revision base requires the exact authoritative revision", () => {
    const request = batch([], variant("revision", "r1"));
    assert.equal(apply([a, b], request, none).type, "conflict");
    assert.equal(apply([a, b], request, some("r2")).type, "conflict");
    assert.deepEqual(apply([a, b], request, some("r1")), variant("applied", [a, b]));
});
test("a late patch conflict rolls back every earlier change", () => {
    const rows = structuredClone([a, b]);
    const result = apply(rows, batch([
        { id: "a", patch: diff(some(a), some({ ...a, hidden: ["new"] })), place: none },
        { id: "b", patch: diff(some({ ...b, qty: 99n }), none), place: none },
    ]), none);
    assert.equal(result.type, "conflict");
    assert.deepEqual(rows, [a, b]);
});
test("insert, move and delete form one atomic result", () => {
    const result = apply([a, b], batch([
        { id: "c", patch: diff(none, some(c)), place: ordered(variant("before", "a")) },
        { id: "b", patch: diff(some(b), none), place: none },
    ]), none);
    assert.deepEqual(result, variant("applied", [c, a]));
    const moved = apply([a, b], batch([{ id: "b", patch: diff(some(b), some(b)), place: ordered(variant("start", null)) }]), none);
    assert.deepEqual(moved, variant("applied", [b, a]));
});
test("anchors may refer to another new entry in the same batch", () => {
    const d = { ...c, id: "d" };
    const result = apply([a, b], batch([
        { id: "c", patch: diff(none, some(c)), place: ordered(variant("after", "d")) },
        { id: "d", patch: diff(none, some(d)), place: ordered(variant("before", "c")) },
    ]), none);
    assert.deepEqual(result, variant("applied", [a, b, d, c]));
});
test("duplicate source identities, duplicate changes and identity rewrites conflict", () => {
    assert.equal(apply([a, a], batch([], variant("snapshot", [a, a])), none).type, "conflict");
    const change = { id: "a", patch: diff(some(a), some(a)), place: none };
    assert.equal(apply([a, b], batch([change, change]), none).type, "conflict");
    assert.equal(apply([a, b], batch([{ ...change, patch: diff(some(a), some({ ...a, id: "renamed" })) }]), none).type, "conflict");
});
test("missing anchors, self anchors and keyed placement are refused", () => {
    for (const place of [ordered(variant("before", "missing")), ordered(variant("after", "a")), some(variant("keyOrder", null))]) {
        assert.equal(apply([a, b], batch([{ id: "a", patch: diff(some(a), some(a)), place }]), none).type, "conflict");
    }
    assert.equal(apply([a, b], batch([{ id: "c", patch: diff(none, some(c)), place: none }]), none).type, "conflict");
});
test("group variants apply child-array patches under the same checked base", () => {
    const Group = StructType({ id: StringType, rows: ArrayType(Row) });
    const Entry = VariantType({ group: Group, row: Row });
    const run = East.compile(Sheet.apply(Entry, "id"), []);
    const delta = diffFor(OptionType(Entry));
    const before = variant("group", { id: "g", rows: [a, b] });
    const after = variant("group", { id: "g", rows: [b, a] });
    const result = run([before], {
        requestId: "group-move", base: variant("snapshot", [before]), label: "Move child",
        changes: [{ id: "g", patch: delta(some(before), some(after)), place: none }],
    }, none);
    assert.deepEqual(result, variant("applied", [after]));
});
