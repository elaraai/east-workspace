/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An event kind over a record whose rows hold their own key in a field
 * (`keyField`, east-workspace#1705): jobs keyed by their reference, each job's
 * `ref` its key — the kind the Calendar, the Plan, the Roster and the
 * Allocation share (`Schedule.events`). Its session names the field as its
 * entries' identity field, which the renderer's session keeps a new event's
 * key in; its Save writes a new job's key into it and leaves a stored job's
 * alone; its form shows the field read only; and what it refuses.
 *
 * e3-ui's specs read and write no e3: the record is a handle made by hand
 * (`record-handles.ts`), its draft door answering the patch as a draft.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, some, variant, type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { FuncDraftType, Record } from "@elaraai/e3-ui";
import { Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { recordHandle } from "../record-handles.js";

/** A job: its reference, which is its key too, what it is, when it runs, and the crew it takes. */
const Job = StructType({ ref: StringType, title: StringType, start: DateTimeType, end: DateTimeType, crew: IntegerType });
const Jobs = DictType(StringType, Job);
const DAY = new Date("2026-11-23T08:00:00Z");
const LATER = new Date("2026-11-23T12:00:00Z");
/** The jobs the record holds: one whose row holds its key, and one saved before its row did. */
const JOBS = new SortedMap<string, ValueTypeOf<typeof Job>>([
    ["J-1", { ref: "J-1", title: "Strip", start: DAY, end: LATER, crew: 2n }],
    ["J-2", { ref: "", title: "Prime", start: DAY, end: LATER, crew: 1n }],
], compareFor(StringType));
const jobsHandle = recordHandle(Jobs, JOBS, "spec_jobs");

/** The jobs' kind, built as the Calendar builds one: told its key field, or told none. */
const jobsKind = (options: object) => East.compile(East.function([], Schedule.Types.Kind, ($) => {
    const handle = $.let(jobsHandle());
    return Schedule.events(handle as never, { name: "Job", icon: "wrench", title: "title", start: "start", end: "end", ...options } as never).build("jobs");
}), []);

const Batch = Editing.Types.ChangeSet(Job, StringType);
const change = diffFor(OptionType(Job));

describe("an event kind told its record's key field", () => {
    test("its session names the field as its entries' identity field; told none, it names none", () => {
        assert.ok(equalFor(OptionType(StringType))(jobsKind({ keyField: "ref" })().editing.idField, some("ref")));
        assert.ok(equalFor(OptionType(StringType))(jobsKind({})().editing.idField, none));
    });

    test("its Save writes a new job's key into the field, whatever its template's values gave there, and leaves a stored job's field as it holds it", () => {
        const kind = jobsKind({ keyField: "ref" })();
        if (kind.editing.toDraft.type !== "some") assert.fail("expected the session's draft form");
        const answer = kind.editing.toDraft.value(encodeBeast2For(Batch)({
            requestId: "", base: variant("snapshot", JOBS), label: "",
            changes: [
                { id: "J-9", patch: change(none, some({ ref: "from-a-template", title: "Paint", start: DAY, end: LATER, crew: 3n })), place: some(variant("keyOrder", null)) },
                { id: "J-2", patch: change(some(JOBS.get("J-2")!), some({ ...JOBS.get("J-2")!, crew: 4n })), place: none },
            ],
        }));
        if (answer.type !== "draft") assert.fail(`expected a draft, got ${answer.type}`);
        const after = new SortedMap<string, ValueTypeOf<typeof Job>>([
            ["J-1", JOBS.get("J-1")!], ["J-2", { ...JOBS.get("J-2")!, crew: 4n }], ["J-9", { ref: "J-9", title: "Paint", start: DAY, end: LATER, crew: 3n }],
        ], compareFor(StringType));
        assert.ok(equalFor(PatchType(Jobs))(decodeBeast2For(PatchType(Jobs))(decodeBeast2For(FuncDraftType)(answer.value).args[0]!), diffFor(Jobs)(JOBS, after)));
    });

    test("its form shows the field read only, under the label its hint gives; told none, the field is edited as any other", () => {
        const editorOf = (kind: ReturnType<ReturnType<typeof jobsKind>>, field: string) => {
            const spec = kind.fields.find((one) => equalFor(StringType)(one.path[0] ?? "", field));
            if (spec === undefined) assert.fail(`expected a field "${field}" in the form`);
            return `${spec.label}: ${spec.editor.type}`;
        };
        const keyed = jobsKind({ keyField: "ref", fields: { ref: Schedule.field.text({ label: "Job no." }) } })();
        assert.deepEqual([editorOf(keyed, "ref"), editorOf(keyed, "crew")], ["Job no.: readonly", "Crew: number"]);
        assert.equal(editorOf(jobsKind({})(), "ref"), "Ref: text");
    });

    test("refuses a field of another type than the key, and one a role of the kind writes, naming the role", () => {
        assert.throws(() => jobsKind({ keyField: "crew" }),
            /Schedule\.events: "Job": `keyField` names the field of an entry that holds its key, a \.String as the key is — "crew" is a \.Integer field of \.Struct/);
        assert.throws(() => jobsKind({ keyField: "title" }),
            /Schedule\.events: "Job": `keyField` names "title", which `title` writes — an event's key is kept in its key field by the builder, and nothing else writes it/);
    });
});

// A record declared with e3, as an app declares one: what the option's type is checked over.
const jobs = e3.record("key_field_jobs", Jobs, {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The option's type checks: never called — `tsc` checks what each line says. */
export function keyFieldEventChecks($: BlockBuilder<NullType>): void {
    const bound = $.let(Record.bind(jobs));
    Schedule.events(bound, { name: "Job", icon: "wrench", title: "title", start: "start", end: "end", keyField: "ref" });
    // @ts-expect-error — `crew` is an Integer, and the jobs are keyed by a String
    Schedule.events(bound, { name: "Job", icon: "wrench", title: "title", start: "start", end: "end", keyField: "crew" });
}
