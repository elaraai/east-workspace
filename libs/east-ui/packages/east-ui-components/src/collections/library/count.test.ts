/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A Library tab's count while a builder's rail may narrow it (#1339, #1341):
 * over resident cards, and over a paged record from its record Slice's exact
 * counts — none while one it needs is read.
 */
import { describe, expect, test } from "vitest";
import { StringType, none, printFor, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import type { RecordSliceChoiceType } from "@elaraai/east-ui/internal";
import { formatters } from "../../format/index.js";
import { narrowedCount, pagedCount, type PagedCountSource } from "./count.js";

type Choice = ValueTypeOf<RecordSliceChoiceType>;
const words = formatters("en-US");
/** A record Slice's reads: its narrowing, and its exact counts; given its page's scope, a read carries it (#1621). */
function slice(where: ReadonlyMap<string, Choice>, count: option<bigint>, total: option<bigint>, scope: ReadonlyMap<string, Choice> = new Map()): PagedCountSource {
    return { config: { scope }, read: () => ({ where }), count: () => count, total: () => total };
}
const NARROWED: ReadonlyMap<string, Choice> = new Map([["status", variant("values", [printFor(StringType)("open")])]]);
/** A page for one press: its scope, which a read of it carries. */
const SCOPE: ReadonlyMap<string, Choice> = new Map([["press", variant("values", [printFor(StringType)("P-1")])]]);

describe("a tab's count over resident cards", () => {
    test("`10 of 33` while a narrowing is in force, else the count alone for the pane to format", () => {
        expect(narrowedCount(words, 10, 33, true)).toBe("10 of 33");
        expect(narrowedCount(words, 0, 2048, true)).toBe("0 of 2,048");
        expect(narrowedCount(words, 33, 33, false)).toBe(33);
    });
});

describe("a paged tab's count over a record Slice (#1341)", () => {
    test("`40 of 2,048` while a choice narrows it, from its exact narrowed count and the record's total", () => {
        expect(pagedCount(words, slice(NARROWED, some(40n), some(2048n)))).toBe("40 of 2,048");
    });

    test("with no choice, the record's total alone, its narrowed count unread", () => {
        const source = slice(new Map(), none, some(2048n));
        expect(pagedCount(words, { ...source, count: () => { throw new Error("read the narrowed count"); } })).toBe(2048);
    });

    test("on a scoped page the scope is no choice (#1621): the rows the scope holds alone, its narrowed count unread; a choice beside it, `5 of 12`", () => {
        const scoped = slice(SCOPE, none, some(12n), SCOPE);
        expect(pagedCount(words, { ...scoped, count: () => { throw new Error("read the narrowed count"); } })).toBe(12);
        expect(pagedCount(words, slice(new Map([...SCOPE, ...NARROWED]), some(5n), some(12n), SCOPE))).toBe("5 of 12");
    });

    test("none while a count it needs is read", () => {
        expect(pagedCount(words, slice(NARROWED, none, some(2048n)))).toBeUndefined();
        expect(pagedCount(words, slice(new Map(), none, none))).toBeUndefined();
    });
});
