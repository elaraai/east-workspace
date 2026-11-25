/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * What words typed narrow a list of choices to: every choice with nothing typed, else those the words start first, then
 * those holding them elsewhere, each run in the list's order, without regard to case.
 */

import { describe, test, expect } from "vitest";
import { rankByTyped } from "./typed-rank.js";

const REGISTER = ["Forklift", "Confined space", "First aid", "Working at height"];

describe("rankByTyped", () => {
    test("with nothing typed, every choice in its order", () => {
        expect(rankByTyped(REGISTER, "")).toEqual(REGISTER);
        expect(rankByTyped(REGISTER, "   ")).toEqual(REGISTER);
        expect(rankByTyped([], "")).toEqual([]);
    });

    test("words typed: those they start — the whole choice or one of its words — first, each run in order, then those holding them", () => {
        expect(rankByTyped(REGISTER, "f")).toEqual(["Forklift", "First aid", "Confined space"]);
        expect(rankByTyped(REGISTER, "he")).toEqual(["Working at height"]);
        expect(rankByTyped(REGISTER, "at")).toEqual(["Working at height"]);
        expect(rankByTyped(["Paint shop", "Shop floor", "Workshop"], "shop")).toEqual(["Paint shop", "Shop floor", "Workshop"]);
        expect(rankByTyped(["Workshop", "Shop floor"], "shop")).toEqual(["Shop floor", "Workshop"]);
        expect(rankByTyped(REGISTER, "working at")).toEqual(["Working at height"]);
    });

    test("matched without regard to case, and nothing where nothing matches", () => {
        expect(rankByTyped(REGISTER, "FORK")).toEqual(["Forklift"]);
        expect(rankByTyped(REGISTER, "  Space ")).toEqual(["Confined space"]);
        expect(rankByTyped(REGISTER, "zz")).toEqual([]);
    });

    test("a choice already taken is never offered, typed or not", () => {
        expect(rankByTyped(REGISTER, "", ["Confined space", "Forklift"])).toEqual(["First aid", "Working at height"]);
        expect(rankByTyped(REGISTER, "f", ["Forklift"])).toEqual(["First aid", "Confined space"]);
        expect(rankByTyped(REGISTER, "fork", ["Forklift"])).toEqual([]);
        expect(rankByTyped(REGISTER, "", REGISTER)).toEqual([]);
    });
});
