/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.Builder`'s payload over the runtime (#1183, `Sheet Builder Spec.md`
 * SB11, SB12, SB15, SB16): built from an in-memory record and the State
 * runtime. The sheet holds the record's entries and commits through it, the
 * views are read from their bind handle and written back to it, and one
 * entry's payload names an entry the record does not hold and keeps its
 * sheet read-only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    ArrayType, DateTimeType, DictType, East, FloatType, OptionType, PatchType, SortedMap, StringType, StructType,
    applyFor, compareFor, diffFor, encodeBeast2For, equalFor, none, some, toEastTypeValue, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Editing, State } from "@elaraai/east-ui/internal";
import { RecordBindHandleType, Sheet, SheetBuilderPayloadType } from "@elaraai/e3-ui/internal";
import { StateImpl, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import type { TreePath } from "@elaraai/e3-types";
import { datasetCacheKey, type ReactiveDatasetCacheInterface } from "../src/platform/dataset-store.js";
import { RecordRuntime, createInMemoryRecordApi } from "../src/platform/record-runtime.js";

const ws = "test-workspace";
const keys = compareFor(StringType);
type Payload = ValueTypeOf<typeof SheetBuilderPayloadType>;

/** A dataset cache holding what the in-memory record writes into it. */
function fakeCache(): ReactiveDatasetCacheInterface {
    const store = new Map<string, Uint8Array>();
    return {
        read: (w: string, p: TreePath) => store.get(datasetCacheKey(w, p)),
        getStatus: () => variant("up-to-date", null),
        async write(w: string, p: TreePath, v: Uint8Array) { store.set(datasetCacheKey(w, p), v); },
        async refresh() { /* the in-memory record writes the cache itself */ },
        async launchDataflow() { /* no dataflow */ },
    } as unknown as ReactiveDatasetCacheInterface;
}

/** A record in memory whose one mutation is its patch door, bound through a runtime. */
function inMemory<T extends DictType>(name: string, type: T, initial: ValueTypeOf<T>, handleType: StructType) {
    const cache = fakeCache();
    const applyPatch = applyFor(type);
    const memory = createInMemoryRecordApi(cache, ws, [{
        name, stateType: type, initial,
        mutations: [{ name: "patch", argTypes: [PatchType(type)], reduce: (state, patch) => applyPatch(state as never, patch) }],
    }]);
    const runtime = new RecordRuntime();
    runtime.initialize(memory, cache, ws);
    return { memory, runtime, handle: runtime.buildHandle(toEastTypeValue(handleType), name) };
}

const ids = (payload: Payload): string[] => {
    if (payload.sheet.rows.type !== "inline") assert.fail(`expected inline rows, got ${payload.sheet.rows.type}`);
    return payload.sheet.rows.value.map((row) => row.id);
};

describe("the record's entries", () => {
    const JobType = StructType({ task: StringType, qty: OptionType(FloatType) });
    const JobsType = DictType(StringType, JobType);
    const JobsHandle = RecordBindHandleType(JobsType, { patch: [PatchType(JobsType)] });
    type Job = ValueTypeOf<typeof JobType>;
    const CUT: Job = { task: "Panel cutting", qty: some(48.0) };
    const BAND: Job = { task: "Edge banding", qty: some(120.0) };
    const COLUMNS = { task: Sheet.column.text(JobType, { header: "Task" }), qty: Sheet.column.quantity(JobType, { header: "Qty" }) };
    const NARROWING = {
        range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, visible: none, selectedIndex: none, resolution: none,
    };
    const SPRAY = { id: "spray", name: "SPRAY", narrowing: { ...NARROWING, search: some("spray") }, context: 0n, reveals: [], folds: new Map<string, boolean>() };
    const viewsEqual = equalFor(ArrayType(Sheet.Types.View));

    function jobs() {
        return inMemory("jobs", JobsType, new SortedMap([["J-0002", BAND], ["J-0001", CUT]], keys), JobsHandle);
    }

    test("the sheet holds the entries in key order, and its Apply commits through the record (SB12, SB16)", async () => {
        StateRuntime.initializeStore(new UIStore());
        const { memory, runtime, handle } = jobs();
        const payloadOf = East.compile(East.function([JobsHandle], SheetBuilderPayloadType, ($, record) =>
            Sheet.BuilderPayload({ record, columns: COLUMNS, id: "jobs" })), [...runtime.buildPrimitives(), ...StateImpl]) as unknown as (h: unknown) => Payload;
        const payload = payloadOf(handle);
        assert.deepEqual(ids(payload), ["J-0001", "J-0002"]);
        assert.deepEqual(payload.id, some("jobs"));
        assert.deepEqual(payload.missing, none);
        assert.deepEqual(payload.templates, []);
        if (payload.sheet.editing.onApply.type !== "some") assert.fail("the builder's sheet has no Apply");
        const batch = encodeBeast2For(Editing.Types.ChangeSet(JobType, StringType))({
            requestId: "builder-1", base: variant("snapshot", new SortedMap([["J-0001", CUT], ["J-0002", BAND]], keys)), label: "Edit jobs",
            changes: [{ id: "J-0001", patch: diffFor(OptionType(JobType))(some(CUT), some({ ...CUT, qty: some(50.0) })), place: none }],
        });
        const result = await payload.sheet.editing.onApply.value.value(batch);
        assert.equal(result.type, "applied");
        const { commits } = await memory.history(ws, "jobs", undefined);
        assert.deepEqual(commits.map((c) => c.mutation), ["patch", "$init"], "one commit");
    });

    test("views are read from their bind handle, and every change is written back to it (SB11)", () => {
        StateRuntime.initializeStore(new UIStore());
        const { runtime, handle } = jobs();
        const payloadOf = East.compile(East.function([JobsHandle], SheetBuilderPayloadType, ($, record) => {
            const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet.builder.payload.views", []));
            return Sheet.BuilderPayload({ record, columns: COLUMNS, views });
        }), [...runtime.buildPrimitives(), ...StateImpl]) as unknown as (h: unknown) => Payload;
        const first = payloadOf(handle);
        assert.ok(viewsEqual(first.sheet.views, []));
        if (first.sheet.onViewsChange.type !== "some") assert.fail("the builder's sheet does not write its views");
        first.sheet.onViewsChange.value([SPRAY]);
        assert.ok(viewsEqual(payloadOf(handle).sheet.views, [SPRAY]), "the next build reads what the sheet wrote");
    });
});

describe("one entry's rows", () => {
    const PlanRowType = StructType({ id: StringType, task: StringType });
    const WeekType = StructType({ starts: DateTimeType, rows: ArrayType(PlanRowType) });
    const PlansType = DictType(StringType, WeekType);
    const PlansHandle = RecordBindHandleType(PlansType, { patch: [PatchType(PlansType)] });
    const COLUMNS = { task: Sheet.column.text(PlanRowType, { header: "Task" }) };
    const W42 = { starts: new Date("2026-10-12T00:00:00Z"), rows: [{ id: "r1", task: "Cut the carcasses" }] };

    function plans() {
        return inMemory("plans", PlansType, new SortedMap([["2026-W42", W42]], keys), PlansHandle);
    }

    test("an entry the record does not hold is named for the banner, its sheet empty and read-only (SB15)", () => {
        StateRuntime.initializeStore(new UIStore());
        const { runtime, handle } = plans();
        const payloadOf = East.compile(East.function([PlansHandle, StringType], SheetBuilderPayloadType, ($, record, week) =>
            Sheet.BuilderPayload({ record, entry: { key: week, rows: "rows", id: "id" }, columns: COLUMNS })),
        [...runtime.buildPrimitives(), ...StateImpl]) as unknown as (h: unknown, week: string) => Payload;
        const held = payloadOf(handle, "2026-W42");
        assert.deepEqual(ids(held), ["r1"]);
        assert.deepEqual(held.missing, none);
        assert.deepEqual(held.sheet.readOnly, some(false));
        const missing = payloadOf(handle, "2026-W50");
        assert.deepEqual(ids(missing), []);
        assert.deepEqual(missing.missing, some("2026-W50"));
        assert.deepEqual(missing.sheet.readOnly, some(true));
    });

    test("the author's readOnly holds whether or not the record holds the entry", () => {
        StateRuntime.initializeStore(new UIStore());
        const { runtime, handle } = plans();
        const payloadOf = East.compile(East.function([PlansHandle], SheetBuilderPayloadType, ($, record) =>
            Sheet.BuilderPayload({ record, entry: { key: "2026-W42", rows: "rows", id: "id" }, columns: COLUMNS, readOnly: true })),
        [...runtime.buildPrimitives(), ...StateImpl]) as unknown as (h: unknown) => Payload;
        assert.deepEqual(payloadOf(handle).sheet.readOnly, some(true));
    });
});
