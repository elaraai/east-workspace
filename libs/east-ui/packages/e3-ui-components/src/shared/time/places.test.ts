/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { nextPlaces } from "./places.js";

describe("nextPlaces (#1680's review)", () => {
    test("gives each place, in the order given, the least place past it — none for the last", () => {
        expect(nextPlaces([0.5, 0.1, 0.9, 0.3])).toEqual([0.9, 0.3, undefined, 0.5]);
    });

    test("places that stand together share the one past them, and the last of them none", () => {
        expect(nextPlaces([0.3, 0.1, 0.3, 0.7, 0.7])).toEqual([0.7, 0.3, 0.7, undefined, undefined]);
    });

    test("a place before the line's start and one past its end take their places as any other", () => {
        expect(nextPlaces([-0.2, 1.1, 0.4])).toEqual([0.4, undefined, 1.1]);
    });

    test("no places, none; one, none past it", () => {
        expect(nextPlaces([])).toEqual([]);
        expect(nextPlaces([0.5])).toEqual([undefined]);
    });
});
