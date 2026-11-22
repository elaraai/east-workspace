/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A filter's rows, step by step (#1667, ruled 22 November 2026): every edit a
 * reader makes of a filter's conditions — a row added, its field, comparison
 * and value picked, a group added, a row or a group removed — and, after each,
 * the rows that stand, where their removes are drawn, and what their host is
 * told. With no renderer: the edits are the query builder's own
 * (`applyAction`, `applySlot`, `applyRemove`) over a page filter's query
 * (`filterQuery`), and what is told is the filters' rule (`conditionTold`),
 * for a host that applies each edit as it is made — a page's filter, a
 * visual's own — and for one that holds a draft — an alert.
 *
 * - A row still to be finished is no part of the filter; the finished rows are
 *   told at once.
 * - Removing the last finished row removes the filter.
 * - A group left with no condition goes; one left with a single condition is
 *   that condition, plain.
 * - A row's remove is a ×; a group's is its words, in the group's foot.
 */

import { describe, expect, test } from "vitest";
import { printJq, variant, type JqNode } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { cardsFor, type CardLine, type CardPart } from "../model/cards.js";
import type { SlotRef, SlotValue } from "../model/refs.js";
import { applyAction, applyRemove, applySlot } from "../model/slot-edits.js";
import { queryWords } from "../model/words.js";
import { checkSteps } from "../steps/check.js";
import type { Condition, StepQuery } from "../steps/values.js";
import { conditionTold, filterQuery, whereOf } from "./filters.js";
import { ORDERS_ROOT, ORDERS_SOURCE, condition } from "./visual.test-utils.js";

const ROOT = ORDERS_ROOT.type;
const W = queryWords(formatters("en-AU"));

/** The filter's conditions: its one step's. */
function conditionsOf(query: StepQuery): readonly Condition[] {
    const [step] = query.steps;
    if (step?.type !== "filter") throw new Error("the filter's step is no Keep rows where step");
    return step.value.conds;
}

/** A condition in short: a test by its field — `·` while it has none — and a group by its match and what it holds. */
function sketch(held: Condition): string {
    if (held.type === "test") return held.value.field.type === "some" ? held.value.field.value : "·";
    return `${held.value.match.type}(${held.value.conds.map(sketch).join(", ")})`;
}

/** A filter's rows in short, in order. */
const rows = (query: StepQuery): string[] => conditionsOf(query).map(sketch);

/** The condition a query's finished rows hold, as jq; `undefined` while none is finished. */
function said(query: StepQuery): string | undefined {
    const where = whereOf(query, ROOT);
    return where === undefined ? undefined : printJq(where).text;
}

/**
 * A filter's rows and their host: each edit is one of the builder's, and what
 * it tells is kept as the host would hear it — a condition as jq, or `removed`.
 */
function host(where: string | undefined, live = true) {
    let query = filterQuery(where === undefined ? undefined : condition(where), ORDERS_SOURCE, ROOT);
    let held: JqNode | undefined = where === undefined ? undefined : condition(where);
    const told: string[] = [];
    const stepId = query.steps[0]!.value.id;
    /** One edit: the query it leaves, and what the host is told of it. */
    const edit = (next: StepQuery): void => {
        const heard = conditionTold(query, next, held, (edited) => whereOf(edited, ROOT), live);
        query = next;
        if (heard.kind === "nothing") return;
        held = heard.kind === "condition" ? heard.where : undefined;
        told.push(heard.kind === "condition" ? printJq(heard.where).text : "removed");
    };
    /** A condition's id, by its place: among the filter's, then in each group down. */
    const at = (...path: number[]): string => {
        let conds = conditionsOf(query);
        let found: Condition | undefined;
        for (const i of path) {
            found = conds[i];
            if (found === undefined) throw new Error(`no condition at ${path.join(".")}`);
            conds = found.type === "group" ? found.value.conds : [];
        }
        return found!.value.id;
    };
    const set = (slot: Omit<SlotRef, "stepId">, value: SlotValue): void => edit(applySlot(query, { stepId, ...slot }, { value, label: "", group: "" }, ROOT, W).query);
    return {
        told,
        rows: () => rows(query),
        query: () => query,
        at,
        /** Add condition: the filter's, or a group's. */
        addCondition: (groupId?: string) => edit(applyAction(query, { kind: "add-condition", stepId, ...(groupId === undefined ? {} : { groupId }) }, ROOT).query),
        /** Add group. */
        addGroup: () => edit(applyAction(query, { kind: "add-group", stepId }, ROOT).query),
        /** A row's ×, or a group's Remove group. */
        remove: (id: string) => edit(applyRemove(query, { kind: "condition", stepId, id })),
        /** A row's field picked. */
        field: (id: string, ref: string) => set({ kind: "field", condId: id }, { kind: "field", ref }),
        /** A row's value picked. */
        text: (id: string, value: string) => set({ kind: "value", condId: id }, { kind: "value", value: variant("text", value) }),
        /** A row's number picked. */
        number: (id: string, value: number) => set({ kind: "value", condId: id }, { kind: "value", value: variant("number", value) }),
    };
}

/** The filter's card's lines, as the rows draw them. */
function linesOf(query: StepQuery): readonly CardLine[] {
    return cardsFor(query, ROOT, checkSteps(query, ROOT), W)[0]!.lines;
}

/** A line's removes: what each takes, and its label. */
const removes = (parts: readonly CardPart[]) => parts.flatMap((part) => (part.t === "remove" ? [[part.takes, part.label]] : []));

describe("a filter read into rows", () => {
    test("one condition is one row; several every row must pass are rows side by side; any of several is a group among them", () => {
        expect(rows(filterQuery(condition(`.region == "SA"`), ORDERS_SOURCE, ROOT))).toEqual(["region"]);
        expect(rows(filterQuery(condition(`.region == "SA" and .revenue >= 40`), ORDERS_SOURCE, ROOT))).toEqual(["region", "revenue"]);
        expect(rows(filterQuery(condition(`.region == "SA" and (.customer == "Acme" or .revenue >= 40)`), ORDERS_SOURCE, ROOT))).toEqual(["region", "any(customer, revenue)"]);
        expect(rows(filterQuery(undefined, ORDERS_SOURCE, ROOT))).toEqual(["·"]);
    });
});

describe("where a filter's removes are drawn", () => {
    const query = filterQuery(condition(`.region == "SA" and (.customer == "Acme" or .revenue >= 40)`), ORDERS_SOURCE, ROOT);
    const [row, group, foot] = linesOf(query);

    test("a row ends with its ×, which takes the row", () => {
        expect([row!.kind, removes(row!.parts)]).toEqual(["row", [["row", "Remove"]]]);
    });

    test("a group's head holds its match and no remove: each of its rows ends with its own ×", () => {
        expect([group!.kind, removes(group!.head ?? [])]).toEqual(["group", []]);
        const inner = group!.lines ?? [];
        expect(inner.map((line) => line.kind)).toEqual(["row", "row", "foot"]);
        expect(inner.slice(0, 2).map((line) => removes(line.parts))).toEqual([[["row", "Remove"]], [["row", "Remove"]]]);
    });

    test("a group's foot holds Add condition, then Remove group in words, which takes the group and all it holds", () => {
        const groupFoot = (group!.lines ?? [])[2]!;
        expect(groupFoot.parts.map((part) => (part.t === "add" ? part.text : part.t === "remove" ? part.label : part.t))).toEqual(["Add condition", "Remove group"]);
        expect(removes(groupFoot.parts)).toEqual([["group", "Remove group"]]);
        // The filter's own foot adds, and removes nothing: Remove filter is its host's.
        expect([foot!.kind, removes(foot!.parts)]).toEqual(["foot", []]);
    });
});

describe("a row removed tidies the group it was in", () => {
    test("of a group of three, it leaves a group of two", () => {
        const h = host(`.region == "SA" and (.customer == "Acme" or .revenue >= 40 or .units >= 2)`);
        h.remove(h.at(1, 0));
        expect([h.rows(), h.told]).toEqual([["region", "any(revenue, units)"], [`.region == "SA" and (.revenue >= 40 or .units >= 2)`]]);
    });

    test("of a group of two, it leaves the other as a plain row in the group's place: a group of one says nothing", () => {
        const h = host(`.region == "SA" and (.customer == "Acme" or .revenue >= 40)`);
        h.remove(h.at(1, 0));
        expect([h.rows(), h.told]).toEqual([["region", "revenue"], [`.region == "SA" and .revenue >= 40`]]);
    });

    test("Remove group takes the group and all it holds, and leaves the rows beside it", () => {
        const h = host(`.region == "SA" and (.customer == "Acme" or .revenue >= 40)`);
        h.remove(h.at(1));
        expect([h.rows(), h.told]).toEqual([["region"], [`.region == "SA"`]]);
    });

    test("a group inside a group: the outer one, left with the inner alone, gives way to it — which joins the rows of its own match", () => {
        const h = host(`.region == "SA" and (.customer == "Acme" or (.revenue >= 40 and .units >= 2))`);
        expect(h.rows()).toEqual(["region", "any(customer, all(revenue, units))"]);
        h.remove(h.at(1, 0));
        expect([h.rows(), h.told]).toEqual([["region", "revenue", "units"], [`.region == "SA" and .revenue >= 40 and .units >= 2`]]);
    });

    test("a row beside a group, removed, leaves the group as it is: only the groups it was in are tidied", () => {
        const h = host(`.region == "SA" and (.customer == "Acme" or .revenue >= 40)`);
        h.remove(h.at(0));
        expect([h.rows(), h.told]).toEqual([["any(customer, revenue)"], [`.customer == "Acme" or .revenue >= 40`]]);
    });

    test("a condition the filter does not hold removes nothing", () => {
        const h = host(`.region == "SA" and (.customer == "Acme" or .revenue >= 40)`);
        h.remove("no-such-condition");
        expect([h.rows(), h.told]).toEqual([["region", "any(customer, revenue)"], []]);
    });
});

describe("a group added, then taken back", () => {
    test("Add group adds a group of two empty rows, and tells nothing; Remove group takes it, and tells nothing", () => {
        const h = host(`.region == "SA"`);
        h.addGroup();
        expect(h.rows()).toEqual(["region", "any(·, ·)"]);
        h.remove(h.at(1));
        expect([h.rows(), h.told]).toEqual([["region"], []]);
    });

    test("one of its two empty rows removed leaves the other, plain; that one removed leaves the filter as it was", () => {
        const h = host(`.region == "SA"`);
        h.addGroup();
        h.remove(h.at(1, 0));
        expect(h.rows()).toEqual(["region", "·"]);
        h.remove(h.at(1));
        expect([h.rows(), h.told]).toEqual([["region"], []]);
    });

    test("its first row finished is told beside the filter's own, while its second is still empty", () => {
        const h = host(`.region == "SA"`);
        h.addGroup();
        h.field(h.at(1, 0), "customer");
        h.text(h.at(1, 0), "Acme");
        expect([h.rows(), h.told]).toEqual([["region", "any(customer, ·)"], [`.region == "SA" and .customer == "Acme"`]]);
    });
});

describe("what an edit tells a host that applies it as it is made", () => {
    test("a row added tells nothing until its field and its value are picked; then the two are told", () => {
        const h = host(`.region == "SA"`);
        h.addCondition();
        expect([h.rows(), h.told]).toEqual([["region", "·"], []]);
        h.field(h.at(1), "revenue");
        expect(h.told).toEqual([]);
        h.number(h.at(1), 40);
        expect(h.told).toEqual([`.region == "SA" and .revenue >= 40`]);
    });

    test("the finished rows are told at once, whatever else is still being written", () => {
        const h = host(`.region == "SA" and .revenue >= 40`);
        h.addCondition();
        // A value changed beside the empty row; then a finished row removed beside it.
        h.text(h.at(0), "NSW");
        h.remove(h.at(1));
        expect([h.rows(), h.told]).toEqual([["region", "·"], [`.region == "NSW" and .revenue >= 40`, `.region == "NSW"`]]);
    });

    test("one of two rows rewritten to a field of another kind: it is left out until its value is picked, and the other is the filter meanwhile", () => {
        const h = host(`.region == "SA" and .revenue >= 40`);
        h.field(h.at(0), "units");
        expect([h.rows(), h.told]).toEqual([["units", "revenue"], [`.revenue >= 40`]]);
        h.number(h.at(0), 2);
        expect(h.told).toEqual([`.revenue >= 40`, `.units >= 2 and .revenue >= 40`]);
    });

    test("its only row rewritten to a field of another kind: the host keeps what it holds until the value is picked — never a filter taken off mid-edit", () => {
        const h = host(`.region == "SA"`);
        h.field(h.at(0), "revenue");
        expect([said(h.query()), h.told]).toEqual([undefined, []]);
        h.number(h.at(0), 40);
        expect(h.told).toEqual([`.revenue >= 40`]);
    });

    test("a row's field changed to one of its own kind keeps its comparison and its value, so it is finished, and told, at once", () => {
        const text = host(`.region == "SA"`);
        text.field(text.at(0), "customer");
        expect(text.told).toEqual([`.customer == "SA"`]);
        const number = host(`.revenue >= 40`);
        number.field(number.at(0), "units");
        expect(number.told).toEqual([`.units >= 40`]);
    });

    test("its only condition removed: the filter is removed", () => {
        const h = host(`.region == "SA"`);
        h.remove(h.at(0));
        expect([h.rows(), h.told]).toEqual([[], ["removed"]]);
    });

    test("its last finished row removed beside a row still empty: the filter is removed, and the empty row stands", () => {
        const h = host(`.region == "SA"`);
        h.addCondition();
        h.remove(h.at(0));
        expect([h.rows(), h.told]).toEqual([["·"], ["removed"]]);
        // The row that stands, finished, is a filter again.
        h.field(h.at(0), "revenue");
        h.number(h.at(0), 40);
        expect(h.told).toEqual(["removed", `.revenue >= 40`]);
    });

    test("its only row rewritten, then removed before its value is picked: the filter is removed", () => {
        const h = host(`.region == "SA"`);
        h.field(h.at(0), "revenue");
        h.remove(h.at(0));
        expect([h.rows(), h.told]).toEqual([[], ["removed"]]);
    });

    test("a group of its only finished rows removed: the filter is removed", () => {
        const h = host(`.customer == "Acme" or .revenue >= 40`);
        expect(h.rows()).toEqual(["customer", "revenue"]);
        h.addGroup();
        h.remove(h.at(0));
        h.remove(h.at(0));
        expect([h.rows(), h.told]).toEqual([["all(·, ·)"], [`.revenue >= 40`, "removed"]]);
    });

    test("a filter still to be written: its empty row removed, and every edit before its first finished row, tells nothing", () => {
        const h = host(undefined);
        h.addCondition();
        h.remove(h.at(1));
        h.remove(h.at(0));
        expect([h.rows(), h.told]).toEqual([[], []]);
        h.addCondition();
        h.field(h.at(0), "region");
        h.text(h.at(0), "SA");
        expect(h.told).toEqual([`.region == "SA"`]);
    });

    test("an edit that leaves the finished rows saying what the host holds tells nothing", () => {
        const h = host(`.region == "SA"`);
        h.text(h.at(0), "SA");
        h.addCondition();
        h.remove(h.at(1));
        expect(h.told).toEqual([]);
    });
});

describe("what an edit tells a host that holds a draft", () => {
    test("its only row rewritten to a field of another kind: it holds no condition until the value is picked, so its Save waits", () => {
        const h = host(`.region == "SA"`, false);
        h.field(h.at(0), "revenue");
        expect(h.told).toEqual(["removed"]);
        h.number(h.at(0), 40);
        expect(h.told).toEqual(["removed", `.revenue >= 40`]);
    });

    test("its only row rewritten, then back to what it held: the condition is told again", () => {
        const h = host(`.region == "SA"`, false);
        h.field(h.at(0), "revenue");
        h.field(h.at(0), "region");
        expect(h.told).toEqual(["removed"]);
        h.text(h.at(0), "SA");
        expect(h.told).toEqual(["removed", `.region == "SA"`]);
    });

    test("its only condition removed: it holds none; the finished rows beside an empty one are its condition, as a live host's are", () => {
        const h = host(`.region == "SA"`, false);
        h.remove(h.at(0));
        expect(h.told).toEqual(["removed"]);
        const two = host(`.region == "SA" and .revenue >= 40`, false);
        two.addCondition();
        two.remove(two.at(0));
        expect([two.rows(), two.told]).toEqual([["revenue", "·"], [`.revenue >= 40`]]);
    });
});
