/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Link autocomplete and prediction (B§4.5 — Sheet Spec §5 row 8) and the
 * arity meta (B§4.6 — row 9).
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { linkVocabulary } from "./grammar.js";
import { linkCandidates, linkCandidateAt, linkGhost, linkResolve, resolveBuffer, predictedMembers, linkEntryCandidates, grammarLine } from "./predict.js";
import { namedCount, arityMeta } from "./arity.js";
import { indexColumns } from "../model.js";
import { SHEET_WORDS } from "../words.js";
import type { SheetLinkValue, SheetMemberValue, SheetRegisterMemberValue } from "../values.js";

const member = (key: string, kind: string, extra: Partial<{ aliases: string[]; meta: string; parent: string }> = {}): SheetRegisterMemberValue => ({
    key, label: key, kind, aliases: extra.aliases ?? [],
    meta: extra.meta !== undefined ? some(extra.meta) : none,
    parent: extra.parent !== undefined ? some(extra.parent) : none,
    tone: none,
}) as SheetRegisterMemberValue;

const MEMBERS = [
    member("M2140", "machine", { meta: "CNC lathe", parent: "Line 2" }),
    member("M2141", "machine", { meta: "CNC lathe", parent: "Line 2" }),
    member("M2145", "machine", { meta: "CNC lathe", parent: "Line 2" }),
    member("M7301", "machine", { meta: "assembly bench", parent: "Line 7" }),
    member("Line 2", "line", { aliases: ["line 2", "the 2 line"], meta: "line · 96" }),
    member("Line 7", "line", { aliases: ["l7"], meta: "line · 72" }),
    member("CNC lathe", "family", { aliases: ["lathe"], meta: "family" }),
    member("120 t press", "family", { aliases: ["press", "120 t"], meta: "family" }),
];
const column = indexColumns([{
    key: "stations", header: "Work centres", sub: none, width: none,
    kind: { type: "link", value: {
        register: "stations",
        members: [
            { kind: "machine", identified: true, countable: false, resolvesTo: none, ranged: false },
            { kind: "range", identified: true, countable: false, resolvesTo: none, ranged: false },
            { kind: "line", identified: false, countable: true, resolvesTo: some("machine"), ranged: false },
            { kind: "family", identified: false, countable: true, resolvesTo: some("machine"), ranged: false },
        ],
        multiple: some({ forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" }),
        sides: none, arity: none, check: [], store: { type: "asTyped", value: null }, options: none,
    } },
    dataType: null, payloadType: null, editable: true, fill: [], detailCell: none,
}] as never).list[0]!;
const vocab = linkVocabulary(column, MEMBERS);
const m = (type: string, value: unknown): SheetMemberValue => variant(type, value) as SheetMemberValue;
const NONE = new Set<string>();

describe("candidates", () => {
    test("the B§4.5 order: exact → code prefixes → countables with enumerate → other countables → placeholder", () => {
        const labels = (q: string, used = NONE) => linkCandidates(q, vocab, used, SHEET_WORDS).map((c) => c.label);
        expect(labels("m21")).toEqual(["M2140", "M2141", "M2145"]);
        expect(labels("M2140")).toEqual(["M2140"]);
        expect(labels("2")).toEqual(["M2140", "M2141", "M2145", "Line 2", "M2140, M2141, M2145"]);   // codes first: `2` looks like a code
        expect(labels("the 2")).toEqual(["Line 2", "M2140, M2141, M2145"]);                           // a name, with its enumerate alternative
        expect(labels("12")).toEqual(["120 t press"]);
        expect(labels("120t")).toEqual(["120 t press"]);                       // a key prefix with the spacing dropped
        expect(labels("lathe")).toEqual(["CNC lathe", "M2140, M2141, M2145"]);   // a family enumerates the free machines of that family
        expect(labels("tb")).toEqual(["TBC"]);
        expect(labels("zzz")).toEqual([]);
        // A range shows one candidate: its expansion.
        const rng = linkCandidates("M2140-45", vocab, NONE, SHEET_WORDS);
        expect(rng).toHaveLength(1);
        expect(rng[0]!.label).toBe("M2140-M2145");
        expect(rng[0]!.meta).toBe("→ 3 machines: M2140, M2141, M2145");
        expect(rng[0]!.members[0]!.type).toBe("range");
    });

    test("members already in the cell are never offered twice — the enumerate alternative shrinks with them", () => {
        const used = new Set(["m2140"]);
        expect(linkCandidates("m21", vocab, used, SHEET_WORDS).map((c) => c.label)).toEqual(["M2141", "M2145"]);
        expect(linkCandidates("the 2", vocab, used, SHEET_WORDS).map((c) => c.label)).toEqual(["Line 2", "M2141, M2145"]);
    });

    test("the ghost is the top prefix candidate's suffix; a non-prefix match previews as a replacement", () => {
        const cand = linkCandidateAt("m21", 0, vocab, NONE, SHEET_WORDS);
        expect(linkGhost("m21", cand)).toBe("40");
        expect(linkResolve("m21", cand)).toBe("");
        const alias = linkCandidateAt("the 2", 0, vocab, NONE, SHEET_WORDS);
        expect(linkGhost("the 2", alias)).toBe("");
        expect(linkResolve("the 2", alias)).toBe("Line 2  line · 96");
        expect(linkCandidateAt("", 0, vocab, NONE, SHEET_WORDS)).toBeUndefined();
        expect(linkCandidateAt("m21", 2, vocab, NONE, SHEET_WORDS)?.label).toBe("M2145");
    });

    test("a buffer resolves to the armed candidate when it completes the text, else through the grammar", () => {
        expect(resolveBuffer("m21", linkCandidateAt("m21", 0, vocab, NONE, SHEET_WORDS), vocab)).toEqual([m("identified", { key: "M2140" })]);
        expect(resolveBuffer("m2140, 4 x lathe", undefined, vocab)).toEqual([m("identified", { key: "M2140" }), m("counted", { n: 4n, key: "CNC lathe" })]);
        expect(resolveBuffer("nope", undefined, vocab)).toEqual([m("text", "nope")]);
        expect(resolveBuffer("  ", undefined, vocab)).toEqual([]);
    });
});

describe("prediction", () => {
    const predicted: SheetLinkValue = { from: [], to: [m("identified", { key: "M2140" }), m("identified", { key: "M2141" }), m("counted", { n: 2n, key: "CNC lathe" })] };
    test("the predicted members not yet in the cell, per half, never into a locked half, nothing while typing", () => {
        expect(predictedMembers(predicted, 1, [[], []], true, "", vocab).map((x) => x.type)).toEqual(["identified", "identified", "counted"]);
        // Named members withdraw the count and are never doubled.
        expect(predictedMembers(predicted, 1, [[], [m("identified", { key: "M2140" })]], true, "", vocab)).toEqual([m("identified", { key: "M2141" })]);
        expect(predictedMembers(predicted, 1, [[], []], false, "", vocab)).toEqual([]);
        expect(predictedMembers(predicted, 1, [[], []], true, "t", vocab)).toEqual([]);
        expect(predictedMembers(predicted, 0, [[], []], true, "", vocab)).toEqual([]);
        expect(predictedMembers(undefined, 1, [[], []], true, "", vocab)).toEqual([]);
    });

    test("the entry menu offers the countable abstractions; the grammar line names the kinds", () => {
        expect(linkEntryCandidates(vocab, NONE, SHEET_WORDS).map((c) => c.label)).toEqual(["Line 2", "Line 7", "CNC lathe", "120 t press"]);
        expect(linkEntryCandidates(vocab, new Set(["line 2"]), SHEET_WORDS).map((c) => c.label)).toEqual(["Line 7", "CNC lathe", "120 t press"]);
        expect(grammarLine(vocab, SHEET_WORDS)).toBe("machine code · line · family · N x kind · a range · TBC");
    });
});

describe("arity", () => {
    test("named counts identified once, counted by count, a range by its span; text and placeholders not at all", () => {
        expect(namedCount([m("identified", { key: "M2140" }), m("counted", { n: 3n, key: "CNC lathe" }), m("range", { from: "M2140", to: "M2145" }), m("text", "x"), m("placeholder", null)], vocab)).toBe(7);
    });
    test("the strip meta words", () => {
        expect(arityMeta({ n: 4, key: "CNC lathe" }, 3, SHEET_WORDS)).toBe("4 × CNC lathe implied · 3 named so far");
        expect(arityMeta({ n: 4, key: "CNC lathe" }, 4, SHEET_WORDS)).toBe("4 × CNC lathe implied · 4 named");
        expect(arityMeta({ n: 4, key: "CNC lathe" }, 5, SHEET_WORDS)).toBe("4 × CNC lathe implied · 5 named — more than the quantity needs");
        expect(arityMeta({ n: 4, key: "CNC lathe" }, 0, SHEET_WORDS)).toBe("");
        expect(arityMeta(undefined, 3, SHEET_WORDS)).toBe("");
    });
});
