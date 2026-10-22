/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { IntegerType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceConfigType, RecordSliceStateType, RecordSliceChoiceType, RecordSliceController, type RecordSliceBinding } from "@elaraai/east-ui/internal";

const Config = RecordSliceConfigType;
const config = decodeBeast2For(Config)(encodeBeast2For(Config)({
    fields: [
        { fieldId: "status", label: "Status", kind: "string", optional: false, multiple: true, set: false, values: [
            { value: '"held"', label: "Held" }, { value: '"late"', label: "Late" },
        ], format: none },
        { fieldId: "due", label: "Due", kind: "integer", optional: true, multiple: true, set: false, values: [{ value: ".none", label: "Unset" }], format: none },
    ],
    indexes: [{ name: "by_status_due", fields: ["status", "due"], sets: new Set(), structured: true, interval: none, area: none }],
    range: some("due"), search: ["status"], presets: [],
}));
const Row = StructType({ status: StringType, due: OptionType(IntegerType) });
const values = (...v: string[]) => variant("values", v);
function state(): ValueTypeOf<RecordSliceStateType> {
    return decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({
        where: new Map<string, ValueTypeOf<RecordSliceChoiceType>>([
            ["status", values('"held"', '"late"')],
            ["due", variant("range", { from: ".some 10", to: ".some 20" })],
        ]), preset: none, resolution: none,
    }));
}

// Two trillion-entry runs, almost all unset. A boundary query must jump over
// the unset range; iterating entries would never complete this fixture.
function fixture() {
    const size = 1_000_000_000_000n;
    const pages: { offset: bigint; limit: bigint }[] = [];
    let pending = false;
    let failed = false;
    let revision = "A";
    const binding: RecordSliceBinding = {
        id: "huge", recordId: "huge", defaultIndex: "primary", revision: () => some(revision), refresh: () => null,
        total: () => some(2n * size), entryKeys: () => [],
        seek(_index, query) {
            if (failed) throw new Error("offline");
            if (pending) return none;
            assert.equal(query.type, "fields");
            const fields = query.type === "fields" ? query.value.values : [];
            const offset = fields[0] === '"held"' ? 0n : size;
            return some({ found: true, row: offset, count: fields.length === 2 ? size - 2n : size });
        },
        page(_index, offset, limit) {
            pages.push({ offset, limit });
            if (failed) throw new Error("offline");
            if (pending) return none;
            assert.equal(limit, 1n);
            const late = offset >= size;
            const at = offset % size;
            const due = at === size - 2n ? some(late ? 2n : 4n) : at === size - 1n ? some(late ? 100n : 80n) : none;
            return some([{ ik: variant("by_status_due", { status: late ? "late" : "held", due }) }]);
        },
    };
    let current = state();
    const controller = new RecordSliceController(binding, config, Row, () => current, next => { current = next; });
    return { controller, pages, pending(value: boolean) { pending = value; }, failed(value: boolean) { failed = value; }, move() { revision = "B"; } };
}

test("range extent uses at most three boundary entries per run, skipping unset without reading records", () => {
    const { controller, pages } = fixture();
    assert.deepEqual(controller.domain("due"), some({ from: ".some 2", to: ".some 100" }));
    assert.equal(pages.length, 6);
    assert.ok(pages.every(page => page.limit === 1n));
    assert.equal(controller.readState().where.get("due")?.type, "range", "measuring the horizon never changes the narrowing");
});

test("extent never returns a partial result during loading, propagates failures, and retries after a revision", () => {
    const service = fixture();
    service.pending(true);
    assert.deepEqual(service.controller.domain("due"), none);
    assert.equal(service.pages.length, 0, "boundary pages wait for exact runs");
    service.pending(false);
    service.failed(true);
    assert.throws(() => service.controller.domain("due"), /offline/);
    service.failed(false);
    service.move();
    assert.deepEqual(service.controller.domain("due"), some({ from: ".some 2", to: ".some 100" }));
    service.controller.choose("status", undefined);
    assert.deepEqual(service.controller.domain("due"), none, "a trailing range needs its leading choices");
});

test("chip counts describe the exact state a toggle will apply, including clearing the final value", () => {
    const { controller } = fixture();
    controller.choose("due", undefined);
    assert.deepEqual(controller.values("status").map(choice => choice.count), [some(1_000_000_000_000n), some(1_000_000_000_000n)]);
    controller.choose("status", values('"held"'));
    assert.deepEqual(controller.values("status").map(choice => choice.count), [some(2_000_000_000_000n), some(2_000_000_000_000n)]);
    controller.choose("status", values('"held"', '"late"'));
    assert.equal(controller.count().value, 2_000_000_000_000n);
});
