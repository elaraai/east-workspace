/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
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
    member("R2140", "machine", { meta: "CNC router", parent: "Bay 2" }),
    member("R2141", "machine", { meta: "CNC router", parent: "Bay 2" }),
    member("R2145", "machine", { meta: "CNC router", parent: "Bay 2" }),
    member("A7301", "machine", { meta: "assembly bench", parent: "Bay 7" }),
    member("Bay 2", "bay", { aliases: ["bay 2", "the 2 bay"], meta: "bay · 96" }),
    member("Bay 7", "bay", { aliases: ["b7"], meta: "bay · 72" }),
    member("CNC router", "family", { aliases: ["router"], meta: "family" }),
    member("3 m beam saw", "family", { aliases: ["saw", "3 m"], meta: "family" }),
];
const column = indexColumns([{
    key: "stations", header: "Work centres", sub: none, width: none,
    kind: variant("link", {
        register: "stations",
        members: [
            { kind: "machine", identified: true, countable: false, resolvesTo: none, ranged: false },
            { kind: "range", identified: true, countable: false, resolvesTo: none, ranged: false },
            { kind: "bay", identified: false, countable: true, resolvesTo: some("machine"), ranged: false },
            { kind: "family", identified: false, countable: true, resolvesTo: some("machine"), ranged: false },
        ],
        multiple: some({ forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" }),
        sides: none, arity: none, check: [], store: variant("asTyped", null), options: none,
    }),
    dataType: null, payloadType: null, editable: true, fill: [], detailCell: none,
}] as never).list[0]!;
const vocab = linkVocabulary(column, MEMBERS);
const m = (type: string, value: unknown): SheetMemberValue => variant(type, value) as SheetMemberValue;
const NONE = new Set<string>();

describe("candidates", () => {
    test("the B§4.5 order: exact → code prefixes → countables with enumerate → other countables → placeholder", () => {
        const labels = (q: string, used = NONE) => linkCandidates(q, vocab, used, SHEET_WORDS).map((c) => c.label);
        expect(labels("r21")).toEqual(["R2140", "R2141", "R2145"]);
        expect(labels("R2140")).toEqual(["R2140"]);
        expect(labels("2")).toEqual(["R2140", "R2141", "R2145", "Bay 2", "R2140, R2141, R2145"]);   // codes first: `2` looks like a code
        expect(labels("the 2")).toEqual(["Bay 2", "R2140, R2141, R2145"]);                           // a name, with its enumerate alternative
        expect(labels("3")).toEqual(["3 m beam saw"]);
        expect(labels("3m")).toEqual(["3 m beam saw"]);                       // a key prefix with the spacing dropped
        expect(labels("router")).toEqual(["CNC router", "R2140, R2141, R2145"]);   // a family enumerates the free machines of that family
        expect(labels("tb")).toEqual(["TBC"]);
        expect(labels("zzz")).toEqual([]);
        // A range shows one candidate: its expansion.
        const rng = linkCandidates("R2140-45", vocab, NONE, SHEET_WORDS);
        expect(rng).toHaveLength(1);
        expect(rng[0]!.label).toBe("R2140-R2145");
        expect(rng[0]!.meta).toBe("→ 3 machines: R2140, R2141, R2145");
        expect(rng[0]!.members[0]!.type).toBe("range");
    });

    test("members already in the cell are never offered twice — the enumerate alternative shrinks with them", () => {
        const used = new Set(["r2140"]);
        expect(linkCandidates("r21", vocab, used, SHEET_WORDS).map((c) => c.label)).toEqual(["R2141", "R2145"]);
        expect(linkCandidates("the 2", vocab, used, SHEET_WORDS).map((c) => c.label)).toEqual(["Bay 2", "R2141, R2145"]);
    });

    test("the ghost is the top prefix candidate's suffix; a non-prefix match previews as a replacement", () => {
        const cand = linkCandidateAt("r21", 0, vocab, NONE, SHEET_WORDS);
        expect(linkGhost("r21", cand)).toBe("40");
        expect(linkResolve("r21", cand)).toBe("");
        const alias = linkCandidateAt("the 2", 0, vocab, NONE, SHEET_WORDS);
        expect(linkGhost("the 2", alias)).toBe("");
        expect(linkResolve("the 2", alias)).toBe("Bay 2  bay · 96");
        expect(linkCandidateAt("", 0, vocab, NONE, SHEET_WORDS)).toBeUndefined();
        expect(linkCandidateAt("r21", 2, vocab, NONE, SHEET_WORDS)?.label).toBe("R2145");
    });

    test("a buffer resolves to the armed candidate when it completes the text, else through the grammar", () => {
        expect(resolveBuffer("r21", linkCandidateAt("r21", 0, vocab, NONE, SHEET_WORDS), vocab)).toEqual([m("identified", { key: "R2140" })]);
        expect(resolveBuffer("r2140, 4 x router", undefined, vocab)).toEqual([m("identified", { key: "R2140" }), m("counted", { n: 4n, key: "CNC router" })]);
        expect(resolveBuffer("nope", undefined, vocab)).toEqual([m("text", "nope")]);
        expect(resolveBuffer("  ", undefined, vocab)).toEqual([]);
    });
});

describe("prediction", () => {
    const predicted: SheetLinkValue = { from: [], to: [m("identified", { key: "R2140" }), m("identified", { key: "R2141" }), m("counted", { n: 2n, key: "CNC router" })] };
    test("the predicted members not yet in the cell, per half, never into a locked half, nothing while typing", () => {
        expect(predictedMembers(predicted, 1, [[], []], true, "", vocab).map((x) => x.type)).toEqual(["identified", "identified", "counted"]);
        // Named members withdraw the count and are never doubled.
        expect(predictedMembers(predicted, 1, [[], [m("identified", { key: "R2140" })]], true, "", vocab)).toEqual([m("identified", { key: "R2141" })]);
        expect(predictedMembers(predicted, 1, [[], []], false, "", vocab)).toEqual([]);
        expect(predictedMembers(predicted, 1, [[], []], true, "t", vocab)).toEqual([]);
        expect(predictedMembers(predicted, 0, [[], []], true, "", vocab)).toEqual([]);
        expect(predictedMembers(undefined, 1, [[], []], true, "", vocab)).toEqual([]);
    });

    test("the entry menu offers the countable abstractions; the grammar line names the kinds", () => {
        expect(linkEntryCandidates(vocab, NONE, SHEET_WORDS).map((c) => c.label)).toEqual(["Bay 2", "Bay 7", "CNC router", "3 m beam saw"]);
        expect(linkEntryCandidates(vocab, new Set(["bay 2"]), SHEET_WORDS).map((c) => c.label)).toEqual(["Bay 7", "CNC router", "3 m beam saw"]);
        expect(grammarLine(vocab, SHEET_WORDS)).toBe("machine code · bay · family · N x kind · a range · TBC");
    });
});

describe("arity", () => {
    test("named counts identified once, counted by count, a range by its span; text and placeholders not at all", () => {
        expect(namedCount([m("identified", { key: "R2140" }), m("counted", { n: 3n, key: "CNC router" }), m("range", { from: "R2140", to: "R2145" }), m("text", "x"), m("placeholder", null)], vocab)).toBe(7);
    });
    test("the strip meta words", () => {
        expect(arityMeta({ n: 4, key: "CNC router" }, 3, SHEET_WORDS)).toBe("4 × CNC router implied · 3 named so far");
        expect(arityMeta({ n: 4, key: "CNC router" }, 4, SHEET_WORDS)).toBe("4 × CNC router implied · 4 named");
        expect(arityMeta({ n: 4, key: "CNC router" }, 5, SHEET_WORDS)).toBe("4 × CNC router implied · 5 named — more than the quantity needs");
        expect(arityMeta({ n: 4, key: "CNC router" }, 0, SHEET_WORDS)).toBe("");
        expect(arityMeta(undefined, 3, SHEET_WORDS)).toBe("");
    });
});
