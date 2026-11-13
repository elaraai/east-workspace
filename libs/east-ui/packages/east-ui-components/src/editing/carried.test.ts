/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A window's carried entries as a lookup by id (`carried.ts`, #1599).
 */

import { expect, test } from "vitest";
import { editWindow, entryLookup, type CarriedEntry } from "./carried.js";

const bytes = (...values: number[]) => new Uint8Array(values);
const ENTRIES: readonly CarriedEntry[] = [{ id: "a", entry: bytes(1) }, { id: "b", entry: bytes(2, 2) }, { id: "10", entry: bytes(3) }];

test("an entry is found by its id, as the window carried it — the very bytes — and an id it carries none for answers nothing", () => {
    const lookup = entryLookup(ENTRIES);
    expect(lookup("b")).toBe(ENTRIES[1]!.entry);
    expect(lookup("10")).toBe(ENTRIES[2]!.entry);
    expect(lookup("c")).toBeUndefined();
    expect(lookup("")).toBeUndefined();
});

test("the same list gives the same lookup, and another list another: a window is asked many times, and is indexed once", () => {
    const lookup = entryLookup(ENTRIES);
    expect(entryLookup(ENTRIES)).toBe(lookup);
    const again = entryLookup([...ENTRIES]);
    expect(again).not.toBe(lookup);
    expect(again("a")).toBe(ENTRIES[0]!.entry);
});

test("a window read back is its rows and its entries by id; one that carries none answers no entry at all, so each is read on its own", () => {
    const rows = [{ key: "a" }, { key: "b" }];
    const carried = editWindow(rows, ENTRIES);
    expect(carried.rows).toBe(rows);
    expect(carried.entry?.("a")).toBe(ENTRIES[0]!.entry);
    expect(carried.entry?.("z")).toBeUndefined();
    const bare = editWindow(rows, []);
    expect(bare.rows).toBe(rows);
    expect(bare.entry).toBeUndefined();
});

test("two entries under one id: the last one carried answers, as a Dict built from them would", () => {
    const lookup = entryLookup([{ id: "a", entry: bytes(1) }, { id: "a", entry: bytes(9) }]);
    expect([...lookup("a")!]).toEqual([9]);
});
