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
 * driver column by what follows the row above. Every register column is
 * typed in the words its cells show (#1536): a member by its key, its label
 * or an alias, the same for every register kind.
 */

import { describe, test, expect } from "vitest";
import { none, variant } from "@elaraai/east";
import { scoreLabel, scoreCandidates, entryCandidates, candidateList, candidateFor, ghostFor, ghostWord, resolveFor, candidateAt } from "./candidates.js";
import { indexColumns, indexRegisters, resolveMember, type SheetColumnMeta } from "./model.js";
import { editText, parseCell } from "./parse/index.js";
import { keyedCell } from "./steps.js";
import { SHEET_WORDS } from "./words.js";
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
    return { id, owned: false, cells: new Map([["activity", variant("String", activity)]]), lines: [], band: none, subRows: [], entry: none };
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
        expect(menu[0]).toEqual({ key: "Routing", label: "Routing" });
        expect(menu.slice(0, 3).map((c) => c.key)).toEqual(["Routing", "Spraying", "Inspection"]);
        expect(menu).toHaveLength(6);
        // The empty buffer arms nothing.
        expect(candidateAt(lookupMeta, "", -1, ctx)).toBeUndefined();
        expect(candidateList(lookupMeta, "", ctx)).toEqual(menu);
    });
});

// Two people who show one name, and one an alias finds too.
const people = indexRegisters(new Map([["people", { members: [
    { ...member("P-7"), label: "J. Smith" },
    { ...member("P-9"), label: "J. Smith" },
    { ...member("P-3"), label: "Ana Ruiz", aliases: ["ana"] },
] }]]) as never);

/** A column of a register kind over the people. */
function overPeople(kind: string, value: Record<string, unknown>): SheetColumnMeta {
    return indexColumns([{
        key: "who", header: "Who", sub: none, width: none, kind: variant(kind, { register: "people", ...value }),
        dataType: null, payloadType: null, editable: true, fill: [], detailCell: none,
    } as never]).list[0]!;
}

const REGISTER_KINDS = [
    overPeople("lookup", { options: none }),
    overPeople("reference", {}),
    overPeople("enum", { options: none }),
    overPeople("person", { unassigned: none }),
    overPeople("cycle", { scale: false, look: variant("chip", null) }),
].map((meta) => [meta.kind, meta] as const);

describe("a register column is typed in the words its cells show (#1536)", () => {
    const ctx = { registers: people, rows: [], rowIndex: -1, driverColumn: undefined };

    test.each(REGISTER_KINDS)("%s: a member's label, key or alias finds it, and its words are what the candidate shows", (_kind, meta) => {
        expect(candidateList(meta, "smi", ctx)).toEqual([{ key: "P-7", label: "J. Smith" }, { key: "P-9", label: "J. Smith" }]);
        expect(candidateList(meta, "P-3", ctx)[0]).toEqual({ key: "P-3", label: "Ana Ruiz" });
        expect(candidateList(meta, "ana", ctx)[0]).toEqual({ key: "P-3", label: "Ana Ruiz" });
        expect(entryCandidates(meta, ctx).map((c) => c.label)).toEqual(["J. Smith", "J. Smith", "Ana Ruiz"]);
    });

    test.each(REGISTER_KINDS)("%s: typed text commits to the member it names whole — the first of two who share a name — else the best candidate", (_kind, meta) => {
        expect(candidateFor(meta, "j. smith", ctx)?.key).toBe("P-7");
        expect(candidateFor(meta, "P-9", ctx)?.key).toBe("P-9");
        expect(candidateFor(meta, "ANA", ctx)?.key).toBe("P-3");
        expect(candidateFor(meta, "ruiz", ctx)?.key).toBe("P-3");
        expect(candidateFor(meta, "zzz", ctx)).toBeUndefined();
        expect(candidateFor(meta, " ", ctx)).toBeUndefined();
    });

    test("a member committed by its key is found again by it — never as another whose alias, or whose key's case, its key shares (#1583)", () => {
        // B comes first and goes by A's key; C's key is A's in other case.
        const shared = indexRegisters(new Map([["people", { members: [
            { ...member("B-1"), label: "Bea", aliases: ["A-1"] },
            { ...member("a-1"), label: "Cal" },
            { ...member("A-1"), label: "Ada" },
        ] }]]) as never);
        const sharedCtx = { registers: shared, rows: [], rowIndex: -1, driverColumn: undefined };
        const parse = { ...sharedCtx, words: SHEET_WORDS, today: new Date("2026-11-06T00:00:00Z") };
        for (const [, meta] of REGISTER_KINDS) {
            expect(candidateFor(meta, "A-1", sharedCtx)?.key).toBe("A-1");
            expect(parseCell(meta, "A-1", parse)).toEqual({ kind: "cell", cell: variant("String", "A-1") });
            expect(candidateFor(meta, "a-1", sharedCtx)?.key).toBe("a-1");
        }
        // The cell holding A's key shows A.
        expect(resolveMember(shared, "people", "A-1")?.label).toBe("Ada");
        expect(resolveMember(shared, "people", "a-1")?.label).toBe("Cal");
        // An alias no key shares still finds its member, in any case.
        expect(resolveMember(people, "people", "ANA")?.key).toBe("P-3");
    });

    test("a member the row is not offered is never what typed text commits to", () => {
        const offered = { ...ctx, allowed: () => new Set(["P-9"]) };
        const meta = overPeople("enum", { options: none });
        expect(candidateFor(meta, "j. smith", offered)?.key).toBe("P-9");
        expect(candidateList(meta, "j", offered)).toEqual([{ key: "P-9", label: "J. Smith" }]);
    });

    test("a closed register keeps an unmatched text as invalid draft text; an open one keeps it as typed; both write the key", () => {
        const parse = { ...ctx, words: SHEET_WORDS, today: new Date("2026-11-06T00:00:00Z") };
        for (const kind of ["enum", "person", "cycle"]) {
            const meta = overPeople(kind, kind === "enum" ? { options: none } : kind === "person" ? { unassigned: none } : { scale: false, look: variant("chip", null) });
            expect(parseCell(meta, "Ana Ruiz", parse)).toEqual({ kind: "cell", cell: variant("String", "P-3") });
            expect(parseCell(meta, "nobody", parse)).toEqual({ kind: "unrecognised" });
        }
        const lookup = overPeople("lookup", { options: none });
        expect(parseCell(lookup, "Ana Ruiz", parse)).toEqual({ kind: "cell", cell: variant("String", "P-3") });
        expect(parseCell(lookup, "nobody", parse)).toEqual({ kind: "cell", cell: variant("String", "nobody") });
    });

    test("a member opens for editing in the words its cell shows; a cycle's key press finds a member by its key, an alias or its label", () => {
        const person = overPeople("person", { unassigned: none });
        const p9 = { ...member("P-9"), label: "J. Smith" };
        expect(editText(variant("String", "P-9"), person, SHEET_WORDS, undefined, p9 as never)).toBe("J. Smith");
        expect(editText(variant("String", "P-9"), person, SHEET_WORDS)).toBe("P-9");
        const levels = indexRegisters(new Map([["people", { members: [{ ...member("L-0"), label: "0" }, { ...member("L-1"), label: "1", aliases: ["s"] }] }]]) as never);
        const cycle = overPeople("cycle", { scale: true, look: variant("chip", null) });
        expect(keyedCell(cycle, "1", levels)).toEqual(variant("String", "L-1"));
        expect(keyedCell(cycle, "s", levels)).toEqual(variant("String", "L-1"));
        expect(keyedCell(cycle, "x", levels)).toBeUndefined();
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
