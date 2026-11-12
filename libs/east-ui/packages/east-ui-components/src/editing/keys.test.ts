/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The rules a collection's new entries are keyed by (keys.ts), each over ids
 * — a key's text — so none depends on the key's type but the one whose rule
 * is a number's: a key made up at random, one made from another entry's — the
 * next in a row, or with a suffix drawn at random — the next Integer, a
 * placeholder for a key a person types, of any type, and any of them past the
 * keys its host shows rows under.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { DateTimeType, IntegerType, StringType, StructType, parseFor, printFor } from "@elaraai/east";
import { drawnFromKeys, madeFromKeys, nextIntegerKeys, onceKeys, pastKeys, placeholderKeys, randomKeys, type KnownKeys } from "./keys.js";

/** The keys taken, by their ids. */
const known = (...ids: string[]): KnownKeys => {
    const held = new Set(ids);
    return { has: (id) => held.has(id), ids: () => held };
};
/** `crypto.randomUUID` offering these texts in turn. */
const offering = (...texts: string[]): void => {
    const left = [...texts];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => left.shift() as ReturnType<typeof crypto.randomUUID>);
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("a key made up at random", () => {
    test("is drawn again while it is taken", () => {
        offering("a", "b", "c");
        expect(randomKeys().make(known("a", "b"), undefined, undefined)).toBe("c");
    });

    test("is a version 4 UUID on a page with no `crypto.randomUUID`, one served over plain HTTP", () => {
        vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => { bytes.fill(0xff); return bytes; } });
        expect(randomKeys().make(known(), undefined, undefined)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    });
});

describe("a key made from another's", () => {
    const keys = madeFromKeys(randomKeys());

    test("is the other's with -2, then -3, the first not taken — whatever else is", () => {
        expect(keys.make(known("brackets"), "brackets", undefined)).toBe("brackets-2");
        expect(keys.make(known("brackets", "brackets-2", "brackets-4"), "brackets", undefined)).toBe("brackets-3");
    });

    test("made again for a key another took is the next from the same one", () => {
        expect(keys.make(known("brackets-2"), "brackets", "brackets-2")).toBe("brackets-3");
    });

    test("made from none is the other policy's", () => {
        offering("made-up");
        expect(keys.make(known(), undefined, undefined)).toBe("made-up");
    });
});

describe("a key made from another's, its suffix drawn at random", () => {
    const keys = drawnFromKeys(randomKeys());

    test("is the other's with eight hex digits of a UUID, drawn again while it is taken — whatever the source holds out of view, never the next in a row", () => {
        offering("aaaaaaaa-0000-4000-8000-000000000000", "bbbbbbbb-1111-4000-8000-000000000000");
        expect(keys.make(known("brackets", "brackets-2", "brackets-aaaaaaaa"), "brackets", undefined)).toBe("brackets-bbbbbbbb");
    });

    test("made again for a key another took is drawn afresh, and made from none is the other policy's", () => {
        offering("cccccccc-0000-4000-8000-000000000000", "made-up");
        expect(keys.make(known("brackets-bbbbbbbb"), "brackets", "brackets-bbbbbbbb")).toBe("brackets-cccccccc");
        expect(keys.make(known(), undefined, undefined)).toBe("made-up");
    });
});

describe("the next Integer key", () => {
    const id = printFor(IntegerType);

    test("is one past the largest key taken, texts that are no Integer left aside; 1 for a source holding none", () => {
        expect(nextIntegerKeys().make(known(id(3n), id(11n), "not a number", id(7n)), undefined, undefined)).toBe(id(12n));
        expect(nextIntegerKeys().make(known(), undefined, undefined)).toBe(id(1n));
    });

    test("is past the largest key its host has read of a source the session does not hold whole", () => {
        expect(nextIntegerKeys(() => ({ key: 40n })).make(known(id(3n)), undefined, undefined)).toBe(id(41n));
        expect(nextIntegerKeys(() => ({ key: undefined })).make(known(id(3n)), undefined, undefined)).toBe(id(4n));
    });

    test("waits while the source's largest key is still being read — but another for a key known taken is made past what is known, a carry-over waiting for no read", () => {
        const reading = nextIntegerKeys(() => undefined);
        expect(reading.make(known(id(3n)), undefined, undefined)).toBeUndefined();
        expect(reading.make(known(id(41n)), undefined, id(41n))).toBe(id(42n));
    });
});

describe("a rule that makes each key once", () => {
    test("makes a new entry's key as its rule does, and no other for one whose key another took: the two stay a conflict", () => {
        const keys = onceKeys(madeFromKeys(randomKeys()));
        expect(keys.make(known("brackets"), "brackets", undefined)).toBe("brackets-2");
        expect(keys.make(known("brackets-2"), "brackets", "brackets-2")).toBeUndefined();
    });
});

describe("a placeholder for a key a person types", () => {
    test("is a text no key of the type prints as, whatever the type: an Integer's, a date's, a struct's", () => {
        const Rack = StructType({ aisle: StringType, bay: IntegerType });
        const rack = printFor(Rack)({ aisle: "A", bay: 4n });
        const day = printFor(DateTimeType)(new Date(Date.UTC(2026, 10, 12)));
        for (const [type, key] of [[IntegerType, "42"], [DateTimeType, day], [Rack, rack]] as const) {
            const parse = parseFor(type);
            // A text that prints as a key of the type is passed over, and so is one taken.
            offering(key, "held", "free");
            expect(placeholderKeys((text) => parse(text).success).make(known("held"), undefined, undefined)).toBe("free");
        }
    });
});

describe("a rule's keys, past those its host shows rows under", () => {
    const id = printFor(IntegerType);
    /** The keys the host shows rows under: read of a source its session does not hold whole. */
    const shown = new Set(["brackets-2", id(8n)]);
    const shows = (key: string): boolean => shown.has(key);

    test("pass over a key the host shows a row under as over one known taken: the next in a row, and the next Integer past a largest key read before that row was saved", () => {
        expect(pastKeys(madeFromKeys(randomKeys()), shows).make(known("brackets"), "brackets", undefined)).toBe("brackets-3");
        expect(pastKeys(nextIntegerKeys(() => ({ key: 7n })), shows).make(known(), undefined, undefined)).toBe(id(9n));
    });

    test("are its rule's own where the host shows no row under them, and made again past them where another took one", () => {
        expect(pastKeys(madeFromKeys(randomKeys()), shows).make(known("lathe"), "lathe", undefined)).toBe("lathe-2");
        expect(pastKeys(madeFromKeys(randomKeys()), shows).make(known("brackets-3"), "brackets", "brackets-3")).toBe("brackets-4");
    });
});
