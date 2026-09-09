/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Candidate scoring (B§3.1 — Sheet Spec §5 row 3): prefix → word prefix →
 * initials → substring, ties by sheet frequency; the entry menu ranks the
 * driver column by what follows the row above.
 */

import { describe, test, expect } from "vitest";
import { none } from "@elaraai/east";
import { scoreLabel, scoreCandidates, entryCandidates, candidateList, ghostFor, ghostWord, resolveFor, candidateAt } from "./candidates.js";
import { indexColumns, indexRegisters, type SheetColumnMeta } from "./model.js";
import type { SheetRowValue } from "./values.js";

const ACTS = ["Transfer", "Transfer - Bulk Blenders", "Transfer - Annex", "Filtration", "Drum Job", "Media - Add to Tank"];

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
    return { id, owned: false, cells: new Map([["activity", { type: "String", value: activity }]]) } as SheetRowValue;
}

describe("scoring", () => {
    test("the four tiers, then no match", () => {
        expect(scoreLabel("Transfer - Annex", "tra")).toBe(0);
        expect(scoreLabel("Transfer - Annex", "ann")).toBe(1);
        expect(scoreLabel("Transfer - Annex", "tr an")).toBe(1);
        expect(scoreLabel("Media - Add to Tank", "mat")).toBe(2);
        expect(scoreLabel("Filtration", "rat")).toBe(3);
        expect(scoreLabel("Filtration", "zzz")).toBe(-1);
        expect(scoreLabel("Filtration", "")).toBe(-1);
    });

    test("best tier first, ties by frequency", () => {
        const freq = new Map([["Transfer - Annex", 3], ["Transfer", 1]]);
        expect(scoreCandidates(ACTS, "tr", freq).slice(0, 2)).toEqual(["Transfer - Annex", "Transfer"]);
        expect(scoreCandidates(ACTS, "annex")).toEqual(["Transfer - Annex"]);
    });
});

describe("the entry menu", () => {
    test("the driver column ranks what usually follows the row above, then sheet frequency, then the rest", () => {
        const rows = [
            row("1", "Filtration"), row("2", "Transfer"),
            row("3", "Filtration"), row("4", "Transfer"),
            row("5", "Drum Job"), row("6", "Filtration"),
        ];
        // Editing row 7 (index 6): the row above is Filtration, which Transfer followed twice.
        const ctx = { registers, rows, rowIndex: 6, driverColumn: "activity" };
        const menu = entryCandidates(lookupMeta, ctx);
        expect(menu[0]).toBe("Transfer");
        expect(menu.slice(0, 3)).toEqual(["Transfer", "Filtration", "Drum Job"]);
        expect(menu).toHaveLength(6);
        // The empty buffer arms nothing.
        expect(candidateAt(lookupMeta, "", -1, ctx)).toBeUndefined();
        expect(candidateList(lookupMeta, "", ctx)).toEqual(menu);
    });
});

describe("ghost and replacement", () => {
    test("only a prefix match ghosts; a non-prefix match previews as a replacement", () => {
        expect(ghostFor("tra", "Transfer")).toBe("nsfer");
        expect(ghostFor("annex", "Transfer - Annex")).toBe("");
        expect(resolveFor("annex", "Transfer - Annex")).toBe("Transfer - Annex");
        expect(resolveFor("tra", "Transfer")).toBe("");
        expect(resolveFor("transfer", "Transfer")).toBe("");
        expect(ghostWord("nsfer - Annex")).toBe("nsfer");
        expect(ghostWord(" - Annex")).toBe(" - Annex");
    });
});
