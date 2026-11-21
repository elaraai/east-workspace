/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row stands under the key its row builds (east-workspace#1709): the one
 * rule the Sheet's editing and the shared Schedule editing both record a
 * gesture's entries by. Each row here is its code, which its key is built
 * from; a row whose code is `!` fails as its key is built.
 */

import { describe, expect, test } from "vitest";
import { none } from "@elaraai/east";
import type { EntryVersion } from "@elaraai/east-ui-components";
import { settleBuiltKeys, type BuiltKeyRule, type TouchedEntry } from "./built-keys.js";

type Version = EntryVersion<string>;

/** A row of a code, as an entry holds it. */
const row = (code: string): Version => ({ draft: code, wire: code, place: none });
/** No row. */
const absent: Version = { draft: undefined, wire: undefined, place: none };

/** The rule over a record holding `stored`, each row under the key given, and showing a row under each of `shown`. */
function ruleOver(stored: Readonly<Record<string, string>>, shown: readonly string[] = []): BuiltKeyRule<string> {
    return {
        holds: (version) => version.draft !== undefined,
        build: (_id, version) => {
            const code = version.draft as string;
            if (code.startsWith("!")) throw new Error(`no key for ${code}`);
            return code;
        },
        original: (id) => (id in stored ? row(stored[id]!) : undefined),
        stored: (id) => (id in stored ? row(stored[id]!) : undefined),
        shown: (id) => shown.includes(id),
        underKey: (id, version) => ({ ...version, wire: id }),
    };
}

/** What a gesture's entries hold after it: each key, and the code of the row under it — `null` for none. */
const held = (entries: ReadonlyMap<string, TouchedEntry<string>>): [string, unknown][] =>
    [...entries].map(([id, { after }]): [string, unknown] => [id, after.draft ?? null]);

describe("a row stands under the key its row builds (east-workspace#1709)", () => {
    test("ruling 1 — a row the gesture makes stands under the key its row builds, nothing left under the key it was made under", () => {
        const entries = new Map<string, TouchedEntry<string>>([["made-1", { before: absent, after: row("A") }]]);
        const settled = settleBuiltKeys(entries, ruleOver({}));
        expect(settled).toEqual({ all: new Map([["made-1", "A"]]), held: new Map() });
        expect(held(entries)).toEqual([["A", "A"]]);
        expect(entries.get("A")).toEqual({ before: absent, after: { draft: "A", wire: "A", place: none } });
    });

    test("ruling 1 — a row whose edit changes what its key reads moves under the key it then builds, gone from the key it stood under", () => {
        const entries = new Map<string, TouchedEntry<string>>([["A", { before: row("A"), after: row("B") }]]);
        const settled = settleBuiltKeys(entries, ruleOver({ A: "A" }));
        expect(settled).toEqual({ all: new Map([["A", "B"]]), held: new Map([["A", "B"]]) });
        expect(held(entries)).toEqual([["A", null], ["B", "B"]]);
        expect(entries.get("A")?.before).toEqual(row("A"));
    });

    test("ruling 1 — a row may take the key another leaves in the same gesture: A to B as B goes to C, and neither is lost", () => {
        const entries = new Map<string, TouchedEntry<string>>([
            ["A", { before: row("A"), after: row("B") }],
            ["B", { before: row("B"), after: row("C") }],
        ]);
        const settled = settleBuiltKeys(entries, ruleOver({ A: "A", B: "B" }));
        expect(settled).toEqual({ all: new Map([["A", "B"], ["B", "C"]]), held: new Map([["A", "B"], ["B", "C"]]) });
        expect(held(entries)).toEqual([["A", null], ["B", "B"], ["C", "C"]]);
        // The row arriving under B begins from the row that stood there.
        expect(entries.get("B")?.before).toEqual(row("B"));
    });

    test("ruling 1 — a key another row stands under refuses the gesture, naming the row refused — none for one it would have added — and nothing is moved", () => {
        const moved = new Map<string, TouchedEntry<string>>([["A", { before: row("A"), after: row("B") }]]);
        expect(settleBuiltKeys(moved, ruleOver({ A: "A", B: "B" }))).toEqual({ refused: { id: "A", why: { taken: "B" } } });
        expect(held(moved)).toEqual([["A", "B"]]);
        const added = new Map<string, TouchedEntry<string>>([["made-1", { before: absent, after: row("B") }]]);
        expect(settleBuiltKeys(added, ruleOver({ B: "B" }))).toEqual({ refused: { id: "", why: { taken: "B" } } });
        // Two rows of one gesture building one key: the second is refused.
        const both = new Map<string, TouchedEntry<string>>([["made-1", { before: absent, after: row("C") }], ["made-2", { before: absent, after: row("C") }]]);
        expect(settleBuiltKeys(both, ruleOver({}))).toEqual({ refused: { id: "", why: { taken: "C" } } });
        // A row shown under the key, of a record read a window at a time, holds it too.
        const windowed = new Map<string, TouchedEntry<string>>([["made-1", { before: absent, after: row("D") }]]);
        expect(settleBuiltKeys(windowed, ruleOver({}, ["D"]))).toEqual({ refused: { id: "", why: { taken: "D" } } });
    });

    test("ruling 1 — a key the gesture's own removal frees is taken again, and one whose row a draft removed stands free", () => {
        const entries = new Map<string, TouchedEntry<string>>([
            ["B", { before: row("B"), after: absent }],
            ["A", { before: row("A"), after: row("B") }],
        ]);
        expect(settleBuiltKeys(entries, ruleOver({ A: "A", B: "B" }))).toEqual({ all: new Map([["A", "B"]]), held: new Map([["A", "B"]]) });
        expect(held(entries)).toEqual([["B", "B"], ["A", null]]);
    });

    test("ruling 1 — a key that fails as it is built refuses the gesture, with what it threw", () => {
        const entries = new Map<string, TouchedEntry<string>>([["A", { before: row("A"), after: row("!") }]]);
        const settled = settleBuiltKeys(entries, ruleOver({ A: "A" }));
        expect("refused" in settled && settled.refused.id).toBe("A");
        expect("refused" in settled && "failed" in settled.refused.why && String(settled.refused.why.failed)).toBe("Error: no key for !");
    });

    test("ruling 1 — a row its `key` fails on as it stood moves under the key the edit gives it: the edit that mends it is kept, never refused for what the row held before", () => {
        const entries = new Map<string, TouchedEntry<string>>([["R-7", { before: row("!"), after: row("12") }]]);
        expect(settleBuiltKeys(entries, ruleOver({ "R-7": "!" }))).toEqual({ all: new Map([["R-7", "12"]]), held: new Map([["R-7", "12"]]) });
        expect(held(entries)).toEqual([["R-7", null], ["12", "12"]]);
    });

    test("a row stored apart from its key stays where it is: edited back to build the key it stands under, or edited where its key reads nothing of it (#1581)", () => {
        const back = new Map<string, TouchedEntry<string>>([["A", { before: row("Z"), after: row("A") }]]);
        expect(settleBuiltKeys(back, ruleOver({ A: "Z" }))).toEqual({ all: new Map(), held: new Map() });
        const apart = new Map<string, TouchedEntry<string>>([["A", { before: row("Z"), after: row("Z") }]]);
        expect(settleBuiltKeys(apart, ruleOver({ A: "Z" }))).toEqual({ all: new Map(), held: new Map() });
        expect([held(back), held(apart)]).toEqual([[["A", "A"]], [["A", "Z"]]]);
    });

    test("ruling 1 — a row written back under a key its record holds, which the drafts removed — a removed row restored — is that row: it stays under its key while what its key reads is as stored, and moves only as that changed", () => {
        // Stored under A apart from its key, Z: removed by the drafts, then written back as stored.
        const restored = new Map<string, TouchedEntry<string>>([["A", { before: absent, after: row("Z") }]]);
        expect(settleBuiltKeys(restored, ruleOver({ A: "Z" }))).toEqual({ all: new Map(), held: new Map() });
        expect(held(restored)).toEqual([["A", "Z"]]);
        // Written back with what its key reads changed: it moves, a row its record held.
        const changed = new Map<string, TouchedEntry<string>>([["A", { before: absent, after: row("B") }]]);
        expect(settleBuiltKeys(changed, ruleOver({ A: "Z" }))).toEqual({ all: new Map([["A", "B"]]), held: new Map([["A", "B"]]) });
        expect(held(changed)).toEqual([["A", null], ["B", "B"]]);
    });
});
