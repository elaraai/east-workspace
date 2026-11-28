/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The event kinds placed a block at a time (#1793), over the print works'
 * steps on e3 itself: a press's setups and runs — one record, a kind per case
 * of its `kind` field (`Schedule.events.kinds`) — and a crew's shifts, read
 * over their window beside them, joined into a Plan's rows by the seam a
 * Plan's payload carries (`createEventSeam`). Handed the rows a reader holds
 * of the presses block by block, each block under a handle of its own as the
 * shared reader holds them (`shared/schedule/cells.ts`), the canvas places
 * each block once. What it places is what one placing of every row gives,
 * compared as East values: with no drafts; with drafts in place; with a draft
 * moving a run onto a press another block holds, and one turning a setup into
 * a run; with a kind hidden; and with the runs on no press, which two blocks
 * hold. A read that brings a block places that block alone; one that lets a
 * block go, or goes back to one it kept, places none; an edit places again
 * the block holding its event, once for each kind it is drafted for; and
 * hiding a kind, or showing it again, places none — the shifts' read over
 * their window, beside the blocks, runs again for a switch or an edit alone.
 */

import { afterEach, describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { ArrayType, East, SortedMap, StringType, StructType, compareFor, encodeBeast2For, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { PlanEventDraftsType, PlanEventPlacedType, PlanEventSeamType, Record, Schedule, createEventSeam, planHideId } from "@elaraai/e3-ui/internal";
import * as sx from "@elaraai/e3-ui/examples/schedule/schedule";
import { e3Harness } from "../../e3-web-mount.test-utils.js";
import { holdCellRows, releaseCellRows } from "../../shared/schedule/cell-rows.js";
import type { ScheduleBlockRows, ScheduleCellsRead } from "../../shared/schedule/cells.js";
import type { ScheduleKindRows } from "../../shared/schedule/editing.js";
import { utcAt } from "../plan.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import { eventReadRange, setBlockPlacedProbe, usePlanEventPlaced, type PlanEventPlacedValue, type PlanEventRows, type PlanEventSeamValue } from "./events.js";

const Step = sx.SchedulePrintStep;
const steps = sx.schedulePrintSteps;
const h = e3Harness({ "plan/events-blocks": { steps } }, { measure: false });

type StepValue = ValueTypeOf<typeof Step>;
type Drafts = ValueTypeOf<typeof PlanEventDraftsType>;

const compareString = compareFor(StringType);
const encodeStep = encodeBeast2For(Step);
const stepDraft = encodeBeast2For(Editing.Types.DraftField(Step));
const printPlaced = printFor(PlanEventPlacedType);

/** Monday 5 October 2026, at an hour. */
const at = (hour: number) => utcAt(`2026-10-05T${String(hour).padStart(2, "0")}:00:00`);
const confirmed = variant("confirmed", null);
const onPress = (press: string): StepValue["on"] => variant("press", press);
const onCrew = (crew: string): StepValue["on"] => variant("crew", crew);
const setupOf = (plates: bigint): StepValue["kind"] => variant("setup", { plates });
const runOf = (title: string): StepValue["kind"] => variant("run", { title, sheets: 1000 });
const step = (on: StepValue["on"], from: number, to: number, kind: StepValue["kind"]): StepValue =>
    ({ on, start: at(from), end: at(to), state: confirmed, kind });

// The steps' keys are their record's, which the blocks — a press's each — hold in no order of their own: press A's run
// comes after press B's, so what two blocks place on one row is put together by the keys, never block after block.

/** Press A's steps, the reader's first block of the presses — beside a proof run on crew 2, on no press. */
const PA: readonly (readonly [string, StepValue])[] = [
    ["t-7", step(onPress("pa"), 6, 12, runOf("Brochures"))],
    ["s-4", step(onPress("pa"), 5, 6, setupOf(4n))],
    ["s-9", step(onPress("pa"), 12, 13, setupOf(2n))],
    ["x-5", step(onCrew("c2"), 8, 9, runOf("Proofs"))],
];
/** Press B's steps, the second block — beside samples run on crew 3, on no press. */
const PB: readonly (readonly [string, StepValue])[] = [
    ["r-3", step(onPress("pb"), 6, 11, runOf("Catalogues"))],
    ["s-2", step(onPress("pb"), 5, 6, setupOf(3n))],
    ["x-1", step(onCrew("c3"), 10, 11, runOf("Samples"))],
];
/** Press C's run, the third block. */
const PC: readonly (readonly [string, StepValue])[] = [["r-5", step(onPress("pc"), 7, 9, runOf("Flyers"))]];
/** The steps, a crew's shift among them: what the record holds. */
const STEPS = new Map([...PA, ...PB, ...PC, ["w-1", step(onCrew("c1"), 6, 14, variant("shift", { people: 3n }))]]);

/** The series the kinds land on, as the series tree holds them: the presses and the crews, each at the top. */
const LANDINGS: Parameters<typeof createEventSeam>[0] = ["presses", "crews"].map((key) => ({
    key, title: key, icon: undefined, keyType: StringType, rowType: Step, lanes: false, series: [], row: true, within: [], top: true, depth: 1,
}));

/** The steps' kinds, as a Plan builds them — a press's setups and runs, a crew's shifts — and the seam its payload carries. */
const placing = East.function([], StructType({ seam: PlanEventSeamType, kinds: ArrayType(Schedule.Types.PlanKind) }), ($) => {
    const handle = $.let(Record.bind(steps));
    const kinds = Schedule.events.kinds(handle, "kind", {
        setup: {
            name: "Setup", icon: "wrench", draw: "marks", title: (_step, _key, setup) => East.str`${setup.plates} plates`,
            start: "start", end: "end", resource: { field: "on", of: { press: "presses" } },
        },
        run: { name: "Run", icon: "print", title: (_step, _key, run) => run.title, start: "start", end: "end", resource: { field: "on", of: { press: "presses" } } },
        shift: {
            name: "Shift", icon: "users", draw: "cards", title: (_step, _key, shift) => East.str`Crew of ${shift.people}`,
            start: "start", end: "end", resource: { field: "on", of: { crew: "crews" } },
        },
    }, { state: "state" });
    const built = $.let([kinds.setup.buildPlan("setup"), kinds.run.buildPlan("run"), kinds.shift.buildPlan("shift")], ArrayType(Schedule.Types.PlanKind));
    return { seam: createEventSeam(LANDINGS, [["setup", kinds.setup], ["run", kinds.run], ["shift", kinds.shift]] as never, built), kinds: built };
});

/** The event kinds as the canvas is given them. */
type Kinds = NonNullable<Parameters<typeof usePlanEventPlaced>[5]>;

/** The steps written, and the kinds and the seam over them, built over e3 as a Plan's payload builds them. */
async function placingOver(): Promise<{ seam: PlanEventSeamValue; kinds: Kinds }> {
    await h.patch(steps, STEPS);
    await h.install({ fn: placing });
    return placing.toIR().compile(getRegisteredPlatformImplementations())() as never;
}

/** A week by the day, from Monday 5 October: the steps' day and the days laid out beyond it are the range read. */
const SCALE = planScale({ kind: "time", window: { min: utcAt("2026-10-05T00:00:00"), max: utcAt("2026-10-12T00:00:00") }, resolution: "day" }) as PlanScale;
const RANGE = eventReadRange(SCALE)!;
/** No drafts. */
const NO_DRAFTS: Drafts = new SortedMap([], compareString);
/** Nothing hidden. */
const SHOWN: readonly string[] = [];

/** The handles a test held rows under: let go of after it. */
const made: string[] = [];
/** Each block's name, by its handle: what a test's counts read. */
const names = new Map<string, string>();

afterEach(() => {
    setBlockPlacedProbe(undefined);
    releaseCellRows(made.splice(0));
    names.clear();
});

/** Some steps, held as a reader holds a block of them: under a handle, and by their keys. */
function blockOf(name: string, rows: readonly (readonly [string, StepValue])[]): ScheduleBlockRows {
    const byKey = new Map(rows);
    const handle = holdCellRows(() => rows.map(([key, row]) => ({ key, row })));
    made.push(handle);
    names.set(handle, name);
    const held: ScheduleKindRows = {
        has: (id) => byKey.has(id),
        get: (id) => {
            const row = byKey.get(id);
            return row === undefined ? undefined : { row: encodeStep(row) };
        },
        value: (id) => byKey.get(id),
        ids: () => byKey.keys(),
        rows: () => byKey.entries(),
    };
    return { handle, held };
}

/** The record's drafts, given to every kind of its cases: each step drafted as given. */
function draftsOf(rows: readonly (readonly [string, StepValue])[]): Drafts {
    const byId = new SortedMap(rows.map(([id, row]): [string, Uint8Array] => [id, stepDraft(variant("value", row))]), compareString);
    return new SortedMap([["run", byId], ["setup", byId], ["shift", byId]], compareString);
}

/**
 * What the reader hands on of the presses, read block by block (#1793): the setups and the runs each from the rows of
 * every block given, and those blocks; the crews' shifts named by none, read over their window.
 */
function readOf(blocks: readonly ScheduleBlockRows[], rows: readonly (readonly [string, StepValue])[], drafts: Drafts): ScheduleCellsRead {
    const whole = blockOf("whole", rows);
    const kind = { blocks, compare: compareString };
    return {
        reads: new SortedMap([["run", variant("rows", whole.handle)], ["setup", variant("rows", whole.handle)]], compareString),
        blocks: new Map([["run", kind], ["setup", kind]]),
        shading: new SortedMap([], compareString),
        drafts,
        held: new Map([["run", whole.held], ["setup", whole.held]]),
        notices: [],
        capped: new Set(),
        reading: false,
        drawn: undefined,
        windowed: new Set(),
        view: "current",
        error: undefined,
    } as ScheduleCellsRead;
}

/** One placing of every row the read holds, every kind's drafts in place: what the blocks put together are to give. */
function wholeOf(seam: PlanEventSeamValue, read: ScheduleCellsRead, hidden: readonly string[]): PlanEventPlacedValue {
    const placed = seam.placed(RANGE.from, RANGE.to, read.drafts, [...hidden], read.reads);
    if (placed.type !== "some") throw new Error("expected every row's events placed");
    return placed.value;
}

/** The keys of the events placed on a press's row, one way of drawing. */
const keysOn = (placed: PlanEventPlacedValue | undefined, draw: string, press: string) =>
    placed?.on.get("presses")?.get(draw)?.get(press)?.map((one) => one.item.key) ?? [];

describe("the event kinds placed a block at a time (#1793)", () => {
    test("each block placed apart, put together, is one placing of every row — no drafts, drafts in place, a run moved onto a press another block holds and a setup turned into a run, a kind hidden, runs on no press two blocks hold — the shifts read over their window beside them", async () => {
        const { seam, kinds } = await placingOver();
        const blocks = [blockOf("pa", PA), blockOf("pb", PB), blockOf("pc", PC)];
        const rows = [...PA, ...PB, ...PC];
        const events: PlanEventRows = { seam, landings: [], paged: true };
        const first = readOf(blocks, rows, NO_DRAFTS);
        const { result, rerender } = renderHook(({ cells, hidden }) => usePlanEventPlaced(events, SCALE, hidden, cells.drafts, cells, kinds),
            { initialProps: { cells: first, hidden: SHOWN } });
        expect(printPlaced(result.current.placed!)).toBe(printPlaced(wholeOf(seam, first, SHOWN)));
        // Press A's run and setups, press C's run, and the runs on no press — the samples and the proof run, two blocks'.
        expect([keysOn(result.current.placed, "span", "pa"), keysOn(result.current.placed, "marks", "pa"), keysOn(result.current.placed, "span", "pc")])
            .toEqual([["t-7"], ["s-4", "s-9"], ["r-5"]]);
        expect(result.current.placed!.lost.get("run")!.map((one) => one.item.key)).toEqual(["x-1", "x-5"]);
        const states: { drafts: Drafts; hidden: readonly string[] }[] = [
            // A run retitled and a setup moved later, each in its block.
            { drafts: draftsOf([["t-7", { ...STEPS.get("t-7")!, kind: runOf("Brochures, reprinted") }], ["s-2", { ...STEPS.get("s-2")!, start: at(6), end: at(7) }]]), hidden: SHOWN },
            // Press B's run moved onto press A, and press A's first setup turned into a run.
            { drafts: draftsOf([["r-3", { ...STEPS.get("r-3")!, on: onPress("pa") }], ["s-4", { ...STEPS.get("s-4")!, kind: runOf("Proof run") }]]), hidden: SHOWN },
            // The setups hidden.
            { drafts: NO_DRAFTS, hidden: [planHideId.events("setup")] },
        ];
        for (const { drafts, hidden } of states) {
            const cells = readOf(blocks, rows, drafts);
            rerender({ cells, hidden });
            expect(printPlaced(result.current.placed!)).toBe(printPlaced(wholeOf(seam, cells, hidden)));
        }
        // The moves themselves, as the last but one drew them: press A's runs — the run moved onto it from press B's block,
        // its setup turned into one, and its own — in their keys' order, the turned setup in its key's place; its setups the
        // one left; press B's run gone.
        const moved = readOf(blocks, rows, states[1]!.drafts);
        rerender({ cells: moved, hidden: SHOWN });
        expect([keysOn(result.current.placed, "span", "pa"), keysOn(result.current.placed, "marks", "pa"), keysOn(result.current.placed, "span", "pb")])
            .toEqual([["r-3", "s-4", "t-7"], ["s-9"], []]);
        // The shifts, read over their window, on crew 1's row throughout.
        expect(result.current.placed!.on.get("crews")?.get("cards")?.get("c1")?.map((one) => one.item.key)).toEqual(["w-1"]);
    });

    test("a read that brings a block places it alone; one that lets a block go, or goes back to one it kept, places none; an edit places again the block holding its event, once a kind it is drafted for; hiding a kind and showing it again places none — the shifts' read over their window running again for a switch or an edit alone", async () => {
        const { seam, kinds } = await placingOver();
        // Every placing the canvas asks the seam for, a block's or the read over the window's.
        let asked = 0;
        const counting: PlanEventSeamValue = { placed: (...args) => { asked += 1; return seam.placed(...args); }, place: seam.place };
        const events: PlanEventRows = { seam: counting, landings: [], paged: true };
        const placed: string[] = [];
        setBlockPlacedProbe((kind, handle) => { placed.push(`${kind} ${names.get(handle)!}`); });
        /** The blocks placed since the last look, and how many placings beside them the read over the window made. */
        const since = () => {
            const blocks = placed.splice(0).sort();
            const window = asked - blocks.length;
            asked = 0;
            return { blocks, window };
        };
        const [pa, pb, pc] = [blockOf("pa", PA), blockOf("pb", PB), blockOf("pc", PC)];
        const over = (blocks: readonly ScheduleBlockRows[], rows: readonly (readonly [string, StepValue])[], drafts = NO_DRAFTS) => readOf(blocks, rows, drafts);
        const opening = over([pa, pb], [...PA, ...PB]);
        const { result, rerender } = renderHook(({ cells, hidden }) => usePlanEventPlaced(events, SCALE, hidden, cells.drafts, cells, kinds),
            { initialProps: { cells: opening, hidden: SHOWN } });
        // Opening on two blocks: each placed for each kind of the record's cases, and the shifts over their window.
        expect(since()).toEqual({ blocks: ["run pa", "run pb", "setup pa", "setup pb"], window: 1 });
        const steps: { name: string; cells: ScheduleCellsRead; hidden: readonly string[]; placed: { blocks: string[]; window: number } }[] = [
            { name: "a block brought", cells: over([pa, pb, pc], [...PA, ...PB, ...PC]), hidden: SHOWN, placed: { blocks: ["run pc", "setup pc"], window: 0 } },
            { name: "a block let go", cells: over([pb, pc], [...PB, ...PC]), hidden: SHOWN, placed: { blocks: [], window: 0 } },
            { name: "back to the block kept", cells: over([pa, pb, pc], [...PA, ...PB, ...PC]), hidden: SHOWN, placed: { blocks: [], window: 0 } },
            // The record's drafts are every case's kind's: the shifts, read over their window, are placed again with them.
            {
                name: "an edit of press B's run",
                cells: over([pa, pb, pc], [...PA, ...PB, ...PC], draftsOf([["r-3", { ...STEPS.get("r-3")!, kind: runOf("Catalogues, reprinted") }]])),
                hidden: SHOWN, placed: { blocks: ["run pb", "setup pb"], window: 1 },
            },
            { name: "the shifts hidden", cells: over([pa, pb, pc], [...PA, ...PB, ...PC]), hidden: [planHideId.events("shift")], placed: { blocks: ["run pb", "setup pb"], window: 1 } },
            { name: "the setups hidden too", cells: over([pa, pb, pc], [...PA, ...PB, ...PC]), hidden: [planHideId.events("shift"), planHideId.events("setup")], placed: { blocks: [], window: 1 } },
            { name: "every kind shown again", cells: over([pa, pb, pc], [...PA, ...PB, ...PC]), hidden: SHOWN, placed: { blocks: [], window: 1 } },
        ];
        for (const one of steps) {
            rerender({ cells: one.cells, hidden: one.hidden });
            expect({ name: one.name, ...since() }).toEqual({ name: one.name, ...one.placed });
            expect(printPlaced(result.current.placed!)).toBe(printPlaced(wholeOf(seam, one.cells, one.hidden)));
        }
    });
});
