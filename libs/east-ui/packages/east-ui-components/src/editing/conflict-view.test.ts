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
import { conflictViewOf, sentenceOf } from "./conflict-view.js";
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
        expect(view).toEqual({ name: "Works 10012", path: [], label: ["Hours"], yours: "1,500", theirs: "450", was: "442" });
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
