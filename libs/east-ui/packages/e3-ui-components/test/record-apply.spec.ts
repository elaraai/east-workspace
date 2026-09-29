/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Record.onApply` over the runtime (#988): an editable collection's batch,
 * committed to a record through its patch door as one commit. The record is
 * the in-memory stand-in, whose patch mutation applies the patch with East's
 * own checks — a before the record no longer holds is a conflict — so each
 * Apply meets the checks a deployed record makes.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    ArrayType, DictType, East, IntegerType, OptionType, PatchType, SortedMap, StringType, StructType,
    applyFor, compareFor, decodeBeast2For, diffFor, encodeBeast2For, none, some, toEastTypeValue, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { Record, RecordBindHandleType } from "@elaraai/e3-ui/internal";
import type { TreePath } from "@elaraai/e3-types";
import type { MutationResult } from "@elaraai/e3-api-client";
import { datasetCacheKey, type ReactiveDatasetCacheInterface } from "../src/platform/dataset-store.js";
import { RecordRuntime, createInMemoryRecordApi, type RecordApi, type RecordMutateArgs } from "../src/platform/record-runtime.js";

const ws = "test-workspace";

const JobType = StructType({ task: StringType, qty: IntegerType });
const JobsType = DictType(StringType, JobType);
const JobsHandle = RecordBindHandleType(JobsType, { patch: [PatchType(JobsType)] });

type Job = ValueTypeOf<typeof JobType>;
type Result = ValueTypeOf<typeof Editing.Types.ApplyResult>;
type Apply = (handle: unknown, batch: unknown) => Promise<Result>;

const keys = compareFor(StringType);
/** An entry's composed patch, as the editing session diffs it. */
const entryPatch = diffFor(OptionType(JobType));
const encodeJobsPatch = encodeBeast2For(PatchType(JobsType));
const decodeJobsPatch = decodeBeast2For(PatchType(JobsType));

const CUT: Job = { task: "Cut", qty: 2n };
const WELD: Job = { task: "Weld", qty: 1n };

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

/**
 * A record in memory whose one mutation is its patch door, bound through a
 * runtime: the record's api, every request the runtime sent it, and the
 * bound handle.
 */
function inMemory<T extends DictType>(name: string, type: T, initial: ValueTypeOf<T>, handleType: StructType, wrap?: (api: RecordApi) => RecordApi) {
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
    runtime.initialize(wrap?.(recording) ?? recording, cache, ws);
    return { memory, requests, runtime, handle: runtime.buildHandle(toEastTypeValue(handleType), name) };
}

/** The jobs record, holding a cut and a weld. */
function jobs(wrap?: (api: RecordApi) => RecordApi) {
    return inMemory("jobs", JobsType, new SortedMap([["a", CUT], ["b", WELD]], keys), JobsHandle, wrap);
}

/** A Sheet's `onApply` over the jobs record, compiled against the runtime. */
function sheetApply(runtime: RecordRuntime): Apply {
    return East.compileAsync(East.asyncFunction([JobsHandle, Editing.Types.ChangeSet(JobType)], Editing.Types.ApplyResult, ($, record, batch) => {
        const apply = $.const(Record.onApply(record));
        return apply(batch);
    }), runtime.buildPrimitives()) as unknown as Apply;
}

/** A batch that takes the cut from 2 to 3, removes the weld and adds a paint job. */
const EDIT = {
    requestId: "apply-1", base: variant("revision", "r0"), label: "Edit jobs",
    changes: [
        { id: "a", patch: entryPatch(some(CUT), some({ task: "Cut", qty: 3n })), place: none },
        { id: "b", patch: entryPatch(some(WELD), none), place: none },
        { id: "c", patch: entryPatch(none, some({ task: "Paint", qty: 4n })), place: some(variant("keyOrder", null)) },
    ],
};

/** Another writer's change to one job, straight to the record. */
async function writeOver(memory: RecordApi, id: string, before: Job, after: Job): Promise<void> {
    const ops = new SortedMap([[id, variant("update", diffFor(JobType)(before, after))]], keys);
    const result = await memory.mutate(ws, "jobs", "patch", { args: [encodeJobsPatch(variant("patch", ops) as never)] });
    assert.equal(result.outcome.type, "committed");
}

describe("Record.onApply — over the record's own entries", () => {
    test("one Apply is one commit, each change its entry's insert, update or delete", async () => {
        const { memory, requests, runtime, handle } = jobs();
        const result = await sheetApply(runtime)(handle, EDIT);

        assert.equal(result.type, "applied");
        // Applied at the state it wrote, which a pinned source installs.
        assert.deepEqual((result.value as { revision: unknown }).revision, some("jobs-state-1".padEnd(64, "0")));
        const state = (handle as { read: () => SortedMap<string, Job> }).read();
        assert.deepEqual([...state.entries()], [["a", { task: "Cut", qty: 3n }], ["c", { task: "Paint", qty: 4n }]]);

        const { commits } = await memory.history(ws, "jobs", undefined);
        assert.deepEqual(commits.map(c => c.mutation), ["patch", "$init"], "one commit");
        assert.equal(requests.length, 1);
        assert.equal(requests[0]!.idempotencyKey, "apply-1", "the batch's request id keys the write");
        const sent = decodeJobsPatch(requests[0]!.args[0]!);
        if (sent.type !== "patch") assert.fail(`expected a patch by key, got ${sent.type}`);
        assert.deepEqual([...sent.value].map(([id, op]) => [id, op.type]), [["a", "update"], ["b", "delete"], ["c", "insert"]]);
    });

    test("a Plan's keyed batch commits the same way", async () => {
        const { runtime, handle } = jobs();
        const plan = East.compileAsync(East.asyncFunction([JobsHandle, Editing.Types.ChangeSet(JobType, StringType)], Editing.Types.ApplyResult, ($, record, batch) => {
            const apply = $.const(Record.onApply(record, { keyed: true }));
            return apply(batch);
        }), runtime.buildPrimitives()) as unknown as Apply;
        const result = await plan(handle, { ...EDIT, base: variant("snapshot", new SortedMap([["a", CUT], ["b", WELD]], keys)) });
        assert.equal(result.type, "applied");
    });

    test("a stale Apply is a conflict naming the entry another write moved, and who — nothing is overwritten", async () => {
        const { memory, runtime, handle } = jobs();
        await writeOver(memory, "a", CUT, { task: "Cut", qty: 5n });

        const result = await sheetApply(runtime)(handle, EDIT);
        assert.equal(result.type, "conflict");
        assert.deepEqual(result.value, [{ entry: "a", row: none, field: none, message: "Changed since this edit began — last changed by memory" }]);
        const state = (handle as { read: () => SortedMap<string, Job> }).read();
        assert.deepEqual([...state.entries()], [["a", { task: "Cut", qty: 5n }], ["b", WELD]], "the other write stands, and none of this one landed");
    });

    test("an entry another write moved is no conflict for a batch that leaves it alone", async () => {
        const { memory, runtime, handle } = jobs();
        await writeOver(memory, "b", WELD, { task: "Weld", qty: 4n });

        const onlyA = { ...EDIT, changes: [EDIT.changes[0]!] };
        const result = await sheetApply(runtime)(handle, onlyA);
        assert.equal(result.type, "applied");
        const state = (handle as { read: () => SortedMap<string, Job> }).read();
        assert.deepEqual([...state.entries()], [["a", { task: "Cut", qty: 3n }], ["b", { task: "Weld", qty: 4n }]]);
    });

    test("an invalid, failed or timed-out write is rejected with its message", async () => {
        const outcomes: [MutationResult["outcome"], RegExp][] = [
            [variant("invalid", { message: "no mutation \"patch\"" }), /^no mutation "patch"$/],
            [variant("failed", { exitCode: 1n, stderr: "index key failed" }), /^The write failed: index key failed$/],
            [variant("timed_out", { ms: 30000n, stderr: "" }), /^The write ran out of time after 30000 ms and wrote nothing$/],
        ];
        for (const [outcome, message] of outcomes) {
            const { runtime, handle } = jobs(api => ({ ...api, mutate: async () => ({ outcome }) as MutationResult }));
            const result = await sheetApply(runtime)(handle, EDIT);
            assert.equal(result.type, "rejected");
            const issues = result.value as { entry: string; message: string }[];
            assert.equal(issues.length, 1);
            assert.equal(issues[0]!.entry, "");
            assert.match(issues[0]!.message, message);
        }
    });

    test("an unanswered write throws, and its retry resolves to the commit it made rather than writing twice", async () => {
        let answered = false;
        const { memory, runtime, handle } = jobs(api => ({
            ...api,
            mutate: async (w, record, mutation, req) => {
                const result = await api.mutate(w, record, mutation, req);
                if (answered) return result;
                answered = true;
                throw new Error("gateway timeout");
            },
        }));
        const apply = sheetApply(runtime);
        await assert.rejects(apply(handle, EDIT), /no answer, so it may have committed/);

        const retried = await apply(handle, EDIT);
        assert.equal(retried.type, "applied");
        const { commits } = await memory.history(ws, "jobs", undefined);
        assert.deepEqual(commits.map(c => c.mutation), ["patch", "$init"], "written once");
    });
});

describe("Record.onApply — over a collection inside one entry", () => {
    const CellType = StructType({ key: StringType, span: IntegerType });
    const PageType = StructType({ title: StringType, cells: ArrayType(CellType) });
    const PagesType = DictType(StringType, PageType);
    const PagesHandle = RecordBindHandleType(PagesType, { patch: [PatchType(PagesType)] });
    type Page = ValueTypeOf<typeof PageType>;
    const HOME: Page = { title: "Home", cells: [{ key: "k1", span: 4n }, { key: "k2", span: 8n }] };

    function pages() {
        return inMemory("pages", PagesType, new SortedMap([["home", HOME]], keys), PagesHandle);
    }

    /** A Layout's `onApply` over the home page's cells, compiled against the runtime. */
    function cellsApply(runtime: RecordRuntime): Apply {
        return East.compileAsync(East.asyncFunction([PagesHandle, Editing.Types.ChangeSet(CellType)], Editing.Types.ApplyResult, ($, record, batch) => {
            const apply = $.const(Record.onApply(record, {
                entry: "home",
                get: East.function([PageType], ArrayType(CellType), (_$, page) => page.cells),
                set: East.function([PageType, ArrayType(CellType)], PageType, (_$, page, cells) => ({ title: page.title, cells })),
                idField: "key",
            }));
            return apply(batch);
        }), runtime.buildPrimitives()) as unknown as Apply;
    }

    const cellPatch = diffFor(OptionType(CellType));
    /** Widen the first cell, and add a third at the end. */
    const RESIZE = {
        requestId: "resize-1", base: variant("snapshot", HOME.cells), label: "Resize",
        changes: [
            { id: "k1", patch: cellPatch(some({ key: "k1", span: 4n }), some({ key: "k1", span: 6n })), place: none },
            { id: "k3", patch: cellPatch(none, some({ key: "k3", span: 2n })), place: some(variant("ordered", variant("end", null))) },
        ],
    };

    test("the patch reaches the entry's rows and nothing else", async () => {
        const { requests, runtime, handle } = pages();
        const result = await cellsApply(runtime)(handle, RESIZE);
        assert.equal(result.type, "applied");
        const home = (handle as { read: () => SortedMap<string, Page> }).read().get("home")!;
        assert.deepEqual(home, { title: "Home", cells: [{ key: "k1", span: 6n }, { key: "k2", span: 8n }, { key: "k3", span: 2n }] });

        const sent = decodeBeast2For(PatchType(PagesType))(requests[0]!.args[0]!);
        if (sent.type !== "patch") assert.fail(`expected a patch by key, got ${sent.type}`);
        const op = sent.value.get("home")!;
        if (op.type !== "update" || op.value.type !== "patch") assert.fail("expected the home page updated field by field");
        assert.equal(op.value.value.title.type, "unchanged", "the title is not in the write");
        assert.equal(op.value.value.cells.type, "patch");
    });

    test("another write to the entry's other fields is kept", async () => {
        const { memory, runtime, handle } = pages();
        const retitle = new SortedMap([["home", variant("update", diffFor(PageType)(HOME, { ...HOME, title: "Welcome" }))]], keys);
        await memory.mutate(ws, "pages", "patch", { args: [encodeBeast2For(PatchType(PagesType))(variant("patch", retitle) as never)] });

        const result = await cellsApply(runtime)(handle, RESIZE);
        assert.equal(result.type, "applied");
        const home = (handle as { read: () => SortedMap<string, Page> }).read().get("home")!;
        assert.equal(home.title, "Welcome");
        assert.equal(home.cells.length, 3);
    });

    test("rows another write moved are a conflict, and nothing is overwritten", async () => {
        const { memory, runtime, handle } = pages();
        const moved = { ...HOME, cells: [{ key: "k1", span: 4n }, { key: "k2", span: 12n }] };
        await memory.mutate(ws, "pages", "patch", {
            args: [encodeBeast2For(PatchType(PagesType))(variant("patch", new SortedMap([["home", variant("update", diffFor(PageType)(HOME, moved))]], keys)) as never)],
        });

        const result = await cellsApply(runtime)(handle, RESIZE);
        assert.equal(result.type, "conflict");
        const issues = result.value as { entry: string; message: string }[];
        assert.equal(issues.length, 1);
        assert.equal(issues[0]!.entry, "");
        assert.match(issues[0]!.message, /^The entry changed since this edit began/);
        assert.deepEqual((handle as { read: () => SortedMap<string, Page> }).read().get("home"), moved);
    });

    test("a batch checked by revision is refused — rows inside an entry are checked against their snapshot", async () => {
        const { runtime, handle } = pages();
        const result = await cellsApply(runtime)(handle, { ...RESIZE, base: variant("revision", "r0") });
        assert.equal(result.type, "rejected");
    });
});
