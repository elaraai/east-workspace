/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Candidate scoring (B§3.1 — Sheet Spec §5 row 3): prefix → word prefix →
 * initials → substring, ties by sheet frequency; the entry menu ranks the
 * driver column by what follows the row above.
 */

import { describe, test, expect } from "vitest";
import { none, variant } from "@elaraai/east";
import { scoreLabel, scoreCandidates, entryCandidates, candidateList, ghostFor, ghostWord, resolveFor, candidateAt } from "./candidates.js";
import { indexColumns, indexRegisters, type SheetColumnMeta } from "./model.js";
import type { SheetRowValue } from "./values.js";

const ACTS = ["Machining", "Machining - Roughing", "Machining - Finishing", "Painting", "Inspection", "Heat treatment"];

function member(key: string) {
    return { key, label: key, kind: "activity", aliases: [], meta: none, parent: none, tone: none };
}

const registers = indexRegisters(new Map([["activity", { members: ACTS.map(member) }]]) as never);

const lookupMeta: SheetColumnMeta = indexColumns([{
    key: "activity", header: "Activity", sub: none, width: none,
    kind: { type: "lookup", value: { register: "activity" } },
    dataType: null, payloadType: null, editable: true, fill: [],
} as never]).list[0]!;

function row(id: string, activity: string): SheetRowValue {
    return { id, owned: false, cells: new Map([["activity", variant("String", activity)]]) };
}

describe("scoring", () => {
    test("the four tiers, then no match", () => {
        expect(scoreLabel("Machining - Roughing", "mac")).toBe(0);
        expect(scoreLabel("Machining - Roughing", "rou")).toBe(1);
        expect(scoreLabel("Machining - Roughing", "ma ro")).toBe(1);
        expect(scoreLabel("Heat treatment", "ht")).toBe(2);
        expect(scoreLabel("Painting", "int")).toBe(3);
        expect(scoreLabel("Painting", "zzz")).toBe(-1);
        expect(scoreLabel("Painting", "")).toBe(-1);
    });

    test("best tier first, ties by frequency", () => {
        const freq = new Map([["Machining - Roughing", 3], ["Machining", 1]]);
        expect(scoreCandidates(ACTS, "ma", freq).slice(0, 2)).toEqual(["Machining - Roughing", "Machining"]);
        expect(scoreCandidates(ACTS, "roughing")).toEqual(["Machining - Roughing"]);
    });
});

describe("the entry menu", () => {
    test("the driver column ranks what usually follows the row above, then sheet frequency, then the rest", () => {
        const rows = [
            row("1", "Painting"), row("2", "Machining"),
            row("3", "Painting"), row("4", "Machining"),
            row("5", "Inspection"), row("6", "Painting"),
        ];
        // Editing row 7 (index 6): the row above is Painting, which Machining followed twice.
        const ctx = { registers, rows, rowIndex: 6, driverColumn: "activity" };
        const menu = entryCandidates(lookupMeta, ctx);
        expect(menu[0]).toBe("Machining");
        expect(menu.slice(0, 3)).toEqual(["Machining", "Painting", "Inspection"]);
        expect(menu).toHaveLength(6);
        // The empty buffer arms nothing.
        expect(candidateAt(lookupMeta, "", -1, ctx)).toBeUndefined();
        expect(candidateList(lookupMeta, "", ctx)).toEqual(menu);
    });
});

describe("ghost and replacement", () => {
    test("only a prefix match ghosts; a non-prefix match previews as a replacement", () => {
        expect(ghostFor("mac", "Machining")).toBe("hining");
        expect(ghostFor("roughing", "Machining - Roughing")).toBe("");
        expect(resolveFor("roughing", "Machining - Roughing")).toBe("Machining - Roughing");
        expect(resolveFor("mac", "Machining")).toBe("");
        expect(resolveFor("machining", "Machining")).toBe("");
        expect(ghostWord("hining - Roughing")).toBe("hining");
        expect(ghostWord(" - Roughing")).toBe(" - Roughing");
    });
});
