/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Records a page previews its drafts over (#1437), each with an index whose
 * maintenance a binding carries: ledgers, whose measures' readings roll up
 * into their ledger's subtotals every way a reading can — summed, averaged,
 * counted, and the last of each tile summed — from the week to the year; and
 * jobs at presses, each press's jobs totalled a month at a time. A drafted
 * row's Save is previewed over them and held to what e3 keeps once it
 * commits. They are the fixtures the drafts' tests read, on no page of the
 * showcase.
 *
 * @packageDocumentation
 */

import { DateTimeType, DictType, FloatType, OptionType, SortedMap, StringType, StructType, compareFor, some, type ValueTypeOf } from "@elaraai/east";
import * as e3 from "@elaraai/e3";

const keyOrder = compareFor(StringType);
const instantOrder = compareFor(DateTimeType);

/** Monday 5 October 2026, where the readings and the jobs start. */
const MONDAY = Date.UTC(2026, 9, 5);
const DAY = 24 * 3_600_000;
/** An instant some days after Monday. */
const days = (count: number) => new Date(MONDAY + count * DAY);

/** A ledger's measure: its readings a day at a time. */
export const DraftMeasure = StructType({ name: StringType, readings: DictType(DateTimeType, FloatType) });
/** A ledger: its measures. */
export const DraftLedger = StructType({ name: StringType, measures: DictType(StringType, DraftMeasure) });

/**
 * Ledger `i`: three measures, each read every day of six weeks from Monday
 * 5 October 2026, into November.
 *
 * @param i - Its number
 * @returns The ledger
 */
export function draftLedger(i: number): ValueTypeOf<typeof DraftLedger> {
    const measure = (m: number): ValueTypeOf<typeof DraftMeasure> => ({
        name: `Measure ${m}`,
        readings: new SortedMap(Array.from({ length: 42 }, (_, d) => [days(d), i * 10 + m + d / 10] as const), instantOrder),
    });
    return { name: `Ledger ${i}`, measures: new SortedMap([["m1", measure(1)], ["m2", measure(2)], ["m3", measure(3)]], keyOrder) };
}

/** Two ledgers of three measures, their readings rolled up every way. */
export const draftLedgers = e3.record("draft_ledgers", DictType(StringType, DraftLedger), {
    initial: new SortedMap([["L-1", draftLedger(1)], ["L-2", draftLedger(2)]], keyOrder),
    indexes: (index) => ({
        // The ledgers by name.
        draft_ledgers_by_name: index.on(["name"]),
        // Each measure's readings in time, the ledger keeping their subtotals summed, averaged, counted and the last summed.
        draft_ledgers_in_time: index.nested({
            collections: {
                measures: index.nested.rows({ readings: index.nested.values({ rollup: ["sum", "mean", "count", { fold: "last", aggregate: "sum" }] }) }),
            },
            tile: "week",
            summary: "month",
        }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** A job at a press: when it runs, once it is placed. */
export const DraftJob = StructType({ press: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });

/** Jobs at two presses, one running from October into November; each press's jobs totalled a month at a time. */
export const draftJobs = e3.record("draft_jobs", DictType(StringType, DraftJob), {
    initial: new SortedMap([
        ["J-1", { press: "P1", start: some(days(1)), end: some(days(3)) }],
        ["J-2", { press: "P1", start: some(days(10)), end: some(days(12)) }],
        ["J-3", { press: "P2", start: some(days(25)), end: some(days(30)) }],
    ], keyOrder),
    indexes: (index) => ({
        // The jobs by press.
        draft_jobs_by_press: index.on(["press"]),
        // Each press's jobs, counted and timed a month at a time.
        draft_jobs_by_press_month: index.summary({ key: "press", from: "start", to: "end", tile: "month" }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
