/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One gesture over a short list of entries (`list-gesture.ts`, #935, #1673):
 * each entry the gesture changed, added, removed or moved, once — a change in
 * its place, an entry added or moved placed after the entry before it, else at
 * the start, one removed absent after it — and none for a gesture that changes
 * nothing. An entry the session placed before is placed again where its
 * placement no longer says where the gesture leaves it: beside an entry the
 * gesture removes or moves.
 */

import { describe, expect, test } from "vitest";
import { StringType, StructType, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { EntryVersion } from "@elaraai/east-ui-components";
import { listUpdates, type ListEntries } from "./list-gesture.js";

/** An entry of the list: its id, and what it says. */
const Item = StructType({ id: StringType, text: StringType });
type Item = ValueTypeOf<typeof Item>;
/** The collection's projection of an entry: its id. */
type Ref = { readonly id: string };

const stringEqual = equalFor(StringType);
const ITEMS: ListEntries<Item, Ref> = { idOf: (item) => item.id, same: equalFor(Item), wireOf: (item) => ({ id: item.id }) };

const a: Item = { id: "a", text: "A" };
const b: Item = { id: "b", text: "B" };
const c: Item = { id: "c", text: "C" };
const d: Item = { id: "d", text: "D" };

/** An entry's version as its source saved it: drafted whole, placed by its source's order. */
const held = (item: Item): EntryVersion<Ref> => ({ draft: variant("value", item), wire: { id: item.id }, place: none });
/** The versions of a list's entries as their source saved them, before any draft. */
const versionsOf = (items: readonly Item[]) => (id: string): EntryVersion<Ref> => held(items.find((item) => stringEqual(item.id, id))!);
/** An entry's version drafted whole, placed as given: after the gesture, or as the session holds it. */
const after = (item: Item, place: EntryVersion<Ref>["place"]): EntryVersion<Ref> => ({ draft: variant("value", item), wire: { id: item.id }, place });
/** No version: an entry absent. */
const absent = (): EntryVersion<Ref> => ({ draft: undefined, wire: undefined, place: none });
/** A session that holds none of the entries: each as its source saved it. */
const NONE_HELD = (): EntryVersion<Ref> | undefined => undefined;
/** A session that holds some entries, each where it placed it. */
const heldIn = (...placed: readonly (readonly [Item, EntryVersion<Ref>["place"]])[]) => (id: string): EntryVersion<Ref> | undefined => {
    const found = placed.find(([item]) => stringEqual(item.id, id));
    return found === undefined ? undefined : after(found[0], found[1]);
};

/** Where an entry is placed: before another, after another, or at the start. */
const before = (id: string) => some(variant("ordered", variant("before", id)));
const behind = (id: string) => some(variant("ordered", variant("after", id)));
const START = some(variant("ordered", variant("start", null)));

describe("one gesture over a list (#935, #1673)", () => {
    test("an entry changed is one update, drafted whole, where it stood", () => {
        const changed = { ...b, text: "B+" };
        expect(listUpdates([a, b, c], [a, changed, c], ITEMS, NONE_HELD, versionsOf([a, b, c]))).toEqual([
            { id: "b", before: held(b), after: after(changed, none) },
        ]);
    });

    test("an entry added is placed after the entry before it — at the start where it comes first, and into an empty list", () => {
        expect(listUpdates([a, b, c], [a, b, c, d], ITEMS, NONE_HELD, versionsOf([a, b, c]))).toEqual([{ id: "d", before: absent(), after: after(d, behind("c")) }]);
        expect(listUpdates([a, b, c], [d, a, b, c], ITEMS, NONE_HELD, versionsOf([a, b, c]))).toEqual([{ id: "d", before: absent(), after: after(d, START) }]);
        expect(listUpdates([], [a], ITEMS, NONE_HELD, versionsOf([]))).toEqual([{ id: "a", before: absent(), after: after(a, START) }]);
    });

    test("two added at once: each after the one before it, so neither stands on the other", () => {
        expect(listUpdates([a], [a, b, c], ITEMS, NONE_HELD, versionsOf([a]))).toEqual([
            { id: "b", before: absent(), after: after(b, behind("a")) },
            { id: "c", before: absent(), after: after(c, behind("b")) },
        ]);
    });

    test("an entry removed is absent after the gesture", () => {
        expect(listUpdates([a, b, c], [a, c], ITEMS, NONE_HELD, versionsOf([a, b, c]))).toEqual([{ id: "b", before: held(b), after: absent() }]);
    });

    test("an entry moved is placed after the entry before it among its new neighbours; the entries it passed keep their places", () => {
        expect(listUpdates([a, b, c, d], [b, c, d, a], ITEMS, NONE_HELD, versionsOf([a, b, c, d]))).toEqual([{ id: "a", before: held(a), after: after(a, behind("d")) }]);
        expect(listUpdates([a, b, c], [c, a, b], ITEMS, NONE_HELD, versionsOf([a, b, c]))).toEqual([{ id: "c", before: held(c), after: after(c, START) }]);
    });

    test("several at once are one update each: those the gesture leaves in its order, then those it removed", () => {
        const changed = { ...b, text: "B+" };
        expect(listUpdates([a, b, c], [changed, d], ITEMS, NONE_HELD, versionsOf([a, b, c])).map((update) => update.id)).toEqual(["b", "d", "a", "c"]);
    });

    test("a gesture that leaves the list as it was makes none", () => {
        expect(listUpdates([a, b], [a, b], ITEMS, NONE_HELD, versionsOf([a, b]))).toEqual([]);
        expect(listUpdates([a, b], [{ ...a }, { ...b }], ITEMS, NONE_HELD, versionsOf([a, b]))).toEqual([]);
    });
});

describe("an entry the session placed, beside one a gesture removes or moves (#1673)", () => {
    test("two entries added one after the other, the first taken out: the second is placed again — at the start — so Apply can place it", () => {
        // Each added after the one before it: the second stands after the first.
        const session = heldIn([a, START], [b, behind("a")]);
        expect(listUpdates([a, b], [b], ITEMS, session, versionsOf([]))).toEqual([
            { id: "b", before: after(b, behind("a")), after: after(b, START) },
            { id: "a", before: after(a, START), after: absent() },
        ]);
    });

    test("one taken out of the middle of three: the one after it is placed after the one before it; the first stays", () => {
        const session = heldIn([a, START], [b, behind("a")], [c, behind("b")]);
        expect(listUpdates([a, b, c], [a, c], ITEMS, session, versionsOf([]))).toEqual([
            { id: "c", before: after(c, behind("b")), after: after(c, behind("a")) },
            { id: "b", before: after(b, behind("a")), after: absent() },
        ]);
    });

    test("a saved entry the session drafted, placed before its next, is placed again when its next is taken out", () => {
        const changed = { ...b, text: "B+" };
        const session = heldIn([changed, before("c")]);
        expect(listUpdates([a, changed, c], [a, changed], ITEMS, session, versionsOf([a, b, c]))).toEqual([
            { id: "b", before: after(changed, before("c")), after: after(changed, behind("a")) },
            { id: "c", before: held(c), after: absent() },
        ]);
    });

    test("the entry it stood after moved past it: it is placed again where the gesture leaves it, so the two never stand on each other", () => {
        const session = heldIn([a, START], [b, behind("a")]);
        expect(listUpdates([a, b], [b, a], ITEMS, session, versionsOf([]))).toEqual([
            { id: "b", before: after(b, behind("a")), after: after(b, START) },
            { id: "a", before: after(a, START), after: after(a, behind("b")) },
        ]);
    });

    test("standing where its placement says, it is left as it is", () => {
        const session = heldIn([a, START], [b, behind("a")]);
        expect(listUpdates([a, b], [a, b, c], ITEMS, session, versionsOf([]))).toEqual([{ id: "c", before: absent(), after: after(c, behind("b")) }]);
    });
});
