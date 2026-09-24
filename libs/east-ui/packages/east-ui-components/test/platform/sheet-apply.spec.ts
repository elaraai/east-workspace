/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, IntegerType, NullType, OptionType, StringType, StructType, diffFor, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { Sheet, State, UIComponentType, buildInlineApply } from "@elaraai/east-ui/internal";
import { StateImpl, initializeStore } from "../../src/platform/state-runtime.js";
import { UIStore } from "../../src/platform/state-store.js";

const Row = StructType({ id: StringType, qty: IntegerType });
const Rows = ArrayType(Row);
const read = East.platform("sheet_test_read", [], Rows);
const write = East.platform("sheet_test_write", [Rows], NullType);
const reader = East.function([], Rows, () => read());
const writer = East.function([Rows], NullType, ($, rows) => { $(write(rows)); });
const adapter = buildInlineApply(Row, "id", East.value("test-binding"), reader, writer);
const before = [{ id: "a", qty: 1n }];
const after = [{ id: "a", qty: 2n }];
const encode = encodeBeast2For(Sheet.Types.ChangeSet(Row));
const request = {
    requestId: "request-a", base: variant("snapshot", before), label: "Edit quantity",
    changes: [{ id: "a", patch: diffFor(OptionType(Row))(some(before[0]!), some(after[0]!)), place: none }],
};
const payload = encode(request);

test("inline apply reads the latest collection and writes once for an entire batch", () => {
    initializeStore(new UIStore());
    let current = structuredClone(before);
    let writes = 0;
    const apply = East.compile(adapter, [...StateImpl,
        read.implement(() => current), write.implement(rows => { writes++; current = rows; return null; }),
    ]);
    current = [{ id: "a", qty: 9n }];
    assert.equal(apply(payload).type, "conflict");
    assert.equal(writes, 0);
    current = structuredClone(before);
    // Confirmed failure retains its original result, even if the source changes.
    assert.equal(apply(payload).type, "conflict");
    assert.equal(apply(encode({ ...request, requestId: "request-b" })).type, "applied");
    assert.equal(writes, 1);
    assert.deepEqual(current, after);
});

test("confirmed replay precedes the base check and survives remount and render garbage collection", () => {
    const store = new UIStore(); initializeStore(store);
    let current = structuredClone(before);
    let writes = 0;
    const platform = [...StateImpl, read.implement(() => current), write.implement(rows => { writes++; current = rows; return null; })];
    const apply = East.compile(adapter, platform);
    assert.equal(apply(payload).type, "applied");
    store.beginRender(); store.endRender(); store.beginRender(); store.endRender();
    const remounted = East.compile(adapter, platform);
    assert.equal(remounted(payload).type, "applied");
    assert.equal(writes, 1);
    assert.equal(remounted(encode({ ...request, label: "Different bytes" })).type, "conflict");
    assert.equal(writes, 1);
});

test("an uncertain successful write is recovered by exact target without writing twice", () => {
    initializeStore(new UIStore());
    let current = structuredClone(before);
    let writes = 0;
    const apply = East.compile(adapter, [...StateImpl,
        read.implement(() => current), write.implement(rows => { writes++; current = rows; throw new Error("lost acknowledgement"); }),
    ]);
    assert.throws(() => apply(payload), /lost acknowledgement/);
    assert.equal(apply(payload).type, "applied");
    assert.equal(writes, 1);
});

test("unknown outcome prevents a second batch and unrelated source values cannot acknowledge it", () => {
    initializeStore(new UIStore());
    let current = structuredClone(before);
    let writes = 0;
    const apply = East.compile(adapter, [...StateImpl,
        read.implement(() => current), write.implement(() => { writes++; throw new Error("connection lost"); }),
    ]);
    assert.throws(() => apply(payload), /connection lost/);
    assert.throws(() => apply(payload), /unknown outcome/);
    current = [{ id: "a", qty: 99n }];
    assert.throws(() => apply(payload), /unknown outcome/);
    assert.throws(() => apply(encode({ ...request, requestId: "other" })), /unresolved write/);
    assert.equal(writes, 1);
    current = structuredClone(after);
    assert.equal(apply(payload).type, "applied");
    assert.equal(writes, 1);
});


test("an interpreted Sheet callback returns the original confirmed result on replay", async () => {
    initializeStore(new UIStore());
    const render = East.function([], UIComponentType, ($) => {
        const data = $.const(State.bind([Rows], "interpreted-replay", before));
        return Sheet.Root(data, { qty: Sheet.column.integer(Row) }, { id: "id", onUpdate: data.write });
    }).toIR().compile(StateImpl);
    const component = render();
    if (component.type !== "Sheet" || component.value.editing.onApply.type !== "some") throw new Error("Expected a bound Sheet");
    const apply = component.value.editing.onApply.value.value;
    assert.equal((await apply(payload)).type, "applied");
    assert.equal((await apply(payload)).type, "applied");
    assert.equal((await apply(encode({ ...request, label: "Altered bytes" }))).type, "conflict");
});
