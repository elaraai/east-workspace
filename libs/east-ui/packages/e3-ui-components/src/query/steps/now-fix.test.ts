/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `$now` in the jq a person writes (#1670, #1674): read with no bind, its
 * problem carries the fix that binds it — `.now as $now`, written first, as
 * the steps write it — and the jq the fix makes checks clean and reads back as
 * steps. No other unbound variable has one, nor `$now` over a root whose data
 * source is named `now`.
 */

import { describe, expect, it } from "vitest";
import { ArrayType, checkJq, toEastTypeValue } from "@elaraai/east";
import * as tiles from "@elaraai/e3-ui/examples/studio/tiles";
import { queryRoot } from "../one-shot.js";
import { ORDERS_ROOT } from "../visual/visual.test-utils.js";
import { withNowFix } from "./now-fix.js";
import { parseSteps } from "./parse.js";
import { printSteps } from "./print.js";

const LABEL = "Bind $now";

/** A check of jq as the jq view makes it, over a root. */
const checked = (text: string, root = ORDERS_ROOT) => withNowFix(checkJq(text, root.type, { root: true }), text, root, LABEL);

/** Each problem's code and its fixes: a fix's label, and its edits as offset, length and what goes in. */
const problems = (text: string, root = ORDERS_ROOT) => checked(text, root).diagnostics
    .map((problem) => [problem.code, problem.fixes.map((fix) => [fix.label, fix.edits.map((edit) => [edit.offset, edit.length, edit.insert])])]);

/** The last half hour's orders: a count in minutes, which no "is in the last" says. */
const HALF_HOUR = `.orders\n| map(select(.ordered_at >= ($now | datetime_add(-30; "minute"))))`;

/** A field the orders lack: a problem that is no unbound `$now`. */
const MISSPELT = `.orders\n| map(.revenu)`;

describe("withNowFix", () => {
    it("gives an unbound $now the fix that binds it first, as the steps write it", () => {
        expect(problems(HALF_HOUR)).toEqual([["unknown_function", [[LABEL, [[0n, 0n, ".now as $now\n| "]]]]]]);
    });

    it("makes jq that checks clean and reads back as steps — a jq step, the minute bound for it — and prints as it was fixed", () => {
        const fixed = `.now as $now\n| ${HALF_HOUR}`;
        expect(checked(fixed).diagnostics).toEqual([]);
        const parsed = parseSteps(fixed, ORDERS_ROOT.type);
        if ("error" in parsed) throw new Error(parsed.error.message);
        expect(parsed.query.steps.map((step) => step.type)).toEqual(["jq"]);
        expect(printSteps(parsed.query, ORDERS_ROOT.type).text).toBe(fixed);
        // A count in days is a condition: "is in the last 7 days", its bind the steps' own.
        const week = parseSteps(`.now as $now\n| .orders\n| map(select(.ordered_at >= ($now | datetime_add(-7; "day"))))`, ORDERS_ROOT.type);
        expect("error" in week ? week.error.message : week.query.steps.map((step) => step.type)).toEqual(["filter"]);
    });

    it("leaves every other problem as the checker gave it: another variable no bind names, a field the rows lack", () => {
        expect(problems(`.orders\n| map(select(.ordered_at >= $then))`)).toEqual([["unknown_function", []]]);
        // With no unbound $now, the check is given back as it is: the same object.
        const check = checkJq(MISSPELT, ORDERS_ROOT.type, { root: true });
        expect(withNowFix(check, MISSPELT, ORDERS_ROOT, LABEL)).toBe(check);
        expect(check.diagnostics.map((problem) => problem.code)).toEqual(["unknown_field"]);
    });

    it("has no fix where a data source is named now: .now reads it, no minute", () => {
        const root = queryRoot([
            { name: "orders", path: tiles.tileTestQuarter.path, type: toEastTypeValue(ArrayType(tiles.TileTestQuarterRow)) },
            { name: "now", path: tiles.tileTestQuarter.path, type: toEastTypeValue(ArrayType(tiles.TileTestQuarterRow)) },
        ]);
        expect(problems(HALF_HOUR, root)).toEqual([["unknown_function", []]]);
    });
});
