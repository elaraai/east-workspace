/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the board's modules load east-ui-components' entry,
 * which needs one as it loads.
 *
 * What the Allocation's day read in flight is (#1398): a read of the day the
 * board holds, under a new narrowing of the bins' own source, is the bins
 * being filtered — `Filtering bins…`, the last narrowing's bins standing in —
 * and anything else in flight is a day being loaded — `Loading Wed 12 May`.
 */
import { describe, expect, test } from "vitest";
import { SortedMap, StringType, compareFor, printFor, variant } from "@elaraai/east";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { filteringBins } from "./data.js";

const TUE = new Date("2027-05-11T00:00:00Z");
const WED = new Date("2027-05-12T00:00:00Z");
const printWhere = printFor(RecordSliceWhereType);
const printString = printFor(StringType);
/** The bins' source's choices, printed as the board compares them: none, or one field's values. */
const choices = (field?: string, ...values: string[]) => printWhere(new SortedMap(
    field === undefined ? [] : [[field, variant("values", values.map((v) => printString(v)))]], compareFor(StringType)));

describe("filteringBins", () => {
    test("a read of the day the board holds, under other choices of the bins' source, is the bins being filtered", () => {
        expect(filteringBins(true, { day: TUE, choices: choices() }, TUE, choices("spec", "Red"))).toBe(true);
        expect(filteringBins(true, { day: TUE, choices: choices("spec", "Red") }, TUE, choices("spec", "Blue"))).toBe(true);
        expect(filteringBins(true, { day: TUE, choices: choices("spec", "Red") }, TUE, choices())).toBe(true);
    });

    test("a read of a day the board does not hold is the day being loaded, whatever the choices", () => {
        expect(filteringBins(true, { day: TUE, choices: choices() }, WED, choices())).toBe(false);
        expect(filteringBins(true, { day: TUE, choices: choices() }, WED, choices("spec", "Red"))).toBe(false);
    });

    test("the day it holds read again under the same choices — a new revision — is no filtering", () => {
        expect(filteringBins(true, { day: TUE, choices: choices("spec", "Red") }, TUE, choices("spec", "Red"))).toBe(false);
    });

    test("before any complete read, and with nothing in flight, nothing is filtered", () => {
        expect(filteringBins(true, undefined, TUE, choices("spec", "Red"))).toBe(false);
        expect(filteringBins(false, { day: TUE, choices: choices() }, TUE, choices("spec", "Red"))).toBe(false);
    });
});
