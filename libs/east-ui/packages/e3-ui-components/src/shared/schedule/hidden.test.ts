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
    ArrayType, East, OptionType, SortedMap, StringType, compareFor, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceWhereType, bindRecord, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { formatters, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data } from "@elaraai/e3-ui/internal";
import * as scoped from "@elaraai/e3-ui/examples/calendar/calendar-scope";
import { act, e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { clearHidden, hiddenByScope, hiddenLine, hiddenOf, useSourceHidden, type SourceHidden } from "./hidden.js";
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
