/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the queue's words load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * A record target's preview, worked out (#1454, `Decision Queue Spec.md` P6,
 * P10, P11, P25, P26): the fields a change sets, at most two, its others
 * plain — where it sets none, the fields the recommendation would, else the
 * first; a mix's rows on one axis from zero, the value held and the one
 * proposed; a row a group, its size, its part that changes and its net — and
 * the words each says.
 */

import { describe, expect, test } from "vitest";
import { FloatType, StringType, equalFor } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { NET } from "../figures.js";
import { decisionQueueMessages as m, type DecisionQueueWords } from "../messages.js";
import {
    GROUP_ROWS, MIX_ROWS, RECORD_FIELDS, niceCeil, recordFields, recordGroups, recordMix,
    type GroupRowInput, type MixRowInput, type RecordFieldSpec, type RecordFieldsInput, type RecordRowInput,
} from "./record-model.js";

const words: DecisionQueueWords = { ...formatters("en-US"), m };
const sameFloat = equalFor(FloatType);
const sameString = equalFor(StringType);

/** A row of a price list. */
interface Price { readonly price: number; readonly demand: number; readonly note: string }

/** A field of the price list, read, compared and printed as its type is. */
function field<T>(label: string, read: (row: Price) => T, equal: (a: T, b: T) => boolean, print: (value: T) => string): RecordFieldSpec {
    return { label, read: row => read(row as Price), equal: (a, b) => equal(a as T, b as T), print: value => print(value as T) };
}
const SPECS = [
    field("List price", row => row.price, sameFloat, value => words.number(value)),
    field("Demand / wk", row => row.demand, sameFloat, value => words.number(value)),
    field("Note", row => row.note, sameString, value => value),
];

const price = (p: number, demand: number, note = "steady"): Price => ({ price: p, demand, note });
const row = (key: string, before: Price | undefined, after: Price | undefined, confidence?: number): RecordRowInput => ({ key, name: key, before, after, confidence });
const fieldsOf = (rows: readonly RecordRowInput[], rest: Partial<RecordFieldsInput> = {}) => recordFields({ specs: SPECS, rows, lands: [], marked: true, ...rest });

describe("recordFields", () => {
    test("each row's fields the change sets, in the form's order, as they stand and as it leaves them; a field it leaves is not drawn", () => {
        expect(fieldsOf([row("coast", price(10.5, 14_200), price(11, 13_916))])).toEqual([
            { key: "coast", row: "coast", field: "List price", was: "10.5", is: "11", changed: true, confidence: undefined },
            { key: "coast", row: "coast", field: "Demand / wk", was: "14,200", is: "13,916", changed: true, confidence: undefined },
        ]);
        expect(fieldsOf([row("coast", price(10.5, 14_200), price(10.5, 14_200, "watch"))]).map(item => [item.field, item.was, item.is]))
            .toEqual([["Note", "steady", "watch"]]);
    });

    test("at most two across the rows, the first row's first", () => {
        const items = fieldsOf([
            row("coast", price(10.5, 14_200), price(11, 13_916, "watch")),
            row("inland", price(9, 8_000), price(9.5, 8_000)),
        ]);
        expect(RECORD_FIELDS).toBe(2);
        expect(items.map(item => [item.row, item.field])).toEqual([["coast", "List price"], ["coast", "Demand / wk"]]);
        expect(fieldsOf([
            row("coast", price(10.5, 14_200), price(10.5, 14_200, "watch")),
            row("inland", price(9, 8_000), price(9.5, 8_000)),
        ]).map(item => [item.row, item.field])).toEqual([["coast", "Note"], ["inland", "List price"]]);
    });

    test("a row the change adds has nothing as it stands, one it removes nothing as it leaves it; a guessed row's fields carry its confidence", () => {
        expect(fieldsOf([row("north", undefined, price(8, 5_000), 0.69)])).toEqual([
            { key: "north", row: "north", field: "List price", was: undefined, is: "8", changed: true, confidence: 0.69 },
            { key: "north", row: "north", field: "Demand / wk", was: undefined, is: "5,000", changed: true, confidence: 0.69 },
        ]);
        expect(fieldsOf([row("north", price(8, 5_000), undefined)]).map(item => [item.was, item.is, item.changed])).toEqual([["8", undefined, true], ["5,000", undefined, true]]);
    });

    test("nothing marked (P4, P21), or nothing set: the fields the recommendation would set, else the form's first, as they stand, plain", () => {
        const standing = row("coast", price(10.5, 14_200), price(10.5, 14_200), 0.69);
        expect(fieldsOf([standing], { marked: false, lands: ["Demand / wk"] })).toEqual([
            { key: "coast", row: "coast", field: "Demand / wk", was: "14,200", is: "14,200", changed: false, confidence: undefined },
        ]);
        expect(fieldsOf([standing], { marked: false }).map(item => [item.field, item.changed])).toEqual([["List price", false], ["Demand / wk", false]]);
        expect(fieldsOf([standing]).map(item => [item.field, item.changed])).toEqual([["List price", false], ["Demand / wk", false]]);
    });
});

describe("niceCeil", () => {
    test("one, two, two and a half or five of the value's power of ten, at or above it", () => {
        expect([niceCeil(1_900), niceCeil(2_000), niceCeil(924), niceCeil(240), niceCeil(1.2), niceCeil(0)]).toEqual([2_000, 2_000, 1_000, 250, 2, 1]);
    });
});

const store = (key: string, name: string, before: number | undefined, after: number | undefined, confidence?: number): MixRowInput => ({ key, name, before, after, confidence });
const STORES = [
    store("s3", "Market St", 2_400, 2_900),
    store("s1", "Harbour", 3_800, 3_200),
    store("s5", "Station Rd", 1_200, 1_200),
    store("s2", "Hillside", 3_000, 3_400),
    store("s4", "Riverside", 1_600, 1_300),
];

describe("recordMix", () => {
    test("every row in key order on one axis from zero to a nice end that halves nicely; a row the change leaves as it stands is one dot", () => {
        const mix = recordMix(STORES, true);
        expect([mix.max, mix.ticks]).toEqual([4_000, [0, 2_000, 4_000]]);
        expect(mix.rows.map(r => [r.name, r.was, r.now, r.same, r.wasAt, r.nowAt])).toEqual([
            ["Harbour", 3_800, 3_200, false, 95, 80],
            ["Hillside", 3_000, 3_400, false, 75, 85],
            ["Market St", 2_400, 2_900, false, 60, 72.5],
            ["Riverside", 1_600, 1_300, false, 40, 32.5],
            ["Station Rd", 1_200, 1_200, true, 30, 30],
        ]);
    });

    test("unmarked (P4, P21): each row as it stands, one dot; a guessed row the change moves carries its confidence, one it leaves none", () => {
        expect(recordMix(STORES, false).rows.every(r => r.same && sameFloat(r.wasAt, r.nowAt))).toBe(true);
        const guessed = recordMix([store("s1", "Harbour", 3_800, 3_200, 0.6), store("s5", "Station Rd", 1_200, 1_200, 0.6)], true);
        expect(guessed.rows.map(r => r.confidence)).toEqual([0.6, undefined]);
    });

    test("a row the change adds starts at zero, one it removes goes to zero; past five rows, the first five by key", () => {
        const mix = recordMix([store("a", "New", undefined, 500), store("b", "Gone", 500, undefined)], true);
        expect(mix.rows.map(r => [r.name, r.was, r.now])).toEqual([["New", 0, 500], ["Gone", 500, 0]]);
        const many = recordMix([...STORES, store("s0", "Airport", 900, 900), store("s9", "Wharf", 900, 900)], true);
        expect(MIX_ROWS).toBe(5);
        expect(many.rows.map(r => r.name)).toEqual(["Airport", "Harbour", "Hillside", "Market St", "Riverside"]);
    });
});

/** `n` rows of a group, each measured before and after where given. */
const rowsIn = (group: string, n: number, before?: number, after?: number): GroupRowInput[] => Array.from({ length: n }, () => ({ group, before, after }));
const SIZES: Record<string, number> = { Envelopes: 6, Labels: 3, Cards: 2 };

describe("recordGroups", () => {
    test("a row a group, the most rows first, then by name: its track its size against the largest group's, its part the rows that change, and their net", () => {
        const groups = recordGroups([...rowsIn("Cards", 1, 20, 18), ...rowsIn("Labels", 3), ...rowsIn("Envelopes", 3, 10, 11)], group => SIZES[group]);
        expect(groups?.map(g => [g.name, g.n, g.of])).toEqual([["Envelopes", 3, 6], ["Labels", 3, 3], ["Cards", 1, 2]]);
        expect(groups?.map(g => [g.size, g.part].map(v => Math.round(v * 100) / 100))).toEqual([[100, 50], [50, 50], [33.33, 16.67]]);
        expect(groups?.map(g => (g.net === undefined ? undefined : Math.round(g.net * 100) / 100))).toEqual([0.1, undefined, -0.1]);
    });

    test("none while a group's size is read, every group's asked in the same pass; a size under the rows that change counts them; a group whose rows held none of the measure has no net", () => {
        expect(recordGroups(rowsIn("Envelopes", 2), () => undefined)).toBeUndefined();
        const asked: string[] = [];
        expect(recordGroups([...rowsIn("Cards", 1), ...rowsIn("Labels", 2), ...rowsIn("Envelopes", 3)], group => { asked.push(group); return undefined; })).toBeUndefined();
        expect(asked).toEqual(["Envelopes", "Labels", "Cards"]);
        expect(recordGroups([...rowsIn("Envelopes", 4, 0, 5)], () => 2)).toEqual([{ name: "Envelopes", n: 4, of: 4, size: 100, part: 100, net: undefined }]);
    });

    test("past five groups, the five with the most rows", () => {
        const rows = ["A", "B", "C", "D", "E", "F"].flatMap((group, i) => rowsIn(group, i + 1));
        expect(GROUP_ROWS).toBe(5);
        expect(recordGroups(rows, () => 10)?.map(g => g.name)).toEqual(["F", "E", "D", "C", "B"]);
    });
});

describe("the record preview's words", () => {
    test("a field's caption and title, and the fields' sentence with the rows the model guessed", () => {
        expect(m.previewFieldName({ row: "coast", field: "List price" })).toBe("coast · List price");
        expect(m.previewField({ row: "coast", field: "List price", was: "10.5", is: "11", changed: true })).toBe("coast · List price · 10.5 → 11");
        expect(m.previewField({ row: "coast", field: "Demand / wk", was: "14,200", is: "14,200", changed: false })).toBe("coast · Demand / wk · 14,200 · no change");
        expect(m.previewFields({ fields: ["a", "b"], guessed: undefined })).toBe("a; b");
        expect(m.previewFields({ fields: ["a"], guessed: { keys: "coast", n: 1 } })).toBe("a. coast is a low-confidence guess");
    });

    test("a mix's row's title and sentence; a group's title, the groups' sentence, the heads' captions and the net's figure", () => {
        expect(m.previewMeasure({ name: "Harbour", was: "3,800", now: "3,200", same: false })).toBe("Harbour · 3,800 → 3,200");
        expect(m.previewMeasure({ name: "Station Rd", was: "1,200", now: "1,200", same: true })).toBe("Station Rd · 1,200 · no change");
        expect(m.previewMix({ rows: [{ name: "Harbour", was: "3,800", now: "3,200" }, { name: "Riverside", was: "1,600", now: "1,300" }], guessed: undefined }))
            .toBe("Harbour goes from 3,800 to 3,200 and Riverside from 1,600 to 1,300");
        expect(m.previewMix({ rows: [], guessed: undefined })).toBe("Nothing changes");
        expect(m.previewGroup({ name: "Envelopes", n: "412", of: "980", net: "+8%" })).toBe("Envelopes · 412 of 980 change · net +8%");
        expect(m.previewGroup({ name: "Labels", n: "298", of: "410", net: undefined })).toBe("Labels · 298 of 410 change");
        expect(m.previewGroups({ groups: [{ name: "Envelopes", n: "412", net: "+8%" }, { name: "Labels", n: "298", net: undefined }] }))
            .toBe("412 in Envelopes (+8%) and 298 in Labels change");
        expect((["changed", "rows", "net"] as const).map(caption => m.previewCaption({ caption }))).toEqual(["Changed", "Rows", "Net"]);
        expect([words.value(0.0817, NET, true), words.value(-0.04, NET, true), words.value(0, NET, true)]).toEqual(["+8%", "-4%", "0%"]);
    });
});
