/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What a sheet persists under its `storageKey` (#857), read back defensively:
 * storage outlives versions, so each part is taken only in the shape this
 * version writes.
 */

import { describe, test, expect } from "vitest";
import { NOT_PERSISTED, persistedOf, sameAnchor, sameFolds } from "./persisted.js";

describe("persistedOf", () => {
    test("takes each part in the shape this version writes", () => {
        const anchor = { key: "group:P1", offset: 12, index: 4, element: 150 };
        expect(persistedOf({ view: "paint", folds: [["P1", true], ["P1\u001f0", false]], anchor })).toEqual({
            view: "paint", folds: [["P1", true], ["P1\u001f0", false]], anchor,
        });
        expect(persistedOf({ view: null, folds: [], anchor: { ...anchor, element: null } }).anchor).toEqual({ ...anchor, element: null });
    });

    test("drops what it cannot use, part by part — never trusted into the reducer", () => {
        expect(persistedOf(undefined)).toEqual(NOT_PERSISTED);
        expect(persistedOf("folds")).toEqual(NOT_PERSISTED);
        // Folds of the wrong shape go, with the tab they were on; a good anchor stays.
        const anchor = { key: "row:j1", offset: 0, index: 0, element: null };
        expect(persistedOf({ view: "paint", folds: [["P1", "yes"]], anchor })).toEqual({ view: null, folds: [], anchor });
        expect(persistedOf({ view: 3, folds: [["P1", true]], anchor: null })).toEqual(NOT_PERSISTED);
        // An anchor of the wrong shape goes; the folds stay.
        const folds: Array<[string, boolean]> = [["P1", true]];
        for (const bad of [{ key: 1, offset: 0, index: 0, element: null }, { key: "k", offset: NaN, index: 0, element: null },
            { key: "k", offset: 0, index: -1, element: null }, { key: "k", offset: 0, index: 1.5, element: null }, { key: "k", offset: 0, index: 0, element: "7" }]) {
            expect(persistedOf({ view: null, folds, anchor: bad })).toEqual({ view: null, folds, anchor: null });
        }
    });
});

describe("sameFolds / sameAnchor", () => {
    test("the same tab and overrides in order are the same; no folds are no folds on any tab", () => {
        const p = { view: "paint", folds: [["P1", true], ["P2", false]] as Array<[string, boolean]>, anchor: null };
        expect(sameFolds(p, "paint", new Map([["P1", true], ["P2", false]]))).toBe(true);
        expect(sameFolds(p, "lathe", new Map([["P1", true], ["P2", false]]))).toBe(false);
        expect(sameFolds(p, "paint", new Map([["P1", true], ["P2", true]]))).toBe(false);
        expect(sameFolds(p, "paint", new Map([["P1", true]]))).toBe(false);
        // A sheet no one folded records no tab, whichever tab it opens on.
        expect(sameFolds(NOT_PERSISTED, "paint", new Map())).toBe(true);
        expect(sameFolds(p, "paint", new Map())).toBe(false);
    });

    test("an anchor is the same as another only field by field, and never as none", () => {
        const a = { key: "group:P1", offset: 12, index: 4, element: 150 };
        expect(sameAnchor(a, { ...a })).toBe(true);
        expect(sameAnchor(null, a)).toBe(false);
        expect(sameAnchor(a, { ...a, offset: 13 })).toBe(false);
        expect(sameAnchor(a, { ...a, element: null })).toBe(false);
    });
});
