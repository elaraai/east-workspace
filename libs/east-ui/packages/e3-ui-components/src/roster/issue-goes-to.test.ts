/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { DAY, issueGoesTo, type Issue, type RosterView, type Week } from "./model.js";

/** W9 of March 2028's month: it starts in February. */
const START = new Date("2028-02-28T00:00:00Z");
const SLOT = { day: 2n, group: "inbound", shift: "early" };
const MONTH: RosterView = { layout: "people", period: "month", date: Date.UTC(2028, 2, 6) };
const WEEK = { assignments: new Map([["d1", { who: variant("person", "ada") }], ["d2", { who: variant("request", "firm") }]]) } as unknown as Week;
const issue = (fields: Partial<Issue>): Issue => ({ slot: none, assignment: none, fix: none, ...fields }) as Issue;

describe("where pressing an issue goes", () => {
    test("in Week: its day, with what it names selected", () => {
        const view: RosterView = { ...MONTH, period: "week" };
        expect(issueGoesTo(issue({ slot: some(SLOT), assignment: some("d1") }), view, START, WEEK, true)).toEqual({ view: { ...view, date: START.getTime() + 2 * DAY }, select: { type: "assignment", key: "d1" } });
        expect(issueGoesTo(issue({ slot: some(SLOT) }), view, START, WEEK, true).select).toEqual({ type: "slot", slot: SLOT });
        expect(issueGoesTo(issue({}), view, START, WEEK, true)).toEqual({ view: undefined, select: undefined });
    });
    test("in Month with Week offered: its week in Week, what it names selected", () => {
        expect(issueGoesTo(issue({ slot: some(SLOT), assignment: some("d1") }), MONTH, START, WEEK, true)).toEqual({ view: { ...MONTH, period: "week", date: START.getTime() + 2 * DAY }, select: { type: "assignment", key: "d1" } });
        expect(issueGoesTo(issue({}), MONTH, START, WEEK, true).view).toEqual({ ...MONTH, period: "week", date: START.getTime() });
    });
    test("in Month with no Week: the month stays, the duty's person-week selected; nothing of a person's to select, nothing", () => {
        expect(issueGoesTo(issue({ slot: some(SLOT), assignment: some("d1") }), MONTH, START, WEEK, false)).toEqual({ view: undefined, select: { type: "personWeek", key: "ada", start: START.getTime() } });
        expect(issueGoesTo(issue({ slot: some(SLOT), assignment: some("d2") }), MONTH, START, WEEK, false)).toEqual({ view: undefined, select: undefined });
        expect(issueGoesTo(issue({ slot: some(SLOT) }), MONTH, START, WEEK, false)).toEqual({ view: undefined, select: undefined });
    });
});
