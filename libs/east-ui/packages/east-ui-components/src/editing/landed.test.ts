/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * When rows are from before a Save (landed.ts): read at another revision than
 * the one their source reads at now, whichever revision the Save was drafted
 * at — the same entry saved twice, a source another session wrote to first —
 * or their source still at the revision the Save was drafted at, or naming
 * none; and never rows read at the revision the source reads at now once it
 * has moved on from there. A host that knows of its rows only whether they stand
 * from before the revision their source reads at now asks the same rule by that
 * (`standingBeforeSave`), and the two never disagree.
 */

import { describe, expect, test } from "vitest";
import { readBeforeSave, readBeforeSaves, standingBeforeSave } from "./landed.js";

describe("readBeforeSave", () => {
    test("rows read at another revision than the one their source reads at now are from before the Save: their read again is in flight", () => {
        // Drafted at r0, committed r1: the rows stand as read at r0.
        expect(readBeforeSave("r0", "r1", "r0")).toBe(true);
    });

    test("whichever revision the Save was drafted at: the same entry saved twice before its rows are read again", () => {
        // The second Save was drafted at r1, the first's commit, and committed r2: the rows still as read at r0, before both.
        expect(readBeforeSave("r0", "r2", "r1")).toBe(true);
        // Read between them, they are from before the second.
        expect(readBeforeSave("r1", "r2", "r1")).toBe(true);
    });

    test("and rows standing from before another session's write that the Save was drafted over", () => {
        // Another session committed r1 over r0; the Save, drafted at r1, committed r2: the rows as read at r0.
        expect(readBeforeSave("r0", "r2", "r1")).toBe(true);
    });

    test("rows read at the revision their source reads at now hold the Save: the one it committed, or any after", () => {
        expect(readBeforeSave("r1", "r1", "r0")).toBe(false);
        expect(readBeforeSave("r2", "r2", "r0")).toBe(false);
    });

    test("while their source still reads at the revision the Save was drafted at — its move to the commit not heard yet — rows read there are from before it", () => {
        expect(readBeforeSave("r0", "r0", "r0")).toBe(true);
    });

    test("a source that names no revision now holds nothing read since", () => {
        expect(readBeforeSave("r0", undefined, "r0")).toBe(true);
    });

    test("a Save that left the content as an earlier revision named it is held by rows read there: a revision names its content", () => {
        // Drafted at r1, the Save undid what made it: the source reads at r0 again, and rows read at r0 are what it left.
        expect(readBeforeSave("r0", "r0", "r1")).toBe(false);
    });
});

describe("readBeforeSaves", () => {
    test("rows are from before several Saves while they are from before any one of them", () => {
        expect(readBeforeSaves("r0", "r2", ["r0", "r1"])).toBe(true);
        // The source still at the revision the second was drafted at.
        expect(readBeforeSaves("r1", "r1", ["r0", "r1"])).toBe(true);
        expect(readBeforeSaves("r2", "r2", ["r0", "r1"])).toBe(false);
    });

    test("of no Save, rows are from before none", () => {
        expect(readBeforeSaves("r0", "r1", [])).toBe(false);
        expect(readBeforeSaves("r0", undefined, new Set<string>())).toBe(false);
    });
});

describe("standingBeforeSave", () => {
    test("rows standing from before the revision their source reads at now are from before the Save, whichever revision it was drafted at", () => {
        expect(standingBeforeSave(true, "r2", "r1")).toBe(true);
        expect(standingBeforeSave(true, "r2", "r0")).toBe(true);
    });

    test("rows read at the revision the source reads at now hold the Save, once the source has moved on from the revision it was drafted at", () => {
        expect(standingBeforeSave(false, "r2", "r1")).toBe(false);
    });

    test("a source still at the revision the Save was drafted at, or naming none, holds nothing of it", () => {
        expect(standingBeforeSave(false, "r1", "r1")).toBe(true);
        expect(standingBeforeSave(false, undefined, "r1")).toBe(true);
    });

    test("it is the rule a host that knows its rows' revision asks: the two agree over every case", () => {
        const revisions = ["r0", "r1", "r2"];
        for (const read of revisions) for (const now of [...revisions, undefined]) for (const from of revisions) {
            const standing = now === undefined || read !== now;
            expect(standingBeforeSave(standing, now, from), `read ${read}, now ${now}, from ${from}`).toBe(readBeforeSave(read, now, from));
        }
    });
});

describe("an entry held from no revision: read as its drafts were carried over at the revision its session was at already", () => {
    test("only rows read at another revision than the one their source reads at now are from before it", () => {
        expect(readBeforeSave("r1", "r2", undefined)).toBe(true);
        expect(readBeforeSave("r2", "r2", undefined)).toBe(false);
        expect([standingBeforeSave(true, "r2", undefined), standingBeforeSave(false, "r2", undefined)]).toEqual([true, false]);
    });

    test("a source naming no revision holds nothing of it, as of any", () => {
        expect([readBeforeSave("r1", undefined, undefined), standingBeforeSave(false, undefined, undefined)]).toEqual([true, true]);
    });

    test("among several, it is from before rows read at another revision, and says nothing of rows read at the one now", () => {
        expect(readBeforeSaves("r1", "r2", [undefined])).toBe(true);
        expect(readBeforeSaves("r2", "r2", [undefined])).toBe(false);
        expect(readBeforeSaves("r2", "r2", [undefined, "r2"])).toBe(true);
    });
});

