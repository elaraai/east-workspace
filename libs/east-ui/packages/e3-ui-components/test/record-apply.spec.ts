/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Record.onApply` over the runtime (#988), on e3 itself (#1378): an editable
 * collection's batch, committed to a record the Record.bind examples' module
 * deploys through its patch door, as one commit. e3 applies the patch with its
 * own checks — a before the record no longer holds is a conflict — and another
 * session's write is a real commit before it. A batch drafted over the record
 * read whole — loaded into the dataset cache and polled, as a Sheet over it
 * holds it — names the entries another write moved; one drafted at a revision
 * — over the record read a window at a time (#1199), nothing of it loaded —
 * never reads the record whole, and leaves naming them to its session.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    DictType, East, OptionType, PatchType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, diffFor, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { Record, RecordBindHandleType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/record/record";
import { MutationCallRequestType } from "@elaraai/e3-types";
import type { E3Record } from "../src/e3-web.test-utils.js";
import type { RecordRuntime } from "../src/platform/record-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/record/record": ex });

/** e3's deadline for a write that names none: what a patch's program runs under. */
const WRITE_DEADLINE_MS = 60_000;

/** Who another session's commits name. */
const ANOTHER = "another session";

const JobType = ex.JobType;
const JobsType = ex.jobs.type;
const JobsHandle = RecordBindHandleType(JobsType, { patch: [PatchType(JobsType)] });

type Job = ValueTypeOf<typeof JobType>;
type Result = ValueTypeOf<typeof Editing.Types.ApplyResult>;
type Apply = (handle: unknown, batch: unknown) => Promise<Result>;

const keys = compareFor(StringType);
/** An entry's composed patch, as the editing session diffs it. */
const entryPatch = diffFor(OptionType(JobType));
const decodeJobsPatch = decodeBeast2For(PatchType(JobsType));

const CUT: Job = { task: "Cut", qty: 2n };
const GLUE: Job = { task: "Glue", qty: 1n };
/** The jobs as another session leaves them before each test: a cut job and a glue job. */
const CUT_AND_GLUE = new SortedMap([["a", CUT], ["b", GLUE]], keys);

/**
 * A record bound through a runtime over e3 in the test's workspace, once
 * another session has committed `initial` to it.
 *
 * @param record - The record, which declares a patch door
 * @param handleType - The handle's type, its patch door among its mutations
 * @param initial - What another session commits to it first
 * @param whole - Whether the record is read whole, as a Sheet over it holds it: loaded into the cache and polled.
 *   Otherwise it is read a window at a time, and nothing of it is loaded.
 */
async function bound<T extends DictType>(record: E3Record<T>, handleType: StructType, initial: ValueTypeOf<T>, whole: boolean) {
    await h.patch(record, initial);
    return h.bindRecord(record, handleType, { whole });
}

/** The jobs record, holding a cut job and a glue job. */
const jobs = (whole: boolean) => bound(ex.jobs, JobsHandle, CUT_AND_GLUE, whole);

/** A Sheet's `onApply` over a record of jobs, compiled against the runtime. */
function sheetApply(runtime: RecordRuntime): Apply {
    return East.compileAsync(East.asyncFunction([JobsHandle, Editing.Types.ChangeSet(JobType)], Editing.Types.ApplyResult, ($, record, batch) => {
        const apply = $.const(Record.onApply(record));
        return apply(batch);
    }), runtime.buildPrimitives()) as unknown as Apply;
}

/** A batch that takes the cut from 2 to 3, removes the glue job and adds a spray job, drafted at a revision. */
const EDIT = {
    requestId: "apply-1", base: variant("revision", "r0"), label: "Edit jobs",
    changes: [
        { id: "a", patch: entryPatch(some(CUT), some({ task: "Cut", qty: 3n })), place: none },
        { id: "b", patch: entryPatch(some(GLUE), none), place: none },
        { id: "c", patch: entryPatch(none, some({ task: "Spray", qty: 4n })), place: some(variant("keyOrder", null)) },
    ],
};

/** The patches a record's mutation requests sent, decoded by the record's patch type. */
function sentPatches<T extends DictType>(record: E3Record<T>) {
    const decode = decodeBeast2For(PatchType(record.type));
    return h.requests("mutate", record.name).map((request) => ({
        request, patch: decode(decodeBeast2For(MutationCallRequestType)(request.body!).args[0]!),
    }));
}

describe("Record.onApply — over the record's own entries", () => {
    test("one Apply is one commit, each change its entry's insert, update or delete", async () => {
        const { runtime, handle } = await jobs(false);
        const result = await sheetApply(runtime)(handle, EDIT);

        assert.equal(result.type, "applied");
        const { commits } = await h.history(ex.jobs);
        // Applied at the state it wrote, which a pinned source installs.
        assert.deepEqual((result.value as { revision: unknown }).revision, some(commits[0]!.state));
        assert.deepEqual([...(await h.read(ex.jobs)).entries()], [["a", { task: "Cut", qty: 3n }], ["c", { task: "Spray", qty: 4n }]]);
        assert.deepEqual(commits.map(c => c.mutation), ["patch", "patch", "$init"], "one commit, after another session's");

        const sent = h.requests("mutate", ex.jobs.name);
        assert.equal(sent.length, 1);
        assert.equal(sent[0]!.idempotencyKey, "apply-1", "the batch's request id keys the write");
        const patch = decodeJobsPatch(decodeBeast2For(MutationCallRequestType)(sent[0]!.body!).args[0]!);
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value].map(([id, op]) => [id, op.type]), [["a", "update"], ["b", "delete"], ["c", "insert"]]);
    });

    test("a Plan's keyed batch commits the same way", async () => {
        const { runtime, handle } = await jobs(true);
        const plan = East.compileAsync(East.asyncFunction([JobsHandle, Editing.Types.ChangeSet(JobType, StringType)], Editing.Types.ApplyResult, ($, record, batch) => {
            const apply = $.const(Record.onApply(record, { keyed: true }));
            return apply(batch);
        }), runtime.buildPrimitives()) as unknown as Apply;
        const result = await plan(handle, { ...EDIT, base: variant("snapshot", CUT_AND_GLUE) });
        assert.equal(result.type, "applied");
        assert.deepEqual([...(await h.read(ex.jobs)).keys()], ["a", "c"]);
    });

    test("a stale Apply is a conflict naming the entry another write moved, and who — nothing is overwritten", async () => {
        const { runtime, handle } = await jobs(true);
        await h.patch(ex.jobs, new SortedMap([["a", { task: "Cut", qty: 5n }], ["b", GLUE]], keys));

        // Drafted over the record read whole: its base the jobs as the edit began.
        const result = await sheetApply(runtime)(handle, { ...EDIT, base: variant("snapshot", CUT_AND_GLUE) });
        assert.equal(result.type, "conflict");
        assert.deepEqual(result.value, [{ entry: "a", row: none, field: none, message: `Changed since this edit began — last changed by ${ANOTHER}` }]);
        assert.deepEqual([...(await h.read(ex.jobs)).entries()], [["a", { task: "Cut", qty: 5n }], ["b", GLUE]], "the other write stands, and none of this one landed");
    });

    test("at a revision — over the record read a window at a time — a stale Apply never reads the record: it answers the record's own issue, what the record said and who changed it last, and each entry it changed in the words a moved one takes (#1199)", async () => {
        const { runtime, handle } = await jobs(false);
        await h.patch(ex.jobs, new SortedMap([["a", { task: "Cut", qty: 5n }], ["b", GLUE]], keys));

        // Nothing of the record is loaded: a read of it whole would throw, and fail the Apply.
        const result = await sheetApply(runtime)(handle, EDIT);
        assert.equal(result.type, "conflict");
        assert.deepEqual(h.requests("read", "records.jobs"), [], "the record is never read whole");
        const by = ` — last changed by ${ANOTHER}`;
        const moved = (entry: string) => ({ entry, row: none, field: none, message: `Changed since this edit began${by}` });
        const [own, ...entries] = result.value as { entry: string; message: string }[];
        assert.equal(own!.entry, "");
        assert.match(own!.message, new RegExp(`^The record changed since this edit began: .+${by}$`));
        assert.deepEqual(entries, [moved("a"), moved("b"), moved("c")]);
    });

    test("an entry another write moved is no conflict for a batch that leaves it alone", async () => {
        const { runtime, handle } = await jobs(false);
        await h.patch(ex.jobs, new SortedMap([["a", CUT], ["b", { task: "Glue", qty: 4n }]], keys));

        const onlyA = { ...EDIT, changes: [EDIT.changes[0]!] };
        const result = await sheetApply(runtime)(handle, onlyA);
        assert.equal(result.type, "applied");
        assert.deepEqual([...(await h.read(ex.jobs)).entries()], [["a", { task: "Cut", qty: 3n }], ["b", { task: "Glue", qty: 4n }]]);
    });

    test("a write the record has no door for is rejected with what the runtime found", async () => {
        // The counter is no Dict of jobs, and has no patch door: the runtime refuses the write before sending it.
        const { runtime, handle } = await h.bindRecord(ex.counter, JobsHandle);
        const result = await sheetApply(runtime)(handle, EDIT);
        assert.equal(result.type, "rejected");
        const issues = result.value as { entry: string; message: string }[];
        assert.deepEqual(issues.map((issue) => issue.entry), [""]);
        assert.match(issues[0]!.message, /^no mutation "patch" on record "counter" in the deployed package$/);
        assert.deepEqual(h.requests("mutate"), []);
    });

    test("a write e3's program fails is rejected with its message", async () => {
        // The checked jobs' index refuses a quantity below zero.
        const { runtime, handle } = await bound(ex.checkedJobs, JobsHandle, CUT_AND_GLUE, false);
        const below = { ...EDIT, changes: [{ id: "a", patch: entryPatch(some(CUT), some({ task: "Cut", qty: -1n })), place: none }] };
        const result = await sheetApply(runtime)(handle, below);
        assert.equal(result.type, "rejected");
        const issues = result.value as { entry: string; message: string }[];
        assert.deepEqual(issues.map((issue) => issue.entry), [""]);
        assert.match(issues[0]!.message, /^The write failed: [\s\S]*a job's quantity is never below zero/);
        assert.deepEqual([...(await h.read(ex.checkedJobs)).entries()], [["a", CUT], ["b", GLUE]], "nothing was written");
    });

    test("a write past e3's deadline is rejected with its message", async (t) => {
        const { runtime, handle } = await bound(ex.checkedJobs, JobsHandle, CUT_AND_GLUE, false);
        // The checked jobs' patch runs their index's program as a unit, which e3 times from when it starts it: held
        // as it starts, it runs on past its deadline while the clock e3 times it by moves on. The clock is e3's until
        // the write has ended: e3 clears its deadline's timer as the run stops, which only the clock that set it knows.
        const units = h.e3.holdUnits();
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const applying = sheetApply(runtime)(handle, EDIT);
        await units.holding;
        t.mock.timers.tick(WRITE_DEADLINE_MS);
        const result = await applying;
        t.mock.timers.reset();
        assert.equal(result.type, "rejected");
        const issues = result.value as { entry: string; message: string }[];
        assert.deepEqual(issues.map((issue) => issue.entry), [""]);
        assert.equal(issues[0]!.message, `The write ran out of time after ${WRITE_DEADLINE_MS} ms and wrote nothing`);
        assert.deepEqual([...(await h.read(ex.checkedJobs)).entries()], [["a", CUT], ["b", GLUE]], "nothing was written");
    });

    test("an unanswered write throws, and its retry resolves to the commit it made rather than writing twice", async () => {
        const { runtime, handle } = await jobs(false);
        // e3 answers every try of the write, and no answer arrives: the first commits, and each retry under its key
        // finds that commit.
        const answered = h.e3.fail((request) => request.kind === "mutate" && request.record === ex.jobs.name, "lost");
        const apply = sheetApply(runtime);
        await assert.rejects(apply(handle, EDIT), /no answer, so it may have committed/);

        answered();
        const retried = await apply(handle, EDIT);
        assert.equal(retried.type, "applied");
        const { commits } = await h.history(ex.jobs);
        assert.deepEqual(commits.map(c => c.mutation), ["patch", "patch", "$init"], "written once, after another session's");
        assert.ok(h.requests("mutate", ex.jobs.name).every((request) => request.idempotencyKey === "apply-1"), "every try under the batch's key");
    });
});

describe("Record.onApply — over a collection inside one entry", () => {
    const CellType = ex.CellType;
    const PageType = ex.PageType;
    const PagesType = ex.layoutPages.type;
    const PagesHandle = RecordBindHandleType(PagesType, { patch: [PatchType(PagesType)] });
    type Page = ValueTypeOf<typeof PageType>;
    const HOME: Page = { title: "Home", cells: [{ key: "k1", span: 4n }, { key: "k2", span: 8n }] };

    /** The pages, holding the home page, read whole as a layout over it holds them. */
    const pages = () => bound(ex.layoutPages, PagesHandle, new SortedMap([["home", HOME]], keys), true);

    /** A Layout's `onApply` over the home page's cells, compiled against the runtime. */
    function cellsApply(runtime: RecordRuntime): Apply {
        return East.compileAsync(East.asyncFunction([PagesHandle, Editing.Types.ChangeSet(CellType)], Editing.Types.ApplyResult, ($, record, batch) => {
            const apply = $.const(Record.onApply(record, {
                entry: "home",
                get: East.function([PageType], ex.PageType.fields.cells, (_$, page) => page.cells),
                set: East.function([PageType, ex.PageType.fields.cells], PageType, (_$, page, cells) => ({ title: page.title, cells })),
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
        const { runtime, handle } = await pages();
        const result = await cellsApply(runtime)(handle, RESIZE);
        assert.equal(result.type, "applied");
        const home = (await h.read(ex.layoutPages)).get("home")!;
        assert.deepEqual(home, { title: "Home", cells: [{ key: "k1", span: 6n }, { key: "k2", span: 8n }, { key: "k3", span: 2n }] });

        const [sent] = sentPatches(ex.layoutPages);
        if (sent?.patch.type !== "patch") assert.fail(`expected a patch by key, got ${sent?.patch.type}`);
        const op = sent.patch.value.get("home")!;
        if (op.type !== "update" || op.value.type !== "patch") assert.fail("expected the home page updated field by field");
        assert.equal(op.value.value.title.type, "unchanged", "the title is not in the write");
        assert.equal(op.value.value.cells.type, "patch");
    });

    test("another write to the entry's other fields is kept", async () => {
        const { runtime, handle } = await pages();
        await h.patch(ex.layoutPages, new SortedMap([["home", { ...HOME, title: "Welcome" }]], keys));

        const result = await cellsApply(runtime)(handle, RESIZE);
        assert.equal(result.type, "applied");
        const home = (await h.read(ex.layoutPages)).get("home")!;
        assert.equal(home.title, "Welcome");
        assert.equal(home.cells.length, 3);
    });

    test("rows another write moved are a conflict, and nothing is overwritten", async () => {
        const { cache, runtime, handle } = await pages();
        const moved = { ...HOME, cells: [{ key: "k1", span: 4n }, { key: "k2", span: 12n }] };
        await h.patch(ex.layoutPages, new SortedMap([["home", moved]], keys));
        // The layout's next poll brings it the page as the other write left it.
        await cache.refresh(h.workspace);
        await h.settle();

        const result = await cellsApply(runtime)(handle, RESIZE);
        assert.equal(result.type, "conflict");
        const issues = result.value as { entry: string; message: string }[];
        assert.equal(issues.length, 1);
        assert.equal(issues[0]!.entry, "");
        assert.match(issues[0]!.message, /^The entry changed since this edit began/);
        assert.deepEqual((await h.read(ex.layoutPages)).get("home"), moved);
        assert.deepEqual(h.requests("mutate"), [], "nothing was sent");
    });

    test("a batch checked by revision is refused — rows inside an entry are checked against their snapshot", async () => {
        const { runtime, handle } = await pages();
        const result = await cellsApply(runtime)(handle, { ...RESIZE, base: variant("revision", "r0") });
        assert.equal(result.type, "rejected");
        assert.deepEqual(h.requests("mutate"), []);
    });
});

describe("Record.onApply — over a Sheet's groups and loose rows inside one entry", () => {
    const EntryType = ex.WeekEntryType;
    const WeekType = ex.WeekType;
    const WeeksType = ex.plannedWeeks.type;
    const WeeksHandle = RecordBindHandleType(WeeksType, { patch: [PatchType(WeeksType)] });
    type Week = ValueTypeOf<typeof WeekType>;
    type Entry = ValueTypeOf<typeof EntryType>;

    const BRIEF: Entry = variant("row", { id: "brief", task: "Read the drawings" });
    const KITCHEN: Entry = variant("group", { id: "kitchen", name: "Kitchen", lines: [{ id: "cut", task: "Cut panels" }] });
    const W42: Week = { title: "Week 42", entries: [BRIEF, KITCHEN] };

    /** The weeks, holding week 42 — a loose task, then a group of one line — read whole as a Sheet over them holds them. */
    const weeks = () => bound(ex.plannedWeeks, WeeksHandle, new SortedMap([["w42", W42]], keys), true);

    /** A Sheet's `onApply` over week 42's entries, compiled against the runtime. */
    function entriesApply(runtime: RecordRuntime): Apply {
        return East.compileAsync(East.asyncFunction([WeeksHandle, Editing.Types.ChangeSet(EntryType)], Editing.Types.ApplyResult, ($, record, batch) => {
            const apply = $.const(Record.onApply(record, {
                entry: "w42",
                get: East.function([WeekType], WeekType.fields.entries, (_$, week) => week.entries),
                set: East.function([WeekType, WeekType.fields.entries], WeekType, (_$, week, entries) => ({ title: week.title, entries })),
                idField: "id",
            }));
            return apply(batch);
        }), runtime.buildPrimitives()) as unknown as Apply;
    }

    const entryChange = diffFor(OptionType(EntryType));
    const KITCHEN_REVISED: Entry = variant("group", { id: "kitchen", name: "Kitchen, revised", lines: [{ id: "cut", task: "Cut panels" }] });
    const HANDOVER: Entry = variant("row", { id: "handover", task: "Hand over to finishing" });

    test("a group renamed and a loose row placed after it land as one commit, the week's other fields untouched", async () => {
        const { runtime, handle } = await weeks();
        const result = await entriesApply(runtime)(handle, {
            requestId: "week-1", base: variant("snapshot", W42.entries), label: "Edit the week",
            changes: [
                { id: "kitchen", patch: entryChange(some(KITCHEN), some(KITCHEN_REVISED)), place: none },
                { id: "handover", patch: entryChange(none, some(HANDOVER)), place: some(variant("ordered", variant("after", "kitchen"))) },
            ],
        });
        assert.equal(result.type, "applied");
        assert.deepEqual((await h.read(ex.plannedWeeks)).get("w42"), { title: "Week 42", entries: [BRIEF, KITCHEN_REVISED, HANDOVER] });

        const sent = sentPatches(ex.plannedWeeks);
        assert.equal(sent.length, 1, "one commit");
        const patch = sent[0]!.patch;
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        const op = patch.value.get("w42")!;
        if (op.type !== "update" || op.value.type !== "patch") assert.fail("expected week 42 updated field by field");
        assert.equal(op.value.value.title.type, "unchanged", "the title is not in the write");
    });

    test("an entry another write moved is a conflict, and nothing is overwritten", async () => {
        const { cache, runtime, handle } = await weeks();
        const moved: Week = { ...W42, entries: [KITCHEN, BRIEF] };
        await h.patch(ex.plannedWeeks, new SortedMap([["w42", moved]], keys));
        // The Sheet's next poll brings it the week as the other write left it.
        await cache.refresh(h.workspace);
        await h.settle();

        const result = await entriesApply(runtime)(handle, {
            requestId: "week-2", base: variant("snapshot", W42.entries), label: "Rename",
            changes: [{ id: "kitchen", patch: entryChange(some(KITCHEN), some(KITCHEN_REVISED)), place: none }],
        });
        assert.equal(result.type, "conflict");
        assert.deepEqual((await h.read(ex.plannedWeeks)).get("w42"), moved);
    });
});
