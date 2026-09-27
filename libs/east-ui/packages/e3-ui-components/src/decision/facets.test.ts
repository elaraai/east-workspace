/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Options facet's ranking over a real `DecisionType` value, decoded from
 * East's own encoding as the queue holds it: the recommendation first, then
 * its alternatives greatest value first — values ordered as East orders
 * Floats, so a `NaN` takes one place however the alternatives arrive.
 */

import { describe, test, expect } from "vitest";
import { decodeBeast2For, encodeBeast2For, none, variant } from "@elaraai/east";
import { DecisionType } from "@elaraai/e3-ui/internal";

import { rankOptions } from "./facets.js";
import type { Decision, DecisionOption } from "./types.js";

/** An alternative worth `value`, labelled `label`. */
const option = (label: string, value: number): DecisionOption =>
    ({ id: none, label, value, downside: none, confidence: none, note: none });

const encodeDecision = encodeBeast2For(DecisionType);
const decodeDecision = decodeBeast2For(DecisionType);

/** A decision recommending `title`, with `alternatives`, as the queue holds it. */
function decision(title: string, alternatives: DecisionOption[]): Decision {
    return decodeDecision(encodeDecision({
        id: "d1", kind: "reorder", title, urgency: variant("due", null), value: 10,
        deadline: none, format: none, valueAxis: none, summary: none, downside: none,
        confidence: none, detail: none, stakes: none, prompts: [], levers: [], evidence: [], alternatives,
    }));
}

describe("rankOptions", () => {
    test("the recommendation, then the alternatives greatest value first", () => {
        const ranked = rankOptions(decision("Reorder now", [option("Wait", 2), option("Split", 7), option("Cancel", -3)]));
        expect(ranked.map((o) => [o.rank, o.label, o.recommended])).toEqual([
            [1, "Reorder now", true], [2, "Split", false], [3, "Wait", false], [4, "Cancel", false],
        ]);
    });

    test("an unknown (NaN) value takes East's one place for it, whatever order the alternatives arrive in", () => {
        const alternatives = [option("One", 1), option("Unknown", NaN), option("Two", 2)];
        for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [0, 2, 1]]) {
            const ranked = rankOptions(decision("Act", order.map((i) => alternatives[i]!)));
            // East orders NaN above every number.
            expect(ranked.map((o) => o.label)).toEqual(["Act", "Unknown", "Two", "One"]);
        }
    });
});
