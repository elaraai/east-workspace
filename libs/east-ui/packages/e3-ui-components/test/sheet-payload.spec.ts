/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sheet>`'s payload over the runtime (#1183, #1216, `Sheet Builder Spec.md`
 * SB11, SB12, SB15, SB16), on e3 itself (#1378): built over the records the
 * Sheet's examples module deploys — its jobs and its week plans — and the
 * State runtime. The sheet holds the record's entries and commits through it,
 * the views — each every source's narrowing, by name (#1345) — are read from
 * their bind handle and written back to it, and one entry's payload names an
 * entry the record does not hold and keeps its sheet read-only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    ArrayType, East, OptionType, PatchType, SortedMap, StringType,
    compareFor, diffFor, encodeBeast2For, equalFor, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Editing, State } from "@elaraai/east-ui/internal";
import { RecordBindHandleType, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { StateImpl, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "sheet/sheet": ex });

const keys = compareFor(StringType);
type Payload = ValueTypeOf<typeof SheetPayloadType>;

const ids = (payload: Payload): string[] => {
    if (payload.sheet.rows.type !== "inline") assert.fail(`expected inline rows, got ${payload.sheet.rows.type}`);
    return payload.sheet.rows.value.map((row) => row.id);
};

describe("the record's entries", () => {
    const JobType = ex.SheetJob;
    const JobsType = ex.sheetJobs.type;
    const JobsHandle = RecordBindHandleType(JobsType, { patch: [PatchType(JobsType)] });
    const COLUMNS = { task: Sheet.column.text(JobType, { header: "Task" }), qty: Sheet.column.quantity(JobType, { header: "Qty" }) };
    // A view over two sources (#1345): the rows by a prefix of their task, the templates by their group.
    const SPRAY = { id: "spray", name: "SPRAY", context: 0n, reveals: [], folds: new Map<string, boolean>(), narrowing: new SortedMap([
        ["rows", { where: new Map([["task", variant("prefix", "spray")]]), preset: none, resolution: none }],
        ["templates", { where: new Map([["group", variant("values", ["\"Finishing\""])]]), preset: none, resolution: none }],
    ], keys) };
    const viewsEqual = equalFor(ArrayType(Sheet.Types.RecordView));

    /** The jobs, read whole as a sheet over them holds them. */
    const jobs = () => h.bindRecord(ex.sheetJobs, JobsHandle, { whole: true });

    test("the sheet holds the entries in key order, and its Apply commits through the record (SB12, SB16)", async () => {
        StateRuntime.initializeStore(new UIStore());
        const held = await h.read(ex.sheetJobs);
        const { runtime, handle } = await jobs();
        const payloadOf = East.compile(East.function([JobsHandle], SheetPayloadType, ($, record) =>
            Sheet.Payload({ record, columns: COLUMNS, name: "jobs" })), [...runtime.buildPrimitives(), ...StateImpl]) as unknown as (h: unknown) => Payload;
        const payload = payloadOf(handle);
        assert.deepEqual(ids(payload), ["J-0001", "J-0002", "J-0003", "J-0004"]);
        assert.deepEqual(payload.name, some("jobs"));
        assert.deepEqual(payload.missing, none);
        assert.deepEqual(payload.templates, []);
        if (payload.sheet.editing.onApply.type !== "some") assert.fail("the sheet has no Apply");
        const cut = held.get("J-0001")!;
        const batch = encodeBeast2For(Editing.Types.ChangeSet(JobType, StringType))({
            requestId: "builder-1", base: variant("snapshot", held), label: "Edit jobs",
            changes: [{ id: "J-0001", patch: diffFor(OptionType(JobType))(some(cut), some({ ...cut, qty: some(50.0) })), place: none }],
        });
        const result = await payload.sheet.editing.onApply.value.value(batch);
        assert.equal(result.type, "applied");
        const { commits } = await h.history(ex.sheetJobs);
        assert.deepEqual(commits.map((c) => c.mutation), ["patch", "$init"], "one commit");
        assert.deepEqual((await h.read(ex.sheetJobs)).get("J-0001")!.qty, some(50.0));
    });

    test("views are read from their bind handle, each every source's narrowing, and every change is written back to it (SB11, #1345)", async () => {
        StateRuntime.initializeStore(new UIStore());
        const { runtime, handle } = await jobs();
        const payloadOf = East.compile(East.function([JobsHandle], SheetPayloadType, ($, record) => {
            const views = $.let(State.bind([ArrayType(Sheet.Types.RecordView)], "sheet.payload.views", []));
            return Sheet.Payload({ record, columns: COLUMNS, views });
        }), [...runtime.buildPrimitives(), ...StateImpl]) as unknown as (h: unknown) => Payload;
        const first = payloadOf(handle);
        assert.ok(viewsEqual(first.sheet.views, []));
        if (first.sheet.onViewsChange.type !== "some") assert.fail("the sheet does not write its views");
        first.sheet.onViewsChange.value([SPRAY]);
        assert.ok(viewsEqual(payloadOf(handle).sheet.views, [SPRAY]), "the next build reads what the sheet wrote");
    });
});

describe("one entry's rows", () => {
    const WeekRow = ex.WeekRow;
    const PlansType = ex.sheetWeekPlans.type;
    const PlansHandle = RecordBindHandleType(PlansType, { patch: [PatchType(PlansType)] });
    const COLUMNS = { task: Sheet.column.text(WeekRow, { header: "Task" }) };

    /** The week plans, read whole as a sheet over one of them holds them. */
    const plans = () => h.bindRecord(ex.sheetWeekPlans, PlansHandle, { whole: true });

    test("an entry the record does not hold is named for the banner, its sheet empty and read-only (SB15)", async () => {
        StateRuntime.initializeStore(new UIStore());
        const { runtime, handle } = await plans();
        const payloadOf = East.compile(East.function([PlansHandle, StringType], SheetPayloadType, ($, record, week) =>
            Sheet.Payload({ record, entry: { key: week, rows: "rows", id: "id" }, columns: COLUMNS })),
        [...runtime.buildPrimitives(), ...StateImpl]) as unknown as (h: unknown, week: string) => Payload;
        const held = payloadOf(handle, "2026-W42");
        assert.deepEqual(ids(held), ["w42-1", "w42-2", "w42-3"]);
        assert.deepEqual(held.missing, none);
        assert.deepEqual(held.sheet.readOnly, some(false));
        const missing = payloadOf(handle, "2026-W50");
        assert.deepEqual(ids(missing), []);
        assert.deepEqual(missing.missing, some("2026-W50"));
        assert.deepEqual(missing.sheet.readOnly, some(true));
    });

    test("the author's readOnly holds whether or not the record holds the entry", async () => {
        StateRuntime.initializeStore(new UIStore());
        const { runtime, handle } = await plans();
        const payloadOf = East.compile(East.function([PlansHandle], SheetPayloadType, ($, record) =>
            Sheet.Payload({ record, entry: { key: "2026-W42", rows: "rows", id: "id" }, columns: COLUMNS, readOnly: true })),
        [...runtime.buildPrimitives(), ...StateImpl]) as unknown as (h: unknown) => Payload;
        assert.deepEqual(payloadOf(handle).sheet.readOnly, some(true));
    });
});
