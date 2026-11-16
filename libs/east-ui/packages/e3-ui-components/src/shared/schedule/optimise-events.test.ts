/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A run's answer landed on a builder's event kinds (#1409, east-workspace#1622, rules 7, 8 and 11; §9.5) — the
 * Calendar's and the Plan's: each kind's patch lands key by key as one diff, told by place, each operation's event read
 * as it stood and as it is left; an answer that changes an event outside the window it was asked of is refused whole,
 * naming it; an event the page does not hold is named, to be read first; an answer with no patch for a kind is no
 * landing. No DOM is under test: the refusal's words are east-ui-components', whose entry needs one as it loads.
 */

import { describe, expect, test } from "vitest";
import { DateTimeType, DictType, OptionType, SortedMap, StringType, StructType, compareFor, diffFor, none, some, type ValueTypeOf, type option } from "@elaraai/east";
import { optimiseMessages } from "@elaraai/east-ui-components";
import { opKey } from "../func/optimise-diff.js";
import { landOptimiseEvents, type OptimiseEventsLanded, type OptimiseEventsLanding } from "./optimise-events.js";

const Job = StructType({ title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
const Jobs = DictType(StringType, Job);
type JobValue = ValueTypeOf<typeof Job>;
const jobs = (...entries: [string, JobValue][]) => new SortedMap<string, JobValue>(entries, compareFor(StringType));
const diff = diffFor(Jobs);
/** An instant of 2026, UTC: a day of October unless another month is named (September, 8). */
const at = (day: number, hour: number, month = 9): Date => new Date(Date.UTC(2026, month, day, hour));
/** A job placed from `from` to `to`, or one in the backlog. */
const job = (title: string, from?: Date, to?: Date): JobValue => ({
    title, start: from === undefined ? none : some(from), end: to === undefined ? none : some(to),
});
/** The week the answer was asked of, and its words. */
const week = { from: at(5, 0), to: at(12, 0) };
const period = "Oct 5 – 11";

/** Two kinds, the jobs and the stops, over the rows the page holds: an event is its own row. */
function landing(held: { job: SortedMap<string, JobValue>; stop: SortedMap<string, JobValue> }, events: Record<string, unknown>): OptimiseEventsLanding<JobValue> {
    return {
        kinds: ["job", "stop"], records: { job: Jobs, stop: Jobs }, events,
        held: (kind, id): option<unknown> | undefined => {
            const row = (kind === "job" ? held.job : held.stop).get(id);
            return row === undefined ? undefined : some(row);
        },
        eventOf: (_kind, _id, row) => row as JobValue,
        window: week, period,
    };
}

/** The landing, as one that lands. */
function landed(result: ReturnType<typeof landOptimiseEvents<JobValue>>): OptimiseEventsLanded<JobValue> {
    if (result === undefined || "missing" in result || "refused" in result) throw new Error(`no landing: ${JSON.stringify(result)}`);
    return result;
}

describe("landOptimiseEvents", () => {
    const pageJobs = jobs(["j1", job("Cut")], ["j2", job("Pack", at(5, 9), at(5, 11))]);
    const pageStops = jobs(["s1", job("Oil", at(6, 6), at(6, 7))]);
    const page = { job: pageJobs, stop: pageStops };

    test("each kind's patch lands as one diff, told by place, with each operation's event as it stood and as it is left", () => {
        const answer = {
            job: diff(pageJobs, jobs(["j1", job("Cut", at(7, 9), at(7, 11))], ["j2", job("Pack", at(8, 9), at(8, 11))])),
            stop: diff(pageStops, jobs()),
        };
        const got = landed(landOptimiseEvents(landing(page, answer)));
        // The backlog job placed is an add on the canvas, the moved job a change, the stop dropped a remove: one step.
        expect(got.diff.counts).toEqual({ added: 1, changed: 1, removed: 1 });
        expect([...got.diff.ops].map(([key, op]) => [key, op.op])).toEqual([[opKey("job", "j1"), "add"], [opKey("job", "j2"), "chg"], [opKey("stop", "s1"), "del"]]);
        expect(got.diff.changes.map((change) => change.kind)).toEqual(["job", "job", "stop"]);
        // The job the answer placed stood in the backlog, and stands placed; the stop dropped stood where the page held it.
        const placed = got.told.get(opKey("job", "j1"));
        expect([placed?.was?.start.type, placed?.now?.start.type]).toEqual(["none", "some"]);
        expect(got.told.get(opKey("stop", "s1"))?.was).toBe(pageStops.get("s1"));
        expect(got.told.get(opKey("stop", "s1"))?.now).toBeUndefined();
        expect(got.backlogChanged).toBe(true);
    });

    test("an answer that moves only placed events leaves the backlog as it was", () => {
        const answer = { job: diff(pageJobs, jobs(["j1", job("Cut")], ["j2", job("Pack", at(9, 9), at(9, 11))])), stop: diff(pageStops, pageStops) };
        const got = landed(landOptimiseEvents(landing(page, answer)));
        expect(got.diff.counts).toEqual({ added: 0, changed: 1, removed: 0 });
        expect(got.backlogChanged).toBe(false);
    });

    test("an answer that changes an event outside the window it was asked of — where it is put, or where it stood — is refused whole, naming it (rule 11)", () => {
        const late = { job: diff(pageJobs, jobs(["j1", job("Cut")], ["j2", job("Pack", at(20, 9), at(20, 11))])), stop: diff(pageStops, pageStops) };
        expect(landOptimiseEvents(landing(page, late))).toEqual({ refused: optimiseMessages.refusedOutside({ row: "Pack", period }) });
        // A stop that stood the week before, taken back to the backlog: the backlog is no place outside the week, where it stood is.
        const before = jobs(["s1", job("Oil", at(28, 6, 8), at(28, 7, 8))]);
        const back = { job: diff(pageJobs, pageJobs), stop: diff(before, jobs(["s1", job("Oil")])) };
        expect(landOptimiseEvents(landing({ job: pageJobs, stop: before }, back))).toEqual({ refused: optimiseMessages.refusedOutside({ row: "Oil", period }) });
    });

    test("an event the page does not hold is named, to be read by its key first (rule 8); an answer with no patch for a kind is no landing", () => {
        const far = jobs(["j9", job("Fold", at(6, 9), at(6, 10))]);
        const answer = { job: diff(far, jobs()), stop: diff(pageStops, pageStops) };
        expect(landOptimiseEvents(landing(page, answer))).toEqual({ missing: [{ kind: "job", id: "j9" }] });
        expect(landOptimiseEvents(landing(page, { job: diff(pageJobs, pageJobs) }))).toBeUndefined();
    });
});
