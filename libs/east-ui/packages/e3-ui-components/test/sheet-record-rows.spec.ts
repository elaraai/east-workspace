/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's rows over the runtime (#1182, `Sheet Builder Spec.md`
 * SB13–SB17): the sheet `recordRows` builds, committing through its own wire
 * Apply as the renderer sends a batch, to an in-memory record whose patch
 * mutation applies the patch with East's own checks — a before the record no
 * longer holds is a conflict — so each Apply meets the checks a deployed
 * record makes. Both forms: the record's entries as the rows, and one
 * entry's rows.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    ArrayType, DateTimeType, DictType, East, IntegerType, OptionType, PatchType, SortedMap, StringType, StructType,
    applyFor, compareFor, decodeBeast2For, diffFor, encodeBeast2For, none, some, toEastTypeValue, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { RecordBindHandleType, Sheet, createSheetRootWith, recordRows } from "@elaraai/e3-ui/internal";
import type { TreePath } from "@elaraai/e3-types";
import { datasetCacheKey, type ReactiveDatasetCacheInterface } from "../src/platform/dataset-store.js";
import { RecordRuntime, createInMemoryRecordApi, type RecordApi, type RecordMutateArgs } from "../src/platform/record-runtime.js";

const ws = "test-workspace";
const keys = compareFor(StringType);

type Root = ValueTypeOf<typeof Sheet.Types.Root>;
type Result = ValueTypeOf<typeof Editing.Types.ApplyResult>;

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
    const requests: RecordMutateArgs[] = [];
    const recording: RecordApi = {
        ...memory,
        mutate: (w, record, mutation, req) => { requests.push(req); return memory.mutate(w, record, mutation, req); },
    };
    const runtime = new RecordRuntime();
    runtime.initialize(recording, cache, ws);
    return { memory, requests, runtime, handle: runtime.buildHandle(toEastTypeValue(handleType), name) };
}

/** The sheet's own wire Apply, as the renderer calls it with a batch's bytes. */
async function applyThrough(root: Root, batch: Uint8Array): Promise<Result> {
    if (root.editing.onApply.type !== "some") assert.fail("the sheet has no Apply");
    return await root.editing.onApply.value.value(batch);
}

const ids = (root: Root): string[] => {
    if (root.rows.type !== "inline") assert.fail(`expected inline rows, got ${root.rows.type}`);
    return root.rows.value.map((row) => row.id);
};

describe("the record's entries are the rows", () => {
    const JobType = StructType({ task: StringType, qty: IntegerType });
    const JobsType = DictType(StringType, JobType);
    const JobsHandle = RecordBindHandleType(JobsType, { patch: [PatchType(JobsType)] });
    type Job = ValueTypeOf<typeof JobType>;
    const CUT: Job = { task: "Panel cutting", qty: 48n };
    const BAND: Job = { task: "Edge banding", qty: 12n };
    const COLUMNS = { task: Sheet.column.text(JobType, { header: "Task" }), qty: Sheet.column.integer(JobType, { header: "Qty" }) };
    const entryPatch = diffFor(OptionType(JobType));
    const encodeBatch = encodeBeast2For(Editing.Types.ChangeSet(JobType, StringType));

    function jobs() {
        return inMemory("jobs", JobsType, new SortedMap([["J-0001", CUT], ["J-0002", BAND]], keys), JobsHandle);
    }
    /** The sheet over the jobs record, compiled against the runtime. */
    function sheetOver(runtime: RecordRuntime): (handle: unknown) => Root {
        return East.compile(East.function([JobsHandle], Sheet.Types.Root, ($, record) => {
            const rows = recordRows(record);
            return createSheetRootWith(rows.data, COLUMNS, rows.options, rows.internal);
        }), runtime.buildPrimitives()) as unknown as (handle: unknown) => Root;
    }
    /** Takes J-0001 from 48 to 50, removes J-0002 and adds J-0003, over the snapshot the session began from. */
    const EDIT = encodeBatch({
        requestId: "jobs-1", base: variant("snapshot", new SortedMap([["J-0001", CUT], ["J-0002", BAND]], keys)), label: "Edit jobs",
        changes: [
            { id: "J-0001", patch: entryPatch(some(CUT), some({ ...CUT, qty: 50n })), place: none },
            { id: "J-0002", patch: entryPatch(some(BAND), none), place: none },
            { id: "J-0003", patch: entryPatch(none, some({ task: "Sanding", qty: 6n })), place: some(variant("keyOrder", null)) },
        ],
    });

    test("the rows are the entries in key order, the session's source the record (SB13)", () => {
        const { runtime, handle } = jobs();
        const root = sheetOver(runtime)(handle);
        assert.deepEqual(ids(root), ["J-0001", "J-0002"]);
        assert.equal(root.editing.sourceId, "jobs");
    });

    test("an insert, an update and a delete by key in one batch are one commit (SB16)", async () => {
        const { memory, requests, runtime, handle } = jobs();
        const result = await applyThrough(sheetOver(runtime)(handle), EDIT);
        assert.equal(result.type, "applied");
        const state = (handle as { read: () => SortedMap<string, Job> }).read();
        assert.deepEqual([...state.entries()], [["J-0001", { ...CUT, qty: 50n }], ["J-0003", { task: "Sanding", qty: 6n }]]);
        const { commits } = await memory.history(ws, "jobs", undefined);
        assert.deepEqual(commits.map((c) => c.mutation), ["patch", "$init"], "one commit");
        const sent = decodeBeast2For(PatchType(JobsType))(requests[0]!.args[0]!);
        if (sent.type !== "patch") assert.fail(`expected a patch by key, got ${sent.type}`);
        assert.deepEqual([...sent.value].map(([id, op]) => [id, op.type]), [["J-0001", "update"], ["J-0002", "delete"], ["J-0003", "insert"]]);
        assert.equal(requests[0]!.idempotencyKey, "jobs-1", "the batch's request id keys the write");
    });

    test("a row another write moved is a conflict naming it, and nothing is overwritten", async () => {
        const { memory, runtime, handle } = jobs();
        const moved = new SortedMap([["J-0001", variant("update", diffFor(JobType)(CUT, { ...CUT, qty: 60n }))]], keys);
        const wrote = await memory.mutate(ws, "jobs", "patch", { args: [encodeBeast2For(PatchType(JobsType))(variant("patch", moved) as never)] });
        assert.equal(wrote.outcome.type, "committed");
        const result = await applyThrough(sheetOver(runtime)(handle), EDIT);
        assert.equal(result.type, "conflict");
        assert.deepEqual((result.value as { entry: string }[]).map((issue) => issue.entry), ["J-0001"]);
        const state = (handle as { read: () => SortedMap<string, Job> }).read();
        assert.deepEqual([...state.entries()], [["J-0001", { ...CUT, qty: 60n }], ["J-0002", BAND]]);
    });
});

describe("one entry's rows", () => {
    const PlanRowType = StructType({ id: StringType, task: StringType, qty: IntegerType });
    const WeekType = StructType({ starts: DateTimeType, rows: ArrayType(PlanRowType) });
    const PlansType = DictType(StringType, WeekType);
    const PlansHandle = RecordBindHandleType(PlansType, { patch: [PatchType(PlansType)] });
    type Week = ValueTypeOf<typeof WeekType>;
    type PlanRow = ValueTypeOf<typeof PlanRowType>;
    const COLUMNS = { task: Sheet.column.text(PlanRowType, { header: "Task" }), qty: Sheet.column.integer(PlanRowType, { header: "Qty" }) };
    const R1: PlanRow = { id: "r1", task: "Panel cutting", qty: 48n };
    const R2: PlanRow = { id: "r2", task: "Edge banding", qty: 12n };
    const W42: Week = { starts: new Date("2026-10-12T00:00:00Z"), rows: [R1, R2] };
    const W43: Week = { starts: new Date("2026-10-19T00:00:00Z"), rows: [{ id: "r9", task: "Spray finish", qty: 2n }] };
    const rowPatch = diffFor(OptionType(PlanRowType));
    const encodeBatch = encodeBeast2For(Editing.Types.ChangeSet(PlanRowType));

    function plans() {
        return inMemory("plans", PlansType, new SortedMap([["2026-W42", W42], ["2026-W43", W43]], keys), PlansHandle);
    }
    /** The sheet over one week's rows, compiled against the runtime. */
    function sheetOver(runtime: RecordRuntime): (handle: unknown, week: string) => Root {
        return East.compile(East.function([PlansHandle, StringType], Sheet.Types.Root, ($, record, week) => {
            const rows = recordRows(record, { entry: { key: week, rows: "rows", id: "id" } });
            return createSheetRootWith(rows.data, COLUMNS, rows.options, rows.internal);
        }), runtime.buildPrimitives()) as unknown as (handle: unknown, week: string) => Root;
    }
    /** The week the record does not hold, as the frame's banner names it. */
    function missingOf(runtime: RecordRuntime): (handle: unknown, week: string) => ValueTypeOf<OptionType<typeof StringType>> {
        return East.compile(East.function([PlansHandle, StringType], OptionType(StringType), ($, record, week) =>
            recordRows(record, { entry: { key: week, rows: "rows", id: "id" } }).missing), runtime.buildPrimitives()) as never;
    }
    /** Takes r1 from 48 to 50, and adds r3 after r2. */
    const EDIT = encodeBatch({
        requestId: "week-1", base: variant("snapshot", W42.rows), label: "Edit the week",
        changes: [
            { id: "r1", patch: rowPatch(some(R1), some({ ...R1, qty: 50n })), place: none },
            { id: "r3", patch: rowPatch(none, some({ id: "r3", task: "Sanding", qty: 6n })), place: some(variant("ordered", variant("after", "r2"))) },
        ],
    });

    test("the rows are the entry's field in their own order, the session's source the record and the entry (SB15)", () => {
        const { runtime, handle } = plans();
        const root = sheetOver(runtime)(handle, "2026-W42");
        assert.deepEqual(ids(root), ["r1", "r2"]);
        assert.equal(root.editing.sourceId, "plans#2026-W42");
        assert.deepEqual(root.readOnly, some(false));
    });

    test("Apply is one diff of that entry, reaching its rows and nothing else (SB16)", async () => {
        const { requests, runtime, handle } = plans();
        const result = await applyThrough(sheetOver(runtime)(handle, "2026-W42"), EDIT);
        assert.equal(result.type, "applied");
        const state = (handle as { read: () => SortedMap<string, Week> }).read();
        assert.deepEqual(state.get("2026-W42"), { starts: W42.starts, rows: [{ ...R1, qty: 50n }, R2, { id: "r3", task: "Sanding", qty: 6n }] });
        assert.deepEqual(state.get("2026-W43"), W43, "the other entry is untouched");
        const sent = decodeBeast2For(PatchType(PlansType))(requests[0]!.args[0]!);
        if (sent.type !== "patch") assert.fail(`expected a patch by key, got ${sent.type}`);
        assert.deepEqual([...sent.value.keys()], ["2026-W42"], "one entry");
        const op = sent.value.get("2026-W42")!;
        if (op.type !== "update" || op.value.type !== "patch") assert.fail("expected the week updated field by field");
        assert.equal(op.value.value.starts.type, "unchanged", "the week's other field is not in the write");
    });

    test("rows another write moved are a conflict, and nothing is overwritten", async () => {
        const { memory, runtime, handle } = plans();
        const moved: Week = { ...W42, rows: [R1, { ...R2, qty: 20n }] };
        const ops = new SortedMap([["2026-W42", variant("update", diffFor(WeekType)(W42, moved))]], keys);
        const wrote = await memory.mutate(ws, "plans", "patch", { args: [encodeBeast2For(PatchType(PlansType))(variant("patch", ops) as never)] });
        assert.equal(wrote.outcome.type, "committed");
        const result = await applyThrough(sheetOver(runtime)(handle, "2026-W42"), EDIT);
        assert.equal(result.type, "conflict");
        assert.deepEqual((handle as { read: () => SortedMap<string, Week> }).read().get("2026-W42"), moved);
    });

    test("another entry.key reads that entry under its own source, so each entry keeps its own session (SB17)", () => {
        const { runtime, handle } = plans();
        const sheet = sheetOver(runtime);
        const w43 = sheet(handle, "2026-W43");
        assert.deepEqual(ids(w43), ["r9"]);
        assert.equal(w43.editing.sourceId, "plans#2026-W43");
        assert.notEqual(w43.editing.sourceId, sheet(handle, "2026-W42").editing.sourceId);
    });

    test("an entry the record does not hold is an empty, read-only sheet, its key named for the banner (SB15)", () => {
        const { runtime, handle } = plans();
        const root = sheetOver(runtime)(handle, "2026-W50");
        assert.deepEqual(ids(root), []);
        assert.deepEqual(root.readOnly, some(true));
        assert.deepEqual(missingOf(runtime)(handle, "2026-W50"), some("2026-W50"));
        assert.deepEqual(missingOf(runtime)(handle, "2026-W42"), none);
    });
});
