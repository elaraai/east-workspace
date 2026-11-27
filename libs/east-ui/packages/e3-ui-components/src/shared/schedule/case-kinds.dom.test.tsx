/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The kinds of one record's cases (`Schedule.events.kinds`, east-workspace#1769),
 * over the print works' steps on e3 itself: a press's setups and runs and a
 * crew's shifts, one record, a kind per case of its `kind` field, each built
 * as a Plan builds its kinds. Each kind draws, counts, keeps standing and
 * reads by key its own case's rows alone, its title handed the value its case
 * holds, and a draft changing a row's case moves its event to that case's
 * kind; it lands on the resources of its own cases of the row's `on` field,
 * and a template whose values hold another case makes none. Handed the rows a
 * reader holds of the record, by one handle (#1771), each reads its own case's
 * from that one set, a draft laid over them as over its window — drawing what
 * it draws over its own case's rows alone, and holding a row of another case
 * only where a draft names it (#1793). Under the editing
 * every builder shares (`useScheduleEditing`), the kinds are the record's one
 * session: a gesture over a run and a setup is one step, and Save sends the
 * record one request.
 */

import { useMemo } from "react";
import { describe, expect, test } from "vitest";
import { act, waitFor } from "@testing-library/react";
import {
    ArrayType, DictType, East, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none,
    printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { getRegisteredPlatformImplementations, useTrackedEvaluation, type EditHistoryJoined } from "@elaraai/east-ui-components";
import { Record, Schedule } from "@elaraai/e3-ui/internal";
import * as sx from "@elaraai/e3-ui/examples/schedule/schedule";
import { e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { holdCellRows, releaseCellRows } from "./cell-rows.js";
import { useScheduleEditing, type ScheduleEditing, type ScheduleEditingKind, type ScheduleEntryRef } from "./editing.js";

const Step = sx.SchedulePrintStep;
const steps = sx.schedulePrintSteps;
const h = e3Harness({ "schedule/case-kinds": { steps } }, { measure: false });

/** The steps' kinds, as a Plan builds them: a press's setups and runs, and a crew's shifts — one record, a kind per case of its `kind`. */
const stepKinds = East.function([], ArrayType(Schedule.Types.PlanKind), ($) => {
    const handle = $.let(Record.bind(steps));
    const kinds = Schedule.events.kinds(handle, "kind", {
        setup: {
            name: "Setup", icon: "wrench", draw: "marks", title: (_step, _key, setup) => East.str`${setup.plates} plates`,
            start: "start", end: "end", resource: { field: "on", of: { press: "presses" } },
        },
        run: {
            name: "Run", icon: "print", title: (_step, _key, run) => run.title, start: "start", end: "end",
            resource: { field: "on", of: { press: "presses" } },
            templates: [
                { key: "proof", name: "Proof run", duration: variant("hours", 1), values: { state: variant("confirmed", null), kind: variant("run", { title: "Proof", sheets: 100 }) } },
                { key: "astray", name: "A setup", duration: variant("hours", 1), values: { state: variant("confirmed", null), kind: variant("setup", { plates: 2n }) } },
            ],
        },
        shift: {
            name: "Shift", icon: "users", draw: "cards", title: (_step, _key, shift) => East.str`Crew of ${shift.people}`,
            start: "start", end: "end", resource: { field: "on", of: { crew: "crews" } },
        },
    }, { state: "state" });
    return [kinds.setup.buildPlan("setup"), kinds.run.buildPlan("run"), kinds.shift.buildPlan("shift")];
});

type PlanKind = ValueTypeOf<typeof Schedule.Types.PlanKind>;
type StepValue = ValueTypeOf<typeof Step>;

/** Monday 5 October 2026, the steps' day. */
const OCT_5 = [new Date("2026-10-05T00:00:00Z"), new Date("2026-10-06T00:00:00Z")] as const;
const draftsOf = (entries: [string, Uint8Array][]) => new SortedMap(entries, compareFor(StringType));
const NO_DRAFTS = draftsOf([]);
const encodeStep = encodeBeast2For(Step);
const decodeStep = decodeBeast2For(Step);
const stepEqual = equalFor(Step);
const stepDraft = encodeBeast2For(Editing.Types.DraftField(Step));
const decodeCells = decodeBeast2For(ArrayType(StructType({ key: StringType, row: Step })));
const decodeRows = decodeBeast2For(DictType(StringType, Step));
const refEqual = equalFor(OptionType(Schedule.Types.ResourceRef));
const countEqual = equalFor(OptionType(IntegerType));
const keyTextEqual = equalFor(OptionType(StringType));
const printOn = printFor(Step.fields.on);

/** The kinds, built over e3 as a Plan's payload builds them: setup, run, shift. */
async function builtKinds(): Promise<readonly [PlanKind, PlanKind, PlanKind]> {
    await h.install({ fn: stepKinds });
    const [setup, run, shift] = stepKinds.toIR().compile(getRegisteredPlatformImplementations())();
    return [setup!, run!, shift!];
}

/** What a kind's seams draw from: its window, the rows a reader holds of it by their handle, or none of its events (#1771). */
type KindRead = Parameters<PlanKind["planItems"]>[3];

/** A kind's events on the steps' day, each its key and its title — read over its window, unless given what to read. */
function itemsOf(kind: PlanKind, drafts = NO_DRAFTS, given: KindRead = variant("window", null)): [string, string][] {
    const read = kind.planItems(...OCT_5, drafts, given);
    if (read.type !== "some") throw new Error(`expected ${kind.key}'s events read`);
    return read.value.map((item) => [item.key, item.title]);
}

describe("the kinds of one record's cases (#1769)", () => {
    test("each draws, counts, keeps standing and reads by key its own case's rows alone, its title handed what its case holds, on its case's resources", async () => {
        const [setup, run, shift] = await builtKinds();
        expect([itemsOf(setup), itemsOf(run), itemsOf(shift)]).toEqual([[["k1", "4 plates"]], [["k2", "Brochure run"]], [["k3", "Crew of 3"]]]);
        expect([setup.takes, run.takes, shift.takes]).toEqual([["presses"], ["presses"], ["crews"]]);
        const crewShift = shift.planItems(...OCT_5, NO_DRAFTS, variant("window", null));
        if (crewShift.type !== "some") throw new Error("expected the shifts read");
        expect(refEqual(crewShift.value[0]!.resource, some({ kind: "crews", key: "c1" }))).toBe(true);
        // Its record read whole, counted in memory: its case's events alone, counted exactly.
        expect([countEqual(run.count(...OCT_5), some(1n)), run.countExact]).toEqual([true, true]);
        // One event by its key: one of its case, and none of another's.
        expect([run.planEvent("k2", NO_DRAFTS, ...OCT_5, none).type, run.planEvent("k1", NO_DRAFTS, ...OCT_5, none).type]).toEqual(["some", "none"]);
        // What it keeps standing while its window is read again, and every row of it at once: its case's.
        const stood = run.stored(...OCT_5);
        const rows = run.planRows(...OCT_5, NO_DRAFTS);
        if (stood.type !== "some" || rows.type !== "some") throw new Error("expected the run's rows read");
        expect([decodeCells(stood.value).map((cell) => cell.key), [...decodeRows(rows.value).keys()]]).toEqual([["k2"], ["k2"]]);
    });

    test("a draft changing a row's case moves its event to that case's kind", async () => {
        const [setup, run] = await builtKinds();
        const k1 = (await h.read(steps)).get("k1")!;
        const turned = draftsOf([["k1", stepDraft(variant("value", { ...k1, kind: variant("run", { title: "Proof run", sheets: 200 }) }))]]);
        expect([itemsOf(setup, turned), itemsOf(run, turned)]).toEqual([[], [["k1", "Proof run"], ["k2", "Brochure run"]]]);
        expect([setup.planEvent("k1", turned, ...OCT_5, none).type, run.planEvent("k1", turned, ...OCT_5, none).type]).toEqual(["none", "some"]);
    });

    test("handed the rows a reader holds of their record, by one handle, each reads its own case's from the one set — made once, never a copy a kind — a draft laid over them; handed nothing, none (#1771)", async () => {
        const [setup, run, shift] = await builtKinds();
        // The record's rows as a reader holds them: as the page unpacked them, under a handle the seams read them by.
        const stored = await h.read(steps);
        const rows = [...stored].map(([key, row]) => ({ key, row }));
        let made = 0;
        const handle = holdCellRows(() => { made += 1; return rows; });
        try {
            const held: KindRead = variant("rows", handle);
            expect([itemsOf(setup, NO_DRAFTS, held), itemsOf(run, NO_DRAFTS, held), itemsOf(shift, NO_DRAFTS, held)])
                .toEqual([[["k1", "4 plates"]], [["k2", "Brochure run"]], [["k3", "Crew of 3"]]]);
            expect(made).toBe(1);
            // A draft changing a row's case moves its event over the rows held as over the window.
            const k1 = stored.get("k1")!;
            const turned = draftsOf([["k1", stepDraft(variant("value", { ...k1, kind: variant("run", { title: "Proof run", sheets: 200 }) }))]]);
            expect([itemsOf(setup, turned, held), itemsOf(run, turned, held)]).toEqual([[], [["k1", "Proof run"], ["k2", "Brochure run"]]]);
            // Handed nothing — hidden, or past the cap: none of its events.
            expect(itemsOf(run, NO_DRAFTS, variant("nothing", null))).toEqual([]);
        } finally {
            releaseCellRows([handle]);
        }
        // Let go of, the rows are no seam's to read: a read of them names its handle.
        expect(() => run.planItems(...OCT_5, NO_DRAFTS, variant("rows", handle))).toThrow(handle);
    });

    test("handed every case's rows, each draws what it draws over its own case's alone — walking none of the others' — and a draft turning a row of another case into its own draws in its key's place (#1793)", async () => {
        const [setup, run, shift] = await builtKinds();
        const stored = await h.read(steps);
        const rows = [...stored].map(([key, row]) => ({ key, row }));
        const caseOf = (tag: string) => rows.filter((one) => keyTextEqual(some(one.row.kind.type), some(tag)));
        const handles = [rows, caseOf("setup"), caseOf("run"), caseOf("shift")].map((held) => holdCellRows(() => held));
        try {
            const [all, setups, runs, shifts] = handles.map((handle): KindRead => variant("rows", handle));
            expect([itemsOf(setup, NO_DRAFTS, all!), itemsOf(run, NO_DRAFTS, all!), itemsOf(shift, NO_DRAFTS, all!)])
                .toEqual([itemsOf(setup, NO_DRAFTS, setups!), itemsOf(run, NO_DRAFTS, runs!), itemsOf(shift, NO_DRAFTS, shifts!)]);
            // The setup turned into a run: over every case's rows the run draws it where its key stands, before the brochure
            // run — the drafts naming it, it is held as a row of the run's — and the setup draws it no more.
            const k1 = stored.get("k1")!;
            const turned = draftsOf([["k1", stepDraft(variant("value", { ...k1, kind: variant("run", { title: "Proof run", sheets: 200 }) }))]]);
            expect([itemsOf(run, turned, all!), itemsOf(setup, turned, all!)]).toEqual([[["k1", "Proof run"], ["k2", "Brochure run"]], []]);
        } finally {
            releaseCellRows(handles);
        }
    });

    test("a template whose values hold another case makes no event, and a kind takes no resource of another case's", async () => {
        const [, run] = await builtKinds();
        const [from, to] = [new Date("2026-10-05T13:00:00Z"), new Date("2026-10-05T14:00:00Z")];
        const create = (template: string) => run.write([{
            id: "k9", entry: new Uint8Array(0), gesture: variant("create", { template, start: from, end: to, resource: some({ kind: "presses", key: "pa" }) }),
        }])[0]!;
        const made = create("proof");
        if (made.type !== "some") throw new Error("expected the proof run made");
        const proof: StepValue = { on: variant("press", "pa"), start: from, end: to, state: variant("confirmed", null), kind: variant("run", { title: "Proof", sheets: 100 }) };
        expect([stepEqual(decodeStep(made.value), proof), create("astray").type]).toEqual([true, "none"]);
        // A run placed on a crew: its kind lands on presses alone.
        const k2 = encodeStep((await h.read(steps)).get("k2")!);
        expect(run.write([{ id: "k2", entry: k2, gesture: variant("place", { start: from, end: to, resource: some({ kind: "crews", key: "c1" }) }) }])[0]!.type).toBe("none");
        // What a series index files a press's events under: its case of `on`; none for a crew.
        expect([keyTextEqual(run.seriesKey(some({ kind: "presses", key: "pa" })), some(printOn(variant("press", "pa")))),
            keyTextEqual(run.seriesKey(some({ kind: "crews", key: "c1" })), none)]).toEqual([true, true]);
    });
});

const NO_JOINED: readonly EditHistoryJoined<ScheduleEntryRef>[] = [];
/** The editing the probe mounted, as its last render handed it. */
const probe: { editing: ScheduleEditing | undefined } = { editing: undefined };

/** The steps' kinds under the shared editing, as a Plan holds them: what the test drives. */
function Probe() {
    const program = useMemo(() => stepKinds.toIR().compile(getRegisteredPlatformImplementations()), []);
    const { result } = useTrackedEvaluation(program);
    if (!result.ok) throw result.error;
    const kinds = result.value as unknown as readonly ScheduleEditingKind[];
    probe.editing = useScheduleEditing({ kinds, storageKey: "schedule-case-kinds", joined: NO_JOINED, autosave: false });
    return null;
}

/** The editing, once the probe has mounted. */
const editing = (): ScheduleEditing => {
    if (probe.editing === undefined) throw new Error("the probe has not mounted");
    return probe.editing;
};

describe("the kinds of one record's cases, under the editing every builder shares (#1769)", () => {
    test("are the record's one session: a gesture over a run and a setup is one step, and Save sends the record one request", async () => {
        await h.mount({ fn: stepKinds }, { view: <Probe /> });
        await waitFor(() => expect(editing().available("run")).toBe(true));
        const sessions = editing().sessions;
        expect([sessions.map((held) => held.kind), sessions.every((held) => held.session === sessions[0]!.session), editing().history.keys.length])
            .toEqual([["setup", "run", "shift"], true, 1]);
        const deployed = (await h.history(steps)).commits.map((commit) => commit.mutation);
        const held = await h.read(steps);
        const setup: StepValue = { ...held.get("k1")!, kind: variant("setup", { plates: 6n }) };
        const run: StepValue = { ...held.get("k2")!, kind: variant("run", { title: "Brochure run", sheets: 45000 }) };
        act(() => {
            expect(editing().record([
                { kind: "setup", id: "k1", row: encodeStep(setup) },
                { kind: "run", id: "k2", row: encodeStep(run) },
            ], "typed", "Edit two steps")).toBe(true);
        });
        await settle();
        // Each kind reads the record's drafts, and draws its own case's: one step undoes both.
        expect([[...editing().draftsOf("setup").keys()], [...editing().draftsOf("run").keys()], editing().history.canUndo]).toEqual([["k1", "k2"], ["k1", "k2"], true]);
        await act(async () => { await editing().history.apply(); });
        await waitFor(async () => {
            const saved = await h.read(steps);
            expect([stepEqual(saved.get("k1")!, setup), stepEqual(saved.get("k2")!, run)]).toEqual([true, true]);
        });
        // One request: one commit of the patch door over the record as deployed.
        expect((await h.history(steps)).commits.map((commit) => commit.mutation)).toEqual(["patch", ...deployed]);
    });
});
