/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A number field's range, as a slot's offer says it (found by the manual test
 * of the Studio showcase, 22 November 2026: an alert's Field list read
 * `mean margin 0.19 – 0.19`): its ends as a summary prints a number — two
 * decimals, a whole number grouped — and, where two different numbers print the
 * same so, with the fewest decimals that tell them apart; past six, each as
 * East prints a Float.
 */

import { describe, expect, it } from "vitest";
import { FloatType, IntegerType, StructType } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { fieldsOfRecord } from "../steps/fields.js";
import { queryWords, spanNumbers } from "./words.js";

const words = queryWords(formatters("en-AU"));

/** A share, a count and an ID, as the steps name a row's fields. */
const [margin, units, orderId] = fieldsOfRecord(StructType({ margin: FloatType, units: IntegerType, order_id: IntegerType }), new Map());

describe("spanNumbers", () => {
    it("prints ends that two decimals tell apart as a summary prints a number", () => {
        expect(spanNumbers(0.85, 3646.84, margin!, words)).toEqual({ from: "0.85", to: "3,646.84" });
        expect(spanNumbers(3, 1200, units!, words)).toEqual({ from: "3", to: "1,200" });
        expect(spanNumbers(1001, 1042, orderId!, words)).toEqual({ from: "1001", to: "1042" });
    });

    it("tells two shares apart that two decimals print the same: the fewest decimals that do", () => {
        // 18.65% and 19.35% of a margin: `0.19 – 0.19` at two decimals.
        expect(spanNumbers(0.18653846153846154, 0.19354838709677419, margin!, words)).toEqual({ from: "0.187", to: "0.194" });
        expect(spanNumbers(0.1901, 0.1904, margin!, words)).toEqual({ from: "0.1901", to: "0.1904" });
    });

    it("prints one number's range as it is: both ends the same", () => {
        expect(spanNumbers(0.19, 0.19, margin!, words)).toEqual({ from: "0.19", to: "0.19" });
    });

    it("prints ends six decimals do not tell apart as East prints a Float, every digit", () => {
        expect(spanNumbers(0.19000001, 0.19000002, margin!, words)).toEqual({ from: "0.19000001", to: "0.19000002" });
    });
});
