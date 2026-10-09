/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Record.onApply` over the runtime (#988): an editable collection's batch,
 * committed to a record through its patch door as one commit. The record is
 * the in-memory stand-in, whose patch mutation applies the patch with East's
 * own checks — a before the record no longer holds is a conflict — so each
 * Apply meets the checks a deployed record makes. A batch drafted over the
 * record read whole names the entries another write moved; one drafted at a
 * revision — over the record read a window at a time (#1199) — never reads the
 * record whole, and leaves naming them to its session. Every read of the
 * record whole is counted, but the stand-in server's own as it applies a
 * patch.
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
const GLUE: Job = { task: "Glue", qty: 1n };

/** The record's whole reads, counted — but the server's own, while it applies a patch. */
interface WholeReads {
    count: number;
    serving: boolean;
}

/** A dataset cache holding what the in-memory record writes into it, its reads counted. */
function fakeCache(reads: WholeReads): ReactiveDatasetCacheInterface {
    const store = new Map<string, Uint8Array>();
    return {
        read: (w: string, p: TreePath) => {
            if (!reads.serving) reads.count++;
            return store.get(datasetCacheKey(w, p));
        },
        getStatus: () => variant("up-to-date", null),
        async write(w: string, p: TreePath, v: Uint8Array) { store.set(datasetCacheKey(w, p), v); },
        async refresh() { /* the in-memory record writes the cache itself */ },
        async launchDataflow() { /* no dataflow */ },
    } as unknown as ReactiveDatasetCacheInterface;
}

/**
 * A record in memory whose one mutation is its patch door, bound through a
 * runtime: the record's api, every request the runtime sent it, the bound
 * handle, and the count of the record's whole reads but the server's own.
 */
function inMemory<T extends DictType>(name: string, type: T, initial: ValueTypeOf<T>, handleType: StructType, wrap?: (api: RecordApi) => RecordApi) {
    const reads: WholeReads = { count: 0, serving: false };
    const cache = fakeCache(reads);
    const applyPatch = applyFor(type);
    const memory = createInMemoryRecordApi(cache, ws, [{
        name, stateType: type, initial,
        mutations: [{ name: "patch", argTypes: [PatchType(type)], reduce: (state, patch) => applyPatch(state as never, patch) }],
    }]);
    const requests: RecordMutateArgs[] = [];
    const recording: RecordApi = {
        ...memory,
        mutate: (w, record, mutation, req) => {
            requests.push(req);
            // The server reads the record as it applies the patch, before its first wait.
            reads.serving = true;
            try {
                return memory.mutate(w, record, mutation, req);
            } finally {
                reads.serving = false;
            }
        },
    };
    const runtime = new RecordRuntime();
    runtime.initialize(wrap?.(recording) ?? recording, cache, ws);
    return { memory, requests, runtime, handle: runtime.buildHandle(toEastTypeValue(handleType), name), reads };
}

/** The jobs record, holding a cut job and a glue job. */
function jobs(wrap?: (api: RecordApi) => RecordApi) {
    return inMemory("jobs", JobsType, new SortedMap([["a", CUT], ["b", GLUE]], keys), JobsHandle, wrap);
}

/** A Sheet's `onApply` over the jobs record, compiled against the runtime. */
function sheetApply(runtime: RecordRuntime): Apply {
    return East.compileAsync(East.asyncFunction([JobsHandle, Editing.Types.ChangeSet(JobType)], Editing.Types.ApplyResult, ($, record, batch) => {
        const apply = $.const(Record.onApply(record));
        return apply(batch);
    }), runtime.buildPrimitives()) as unknown as Apply;
}

/** A batch that takes the cut from 2 to 3, removes the glue job and adds a spray job. */
const EDIT = {
    requestId: "apply-1", base: variant("revision", "r0"), label: "Edit jobs",
    changes: [
        { id: "a", patch: entryPatch(some(CUT), some({ task: "Cut", qty: 3n })), place: none },
        { id: "b", patch: entryPatch(some(GLUE), none), place: none },
        { id: "c", patch: entryPatch(none, some({ task: "Spray", qty: 4n })), place: some(variant("keyOrder", null)) },
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
        assert.deepEqual([...state.entries()], [["a", { task: "Cut", qty: 3n }], ["c", { task: "Spray", qty: 4n }]]);

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
        const result = await plan(handle, { ...EDIT, base: variant("snapshot", new SortedMap([["a", CUT], ["b", GLUE]], keys)) });
        assert.equal(result.type, "applied");
    });

    test("a stale Apply is a conflict naming the entry another write moved, and who — nothing is overwritten", async () => {
        const { memory, runtime, handle } = jobs();
        await writeOver(memory, "a", CUT, { task: "Cut", qty: 5n });

        // Drafted over the record read whole: its base the jobs as the edit began.
        const result = await sheetApply(runtime)(handle, { ...EDIT, base: variant("snapshot", new SortedMap([["a", CUT], ["b", GLUE]], keys)) });
        assert.equal(result.type, "conflict");
        assert.deepEqual(result.value, [{ entry: "a", row: none, field: none, message: "Changed since this edit began — last changed by memory" }]);
        const state = (handle as { read: () => SortedMap<string, Job> }).read();
        assert.deepEqual([...state.entries()], [["a", { task: "Cut", qty: 5n }], ["b", GLUE]], "the other write stands, and none of this one landed");
    });

    test("at a revision — over the record read a window at a time — a stale Apply never reads the record: it answers the record's own issue, what the record said and who changed it last, and each entry it changed in the words a moved one takes (#1199)", async () => {
        const { memory, runtime, handle, reads } = jobs();
        await writeOver(memory, "a", CUT, { task: "Cut", qty: 5n });
        const before = reads.count;

        const result = await sheetApply(runtime)(handle, EDIT);
        assert.equal(result.type, "conflict");
        assert.equal(reads.count, before, "the record is never read whole");
        const by = " — last changed by memory";
        const moved = (entry: string) => ({ entry, row: none, field: none, message: `Changed since this edit began${by}` });
        assert.deepEqual(result.value, [
            { entry: "", row: none, field: none, message: `The record changed since this edit began: primary: Cannot apply replace - expected 2, found 5${by}` },
            moved("a"), moved("b"), moved("c"),
        ]);
    });

    test("an entry another write moved is no conflict for a batch that leaves it alone", async () => {
        const { memory, runtime, handle } = jobs();
        await writeOver(memory, "b", GLUE, { task: "Glue", qty: 4n });

        const onlyA = { ...EDIT, changes: [EDIT.changes[0]!] };
        const result = await sheetApply(runtime)(handle, onlyA);
        assert.equal(result.type, "applied");
        const state = (handle as { read: () => SortedMap<string, Job> }).read();
        assert.deepEqual([...state.entries()], [["a", { task: "Cut", qty: 3n }], ["b", { task: "Glue", qty: 4n }]]);
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

describe("Record.onApply — over a Sheet's groups and loose rows inside one entry", () => {
    const LineType = StructType({ id: StringType, task: StringType });
    const GroupType = StructType({ id: StringType, name: StringType, lines: ArrayType(LineType) });
    const EntryType = Editing.Types.Entry(GroupType, "lines");
    const WeekType = StructType({ title: StringType, entries: ArrayType(EntryType) });
    const WeeksType = DictType(StringType, WeekType);
    const WeeksHandle = RecordBindHandleType(WeeksType, { patch: [PatchType(WeeksType)] });
    type Week = ValueTypeOf<typeof WeekType>;
    type Entry = ValueTypeOf<typeof EntryType>;

    const BRIEF: Entry = variant("row", { id: "brief", task: "Read the drawings" });
    const KITCHEN: Entry = variant("group", { id: "kitchen", name: "Kitchen", lines: [{ id: "cut", task: "Cut panels" }] });
    const W42: Week = { title: "Week 42", entries: [BRIEF, KITCHEN] };

    /** The weeks record, holding week 42: a loose task, then a group of one line. */
    function weeks() {
        return inMemory("weeks", WeeksType, new SortedMap([["w42", W42]], keys), WeeksHandle);
    }

    /** A Sheet's `onApply` over week 42's entries, compiled against the runtime. */
    function entriesApply(runtime: RecordRuntime): Apply {
        return East.compileAsync(East.asyncFunction([WeeksHandle, Editing.Types.ChangeSet(EntryType)], Editing.Types.ApplyResult, ($, record, batch) => {
            const apply = $.const(Record.onApply(record, {
                entry: "w42",
                get: East.function([WeekType], ArrayType(EntryType), (_$, week) => week.entries),
                set: East.function([WeekType, ArrayType(EntryType)], WeekType, (_$, week, entries) => ({ title: week.title, entries })),
                idField: "id",
            }));
            return apply(batch);
        }), runtime.buildPrimitives()) as unknown as Apply;
    }

    const entryChange = diffFor(OptionType(EntryType));
    const KITCHEN_OAK: Entry = variant("group", { id: "kitchen", name: "Kitchen, oak", lines: [{ id: "cut", task: "Cut panels" }] });
    const HANDOVER: Entry = variant("row", { id: "handover", task: "Hand over to finishing" });

    test("a group renamed and a loose row placed after it land as one commit, the week's other fields untouched", async () => {
        const { requests, runtime, handle } = weeks();
        const result = await entriesApply(runtime)(handle, {
            requestId: "week-1", base: variant("snapshot", W42.entries), label: "Edit the week",
            changes: [
                { id: "kitchen", patch: entryChange(some(KITCHEN), some(KITCHEN_OAK)), place: none },
                { id: "handover", patch: entryChange(none, some(HANDOVER)), place: some(variant("ordered", variant("after", "kitchen"))) },
            ],
        });
        assert.equal(result.type, "applied");
        const week = (handle as { read: () => SortedMap<string, Week> }).read().get("w42")!;
        assert.deepEqual(week, { title: "Week 42", entries: [BRIEF, KITCHEN_OAK, HANDOVER] });

        assert.equal(requests.length, 1, "one commit");
        const sent = decodeBeast2For(PatchType(WeeksType))(requests[0]!.args[0]!);
        if (sent.type !== "patch") assert.fail(`expected a patch by key, got ${sent.type}`);
        const op = sent.value.get("w42")!;
        if (op.type !== "update" || op.value.type !== "patch") assert.fail("expected week 42 updated field by field");
        assert.equal(op.value.value.title.type, "unchanged", "the title is not in the write");
    });

    test("an entry another write moved is a conflict, and nothing is overwritten", async () => {
        const { memory, runtime, handle } = weeks();
        const moved: Week = { ...W42, entries: [KITCHEN, BRIEF] };
        await memory.mutate(ws, "weeks", "patch", {
            args: [encodeBeast2For(PatchType(WeeksType))(variant("patch", new SortedMap([["w42", variant("update", diffFor(WeekType)(W42, moved))]], keys)) as never)],
        });
        const result = await entriesApply(runtime)(handle, {
            requestId: "week-2", base: variant("snapshot", W42.entries), label: "Rename",
            changes: [{ id: "kitchen", patch: entryChange(some(KITCHEN), some(KITCHEN_OAK)), place: none }],
        });
        assert.equal(result.type, "conflict");
        assert.deepEqual((handle as { read: () => SortedMap<string, Week> }).read().get("w42"), moved);
    });
});
