/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A new entry's key by the app's own rule (`newKey`, east-workspace#1709): the
 * policy every builder binds its session to where the app gives one. The rule
 * here numbers an entry one past the keys it is told: `T-1` told none, `T-3`
 * told two.
 */

import { describe, expect, test } from "vitest";
import type { SortedSet } from "@elaraai/east";
import { givenKeys } from "./given-keys.js";

/** What the rule was told at each asking, and what it was refused for. */
function asked() {
    const told: string[][] = [];
    const refusals: unknown[] = [];
    const numbered = givenKeys((taken: SortedSet<string>) => { told.push([...taken]); return `T-${taken.size + 1}`; }, (why) => { refusals.push(why); });
    return { told, refusals, numbered };
}

/**
 * What a session knows taken, and the keys its page shows rows under beside them: those of a record read a window at
 * a time, which a session cannot list.
 */
const known = (session: readonly string[], shown: readonly string[] = []) => ({
    has: (id: string): boolean => session.includes(id) || shown.includes(id),
    ids: (): Iterable<string> => session,
});

describe("a new entry's key by the app's own rule (east-workspace#1709)", () => {
    test("ruling 1 — the rule is given every key known taken, and the key it gives is the entry's", () => {
        const { told, refusals, numbered } = asked();
        expect(numbered.make(known(["T-1", "T-2"]), undefined, undefined)).toBe("T-3");
        expect([told, refusals]).toEqual([[["T-1", "T-2"]], []]);
    });

    test("ruling 1 — a key the rule gives that a row holds, though the rule was not told of it — one the page shows, of a record read a window at a time — is told to the rule, which is asked again: the entry takes the first key it gives that no row holds", () => {
        const { told, refusals, numbered } = asked();
        expect(numbered.make(known([], ["T-1", "T-2"]), undefined, undefined)).toBe("T-3");
        expect([told, refusals]).toEqual([[[], ["T-1"], ["T-1", "T-2"]], []]);
    });

    test("ruling 1 — a key the rule gives that it was told is taken makes none, and says which: at once, or once it has been told of it", () => {
        const refusals: unknown[] = [];
        const fixed = givenKeys(() => "T-1", (why) => { refusals.push(why); });
        expect(fixed.make(known(["T-1"]), undefined, undefined)).toBeUndefined();
        expect(fixed.make(known([], ["T-1"]), undefined, undefined)).toBeUndefined();
        expect(refusals).toEqual([{ taken: "T-1" }, { taken: "T-1" }]);
    });

    test("ruling 1 — a rule that throws makes none, and says what it threw", () => {
        const refusals: unknown[] = [];
        const failing = givenKeys(() => { throw new Error("no key"); }, (why) => { refusals.push(why); });
        expect(failing.make(known([]), undefined, undefined)).toBeUndefined();
        expect(refusals.map((why) => String((why as { failed: unknown }).failed))).toEqual(["Error: no key"]);
    });
});
