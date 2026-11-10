/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, IntegerType, OptionType, SetType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, parseFor, printFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceConfigType, RecordSliceStateType, RecordSliceChoiceType, RecordSliceController, type RecordSliceBinding } from "@elaraai/east-ui/internal";

const Config = RecordSliceConfigType;
const config = decodeBeast2For(Config)(encodeBeast2For(Config)({
    fields: [
        { fieldId: "status", label: "Status", kind: "string", optional: false, multiple: true, set: false, values: [
            { value: '"held"', label: "Held" }, { value: '"late"', label: "Late" },
        ], format: none },
        { fieldId: "due", label: "Due", kind: "integer", optional: true, multiple: true, set: false, values: [{ value: ".none", label: "Unset" }], format: none },
    ],
    indexes: [{ name: "by_status_due", fields: ["status", "due"], sets: new Set(), structured: true, interval: none, area: none, series: none, summary: none, entries: false }],
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

/**
 * Jobs filed by an interval index led by their press (#1432), its key
 * `{ on, node, at }`: each press's starts at its tree's root, `node` 0, in
 * order, its 4 unset first. Each press holds a trillion, so the extent reads
 * boundary entries and one search past the unset, never the rows between.
 */
function intervals() {
    const size = 1_000_000_000_000n;
    const config = decodeBeast2For(Config)(encodeBeast2For(Config)({
        fields: [
            { fieldId: "press", label: "Press", kind: "string", optional: false, multiple: true, set: false, values: [
                { value: '"P-1"', label: "P-1" }, { value: '"P-2"', label: "P-2" },
            ], format: none },
            { fieldId: "start", label: "Start", kind: "datetime", optional: true, multiple: true, set: false, values: [{ value: ".none", label: "Unset" }], format: none },
        ],
        indexes: [{
            name: "jobs_by_press_time", fields: ["press"], sets: new Set(), structured: true,
            interval: some({ from: "start", to: "end", optional: true }), area: none, series: none, summary: none, entries: false,
        }],
        range: some("start"), search: [], presets: [],
    }));
    const Key = StructType({ on: StructType({ press: StringType }), node: IntegerType, at: OptionType(DateTimeType) });
    const instant = (text: string): Date => {
        const read = parseFor(DateTimeType)(text);
        assert.ok(read.success, text);
        return read.value;
    };
    const presses = ["P-1", "P-2"];
    const first = [instant("2026-10-05T08:00:00.000"), instant("2026-10-01T06:00:00.000")];
    const last = [instant("2026-11-02T17:30:00.000"), instant("2026-10-20T12:00:00.000")];
    const printOn = printFor(Key.fields.on);
    const seeks: string[][] = [];
    const pages: bigint[] = [];
    const binding: RecordSliceBinding = {
        id: "jobs", recordId: "jobs", defaultIndex: "primary", revision: () => some("A"), refresh: () => null,
        total: () => some(2n * size), entryKeys: () => [],
        seek(index, query) {
            assert.equal(index, "jobs_by_press_time");
            assert.equal(query.type, "fields");
            const asked = query.type === "fields" ? query.value.values : [];
            seeks.push(asked);
            const press = presses.findIndex(name => asked[0] === printOn({ press: name }));
            assert.ok(press >= 0 && asked[1] === "0", `a search names its press's on as one literal, then the root: ${asked.join(", ")}`);
            const row = BigInt(press) * size;
            if (asked.length === 2) return some({ found: true, row, count: size });
            assert.deepEqual(asked.slice(2), [".none"]);
            return some({ found: true, row, count: 4n });
        },
        page(index, offset, limit) {
            assert.equal(index, "jobs_by_press_time");
            assert.equal(limit, 1n);
            pages.push(offset);
            const press = Number(offset / size);
            const row = offset % size;
            assert.ok(row === 0n || row === 4n || row === size - 1n, `only boundary entries are read: ${row}`);
            const at = row < 4n ? none : some(row === 4n ? first[press]! : last[press]!);
            return some([{ ik: variant("jobs_by_press_time", { on: { press: presses[press]! }, node: 0n, at }) }]);
        },
    };
    let current = decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({
        where: new Map([["press", values('"P-1"', '"P-2"')]]), preset: none, resolution: none,
    }));
    const Row = StructType({ press: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
    const controller = new RecordSliceController(binding, config, Row, () => current, next => { current = next; }, StringType, undefined,
        { jobs_by_press_time: Key });
    return { controller, seeks, pages };
}

test("an interval index's start extent reads its root's boundary entries under each press, past the unset by one search of `[on, 0, .none]` (#1432)", () => {
    const { controller, seeks, pages } = intervals();
    assert.deepEqual(controller.domain("start"), some({ from: ".some 2026-10-01T06:00:00.000", to: ".some 2026-11-02T17:30:00.000" }),
        "the earliest first start of either press, and the latest last");
    assert.deepEqual(seeks.map(asked => asked.join(" ")).sort(), [
        '(press="P-1") 0', '(press="P-1") 0 .none', '(press="P-2") 0', '(press="P-2") 0 .none',
    ]);
    assert.equal(pages.length, 6, "three entries a press: its first, its last, and its first set");
});

test("a field named `area`, `__area`, `tile` or `__tile` is offered, chosen and counted like any other: e3's parts are an index's kind's, never a field's name (#1432)", () => {
    const names = ["area", "__area", "tile", "__tile"];
    const config = decodeBeast2For(Config)(encodeBeast2For(Config)({
        fields: names.map(name => ({ fieldId: name, label: name, kind: "string", optional: false, multiple: true, set: false,
            values: [{ value: '"a"', label: "A" }, { value: '"b"', label: "B" }], format: none })),
        indexes: names.map(name => ({ name: `by_${name}`, fields: [name], sets: new Set<string>(), structured: false, interval: none, area: none, series: none, summary: none, entries: false })),
        range: none, search: [], presets: [],
    }));
    // Each field's index files its `a` rows first, as many as its place among the names plus one, then ten `b` rows.
    const printString = printFor(StringType);
    const seeks: string[] = [];
    const binding: RecordSliceBinding = {
        id: "named", recordId: "named", defaultIndex: "primary", revision: () => some("A"), refresh: () => null,
        total: () => some(20n), entryKeys: () => [], page: () => none,
        seek(index, query) {
            assert.equal(query.type, "key");
            const value = query.type === "key" ? query.value : "";
            seeks.push(`${index} ${value}`);
            const held = BigInt(names.indexOf(index.slice(3)) + 1);
            return some(value === printString("a") ? { found: true, row: 0n, count: held } : { found: true, row: held, count: 10n });
        },
    };
    const Row = StructType(names.map(name => [name, StringType] as const));
    let current = decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({ where: new Map(), preset: none, resolution: none }));
    const controller = new RecordSliceController(binding, config, Row, () => current, next => { current = next; });
    for (const [i, name] of names.entries()) {
        assert.deepEqual(controller.values(name).map(choice => [choice.label, choice.count]), [["A", some(BigInt(i + 1))], ["B", some(10n)]],
            `${name} offers its values, each counted`);
        controller.choose(name, values(printString("a")));
        assert.deepEqual([...controller.readState().where.keys()], [name], `${name} is chosen`);
        assert.deepEqual(controller.count(), some(BigInt(i + 1)), `${name}'s choice counted through its index`);
        controller.clearAll();
    }
    assert.ok(names.every(name => seeks.includes(`by_${name} ${printString("a")}`)), "each read through its own index");
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

test("which of a page's rows a narrowing holds, asked again while its answer is on its way, makes the page's entries once: each row's entries are worked out once, and the same entries are asked of each time (#1398)", () => {
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
    // Each row's entries as the binding works them out, by its key; and what each ask of which rows hold was asked with.
    const made: unknown[] = [];
    const asked: (readonly unknown[])[] = [];
    let answered = false;
    const binding: RecordSliceBinding = {
        id: "small", recordId: "small", defaultIndex: "primary", revision: () => some("A"), refresh: () => null,
        total: () => some(4n),
        entryKeys: (_index, key, row) => {
            made.push(key);
            return [...(row as SetRowValue).statuses].map(status => printString(status));
        },
        seek(_index, query) {
            const fields = query.type === "fields" ? query.value.values : [];
            return some({ found: true, row: rowOfStatus.get(fields[0]!) ?? 20n, count: 10n });
        },
        page: (index, offset, limit) => some(stored.slice(Number(offset), Number(offset + limit)).map(({ key, row }) => ({ ik: variant(index, key), key, row: some(row) }))),
        withinAll(_index, runs, entries) {
            asked.push(entries);
            // On its way until the test says it has landed: a lens asks again at every evaluation meanwhile.
            if (!answered) return none;
            return some(entries.map(({ ik }) => {
                const row = rowOfStatus.get(ik) ?? 20n;
                return runs.some(run => row >= run.row && row < run.row + run.count);
            }));
        },
    };
    let current = decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({ where: new Map(), preset: none, resolution: none }));
    const controller = new RecordSliceController(binding, config, SetRow, () => current, next => { current = next; });
    const late = new Map([["status", values(printString("late"))]]);
    assert.deepEqual(controller.withinAt(late, 1n, 3n), none, "on its way");
    assert.deepEqual(made, ["b", "c", "d"], "each of the page's rows' entries worked out once");
    // Asked again twice while it is on its way, and once as it lands: no row's entries are worked out again, and each ask
    // is of the very entries the first was.
    assert.deepEqual(controller.withinAt(late, 1n, 3n), none);
    assert.deepEqual(controller.withinAt(late, 1n, 3n), none);
    answered = true;
    assert.deepEqual(controller.withinAt(late, 1n, 3n), some([true, false, true]), "b and d hold `late`; c holds no status");
    assert.deepEqual(made, ["b", "c", "d"]);
    assert.equal(asked.length, 4);
    assert.ok(asked.every(entries => Object.is(entries, asked[0])), "the same entries, asked of each time");
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

/**
 * A record whose rows are filed under their status: `held` at the index's rows 0 to 9, `late` at 10 to 19. It counts
 * every read, and batches its reads when asked to.
 */
function membershipFixture(batches: { within?: boolean; rows?: boolean } = {}) {
    const printString = printFor(StringType);
    const encode = encodeBeast2For(Row);
    const stored = new Map<string, ValueTypeOf<typeof Row>>([["c", { status: "late", due: none }]]);
    const rowOfStatus = new Map([[printString("held"), 0n], [printString("late"), 10n]]);
    const log = { rows: [] as unknown[][], within: [] as (readonly { ik: string; key: unknown }[])[], pages: 0, seeks: 0 };
    let revision = "A";
    let pending = false;
    const binding: RecordSliceBinding = {
        id: "many", recordId: "many", defaultIndex: "primary", revision: () => some(revision), refresh: () => null,
        total: () => some(20n),
        entryKeys: (_index, _key, row) => [printString((row as ValueTypeOf<typeof Row>).status)],
        seek(_index, query) {
            log.seeks++;
            assert.equal(query.type, "fields");
            const fields = query.type === "fields" ? query.value.values : [];
            return some({ found: true, row: rowOfStatus.get(fields[0]!) ?? 20n, count: 10n });
        },
        page() { log.pages++; return none; },
        ...(batches.within === false ? {} : {
            withinAll(_index: string, runs: readonly { row: bigint; count: bigint }[], entries: readonly { ik: string; key: unknown }[]) {
                log.within.push(entries);
                return some(entries.map(({ ik }) => {
                    const row = rowOfStatus.get(ik) ?? 20n;
                    return runs.some(run => row >= run.row && row < run.row + run.count);
                }));
            },
        }),
        ...(batches.rows === false ? {} : {
            rowsAll(asking: readonly unknown[]) {
                log.rows.push([...asking]);
                if (pending) return none;
                return some(asking.map(key => (stored.has(key as string) ? some(stored.get(key as string)!) : none)));
            },
        }),
    };
    const empty = decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({ where: new Map(), preset: none, resolution: none }));
    const controller = new RecordSliceController(binding, config, Row, () => empty, () => {});
    const late = new Map([["status", values(printString("late"))]]);
    const heldRow = (status: string) => encode({ status, due: none });
    return { controller, late, heldRow, log, stored, encode, pending(value: boolean) { pending = value; }, move() { revision = "B"; } };
}

test("several entries' membership is one read: the rows not held by key in one request, every row's entries in one more; an entry the record lacks is outside it (#1596)", () => {
    const f = membershipFixture();
    const ids = ["a", "b", "c", "d"];
    const held = new Map([["a", f.heldRow("held")], ["b", f.heldRow("late")]]);
    const answer = (asked: ReturnType<RecordSliceController["containsAll"]>) => (asked?.type === "some" ? [...asked.value] : asked);
    assert.deepEqual(answer(f.controller.containsAll(f.late, ids, held)), [["d", false], ["a", false], ["b", true], ["c", true]]);
    assert.deepEqual(f.log.rows, [["c", "d"]], "only the rows it does not hold, in one request");
    assert.equal(f.log.within.length, 1, "every row's entries in one read");
    assert.deepEqual(f.log.within[0]!.map(({ ik, key }) => [ik, key]), [[printFor(StringType)("held"), "a"], [printFor(StringType)("late"), "b"], [printFor(StringType)("late"), "c"]]);
    assert.equal(f.log.pages, 0, "and no row is read a page at a time");

    // Asked again while the question stands: no row read or made again, the same entries asked of.
    f.controller.containsAll(f.late, ids, held);
    assert.equal(f.log.rows.length, 1);
    assert.ok(Object.is(f.log.within[1], f.log.within[0]));

    // A move starts again: its rows are that revision's.
    f.move();
    f.controller.containsAll(f.late, ids, held);
    assert.equal(f.log.rows.length, 2);
    assert.ok(!Object.is(f.log.within[2], f.log.within[0]));
});

test("a read of several entries' membership is none while it is pending, nothing for no entries, and left to single reads where the binding does not batch (#1596)", () => {
    const pending = membershipFixture();
    pending.pending(true);
    assert.deepEqual(pending.controller.containsAll(pending.late, ["c"], undefined), none);
    assert.equal(pending.log.within.length, 0, "no entry is asked of before its row is read");

    const empty = membershipFixture();
    const none_ = empty.controller.containsAll(empty.late, [], undefined);
    assert.ok(none_?.type === "some" && none_.value.size === 0);
    assert.equal(empty.log.seeks + empty.log.rows.length + empty.log.within.length, 0, "no entry asks nothing");

    for (const batches of [{ within: false }, { rows: false }]) {
        const single = membershipFixture(batches);
        assert.equal(single.controller.containsAll(single.late, ["c"], undefined), undefined);
    }
});

test("several saved entries are confirmed in one read, each as its single read answers it but as the read decoded it, a key the record lacks none (#1596)", () => {
    const f = membershipFixture();
    const read = f.controller.readEntries(["c", "b"]);
    assert.ok(read?.type === "some");
    assert.deepEqual([...read.value.keys()], ["c", "b"]);
    const c = read.value.get("c");
    assert.ok(c?.type === "some");
    assert.ok(equalFor(Row)(c.value as ValueTypeOf<typeof Row>, f.stored.get("c")!), "the row as the record holds it, never encoded to be decoded again");
    assert.deepEqual(read.value.get("b"), none);
    assert.deepEqual(f.log.rows, [["c", "b"]], "one request");
    assert.equal(f.log.seeks + f.log.pages, 0, "and no key search or page");

    const pending = membershipFixture();
    pending.pending(true);
    assert.deepEqual(pending.controller.readEntries(["c"]), none);
    const single = membershipFixture({ rows: false });
    assert.equal(single.controller.readEntries(["c"]), undefined, "a binding that does not batch reads each by its key");
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
            { name: "by_status_region", fields: ["status", "region"], sets: new Set(), structured: true, interval: none, area: none, series: none, summary: none, entries: false },
            { name: "by_region_status", fields: ["region", "status"], sets: new Set(), structured: true, interval: none, area: none, series: none, summary: none, entries: false },
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

/**
 * Seven stations by status and the services each holds (#1522): an entries index files each station's services, a
 * service's entries one range of it in the services' order — Economy held by 1 station, Priority by 2, Standard by 4 —
 * beside a status index, 3 held and 4 late. A service's picks weigh what a reader draws of each station, and narrow none.
 */
function services() {
    const config = decodeBeast2For(Config)(encodeBeast2For(Config)({
        fields: [
            { fieldId: "status", label: "Status", kind: "string", optional: false, multiple: true, set: false, values: [
                { value: '"held"', label: "Held" }, { value: '"late"', label: "Late" },
            ], format: none },
            { fieldId: "byService", label: "Service", kind: "string", optional: false, multiple: true, set: false, values: [
                { value: '"Economy"', label: "Economy" }, { value: '"Priority"', label: "Priority" }, { value: '"Standard"', label: "Standard" },
            ], format: none },
        ],
        indexes: [
            { name: "by_status", fields: ["status"], sets: new Set(), structured: false, interval: none, area: none, series: none, summary: none, entries: false },
            { name: "by_service", fields: ["byService"], sets: new Set(), structured: false, interval: none, area: none, series: none, summary: none, entries: true },
        ],
        range: none, search: [], presets: [],
    }));
    const printString = printFor(StringType);
    const held: readonly (readonly [string, bigint])[] = [["Economy", 1n], ["Priority", 2n], ["Standard", 4n]];
    const asked: string[] = [];
    const binding: RecordSliceBinding = {
        id: "stations", recordId: "stations", defaultIndex: "primary", revision: () => some("A"), refresh: () => null,
        total: () => some(7n), entryKeys: () => [], page: () => none,
        seek(index, query) {
            if (index === "by_service") {
                // A service's range: an exact key of the entries index, every station's entry under it.
                assert.equal(query.type, "key");
                const key = query.type === "key" ? query.value : "";
                asked.push(key);
                let row = 0n;
                for (const [service, count] of held) {
                    if (key === printString(service)) return some({ found: true, row, count });
                    row += count;
                }
                return some({ found: false, row, count: 0n });
            }
            // A status, the one field of its index: an exact key.
            assert.equal(index, "by_status");
            assert.equal(query.type, "key");
            const status = query.type === "key" ? query.value : undefined;
            return some(status === printString("held") ? { found: true, row: 0n, count: 3n } : { found: true, row: 3n, count: 4n });
        },
    };
    let current = decodeBeast2For(RecordSliceStateType)(encodeBeast2For(RecordSliceStateType)({ where: new Map(), preset: none, resolution: none }));
    const controller = new RecordSliceController(binding, config, StructType({ status: StringType, byService: SetType(StringType) }), () => current, next => { current = next; });
    return { controller, asked, where: () => current.where };
}

test("an entries field's keys each count the stations holding them, whatever else is chosen; several are picked, beside other choices, and narrow none (#1522)", () => {
    const { controller, asked, where } = services();
    const chips = () => controller.values("byService").map(choice => [choice.label, choice.count, choice.selected]);
    assert.deepEqual(chips(), [["Economy", some(1n), false], ["Priority", some(2n), false], ["Standard", some(4n), false]]);
    assert.deepEqual(asked, ['"Economy"', '"Priority"', '"Standard"'], "each count a search of its key's range: the index alone, no row read");
    controller.choose("byService", values('"Priority"', '"Standard"'));
    assert.deepEqual(chips(), [["Economy", some(1n), false], ["Priority", some(2n), true], ["Standard", some(4n), true]]);
    assert.equal(controller.count().value, 7n, "the picks weigh the stations and narrow none: every one still counts");
    // The status narrows; the picks stand beside it, and each key still counts the stations holding it.
    controller.choose("status", values('"held"'));
    assert.equal(controller.count().value, 3n);
    assert.deepEqual(chips(), [["Economy", some(1n), false], ["Priority", some(2n), true], ["Standard", some(4n), true]]);
    assert.deepEqual([...where().keys()].sort(), ["byService", "status"]);
    controller.choose("status", undefined);
    assert.deepEqual([...where().keys()], ["byService"], "the status cleared, the picks kept");
    controller.choose("byService", undefined);
    assert.equal(where().size, 0);
});
