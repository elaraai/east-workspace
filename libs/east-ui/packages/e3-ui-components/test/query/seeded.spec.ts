/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's showcase records (#940): the mock's seven saved queries,
 * which `@elaraai/e3-ui`'s query examples write out as jq because e3-ui cannot
 * print steps, and the sales' saved query, which says the three steps #1670
 * adds. Each opens in the builder as steps and prints back to itself, so its
 * text is exactly what the builder's steps print.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { StructType, printJq, toEastTypeValue } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import { queryRoot } from "../../src/query/one-shot.js";
import { checkSteps } from "../../src/query/steps/check.js";
import { parseSteps } from "../../src/query/steps/parse.js";
import { printSteps } from "../../src/query/steps/print.js";
import { groupFields } from "../../src/query/steps/values.js";

/** The root the showcase's builders bind, which its saved queries are checked against: the five datasets, by the names its queries read them. */
const root = StructType({ orders: ex.orders.type, customers: ex.customers.type, forecast: ex.forecast.type, model: ex.model.type, bom: ex.bom.type });

describe("the showcase's saved queries (#940)", () => {
    for (const [name, saved] of ex.queries.default!) {
        test(`${name}: opens as steps that check clean and print back to its text`, () => {
            const text = printJq(saved.program, { layout: "pipeline" }).text;
            const parsed = parseSteps(text, root);
            if ("error" in parsed) assert.fail(`${name} does not parse: ${parsed.error.message}`);
            assert.deepEqual(parsed.query.steps.filter(s => s.type === "jq").map(s => s.type), [], `${name} has no jq step`);
            assert.equal(checkSteps(parsed.query, root).errors, 0, `${name} checks clean`);
            assert.equal(printSteps(parsed.query, root).text, text);
        });
    }
});

describe("the showcase's sales query: a date in the last N, two group fields and a ratio (#1670)", () => {
    /** The root the builder binds over the sales, as it makes one: the sales, then `.now`, the minute a query runs. */
    const salesRoot = queryRoot([{ name: "sales", path: ex.sales.path, type: toEastTypeValue(ex.sales.type) }]).type;

    for (const [name, saved] of ex.salesQueries.default!) {
        test(`${name}: opens as a filter on the last 52 weeks, a group by region and channel with a ratio, and a sort, and prints back to its text`, () => {
            const text = printJq(saved.program, { layout: "pipeline" }).text;
            const parsed = parseSteps(text, salesRoot);
            if ("error" in parsed) assert.fail(`${name} does not parse: ${parsed.error.message}`);
            const [filter, group, sort] = parsed.query.steps;
            assert.deepEqual(parsed.query.steps.map(s => s.type), ["filter", "group", "sort"], `${name}'s steps`);
            const condition = filter?.type === "filter" ? filter.value.conds[0] : undefined;
            assert.ok(condition?.type === "test" && condition.value.cmp.type === "some" && condition.value.cmp.value.type === "inLastWeeks", "the sale's day is in the last weeks");
            if (group?.type !== "group") assert.fail("the second step groups");
            assert.deepEqual(groupFields(group.value.by), ["region", "channel"]);
            const ratio = group.value.aggs.find(a => a.fn.type === "ratio");
            assert.ok(ratio?.fn.type === "ratio" && ratio.fn.value.type === "some" && ratio.fn.value.value === "units" && ratio.field.type === "some" && ratio.field.value === "revenue", "revenue over units");
            assert.equal(sort?.type, "sort");
            assert.equal(checkSteps(parsed.query, salesRoot).errors, 0, `${name} checks clean`);
            assert.equal(printSteps(parsed.query, salesRoot).text, text);
        });
    }
});
