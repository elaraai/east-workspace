/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Roster's model loads east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * A Roster target's map by cost, worked out (#1454, `Decision Queue Spec.md`
 * P7, P24, P25): a row a pay code the app's pay answers with, the codes the
 * change moves first, at most five, in the codes' order; one axis either side
 * of zero, each change a bar from the middle — and the words it says, in the
 * Roster's currency.
 */

import { describe, expect, test } from "vitest";
import { SortedMap, StringType, compareFor } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { payFormat } from "../figures.js";
import { decisionQueueMessages as m } from "../messages.js";
import { COST_CODES, costRows } from "./cost-model.js";

const byCode = compareFor(StringType);
const costs = (entries: Record<string, number>) => new SortedMap(Object.entries(entries), byCode);
/** A row's code, figures and bar, the bar to a hundredth of a percent. */
const rowsOf = (model: ReturnType<typeof costRows>) => model.rows.map(row => [row.code, row.was, row.now, row.change, Math.round(row.left * 100) / 100, Math.round(row.width * 100) / 100]);

describe("costRows", () => {
    test("a row a code, in the codes' order: the week's cost before and after, and the change a bar from the middle — left for a saving, right for an added cost — on a nice axis over the largest", () => {
        const model = costRows(costs({ ORD: 3_696, OT1: 756, AGENCY: 1_632 }), costs({ ORD: 4_620, OT1: 378, AGENCY: 816 }));
        expect(model.axis).toBe(1_000);
        expect(rowsOf(model)).toEqual([
            ["AGENCY", 1_632, 816, -816, 9.2, 40.8],
            ["ORD", 3_696, 4_620, 924, 50, 46.2],
            ["OT1", 756, 378, -378, 31.1, 18.9],
        ]);
    });

    test("a code one side alone holds is nothing on the other; nothing changed is no bar, on an axis of one", () => {
        expect(rowsOf(costRows(costs({ ORD: 1_000 }), costs({ ORD: 1_000, OT2: 240 })))).toEqual([["ORD", 1_000, 1_000, 0, 50, 0], ["OT2", 0, 240, 240, 50, 48]]);
        const still = costRows(costs({ ORD: 1_000 }), costs({ ORD: 1_000 }));
        expect([still.axis, rowsOf(still)]).toEqual([1, [["ORD", 1_000, 1_000, 0, 50, 0]]]);
    });

    test("past five codes, those the change moves first, then the rest, in the codes' order", () => {
        const was = costs({ A1: 10, A2: 10, A3: 10, A4: 10, A5: 10, Z1: 10, Z2: 10 });
        const now = costs({ A1: 10, A2: 10, A3: 10, A4: 10, A5: 10, Z1: 20, Z2: 5 });
        expect(COST_CODES).toBe(5);
        expect(costRows(was, now).rows.map(row => row.code)).toEqual(["A1", "A2", "A3", "Z1", "Z2"]);
    });
});

describe("the map by cost's words", () => {
    test("a code's title and the week's sentence, in the Roster's currency, compact and signed", () => {
        const words = formatters("en-US");
        const usd = payFormat("USD");
        expect([words.value(-816, usd, true), words.value(924, usd, true), words.value(1_632, usd), words.value(1_000, usd, true), words.value(0, usd, true)])
            .toEqual(["-$816", "+$924", "$1.6K", "+$1K", "$0"]);
        expect(m.previewCaption({ caption: "payCode" })).toBe("Pay code");
        expect(m.previewCost({ code: "OT1", was: "$756", now: "$378" })).toBe("OT1 · $756 → $378 a week");
        expect(m.previewCosts({ week: "10", codes: [{ code: "AGENCY", change: "-$816" }, { code: "ORD", change: "+$924" }, { code: "OT1", change: "-$378" }], failed: false }))
            .toBe("Week 10 pay by code: AGENCY -$816, ORD +$924 and OT1 -$378");
        expect(m.previewCosts({ week: "10", codes: [], failed: true })).toBe("Week 10 pay doesn't change; some pay couldn't be worked out");
    });
});
