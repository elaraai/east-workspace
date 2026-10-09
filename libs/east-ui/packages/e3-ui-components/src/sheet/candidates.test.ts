/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
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

const ACTS = ["Routing", "Routing - Nesting", "Routing - Profiling", "Spraying", "Inspection", "Kiln drying"];

function member(key: string) {
    return { key, label: key, kind: "activity", aliases: [], meta: none, parent: none, tone: none };
}

const registers = indexRegisters(new Map([["activity", { members: ACTS.map(member) }]]) as never);

const lookupMeta: SheetColumnMeta = indexColumns([{
    key: "activity", header: "Activity", sub: none, width: none,
    kind: variant("lookup", { register: "activity", options: none }),
    dataType: null, payloadType: null, editable: true, fill: [], detailCell: none,
} as never]).list[0]!;

function row(id: string, activity: string): SheetRowValue {
    return { id, owned: false, cells: new Map([["activity", variant("String", activity)]]), lines: [], band: none, subRows: [] };
}

describe("scoring", () => {
    test("the four tiers, then no match", () => {
        expect(scoreLabel("Routing - Nesting", "rou")).toBe(0);
        expect(scoreLabel("Routing - Nesting", "nes")).toBe(1);
        expect(scoreLabel("Routing - Nesting", "ro ne")).toBe(1);
        expect(scoreLabel("Kiln drying", "kd")).toBe(2);
        expect(scoreLabel("Spraying", "ray")).toBe(3);
        expect(scoreLabel("Spraying", "zzz")).toBe(-1);
        expect(scoreLabel("Spraying", "")).toBe(-1);
    });

    test("best tier first, ties by frequency", () => {
        const freq = new Map([["Routing - Nesting", 3], ["Routing", 1]]);
        expect(scoreCandidates(ACTS, "ro", freq).slice(0, 2)).toEqual(["Routing - Nesting", "Routing"]);
        expect(scoreCandidates(ACTS, "nesting")).toEqual(["Routing - Nesting"]);
    });
});

describe("the entry menu", () => {
    test("the driver column ranks what usually follows the row above, then sheet frequency, then the rest", () => {
        const rows = [
            row("1", "Spraying"), row("2", "Routing"),
            row("3", "Spraying"), row("4", "Routing"),
            row("5", "Inspection"), row("6", "Spraying"),
        ];
        // Editing row 7 (index 6): the row above is Spraying, which Routing followed twice.
        const ctx = { registers, rows, rowIndex: 6, driverColumn: "activity" };
        const menu = entryCandidates(lookupMeta, ctx);
        expect(menu[0]).toBe("Routing");
        expect(menu.slice(0, 3)).toEqual(["Routing", "Spraying", "Inspection"]);
        expect(menu).toHaveLength(6);
        // The empty buffer arms nothing.
        expect(candidateAt(lookupMeta, "", -1, ctx)).toBeUndefined();
        expect(candidateList(lookupMeta, "", ctx)).toEqual(menu);
    });
});

describe("ghost and replacement", () => {
    test("only a prefix match ghosts; a non-prefix match previews as a replacement", () => {
        expect(ghostFor("rou", "Routing")).toBe("ting");
        expect(ghostFor("nesting", "Routing - Nesting")).toBe("");
        expect(resolveFor("nesting", "Routing - Nesting")).toBe("Routing - Nesting");
        expect(resolveFor("rou", "Routing")).toBe("");
        expect(resolveFor("routing", "Routing")).toBe("");
        expect(ghostWord("ting - Nesting")).toBe("ting");
        expect(ghostWord(" - Nesting")).toBe(" - Nesting");
    });
});
