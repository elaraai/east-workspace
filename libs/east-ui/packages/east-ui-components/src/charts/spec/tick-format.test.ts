/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a chart's hover tooltip prints a row's value: by what kind of number
 * its measure's axis says it is.
 */
import { describe, expect, test } from "vitest";
import { variant } from "@elaraai/east";
import { tooltipFormatter } from "./tick-format.js";

describe("tooltipFormatter", () => {
    test("a row read against an axis of shares prints a percent to two decimals — the figure the axis's whole percents round — never the fraction it is held as", () => {
        const share = tooltipFormatter(variant("percent", null), "en-AU");
        expect([share(0.195), share(0.1892), share(0.2)]).toEqual(["19.5%", "18.92%", "20%"]);
    });

    test("any other row prints the number it is, as before: an amount whole, grouped, with no sign of its currency; a row of no declared format likewise", () => {
        expect(tooltipFormatter(variant("currency", { code: "AUD", compact: false }), "en-AU")(116549.42)).toBe("116,549.42");
        expect(tooltipFormatter(variant("compact", null), "en-AU")(116549.42)).toBe("116,549.42");
        expect(tooltipFormatter(undefined, "en-AU")(0.195)).toBe("0.195");
    });
});
