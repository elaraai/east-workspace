/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A record whose rows hold their own key in a field (`keyField`,
 * east-workspace#1705), through the editing every builder over the app's
 * records shares (`useScheduleEditing`): racks keyed by their code, each
 * rack's `code` its key, the record a kind's — built as the Schematic's and
 * the Flowchart's kinds build theirs (`recordSide`). A rack a gesture adds
 * holds its key in the field from the first, whatever its row was given
 * there, and is saved with it; a rack the record held already, whose field
 * never held its key, keeps what it holds through a change of its bay. And
 * jobs keyed by their reference, an event kind's (`Schedule.events`), as the
 * Calendar's, the Plan's, the Roster's and the Allocation's are: where
 * another session's Save takes a new job's key first, the job goes on under
 * the next, and its field follows. Over records deployed to e3 itself.
 */

import { useMemo } from "react";
import { describe, expect, test } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { DateTimeType, DictType, East, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, printFor, type EastType, type ExprType, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { getRegisteredPlatformImplementations, useTrackedEvaluation, type EditHistoryJoined } from "@elaraai/east-ui-components";
import { KindSideFields, Record, Schedule, recordSide, type KindBinding } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { useScheduleEditing, type ScheduleEditing, type ScheduleEditingKind, type ScheduleEntryRef } from "./editing.js";

/** A rack: its code, which is its key too, and the bay it stands in. */
const Rack = StructType({ code: StringType, bay: IntegerType });
/** The racks: one whose row holds its key, and one saved before its row did. */
const racks = e3.record("key_field_racks", DictType(StringType, Rack), {
    initial: new Map([["R-1", { code: "R-1", bay: 1n }], ["R-2", { code: "", bay: 2n }]]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** A job: its reference, which is its key too, what it is, and when it runs. */
const Job = StructType({ ref: StringType, title: StringType, start: DateTimeType, end: DateTimeType });
const DAY = new Date("2026-11-23T08:00:00Z");
const LATER = new Date("2026-11-23T12:00:00Z");
/** The jobs: one, which a new job is made from. */
const jobs = e3.record("key_field_jobs", DictType(StringType, Job), {
    initial: new Map([["J-1", { ref: "J-1", title: "Strip", start: DAY, end: LATER }]]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const h = e3Harness({ "schedule/key-field": { racks, jobs } }, { measure: false });
/** The jobs' kind, as the Calendar builds one, told the field its rows hold their key in. */
const jobsKind = East.function([], Schedule.Types.Kind, ($) => {
    const handle = $.let(Record.bind(jobs));
    return Schedule.events(handle, { name: "Job", icon: "wrench", title: "title", start: "start", end: "end", keyField: "ref" }).build("jobs");
});
const RackSide = StructType({ ...KindSideFields });
/** The racks' side of a kind, told the field its rows hold their key in. */
const racksSide = East.function([], RackSide, ($) => {
    const handle = $.let(Record.bind(racks));
    const bound: KindBinding = { form: "record", handle: handle as unknown as ExprType<EastType>, keyType: StringType, rowType: Rack };
    return recordSide(bound, undefined, undefined, { keyField: "code" } as never, [], "Spec.racks") as never;
});

const NO_KINDS: readonly ScheduleEditingKind[] = [];
const NO_JOINED: readonly EditHistoryJoined<ScheduleEntryRef>[] = [];
/** The editing the probe mounted, as its last render handed it. */
const probe: { editing: ScheduleEditing | undefined } = { editing: undefined };

/** The racks as a record a builder writes beside its kinds, under the shared editing: what the test drives. */
function Probe() {
    // Built again as the record it reads moves, as a builder's payload is.
    const run = useMemo(() => racksSide.toIR().compile(getRegisteredPlatformImplementations()), []);
    const { result } = useTrackedEvaluation(run);
    if (!result.ok) throw result.error;
    const side = result.value;
    const records = useMemo(() => (side.editing.type !== "some" ? [] : [{ key: "racks", name: "Racks", editing: side.editing.value, entries: side.entries }]), [side]);
    probe.editing = useScheduleEditing({ kinds: NO_KINDS, records, storageKey: "schedule-key-field", joined: NO_JOINED, autosave: false });
    return null;
}

/** The jobs as an event kind whose new events take another key where another Save took theirs, under the shared editing. */
const REKEYS: ReadonlySet<string> = new Set(["jobs"]);
function JobsProbe() {
    const run = useMemo(() => jobsKind.toIR().compile(getRegisteredPlatformImplementations()), []);
    const { result } = useTrackedEvaluation(run);
    if (!result.ok) throw result.error;
    const kind = result.value;
    const kinds = useMemo(() => [kind as unknown as ScheduleEditingKind], [kind]);
    probe.editing = useScheduleEditing({ kinds, storageKey: "schedule-key-field-jobs", joined: NO_JOINED, rekeys: REKEYS, autosave: false });
    return null;
}

const encodeJob = encodeBeast2For(Job);
const jobEqual = equalFor(Job);
const printJobs = printFor(jobs.type);
const decodeJobDraft = decodeBeast2For(Editing.Types.DraftField(Job));
const encodeRack = encodeBeast2For(Rack);
const rackEqual = equalFor(Rack);
const printRacks = printFor(racks.type);
const decodeDraft = decodeBeast2For(Editing.Types.DraftField(Rack));
/** The editing, once the probe has mounted. */
const editing = (): ScheduleEditing => {
    if (probe.editing === undefined) throw new Error("the probe has not mounted");
    return probe.editing;
};
/** A rack as the editing's drafts hold it, by its key's text. */
const drafted = (id: string) => {
    const bytes = editing().draftsOf("racks").get(id);
    return bytes === undefined ? undefined : decodeDraft(bytes);
};

describe("the shared editing over a record whose rows hold their own key in a field", () => {
    test("a rack a gesture adds holds its key in the field from the first, whatever its row was given there, and is saved with it; a rack whose field never held its key keeps what it holds through a change of its bay", async () => {
        await h.mount({ fn: racksSide }, { view: <Probe /> });
        await waitFor(() => expect(editing().available("racks")).toBe(true));
        const id = editing().mint("racks", "", new Set());
        if (id === undefined) throw new Error("expected the session to make a key");
        // A new rack, its code as a template left it; and the stored rack whose code is empty, moved to bay 5.
        act(() => {
            expect(editing().record([
                { kind: "racks", id, row: encodeRack({ code: "from-a-template", bay: 9n }), created: true },
                { kind: "racks", id: "R-2", row: encodeRack({ code: "", bay: 5n }) },
            ], "insert", "Add a rack")).toBe(true);
        });
        await settle();
        const [added, moved] = [drafted(id), drafted("R-2")];
        if (added?.type !== "value" || moved?.type !== "value") throw new Error("expected both racks drafted whole");
        expect([rackEqual(added.value, { code: id, bay: 9n }), rackEqual(moved.value, { code: "", bay: 5n })]).toEqual([true, true]);
        await act(async () => { await editing().history.apply(); });
        await waitFor(async () => expect((await h.read(racks)).has(id)).toBe(true));
        const saved = await h.read(racks);
        expect([rackEqual(saved.get(id)!, { code: id, bay: 9n }), rackEqual(saved.get("R-2")!, { code: "", bay: 5n }), rackEqual(saved.get("R-1")!, { code: "R-1", bay: 1n })],
            printRacks(saved)).toEqual([true, true, true]);
    });

    test("an event whose key another session's Save takes first goes on under the next its kind makes, its key field with it: both saved, each holding the key it is saved under", async () => {
        await h.mount({ fn: jobsKind }, { view: <JobsProbe /> });
        await waitFor(() => expect(editing().available("jobs")).toBe(true));
        // A job made from J-1: J-1-2, the next in its row, as another session's copy of J-1 is keyed too.
        const id = editing().mint("jobs", "J-1", new Set());
        expect(id).toBe("J-1-2");
        const copy: ValueTypeOf<typeof Job> = { ref: "J-1", title: "Strip again", start: DAY, end: LATER };
        act(() => { expect(editing().record([{ kind: "jobs", id: "J-1-2", row: encodeJob(copy), created: true }], "insert", "Copy a job")).toBe(true); });
        await settle();
        const first = editing().draftsOf("jobs").get("J-1-2");
        const held = first === undefined ? undefined : decodeJobDraft(first);
        if (held?.type !== "value") throw new Error("expected the copy drafted whole");
        expect(jobEqual(held.value, { ...copy, ref: "J-1-2" })).toBe(true);
        // The job as its session holds it from the moment it gives it another key: before the Save that follows.
        const session = editing().sessions[0]!.session;
        let rekeyed: unknown;
        const stop = session.subscribe(() => { rekeyed ??= session.entries.get("J-1-3")?.draft; });
        // Another session saves its own J-1-2 just as Save goes.
        const theirs: ValueTypeOf<typeof Job> = { ref: "J-1-2", title: "Theirs", start: DAY, end: LATER };
        await h.race(jobs, () => { void editing().history.apply(); }, (now) => {
            now.set("J-1-2", theirs);
            return now;
        });
        await waitFor(async () => expect((await h.read(jobs)).has("J-1-3")).toBe(true));
        stop();
        const moved = rekeyed as { readonly type: string; readonly value: ValueTypeOf<typeof Job> } | undefined;
        if (moved?.type !== "value") throw new Error("expected the session to hold the job under J-1-3");
        expect(jobEqual(moved.value, { ...copy, ref: "J-1-3" })).toBe(true);
        const saved = await h.read(jobs);
        expect([jobEqual(saved.get("J-1-2")!, theirs), jobEqual(saved.get("J-1-3")!, { ...copy, ref: "J-1-3" })], printJobs(saved)).toEqual([true, true]);
    });
});
