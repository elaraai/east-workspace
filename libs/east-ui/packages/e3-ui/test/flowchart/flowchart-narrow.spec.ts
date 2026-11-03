/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart on a phone: `narrow.lanes` says how many lanes its window
 * shows at once; a count outside 1 to 3 is refused as the flowchart is built.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Flowchart } from "@elaraai/e3-ui/internal";
import { East } from "@elaraai/east";

const FLOW = Flowchart.value({ lanes: [{ key: "a", label: "A" }], states: [{ key: "S", label: "S", lane: "a" }], links: [] });

describe("Flowchart narrow", () => {
    test("a count of 1 to 3 builds, as does none", () => {
        for (const narrow of [{ lanes: 1 as const }, { lanes: 3 as const }, {}]) {
            assert.doesNotThrow(() => East.function([], Flowchart.Types.Payload, (_$) => Flowchart.Payload({ data: FLOW, narrow })));
        }
        assert.doesNotThrow(() => East.function([], Flowchart.Types.Payload, (_$) => Flowchart.Payload({ data: FLOW })));
    });

    test("a count outside 1 to 3 is refused", () => {
        assert.throws(() => East.function([], Flowchart.Types.Payload, (_$) => Flowchart.Payload({ data: FLOW, narrow: { lanes: 4 as never } })), /`narrow\.lanes`.*1 to 3/);
    });
});
