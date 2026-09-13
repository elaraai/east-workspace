/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, IntegerType, StringType, StructType, none, some } from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { buildRowSource, resolveRowSource } from "../../src/contracts/source.js";

const Row = StructType({ id: StringType, nested: ArrayType(IntegerType) });
const Rows = ArrayType(Row);
const Source = Paged.Types.Source(Rows);

const capture = East.function([Rows], Source, (_$, rows) => Paged.of("snapshot", rows));

test("Paged.of detaches nested mutable input and refuses an unrelated revision", () => {
    const input = [{ id: "a", nested: [1n] }];
    const source = East.compile(capture, [])(input);
    input[0]!.nested.push(2n);
    input.push({ id: "b", nested: [] });
    assert.deepEqual(source.page(0n, 10n), some([{ id: "a", nested: [1n] }]));
    assert.deepEqual(source.total(), some(1n));
    assert.deepEqual(source.revision(), some("snapshot"));
    source.refresh(none);
    source.refresh(some("snapshot"));
    assert.throws(() => source.refresh(some("other")), /immutable snapshot/);
    assert.deepEqual(source.revision(), some("snapshot"));
});

test("mapped row sources forward lifecycle methods with their original closure", () => {
    const program = East.function([Rows], Paged.Types.RowSource(Rows), ($, rows) => {
        const source = $.let(Paged.of("snapshot", rows));
        return buildRowSource(resolveRowSource(source, "fixture"), Rows, r => r as never, "mapped");
    });
    const value = East.compile(program, [])([{ id: "a", nested: [1n] }]);
    assert.equal(value.type, "paged");
    if (value.type !== "paged") return;
    assert.equal(value.value.id, "snapshot#mapped");
    assert.deepEqual(value.value.revision(), some("snapshot"));
    assert.throws(() => value.value.refresh(some("other")), /immutable snapshot/);
});

test("a legacy producer normalizes to read-only lifecycle without inventing a revision", () => {
    const program = East.function([Rows], Paged.Types.RowSource(Rows), ($, rows) => {
        const current = $.let(Paged.of("legacy", rows));
        const legacy = $.let({ id: current.id, page: current.page, total: current.total, seek: current.seek });
        return buildRowSource(resolveRowSource(legacy, "fixture"), Rows, r => r as never);
    });
    const value = East.compile(program, [])([]);
    assert.equal(value.type, "paged");
    if (value.type !== "paged") return;
    assert.deepEqual(value.value.revision(), none);
    assert.throws(() => value.value.refresh(none), /legacy source cannot refresh/);
    assert.deepEqual(value.value.page(0n, 10n), some([]));
});
