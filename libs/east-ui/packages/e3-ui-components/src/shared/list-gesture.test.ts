/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One gesture over a short list of entries (`list-gesture.ts`, #935, #1673):
 * each entry the gesture changed, added, removed or moved, once — a change in
 * its place, an entry added or moved placed by its neighbours, one removed
 * absent after it — and none for a gesture that changes nothing.
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

/** An entry's version as the session holds it: drafted whole, where it stands. */
const held = (item: Item): EntryVersion<Ref> => ({ draft: variant("value", item), wire: { id: item.id }, place: none });
/** The versions of a list's entries, before the gesture. */
const versionsOf = (items: readonly Item[]) => (id: string): EntryVersion<Ref> => held(items.find((item) => stringEqual(item.id, id))!);
/** An entry's version after the gesture: drafted whole, placed as given. */
const after = (item: Item, place: EntryVersion<Ref>["place"]): EntryVersion<Ref> => ({ draft: variant("value", item), wire: { id: item.id }, place });
/** No version: an entry absent. */
const absent = (): EntryVersion<Ref> => ({ draft: undefined, wire: undefined, place: none });

/** Where an entry is placed: before another, after another, or at the start. */
const before = (id: string) => some(variant("ordered", variant("before", id)));
const behind = (id: string) => some(variant("ordered", variant("after", id)));
const START = some(variant("ordered", variant("start", null)));

describe("one gesture over a list (#935, #1673)", () => {
    test("an entry changed is one update, drafted whole, where it stood", () => {
        const changed = { ...b, text: "B+" };
        expect(listUpdates([a, b, c], [a, changed, c], ITEMS, versionsOf([a, b, c]))).toEqual([
            { id: "b", before: held(b), after: after(changed, none) },
        ]);
    });

    test("an entry added is placed before its next, else after its previous — into an empty list, at the start", () => {
        expect(listUpdates([a, b, c], [a, b, c, d], ITEMS, versionsOf([a, b, c]))).toEqual([{ id: "d", before: absent(), after: after(d, behind("c")) }]);
        expect(listUpdates([a, b, c], [d, a, b, c], ITEMS, versionsOf([a, b, c]))).toEqual([{ id: "d", before: absent(), after: after(d, before("a")) }]);
        expect(listUpdates([], [a], ITEMS, versionsOf([]))).toEqual([{ id: "a", before: absent(), after: after(a, START) }]);
    });

    test("an entry removed is absent after the gesture", () => {
        expect(listUpdates([a, b, c], [a, c], ITEMS, versionsOf([a, b, c]))).toEqual([{ id: "b", before: held(b), after: absent() }]);
    });

    test("an entry moved is placed among its new neighbours; the entries it passed keep their places", () => {
        expect(listUpdates([a, b, c, d], [b, c, d, a], ITEMS, versionsOf([a, b, c, d]))).toEqual([{ id: "a", before: held(a), after: after(a, behind("d")) }]);
        expect(listUpdates([a, b, c], [c, a, b], ITEMS, versionsOf([a, b, c]))).toEqual([{ id: "c", before: held(c), after: after(c, before("a")) }]);
    });

    test("several at once are one update each: those the gesture leaves in its order, then those it removed", () => {
        const changed = { ...b, text: "B+" };
        expect(listUpdates([a, b, c], [changed, d], ITEMS, versionsOf([a, b, c])).map((update) => update.id)).toEqual(["b", "d", "a", "c"]);
    });

    test("a gesture that leaves the list as it was makes none", () => {
        expect(listUpdates([a, b], [a, b], ITEMS, versionsOf([a, b]))).toEqual([]);
        expect(listUpdates([a, b], [{ ...a }, { ...b }], ITEMS, versionsOf([a, b]))).toEqual([]);
    });
});
