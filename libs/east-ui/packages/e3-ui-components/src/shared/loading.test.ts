/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: these modules load east-ui-components' entry, which
 * needs one as it loads.
 *
 * What a builder's footer loading line says (#1398, CL3), pure: over a paged
 * source, its elements in flight in the record's noun, 1-based in the
 * locale's numbers, a narrowing's rows read, a read that failed and why; over
 * a period, the period read, a source's new narrowing, a failure — the
 * period's before a source's — and what a period's Retry asks again. The
 * builders' DOM tests carry the line into their footers, on e3.
 */

import { describe, expect, test } from "vitest";
import { none, some, type option } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { loadingLineText } from "@elaraai/east-ui-components/internal";
import { pagedLoadingLine, pagedLoadingMessages, periodLoading, periodLoadingLine, retryPeriod, scheduleLoadingMessages, type PeriodNarrowing } from "./loading.js";

const en = formatters("en-US"), de = formatters("de-DE");
/** Nothing to ask again. */
const STAYS = () => undefined;

describe("a paged source's line", () => {
    test("the elements in flight, 1-based, in the locale's numbers and the record's noun — the range strong; before they are known, the noun alone", () => {
        const line = pagedLoadingLine({ kind: "loading", from: 8_300, to: 8_499 }, "work orders", pagedLoadingMessages, en.number, STAYS)!;
        expect(line.kind).toBe("loading");
        expect(line.text).toEqual(["Loading work orders ", { strong: "8,301–8,500" }]);
        expect(line.short).toBe("Loading…");
        expect(loadingLineText(pagedLoadingLine({ kind: "loading", from: 8_300, to: 8_499 }, "Aufträge", pagedLoadingMessages, de.number, STAYS)!.text))
            .toBe("Loading Aufträge 8.301–8.500");
        expect(loadingLineText(pagedLoadingLine({ kind: "loading", from: undefined, to: undefined }, "work orders", pagedLoadingMessages, en.number, STAYS)!.text))
            .toBe("Loading work orders…");
    });

    test("a narrowing's rows read: `Filtering …`, its short form the same word", () => {
        const line = pagedLoadingLine({ kind: "filtering" }, "work orders", pagedLoadingMessages, en.number, STAYS)!;
        expect([line.kind, loadingLineText(line.text), line.short]).toEqual(["loading", "Filtering work orders…", "Filtering…"]);
    });

    test("a read that failed: its range, or the source's with none; the reason beside it; Retry asks again", () => {
        let asked = 0;
        const line = pagedLoadingLine({ kind: "failed", from: 200, to: 399, reason: "gateway timeout" }, "rows", pagedLoadingMessages, en.number, () => { asked += 1; })!;
        if (line.kind !== "failed") throw new Error("expected a failed line");
        expect([loadingLineText(line.text), line.short, line.reason, line.retry]).toEqual(["Couldn't read rows 201–400", "Couldn't read", "gateway timeout", "Retry"]);
        line.onRetry();
        expect(asked).toBe(1);
        const source = pagedLoadingLine({ kind: "failed", from: undefined, to: undefined, reason: "count unavailable" }, "rows", pagedLoadingMessages, en.number, STAYS)!;
        expect(loadingLineText(source.text)).toBe("Couldn't read rows");
    });

    test("nothing read, no line", () => {
        expect(pagedLoadingLine(undefined, "rows", pagedLoadingMessages, en.number, STAYS)).toBeUndefined();
    });
});

/** A source the builder follows: resolved, nothing in flight, unless said. */
function source(noun: string, state: Partial<Omit<PeriodNarrowing, "noun">> = {}): PeriodNarrowing {
    return { noun, ready: true, loading: false, error: undefined, retry: STAYS, ...state };
}

describe("a period's line", () => {
    const period = { loading: false, error: undefined, retry: STAYS };

    test("a failure first — the period's, then a source's — then the period's reads, a source's first membership among them, then a source's new narrowing", () => {
        const retryWeek = () => undefined, retryPeople = () => undefined;
        expect(periodLoading({ ...period, error: "the store is down", retry: retryWeek }, [source("people", { error: "no index" })]))
            .toEqual({ kind: "failed", reason: "the store is down", onRetry: retryWeek });
        expect(periodLoading({ ...period, loading: true }, [source("people", { error: "no index", retry: retryPeople })]))
            .toEqual({ kind: "failed", reason: "no index", noun: "people", onRetry: retryPeople });
        expect(periodLoading({ ...period, loading: true }, [source("people", { loading: true })])).toEqual({ kind: "loading" });
        expect(periodLoading(period, [source("people", { ready: false, loading: true })])).toEqual({ kind: "loading" });
        expect(periodLoading(period, [source("people"), source("activities", { loading: true })])).toEqual({ kind: "filtering", noun: "activities" });
        expect(periodLoading(period, [source("people"), source("activities")])).toBeUndefined();
    });

    test("its words: the period strong, a source by its noun; the short forms the shared parts'", () => {
        const loading = periodLoadingLine({ kind: "loading" }, "12–18 Mar")!;
        expect([loading.kind, loading.text, loading.short]).toEqual(["loading", ["Loading ", { strong: "12–18 Mar" }], "Loading…"]);
        const filtering = periodLoadingLine({ kind: "filtering", noun: "people" }, "12–18 Mar")!;
        expect([filtering.kind, loadingLineText(filtering.text), filtering.short]).toEqual(["loading", "Filtering people…", "Filtering…"]);
        const failed = periodLoadingLine({ kind: "failed", reason: "the store is down", onRetry: STAYS }, "Wed 12 May")!;
        if (failed.kind !== "failed") throw new Error("expected a failed line");
        expect([failed.text, failed.short, failed.reason, failed.retry]).toEqual([["Couldn't read ", { strong: "Wed 12 May" }], "Couldn't read", "the store is down", "Retry"]);
        const narrowing = periodLoadingLine({ kind: "failed", reason: "no index", noun: "people", onRetry: STAYS }, "Wed 12 May")!;
        expect(loadingLineText(narrowing.text)).toBe("Couldn't read people");
        expect(periodLoadingLine(undefined, "Wed 12 May")).toBeUndefined();
    });

    test("a builder's own words, where it gives them", () => {
        const words = { ...scheduleLoadingMessages, periodLoading: ({ period: p }: { period: string }) => `Lade ${p}` };
        expect(periodLoadingLine({ kind: "loading" }, "12.–18. März", words)!.text).toBe("Lade 12.–18. März");
    });

    test("Retry asks again each record the period's read reads: through its `entries` where it is read a window at a time, else through its source of the slice", () => {
        const asked: string[] = [];
        const entries = (name: string): option<{ refresh: (target: option<string>) => null }> =>
            some({ refresh: (target: option<string>) => { asked.push(`${name} ${target.type}`); return null; } });
        const part = (name: string) => ({ retry: () => { asked.push(`${name} part`); return null; } });
        retryPeriod([
            { entries: entries("duties"), part: part("duties") },
            { entries: none, part: part("bins") },
            { entries: entries("weeks") },
            { entries: none },
        ]);
        expect(asked).toEqual(["duties none", "bins part", "weeks none"]);
    });
});
