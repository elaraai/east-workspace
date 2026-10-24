/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { IntegerType, OptionType, SetType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceConfigType, RecordSliceStateType, RecordSliceChoiceType, RecordSliceController, type RecordSliceBinding } from "@elaraai/east-ui/internal";

const Config = RecordSliceConfigType;
const config = decodeBeast2For(Config)(encodeBeast2For(Config)({
    fields: [
        { fieldId: "status", label: "Status", kind: "string", optional: false, multiple: true, set: false, values: [
            { value: '"held"', label: "Held" }, { value: '"late"', label: "Late" },
        ], format: none },
        { fieldId: "due", label: "Due", kind: "integer", optional: true, multiple: true, set: false, values: [{ value: ".none", label: "Unset" }], format: none },
    ],
    indexes: [{ name: "by_status_due", fields: ["status", "due"], sets: new Set(), structured: true, interval: none, area: none, series: none, summary: none }],
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

test("which rows a narrowing holds is asked by each row's maintained entry keys, a row held when any of its entries is; nothing narrowed holds every row (#1349)", () => {
    // The index files `held` at its rows 0 to 9 and `late` at 10 to 19; a row's entries are each status it holds.
    const SetRow = StructType({ status: StringType, due: OptionType(IntegerType), statuses: SetType(StringType) });
    type SetRowValue = ValueTypeOf<typeof SetRow>;
    const printString = printFor(StringType);
    const rowOfStatus = new Map([[printString("held"), 0n], [printString("late"), 10n]]);
    const asked: { ik: string; key: unknown }[][] = [];
    const binding: RecordSliceBinding = {
        id: "small", recordId: "small", defaultIndex: "primary", revision: () => some("A"), refresh: () => null,
        total: () => some(20n),
        entryKeys: (_index, _key, row) => [...(row as SetRowValue).statuses].map(status => printString(status)),
        seek(_index, query) {
            assert.equal(query.type, "fields");
            const fields = query.type === "fields" ? query.value.values : [];
            return some({ found: true, row: rowOfStatus.get(fields[0]!) ?? 20n, count: 10n });
        },
        page: () => none,
        withinAll(_index, runs, entries) {
            asked.push(entries.map(({ ik, key }) => ({ ik, key })));
            return some(entries.map(({ ik }) => {
                const row = rowOfStatus.get(ik) ?? 20n;
                return runs.some(run => row >= run.row && row < run.row + run.count);
            }));
        },
        placeAll: () => none,
    };
    let current = decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({ where: new Map(), preset: none, resolution: none }));
    const controller = new RecordSliceController(binding, config, SetRow, () => current, next => { current = next; });
    const late = new Map([["status", values(printString("late"))]]);
    const holding = (...statuses: string[]): SetRowValue => ({ status: statuses[0] ?? "none", due: none, statuses: new Set(statuses) });
    const rows = [
        { key: "a", row: holding("held") },
        { key: "b", row: holding("held", "late") },
        { key: "c", row: holding() },
        { key: "d", row: holding("late") },
    ];
    assert.deepEqual(controller.within(late, rows), some([false, true, false, true]));
    assert.deepEqual(asked, [[
        { ik: printString("held"), key: "a" }, { ik: printString("held"), key: "b" }, { ik: printString("late"), key: "b" }, { ik: printString("late"), key: "d" },
    ]], "each row's entries, in one read, a row with none sending none");
    assert.deepEqual(controller.within(new Map(), rows), some([true, true, true, true]), "nothing narrowed holds every row");
    assert.equal(asked.length, 1, "and asks nothing");
    assert.deepEqual(controller.place(late), none, "a placement pending is none");
    assert.throws(() => controller.place(new Map()), /nothing narrows this record/);
});

test("which of the record's own rows a narrowing holds is asked of the rows its own pages hold: the window a view of the record reads (#1349)", () => {
    // The record's rows a to d, in its own order; the index files `held` at its rows 0 to 9 and `late` at 10 to 19.
    const SetRow = StructType({ status: StringType, due: OptionType(IntegerType), statuses: SetType(StringType) });
    type SetRowValue = ValueTypeOf<typeof SetRow>;
    const printString = printFor(StringType);
    const rowOfStatus = new Map([[printString("held"), 0n], [printString("late"), 10n]]);
    const holding = (...statuses: string[]): SetRowValue => ({ status: statuses[0] ?? "none", due: none, statuses: new Set(statuses) });
    const stored = [
        { key: "a", row: holding("held") },
        { key: "b", row: holding("held", "late") },
        { key: "c", row: holding() },
        { key: "d", row: holding("late") },
    ];
    const pages: { index: string; offset: bigint; limit: bigint }[] = [];
    const asked: { ik: string; key: unknown }[][] = [];
    let joined = true;
    const binding: RecordSliceBinding = {
        id: "small", recordId: "small", defaultIndex: "primary", revision: () => some("A"), refresh: () => null,
        total: () => some(4n),
        entryKeys: (_index, _key, row) => [...(row as SetRowValue).statuses].map(status => printString(status)),
        seek(_index, query) {
            const fields = query.type === "fields" ? query.value.values : [];
            return some({ found: true, row: rowOfStatus.get(fields[0]!) ?? 20n, count: 10n });
        },
        page(index, offset, limit) {
            pages.push({ index, offset, limit });
            return some(stored.slice(Number(offset), Number(offset + limit)).map(({ key, row }) => ({ ik: variant(index, key), key, row: joined ? some(row) : none })));
        },
        withinAll(_index, runs, entries) {
            asked.push(entries.map(({ ik, key }) => ({ ik, key })));
            return some(entries.map(({ ik }) => {
                const row = rowOfStatus.get(ik) ?? 20n;
                return runs.some(run => row >= run.row && row < run.row + run.count);
            }));
        },
    };
    let current = decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({ where: new Map(), preset: none, resolution: none }));
    const controller = new RecordSliceController(binding, config, SetRow, () => current, next => { current = next; });
    const late = new Map([["status", values(printString("late"))]]);
    assert.deepEqual(controller.withinAt(late, 1n, 3n), some([true, false, true]), "b and d hold `late`; c holds no status");
    assert.deepEqual(pages, [{ index: "primary", offset: 1n, limit: 3n }], "one page of the record's own rows, at the rows asked");
    assert.deepEqual(asked, [[{ ik: printString("held"), key: "b" }, { ik: printString("late"), key: "b" }, { ik: printString("late"), key: "d" }]]);
    // Asked again, the page is the one read: no other is.
    assert.deepEqual(controller.withinAt(late, 1n, 3n), some([true, false, true]));
    assert.equal(pages.length, 1);
    // Rows read without their entries cannot be asked of.
    joined = false;
    assert.throws(() => controller.withinAt(late, 0n, 1n), /with their rows/);
});

test("the rows of several of the record's keys are read in one request when the binding batches them, else each by its key, a key the record lacks none (#1039)", () => {
    // The record holds a and c, in that order.
    const printString = printFor(StringType);
    const stored = new Map<string, ValueTypeOf<typeof Row>>([["a", { status: "held", due: some(1n) }], ["c", { status: "late", due: none }]]);
    const order = new Map([[printString("a"), 0], [printString("c"), 1]]);
    const keys = ["a", "c"];
    let revision = "A";
    const seeks: string[] = [];
    const asked: unknown[][] = [];
    const bindingOf = (batched: boolean, answer?: (keys: readonly unknown[]) => ReturnType<NonNullable<RecordSliceBinding["rowsAll"]>>): RecordSliceBinding => ({
        id: "rows", recordId: "rows", defaultIndex: "primary", revision: () => some(revision), refresh: () => null,
        total: () => some(2n), entryKeys: () => [],
        seek(_index, query) {
            assert.equal(query.type, "key");
            const text = query.type === "key" ? query.value : "";
            seeks.push(text);
            const at = order.get(text);
            return some(at === undefined ? { found: false, row: 0n, count: 0n } : { found: true, row: BigInt(at), count: 1n });
        },
        page: (index, offset, limit) => some(keys.slice(Number(offset), Number(offset + limit))
            .map(key => ({ ik: variant(index, key), key, row: some(stored.get(key)!) }))),
        ...(batched ? {
            rowsAll(asking: readonly unknown[]) {
                asked.push([...asking]);
                if (answer !== undefined) return answer(asking);
                return some(asking.map(key => (stored.has(key as string) ? some(stored.get(key as string)!) : none)));
            },
        } : {}),
    });
    const stateOf = decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({ where: new Map(), preset: none, resolution: none }));
    const controllerOf = (binding: RecordSliceBinding) => new RecordSliceController(binding, config, Row, () => stateOf, () => {});

    const batched = controllerOf(bindingOf(true));
    assert.deepEqual(batched.rows(["c", "b", "a"]), some([some(stored.get("c")), none, some(stored.get("a"))]));
    assert.deepEqual(asked, [["c", "b", "a"]], "one request for every key, in the order asked");
    assert.deepEqual(seeks, [], "and no search");
    assert.deepEqual(batched.rows([]), some([]), "no key asks nothing");
    assert.equal(asked.length, 1);

    const single = controllerOf(bindingOf(false));
    assert.deepEqual(single.rows(["c", "b"]), some([some(stored.get("c")), none]), "each row by its key: its key sought, then its row's page");
    assert.deepEqual(seeks, [printString("c"), printString("b")]);

    assert.deepEqual(controllerOf(bindingOf(true, () => none)).rows(["a"]), none, "a read in flight is none");
    assert.deepEqual(controllerOf(bindingOf(true, (asking) => { revision = "B"; return some(asking.map(() => none)); })).rows(["a"]), none,
        "rows read across a revision's move are none: the next read asks again at the new one");
    revision = "A";
    assert.throws(() => controllerOf(bindingOf(true, () => some([]))).rows(["a"]), /a different number of rows/);
});

test("a value's count is its own, exact at a trillion rows a value, whether it alone is chosen or every value is", () => {
    const { controller } = fixture();
    controller.choose("due", undefined);
    const chips = () => controller.values("status").map(choice => [choice.label, choice.count, choice.selected]);
    assert.deepEqual(chips(), [["Held", some(1_000_000_000_000n), true], ["Late", some(1_000_000_000_000n), true]]);
    controller.choose("status", values('"held"'));
    assert.deepEqual(chips(), [["Held", some(1_000_000_000_000n), true], ["Late", some(1_000_000_000_000n), false]]);
    controller.choose("status", values('"held"', '"late"'));
    assert.equal(controller.count().value, 2_000_000_000_000n);
});

/**
 * A record of 26 rows by status and region — held in the north 3, held in the south 5, late in the north 7, late in
 * the south 11 — indexed both ways, so either field is chosen alone or both together, each search answered from those
 * groups in the index's order.
 */
function facets() {
    const config = decodeBeast2For(Config)(encodeBeast2For(Config)({
        fields: [
            { fieldId: "status", label: "Status", kind: "string", optional: false, multiple: true, set: false, values: [
                { value: '"held"', label: "Held" }, { value: '"late"', label: "Late" },
            ], format: none },
            { fieldId: "region", label: "Region", kind: "string", optional: false, multiple: true, set: false, values: [
                { value: '"north"', label: "North" }, { value: '"south"', label: "South" },
            ], format: none },
        ],
        indexes: [
            { name: "by_status_region", fields: ["status", "region"], sets: new Set(), structured: true, interval: none, area: none, series: none, summary: none },
            { name: "by_region_status", fields: ["region", "status"], sets: new Set(), structured: true, interval: none, area: none, series: none, summary: none },
        ],
        range: none, search: [], presets: [],
    }));
    const printString = printFor(StringType);
    // Each index's groups in its order: their keys as `.east` literals, in its fields' order, and how many rows each holds.
    const group = (first: string, second: string, count: bigint) => ({ keys: [printString(first), printString(second)], count });
    const ordered: Readonly<Record<string, readonly ReturnType<typeof group>[]>> = {
        by_status_region: [group("held", "north", 3n), group("held", "south", 5n), group("late", "north", 7n), group("late", "south", 11n)],
        by_region_status: [group("north", "held", 3n), group("north", "late", 7n), group("south", "held", 5n), group("south", "late", 11n)],
    };
    const binding: RecordSliceBinding = {
        id: "facets", recordId: "facets", defaultIndex: "primary", revision: () => some("A"), refresh: () => null,
        total: () => some(26n), entryKeys: () => [], page: () => none,
        seek(index, query) {
            assert.equal(query.type, "fields");
            const asked = query.type === "fields" ? query.value.values : [];
            let row = 0n;
            let at: bigint | undefined;
            let count = 0n;
            for (const { keys, count: held } of ordered[index]!) {
                if (asked.every((value, i) => value === keys[i])) { at ??= row; count += held; }
                row += held;
            }
            return some({ found: count > 0n, row: at ?? row, count });
        },
    };
    let current = decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({ where: new Map(), preset: none, resolution: none }));
    return new RecordSliceController(binding, config, StructType({ status: StringType, region: StringType }), () => current, next => { current = next; });
}

test("each known value counts its own rows under the other fields' choices, as a faceted search counts — the chosen marked, never what a click on it would show (#1393)", () => {
    const controller = facets();
    const chips = (field: string) => controller.values(field).map(choice => [choice.label, choice.count, choice.selected]);
    assert.deepEqual(chips("status"), [["Held", some(8n), false], ["Late", some(18n), false]]);
    // Held chosen: Held still reads its own 8 and Late its own 18 — a click on either would show all 26.
    controller.choose("status", values('"held"'));
    assert.deepEqual(chips("status"), [["Held", some(8n), true], ["Late", some(18n), false]]);
    // The north chosen too: each status reads its rows in the north, and each region its rows of the held.
    controller.choose("region", values('"north"'));
    assert.deepEqual(chips("status"), [["Held", some(3n), true], ["Late", some(7n), false]]);
    assert.deepEqual(chips("region"), [["North", some(3n), true], ["South", some(5n), false]]);
    assert.equal(controller.count().value, 3n, "a chosen value's own count is the narrowing's");
});
