/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A new row's key, as its kind makes one (#1549, east-workspace#1709): the
 * one rule the Flowchart's kinds and the Schematic's follow, over kinds keyed
 * by String, Integer, DateTime — which the form types — and Blob, which it
 * does not.
 */

import { describe, expect, test, vi } from "vitest";
import { BlobType, DateTimeType, IntegerType, StringType, none, printFor, some, toEastTypeValue, type EastTypeValue } from "@elaraai/east";
import type { ScheduleChange, ScheduleKeyRefusal } from "./editing.js";
import { newRowKey, newRowKeyRule, type NewRowKeyArgs, type NewRowKeyKind } from "./new-row-key.js";

const STRING = toEastTypeValue(StringType), INTEGER = toEastTypeValue(IntegerType), DATE = toEastTypeValue(DateTimeType), BLOB = toEastTypeValue(BlobType);

/** A kind of racks keyed by a type, the app's rule given or not. */
const racks = (keyType: EastTypeValue, ruled = false): NewRowKeyKind => ({ name: "Rack", keyType, newKey: ruled ? some(null) : none });

/** A new rack's row, and the change making it. */
const ROW = new Uint8Array([7]);
const MADE: ScheduleChange = { kind: "racks", id: "", row: ROW, created: true };

/** The shared editing as a session that makes `key`, or says `why` it made none. */
const session = (key: string | undefined, why?: ScheduleKeyRefusal["why"]): NewRowKeyArgs["editing"] => ({
    mint: () => key,
    keyRefusal: () => (why === undefined ? undefined : { kind: "racks", name: "Rack", id: "", why }),
});

/** A new rack's key, over a builder holding `taken` and drawing rows under `stands`. */
function keyed(kind: NewRowKeyKind, over: Partial<NewRowKeyArgs> & { readonly held?: readonly string[] } = {}) {
    const held = new Set(over.held ?? []);
    return newRowKey({
        builder: "Schematic", kind, slot: "racks", build: undefined, editing: session(undefined), made: () => MADE, minted: new Set(),
        taken: (key) => held.has(key), stands: (key) => held.has(key),
        // The first text not held, of a key East prints and one it does not.
        madeUp: (isHeld) => ["A-1", "A-2", printFor(DateTimeType)(new Date(0)), "placeholder"].find((text) => !isHeld(text))!,
        ...over,
    });
}

describe("how a kind keys the rows it adds (#1549, east-workspace#1709)", () => {
    test("ruling 1 — a kind's `key` builds it; else the app's `newKey`, or one past the largest Integer, is its session's; else a text, a placeholder, or none by its key type", () => {
        expect([STRING, INTEGER, DATE, BLOB].map((type) => newRowKeyRule(racks(type), true))).toEqual(["built", "built", "built", "built"]);
        expect([STRING, INTEGER, DATE, BLOB].map((type) => newRowKeyRule(racks(type, true), false))).toEqual(["session", "session", "session", "session"]);
        expect([STRING, INTEGER, DATE, BLOB].map((type) => newRowKeyRule(racks(type), false))).toEqual(["text", "session", "placeholder", "none"]);
    });

    test("ruling 1 — built from the row the edit makes: refused where a row stands under it or the gesture made it already, and where building it fails", () => {
        const build = (row: Uint8Array): string => `R-${row[0]}`;
        expect(keyed(racks(STRING), { build })).toEqual({ key: "R-7" });
        expect(keyed(racks(STRING), { build, held: ["R-7"] })).toEqual({ taken: "R-7" });
        expect(keyed(racks(STRING), { build, minted: new Set(["R-7"]) })).toEqual({ taken: "R-7" });
        // An edit its kind makes no row of keys nothing.
        expect(keyed(racks(STRING), { build, made: () => undefined })).toBeUndefined();
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            expect(keyed(racks(STRING), { build: () => { throw new Error("no code"); } })).toEqual({ failed: true });
            expect(logged.mock.calls[0]?.[0]).toBe("[Schematic] Rack's key could not be built from a new row:");
        } finally {
            logged.mockRestore();
        }
    });

    test("ruling 1 — its session's to make: the key it makes; where the app's rule gives a key a row holds, that key; where it fails, none can be made; and nothing while its largest is read", () => {
        expect(keyed(racks(INTEGER, true), { editing: session("200") })).toEqual({ key: "200" });
        expect(keyed(racks(INTEGER, true), { editing: session(undefined, { taken: "11" }) })).toEqual({ taken: "11" });
        expect(keyed(racks(INTEGER, true), { editing: session(undefined, { failed: new Error("none left") }) })).toEqual({ failed: true });
        expect(keyed(racks(INTEGER), { editing: session(undefined) })).toBeUndefined();
    });

    test("keyed by String, the text the builder makes up, past every key held and made; by a type the form types, a placeholder no key prints as; by any other, none (#1549)", () => {
        expect(keyed(racks(STRING), { held: ["A-1"] })).toEqual({ key: "A-2" });
        expect(keyed(racks(STRING), { held: ["A-1"], minted: new Set(["A-2"]) })).toEqual({ key: printFor(DateTimeType)(new Date(0)) });
        // Every text is a String key; none but a date's printing is a DateTime's, which a placeholder is never.
        expect(keyed(racks(DATE), { held: ["A-1"] })).toEqual({ key: "A-2" });
        expect(keyed(racks(DATE), { held: ["A-1", "A-2"] })).toEqual({ key: "placeholder" });
        expect(keyed(racks(BLOB))).toEqual({ untyped: "Blob" });
    });
});
