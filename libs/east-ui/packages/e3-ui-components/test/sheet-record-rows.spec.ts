/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's rows over the runtime (#1182, `Sheet Builder Spec.md`
 * SB13–SB17), on e3 itself (#1378): the sheet `recordRows` builds, committing
 * through its own wire Apply as the renderer sends a batch, to the records the
 * Sheet's examples module deploys — its jobs and its week plans — each through
 * its patch door. e3 applies the patch with its own checks — a before the
 * record no longer holds is a conflict — and another session's write is a real
 * commit before it. Both forms: the record's entries as the rows, and one
 * entry's rows.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    East, OptionType, PatchType, SortedMap, StringType,
    compareFor, decodeBeast2For, diffFor, encodeBeast2For, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { RecordBindHandleType, Sheet, createSheetRootWith, recordRows } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { MutationCallRequestType } from "@elaraai/e3-types";
import type { RecordRuntime } from "../src/platform/record-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "sheet/sheet": ex });

const keys = compareFor(StringType);

type Root = ValueTypeOf<typeof Sheet.Types.Root>;
type Result = ValueTypeOf<typeof Editing.Types.ApplyResult>;

/** The sheet's own wire Apply, as the renderer calls it with a batch's bytes. */
async function applyThrough(root: Root, batch: Uint8Array): Promise<Result> {
    if (root.editing.onApply.type !== "some") assert.fail("the sheet has no Apply");
    return await root.editing.onApply.value.value(batch);
}

const ids = (root: Root): string[] => {
    if (root.rows.type !== "inline") assert.fail(`expected inline rows, got ${root.rows.type}`);
    return root.rows.value.map((row) => row.id);
};

/** The patches a record's mutation requests sent, decoded by the record's patch type. */
function sentPatches<T extends typeof ex.sheetJobs.type | typeof ex.sheetWeekPlans.type>(record: { readonly name: string; readonly type: T }) {
    const decode = decodeBeast2For(PatchType(record.type));
    return h.requests("mutate", record.name).map((request) => ({
        request, patch: decode(decodeBeast2For(MutationCallRequestType)(request.body!).args[0]!),
    }));
}

describe("the record's entries are the rows", () => {
    const JobType = ex.SheetJob;
    const JobsType = ex.sheetJobs.type;
    const JobsHandle = RecordBindHandleType(JobsType, { patch: [PatchType(JobsType)] });
    type Job = ValueTypeOf<typeof JobType>;
    const COLUMNS = { task: Sheet.column.text(JobType, { header: "Task" }), qty: Sheet.column.quantity(JobType, { header: "Qty" }) };
    const entryPatch = diffFor(OptionType(JobType));
    const encodeBatch = encodeBeast2For(Editing.Types.ChangeSet(JobType, StringType));
    const SANDING: Job = { task: "Sanding", start: none, qty: some(6.0) };

    /** The jobs, read whole as a sheet over them holds them, and what e3 holds of them as the test begins. */
    async function jobs() {
        const held = await h.read(ex.sheetJobs);
        return { held, ...await h.bindRecord(ex.sheetJobs, JobsHandle, { whole: true }) };
    }
    /** The sheet over the jobs record, compiled against the runtime. */
    function sheetOver(runtime: RecordRuntime): (handle: unknown) => Root {
        return East.compile(East.function([JobsHandle], Sheet.Types.Root, ($, record) => {
            const rows = recordRows(record);
            return createSheetRootWith(rows.data, COLUMNS, rows.options, rows.internal);
        }), runtime.buildPrimitives()) as unknown as (handle: unknown) => Root;
    }
    /** Takes J-0001 from 48 to 50, removes J-0002 and adds J-0005, over the snapshot the session began from. */
    function edit(held: ValueTypeOf<typeof JobsType>): Uint8Array {
        const cut = held.get("J-0001")!;
        const band = held.get("J-0002")!;
        return encodeBatch({
            requestId: "jobs-1", base: variant("snapshot", held), label: "Edit jobs",
            changes: [
                { id: "J-0001", patch: entryPatch(some(cut), some({ ...cut, qty: some(50.0) })), place: none },
                { id: "J-0002", patch: entryPatch(some(band), none), place: none },
                { id: "J-0005", patch: entryPatch(none, some(SANDING)), place: some(variant("keyOrder", null)) },
            ],
        });
    }

    test("the rows are the entries in key order, the session's source the record (SB13)", async () => {
        const { runtime, handle } = await jobs();
        const root = sheetOver(runtime)(handle);
        assert.deepEqual(ids(root), ["J-0001", "J-0002", "J-0003", "J-0004"]);
        assert.equal(root.editing.sourceId, ex.sheetJobs.name);
    });

    test("an insert, an update and a delete by key in one batch are one commit (SB16)", async () => {
        const { held, runtime, handle } = await jobs();
        const result = await applyThrough(sheetOver(runtime)(handle), edit(held));
        assert.equal(result.type, "applied");
        const state = await h.read(ex.sheetJobs);
        assert.deepEqual([...state.keys()], ["J-0001", "J-0003", "J-0004", "J-0005"]);
        assert.deepEqual(state.get("J-0001")!.qty, some(50.0));
        assert.deepEqual(state.get("J-0005"), SANDING);
        const { commits } = await h.history(ex.sheetJobs);
        assert.deepEqual(commits.map((c) => c.mutation), ["patch", "$init"], "one commit");
        const [sent] = sentPatches(ex.sheetJobs);
        if (sent?.patch.type !== "patch") assert.fail(`expected a patch by key, got ${sent?.patch.type}`);
        assert.deepEqual([...sent.patch.value].map(([id, op]) => [id, op.type]), [["J-0001", "update"], ["J-0002", "delete"], ["J-0005", "insert"]]);
        assert.equal(sent.request.idempotencyKey, "jobs-1", "the batch's request id keys the write");
    });

    test("a row another write moved is a conflict naming it, and nothing is overwritten", async () => {
        const { held, runtime, handle } = await jobs();
        const cut = held.get("J-0001")!;
        await h.patch(ex.sheetJobs, new SortedMap([...held].map(([id, job]) => [id, id === "J-0001" ? { ...cut, qty: some(60.0) } : job] as const), keys));
        const result = await applyThrough(sheetOver(runtime)(handle), edit(held));
        assert.equal(result.type, "conflict");
        assert.deepEqual((result.value as { entry: string }[]).map((issue) => issue.entry), ["J-0001"]);
        const state = await h.read(ex.sheetJobs);
        assert.deepEqual(state.get("J-0001")!.qty, some(60.0));
        assert.deepEqual([...state.keys()], ["J-0001", "J-0002", "J-0003", "J-0004"], "none of this write landed");
    });
});

describe("one entry's rows", () => {
    const WeekRow = ex.WeekRow;
    const WeekPlan = ex.WeekPlan;
    const PlansType = ex.sheetWeekPlans.type;
    const PlansHandle = RecordBindHandleType(PlansType, { patch: [PatchType(PlansType)] });
    type Plan = ValueTypeOf<typeof WeekPlan>;
    type Row = ValueTypeOf<typeof WeekRow>;
    const COLUMNS = { task: Sheet.column.text(WeekRow, { header: "Task" }), qty: Sheet.column.quantity(WeekRow, { header: "Qty" }) };
    const rowPatch = diffFor(OptionType(WeekRow));
    const encodeBatch = encodeBeast2For(Editing.Types.ChangeSet(WeekRow));
    const SAND: Row = {
        id: "w42-4", task: "Sand the door panels", start: none, qty: some(6.0), setups: none, site: "Bench room",
        status: "PLANNED", code: "", level: variant("day", null), started: none, machines: { from: [], to: [] },
    };

    /** The week plans, read whole as a sheet over one of them holds them, and week 42 as e3 holds it as the test begins. */
    async function plans() {
        const w42 = (await h.read(ex.sheetWeekPlans)).get("2026-W42")!;
        return { w42, ...await h.bindRecord(ex.sheetWeekPlans, PlansHandle, { whole: true }) };
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
    /** Takes the first row from 48 to 50, and adds a row after the second, over the rows the session began from. */
    function edit(w42: Plan): Uint8Array {
        const first = w42.rows[0]!;
        return encodeBatch({
            requestId: "week-1", base: variant("snapshot", w42.rows), label: "Edit the week",
            changes: [
                { id: first.id, patch: rowPatch(some(first), some({ ...first, qty: some(50.0) })), place: none },
                { id: SAND.id, patch: rowPatch(none, some(SAND)), place: some(variant("ordered", variant("after", w42.rows[1]!.id))) },
            ],
        });
    }

    test("the rows are the entry's field in their own order, the session's source the record and the entry (SB15)", async () => {
        const { runtime, handle } = await plans();
        const root = sheetOver(runtime)(handle, "2026-W42");
        assert.deepEqual(ids(root), ["w42-1", "w42-2", "w42-3"]);
        assert.equal(root.editing.sourceId, `${ex.sheetWeekPlans.name}#2026-W42`);
        assert.deepEqual(root.readOnly, some(false));
    });

    test("Apply is one diff of that entry, reaching its rows and nothing else (SB16)", async () => {
        const { w42, runtime, handle } = await plans();
        const w43 = (await h.read(ex.sheetWeekPlans)).get("2026-W43");
        const result = await applyThrough(sheetOver(runtime)(handle, "2026-W42"), edit(w42));
        assert.equal(result.type, "applied");
        const state = await h.read(ex.sheetWeekPlans);
        const [first, second, third] = w42.rows;
        assert.deepEqual(state.get("2026-W42"), { starts: w42.starts, rows: [{ ...first!, qty: some(50.0) }, second!, SAND, third!] });
        assert.deepEqual(state.get("2026-W43"), w43, "the other entry is untouched");
        const [sent] = sentPatches(ex.sheetWeekPlans);
        if (sent?.patch.type !== "patch") assert.fail(`expected a patch by key, got ${sent?.patch.type}`);
        assert.deepEqual([...sent.patch.value.keys()], ["2026-W42"], "one entry");
        const op = sent.patch.value.get("2026-W42")!;
        if (op.type !== "update" || op.value.type !== "patch") assert.fail("expected the week updated field by field");
        assert.equal(op.value.value.starts.type, "unchanged", "the week's other field is not in the write");
    });

    test("rows another write moved are a conflict, and nothing is overwritten", async () => {
        const { w42, cache, runtime, handle } = await plans();
        const moved: Plan = { ...w42, rows: [w42.rows[0]!, { ...w42.rows[1]!, qty: some(200.0) }, w42.rows[2]!] };
        const held = await h.read(ex.sheetWeekPlans);
        await h.patch(ex.sheetWeekPlans, new SortedMap([...held].map(([week, plan]) => [week, week === "2026-W42" ? moved : plan] as const), keys));
        // The sheet's next poll brings it the week as the other write left it.
        await cache.refresh(h.workspace);
        await h.settle();
        const result = await applyThrough(sheetOver(runtime)(handle, "2026-W42"), edit(w42));
        assert.equal(result.type, "conflict");
        assert.deepEqual((await h.read(ex.sheetWeekPlans)).get("2026-W42"), moved);
    });

    test("another entry.key reads that entry under its own source, so each entry keeps its own session (SB17)", async () => {
        const { runtime, handle } = await plans();
        const sheet = sheetOver(runtime);
        const w43 = sheet(handle, "2026-W43");
        assert.deepEqual(ids(w43), ["w43-1", "w43-2"]);
        assert.equal(w43.editing.sourceId, `${ex.sheetWeekPlans.name}#2026-W43`);
        assert.notEqual(w43.editing.sourceId, sheet(handle, "2026-W42").editing.sourceId);
    });

    test("an entry the record does not hold is an empty, read-only sheet, its key named for the banner (SB15)", async () => {
        const { runtime, handle } = await plans();
        const root = sheetOver(runtime)(handle, "2026-W50");
        assert.deepEqual(ids(root), []);
        assert.deepEqual(root.readOnly, some(true));
        assert.deepEqual(missingOf(runtime)(handle, "2026-W50"), some("2026-W50"));
        assert.deepEqual(missingOf(runtime)(handle, "2026-W42"), none);
    });
});
