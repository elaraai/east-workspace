/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Inspector's words and figures (#1331), pure, over a small day of their
 * own: each status, banner, fact, list and count the mock writes for them, in
 * e3-ui's quantities and loads, compiled.
 */
import { describe, expect, test } from "vitest";
import { NullType, SortedMap, StringType, compareFor, none, some, toEastTypeValue, variant } from "@elaraai/east";
import type { Grip } from "./drag.js";
import {
    alternativesOf, bannersOf, batchLine, binStatus, bookOptions, dropHeadOf, factsOf, fixLabel, groupLine, issueGroups, kindLabel, matesOf, narrowingNote,
    reservationStatus, reserveOptions, resourceStatus, stepHelp, summaryLine, summaryStats, verdictLine, wasLine, type InspectorWords,
} from "./inspector-model.js";
import {
    allocationDomain, allocationWords, type Bin, type Context, type Day, type EventRow, type Fit, type FitResult, type Issue, type Load, type ResourceLine,
    type ResourceRow, type Slot,
} from "./model.js";
import { DEFAULT_NOUNS } from "./nouns.js";

const byString = compareFor(StringType);
const { sameBin } = allocationDomain(toEastTypeValue(NullType));
const DAY = new Date(Date.UTC(2027, 4, 11));
/** An instant of May 2027: `at(11, 10, 35)` is Tue 11's 10:35. */
const at = (date: number, h = 0, m = 0) => new Date(Date.UTC(2027, 4, date, h, m));
const board = allocationWords();
const words: InspectorWords = {
    nouns: DEFAULT_NOUNS, quantity: v => board.quantity(v, "m³"), number: v => board.quantity(v, ""), lane: key => key,
    load: (fill, row) => board.load(fill, row, "m³"),
};
const STATE = { free: variant("free", null), loading: variant("loading", null), busy: variant("busy", null) };
const TONE = { warning: variant("warning", null), danger: variant("danger", null), neutral: variant("neutral", null) };
const row = (key: string, more: Partial<ResourceRow> = {}): ResourceRow => ({
    key, label: key, group: some("Hall B"), meta: none, note: none, min: 20, max: 40, hold: variant("days", 7), jobs: [], ...more,
}) as unknown as ResourceRow;
const bin = (lane: string, when: Date, event: string | undefined, quantity: number, parts: [string, number][]): Bin => ({
    lane, at: when, event: event === undefined ? none : some(event), quantity, kind: none, hold: variant("days", 8), parts: new SortedMap(parts, byString), values: null,
}) as unknown as Bin;
const load = (resource: string, fill: number, bins: bigint, to: Date | undefined, state: keyof typeof STATE): Load => ({
    resource, fill, bins, hold: to === undefined ? none : some({ from: DAY, to }), state: STATE[state],
}) as unknown as Load;
const line = (more: Partial<ResourceLine> = {}): ResourceLine => ({ text: "", tone: TONE.neutral, over: false, under: false, overlap: false, next: none, ...more }) as unknown as ResourceLine;
const issue = (kind: Issue["kind"], tone: keyof typeof TONE, more: Partial<Issue> = {}): Issue => ({
    kind, tone: TONE[tone], title: "", detail: "", bin: none, resource: none, flag: none, fix: none, ...more,
}) as unknown as Issue;
const event = (key: string, quantity: number, due: Date | undefined, meta?: string): EventRow => ({
    key, label: key, meta: meta === undefined ? none : some(meta), quantity, hold: variant("days", 8), kind: none,
    due: due === undefined ? none : some(due), window: none, details: [],
}) as unknown as EventRow;
const context = (events: EventRow[], resources: ResourceRow[]): Context => ({
    lanes: [{ key: "B-1", label: "B-1", offset: variant("minutes", 15) }], every: variant("hours", 1),
    events: new SortedMap(events.map(e => [e.key, e] as const), byString), resources: new SortedMap(resources.map(r => [r.key, r] as const), byString),
    rules: { under: true }, unit: "m³",
}) as unknown as Context;
const day = (bins: [string, Bin][]): Day => ({ status: variant("draft", null), bins: new SortedMap(bins, byString) }) as unknown as Day;
const fits = (score: number): Fit => variant("fits", { score, why: `score ${score}`, warn: none });
const refused = (group: string, reason: string): Fit => variant("refused", { group, reason, measure: variant("none", null) });
/** A place's answer: a verdict per resource. */
const placed = (resources: [string, Fit][]): FitResult => ({
    ask: variant("place", { subject: variant("bin", "3101"), quantity: 0 }), resources: new SortedMap<string, Fit>(resources, byString),
    bins: new SortedMap<string, Fit>([], byString), events: new SortedMap<string, Fit>([], byString), reserve: none, basis: "ranked by load",
});

describe("statuses (A56, A61, A62)", () => {
    test("A56 — a bin's: Committed, Check, Not linked; a draft's Added, Moved, Allocated (its resources), Edited (its quantity), Not linked · unsaved", () => {
        const committed = bin("B-2", at(11, 10, 35), "LD-2210", 32, [["K-108", 32]]);
        const fine = line(), over = line({ over: true }), into = line({ overlap: true });
        expect(binStatus(committed, committed, sameBin, [fine])).toEqual({ word: "Committed", tone: "success", ring: false, pending: undefined });
        expect([binStatus(committed, committed, sameBin, [over]).word, binStatus(committed, committed, sameBin, [fine, into]).word]).toEqual(["Check", "Check"]);
        expect(binStatus(committed, undefined, sameBin, [fine])).toEqual({ word: "Added · unsaved", tone: "neutral", ring: true, pending: "new" });
        expect(binStatus({ ...committed, at: at(11, 11, 35) }, committed, sameBin, [fine]).word).toBe("Moved · unsaved");
        expect(binStatus({ ...committed, lane: "B-3" }, committed, sameBin, [fine]).word).toBe("Moved · unsaved");
        expect(binStatus({ ...committed, parts: new SortedMap([["K-103", 32]], byString) }, committed, sameBin, [fine]).word).toBe("Allocated · unsaved");
        // Its quantity changed and its one part with it: the same resource, so an edit.
        expect(binStatus({ ...committed, quantity: 30, parts: new SortedMap([["K-108", 30]], byString) }, committed, sameBin, [fine]))
            .toEqual({ word: "Edited · unsaved", tone: "neutral", ring: true, pending: "pending" });
        const unlinked = { ...committed, parts: new SortedMap<string, number>([], byString) };
        expect(binStatus(unlinked, committed, sameBin, [])).toEqual({ word: "Not linked · unsaved", tone: "neutral", ring: true, pending: "pending" });
        expect(binStatus(unlinked, undefined, sameBin, []).word).toBe("Not linked · unsaved");
        expect(binStatus(unlinked, unlinked, sameBin, [])).toEqual({ word: "Not linked", tone: "warning", ring: false, pending: undefined });
    });

    test("A61 — a reservation's: Reserved, `Added · unsaved`, `Moved · unsaved`; A62 — a resource's: Check, Loading, Busy, Free", () => {
        const reserved = bin("B-1", at(11, 0, 15), undefined, 0, [["K-305", 0]]);
        expect(reservationStatus(reserved, reserved, sameBin)).toEqual({ word: "Reserved", tone: "info", ring: false, pending: undefined });
        expect(reservationStatus(reserved, undefined, sameBin)).toEqual({ word: "Added · unsaved", tone: "neutral", ring: true, pending: "new" });
        expect(reservationStatus({ ...reserved, parts: new SortedMap([["K-601", 0]], byString) }, reserved, sameBin))
            .toEqual({ word: "Moved · unsaved", tone: "neutral", ring: true, pending: "pending" });
        expect(resourceStatus(load("K-207", 44, 1n, at(20), "loading"), line({ over: true }))).toEqual({ word: "Check", tone: "warning", ring: false, pending: undefined });
        expect(resourceStatus(load("K-105", 32, 1n, at(19), "loading"), line({ overlap: true })).word).toBe("Check");
        // Under its minimum is a warning of its own, never a Check.
        expect(resourceStatus(load("K-207", 10, 1n, at(20), "loading"), line({ under: true }))).toEqual({ word: "Loading", tone: "info", ring: false, pending: undefined });
        expect(resourceStatus(load("K-503", 0, 0n, undefined, "busy"), line())).toEqual({ word: "Busy", tone: "neutral", ring: false, pending: undefined });
        expect(resourceStatus(load("K-601", 0, 0n, undefined, "free"), line())).toEqual({ word: "Free", tone: "success", ring: false, pending: undefined });
    });
});

describe("banners (A56, A62)", () => {
    test("A56 — the built-in issues in the mock's sentences, the bin's first; the app's warnings in their own words; neutral ones never", () => {
        const k207 = { row: row("K-207"), load: load("K-207", 44, 1n, at(20), "loading"), line: line({ over: true }) };
        const k105 = { row: row("K-105", { min: 16, max: 32 }), load: load("K-105", 32, 1n, at(19), "loading"),
            line: line({ overlap: true, next: some({ label: "planned", start: at(17), end: at(25) }) }) };
        const k601 = { row: row("K-601", { min: 40, max: 60 }), load: load("K-601", 21, 1n, at(19), "loading"), line: line({ under: true }) };
        const issues = [
            issue(variant("unlinked", null), "warning", { bin: some("N1") }),
            issue(variant("overlap", null), "warning", { resource: some("K-105") }),
            issue(variant("over", null), "danger", { resource: some("K-207") }),
            issue(variant("under", null), "warning", { resource: some("K-601") }),
            issue(variant("custom", "Spec mismatch"), "neutral", { bin: some("N1"), detail: "Spec booked MC08 · measured MC22" }),
            // About the bin and a resource: the bin's, once.
            issue(variant("custom", "Moisture"), "warning", { bin: some("N1"), resource: some("K-207"), detail: "MC22 is wet for K-207" }),
            issue(variant("custom", "Hall"), "danger", { resource: some("K-601"), detail: "K-601's hall is closed on Tue 11" }),
        ];
        expect(bannersOf({ issues, bin: { id: "N1", code: "LD-2231" }, resources: [k207, k105, k601], day: DAY, words })).toEqual([
            { status: "warning", title: "Not linked", text: "LD-2231 has no resource. Link it to a gap that fits, or it stays unplaced." },
            { status: "warning", title: "Moisture", text: "MC22 is wet for K-207" },
            { status: "error", title: "Over max", text: "K-207 holds 44 m³ against a 40 m³ max · 4 m³ over." },
            { status: "warning", title: "Overlaps the next job", text: "The 8-day hold on K-105 runs to Tue 18, 2 d into the job planned Mon 17." },
            { status: "warning", title: "Under min", text: "K-601 holds 21 m³ against a 40 m³ minimum · 19 m³ short. Another event can top it up; Save still works." },
            { status: "error", title: "Hall", text: "K-601's hall is closed on Tue 11" },
        ]);
        // A resource inspected alone: its own issues, none of a bin's.
        expect(bannersOf({ issues, resources: [k207], day: DAY, words }).map(b => b.title)).toEqual(["Over max", "Moisture"]);
    });
});

describe("a resource's facts and lines (A58, A62)", () => {
    test("A58 — Before, Hold and Next fill: `job C-3143 · released Mon 10`, `Tue 11 to Mon 17 · 7 d`, `Thu 20 · 2 d spare · …`; overlapping, in warn", () => {
        const end = at(21);
        const k108 = row("K-108", { note: some("the plan had this charge on Wed 12"), jobs: [
            { label: "C-3140", start: at(1), end: at(5) }, { label: "C-3143", start: at(3), end: at(11) }, { label: "planned", start: at(20), end: at(28) }] });
        const held = { row: k108, load: load("K-108", 32, 1n, at(18), "loading"), line: line({ next: some(k108.jobs[2]!) }) };
        expect(factsOf(held, DAY, end, words)).toEqual({
            before: "job C-3143 · released Mon 10", hold: { text: "Tue 11 to Mon 17 · 7 d", absent: false },
            next: { text: "Thu 20 · 2 d spare · the plan had this charge on Wed 12", warn: false },
        });
        const k105 = row("K-105", { jobs: [{ label: "planned", start: at(17), end: at(25) }] });
        const into = { row: k105, load: load("K-105", 32, 1n, at(19), "loading"), line: line({ overlap: true, next: some(k105.jobs[0]!) }) };
        expect(factsOf(into, DAY, end, words)).toEqual({
            before: "empty in the plan", hold: { text: "Tue 11 to Tue 18 · 8 d", absent: false }, next: { text: "Mon 17 · hold overlaps it by 2 d", warn: true },
        });
    });

    test("A62, A85 — busy: its line; free: `not started`, `none planned to Thu 20`; the group line; the batch line", () => {
        const end = at(21);
        const busy = { row: row("K-503"), load: load("K-503", 0, 0n, undefined, "busy"), line: line({ text: "busy until Fri 14" }) };
        expect(factsOf(busy, DAY, end, words).hold).toEqual({ text: "busy until Fri 14", absent: false });
        const free = { row: row("K-601", { group: some("Bulk"), min: 40, max: 60 }), load: load("K-601", 0, 0n, undefined, "free"), line: line() };
        expect(factsOf(free, DAY, end, words)).toEqual({ before: "empty in the plan", hold: { text: "not started", absent: true }, next: { text: "none planned to Thu 20", warn: false } });
        // A next job with no hold today: its day alone.
        const later = { ...free, line: line({ next: some({ label: "planned", start: at(19), end: at(25) }) }) };
        expect(factsOf(later, DAY, end, words).next).toEqual({ text: "Wed 19", warn: false });
        expect(groupLine(free.row, words)).toBe("Bulk · min 40 m³ · max 60 m³");
        expect(groupLine(row("K-9", { group: none }), words)).toBe("min 20 m³ · max 40 m³");
        expect([batchLine(load("K-304", 7, 5n, at(18), "loading"), words), batchLine(load("K-108", 32, 1n, at(18), "loading"), words)])
            .toEqual(["Batched · 5 bins · 7 m³", "One bin fills it."]);
    });

    test("A58, A62 — a resource's bins today, by time: each its part there, a reservation `reserved`; its tooltip `Bin 3120 · …`, a new one's `Bin new`", () => {
        const cx = context([event("LD-1", 3, undefined, "BRK · R2"), event("LD-2", 4, undefined)], [row("K-304"), row("K-101")]);
        const reservation = bin("B-3", at(11, 10, 55), undefined, 0, [["K-304", 0]]);
        const held = day([["3120", bin("B-1", at(11, 9, 15), "LD-1", 3, [["K-304", 3]])], ["3121", bin("B-1", at(11, 7, 15), "LD-3", 9, [["K-101", 9]])], ["V2", reservation]]);
        const plan = day([...held.bins, ["N1", bin("B-2", at(11, 8, 35), "LD-2", 6, [["K-304", 4], ["K-101", 2]])]]);
        expect(matesOf(plan, held, "K-304", cx, words)).toEqual([
            { id: "N1", time: "08:35", lane: "B-2", code: "LD-2", quantity: "4 m³", tip: "Bin new" },
            { id: "3120", time: "09:15", lane: "B-1", code: "LD-1", quantity: "3 m³", tip: "Bin 3120 · BRK · R2" },
            { id: "V2", time: "10:55", lane: "B-3", code: "Reserved", quantity: "reserved", tip: "Bin V2" },
        ]);
        expect(matesOf(plan, held, "K-601", cx, words)).toEqual([]);
    });

    test("A57, A59 — the stepper's help `B-1 bins at :15 · ± 1 h, 00–23 on Tue 11`; a draft's `was` line", () => {
        const slots = Array.from({ length: 24 }, (_, h): Slot => ({ lane: "B-1", at: at(11, h, 15), status: STATE.free, bins: [] }) as unknown as Slot);
        expect(stepHelp(slots, "B-1", variant("hours", 1), DAY, words)).toBe("B-1 bins at :15 · ± 1 h, 00–23 on Tue 11");
        expect(stepHelp(slots.filter((_, h) => h % 2 === 0), "B-1", variant("hours", 2), DAY, words)).toBe("B-1 bins at :15 · ± 2 h, 00–22 on Tue 11");
        expect(stepHelp([], "B-1", variant("hours", 1), DAY, words)).toBe("");
        const cx = context([], [row("K-108")]);
        expect(wasLine(bin("B-2", at(11, 10, 35), "LD-2210", 32, [["K-108", 32]]), cx, words)).toBe("was K-108 · B-2 10:35");
        expect(wasLine(bin("B-2", at(11, 10, 35), "LD-2210", 32, []), cx, words)).toBe("was not linked · B-2 10:35");
        expect(wasLine(undefined, cx, words)).toBe("new booking · not in the plan yet");
    });
});

describe("lists (A59–A61)", () => {
    test("A60 — what a free slot books: the events still to book, overdue first in warn, then the bins the drafts removed — of the events the narrowing shows", () => {
        const cx = context([event("LD-1", 10, at(13), "BRK · R2"), event("LD-2", 8, at(9), "RDG · R1"), event("LD-3", 5, undefined), event("LD-4", 7, undefined), event("LD-5", 6, undefined)], []);
        const held = day([["3001", bin("B-1", at(11, 6, 15), "LD-4", 7, [["K-1", 7]])], ["3002", bin("B-2", at(11, 6, 35), "LD-5", 6, [["K-2", 6]])]]);
        // The drafts removed 3001, and book LD-3.
        const plan = day([["3002", held.bins.get("3002")!], ["N1", bin("B-3", at(11, 6, 55), "LD-3", 5, [])]]);
        const options = bookOptions({ plan, held, context: cx, day: DAY, shown: none, words });
        expect(options.map(o => [o.key, o.code, o.quantity, o.line, o.warn])).toEqual([
            ["event:LD-2", "LD-2", "8 m³", "RDG · R1 · overdue", true], ["event:LD-1", "LD-1", "10 m³", "BRK · R2", false], ["removed:3001", "LD-4", "7 m³", "removed from plan", false],
        ]);
        expect(options.map(o => o.grip)).toEqual([{ kind: "event", event: "LD-2" }, { kind: "event", event: "LD-1" }, { kind: "removed", bin: "3001" }]);
        expect(bookOptions({ plan, held, context: cx, day: DAY, shown: some(new Set(["LD-1"])), words }).map(o => o.key)).toEqual(["event:LD-1"]);
    });

    test("A60 — the five best resources to reserve on: free first, each best first, the fit's reason after `free` or `loading`; shown ones only; nothing while pending", () => {
        const keys = ["K-1", "K-2", "K-3", "K-4", "K-5", "K-6", "K-7"];
        const answer = placed([["K-1", fits(0.9)], ["K-2", fits(0.2)], ["K-3", fits(0.5)], ["K-4", fits(0.8)], ["K-5", fits(0.7)], ["K-6", fits(0.6)], ["K-7", refused("Busy", "busy until Fri 14")]]);
        const loading = new Set(["K-1", "K-4"]);
        const loads = new SortedMap(keys.map(k => [k, load(k, loading.has(k) ? 10 : 0, loading.has(k) ? 1n : 0n, undefined, loading.has(k) ? "loading" : "free")] as const), byString);
        const cx = context([], keys.map(k => row(k)));
        expect(reserveOptions(undefined, loads, cx, none, words)).toBeUndefined();
        expect(reserveOptions(answer, loads, cx, none, words)).toEqual([
            { key: "K-5", name: "K-5", range: "20–40 m³", line: "free · score 0.7" }, { key: "K-6", name: "K-6", range: "20–40 m³", line: "free · score 0.6" },
            { key: "K-3", name: "K-3", range: "20–40 m³", line: "free · score 0.5" }, { key: "K-2", name: "K-2", range: "20–40 m³", line: "free · score 0.2" },
            { key: "K-1", name: "K-1", range: "20–40 m³", line: "loading · score 0.9" },
        ]);
        expect(reserveOptions(answer, loads, cx, some(new Set(["K-4", "K-2"])), words)!.map(o => o.key)).toEqual(["K-2", "K-4"]);
    });

    test("A59 — the three best other fits, the current resource excepted, each its rank and reason; none while the answer is on its way", () => {
        const answer = placed([["K-1", fits(0.9)], ["K-2", fits(0.5)], ["K-3", refused("Over max", "over max by 4 m³")], ["K-4", fits(0.7)], ["K-5", fits(0.6)]]);
        const cx = context([], ["K-1", "K-2", "K-3", "K-4", "K-5"].map(k => row(k)));
        expect(alternativesOf(answer, "K-1", cx)).toEqual([
            { key: "K-4", rank: 1, name: "K-4", why: "score 0.7" }, { key: "K-5", rank: 2, name: "K-5", why: "score 0.6" }, { key: "K-2", rank: 3, name: "K-2", why: "score 0.5" },
        ]);
        expect(alternativesOf(answer, undefined, cx)!.map(f => f.key)).toEqual(["K-1", "K-4", "K-5"]);
        expect(alternativesOf(undefined, "K-1", cx)).toBeUndefined();
    });

    test("A61 — a booking's verdict: the fit's reason; refused, `doesn’t fit · …` in warn and off; pending, `checking fits…` and off", () => {
        expect(verdictLine(variant("fits", { score: 1, why: "1 d spare to Thu 20", warn: none }))).toEqual({ line: "1 d spare to Thu 20", warn: false, enabled: true });
        expect(verdictLine(refused("Over max", "over max by 20 m³"))).toEqual({ line: "doesn’t fit · over max by 20 m³", warn: true, enabled: false });
        expect(verdictLine(undefined)).toEqual({ line: "checking fits…", warn: false, enabled: false });
    });
});

describe("the summary (A63) and Issues (A64)", () => {
    test("A63 — Bins, Loading, Issues and Drafts; `3 lanes · 33 resources`; the narrowing's note naming each source it hides rows of", () => {
        const committed = bin("B-1", at(11, 6, 15), "LD-1", 21, [["K-1", 21]]);
        const held = day([["3001", committed], ["3002", bin("B-2", at(11, 6, 35), "LD-2", 10, [["K-2", 10]])]]);
        const plan = day([["3001", { ...committed, at: at(11, 7, 15) }], ["V1", bin("B-3", at(11, 0, 55), undefined, 0, [["K-3", 0]])]]);
        const loads = new SortedMap([["K-1", load("K-1", 21, 1n, at(19), "loading")], ["K-2", load("K-2", 0, 0n, undefined, "free")],
            ["K-3", load("K-3", 0, 1n, at(18), "loading")], ["K-4", load("K-4", 0, 0n, undefined, "busy")]] as const, byString);
        const issues = [issue(variant("overlap", null), "warning"), issue(variant("over", null), "danger"), issue(variant("custom", "Spec mismatch"), "neutral")];
        expect(summaryStats({ plan, held, sameBin, loads, issues, words })).toEqual([
            { label: "Bins", value: "1", sub: "21 m³ · 1 reserved", tone: undefined },
            { label: "Loading", value: "2 of 4", sub: "1 free · 1 busy", tone: undefined },
            { label: "Issues", value: "2", sub: "1 overlap · 1 over max", tone: "warning" },
            // The moved bin, the new reservation, and the committed bin the drafts removed.
            { label: "Drafts", value: "3", sub: "unsaved · Save is in the toolbar", tone: "brand" },
        ]);
        expect(summaryStats({ plan: held, held, sameBin, loads, issues: issues.slice(2), words }).slice(2)).toEqual([
            { label: "Issues", value: "0", sub: "none", tone: undefined }, { label: "Drafts", value: "0", sub: "all saved", tone: undefined },
        ]);
        expect(summaryLine(3, 33, DEFAULT_NOUNS)).toBe("3 lanes · 33 resources");
        expect(summaryLine(1, 1, DEFAULT_NOUNS)).toBe("1 lane · 1 resource");
        const kiln = { one: "Kiln", other: "Kilns", article: "a" };
        expect(narrowingNote([{ shown: 3, total: 3, noun: DEFAULT_NOUNS.lane }, { shown: 21, total: 33, noun: kiln }])).toBe("21 of 33 kilns visible · fits, checks and totals include all");
        expect(narrowingNote([{ shown: 2, total: 3, noun: DEFAULT_NOUNS.lane }, { shown: 4, total: 9, noun: DEFAULT_NOUNS.event }]))
            .toBe("2 of 3 lanes · 4 of 9 events visible · fits, checks and totals include all");
        expect(narrowingNote([{ shown: 3, total: 3, noun: DEFAULT_NOUNS.lane }])).toBeUndefined();
    });

    test("A64 — the groups in order, the app's by its kind's name, each its mark; the fixes' words", () => {
        const issues = [
            issue(variant("custom", "Spec mismatch"), "neutral"), issue(variant("under", null), "warning"), issue(variant("over", null), "danger"),
            issue(variant("unlinked", null), "warning", { fix: some(variant("choose", null)) }), issue(variant("unallocated", null), "warning", { fix: some(variant("find", null)) }),
            issue(variant("overlap", null), "warning", { fix: some(variant("move", "3124")) }), issue(variant("custom", "Moisture"), "danger"),
            issue(variant("custom", "Spec mismatch"), "warning"),
        ];
        expect(issueGroups(issues).map(g => [g.key, g.label, g.tone, g.issues.length])).toEqual([
            ["unlinked", "Not linked", "warning", 1], ["unallocated", "Partly allocated", "warning", 1], ["overlap", "Overlaps the next job", "warning", 1],
            ["over", "Over max", "danger", 1], ["under", "Under minimum", "warning", 1], ["custom:Spec mismatch", "Spec mismatch", "warning", 2],
            ["custom:Moisture", "Moisture", "danger", 1],
        ]);
        expect(issueGroups([issues[0]!])[0]!.tone).toBeUndefined();
        expect(issueGroups([])).toEqual([]);
        expect(issues.map(i => fixLabel(i, id => (id === "3124" ? "LD-2219" : id), DEFAULT_NOUNS))).toEqual([
            undefined, undefined, undefined, "Choose a resource", "Find a fit", "Move LD-2219…", undefined, undefined,
        ]);
        expect(issues.slice(0, 3).map(i => kindLabel(i))).toEqual(["Spec mismatch", "Under minimum", "Over max"]);
    });
});

describe("the drop list's head (A34, A86)", () => {
    const cx = context([event("LD-2231", 21, at(9))], [row("K-209", { group: some("Hall B") }), row("K-305", { group: some("Compact"), min: 4, max: 10 })]);
    const plan = day([["3101", { ...bin("B-3", at(11, 1, 55), "LD-2201", 35, [["K-209", 35]]), hold: variant("days", 7) }],
        ["V1", bin("B-1", at(11, 2, 15), undefined, 0, [["K-305", 0]])]]);
    const loads = new SortedMap([["K-209", load("K-209", 35, 1n, at(18), "loading")], ["K-305", load("K-305", 0, 1n, at(18), "loading")]] as const, byString);
    const lines = new Map([["K-209", line()], ["K-305", line()]]);
    const head = (subject: Grip, dragging: boolean, layout: "timeline" | "table", quantity?: number, basis?: string) =>
        dropHeadOf({ subject, dragging, layout, day: DAY, plan, held: plan, context: cx, loads, lines, quantity, basis, firstFree: { lane: "B-1", at: at(11, 0, 15) }, words });

    test("A34 — a connector's, an event's and a body's drag, and a resource card's, each its words; A86 — each its hint", () => {
        expect(head({ kind: "port", bin: "3101" }, true, "timeline", 35, "ranked by load")).toEqual({
            eyebrow: "Gaps that fit", title: "LD-2201 · 35 m³", meta: "7-day hold from Tue 11 · ranked by load", fits: true, hint: "Drop on a resource row, or on a resource here.",
        });
        expect(head({ kind: "link", bin: "3101", resource: "K-209" }, true, "timeline", 35).hint).toBe("Drop on a resource row, or on a resource here.");
        expect(head({ kind: "event", event: "LD-2231" }, true, "timeline", 21)).toEqual({
            eyebrow: "Gaps that fit", title: "LD-2231 · 21 m³", meta: "8-day hold from Tue 11", fits: true, hint: "Drop on a resource row or a lane hour, or on a resource here.",
        });
        expect(head({ kind: "event", event: "LD-2231" }, true, "table", 21).hint).toBe("Drop on a free row’s event cell, or on a resource here to book its next free bin.");
        // A reservation's connector: no quantity and no hold of its own.
        expect(head({ kind: "port", bin: "V1" }, true, "timeline", 0)).toMatchObject({ title: "Reserved", meta: "" });
        expect(head({ kind: "body", bin: "3101" }, true, "timeline")).toEqual({
            eyebrow: "Move bin", title: "LD-2201 · 35 m³", meta: "Between lanes and hours · its resource stays K-209", fits: false,
            hint: "Drop on a lane hour. To change its resource, drag its connector instead.",
        });
        expect(head({ kind: "body", bin: "3101" }, true, "table")).toMatchObject({ meta: "To a free row · its resource stays K-209",
            hint: "Drop on a free row’s event cell. To change its resource, use the chevron on its row." });
        expect(head({ kind: "resource", resource: "K-209" }, true, "timeline")).toEqual({
            eyebrow: "Resource", title: "K-209", meta: "Hall B · 35 m³ · takes 20–40 today", fits: false, hint: "Drop on a bin to link it, or on an empty lane hour to reserve that slot.",
        });
        expect(head({ kind: "resource", resource: "K-305" }, true, "table")).toMatchObject({ meta: "Compact · 0 m³ · takes 4–10 today",
            hint: "Drop on a row’s resource cell. A bin is linked to it; an empty slot is reserved on it." });
    });

    test("A34, A85 — a resource free or busy today says so; a pick, no drag: `Book puts it in the day’s first free lane slot (B-1 00:15). …`, the Table's own", () => {
        const idle = new SortedMap([["K-209", load("K-209", 0, 0n, undefined, "busy")], ["K-305", load("K-305", 0, 0n, undefined, "free")]] as const, byString);
        const said = (resource: string) => dropHeadOf({ subject: { kind: "resource", resource }, dragging: true, layout: "timeline", day: DAY, plan, held: plan, context: cx,
            loads: idle, lines: new Map([["K-209", line({ text: "busy until Fri 14" })], ["K-305", line()]]), quantity: undefined, basis: undefined, firstFree: undefined, words }).meta;
        expect([said("K-209"), said("K-305")]).toEqual(["Hall B · busy until Fri 14", "Compact · free today"]);
        expect(head({ kind: "event", event: "LD-2231" }, false, "timeline", 21).hint)
            .toBe("Book puts it in the day’s first free lane slot (B-1 00:15). Or click a free lane hour or a ranked resource, or drag it there. Esc clears.");
        expect(head({ kind: "event", event: "LD-2231" }, false, "table", 21).hint)
            .toBe("Book puts it in the day’s first free lane slot (B-1 00:15). Or click a highlighted event cell, or drag it onto a free row. Esc clears.");
        const full = dropHeadOf({ subject: { kind: "event", event: "LD-2231" }, dragging: false, layout: "timeline", day: DAY, plan, held: plan, context: cx, loads, lines,
            quantity: 21, basis: undefined, firstFree: undefined, words });
        expect(full.hint.startsWith("Book puts it in the day’s first free lane slot (no free slot).")).toBe(true);
    });
});
