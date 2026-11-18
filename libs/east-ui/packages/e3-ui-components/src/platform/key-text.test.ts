/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A record's key from its text (#1540): a String key as it is, any other key
 * as East prints it, read back.
 */

import { describe, test, expect } from "vitest";
import { IntegerType, NullType, StringType, VariantType, equalFor, printFor, variant } from "@elaraai/east";
import { keyReaderOf } from "./key-text.js";

describe("a key from its text (#1540)", () => {
    test("a String key is its text, whatever it holds", () => {
        const read = keyReaderOf(StringType);
        expect([read("P03"), read(""), read("7")]).toEqual(["P03", "", "7"]);
    });

    test("an Integer key is read back from East's printing of it", () => {
        const read = keyReaderOf(IntegerType);
        expect(read(printFor(IntegerType)(42n))).toBe(42n);
    });

    test("a variant key is read back as its case", () => {
        const Kind = VariantType({ ink_fill: NullType, plate_check: NullType });
        const read = keyReaderOf(Kind);
        expect(equalFor(Kind)(read(printFor(Kind)(variant("plate_check", null))) as never, variant("plate_check", null))).toBe(true);
    });

    test("a text that is no key of the type reads as none", () => {
        expect(keyReaderOf(IntegerType)("P03")).toBeUndefined();
        expect(keyReaderOf(VariantType({ a: NullType }))(".b")).toBeUndefined();
    });
});
