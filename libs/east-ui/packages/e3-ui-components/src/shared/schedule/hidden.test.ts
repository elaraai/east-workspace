/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The hidden pick on a page whose sources hold a scope (`hidden.ts`, #1621),
 * on e3 itself — the scoped-page example's runs and crew, each scoped to one
 * press, the runs' rail offering a choice of crew member beside it.
 *
 * - A row its source's page's scope does not hold is no row of this page: no
 *   choice hides it, its line says so and names no filter — what it stands on,
 *   where the builder names it — and a pick clears nothing.
 * - A row the scope holds that a choice of the viewer's hides is named by that
 *   choice alone, never by the scope, and a pick clears the choice and leaves
 *   the scope.
 * - A row hidden both ways — a choice of its own source, and a row of another
 *   source its page does not hold — says both, and a pick clears the choice
 *   alone.
 *
 * What the hidden pick does over sources with no scope is each builder's own
 * DOM tests' and the engine's (`search-records.test.ts`).
 */

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import {
    ArrayType, East, OptionType, SortedMap, StringType, compareFor, encodeBeast2For, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceWhereType, bindRecord, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { formatters, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import { Data } from "@elaraai/e3-ui/internal";
import * as scoped from "@elaraai/e3-ui/examples/calendar/calendar-scope";
import { act, e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { askHiding, clearHidden, draftsOffPage, hiddenByScope, hiddenLine, hiddenOf, hiddenWhy, useSourceHidden, type SourceHidden } from "./hidden.js";
import { hiddenByText, type HiddenWords } from "./words.js";

const h = e3Harness({ "calendar/calendar-scope": scoped }, { measure: false });
afterEach(cleanup);

type Bind = ValueTypeOf<RecordSliceBindType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
const compareString = compareFor(StringType);
const whereEqual = equalFor(RecordSliceWhereType);
const printString = printFor(StringType);
const printCrew = printFor(OptionType(StringType));

/** The app's formatters, and a builder's words for a row the rail hides, in English: its table words no page of its own. */
const format = formatters("en-US");
const WORDS: HiddenWords = { hiddenByFilters: () => "hidden by the filters", hiddenBy: ({ filters, also }) => hiddenByText(filters, also) };

/**
 * A press's page: its runs, the rail offering their crew member beside the press, and its crew — each scoped to the
 * press. The runs are P-1's r1 and r3 (crew c1), r2 (crew c2), r6 and r7 (no crew), and P-2's r4, r5 and r8; the crew
 * P-1's c1 and c2, and P-2's c3 and c4.
 */
const pressPage = East.function([ArrayType(StringType)], undefined, ($, presses) => {
    const runs = $.let(Data.bindPaged(scoped.pressRuns, { indexes: ["press_runs_by_press", "press_runs_by_press_time", "press_runs_by_press_crew_time"] }));
    const crew = $.let(Data.bindPaged(scoped.pressCrew, { indexes: ["press_crew_by_press"] }));
    return {
        runs: bindRecord("hidden.runs", runs, { scope: { press: presses }, fields: { crew: { label: "Crew" } } }),
        crew: bindRecord("hidden.crew", crew, { scope: { press: presses } }),
    };
});

/** P-1's page's sources, bound over the test's workspace as a mounted page binds them. */
async function page(): Promise<{ readonly runs: Bind; readonly crew: Bind }> {
    await h.install({ fn: pressPage });
    return (East.compile(pressPage, getRegisteredPlatformImplementations()) as unknown as (presses: string[]) => { runs: Bind; crew: Bind })(["P-1"]);
}

/** A source's hidden pick, once it can ask e3. */
async function pickOf(part: Bind): Promise<() => SourceHidden> {
    const { result } = renderHook(() => useSourceHidden("Spec", part));
    await waitFor(() => expect(result.current.ready).toBe(true));
    return () => result.current;
}

/** Asks a source of some rows by their keys, and waits until it has said of each. */
async function ask(pick: () => SourceHidden, ids: readonly string[]): Promise<void> {
    await act(async () => { pick().rows.askIds(ids); });
    await waitFor(() => {
        for (const id of ids) {
            const state = pick().rows.stateOf(id);
            expect(state !== undefined && (!state.hidden || state.offPage || state.answer !== undefined), id).toBe(true);
        }
    }, { timeout: 10_000 });
    await settle();
}

/** The fields a source's narrowing holds, in order. */
const fieldsOf = (part: Bind) => [...part.read().where.keys()].sort(compareString);

/** The runs' rail, choosing the crew member c1: every run of the press but hers is hidden by it. */
async function chooseCrew(runs: Bind): Promise<void> {
    const chosen: Where = new SortedMap([["crew", variant("values", [printCrew(some("c1"))])]], compareString);
    await act(async () => { runs.write({ ...runs.read(), where: chosen, preset: none }); });
    await settle();
}

describe("a row its source's page's scope does not hold (#1621)", () => {
    test("is no row of this page: no choice hides it, its line names no filter — what it stands on, where the builder names it — and a pick clears nothing", async () => {
        const { crew } = await page();
        const pick = await pickOf(crew);
        await ask(pick, ["c1", "c3"]);
        expect(pick().rows.stateOf("c1")).toEqual({ hidden: false });
        expect(pick().rows.stateOf("c3")).toEqual({ hidden: true, answer: undefined, offPage: true });
        // The page's own crew member: nothing hides her.
        expect(hiddenOf([{ pick: pick(), id: "c1" }])).toBeUndefined();
        const hidden = hiddenOf([{ pick: pick(), id: "c3" }])!;
        expect(hidden.map(({ offPage, answer }) => [offPage, answer])).toEqual([[true, undefined]]);
        expect(hiddenLine(hidden, format, WORDS)).toBe("not on this page");
        expect(hiddenLine(hiddenOf([{ pick: pick(), id: "c3", what: "crew" }])!, format, WORDS)).toBe("its crew is not on this page");
        // A table that words it says its own.
        expect(hiddenLine(hiddenOf([{ pick: pick(), id: "c3", what: "crew" }])!, format, { ...WORDS, notOnPage: ({ what }) => `elsewhere: ${what.join("+")}` }))
            .toBe("elsewhere: crew");
        const before = crew.read().where;
        await act(async () => { clearHidden(hidden); });
        expect(whereEqual(crew.read().where, before)).toBe(true);
        expect(fieldsOf(crew)).toEqual(["press"]);
    });

    test("stays so beside a choice of the viewer's: a run of another press, asked of the page's runs narrowed by crew member, is off the page, and a pick clears nothing", async () => {
        const { runs } = await page();
        await chooseCrew(runs);
        const pick = await pickOf(runs);
        await waitFor(() => expect(fieldsOf(runs)).toEqual(["crew", "press"]));
        await ask(pick, ["r4"]);
        expect(pick().rows.stateOf("r4")).toEqual({ hidden: true, answer: undefined, offPage: true });
        const hidden = hiddenOf([{ pick: pick(), id: "r4" }])!;
        expect(hiddenLine(hidden, format, WORDS)).toBe("not on this page");
        await act(async () => { clearHidden(hidden); });
        expect(fieldsOf(runs)).toEqual(["crew", "press"]);
    });
});

describe("a row the scope holds that a choice of the viewer's hides (#1621)", () => {
    test("is named by that choice alone, never by the scope, and a pick clears the choice and leaves the scope", async () => {
        const { runs } = await page();
        await chooseCrew(runs);
        const pick = await pickOf(runs);
        await ask(pick, ["r1", "r2"]);
        expect(pick().rows.stateOf("r1")).toEqual({ hidden: false });
        const state = pick().rows.stateOf("r2");
        expect(state?.hidden === true && !state.offPage ? state.answer?.by : undefined).toEqual(["crew"]);
        const hidden = hiddenOf([{ pick: pick(), id: "r2" }])!;
        const line = hiddenLine(hidden, format, WORDS);
        expect(line).toMatch(/^hidden by Crew: .+ — picking it clears that filter$/);
        expect(line).not.toMatch(/press|page/i);
        await act(async () => { clearHidden(hidden); });
        await settle();
        expect(fieldsOf(runs)).toEqual(["press"]);
        expect(whereEqual(runs.read().where, new SortedMap([["press", variant("values", [printString("P-1")])]], compareString))).toBe(true);
    });
});

describe("a row hidden both ways (#1621)", () => {
    test("says the choice that hides it and what it stands on that is not on this page, and a pick clears the choice alone", async () => {
        const { runs, crew } = await page();
        await chooseCrew(runs);
        const runsPick = await pickOf(runs);
        const crewPick = await pickOf(crew);
        await ask(runsPick, ["r2"]);
        await ask(crewPick, ["c3"]);
        // A run the crew choice hides, standing on a crew member of another press.
        const hidden = hiddenOf([{ pick: runsPick(), id: "r2" }, { pick: crewPick(), id: "c3", what: "crew" }])!;
        expect(hidden.map(({ offPage }) => offPage)).toEqual([false, true]);
        expect(hiddenLine(hidden, format, WORDS)).toMatch(/^hidden by Crew: .+ — picking it clears that filter; its crew is not on this page$/);
        await act(async () => { clearHidden(hidden); });
        await settle();
        expect(fieldsOf(runs)).toEqual(["press"]);
        expect(fieldsOf(crew)).toEqual(["press"]);
    });
});

describe("a row the builder knows its source leaves out (#1621)", () => {
    test("with no choice of the viewer's is off the page at once — nothing else can hide it — and stays so once e3 has read it", async () => {
        const { crew } = await page();
        const pick = await pickOf(crew);
        await act(async () => { pick().rows.askIds(["c3"], true); });
        // At once, before any answer lands: its crew is not on this page, and no filter is named.
        expect(pick().rows.stateOf("c3")).toEqual({ hidden: true, answer: undefined, offPage: true });
        expect(hiddenLine(hiddenOf([{ pick: pick(), id: "c3", what: "crew" }])!, format, WORDS)).toBe("its crew is not on this page");
        await settle();
        expect(pick().rows.stateOf("c3")).toEqual({ hidden: true, answer: undefined, offPage: true });
    });

    test("beside a choice of the viewer's says nothing of it, and a pick clears nothing for it, until e3 has said which hides it", async () => {
        const { runs } = await page();
        await chooseCrew(runs);
        const pick = await pickOf(runs);
        await waitFor(() => expect(fieldsOf(runs)).toEqual(["crew", "press"]));
        // e3 slow to answer: r4 is another press's, r2 a run of the page's that the crew choice hides.
        const held = h.e3.hold(() => true);
        await act(async () => { pick().rows.askIds(["r4", "r2"], true); });
        expect([pick().rows.stateOf("r4"), pick().rows.stateOf("r2")]).toEqual([undefined, undefined]);
        expect(hiddenOf([{ pick: pick(), id: "r4" }, { pick: pick(), id: "r2" }])).toBeUndefined();
        // A pick meanwhile clears nothing: the viewer's choice stands, never cleared for a row it may not hide.
        await act(async () => { clearHidden(hiddenOf([{ pick: pick(), id: "r4" }]) ?? []); });
        expect(fieldsOf(runs)).toEqual(["crew", "press"]);
        await act(async () => { held.release(); });
        await waitFor(() => expect(pick().rows.stateOf("r4")).toEqual({ hidden: true, answer: undefined, offPage: true }), { timeout: 10_000 });
        await waitFor(() => {
            const state = pick().rows.stateOf("r2");
            expect(state?.hidden === true && !state.offPage ? state.answer?.by : undefined).toEqual(["crew"]);
        }, { timeout: 10_000 });
        expect(hiddenLine(hiddenOf([{ pick: pick(), id: "r4" }])!, format, WORDS)).toBe("not on this page");
    });

    test("why a row the builder names on its own is not shown (`hiddenWhy`): not on this page, or the filters — nothing of a row shown, nor, beside a choice, of one not told of yet", async () => {
        const { runs, crew } = await page();
        // No choice of the viewer's: a crew member the source leaves out is off the page at once.
        const crewPick = await pickOf(crew);
        await act(async () => { askHiding([{ pick: crewPick(), id: "c3" }], true); });
        expect(hiddenWhy({ pick: crewPick(), id: "c3" })).toBe("page");
        // Beside the crew choice: nothing said of r4 and r2 until e3 has — then r4 is another press's, and the choice hides
        // r2; r1, the chosen crew member's, is shown.
        await chooseCrew(runs);
        const pick = await pickOf(runs);
        await waitFor(() => expect(fieldsOf(runs)).toEqual(["crew", "press"]));
        const held = h.e3.hold(() => true);
        await act(async () => { askHiding([{ pick: pick(), id: "r4" }, { pick: pick(), id: "r2" }], true); pick().rows.askIds(["r1"]); });
        expect(["r4", "r2", "r1"].map((id) => hiddenWhy({ pick: pick(), id }))).toEqual([undefined, undefined, undefined]);
        await act(async () => { held.release(); });
        await waitFor(() => expect(["r4", "r2", "r1"].map((id) => hiddenWhy({ pick: pick(), id }))).toEqual(["page", "filters", undefined]), { timeout: 10_000 });
    });

    test("a pick over a source that holds its page's scope alone writes nothing of it, whatever e3 has said", async () => {
        const { crew } = await page();
        const pick = await pickOf(crew);
        const before = getStore().read("hidden.crew");
        await act(async () => { clearHidden([{ pick: pick(), answer: undefined }]); });
        // The very bytes it held: no write, the scope no choice to clear.
        expect(Object.is(getStore().read("hidden.crew"), before)).toBe(true);
        expect(fieldsOf(crew)).toEqual(["press"]);
    });
});

describe("a draft that left its page's scope (#1621)", () => {
    test("is not on this page: its row as drafted asked of the scope — a run drafted onto another press is, one drafted within it is not — and a pick of it clears nothing", async () => {
        const { runs } = await page();
        const pick = await pickOf(runs);
        const r2 = (await h.read(scoped.pressRuns)).get("r2")!;
        const encode = encodeBeast2For(scoped.PressRun);
        const asked = await draftsOffPage([
            { pick: pick(), id: "r2", drafted: encode({ ...r2, press: "P-2" }) },
            { pick: pick(), id: "r2", drafted: encode({ ...r2, title: "Retitled" }) },
            { pick: pick(), id: "r2", drafted: undefined },
            { pick: undefined, id: "r2", drafted: encode({ ...r2, press: "P-2" }) },
        ]);
        expect(asked.map((hidings) => hidings.map(({ id, offPage }) => [id, offPage]))).toEqual([[["r2", true]], [], [], []]);
        // Its line names no filter, whatever the reads of its stored row — which the scope holds — say.
        const hidden = hiddenOf(asked[0]!)!;
        expect(hiddenLine(hidden, format, WORDS)).toBe("not on this page");
        const before = runs.read().where;
        await act(async () => { clearHidden(hidden); });
        expect(whereEqual(runs.read().where, before)).toBe(true);
    });
});

describe("hiddenByScope", () => {
    test("a row is off its page where the scope's own clause is among what hides it, whatever else is", async () => {
        const { runs } = await page();
        const paths = runs.config;
        expect(hiddenByScope(paths, { by: ["press"], unknown: [] })).toBe(true);
        expect(hiddenByScope(paths, { by: ["press", "crew"], unknown: [] })).toBe(true);
        expect(hiddenByScope(paths, { by: ["crew"], unknown: [] })).toBe(false);
        expect(hiddenByScope(paths, { by: [], unknown: ["crew"] })).toBe(false);
    });
});
