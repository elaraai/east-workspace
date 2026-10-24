/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What decoding a page costs (#1398, CL9) — `E3_UI_PERF=1`, never in CI: a
 * timing on a shared runner is no deterministic signal. The paged runtime
 * decodes each window where it lands, on the main thread, its decoder made
 * afresh for each (`paged-runtime.ts`: `decodeBeast2For(sourceType)(page.data)`).
 * This times both for the pages the showcase's `perf-scroll.spec.ts` lands — a
 * window of the stress Sheet's jobs (200 rows, their work centres a Link each)
 * and a page of the Calendar's events (256) — each as its record's own type:
 * its bytes, the decoder's making, and the decode, each the median of 50 runs
 * after 10 to warm up, in this process's V8, the engine a page runs.
 *
 * Beside them, what a worker's decode could hand the main thread. A worker
 * answers by structured clone, and a decoded page is no value a clone takes: a
 * Dict is a `SortedMap` holding its key comparator, a function, and a
 * variant's brand is a symbol-keyed property, which a clone drops. So the
 * page's rows alone, as an Array, are cloned — what a worker's answer costs the
 * main thread to receive before any of it is an East value again — and whether
 * a variant in them is still one.
 *
 * Run: `E3_UI_PERF=1 pnpm exec vitest run src/platform/decode-perf.test.ts`.
 */

import { describe, expect, test } from "vitest";
import { DictType, East, StringType, decodeBeast2For, encodeBeast2For, isVariant, some, type EastType, type ValueTypeOf } from "@elaraai/east";
import { StressJob, generateStressJobs } from "@elaraai/e3-ui/examples/sheet/sheet";
import { IndexedCalendarEvent } from "@elaraai/e3-ui/examples/calendar/calendar-records";

/** Whether the benchmark runs: `E3_UI_PERF=1`, as the renderers' benchmarks are asked for. */
const PERF = process.env["E3_UI_PERF"] === "1";

/** The median of `runs` timings of `work`, ms, after `warm` untimed. */
function median(work: () => unknown, runs = 50, warm = 10): number {
    for (let i = 0; i < warm; i++) work();
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        work();
        times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)]!;
}

/** What a structured clone makes of a value: `cloned`, or the error it throws. */
function cloneOutcome(value: unknown): string {
    try {
        structuredClone(value);
        return "cloned";
    } catch (err) {
        return err instanceof Error ? err.name : "refused";
    }
}

/**
 * A page's cost: its bytes, its decoder's making, its decode and both as a
 * landing does them, ms, and per row, µs; what a clone makes of the decoded
 * page; and the clone of its rows alone, ms, and whether a variant in them
 * is one after it.
 */
function costOf<T extends EastType, R>(type: T, page: ValueTypeOf<T>, rowsOf: (decoded: ValueTypeOf<T>) => readonly R[], variantOf: (row: R) => unknown) {
    const bytes = encodeBeast2For(type)(page);
    const make = median(() => decodeBeast2For(type));
    const decode = decodeBeast2For(type);
    const decodeMs = median(() => decode(bytes));
    const landing = median(() => decodeBeast2For(type)(bytes));
    const decoded = decode(bytes) as ValueTypeOf<T>;
    const rows = rowsOf(decoded);
    const rowsCloneMs = median(() => structuredClone(rows));
    const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
    return {
        rows: rows.length, bytes: bytes.length,
        makeDecoderMs: round(make, 3), decodeMs: round(decodeMs), asLandedMs: round(landing),
        perRowUs: round((decodeMs * 1000) / rows.length, 1),
        pageClone: cloneOutcome(decoded),
        rowsCloneMs: round(rowsCloneMs),
        variantAfterClone: isVariant(variantOf(structuredClone(rows)[0]!)),
    };
}

describe.skipIf(!PERF)("what decoding a page costs (#1398, CL9; E3_UI_PERF=1, not a CI gate)", () => {
    test("a window of the stress Sheet's jobs and a page of the Calendar's events, as each record's own type", () => {
        // The stress Sheet's first window: 200 of its jobs, keyed by their ids.
        const jobs = East.compile(generateStressJobs, [])(200n);
        const JobsType = DictType(StringType, StressJob);
        const window = new Map(jobs.map((job) => [job.id, job] as const));
        // A page of the Calendar's events: 256, as its seed makes them.
        const EventsType = DictType(StringType, IndexedCalendarEvent);
        const events = new Map<string, ValueTypeOf<typeof IndexedCalendarEvent>>();
        for (let i = 0; i < 256; i++) {
            const start = new Date(Date.UTC(2026, 0, 1 + ((i * 37) % 363), 6 + (i % 10)));
            events.set(`production-${10_000 + i}`, {
                title: `Production job ${10_000 + i}`, start: some(start), end: some(new Date(start.getTime() + (1 + (i % 4)) * 3_600_000)),
                machine: i % 2 === 0 ? "press-a" : "press-b", status: i % 3 === 0 ? "Done" : "Ready",
                customer: ["Northern Press", "City Arts", "North Market", "Festival"][i % 4]!,
            });
        }
        const results = {
            "sheet window": costOf(JobsType, window, (page) => [...page.values()], (job) => job.start),
            "calendar page": costOf(EventsType, events, (page) => [...page.values()], (event) => event.start),
        };
        console.log(`CL9 decode ${JSON.stringify(results, null, 2)}`);
        expect(results["sheet window"].rows).toBe(200);
        expect(results["calendar page"].rows).toBe(256);
    });
});
