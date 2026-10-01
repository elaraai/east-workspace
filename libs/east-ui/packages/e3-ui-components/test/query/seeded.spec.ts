/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's showcase record (#940): the mock's seven saved queries,
 * which `@elaraai/e3-ui`'s query examples write out as jq because e3-ui cannot
 * print steps. Each opens in the builder as steps and prints back to itself, so
 * its text is exactly what the builder's steps print.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fromEastTypeValue, printJq } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/query/query";
import { checkSteps } from "../../src/query/steps/check.js";
import { parseSteps } from "../../src/query/steps/parse.js";
import { printSteps } from "../../src/query/steps/print.js";

describe("the showcase's saved queries (#940)", () => {
    for (const [name, saved] of ex.queries.default!) {
        test(`${name}: opens as steps that check clean and print back to its text`, () => {
            const root = fromEastTypeValue(saved.query.value.input_type);
            const text = printJq(saved.query.value.program, { layout: "pipeline" }).text;
            const parsed = parseSteps(text, root);
            if ("error" in parsed) assert.fail(`${name} does not parse: ${parsed.error.message}`);
            assert.deepEqual(parsed.query.steps.filter(s => s.type === "jq").map(s => s.type), [], `${name} has no jq step`);
            assert.equal(checkSteps(parsed.query, root).errors, 0, `${name} checks clean`);
            assert.equal(printSteps(parsed.query, root).text, text);
        });
    }
});
