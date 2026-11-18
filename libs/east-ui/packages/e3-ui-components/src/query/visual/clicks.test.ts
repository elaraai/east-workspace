/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * What a click on a visual stands for (`clicks.ts`, #1673): a clicked group
 * as a jq condition over its source's rows — in the query builder's own forms
 * where one says it, so it reads as a chip in words — and one that keeps
 * exactly the rows the group was made of.
 */

import { describe, expect, it } from "vitest";
import { DateTimeType, FloatType, IntegerType, OptionType, StringType, checkJq, evaluateJq, isValueOf, none, printJq, some, variant } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { StudioClickedType } from "@elaraai/e3-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
import { queryWords } from "../model/words.js";
import {
    canLead, clickDone, clickedCondition, clickedOf, followCondition, followCycles, followersOf, followingOf, groupCondition, isSelected,
    openedFilters, pickCondition, pickOf, selectedOf, selectionAfter, withCondition,
    type ClickGroup, type Clicked,
} from "./clicks.js";
import { filterWords } from "./filters.js";
import { ORDERS, ORDERS_ROOT, ORDERS_SOURCE, condition } from "./visual.test-utils.js";

const words = queryWords(formatters("en-AU"));
/** A group by a field's own values, or by a date's bucket. */
const by = (field: string, bucket?: "hour" | "day" | "week" | "month" | "quarter" | "year" | "auto"): ClickGroup =>
    ({ field, bucket: bucket === undefined ? none : some(variant(bucket, null)) });
/** A condition as jq, and as its chip says it. */
const said = (condition: ReturnType<typeof groupCondition>) =>
    (condition === undefined ? undefined : [printJq(condition).text, filterWords(condition, ORDERS_SOURCE, words)]);
/** The orders a condition keeps, by their customer and region. */
function kept(condition: ReturnType<typeof groupCondition>): string[] {
    const checked = checkJq(`.orders | map(select(${printJq(condition!).text})) | map(.customer + " " + .region)`, ORDERS_ROOT.type, { root: true });
    expect(checked.diagnostics.filter((d) => d.severity.type === "error").map((d) => d.message)).toEqual([]);
    return evaluateJq(checked, { orders: ORDERS }) as string[];
}

describe("a clicked group as a condition", () => {
    it("is its field's value, as the rows write it: text, a number, and a field with none", () => {
        expect(said(groupCondition(by("region"), "SA", StringType))).toEqual([`.region == "SA"`, "region is SA"]);
        expect(said(groupCondition(by("units"), 3n, IntegerType))?.[0]).toBe(".units == 3");
        expect(said(groupCondition(by("revenue"), 70, FloatType))?.[0]).toBe(".revenue == 70");
        expect(said(groupCondition(by("margin"), null, OptionType(FloatType)))?.[0]).toBe(".margin == null");
        expect(kept(groupCondition(by("region"), "SA", StringType))).toEqual(["Northwind SA", "Summit SA"]);
    });

    it("is a year's or a month's own form for a date bucketed by them, in words", () => {
        expect(said(groupCondition(by("ordered_at", "year"), 2026n, IntegerType))).toEqual(["(.ordered_at | year) == 2026", "ordered at is in 2026"]);
        // July 2026: 2026 × 12 + 6.
        const july = groupCondition(by("ordered_at", "month"), 2026n * 12n + 6n, IntegerType);
        expect(said(july)?.[0]).toBe(`(.ordered_at | strftime("%Y-%m")) == "2026-07"`);
        expect(kept(july)).toEqual(["Northwind SA", "Harbour NSW"]);
        // A date placed on an axis with no bucket named is bucketed by month.
        expect(said(groupCondition(by("ordered_at", "auto"), 2026n * 12n + 7n, IntegerType))?.[0]).toBe(`(.ordered_at | strftime("%Y-%m")) == "2026-08"`);
    });

    it("is the dates any other bucket spans: a quarter, a week from its Monday, a day", () => {
        // The third quarter of 2026: 2026 × 4 + 2.
        const quarter = groupCondition(by("ordered_at", "quarter"), 2026n * 4n + 2n, IntegerType);
        expect(said(quarter)?.[0]).toBe(`.ordered_at >= "2026-07-01T00:00:00.000+00:00" and .ordered_at < "2026-10-01T00:00:00.000+00:00"`);
        expect(kept(quarter)).toHaveLength(5);
        // 20 July 2026 is a Monday: its week holds that day's order alone.
        const monday = BigInt(Math.floor((Date.UTC(2026, 6, 20) + 259_200_000) / 604_800_000));
        const week = groupCondition(by("ordered_at", "week"), monday, IntegerType);
        expect(said(week)?.[0]).toBe(`.ordered_at >= "2026-07-20T00:00:00.000+00:00" and .ordered_at < "2026-07-27T00:00:00.000+00:00"`);
        expect(kept(week)).toEqual(["Harbour NSW"]);
        const day = groupCondition(by("ordered_at", "day"), BigInt(Date.UTC(2026, 7, 2) / 86_400_000), IntegerType);
        expect(kept(day)).toEqual(["Summit SA"]);
    });

    it("has no condition for a group folded into Other, or a key no literal says", () => {
        expect(groupCondition(by("region"), undefined, StringType)).toBeUndefined();
        expect(groupCondition(by("ordered_at", "month"), "July", StringType)).toBeUndefined();
        expect(groupCondition(by("ordered_at"), new Date(Date.UTC(2026, 6, 3, 10)), DateTimeType)).toBeDefined();
    });
});

describe("a clicked group", () => {
    const sa = clickedOf([{ group: by("region"), key: "SA", type: StringType }])!;
    const august = { group: by("ordered_at", "month"), key: 2026n * 12n + 7n, type: IntegerType };

    it("is every group the click was made on, and the rows of them all; none when one has no key, or there is no group", () => {
        const both = clickedOf([{ group: by("region"), key: "SA", type: StringType }, august])!;
        expect(both.map((pick) => pick.field)).toEqual(["region", "ordered_at"]);
        expect(printJq(clickedCondition(both)!).text).toBe(`.region == "SA" and (.ordered_at | strftime("%Y-%m")) == "2026-08"`);
        expect(kept(clickedCondition(both))).toEqual(["Summit SA"]);
        expect(clickedOf([{ group: by("region"), key: "SA", type: StringType }, { group: by("category"), key: undefined, type: StringType }])).toBeUndefined();
        expect(clickedOf([])).toBeUndefined();
        expect(pickOf({ group: by("ordered_at", "month"), key: "July", type: StringType })).toBeUndefined();
    });

    it("reads an optional field's value as its value, and a field with none as nothing — as jq reads them", () => {
        const some_ = pickOf({ group: by("margin"), key: some(0.25), type: OptionType(FloatType) })!;
        const none_ = pickOf({ group: by("margin"), key: none, type: OptionType(FloatType) })!;
        expect([printJq(pickCondition(some_)!).text, printJq(pickCondition(none_)!).text]).toEqual([".margin == 0.25", ".margin == null"]);
    });

    it("is a value of the selection's type: what the UI store keeps", () => {
        expect(isValueOf(sa, StudioClickedType)).toBe(true);
        expect(isValueOf(clickedOf([august]), StudioClickedType)).toBe(true);
    });
});

describe("a placement's selection after a click (LNK-2)", () => {
    const of = (region: string) => clickedOf([{ group: by("region"), key: region, type: StringType }])!;
    const regions = (selection: readonly Clicked[]) => selection.map((clicked) => printJq(clicked[0]!.key).text);

    it("is the clicked group alone; a click on it again clears it", () => {
        const one = selectionAfter([], of("SA"), false);
        expect(regions(one)).toEqual([`"SA"`]);
        expect(isSelected(one, of("SA"))).toBe(true);
        expect(isSelected(one, of("NSW"))).toBe(false);
        expect(regions(selectionAfter(one, of("NSW"), false))).toEqual([`"NSW"`]);
        expect(selectionAfter(one, of("SA"), false)).toEqual([]);
    });

    it("adds a group with ⌘-click, and takes out one that was in; a plain click on one of several leaves it alone", () => {
        const two = selectionAfter(selectionAfter([], of("SA"), false), of("NSW"), true);
        expect(regions(two)).toEqual([`"SA"`, `"NSW"`]);
        expect(regions(selectionAfter(two, of("SA"), true))).toEqual([`"NSW"`]);
        expect(regions(selectionAfter(two, of("SA"), false))).toEqual([`"SA"`]);
    });
});

describe("a follower's condition (LNK-4)", () => {
    const of = (customer: string, region: string) => clickedOf([
        { group: by("customer"), key: customer, type: StringType }, { group: by("region"), key: region, type: StringType },
    ])!;

    it("is its field against the leader's one selected value, read from the leader's field — across sources, by another name", () => {
        const picks = selectedOf([of("Northwind", "SA")], "customer");
        expect(printJq(followCondition(picks, "customer_id")!).text).toBe(`.customer_id == "Northwind"`);
        const rows = kept(followCondition(picks, "customer"));
        expect([rows.length > 0, rows.every((row) => row.startsWith("Northwind "))]).toEqual([true, true]);
    });

    it("is in the values for several, each once", () => {
        const picks = selectedOf([of("Northwind", "SA"), of("Summit", "SA"), of("Harbour", "NSW")], "region");
        expect(printJq(followCondition(picks, "region")!).text).toBe(`.region | IN("SA", "NSW")`);
        const rows = kept(followCondition(picks, "region"));
        expect([...rows].sort()).toEqual(["Harbour NSW", "Northwind SA", "Summit SA"]);
    });

    it("is any of the dates spanned, for several buckets", () => {
        const month = (n: bigint) => clickedOf([{ group: by("ordered_at", "month"), key: 2026n * 12n + n, type: IntegerType }])!;
        const picks = selectedOf([month(6n), month(7n)], "ordered_at");
        expect(printJq(followCondition(picks, "ordered_at")!).text)
            .toBe(`(.ordered_at | strftime("%Y-%m")) == "2026-07" or (.ordered_at | strftime("%Y-%m")) == "2026-08"`);
    });

    it("is none with nothing selected, or nothing selected of the leader's field", () => {
        expect(followCondition([], "region")).toBeUndefined();
        expect(selectedOf([of("Northwind", "SA")], "category")).toEqual([]);
    });

    it("joins the page's state as one more condition, which a value over another period keeps", () => {
        const condition = followCondition(selectedOf([of("Northwind", "SA")], "region"), "region");
        const window = { from: new Date(Date.UTC(2026, 6, 1)), to: new Date(Date.UTC(2026, 9, 1)) };
        const state = withCondition({ filters: [], range: { window, rest: [] } }, condition);
        expect(state.filters.map((f) => printJq(f).text)).toEqual([`.region == "SA"`]);
        expect(state.range?.rest.map((f) => printJq(f).text)).toEqual([`.region == "SA"`]);
        expect(state.range?.window).toBe(window);
        const same = { filters: [] };
        expect(withCondition(same, undefined)).toBe(same);
    });
});

describe("what a click does (LNK-1)", () => {
    const sa = clickedOf([{ group: by("region"), key: "SA", type: StringType }])!;
    const nsw = clickedOf([{ group: by("region"), key: "NSW", type: StringType }])!;
    const nothing = { selection: [], filters: [] };
    const detail = { project: "ops", page: "detail" };

    it("selects: the group is the placement's selection, and the page's filters are left alone", () => {
        const done = clickDone(variant("select", null), "orders", sa, nothing, false);
        expect(done?.type === "select" && done.selection).toEqual([sa]);
        const again = clickDone(variant("select", null), "orders", sa, { selection: [sa], filters: [] }, false);
        expect(again?.type === "select" && again.selection).toEqual([]);
    });

    it("filters: the group joins the page's filters on the visual's source, once", () => {
        const done = clickDone(variant("filter", null), "orders", sa, nothing, false);
        if (done?.type !== "filter") throw new Error("expected the filters");
        expect(done.filters.map((filter) => [filter.source, printJq(filter.where).text])).toEqual([["orders", `.region == "SA"`]]);
        // The same group again adds nothing; another group, or the same on another source, is another filter.
        expect(clickDone(variant("filter", null), "orders", sa, { selection: [], filters: done.filters }, false)).toBeUndefined();
        expect(clickDone(variant("filter", null), "orders", nsw, { selection: [], filters: done.filters }, false)?.type).toBe("filter");
        expect(clickDone(variant("filter", null), "returns", sa, { selection: [], filters: done.filters }, false)?.type).toBe("filter");
    });

    it("opens: the page it names, and the group as a filter on the source", () => {
        const done = clickDone(variant("open", detail), "orders", sa, nothing, false);
        if (done?.type !== "open") throw new Error("expected the page");
        expect([done.page, done.filter.source, printJq(done.filter.where).text]).toEqual([detail, "orders", `.region == "SA"`]);
    });

    it("does nothing where the visual's click is none", () => {
        expect(clickDone(variant("none", null), "orders", sa, nothing, false)).toBeUndefined();
    });

    it("leaves a page it opens with the clicked group in place of what it held on that source, and its other sources' filters as they were (LNK-9)", () => {
        const held = [
            { source: "orders", where: condition(`.region == "NSW"`) }, { source: "returns", where: condition(".units > 1") },
            { source: "orders", where: condition(".units > 2") },
        ];
        const opened = openedFilters(held, { source: "orders", where: condition(`.region == "SA"`) });
        expect(opened.map((filter) => [filter.source, printJq(filter.where).text])).toEqual([["returns", ".units > 1"], ["orders", `.region == "SA"`]]);
    });
});

describe("what a follower reads of its leader (LNK-3, LNK-4, LNK-5)", () => {
    const v = Studio.visual;
    const cell = (key: string, content: ReturnType<typeof v.of>) =>
        ({ key, row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content });
    const customers = cell("c-customers", v.of("orders", v.list({ item: v.group("customer"), values: [v.sum("revenue")] })));
    const follow = { leader: "c-customers", from: "customer", to: "customer", empty: variant("all", null) };
    const months = cell("c-months", v.of("orders", v.column({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] }), { follow }));
    const picked = clickedOf([{ group: by("customer"), key: "Northwind", type: StringType }])!;

    it("is the leader's selection of its field, as the condition the follower carries", () => {
        const following = followingOf(follow, [customers, months], new Map([["c-customers", [picked]]]));
        if (following.kind !== "selected") throw new Error("expected a selection");
        expect([following.leader.key, printJq(following.condition).text]).toEqual(["c-customers", `.customer == "Northwind"`]);
    });

    it("is nothing with nothing selected, or when the leader's click no longer selects", () => {
        expect(followingOf(follow, [customers, months], new Map()).kind).toBe("nothing");
        const filtering = cell("c-customers", v.of("orders", v.list({ item: v.group("customer"), values: [v.sum("revenue")] }), { click: variant("filter", null) }));
        expect(followingOf(follow, [filtering, months], new Map([["c-customers", [picked]]])).kind).toBe("nothing");
    });

    it("says its leader is removed when the page holds no visual under the leader's key", () => {
        expect(followingOf(follow, [months], new Map([["c-customers", [picked]]])).kind).toBe("removed");
    });

    it("lets only a visual whose click selects lead: a list or a table by default, a chart once its click is select", () => {
        expect(canLead(customers)).toBe(true);
        expect(canLead(months)).toBe(false);
        expect(canLead(cell("c-text", v.text("Notes")))).toBe(false);
    });

    it("refuses a link that would make a cycle: a visual following itself, its own follower, or a follower of one", () => {
        const second = cell("c-second", v.of("orders", v.list({ item: v.group("region"), values: [v.count()] }), { follow: { ...follow, leader: "c-months" } }));
        const cells = [customers, months, second];
        expect(followCycles(cells, "c-customers", "c-customers")).toBe(true);
        expect(followCycles(cells, "c-customers", "c-months")).toBe(true);
        expect(followCycles(cells, "c-customers", "c-second")).toBe(true);
        // A chain is no cycle: the second follows the first's follower.
        expect(followCycles(cells, "c-second", "c-customers")).toBe(false);
        expect(followersOf(cells, "c-customers").map((held) => held.key)).toEqual(["c-months"]);
        expect(followersOf(cells, "c-months").map((held) => held.key)).toEqual(["c-second"]);
    });
});
