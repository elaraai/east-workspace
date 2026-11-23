/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the module loads east-ui-components' entry, which
 * needs one as it loads.
 *
 * The months a horizon holds (#1710): what a horizon over record sources
 * counts each source's rows by, a month a bar before the strip folds them.
 */

import { describe, expect, test } from "vitest";
import { horizonMonths } from "./horizon-months.js";

const at = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const iso = (months: readonly (readonly [number, number])[]) => months.map(([from, to]) => [new Date(from).toISOString().slice(0, 10), new Date(to).toISOString().slice(0, 10)]);

describe("the months a horizon holds (#1710)", () => {
    test("each month it touches, the one holding its start first, each from its first day to the next month's", () => {
        expect(iso(horizonMonths(at("2026-10-05"), at("2027-01-01")))).toEqual([
            ["2026-10-01", "2026-11-01"], ["2026-11-01", "2026-12-01"], ["2026-12-01", "2027-01-01"],
        ]);
    });

    test("a horizon ending inside a month holds that month; one ending at a month's start does not", () => {
        expect(iso(horizonMonths(at("2028-02-01"), at("2028-03-02")))).toEqual([["2028-02-01", "2028-03-01"], ["2028-03-01", "2028-04-01"]]);
        expect(iso(horizonMonths(at("2028-02-01"), at("2028-03-01")))).toEqual([["2028-02-01", "2028-03-01"]]);
    });

    test("an empty horizon holds none", () => {
        expect(horizonMonths(at("2028-02-01"), at("2028-02-01"))).toEqual([]);
    });
});
