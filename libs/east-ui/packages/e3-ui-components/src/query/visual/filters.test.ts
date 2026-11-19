/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A page's filters' rules (`filters.ts`, #1673): adding, changing, removing
 * and clearing; which apply to a source — for a visual, all but the one its
 * own click made, whose groups it marks; the one condition a visual of a
 * source prints them as — which narrows its program as each filter would;
 * the window they hold a source's date to, with what they say besides; and
 * a filter in words, as its chip says it.
 */

import { describe, expect, it } from "vitest";
import {
    ArrayType, BooleanType, DateTimeType, FloatType, StringType, StructType, checkJq, evaluateJq, isValueOf, none, printJq, some,
    toEastTypeValue, variant, type JqNode, type ValueTypeOf,
} from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { utcAt as at } from "../../plan/plan.test-utils.js";
import { visualAnswerType } from "./ask.js";
import { formatters } from "@elaraai/east-ui-components";
import { queryWords } from "../model/words.js";
import {
    addFilter, changeFilter, clearFilters, filterQuery, filterWords, filtersOn, markedBy, ownFilterAt, pageRange, printStateOf, removeFilter, selectOf, whereOf,
    type PageFilter,
} from "./filters.js";
import { printVisual } from "./print.js";
import { printSourceOf } from "./source.js";
import { ORDERS_ROOT, ORDERS_SOURCE, condition } from "./visual.test-utils.js";
/** A filter the reader wrote on a source. */
const on = (source: string, where: string): PageFilter => ({ source, where: condition(where), from: none });
/** A list of filters, as their sources and their conditions' text. */
const said = (filters: readonly PageFilter[]) => filters.map((held) => `${held.source}: ${printJq(held.where).text}`);

const SA = on("orders", `.region == "SA"`);
const EXPORT = on("orders", ".export");
const RUNNING = on("assets", ".running");
const PAGE = [SA, RUNNING, EXPORT];

describe("a page's filters, edited", () => {
    it("adds a filter after the rest", () => {
        expect(said(addFilter([SA], RUNNING))).toEqual([`orders: .region == "SA"`, "assets: .running"]);
        expect(said(addFilter([], SA))).toEqual([`orders: .region == "SA"`]);
    });

    it("changes a filter in its place, and nothing for a place that holds none", () => {
        const big = on("orders", ".revenue > 60");
        expect(said(changeFilter(PAGE, 0, big))).toEqual(["orders: .revenue > 60", "assets: .running", "orders: .export"]);
        expect(said(changeFilter(PAGE, 3, big))).toEqual(said(PAGE));
        expect(said(changeFilter(PAGE, -1, big))).toEqual(said(PAGE));
    });

    it("removes a filter, and nothing for a place that holds none", () => {
        expect(said(removeFilter(PAGE, 1))).toEqual([`orders: .region == "SA"`, "orders: .export"]);
        expect(said(removeFilter(PAGE, 5))).toEqual(said(PAGE));
    });

    it("clears every filter, or one source's alone", () => {
        expect(clearFilters(PAGE)).toEqual([]);
        expect(said(clearFilters(PAGE, "orders"))).toEqual(["assets: .running"]);
        expect(said(clearFilters(PAGE, "stock"))).toEqual(said(PAGE));
    });

    it("leaves the filters it was given as they were", () => {
        const held = [...PAGE];
        addFilter(PAGE, SA);
        changeFilter(PAGE, 0, RUNNING);
        removeFilter(PAGE, 0);
        clearFilters(PAGE);
        expect(PAGE).toEqual(held);
    });
});

describe("the filters on a source", () => {
    it("are its own, in the page's order, and no other source's", () => {
        expect(said(filtersOn(PAGE, "orders"))).toEqual([`orders: .region == "SA"`, "orders: .export"]);
        expect(said(filtersOn(PAGE, "assets"))).toEqual(["assets: .running"]);
        expect(filtersOn(PAGE, "stock")).toEqual([]);
    });
});

describe("a visual's own filter: the one its click made (#1673)", () => {
    /** The regions list's: two regions it marks. */
    const CLICKED: PageFilter = { source: "orders", where: condition(`.region == "SA" or .region == "WA"`), from: some("c-regions") };
    const HELD = [SA, CLICKED, RUNNING, EXPORT];
    const NOW = at("2026-09-15T12:00:00");
    const texts = (nodes: readonly JqNode[]) => nodes.map((node) => printJq(node).text);

    it("is no narrowing of the visual whose click made it, and is every other visual's of its source", () => {
        expect(said(filtersOn(HELD, "orders", "c-regions"))).toEqual([`orders: .region == "SA"`, "orders: .export"]);
        expect(said(filtersOn(HELD, "orders", "c-months"))).toEqual([`orders: .region == "SA"`, `orders: .region == "SA" or .region == "WA"`, "orders: .export"]);
        expect(said(filtersOn(HELD, "orders"))).toEqual(said(filtersOn(HELD, "orders", "c-months")));
    });

    it("holds the groups the visual marks, each a condition any of which a row may pass; none where its click made none, or on another source", () => {
        expect(ownFilterAt(HELD, "orders", "c-regions")).toBe(1);
        expect(texts(markedBy(HELD, "orders", "c-regions"))).toEqual([`.region == "SA"`, `.region == "WA"`]);
        expect([ownFilterAt(HELD, "orders", "c-months"), markedBy(HELD, "orders", "c-months")]).toEqual([-1, []]);
        expect(ownFilterAt(HELD, "assets", "c-regions")).toBe(-1);
    });

    it("leaves the visual's state the page's other filters; every other visual's holds it, a month its window", () => {
        const july: PageFilter = { source: "orders", where: condition(`(.ordered_at | strftime("%Y-%m")) == "2026-07"`), from: some("c-months") };
        const held = [july, on("orders", `.region == "SA"`)];
        const own = printStateOf(held, "orders", ORDERS_SOURCE, NOW, "c-months");
        expect([texts(own.filters), own.range]).toEqual([[`.region == "SA"`], undefined]);
        const other = printStateOf(held, "orders", ORDERS_SOURCE, NOW, "c-regions");
        expect([texts(other.filters).length, other.range?.window]).toEqual([2, { from: at("2026-07-01T00:00:00"), to: at("2026-08-01T00:00:00") }]);
    });
});

describe("the one condition they print", () => {
    it("is none for a source with no filter, the filter's own for one, and every one a row must pass for several", () => {
        expect(selectOf(PAGE, "stock")).toBeUndefined();
        expect(printJq(selectOf(PAGE, "assets")!).text).toBe(".running");
        expect(printJq(selectOf(PAGE, "orders")!).text).toBe(`.region == "SA" and .export`);
        const three = addFilter(PAGE, on("orders", ".revenue > 60"));
        expect(printJq(selectOf(three, "orders")!).text).toBe(`.region == "SA" and .export and .revenue > 60`);
    });

    it("keeps a filter that is an any-of whole: it is one of the conditions a row must pass", () => {
        const either = [on("orders", `.region == "SA" or .region == "WA"`), EXPORT];
        expect(printJq(selectOf(either, "orders")!).text).toBe(`(.region == "SA" or .region == "WA") and .export`);
    });

    it("narrows a visual's program as each filter would: one select, after the visual's own filter", () => {
        const Row = StructType({ ordered_at: DateTimeType, region: StringType, revenue: FloatType, export: BooleanType });
        const ORDERS: ValueTypeOf<typeof Row>[] = [
            { ordered_at: at("2026-07-03T10:00:00"), region: "SA", revenue: 100, export: true },
            { ordered_at: at("2026-07-20T10:00:00"), region: "SA", revenue: 50, export: false },
            { ordered_at: at("2026-08-02T10:00:00"), region: "NSW", revenue: 70, export: true },
            { ordered_at: at("2026-08-09T10:00:00"), region: "SA", revenue: 20, export: true },
        ];
        const source = printSourceOf({
            key: "orders", name: "Orders", icon: "receipt", description: none,
            binding: { name: "orders", source: variant("value", [variant("field", "inputs"), variant("field", "orders")]), type: toEastTypeValue(ArrayType(Row)) },
            fields: [], range: some("ordered_at"),
        })!;
        const content = Studio.visual.of("orders", Studio.visual.kpi({ value: Studio.visual.sum("revenue") }), { where: condition(".revenue > 30") });
        if (content.type !== "visual") throw new Error("not a visual");
        const select = selectOf(PAGE, "orders")!;
        const printed = printVisual(content.value, source, { filters: [select] });
        if (printed.kind !== "asks") throw new Error(printed.kind);
        const program = printed.asks[0]!.program;
        // The visual's own filter, then the page's as one select.
        expect(program.split("\n").slice(0, 3)).toEqual([
            ".orders",
            "| map(select(.revenue > 30))",
            `| map(select(.region == "SA" and .export))`,
        ]);
        // South Australia's exports over 30: the first order alone.
        const checked = checkJq(program, StructType({ orders: ArrayType(Row) }), { root: true });
        expect(checked.diagnostics.filter((d) => d.severity.type === "error").map((d) => d.message)).toEqual([]);
        const type = checked.elementType === null ? undefined : visualAnswerType(checked.elementType);
        const answer = evaluateJq(checked, { orders: ORDERS });
        if (type === undefined || !isValueOf(answer, type)) throw new Error("not a visual's answer");
        expect((answer as ValueTypeOf<typeof type>).rows).toEqual([{ v0: 100, n: 1n }]);
    });
});

describe("the window a page's filters hold a source's date to", () => {
    /** The page's minute. */
    const NOW = at("2026-09-15T12:00:00");
    /** The range some conditions hold the orders' date to: its window, and the rest as jq. */
    const rangeOf = (...conditions: string[]) => {
        const range = pageRange(conditions.map(condition), ORDERS_SOURCE, NOW);
        return range === undefined ? undefined : { from: range.window.from, to: range.window.to, rest: range.rest.map((node) => printJq(node).text) };
    };

    it("reads a start and an end from a filter's two sides: on or after a date, before a date", () => {
        expect(rangeOf(`.ordered_at >= "2026-07-01" and .ordered_at < "2026-10-01"`))
            .toEqual({ from: at("2026-07-01T00:00:00"), to: at("2026-10-01T00:00:00"), rest: [] });
        // A date-time, with its offset or none.
        expect(rangeOf(`.ordered_at >= "2026-07-01T06:00:00Z"`, `.ordered_at < "2026-07-02T06:00:00"`))
            .toEqual({ from: at("2026-07-01T06:00:00"), to: at("2026-07-02T06:00:00"), rest: [] });
    });

    it("reads a year and a month as the window each is", () => {
        expect(rangeOf("(.ordered_at | year) == 2026")).toEqual({ from: at("2026-01-01T00:00:00"), to: at("2027-01-01T00:00:00"), rest: [] });
        expect(rangeOf(`(.ordered_at | strftime("%Y-%m")) == "2026-12"`)).toEqual({ from: at("2026-12-01T00:00:00"), to: at("2027-01-01T00:00:00"), rest: [] });
        expect(rangeOf(`(.ordered_at | strftime("%Y-%m")) == "2026-02"`)).toEqual({ from: at("2026-02-01T00:00:00"), to: at("2026-03-01T00:00:00"), rest: [] });
    });

    it("counts the last hours, days and weeks back from the page's minute, to now", () => {
        expect(rangeOf(`.ordered_at >= ($now | datetime_add(-6; "hour"))`)).toEqual({ from: at("2026-09-15T06:00:00"), to: NOW, rest: [] });
        expect(rangeOf(`.ordered_at >= ($now | datetime_add(-7; "day"))`)).toEqual({ from: at("2026-09-08T12:00:00"), to: NOW, rest: [] });
        expect(rangeOf(`.ordered_at >= ($now | datetime_add(-2; "week"))`)).toEqual({ from: at("2026-09-01T12:00:00"), to: NOW, rest: [] });
    });

    it("runs a window with a start and no end to now — or to its start, when that is still to come", () => {
        expect(rangeOf(`.ordered_at >= "2026-09-01"`)).toEqual({ from: at("2026-09-01T00:00:00"), to: NOW, rest: [] });
        expect(rangeOf(`.ordered_at >= "2026-10-01"`)).toEqual({ from: at("2026-10-01T00:00:00"), to: at("2026-10-01T00:00:00"), rest: [] });
    });

    it("has no window with no start: an end alone, no bound at all, or a source with no range field", () => {
        expect(rangeOf(`.ordered_at < "2026-10-01"`)).toBeUndefined();
        expect(rangeOf(`.region == "SA"`)).toBeUndefined();
        expect(rangeOf()).toBeUndefined();
        const undated = { ...ORDERS_SOURCE, range: undefined };
        expect(pageRange([condition(`.ordered_at >= "2026-07-01"`)], undated, NOW)).toBeUndefined();
    });

    it("narrows one window by several bounds: the latest start, the earliest end", () => {
        expect(rangeOf("(.ordered_at | year) == 2026", `.ordered_at >= "2026-07-01"`, `.ordered_at < "2026-10-01"`, `.ordered_at < "2026-11-01"`))
            .toEqual({ from: at("2026-07-01T00:00:00"), to: at("2026-10-01T00:00:00"), rest: [] });
    });

    it("keeps what the filters say besides, in their order: another field's test, an any-of, a form no row writes, a bound on another date", () => {
        expect(rangeOf(
            `.region == "SA" and .ordered_at >= "2026-07-01"`,
            `.ordered_at < "2026-10-01" and (.region == "SA" or .region == "WA")`,
            ".revenue > 60",
        )).toEqual({ from: at("2026-07-01T00:00:00"), to: at("2026-10-01T00:00:00"), rest: [`.region == "SA"`, `.region == "SA" or .region == "WA"`, ".revenue > 60"] });
        // An any-of that names the date is one condition, kept whole: it holds the date to no one window.
        expect(rangeOf(`.ordered_at >= "2026-07-01"`, `.ordered_at < "2026-08-01" or .region == "SA"`)?.rest).toEqual([`.ordered_at < "2026-08-01" or .region == "SA"`]);
        // A date the rows compare some other way.
        expect(rangeOf(`.ordered_at >= "2026-07-01"`, `.ordered_at > "2026-07-15"`)?.rest).toEqual([`.ordered_at > "2026-07-15"`]);
    });

    it("is the page's state for a visual of the source: its filters as they are, and their range", () => {
        const page = [on("orders", `.ordered_at >= "2026-07-01" and .region == "SA"`), RUNNING, on("orders", `.ordered_at < "2026-10-01"`)];
        const state = printStateOf(page, "orders", ORDERS_SOURCE, NOW);
        expect(state.filters.map((node) => printJq(node).text)).toEqual([`.ordered_at >= "2026-07-01" and .region == "SA"`, `.ordered_at < "2026-10-01"`]);
        expect([state.range?.window, state.range?.rest.map((node) => printJq(node).text)])
            .toEqual([{ from: at("2026-07-01T00:00:00"), to: at("2026-10-01T00:00:00") }, [`.region == "SA"`]]);
        // A source the page has no filter on: no filters, and no range.
        expect(printStateOf(page, "stock", ORDERS_SOURCE, NOW)).toEqual({ filters: [] });
    });
});

describe("a filter in words, as its chip says it", () => {
    const words = queryWords(formatters("en-AU"));
    const said = (where: string) => filterWords(condition(where), ORDERS_SOURCE, words);

    it("is the query builder's words for a condition its rows write: a test, a date's, several side by side — a group inside one in brackets", () => {
        expect(said(`.region == "SA"`)).toBe("region is SA");
        expect(said(".revenue >= 1000")).toBe("revenue is at least 1,000");
        expect(said(`.ordered_at >= ($now | datetime_add(-30; "day"))`)).toBe("ordered at is in the last 30 days");
        expect(said("(.ordered_at | year) == 2026")).toBe("ordered at is in 2026");
        expect(said(`.region == "SA" and .revenue > 60`)).toBe("region is SA and revenue is more than 60");
        expect(said(`.region == "SA" or .region == "WA"`)).toBe("region is SA or region is WA");
        expect(said(`.revenue > 60 and (.region == "SA" or .region == "WA")`)).toBe("revenue is more than 60 and (region is SA or region is WA)");
    });

    it("is its jq where the condition is no form the rows write", () => {
        expect(said(`.region | IN("SA", "NSW")`)).toBe(`.region | IN("SA", "NSW")`);
        expect(said(".revenue / .units > 20")).toBe(".revenue / .units > 20");
    });
});

describe("a filter as the query its condition rows edit", () => {
    const root = ORDERS_ROOT.type;
    /** A condition through the rows and back, as jq. */
    const through = (where: string) => {
        const query = filterQuery(condition(where), ORDERS_SOURCE, root);
        const back = whereOf(query, root);
        return [query.source, query.steps.map((step) => step.type), back === undefined ? undefined : printJq(back).text];
    };

    it("is its source's rows and one Keep rows where step, which reads back as the condition it was", () => {
        expect(through(`.region == "SA"`)).toEqual(["orders", ["filter"], `.region == "SA"`]);
        expect(through(`.region == "SA" and .revenue > 60`)).toEqual(["orders", ["filter"], `.region == "SA" and .revenue > 60`]);
        expect(through(`.region == "SA" or .region == "WA"`)).toEqual(["orders", ["filter"], `.region == "SA" or .region == "WA"`]);
        expect(through("(.ordered_at | year) == 2026")).toEqual(["orders", ["filter"], "(.ordered_at | year) == 2026"]);
        // One that counts back from now: its program binds `.now`, and the condition is the same.
        expect(through(`.ordered_at >= ($now | datetime_add(-30; "day"))`)).toEqual(["orders", ["filter"], `.ordered_at >= ($now | datetime_add(-30; "day"))`]);
    });

    it("holds a condition no row form says as a line of jq, and reads it back", () => {
        expect(through(`.region | IN("SA", "NSW")`)).toEqual(["orders", ["jq"], `.region | IN("SA", "NSW")`]);
        expect(through(".revenue / .units > 20")).toEqual(["orders", ["jq"], ".revenue / .units > 20"]);
    });

    it("starts a filter still to be written as an empty step, which holds no condition until it is finished", () => {
        const query = filterQuery(undefined, ORDERS_SOURCE, root);
        expect([query.source, query.steps.map((step) => step.type), whereOf(query, root)]).toEqual(["orders", ["filter"], undefined]);
    });

    it("reads no condition from a query that is not one narrowing of its rows", () => {
        const one = filterQuery(condition(`.region == "SA"`), ORDERS_SOURCE, root);
        expect(whereOf({ ...one, steps: [] }, root)).toBeUndefined();
        expect(whereOf({ ...one, steps: [...one.steps, ...one.steps] }, root)).toBeUndefined();
        // A line of jq that keeps no rows by a condition.
        expect(whereOf({ source: "orders", steps: [variant("jq", { id: "s", text: "sort_by(.revenue)" })] }, root)).toBeUndefined();
    });
});
