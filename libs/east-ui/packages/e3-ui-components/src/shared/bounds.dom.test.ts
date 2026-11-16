/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The tone a form says a bound its row breaks in (#1585): an error while a refusal of the row's entry holds Save, a
 * warning while none does — from the entry's refusals in whatever shape a builder holds them.
 */

import { describe, expect, test } from "vitest";
import { IntegerType, StructType } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { fieldBreaches } from "@elaraai/east-ui-components";
import { breachIssue, breachTone } from "./bounds.js";

/** A press's form: the jobs it holds, at most 4. */
const form = Fields.specs(StructType({ jobs: IntegerType }), { jobs: Fields.number({ max: 4n }) });

/** Press H1-P03 changed to hold six jobs: the bound it breaks, raised as its session's readiness raises it. */
const refused = fieldBreaches(form, { jobs: 6n }).map((breach) => breachIssue(breach, "p03"));

describe("breachTone (#1585)", () => {
    test("an entry with a refusal holding Save says a breach as an error", () => {
        expect(refused).toHaveLength(1);
        expect(breachTone(refused)).toBe("error");
    });

    test("an entry nothing refuses says it as a warning: the row as stored, or changed and ready", () => {
        expect(breachTone([])).toBe("warn");
    });

    test("a builder's own refusals, each its session's with its issue, say it alike", () => {
        expect(breachTone(refused.map((issue) => ({ kind: "duty", issue })))).toBe("error");
    });
});
