/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A phrase's first letter in capitals (`capital.ts`): the rest as written, an
 * empty phrase as it is, a phrase that starts with no letter as it is.
 */

import { describe, test, expect } from "vitest";
import { capitalised } from "./capital.js";

describe("capitalised", () => {
    test("makes the first letter a capital and leaves the rest as written", () => {
        expect(["region is SA", "average revenue", "Orders", "eBay listings"].map(capitalised))
            .toEqual(["Region is SA", "Average revenue", "Orders", "EBay listings"]);
    });

    test("leaves an empty phrase, and one that starts with no letter, as they are", () => {
        expect(["", "3 orders", "“quoted”"].map(capitalised)).toEqual(["", "3 orders", "“quoted”"]);
    });
});
