/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A drop check's answers, kept (`keptDropCheck`): the one rule every East
 * `canDrop` is asked by, whatever it is asked of and whatever it answers — a
 * drag event to a Boolean, a Plan's candidate to its refusal's words.
 */

import { describe, expect, test, vi } from "vitest";
import { keptDropCheck } from "./ir-can-drop";

describe("a drop check's answers, kept", () => {
    test("each candidate is asked once while the check is the same function: an equal candidate made anew is answered from what it said", () => {
        const asked: string[] = [];
        const check = keptDropCheck((candidate: { key: string }) => { asked.push(candidate.key); return candidate.key === "poster" ? "No posters" : undefined; },
            (candidate) => candidate.key, undefined, "[Test] canDrop");
        expect([check({ key: "poster" }), check({ key: "brochure" }), check({ key: "poster" }), check({ key: "brochure" })])
            .toEqual(["No posters", undefined, "No posters", undefined]);
        expect(asked).toEqual(["poster", "brochure"]);
    });

    test("a check that throws lets the drop land, with the answer that does, and says so once, naming whose check it is", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const check = keptDropCheck((_candidate: { key: string }): boolean => { throw new Error("broken"); }, (candidate) => candidate.key, true, "[Test] canDrop");
            expect([check({ key: "a" }), check({ key: "a" })]).toEqual([true, true]);
            expect(logged).toHaveBeenCalledTimes(1);
            expect(logged.mock.calls[0]![0]).toBe("[Test] canDrop failed (allowing):");
        } finally {
            logged.mockRestore();
        }
    });
});
