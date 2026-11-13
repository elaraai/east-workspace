/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A builder's pending Save, handed over to a bound function's call (#1620), on
 * e3 itself: a Sheet of the print shop's jobs, given the record, declares its
 * Save and that Save's draft form; an editing session bound to what the Sheet
 * declares, as the Sheet's renderer binds one, hands its complete edits over
 * as one draft; and a function that lists the jobs is called with it. e3 lays
 * the draft over the jobs, the function reads them so, and nothing is saved —
 * each read back from e3: the function's result, the record's state, its
 * history and the request log.
 *
 * What a handle and a call do with drafts is `test/func-drafts.spec.ts`'s, and
 * that a session hands over its complete edits alone is east-ui-components'
 * (`editing/session.test.ts`). This is the two joined through e3, which no
 * builder does yet: a builder asks its session for a draft once it calls its
 * optimiser over one.
 */

import { expect, test } from "vitest";
import {
    DictType, East, OptionType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, equalFor, fromEastTypeValue, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { EditSession, getRegisteredPlatformImplementations, liftDraft, type EntryVersion } from "@elaraai/east-ui-components";
import {
    Func, FuncBindDraftsHandleType, FuncDraftType, FuncErrorType, Record, Sheet, createSheetRootWith, recordRows,
} from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/func/func";
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";

const h = e3Harness({ "bind/func/func": ex }, { measure: false });

const JobType = ex.PressJobType;
const JobsType = ex.PressJobsType;
type Job = ValueTypeOf<typeof JobType>;
type Jobs = ValueTypeOf<typeof JobsType>;
type Load = ValueTypeOf<typeof ex.PressLoadType>;

const keys = compareFor(StringType);
const sameJobs = equalFor(JobsType);
const sameLoad = equalFor(OptionType(ex.PressLoadType));
const sameError = equalFor(OptionType(FuncErrorType));
const printJobs = printFor(JobsType);
const printLoad = printFor(OptionType(ex.PressLoadType));
const printError = printFor(OptionType(FuncErrorType));

/** The jobs as the shop is deployed: j1 and j2 on P1, six hours between them, and j3 on P2. */
const SAVED: Jobs = new SortedMap([
    ["j1", { press: "P1", hours: 4n }],
    ["j2", { press: "P1", hours: 2n }],
    ["j3", { press: "P2", hours: 6n }],
], keys);

const COLUMNS = {
    press: Sheet.column.text(JobType, { header: "Press" }),
    hours: Sheet.column.integer(JobType, { header: "Hours" }),
};
/** What the page builds: a Sheet of the jobs, given the record, and a press's load, bound from a function that lists them. */
const PageType = StructType({ sheet: Sheet.Types.Root, load: FuncBindDraftsHandleType([StringType], ex.PressLoadType) });
type Page = ValueTypeOf<typeof PageType>;
const page = East.function([], PageType, ($) => {
    const record = $.let(Record.bind(ex.pressJobs));
    const rows = recordRows(record);
    const sheet = $.let(createSheetRootWith(rows.data, COLUMNS, rows.options, rows.internal));
    const load = $.let(Func.bind(ex.pressLoadFn));
    return { sheet, load };
});

/** Where a session places an entry of a keyed source: by its key. */
const BY_KEY = some(variant("keyOrder", null));

/**
 * The page over the test's workspace, and the Sheet's editing session as its
 * renderer keeps one: bound to what the Sheet's editing declares — its source,
 * its schemas, its Save and that Save's draft form — and begun from the jobs
 * the Sheet read.
 */
async function opened() {
    await h.install({ fn: page });
    const { sheet, load } = East.compile(page, getRegisteredPlatformImplementations())() as Page;
    const { editing } = sheet;
    if (editing.onApply.type !== "some" || editing.toDraft.type !== "some") throw new Error("the Sheet's Save has no draft form");
    if (editing.keyType.type !== "some" || editing.snapshot.type !== "some") throw new Error("the Sheet does not read the record's entries whole");
    const entryType = fromEastTypeValue(editing.entryType);
    const draftType = fromEastTypeValue(editing.draftType);
    const keyType = fromEastTypeValue(editing.keyType.value);
    const session = new EditSession<undefined>({
        sourceId: editing.sourceId, entryType, draftType, keyType,
        idField: editing.idField.type === "some" ? editing.idField.value : undefined,
        children: editing.children.type === "some" ? editing.children.value : undefined,
        apply: editing.onApply.value.value,
        toDraft: editing.toDraft.value,
        patch: editing.onPatch.type === "some" ? editing.onPatch.value : undefined,
        refresh: undefined,
    });
    session.observeBase(variant("snapshot", decodeBeast2For(DictType(keyType, entryType))(editing.snapshot.value)));
    /** An entry whose every field holds a value. */
    const whole = (job: Job): EntryVersion<undefined> => ({ draft: liftDraft(draftType, job), wire: undefined, place: BY_KEY });
    return { session, whole, load };
}

/** The commit the jobs stand at, as e3's history of them names it. */
async function head(): Promise<string | undefined> {
    return (await h.history(ex.pressJobs)).commits[0]?.hash;
}

test("a session hands its complete edits to a call as one draft, and the function reads them laid over the record: an entry with a field still missing is left out, one whose text could not be read stands as it began, and nothing is saved (#1620)", async () => {
    const { session, whole, load } = await opened();
    const stood = await head();
    const absent: EntryVersion<undefined> = { draft: undefined, wire: undefined, place: none };
    // j3 moved onto P1, whole. A new j4 on P1 whose hours are still missing. j2 moved to P2, its hours typed as text
    // that is no number.
    const recorded = session.record([
        { id: "j3", before: whole({ press: "P2", hours: 6n }), after: whole({ press: "P1", hours: 6n }) },
        { id: "j4", before: absent, after: { draft: { press: variant("value", "P1"), hours: variant("missing", null) }, wire: undefined, place: BY_KEY } },
        { id: "j2", before: whole({ press: "P1", hours: 2n }), after: { draft: { press: variant("value", "P2"), hours: variant("invalid", "two") }, wire: undefined, place: BY_KEY } },
    ], "typed", "Edit jobs");
    expect(recorded).toBe(true);
    expect(session.pending).toBe(3);

    const handed = session.toDraft();
    if (handed?.type !== "draft") throw new Error(`the session handed over ${handed?.type ?? "nothing"}`);
    const draft = decodeBeast2For(FuncDraftType)(handed.value);
    expect([draft.record, draft.mutation, draft.args.length]).toEqual(["press_jobs", "patch", 1]);
    expect(session.pending, "the session is where it was").toBe(3);
    expect(h.requests("mutate"), "handing over sent nothing").toEqual([]);
    expect(h.requests("call").filter((request) => request.method === "POST"), "and called nothing").toEqual([]);

    load.call("P1", [draft]);
    await settle();
    expect(sameError(load.error(), none), printError(load.error())).toBe(true);
    // j3 is on P1 beside j1, and beside j2, which stands as it began; j4 is nowhere.
    const expected: Load = { jobs: ["j1", "j2", "j3"], hours: 12n, capacity: 8n };
    expect(sameLoad(load.read(), some(expected)), printLoad(load.read())).toBe(true);

    // Nothing was saved, and the session still holds its edits.
    expect(h.requests("mutate"), "no write was sent").toEqual([]);
    const held = await h.read(ex.pressJobs);
    expect(sameJobs(held, SAVED), printJobs(held)).toBe(true);
    expect(await head(), "no commit was made").toBe(stood);
    expect(session.pending).toBe(3);
});
