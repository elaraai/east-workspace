/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart on a phone: `narrow.lanes` says how many lanes its window
 * shows at once; a count outside 1 to 3 is refused as the flowchart is built.
 * What the payload's canvas carries is `flowchart.spec.ts`'s.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { East } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Data, Flowchart } from "@elaraai/e3-ui";
import * as ex from "./flowchart.examples.js";

describe("Flowchart narrow", () => {
    test("a count of 1 to 3 builds, as does none", () => {
        for (const narrow of [{ lanes: 1 as const }, { lanes: 3 as const }, {}, undefined]) {
            assert.doesNotThrow(() => East.function([], UIComponentType, ($) => {
                const states = $.let(Data.bind(ex.depotStates));
                return Flowchart({ states: Flowchart.states(states, { label: "name" }), ...(narrow === undefined ? {} : { narrow }) });
            }));
        }
    });

    test("a count outside 1 to 3 is refused", () => {
        assert.throws(() => East.function([], UIComponentType, ($) => {
            const states = $.let(Data.bind(ex.depotStates));
            return Flowchart({ states: Flowchart.states(states, { label: "name" }), narrow: { lanes: 4 as never } });
        }), /`narrow\.lanes`.*1 to 3/);
    });
});
