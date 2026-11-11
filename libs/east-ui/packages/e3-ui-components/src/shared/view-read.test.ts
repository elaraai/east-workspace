/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The one rule a builder reads its rows by (#1599, ruled 11 Nov 2026): how
 * what a board shows stands to what it is asked for now, and so whether it
 * takes a gesture — every pairing of what stands and what is asked, what each
 * state lets a board do, and the last complete read standing through a Save, a
 * filter and a step.
 */

import { describe, expect, test } from "vitest";
import { StandingRead, sameView, viewLive, viewOfPeriod, viewRetained, viewState, type ReadView, type ViewState } from "./view-read.js";

/** A view: a period under some choices. */
const view = (period: string, choices = ""): ReadView => ({ period, choices });

/** Every state. */
const STATES: readonly ViewState[] = ["cold", "stepping", "filtering", "rereading", "current"];

describe("how what a board shows stands to what it is asked for now", () => {
    test("nothing read yet is cold, whatever is asked and whether or not a read is on its way", () => {
        expect([viewState(undefined, view("w1"), true), viewState(undefined, view("w1"), false), viewState(undefined, view("w2", "Ready"), true)])
            .toEqual(["cold", "cold", "cold"]);
    });

    test("another period is a step, whatever the choices and whether or not its read is on its way", () => {
        expect([viewState(view("w1"), view("w2"), true), viewState(view("w1"), view("w2"), false), viewState(view("w1", "Ready"), view("w2", "Done"), true),
            viewState(view("w1", "Ready"), view("w2", "Ready"), true)]).toEqual(["stepping", "stepping", "stepping", "stepping"]);
    });

    test("the same period under other choices is a filtering, whether or not their read is on its way", () => {
        expect([viewState(view("w1", "Ready"), view("w1", "Done"), true), viewState(view("w1", "Ready"), view("w1", "Done"), false), viewState(view("w1"), view("w1", "Ready"), true)])
            .toEqual(["filtering", "filtering", "filtering"]);
    });

    test("the same period under the same choices is read again while a read is on its way, and current once none is", () => {
        expect([viewState(view("w1", "Ready"), view("w1", "Ready"), true), viewState(view("w1", "Ready"), view("w1", "Ready"), false)]).toEqual(["rereading", "current"]);
        // A builder whose rows follow no period, under no choices.
        expect([viewState(view(""), view(""), true), viewState(view(""), view(""), false)]).toEqual(["rereading", "current"]);
    });

    test("the whole table: every pairing of a period, choices and a read on its way", () => {
        const periods = ["w1", "w2"], choices = ["", "Ready"];
        for (const shownPeriod of periods) for (const shownChoices of choices) for (const askedPeriod of periods) for (const askedChoices of choices) {
            for (const reading of [true, false]) {
                const state = viewState(view(shownPeriod, shownChoices), view(askedPeriod, askedChoices), reading);
                const expected: ViewState = shownPeriod !== askedPeriod ? "stepping" : shownChoices !== askedChoices ? "filtering" : reading ? "rereading" : "current";
                expect(state, `${shownPeriod}/${shownChoices} shown, ${askedPeriod}/${askedChoices} asked, ${reading ? "reading" : "at rest"}`).toBe(expected);
            }
        }
    });

    test("two views are one only where both their period and their choices are", () => {
        expect([sameView(view("w1", "Ready"), view("w1", "Ready")), sameView(view("w1", "Ready"), view("w1", "Done")), sameView(view("w1", "Ready"), view("w2", "Ready"))])
            .toEqual([true, false, false]);
    });
});

describe("what each state lets a board do", () => {
    test("a board is live only while what it shows is the view asked — read again or not", () => {
        expect(STATES.map((state) => [state, viewLive(state)])).toEqual([["cold", false], ["stepping", false], ["filtering", false], ["rereading", true], ["current", true]]);
    });

    test("what it shows is retained only while it stands in for other choices of the same period", () => {
        expect(STATES.map((state) => [state, viewRetained(state)])).toEqual([["cold", false], ["stepping", false], ["filtering", true], ["rereading", false], ["current", false]]);
    });

    test("what it holds is of the period asked in every state but cold and a step", () => {
        expect(STATES.map((state) => [state, viewOfPeriod(state)])).toEqual([["cold", false], ["stepping", false], ["filtering", true], ["rereading", true], ["current", true]]);
    });

    test("no state is both live and retained, and a board holding none of its period is neither", () => {
        for (const state of STATES) {
            expect(viewLive(state) && viewRetained(state), state).toBe(false);
            if (!viewOfPeriod(state)) expect([viewLive(state), viewRetained(state)], state).toEqual([false, false]);
            // What is of the period is drawn: live, or retained — never neither.
            else expect(viewLive(state) || viewRetained(state), state).toBe(true);
        }
    });
});

describe("the last complete read, standing while a newer one is on its way", () => {
    test("before one lands it holds nothing, and is cold", () => {
        const standing = new StandingRead<string[]>();
        expect([standing.rows, standing.view, standing.state(view("w1"), true)]).toEqual([undefined, undefined, "cold"]);
    });

    test("a Save of the page's own: the same view read again is live throughout, the rows read before standing until the rows read since land", () => {
        const standing = new StandingRead<string[]>();
        standing.land(["a", "b"], view("w1", "Ready"));
        expect([standing.rows, standing.state(view("w1", "Ready"), false)]).toEqual([["a", "b"], "current"]);
        // The record moved: the view is asked again, its read on its way.
        expect([standing.rows, standing.state(view("w1", "Ready"), true), viewLive(standing.state(view("w1", "Ready"), true))]).toEqual([["a", "b"], "rereading", true]);
        standing.land(["a", "b2"], view("w1", "Ready"));
        expect([standing.rows, standing.state(view("w1", "Ready"), false)]).toEqual([["a", "b2"], "current"]);
    });

    test("a filter: the last choices' rows stand in, retained, until the new choices' land — then they are what is shown, live", () => {
        const standing = new StandingRead<string[]>();
        standing.land(["a", "b"], view("w1", "Ready"));
        const asked = view("w1", "Done");
        expect([standing.rows, standing.state(asked, true), viewLive(standing.state(asked, true)), viewRetained(standing.state(asked, true))])
            .toEqual([["a", "b"], "filtering", false, true]);
        standing.land(["c"], asked);
        expect([standing.rows, standing.view, standing.state(asked, false), viewLive(standing.state(asked, false))]).toEqual([["c"], asked, "current", true]);
    });

    test("a step: what stands is another period's — none of it is the period asked's — until that period's read lands", () => {
        const standing = new StandingRead<string[]>();
        standing.land(["a", "b"], view("w1"));
        expect([standing.state(view("w2"), true), viewOfPeriod(standing.state(view("w2"), true))]).toEqual(["stepping", false]);
        standing.land([], view("w2"));
        expect([standing.rows, standing.state(view("w2"), false), viewOfPeriod(standing.state(view("w2"), false))]).toEqual([[], "current", true]);
        // Stepped back before anything else lands: the first period is not what stands any more.
        expect(standing.state(view("w1"), true)).toBe("stepping");
    });
});
