/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A key search's query as a keyed paged source's `seek` is asked it: each form
 * the shared grammar parses, from the text typed, printed through East.
 */

import { describe, expect, test } from "vitest";
import { IntegerType, StringType, StructType, none, printFor, some, toEastTypeValue, variant, type EastType } from "@elaraai/east";
import { SeekQueryType } from "@elaraai/east-ui";
import { parseKeyInput } from "@elaraai/east-ui/internal";
import { toSeekQuery } from "./seek-query.js";

const printSeek = printFor(SeekQueryType);

/** What a source's `seek` is asked for text typed at a key type, printed. */
function askedFor(keyType: EastType, text: string): string {
    const parsed = parseKeyInput(toEastTypeValue(keyType), text);
    if (parsed.kind !== "query") throw new Error(`"${text}" parsed as no query: ${parsed.hint}`);
    return printSeek(toSeekQuery(parsed.query));
}

describe("toSeekQuery", () => {
    test("a key's start, a quoted key and a range ask as themselves", () => {
        expect(askedFor(StringType, "A0")).toBe(printSeek(variant("prefix", "A0")));
        expect(askedFor(StringType, "\"A02\"")).toBe(printSeek(variant("key", "\"A02\"")));
        expect(askedFor(IntegerType, "10")).toBe(printSeek(variant("key", "10")));
        expect(askedFor(IntegerType, "2..9")).toBe(printSeek(variant("range", { from: ["2"], to: ["9"] })));
    });

    test("a struct key's leading fields keep the prefix on the next field with them", () => {
        const Spot = StructType({ row: IntegerType, col: StringType });
        // Never a bare prefix, which would drop the leading field.
        expect(askedFor(Spot, "1, M")).toBe(printSeek(variant("fields", { values: ["1"], prefix: some("M") })));
        expect(askedFor(Spot, "1,")).toBe(printSeek(variant("fields", { values: ["1"], prefix: none })));
    });
});
