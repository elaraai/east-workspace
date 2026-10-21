/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Inspector's words and figures (`Allocation Spec.md` §9.8, A55–A64, A85,
 * A86, A89), pure: a bin's, a reservation's, a slot's and a resource's status,
 * its banners and its facts, the summary's counts, the issues' groups and the
 * drop list's head — each from e3-ui's figures (the loads, the lines, the
 * checks) or the fit's answer, in the mock's words and the board's nouns. The
 * renderer computes no figure of its own.
 *
 * @packageDocumentation
 */

import type { SortedMap, option } from "@elaraai/east";
import { formatDatePattern } from "@elaraai/east-ui-components/internal";
import { rankOf, type Grip, type LibraryGrip } from "./drag.js";
import { compareDate, compareFloat, compareString, partsOf, type Bin, type Context, type Day, type Fit, type FitResult, type Issue, type Load,
    type ResourceLine, type ResourceRow, type Slot, type TimeStep } from "./model.js";
import { a, one, other, type Noun, type Nouns } from "./nouns.js";
import { countedIssues, issueParts } from "./toolbar.js";

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;
/** A pending answer's line: the fit has not said yet (F2). */
export const CHECKING = "checking fits…";

/** The words the inspector is written with. */
export interface InspectorWords {
    nouns: Nouns;
    /** A quantity with the board's unit (`21 m³`), and a number without it. */
    quantity: (value: number) => string;
    number: (value: number) => string;
    /** A lane's label. */
    lane: (key: string) => string;
    /** A resource's load, naming the limit it breaks (A19): e3-ui's. */
    load: (fill: number, resource: ResourceRow) => string;
}

/** A head's status (A56, A60–A62): its word and tone, a draft's ring, and a draft's chip. */
export interface InspectorStatus {
    word: string;
    tone: "neutral" | "success" | "warning" | "info";
    ring: boolean;
    pending: "new" | "pending" | undefined;
}

const dayText = (at: Date) => formatDatePattern("ddd D", at);
const timeText = (at: Date) => formatDatePattern("HH:mm", at);
/** The last day a span holds, the day before its end: a job ending at Sat 8's start was released Fri 7. */
const lastDay = (to: Date) => dayText(new Date(to.getTime() - 1));
/** `1 bin`, `3 bins`. */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A count in the board's noun: `1 lane`, `33 resources`. */
const counted = (n: number, noun: Noun) => `${n} ${n === 1 ? one(noun) : other(noun)}`;
/** A duration's unit, as a hold's length says it (`8-day hold`) and as a step says it (`± 1 h`). */
const HOLD_UNIT = { minutes: "minute", hours: "hour", days: "day", weeks: "week", months: "month" } as const;
const STEP_UNIT = { minutes: "min", hours: "h", days: "d", weeks: "wk", months: "mo" } as const;

/** An arrival's code: its label, else its key. */
export function codeOf(context: Context, arrival: string): string {
    return context.arrivals.get(arrival)?.label ?? arrival;
}

/** A bin's code: its arrival's, or `Reserved` for a reservation (A16). */
export function binCode(context: Context, bin: Bin): string {
    return bin.arrival.type === "some" ? codeOf(context, bin.arrival.value) : "Reserved";
}

/** A resource's name. */
const nameOf = (context: Context, key: string) => context.resources.get(key)?.label ?? key;

/** Whether two bins are on the same resources, whatever each holds there: a link the draft changed is a change of these. */
function sameResources(a: Bin["parts"], b: Bin["parts"]): boolean {
    const x = [...a.keys()], y = [...b.keys()];
    return x.length === y.length && x.every((key, i) => key === y[i]);
}

/**
 * A bin's status (A56): what its draft changed — `Added`, `Moved`,
 * `Allocated` (its resources), `Edited · unsaved` (anything else: its
 * quantity, its row's own fields), and with no resource `Not linked · unsaved`, as the
 * mock's — else `Not linked`, `Check` (a resource of it over max or held into
 * its next job) or `Committed`.
 *
 * @param bin - The bin as drafted
 * @param committed - The bin as the day holds it; `undefined` for a new one
 * @param sameBin - Whether two bins are the same
 * @param lines - The lines of the resources it is on
 * @returns Its status
 */
export function binStatus(bin: Bin, committed: Bin | undefined, sameBin: (a: Bin, b: Bin) => boolean, lines: readonly ResourceLine[]): InspectorStatus {
    const linked = bin.parts.size > 0;
    if (committed === undefined || !sameBin(committed, bin)) {
        const word = !linked ? "Not linked · unsaved" : committed === undefined ? "Added · unsaved"
            : committed.lane !== bin.lane || compareDate(committed.at, bin.at) !== 0 ? "Moved · unsaved"
                : !sameResources(committed.parts, bin.parts) ? "Allocated · unsaved" : "Edited · unsaved";
        return { word, tone: "neutral", ring: true, pending: committed === undefined ? "new" : "pending" };
    }
    if (!linked) return { word: "Not linked", tone: "warning", ring: false, pending: undefined };
    if (lines.some(line => line.over || line.overlap)) return { word: "Check", tone: "warning", ring: false, pending: undefined };
    return { word: "Committed", tone: "success", ring: false, pending: undefined };
}

/** A reservation's status (A61): `Reserved`, or what its draft did, `Added · unsaved`, `Moved · unsaved`. */
export function reservationStatus(bin: Bin, committed: Bin | undefined, sameBin: (a: Bin, b: Bin) => boolean): InspectorStatus {
    if (committed === undefined) return { word: "Added · unsaved", tone: "neutral", ring: true, pending: "new" };
    if (!sameBin(committed, bin)) return { word: "Moved · unsaved", tone: "neutral", ring: true, pending: "pending" };
    return { word: "Reserved", tone: "info", ring: false, pending: undefined };
}

/** A resource's status (A62): `Check` over max or held into its next job, else `Loading`, `Busy` or `Free`, as its load is. */
export function resourceStatus(load: Load, line: ResourceLine): InspectorStatus {
    if (line.over || line.overlap) return { word: "Check", tone: "warning", ring: false, pending: undefined };
    if (load.state.type === "loading") return { word: "Loading", tone: "info", ring: false, pending: undefined };
    if (load.state.type === "busy") return { word: "Busy", tone: "neutral", ring: false, pending: undefined };
    return { word: "Free", tone: "success", ring: false, pending: undefined };
}

/** One issue's banner (A56, A62): the shared banner's status, its word and its sentence. */
export interface InspectorBanner { status: "warning" | "error"; title: string; text: string }

/** A resource as a bin's or its own inspector reads it: its row, its load and its line. */
export interface ResourceAt { row: ResourceRow; load: Load; line: ResourceLine }

/**
 * The banners of what is inspected (A56, A62): a banner per counted issue —
 * warning or danger — about the bin (`Not linked`, `Partly allocated`, the
 * app's), then about each resource it is on, or the resource inspected (`Over
 * max`, `Under min`, `Overlaps the next job`, the app's); the built-in ones in
 * the mock's sentences, the app's its title's kind and its detail.
 *
 * @param args - The issues, the bin if one is inspected, its resources, the plan day and the words
 * @returns The banners, in order
 */
export function bannersOf(args: { issues: readonly Issue[]; bin?: { id: string; code: string } | undefined; resources: readonly ResourceAt[]; day: Date; words: InspectorWords }): InspectorBanner[] {
    const { bin, resources, day, words } = args;
    const { nouns } = words;
    const issues = countedIssues(args.issues);
    const status = (issue: Issue) => issue.tone.type === "danger" ? "error" as const : "warning" as const;
    const taken = new Set<Issue>();
    const out: InspectorBanner[] = [];
    // Any other: its kind's name and its detail.
    const plain = (issue: Issue) => out.push({ status: status(issue), title: kindLabel(issue), text: issue.detail });
    if (bin !== undefined) {
        const about = issues.filter(i => i.bin.type === "some" && i.bin.value === bin.id);
        for (const issue of about) {
            taken.add(issue);
            if (issue.kind.type === "unlinked") {
                out.push({ status: status(issue), title: "Not linked", text: `${bin.code} has no ${one(nouns.resource)}. Link it to a gap that fits, or it stays unplaced.` });
            } else plain(issue);
        }
    }
    for (const { row, load, line } of resources) {
        const about = issues.filter(i => !taken.has(i) && i.resource.type === "some" && i.resource.value === row.key);
        const fill = Math.round(load.fill);
        const hold = load.hold.type === "some" ? load.hold.value : undefined;
        for (const kind of ["over", "under", "overlap"] as const) {
            for (const issue of about.filter(i => i.kind.type === kind)) {
                if (kind === "over") {
                    out.push({ status: status(issue), title: "Over max",
                        text: `${row.label} holds ${words.quantity(fill)} against a ${words.quantity(row.max)} max · ${words.quantity(fill - row.max)} over.` });
                } else if (kind === "under") {
                    out.push({ status: status(issue), title: "Under min",
                        text: `${row.label} holds ${words.quantity(fill)} against a ${words.quantity(row.min)} minimum · ${words.quantity(row.min - fill)} short. Another ${one(nouns.arrival)} can top it up; Save still works.` });
                } else if (hold !== undefined && line.next.type === "some") {
                    const next = line.next.value;
                    const days = (hold.to.getTime() - day.getTime()) / DAY_MS, into = (hold.to.getTime() - next.start.getTime()) / DAY_MS;
                    out.push({ status: status(issue), title: "Overlaps the next job",
                        text: `The ${words.number(days)}-day hold on ${row.label} runs to ${lastDay(hold.to)}, ${words.number(into)} d into the job planned ${dayText(next.start)}.` });
                } else out.push({ status: status(issue), title: "Overlaps the next job", text: issue.detail });
                taken.add(issue);
            }
        }
        for (const issue of about.filter(i => !taken.has(i))) { taken.add(issue); plain(issue); }
    }
    return out;
}

/** A resource's facts on `88px 1fr` (A58, A62): what held it before, its hold, and its next fill. */
export interface ResourceFacts {
    before: string;
    /** Its hold today; `absent` when it holds nothing and is not busy (`not started`). */
    hold: { text: string; absent: boolean };
    /** Its next fill; `warn` when its hold runs into it. */
    next: { text: string; warn: boolean };
}

/**
 * A resource's facts (A58, A62): Before (`job C-3142 · released Fri 7`, or
 * `empty in the plan`), Hold (`Tue 11 to Tue 18 · 8 d`; `busy until Fri 14`, or
 * `not started`), Next fill (`Mon 17 · hold overlaps it by 2 d`, `Wed 19 · 1 d
 * spare`, with the resource's note, or `none planned to Thu 20`).
 *
 * @param at - The resource, its load and its line
 * @param day - The plan day
 * @param horizonEnd - The end of the Timeline's resource axis: what `none planned to` names
 * @param words - The words
 * @returns Its facts
 */
export function factsOf({ row, load, line }: ResourceAt, day: Date, horizonEnd: Date, words: InspectorWords): ResourceFacts {
    // What held it before: the job that started on or before the day and ended last.
    let prior: ResourceRow["jobs"][number] | undefined;
    for (const job of row.jobs) {
        if (compareDate(job.start, day) <= 0 && (prior === undefined || compareDate(job.end, prior.end) > 0)) prior = job;
    }
    const before = prior === undefined ? "empty in the plan" : `job ${prior.label} · released ${lastDay(prior.end)}`;
    const span = load.hold.type === "some" ? load.hold.value : undefined;
    const hold = span !== undefined
        ? { text: `${dayText(day)} to ${lastDay(span.to)} · ${words.number((span.to.getTime() - day.getTime()) / DAY_MS)} d`, absent: false }
        : load.state.type === "busy" ? { text: line.text, absent: false } : { text: "not started", absent: true };
    let next: ResourceFacts["next"];
    if (line.next.type === "some") {
        const job = line.next.value;
        const after = span === undefined ? ""
            : line.overlap ? ` · hold overlaps it by ${words.number((span.to.getTime() - job.start.getTime()) / DAY_MS)} d`
                : ` · ${words.number((job.start.getTime() - span.to.getTime()) / DAY_MS)} d spare`;
        next = { text: `${dayText(job.start)}${after}${row.note.type === "some" ? ` · ${row.note.value}` : ""}`, warn: line.overlap };
    } else next = { text: `none planned to ${lastDay(horizonEnd)}`, warn: false };
    return { before, hold, next };
}

/** A resource's group line (A58, A62): `Hall B · min 20 m³ · max 40 m³`. */
export function groupLine(row: ResourceRow, words: InspectorWords): string {
    return [row.group.type === "some" ? row.group.value : "", `min ${words.quantity(row.min)}`, `max ${words.quantity(row.max)}`].filter(p => p !== "").join(" · ");
}

/** A resource's batch line (A58): `Batched · 3 bins · 31 m³`, or `One bin fills it.` */
export function batchLine(load: Load, words: InspectorWords): string {
    const bins = Number(load.bins);
    return bins > 1 ? `Batched · ${plural(bins, "bin")} · ${words.quantity(Math.round(load.fill))}` : "One bin fills it.";
}

/** A bin on a resource today (A58, A62): its time, lane, code and what it puts there, and its tooltip. */
export interface Mate { id: string; time: string; lane: string; code: string; quantity: string; tip: string }

/**
 * A resource's bins today, by time (A58, A62): each its part there, a
 * reservation's `reserved`; its tooltip `Bin 3113 · …` (`Bin new` for a new one).
 *
 * @param plan - The day as drafted
 * @param held - The day as the record holds it
 * @param resource - The resource
 * @param context - Every arrival and resource
 * @param words - The words
 * @returns Its bins
 */
export function matesOf(plan: Day, held: Day | undefined, resource: string, context: Context, words: InspectorWords): Mate[] {
    return [...plan.bins].filter(([, bin]) => bin.parts.has(resource))
        .sort(([x, a], [y, b]) => compareDate(a.at, b.at) || compareString(x, y))
        .map(([id, bin]) => {
            const meta = bin.arrival.type === "some" ? context.arrivals.get(bin.arrival.value)?.meta : undefined;
            return {
                id, time: timeText(bin.at), lane: words.lane(bin.lane), code: binCode(context, bin),
                quantity: bin.arrival.type === "none" ? "reserved" : words.quantity(bin.parts.get(resource)!),
                tip: `Bin ${held?.bins.has(id) === true ? id : "new"}${meta?.type === "some" ? ` · ${meta.value}` : ""}`,
            };
        });
}

/**
 * A draft's `was` line (A59, A61): `was K-108 · B-2 10:35`, `was not linked ·
 * B-2 10:35`, or `new booking · not in the plan yet`.
 *
 * @param committed - The bin as the day holds it; `undefined` for a new one
 * @param context - Every resource
 * @param words - The words
 * @returns The line
 */
export function wasLine(committed: Bin | undefined, context: Context, words: InspectorWords): string {
    if (committed === undefined) return "new booking · not in the plan yet";
    const first = partsOf(committed)[0];
    return `was ${first === undefined ? "not linked" : nameOf(context, first.key)} · ${words.lane(committed.lane)} ${timeText(committed.at)}`;
}

/**
 * The Bin time stepper's help (A57): `B-1 bins at :15 · ± 1 h, 00–23 on Tue
 * 11` — the lane's offset, its step, its first and last slot's hours and the
 * plan day.
 *
 * @param slots - The lane's slots, in time order
 * @param lane - The lane's key
 * @param every - The slot spacing
 * @param day - The plan day
 * @param words - The words
 * @returns The help line
 */
export function stepHelp(slots: readonly Slot[], lane: string, every: TimeStep, day: Date, words: InspectorWords): string {
    const first = slots[0]?.at, last = slots[slots.length - 1]?.at;
    if (first === undefined || last === undefined) return "";
    return `${words.lane(lane)} bins at :${formatDatePattern("mm", first)} · ± ${words.number(every.value)} ${STEP_UNIT[every.type]}, `
        + `${formatDatePattern("HH", first)}–${formatDatePattern("HH", last)} on ${dayText(day)}`;
}

/** One booking a free slot or a reservation offers (A60, A61): an arrival to book, or a committed bin the drafts removed. */
export interface BookOption {
    key: string;
    grip: Extract<LibraryGrip, { kind: "arrival" | "removed" }>;
    code: string;
    quantity: string;
    /** Its line: its meta, and `overdue` (in warn) or `removed from plan`. */
    line: string;
    warn: boolean;
}

/**
 * What a free slot or a reservation can book (A60, A61), as the Library lists
 * them (A51): the arrivals still to book, overdue first, then the committed
 * bins the drafts removed — of the arrivals the narrowing shows (A99).
 *
 * @param args - The day as drafted and as the record holds it, every arrival, the plan day, the arrivals shown and the words
 * @returns The bookings, in order
 */
export function bookOptions(args: { plan: Day; held: Day | undefined; context: Context; day: Date; shown: option<ReadonlySet<string>>; words: InspectorWords }): BookOption[] {
    const { plan, held, context, day, shown, words } = args;
    const shows = (key: string) => shown.type === "none" || shown.value.has(key);
    const booked = new Set<string>();
    for (const [, bin] of plan.bins) if (bin.arrival.type === "some") booked.add(bin.arrival.value);
    const removed = [...(held?.bins ?? [])].filter(([id, bin]) => bin.arrival.type === "some" && !plan.bins.has(id));
    const removedArrivals = new Set(removed.map(([, bin]) => bin.arrival.type === "some" ? bin.arrival.value : ""));
    const overdue = (key: string) => { const due = context.arrivals.get(key)?.due; return due?.type === "some" && compareDate(due.value, day) < 0; };
    const toBook = [...context.arrivals.keys()].filter(key => !booked.has(key) && !removedArrivals.has(key) && shows(key));
    const out: BookOption[] = [];
    for (const late of [true, false]) {
        for (const key of toBook.filter(k => overdue(k) === late)) {
            const arrival = context.arrivals.get(key)!;
            out.push({ key: `arrival:${key}`, grip: { kind: "arrival", arrival: key }, code: arrival.label, quantity: words.quantity(arrival.quantity),
                line: [arrival.meta.type === "some" ? arrival.meta.value : "", late ? "overdue" : ""].filter(p => p !== "").join(" · "), warn: late });
        }
    }
    for (const [id, bin] of removed) {
        const key = bin.arrival.type === "some" ? bin.arrival.value : "";
        if (!shows(key)) continue;
        const meta = context.arrivals.get(key)?.meta;
        out.push({ key: `removed:${id}`, grip: { kind: "removed", bin: id }, code: codeOf(context, key), quantity: words.quantity(bin.quantity),
            line: [meta?.type === "some" ? meta.value : "", "removed from plan"].filter(p => p !== "").join(" · "), warn: false });
    }
    return out;
}

/** A verdict as a booking's line says it (A61): the fit's reason; refused, `doesn’t fit · …` in warn and Book off; pending, `checking fits…`. */
export function verdictLine(verdict: Fit | undefined): { line: string; warn: boolean; enabled: boolean } {
    if (verdict === undefined) return { line: CHECKING, warn: false, enabled: false };
    return verdict.type === "fits" ? { line: verdict.value.why, warn: false, enabled: true } : { line: `doesn’t fit · ${verdict.value.reason}`, warn: true, enabled: false };
}

/** One fit a list ranks (A34, A59): its resource, its rank and the fit's reason. */
export interface RankedFit { key: string; rank: number; name: string; why: string }

/**
 * The fits an answer ranks, in the order given, each its reason (A34, A59).
 *
 * @param answer - The fit's answer
 * @param keys - The resources, best first
 * @param context - Every resource
 * @returns The ranked fits
 */
export function rankedFits(answer: FitResult | undefined, keys: readonly string[], context: Context): RankedFit[] {
    return keys.flatMap((key, i) => {
        const fit = answer?.resources.get(key);
        return fit?.type === "fits" ? [{ key, rank: i + 1, name: nameOf(context, key), why: fit.value.why }] : [];
    });
}

/** The three best other fits of a bin's question, its current resource excepted (A59); `undefined` while the answer is on its way. */
export function alternativesOf(answer: FitResult | undefined, current: string | undefined, context: Context): RankedFit[] | undefined {
    return answer === undefined ? undefined : rankedFits(answer, rankOf(answer, current), context);
}

/** One reservation a free slot offers (A60): its resource, what it takes, and the fit's reason after `free` or `loading`. */
export interface ReserveOption { key: string; name: string; range: string; line: string }

/**
 * The five best resources to reserve a free slot on (A60): the fit's answer
 * to a reservation in the slot, the free ones first, each best first — of the
 * resources the narrowing shows (A94).
 *
 * @param answer - The fit's answer to placing a reservation in the slot; `undefined` while it is on its way
 * @param loads - Every resource's load
 * @param context - Every resource
 * @param shown - The resources the narrowing shows
 * @param words - The words
 * @returns The options, or `undefined` while the answer is on its way
 */
export function reserveOptions(answer: FitResult | undefined, loads: SortedMap<string, Load>, context: Context, shown: option<ReadonlySet<string>>,
    words: InspectorWords): ReserveOption[] | undefined {
    if (answer === undefined) return undefined;
    const fits = [...answer.resources].flatMap(([key, fit]) => fit.type === "fits" && context.resources.has(key) && (shown.type === "none" || shown.value.has(key))
        ? [{ key, fit: fit.value, loading: Number(loads.get(key)?.bins ?? 0n) > 0 }] : []);
    fits.sort((x, y) => Number(x.loading) - Number(y.loading) || compareFloat(y.fit.score, x.fit.score) || compareString(x.key, y.key));
    return fits.slice(0, 5).map(({ key, fit, loading }) => {
        const row = context.resources.get(key)!;
        return { key, name: row.label, range: `${words.number(row.min)}–${words.quantity(row.max)}`, line: `${loading ? "loading" : "free"} · ${fit.why}` };
    });
}

/** One of the summary's counts (A63): its label, its value, its line, and the value's tone. */
export interface SummaryStat { label: string; value: string; sub: string; tone: "warning" | "brand" | undefined }

/**
 * The summary's four counts (A63): Bins (`26`, `556 m³ · 0 reserved`), Loading
 * (`21 of 33`, `10 free · 2 busy`), Issues (`3`, `2 overlaps · 1 over max`, or
 * `none`) and Drafts (`0`, `all saved`, or `N`, `unsaved · Save is in the
 * toolbar`).
 *
 * @param args - The day as drafted and as the record holds it, every load, every issue and the words
 * @returns The counts, in order
 */
export function summaryStats(args: { plan: Day; held: Day | undefined; sameBin: (a: Bin, b: Bin) => boolean; loads: SortedMap<string, Load>; issues: readonly Issue[]; words: InspectorWords }): SummaryStat[] {
    const { plan, held, sameBin, loads, issues, words } = args;
    const bins = [...plan.bins.values()];
    const booked = bins.filter(bin => bin.arrival.type === "some");
    const states = [...loads.values()].map(load => load.state.type);
    const count = (state: Load["state"]["type"]) => states.filter(s => s === state).length;
    const issueCount = countedIssues(issues).length;
    let drafts = 0;
    for (const [id, bin] of plan.bins) { const was = held?.bins.get(id); if (was === undefined || !sameBin(was, bin)) drafts++; }
    for (const [id] of held?.bins ?? []) if (!plan.bins.has(id)) drafts++;
    return [
        { label: "Bins", value: `${booked.length}`, sub: `${words.quantity(Math.round(booked.reduce((n, bin) => n + bin.quantity, 0)))} · ${bins.length - booked.length} reserved`, tone: undefined },
        { label: "Loading", value: `${count("loading")} of ${states.length}`, sub: `${count("free")} free · ${count("busy")} busy`, tone: undefined },
        { label: "Issues", value: `${issueCount}`, sub: issueCount > 0 ? issueParts(issues).join(" · ") : "none", tone: issueCount > 0 ? "warning" : undefined },
        { label: "Drafts", value: `${drafts}`, sub: drafts > 0 ? "unsaved · Save is in the toolbar" : "all saved", tone: drafts > 0 ? "brand" : undefined },
    ];
}

/** The summary's line under its title (A63): `3 lanes · 33 resources`. */
export function summaryLine(lanes: number, resources: number, nouns: Nouns): string {
    return `${counted(lanes, nouns.lane)} · ${counted(resources, nouns.resource)}`;
}

/**
 * The narrowing's note (A63): `21 of 33 kilns visible · fits, checks and
 * totals include all`, each source the narrowing hides rows of; `undefined`
 * while none does.
 *
 * @param sources - Each narrowed source: how many it shows, of how many, in its noun
 * @returns The note
 */
export function narrowingNote(sources: readonly { shown: number; total: number; noun: Noun }[]): string | undefined {
    const hiding = sources.filter(s => s.shown < s.total);
    return hiding.length === 0 ? undefined
        : `${hiding.map(s => `${s.shown} of ${s.total} ${other(s.noun)}`).join(" · ")} visible · fits, checks and totals include all`;
}

/** The summary's three hints (A89). */
export function summaryHints(nouns: Nouns): string[] {
    return [
        `Select a bin or ${a(nouns.resource)} to inspect it.`,
        `Use the Library to book ${other(nouns.arrival)} and reserve ${other(nouns.resource)}.`,
        "Every change is a draft until Save. Undo and Redo are in the toolbar.",
    ];
}

/** One group of the Issues tab (A64): its kind's name, its tone's mark, and its issues. */
export interface IssueGroup { key: string; label: string; tone: "warning" | "danger" | undefined; issues: Issue[] }

/** The built-in groups, in order (A64). */
const BUILT_IN = [
    ["unlinked", "Not linked"], ["unallocated", "Partly allocated"], ["overlap", "Overlaps the next job"], ["over", "Over max"], ["under", "Under minimum"],
] as const;

/** An issue's kind as its group names it (A64): the built-in kinds' words, the app's own name. */
export function kindLabel(issue: Issue): string {
    if (issue.kind.type === "custom") return issue.kind.value;
    const kind = issue.kind.type;
    return BUILT_IN.find(([key]) => key === kind)?.[1] ?? kind;
}

/**
 * The Issues tab's groups (A64): Not linked, Partly allocated, Overlaps the
 * next job, Over max and Under minimum, then the app's by their kind's name,
 * as they come — each with every issue of it, counted or not; marked danger,
 * warning, or not at all.
 *
 * @param issues - Every issue, the built-in ones first
 * @returns The groups that have issues, in order
 */
export function issueGroups(issues: readonly Issue[]): IssueGroup[] {
    const toneOf = (list: readonly Issue[]) => list.some(i => i.tone.type === "danger") ? "danger" as const : list.some(i => i.tone.type === "warning") ? "warning" as const : undefined;
    const out: IssueGroup[] = [];
    for (const [kind, label] of BUILT_IN) {
        const list = issues.filter(i => i.kind.type === kind);
        if (list.length > 0) out.push({ key: kind, label, tone: toneOf(list), issues: list });
    }
    const custom = new Map<string, Issue[]>();
    for (const issue of issues) {
        if (issue.kind.type !== "custom") continue;
        const list = custom.get(issue.kind.value) ?? [];
        list.push(issue);
        custom.set(issue.kind.value, list);
    }
    for (const [label, list] of custom) out.push({ key: `custom:${label}`, label, tone: toneOf(list), issues: list });
    return out;
}

/** An issue's fix's words (A64): `Choose a resource`, `Find a fit`, `Move LD-2205…`. */
export function fixLabel(issue: Issue, codeOfBin: (bin: string) => string, nouns: Nouns): string | undefined {
    if (issue.fix.type === "none") return undefined;
    const fix = issue.fix.value;
    return fix.type === "choose" ? `Choose ${a(nouns.resource)}` : fix.type === "find" ? "Find a fit" : `Move ${codeOfBin(fix.value)}…`;
}

/** The drop list's head (A34): what is dragged or picked, and what a drop does. */
export interface DropHead {
    eyebrow: string;
    title: string;
    meta: string;
    hint: string;
    /** Whether it lists the fits: an arrival's, a removed bin's, a connector's or a link's drag, or a pick. */
    fits: boolean;
}

/**
 * The drop list's head (A34, A86): for a resource card, `Resource · K-203 ·
 * Hall B · …`; for a card body, `Move bin · LD-2210 · 32 m³ · between lanes and
 * hours · its resource stays K-108`; for an arrival, a removed bin, a connector
 * or a link, `Gaps that fit · LD-2231 · 21 m³ · 8-day hold from Tue 11 · ` and
 * the answer's `basis` — and the layout's hint, a pick's naming the day's
 * first free slot.
 *
 * @param args - What is dragged or picked, whether a drag is under way, the layout, the day, the quantity placed, the answer's basis, the day's first free slot and the words
 * @returns The head
 */
export function dropHeadOf(args: {
    subject: Grip; dragging: boolean; layout: "timeline" | "table"; day: Date; plan: Day; held: Day | undefined; context: Context;
    loads: SortedMap<string, Load>; lines: ReadonlyMap<string, ResourceLine>; quantity: number | undefined; basis: string | undefined;
    firstFree: { lane: string; at: Date } | undefined; words: InspectorWords;
}): DropHead {
    const { subject, dragging, layout, day, plan, held, context, words } = args;
    const { lane, arrival, resource } = words.nouns;
    const table = layout === "table";
    if (subject.kind === "resource") {
        const row = context.resources.get(subject.resource);
        const load = args.loads.get(subject.resource), line = args.lines.get(subject.resource);
        const today = row === undefined || load === undefined ? "" : Number(load.bins) > 0 ? `${words.load(load.fill, row)} today`
            : load.state.type === "busy" ? line?.text ?? "" : "free today";
        const where = row === undefined ? "" : row.group.type === "some" ? row.group.value : row.meta.type === "some" ? row.meta.value : "";
        return {
            eyebrow: resource.one, title: nameOf(context, subject.resource), meta: [where, today].filter(p => p !== "").join(" · "), fits: false,
            hint: table ? `Drop on a row’s ${one(resource)} cell. A bin is linked to it; an empty slot is reserved on it.`
                : `Drop on a bin to link it, or on an empty ${one(lane)} hour to reserve that slot.`,
        };
    }
    if (subject.kind === "body") {
        const bin = plan.bins.get(subject.bin);
        const code = bin === undefined ? subject.bin : binCode(context, bin);
        const current = bin === undefined ? undefined : partsOf(bin)[0]?.key;
        return {
            eyebrow: "Move bin", title: bin === undefined || bin.arrival.type === "none" ? code : `${code} · ${words.quantity(bin.quantity)}`, fits: false,
            meta: `${table ? "To a free row" : `Between ${other(lane)} and hours`} · its ${one(resource)} stays ${current === undefined ? "none" : nameOf(context, current)}`,
            hint: table ? `Drop on a free row’s ${one(arrival)} cell. To change its ${one(resource)}, use the chevron on its row.`
                : `Drop on ${a(lane)} hour. To change its ${one(resource)}, drag its connector instead.`,
        };
    }
    // An arrival, a removed bin, a connector or a link: its fits.
    const bin = subject.kind === "arrival" ? undefined : subject.kind === "removed" ? held?.bins.get(subject.bin) : plan.bins.get(subject.bin);
    const code = subject.kind === "arrival" ? codeOf(context, subject.arrival) : bin === undefined ? subject.bin : binCode(context, bin);
    const reserved = bin !== undefined && bin.arrival.type === "none";
    const hold: TimeStep | undefined = subject.kind === "arrival" ? context.arrivals.get(subject.arrival)?.hold : reserved ? undefined : bin?.hold;
    const from = hold === undefined ? "" : `${words.number(hold.value)}-${HOLD_UNIT[hold.type]} hold from ${dayText(day)}`;
    const landing = args.firstFree === undefined ? "no free slot" : `${words.lane(args.firstFree.lane)} ${timeText(args.firstFree.at)}`;
    const linking = subject.kind === "port" || subject.kind === "link";
    const hint = !dragging
        ? `Book puts it in the day’s first free ${one(lane)} slot (${landing}). ${table ? `Or click a highlighted ${one(arrival)} cell, or drag it onto a free row.`
            : `Or click a free ${one(lane)} hour or a ranked ${one(resource)}, or drag it there.`} Esc clears.`
        : table ? `Drop on a free row’s ${one(arrival)} cell, or on ${a(resource)} here to book its next free bin.`
            : linking ? `Drop on ${a(resource)} row, or on ${a(resource)} here.` : `Drop on ${a(resource)} row or ${a(lane)} hour, or on ${a(resource)} here.`;
    return {
        eyebrow: "Gaps that fit", title: reserved || args.quantity === undefined ? code : `${code} · ${words.quantity(args.quantity)}`, fits: true, hint,
        meta: [from, args.basis ?? ""].filter(p => p !== "").join(" · "),
    };
}
