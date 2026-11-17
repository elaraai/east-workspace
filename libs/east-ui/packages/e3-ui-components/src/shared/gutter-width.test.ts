/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, expect, test } from "vitest";
import { GUTTER_STEP, GUTTER_STEP_FAR, clampGutter, gutterBounds, gutterWidthByKey } from "./gutter-width.js";

const BOUNDS = { min: 168, max: 360 };

describe("The gutter's width (#1680's review)", () => {
    test("a width is held between its bounds, in whole pixels", () => {
        expect([clampGutter(100, BOUNDS), clampGutter(240.4, BOUNDS), clampGutter(240.6, BOUNDS), clampGutter(900, BOUNDS)])
            .toEqual([168, 240, 241, 360]);
    });

    test("an author's width outside the builder's bounds widens them, so it is never out of reach", () => {
        expect([gutterBounds(240, 168, 360), gutterBounds(120, 168, 360), gutterBounds(420, 168, 360)])
            .toEqual([{ min: 168, max: 360 }, { min: 120, max: 360 }, { min: 168, max: 420 }]);
    });

    test("← and → step it, Shift further; Home and End take it to its bounds; any other key is not the handle's", () => {
        expect([
            gutterWidthByKey(240, "ArrowLeft", false, BOUNDS), gutterWidthByKey(240, "ArrowRight", false, BOUNDS),
            gutterWidthByKey(240, "ArrowLeft", true, BOUNDS), gutterWidthByKey(240, "ArrowRight", true, BOUNDS),
            gutterWidthByKey(240, "Home", false, BOUNDS), gutterWidthByKey(240, "End", false, BOUNDS),
            gutterWidthByKey(240, "ArrowUp", false, BOUNDS), gutterWidthByKey(240, "Enter", false, BOUNDS),
        ]).toEqual([240 - GUTTER_STEP, 240 + GUTTER_STEP, 240 - GUTTER_STEP_FAR, 240 + GUTTER_STEP_FAR, 168, 360, undefined, undefined]);
    });

    test("a step past a bound stops at it", () => {
        expect([gutterWidthByKey(172, "ArrowLeft", false, BOUNDS), gutterWidthByKey(350, "ArrowRight", true, BOUNDS)]).toEqual([168, 360]);
    });
});
