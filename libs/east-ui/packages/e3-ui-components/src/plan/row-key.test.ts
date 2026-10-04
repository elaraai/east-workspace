/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row's key (`row-key.ts`) — the canonical text of its typed id, and back.
 */

import { describe, test, expect } from "vitest";
import { variant } from "@elaraai/east";
import { rowIdOfKey, rowKeyOf, type PlanRowId } from "./row-key.js";

const entry = (series: string, ...path: string[]) => variant("entry", { series, path }) as PlanRowId;

describe("row keys", () => {
    test("a key is the id's .east text, and parses back to the id", () => {
        const id = entry("presses", "Hall 3", "H3-P10");
        expect(rowKeyOf(id)).toBe('.entry (series="presses", path=["Hall 3", "H3-P10"])');
        expect(rowIdOfKey(rowKeyOf(id))).toEqual(id);
    });

    test("rowKeyOf maps point-free — whatever else `map` hands it, it prints the one id (#824)", () => {
        // East's printer takes parameters of its own beyond the value; handed
        // `map`'s index and array as those, it threw on a bound ui state's
        // first non-empty list.
        const ids = [entry("kpi", "ontime"), entry("halls", "Hall 1"), entry("halls", "Hall 2")];
        expect(ids.map(rowKeyOf)).toEqual(ids.map((id) => rowKeyOf(id)));
    });
});
