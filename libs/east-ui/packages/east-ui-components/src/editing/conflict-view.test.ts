/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A conflict in words (conflict-view.ts): which entry, the steps down to the
 * part and its own label, and each side's value there as a person reads it —
 * over real conflicts the merge finds in real drafts of a works row with a
 * number, text, a flag, a choice, an optional date, a list, and crews each
 * holding hours by week.
 */

import { describe, expect, test } from "vitest";
import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType, VariantType,
    compareFor, none, some, variant, type ValueTypeOf, type option,
} from "@elaraai/east";
import { EditingDraftTypeFor } from "@elaraai/east-ui/internal";
import { formatters } from "../format/index.js";
import { conflictViewOf, rangeViewOf, sentenceOf } from "./conflict-view.js";
import { liftDraft } from "./draft.js";
import { EntryMerger } from "./merge.js";
import { editingMessages, type EditingWords } from "./messages.js";

const Crew = StructType({ lead: StringType, hours: DictType(DateTimeType, FloatType) });
const Row = StructType({
    name: StringType,
    hours: FloatType,
    note: StringType,
    done: BooleanType,
    status: VariantType({ running: NullType, down: StringType }),
    due: OptionType(DateTimeType),
    lines: ArrayType(IntegerType),
    crews: DictType(StringType, Crew),
});
const Draft = EditingDraftTypeFor(Row);
type RowValue = ValueTypeOf<typeof Row>;
const WORDS: EditingWords = { ...formatters("en-US"), m: editingMessages };
const merger = new EntryMerger(Draft);

const week = new Date(Date.UTC(2026, 10, 9));
const hoursOf = (hours: number) => new SortedMap([[week, hours]], compareFor(DateTimeType));
const crewsOf = (hours: number) => new SortedMap([["Crew 1", { lead: "North", hours: hoursOf(hours) }]], compareFor(StringType));
const row = (patch: Partial<RowValue> = {}): RowValue => ({
    name: "Works 10012", hours: 442, note: "On track", done: false, status: variant("running", null), due: none,
    lines: [1n, 2n, 3n], crews: crewsOf(40), ...patch,
});
const draft = (value: RowValue): option<unknown> => some(liftDraft(Draft, value));
/** A draft with one field cleared: missing, as a cell emptied leaves it. */
const cleared = (value: RowValue, field: keyof RowValue): option<unknown> =>
    some({ ...(liftDraft(Draft, value) as Record<string, unknown>), [field]: variant("missing", null) });

/** The one conflict of an entry keyed `Works 10012`, in words. */
function viewOf(was: option<unknown>, mine: option<unknown>, theirs: option<unknown>) {
    const points = merger.conflicts(was, mine, theirs);
    expect(points).toHaveLength(1);
    return conflictViewOf(Draft, { id: "Works 10012", key: "Works 10012", keyType: StringType, at: points[0]!.at, was, draft: mine, source: theirs }, WORDS);
}

describe("a conflict in words", () => {
    test("a number both changed: the entry by its key, the field as its label, each side and what both began from in the reader's locale", () => {
        const view = viewOf(draft(row()), draft(row({ hours: 1500 })), draft(row({ hours: 450 })));
        expect(view).toEqual({ name: "Works 10012", path: [], label: ["Hours"], yours: "1,500", theirs: "450", yoursForm: "mono", theirsForm: "mono", was: "442" });
    });

    test("a value deep in a map of maps: the key above the label says which, and the label runs down to the week", () => {
        const view = viewOf(draft(row()), draft(row({ crews: crewsOf(50) })), draft(row({ crews: crewsOf(45) })));
        expect(view.path).toEqual(["Crew 1"]);
        expect(view.label).toEqual(["Hours", WORDS.date(week)]);
        expect([view.yours, view.theirs, view.was]).toEqual(["50", "45", "40"]);
    });

    test("two values that read alike in the locale's form are written in full, and so is what both began from", () => {
        const view = viewOf(draft(row({ hours: 1.2 })), draft(row({ hours: 1.2341 })), draft(row({ hours: 1.2342 })));
        expect(WORDS.number(1.2341)).toBe(WORDS.number(1.2342));
        expect([view.yours, view.theirs, view.was]).toEqual([WORDS.float(1.2341), WORDS.float(1.2342), WORDS.float(1.2)]);
    });

    test("text as it is, empty text in words; a flag as Yes or No; a field emptied reads Cleared", () => {
        const note = viewOf(draft(row()), draft(row({ note: "" })), draft(row({ note: "Waiting on parts" })));
        expect([note.label, note.yours, note.theirs, note.was]).toEqual([["Note"], "Empty", "Waiting on parts", "On track"]);
        const done = viewOf(draft(row()), cleared(row(), "done"), draft(row({ done: true })));
        expect([done.label, done.yours, done.theirs, done.was]).toEqual([["Done"], "Cleared", "Yes", "No"]);
    });

    test("a choice by its name, then its details; a change inside one choice is labelled with it", () => {
        const view = viewOf(draft(row()), draft(row({ status: variant("down", "pump") })), draft(row({ status: variant("down", "valve") })));
        expect([view.label, view.yours, view.theirs, view.was]).toEqual([["Status"], "Down · pump", "Down · valve", "Running"]);
        const inside = viewOf(draft(row({ status: variant("down", "pump") })), draft(row({ status: variant("down", "valve") })), draft(row({ status: variant("down", "seal") })));
        expect([inside.label, inside.yours, inside.theirs, inside.was]).toEqual([["Status", "Down"], "valve", "seal", "pump"]);
        const choice = viewOf(draft(row({ status: variant("down", "pump") })), draft(row({ status: variant("running", null) })), draft(row({ status: variant("down", "valve") })));
        expect([choice.label, choice.yours, choice.theirs, choice.was]).toEqual([["Status"], "Running", "Down · valve", "Down · pump"]);
    });

    test("an optional date cleared on one side reads Cleared; set, it reads as a date", () => {
        const view = viewOf(draft(row({ due: some(week) })), draft(row({ due: none })), draft(row({ due: some(new Date(Date.UTC(2026, 10, 16))) })));
        expect(view.label).toEqual(["Due"]);
        expect([view.yours, view.theirs, view.was]).toEqual(["Cleared", WORDS.date(new Date(Date.UTC(2026, 10, 16))), WORDS.date(week)]);
    });

    test("an optional date both set otherwise is labelled by its field alone — an option's value is no step a person reads", () => {
        const later = new Date(Date.UTC(2026, 10, 16)), latest = new Date(Date.UTC(2026, 10, 23));
        const view = viewOf(draft(row({ due: some(week) })), draft(row({ due: some(later) })), draft(row({ due: some(latest) })));
        expect([view.label, view.yours, view.theirs, view.yoursForm]).toEqual([["Due"], WORDS.date(later), WORDS.date(latest), "mono"]);
    });

    test("a part both added where the entry held none reads as it began: Empty", () => {
        const next = new Date(Date.UTC(2026, 10, 16));
        const withWeek = (hours: number) => new SortedMap([["Crew 1", { lead: "North", hours: new SortedMap([[week, 40], [next, hours]], compareFor(DateTimeType)) }]], compareFor(StringType));
        const view = viewOf(draft(row()), draft(row({ crews: withWeek(50) })), draft(row({ crews: withWeek(45) })));
        expect([view.yours, view.theirs, view.was]).toEqual(["50", "45", "Empty"]);
    });

    test("a list's item by its place, counting from one", () => {
        const view = viewOf(draft(row()), draft(row({ lines: [1n, 2n, 7n] })), draft(row({ lines: [1n, 2n, 9n] })));
        expect([view.label, view.yours, view.theirs, view.was]).toEqual([["Lines", "Item 3"], "7", "9", "3"]);
    });

    test("an entry one side removed while the other changed it reads Removed on that side, with no label", () => {
        const view = viewOf(draft(row()), none, draft(row({ hours: 450 })));
        expect([view.label, view.yours, view.was]).toEqual([[], "Removed", "Name: Works 10012 · Hours: 442 · Note: On track · …"]);
        expect(view.theirs).toBe("Name: Works 10012 · Hours: 450 · Note: On track · …");
    });

    test("an entry of a source with no key is named by its id", () => {
        const points = merger.conflicts(draft(row()), draft(row({ hours: 1 })), draft(row({ hours: 2 })));
        const view = conflictViewOf(Draft, { id: "row-7", key: undefined, keyType: undefined, at: points[0]!.at, was: draft(row()), draft: draft(row({ hours: 1 })), source: draft(row({ hours: 2 })) }, WORDS);
        expect(view.name).toBe("row-7");
    });

    test("a name reads as a sentence", () => {
        expect(["maxWeeklyHours", "max_weekly_hours", "hours", "crewID"].map(sentenceOf)).toEqual(["Max weekly hours", "Max weekly hours", "Hours", "Crew id"]);
    });
});

describe("an item's start and end, read as one range", () => {
    const Run = StructType({ name: StringType, start: DateTimeType, end: DateTimeType });
    const RunDraft = EditingDraftTypeFor(Run);
    const Job = StructType({ name: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
    const JobDraft = EditingDraftTypeFor(Job);
    const DATES = { start: "start", end: "end" };
    const at = (day: number, hour = 6) => new Date(Date.UTC(2026, 10, day, hour));
    const run = (start: Date, end: Date) => some(liftDraft(RunDraft, { name: "Press 1", start, end }));
    /** A range's card over the merge's own conflicts: an end both changed reads each side's; one only the draft holds, the draft carried over. */
    const viewOf = (draftType: typeof RunDraft | typeof JobDraft, was: option<unknown>, draft: option<unknown>, source: option<unknown>) => {
        const merged = new EntryMerger(draftType).merge(was, draft, source);
        const clashes = new Set(merged.points.map((point) => (point.at[0]?.kind === "field" ? point.at[0].name : "")));
        const end = (field: string) => (clashes.has(field)
            ? { was: merged.ancestor!, yours: draft, theirs: source }
            : { was: merged.ancestor!, yours: merged.draft, theirs: merged.draft });
        return { clashes: [...clashes].sort(), view: rangeViewOf(draftType, DATES, { id: "R1", key: undefined, keyType: undefined, start: end("start"), end: end("end") }, WORDS) };
    };

    test("a run moved both ways reads as one range on each side, and as it began", () => {
        const { clashes, view } = viewOf(RunDraft, run(at(16), at(20)), run(at(17), at(21)), run(at(23), at(27)));
        expect(clashes).toEqual(["end", "start"]);
        expect([view.label, view.yours, view.theirs, view.was]).toEqual([["Dates"], WORDS.range(at(17), at(21)), WORDS.range(at(23), at(27)), WORDS.range(at(16), at(20))]);
    });

    test("only its end both changed: each side reads the range whole, its start as the draft carried it over", () => {
        // Here the end went to the 22nd; there the run moved to the 23rd–27th: the start combines, the end clashes.
        const { clashes, view } = viewOf(RunDraft, run(at(16), at(20)), run(at(16), at(22)), run(at(23), at(27)));
        expect(clashes).toEqual(["end"]);
        expect([view.yours, view.theirs]).toEqual([`${WORDS.date(at(23))} – ${WORDS.date(at(22))}`, WORDS.range(at(23), at(27))]);
    });

    test("two sides alike to the day are written with their times, so they read apart", () => {
        const { view } = viewOf(RunDraft, run(at(16), at(20)), run(at(16, 9), at(20)), run(at(16, 10), at(20)));
        expect([view.yours, view.theirs]).toEqual([`${WORDS.dateTime(at(16, 9))} – ${WORDS.dateTime(at(20))}`, `${WORDS.dateTime(at(16, 10))} – ${WORDS.dateTime(at(20))}`]);
    });

    test("an item unscheduled reads cleared once; one the source removed reads removed", () => {
        const job = (start: option<Date>, end: option<Date>) => some(liftDraft(JobDraft, { name: "Batch 42", start, end }));
        const { view } = viewOf(JobDraft, job(some(at(16)), some(at(20))), job(some(at(17)), some(at(21))), job(none, none));
        expect([view.yours, view.theirs]).toEqual([WORDS.range(at(17), at(21)), editingMessages.conflictCleared()]);
        const gone = rangeViewOf(RunDraft, DATES, {
            id: "R1", key: undefined, keyType: undefined,
            start: { was: run(at(16), at(20)), yours: run(at(17), at(21)), theirs: none },
            end: { was: run(at(16), at(20)), yours: run(at(17), at(21)), theirs: none },
        }, WORDS);
        expect(gone.theirs).toBe(editingMessages.conflictRemoved());
    });
});
