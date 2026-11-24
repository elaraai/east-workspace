/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A row's parts by where they stand in it (#1667): what a row is drawn by —
 * its joiner in the joiner column, its × at its end, and what it says between
 * the two, which is all of it that wraps. Over a page filter's own query, the
 * source's rows and one Keep rows where step (`filterQuery`) of a condition
 * and a group, and a Group step by two fields, each with a × of its own.
 */

import { describe, expect, test } from "vitest";
import { formatters } from "@elaraai/east-ui-components";
import { checkSteps } from "../steps/check.js";
import type { StepQuery } from "../steps/values.js";
import { filterQuery } from "../visual/filters.js";
import { ORDERS_ROOT, ORDERS_SOURCE, condition } from "../visual/visual.test-utils.js";
import { cardsFor, rowSides, type Card, type CardLine, type CardPart } from "./cards.js";
import { applySlot } from "./slot-edits.js";
import { queryWords } from "./words.js";

const words = queryWords(formatters("en-AU"));

/** A card's rows, a group's after the group's place. */
function rowsOf(card: Card): CardLine[] {
    const rows = (lines: readonly CardLine[]): CardLine[] => lines.flatMap((line) => (line.kind === "row" ? [line] : rows(line.lines ?? [])));
    return rows(card.lines);
}

/** A part in a word: a joiner in angle brackets, a slot in square ones, an input in braces, a remove by what it takes. */
function said(part: CardPart): string {
    switch (part.t) {
        case "word": return part.joiner === true ? `<${part.text}>` : part.text;
        case "slot": return `[${part.text}]`;
        case "input": return `{${part.value}}`;
        case "remove": return part.takes === "row" ? "×" : `×${part.takes}`;
        case "add": return `+${part.text}`;
        default: return part.t;
    }
}

/** Each row of a query's last card by its sides: its start, what it says, its end. */
function sides(query: StepQuery): string[] {
    const cards = cardsFor(query, ORDERS_ROOT.type, checkSteps(query, ORDERS_ROOT.type), words);
    return rowsOf(cards[cards.length - 1]!).map((row) => {
        const { start, body, end } = rowSides(row.parts);
        // Every part is on one side, in its order.
        expect([...start, ...body, ...end]).toEqual([...row.parts]);
        return [start, body, end].map((side) => side.map(said).join(" ")).join(" ¦ ");
    });
}

describe("a row's parts by where they stand", () => {
    const filter = filterQuery(condition(`.region == "SA" and (.revenue > 60 or .units > 1)`), ORDERS_SOURCE, ORDERS_ROOT.type);

    test("a condition's: its joiner at its start — a first row's says nothing — its slots, and its × at its end; a group's rows the same", () => {
        expect(sides(filter)).toEqual([
            "<> ¦ [region] [is] [SA] ¦ ×",
            "<> ¦ [revenue] [is more than] [60] ¦ ×",
            "<or> ¦ [units] [is more than] [1] ¦ ×",
        ]);
    });

    test("a row that starts with words of its own has no joiner; a field's own × is said with its field; an add ends no row, and a total's × does", () => {
        const added = applySlot(filter, { kind: "add-step", stepId: "" }, { value: { kind: "step", step: "group" }, label: "Group", group: "" }, ORDERS_ROOT.type, words);
        const stepId = added.added!;
        const byRegion = applySlot(added.query, { kind: "by", stepId }, { value: { kind: "field", ref: "region" }, label: "Region", group: "" }, ORDERS_ROOT.type, words).query;
        const byTwo = applySlot(byRegion, { kind: "by-add", stepId }, { value: { kind: "field", ref: "category" }, label: "Category", group: "" }, ORDERS_ROOT.type, words).query;
        expect(sides(byTwo)).toEqual([
            " ¦ by [region] ×part and [category] ×part +Add field ¦ ",
            " ¦ then [count] as {count} ¦ ×",
        ]);
    });
});
