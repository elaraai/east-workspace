/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's drafted rows as a builder draws them (`drafted-rows.ts`,
 * #1599): whether a draft adds its row is read from its session's original —
 * which moves under an unchanged draft as another session removes the row, or
 * as its own Save lands — each row is read once for its version and its
 * original, and a kind's rows are the same map while no row moves. And the
 * one rule of which drafted rows a builder draws (`DraftedStanding`): a row
 * its read holds, one its draft adds, one its narrowing holds — and, through
 * a carry-over, one it last drew.
 */
import { describe, expect, test } from "vitest";
import { FloatType, IntegerType, StringType, StructType, decodeBeast2For, none, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import type { EntryVersion } from "@elaraai/east-ui-components";
import { DraftedStanding, draftedRowsOf, type DraftedRow, type DraftedRowsCache, type DraftedRowsKind, type DraftedRowsSession } from "./drafted-rows.js";
import type { ScheduleEntryRef } from "./editing.js";

/** A bench of a joinery shop: where it stands along the wall. */
const BenchType = StructType({ label: StringType, x: FloatType });
type Bench = ValueTypeOf<typeof BenchType>;
const decodeBench = decodeBeast2For(BenchType);

/** What a bench draws from: its row, and the key it was read under. */
interface BenchRoles { readonly key: string; readonly label: string; readonly x: number }

/** The benches' kind, and how often its `read` ran. */
function benches(keyType = toEastTypeValue(StringType)): { kind: DraftedRowsKind<BenchRoles>; reads: () => number } {
    let reads = 0;
    return {
        kind: {
            key: "benches", rowType: toEastTypeValue(BenchType), keyType,
            read: (bytes, key) => { reads += 1; const row = decodeBench(bytes); return { key, label: row.label, x: row.x }; },
        },
        reads: () => reads,
    };
}

/** A version of a bench as a session holds it: its row, or none for one removed. */
function version(id: string, row: Bench | undefined): EntryVersion<ScheduleEntryRef> {
    return row === undefined ? { draft: undefined, wire: undefined, place: none } : { draft: variant("value", row), wire: { id }, place: none };
}

/** A session over the versions given: each entry's draft, the original beside it, and whether it is carrying its drafts over. */
function session(entries: Record<string, EntryVersion<ScheduleEntryRef>>, originals: Record<string, EntryVersion<ScheduleEntryRef>>, carrying = false): DraftedRowsSession {
    return { entries: new Map(Object.entries(entries)), originals: new Map(Object.entries(originals)), carrying };
}

const cache = (): DraftedRowsCache => new WeakMap();

test("a row changed here began as the row its record holds; one a gesture created is added; one its draft removes is none", () => {
    const { kind } = benches();
    const rows = draftedRowsOf(kind, ["B1", "B2", "B3", "B4"], session(
        { B1: version("B1", { label: "Planing", x: 4 }), B2: version("B2", { label: "Sanding", x: 9 }), B3: version("B3", undefined) },
        { B1: version("B1", { label: "Planing", x: 1 }), B3: version("B3", { label: "Glue-up", x: 6 }) },
    ), cache());
    expect([...rows]).toEqual([
        ["B1", { roles: { key: "B1", label: "Planing", x: 4 }, created: false, began: { key: "B1", label: "Planing", x: 1 }, carrying: false }],
        ["B2", { roles: { key: "B2", label: "Sanding", x: 9 }, created: true, began: undefined, carrying: false }],
        ["B3", undefined],
        // A key its session holds no version of: nothing to draw.
        ["B4", undefined],
    ]);
});

test("a row changed here that another session removes is one its draft adds: its original moved to none under the same draft's bytes", () => {
    const { kind } = benches();
    const kept = cache();
    const drafted = version("B1", { label: "Planing", x: 4 });
    const before = draftedRowsOf(kind, ["B1"], session({ B1: drafted }, { B1: version("B1", { label: "Planing", x: 1 }) }), kept);
    expect(before.get("B1")).toMatchObject({ created: false, began: { x: 1 } });
    // Carried over to a record that holds the row no more: the draft stands, a conflict to choose, its original absent.
    const carried = version("B1", { label: "Planing", x: 4 });
    const after = draftedRowsOf(kind, ["B1"], session({ B1: carried }, { B1: version("B1", undefined) }), kept, before);
    expect(after.get("B1")).toEqual({ roles: { key: "B1", label: "Planing", x: 4 }, created: true, began: undefined, carrying: false });
    expect(Object.is(after, before)).toBe(false);
});

test("the original moving under the very version a session holds reads the row again — never what the version was first read beside", () => {
    const { kind } = benches();
    const kept = cache();
    const drafted = version("B1", { label: "Planing", x: 4 });
    const before = draftedRowsOf(kind, ["B1"], session({ B1: drafted }, { B1: version("B1", { label: "Planing", x: 1 }) }), kept);
    const after = draftedRowsOf(kind, ["B1"], session({ B1: drafted }, {}), kept, before);
    expect([before.get("B1")!.created, after.get("B1")!.created]).toEqual([false, true]);
});

test("a row a gesture created, saved and drafted again since, began as the row its Save left", () => {
    const { kind } = benches();
    const kept = cache();
    const drafted = version("B2", { label: "Sanding", x: 9 });
    const before = draftedRowsOf(kind, ["B2"], session({ B2: drafted }, {}), kept);
    expect(before.get("B2")).toMatchObject({ created: true });
    // Its Save landed while it was drafted again: what the Save left is its original.
    const after = draftedRowsOf(kind, ["B2"], session({ B2: drafted }, { B2: version("B2", { label: "Sanding", x: 7 }) }), kept, before);
    expect(after.get("B2")).toEqual({ roles: { key: "B2", label: "Sanding", x: 9 }, created: false, began: { key: "B2", label: "Sanding", x: 7 }, carrying: false });
});

test("a row is read once for its version and its original, and its kind's rows are the same map while no row moves", () => {
    const { kind, reads } = benches();
    const kept = cache();
    const held = session(
        { B1: version("B1", { label: "Planing", x: 4 }), B2: version("B2", { label: "Sanding", x: 9 }) },
        { B1: version("B1", { label: "Planing", x: 1 }) },
    );
    const first = draftedRowsOf(kind, ["B1", "B2"], held, kept);
    // B1's draft and its original, B2's draft.
    expect(reads()).toBe(3);
    const again = draftedRowsOf(kind, ["B1", "B2"], held, kept, first);
    expect([reads(), Object.is(again, first)]).toEqual([3, true]);
    // One row moves: the others are the objects they were, and the map is a new one.
    const moved = { entries: new Map([...held.entries, ["B2", version("B2", { label: "Sanding", x: 10 })]]), originals: held.originals, carrying: false };
    const next = draftedRowsOf(kind, ["B1", "B2"], moved, kept, first);
    expect([reads(), Object.is(next, first), Object.is(next.get("B1"), first.get("B1")), next.get("B2")!.roles.x]).toEqual([4, false, true, 10]);
    // A draft gone: its kind's rows are another map, the rows left the same objects.
    const fewer = draftedRowsOf(kind, ["B1"], moved, kept, next);
    expect([reads(), Object.is(fewer, next), Object.is(fewer.get("B1"), first.get("B1"))]).toEqual([4, false, true]);
});

test("a kind with no session reads every drafted row as none", () => {
    const { kind, reads } = benches();
    expect([[...draftedRowsOf(kind, ["B1"], undefined, cache())], reads()]).toEqual([[["B1", undefined]], 0]);
});

test("a new row under a placeholder — a text no key prints as — is read as keyed by its key type's default", () => {
    const { kind } = benches(toEastTypeValue(IntegerType));
    const rows = draftedRowsOf(kind, ["12", "still-to-type"], session(
        { "12": version("12", { label: "Planing", x: 4 }), "still-to-type": version("still-to-type", { label: "Sanding", x: 9 }) }, {},
    ), cache());
    expect([rows.get("12")!.roles.key, rows.get("still-to-type")!.roles.key]).toEqual(["12", "0"]);
});

test("a session carrying its drafts over says so of each row — the row's roles the same object, read no second time — and no more once it has judged them", () => {
    const { kind, reads } = benches();
    const kept = cache();
    const entries = { B1: version("B1", { label: "Planing", x: 4 }) };
    const originals = { B1: version("B1", { label: "Planing", x: 1 }) };
    const before = draftedRowsOf(kind, ["B1"], session(entries, originals), kept);
    const during = draftedRowsOf(kind, ["B1"], session(entries, originals, true), kept, before);
    const still = draftedRowsOf(kind, ["B1"], session(entries, originals, true), kept, during);
    const after = draftedRowsOf(kind, ["B1"], session(entries, originals), kept, still);
    expect([before.get("B1")!.carrying, during.get("B1")!.carrying, after.get("B1")!.carrying]).toEqual([false, true, false]);
    expect([Object.is(during, before), Object.is(still, during), Object.is(after, still)]).toEqual([false, true, false]);
    expect([Object.is(during.get("B1")!.roles, before.get("B1")!.roles), Object.is(after.get("B1")!.roles, before.get("B1")!.roles), reads()]).toEqual([true, true, 2]);
});

describe("which drafted rows a builder draws (DraftedStanding)", () => {
    /** A drafted bench: one its record holds, as its session knows, unless its draft adds it; its session carrying its drafts over or not. */
    const bench = (created: boolean, carrying: boolean): DraftedRow<BenchRoles> => ({ roles: { key: "B1", label: "Planing", x: 4 }, created, carrying });
    /** A drawing that drew the benches given. */
    const drawing = (...keys: string[]) => new Map([["benches", new Set(keys)]]);

    test("a row its read holds, and one its draft adds, are drawn; any other the read holds none of waits in its session", () => {
        const standing = new DraftedStanding();
        expect([
            standing.stands("benches", "B1", bench(false, false), true),
            standing.stands("benches", "B1", bench(true, false), false),
            standing.stands("benches", "B1", bench(false, false), false),
        ]).toEqual([true, true, false]);
    });

    test("a builder that asks its narrowing of the row itself draws one the narrowing holds, and no other", () => {
        const standing = new DraftedStanding();
        expect([
            standing.stands("benches", "B1", bench(false, false), false, () => true),
            standing.stands("benches", "B1", bench(false, false), false, () => false),
        ]).toEqual([true, false]);
    });

    test("through a carry-over a row the builder last drew stands, though no read holds it and its draft is not yet one that adds it", () => {
        const standing = new DraftedStanding();
        // Drawn while the read held it.
        standing.drew(drawing("B1"));
        // Its record read again without it, its session yet to read it by its key.
        expect(standing.stands("benches", "B1", bench(false, true), false)).toBe(true);
        // Judged: its record holds it, as its session knows, and no read does — a narrowing hides it.
        expect(standing.stands("benches", "B1", bench(false, false), false)).toBe(false);
    });

    test("a row that waited — a narrowing hiding it — waits through a carry-over too: what was not drawn is not drawn by it", () => {
        const standing = new DraftedStanding();
        standing.drew(drawing());
        expect(standing.stands("benches", "B1", bench(false, true), false)).toBe(false);
        // Nor one of another kind's, drawn under the same key.
        standing.drew(new Map([["jigs", new Set(["B1"])]]));
        expect(standing.stands("benches", "B1", bench(false, true), false)).toBe(false);
    });

    test("each drawing is remembered in place of the last: a row a drawing left out stands by nothing at the next carry-over", () => {
        const standing = new DraftedStanding();
        standing.drew(drawing("B1", "B2"));
        expect([standing.stood("benches", "B1"), standing.stood("benches", "B2")]).toEqual([true, true]);
        standing.drew(drawing("B2"));
        expect([standing.stood("benches", "B1"), standing.stands("benches", "B1", bench(false, true), false)]).toEqual([false, false]);
        expect(standing.stands("benches", "B2", bench(false, true), false)).toBe(true);
    });

    test("asking changes nothing: the rule answers the same however often it is asked between two drawings", () => {
        const standing = new DraftedStanding();
        standing.drew(drawing("B1"));
        const asked = [1, 2, 3].map(() => [standing.stands("benches", "B1", bench(false, false), false), standing.stands("benches", "B1", bench(false, true), false)]);
        expect(asked).toEqual([[false, true], [false, true], [false, true]]);
    });
});
