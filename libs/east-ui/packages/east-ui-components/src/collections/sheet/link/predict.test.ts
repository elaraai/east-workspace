/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Link autocomplete and prediction (B§4.5 — Sheet Spec §5 row 8) and the
 * arity meta (B§4.6 — row 9).
 */

import { describe, test, expect } from "vitest";
import { none, some } from "@elaraai/east";
import { linkVocabulary } from "./grammar.js";
import { linkCandidates, linkCandidateAt, linkGhost, linkResolve, resolveBuffer, predictedMembers, linkEntryCandidates, grammarLine } from "./predict.js";
import { namedCount, arityMeta } from "./arity.js";
import { indexColumns } from "../model.js";
import type { SheetMemberValue, SheetRegisterMemberValue } from "../values.js";

const member = (key: string, kind: string, extra: Partial<{ aliases: string[]; meta: string; parent: string }> = {}): SheetRegisterMemberValue => ({
    key, label: key, kind, aliases: extra.aliases ?? [],
    meta: extra.meta !== undefined ? some(extra.meta) : none,
    parent: extra.parent !== undefined ? some(extra.parent) : none,
    tone: none,
}) as SheetRegisterMemberValue;

const MEMBERS = [
    member("T2140", "tank", { meta: "140 m³", parent: "2000s" }),
    member("T2141", "tank", { meta: "140 m³", parent: "2000s" }),
    member("T2145", "tank", { meta: "140 m³", parent: "2000s" }),
    member("T7301", "tank", { meta: "80 m³", parent: "7000s" }),
    member("2000s", "farm", { aliases: ["2000", "the 2000s"], meta: "farm · 96" }),
    member("7000s", "farm", { aliases: ["7000"], meta: "farm · 72" }),
    member("G1042", "group", { meta: "drm grp · 48" }),
    member("140 m³", "capacity", { meta: "size" }),
];
const column = indexColumns([{
    key: "tanks", header: "Tanks", sub: none, width: none,
    kind: { type: "link", value: {
        register: "vessels",
        members: [
            { kind: "tank", identified: true, countable: false, resolvesTo: none },
            { kind: "range", identified: true, countable: false, resolvesTo: none },
            { kind: "farm", identified: false, countable: true, resolvesTo: some("tank") },
            { kind: "group", identified: false, countable: true, resolvesTo: some("tank") },
            { kind: "capacity", identified: false, countable: true, resolvesTo: some("tank") },
        ],
        multiple: some({ forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" }),
        sides: none, arity: none, check: [], store: { type: "asTyped", value: null },
    } },
    dataType: null, payloadType: null, editable: true, fill: [],
}] as never).list[0]!;
const vocab = linkVocabulary(column, MEMBERS);
const m = (type: string, value: unknown): SheetMemberValue => ({ type, value }) as SheetMemberValue;
const NONE = new Set<string>();

describe("candidates", () => {
    test("the B§4.5 order: exact → code prefixes → countables with enumerate → other countables → placeholder", () => {
        const labels = (q: string, used = NONE) => linkCandidates(q, vocab, used).map((c) => c.label);
        expect(labels("t21")).toEqual(["T2140", "T2141", "T2145"]);
        expect(labels("T2140")).toEqual(["T2140"]);
        expect(labels("2")).toEqual(["T2140", "T2141", "T2145", "2000s", "T2140, T2141, T2145"]);   // codes first: `2` looks like a code
        expect(labels("the 2")).toEqual(["2000s", "T2140, T2141, T2145"]);                           // a name, with its enumerate alternative
        expect(labels("g1")).toEqual(["G1042"]);
        expect(labels("14")).toEqual(["140 m³"]);
        expect(labels("tb")).toEqual(["TBC"]);
        expect(labels("zzz")).toEqual([]);
        // A range shows one candidate: its expansion.
        const rng = linkCandidates("T2140-45", vocab, NONE);
        expect(rng).toHaveLength(1);
        expect(rng[0]!.label).toBe("T2140-T2145");
        expect(rng[0]!.meta).toBe("→ 3 members: T2140, T2141, T2145");
        expect(rng[0]!.members[0]!.type).toBe("range");
    });

    test("members already in the cell are never offered twice — the enumerate alternative shrinks with them", () => {
        const used = new Set(["t2140"]);
        expect(linkCandidates("t21", vocab, used).map((c) => c.label)).toEqual(["T2141", "T2145"]);
        expect(linkCandidates("the 2", vocab, used).map((c) => c.label)).toEqual(["2000s", "T2141, T2145"]);
    });

    test("the ghost is the top prefix candidate's suffix; a non-prefix match previews as a replacement", () => {
        const cand = linkCandidateAt("t21", 0, vocab, NONE);
        expect(linkGhost("t21", cand)).toBe("40");
        expect(linkResolve("t21", cand)).toBe("");
        const alias = linkCandidateAt("the 2", 0, vocab, NONE);
        expect(linkGhost("the 2", alias)).toBe("");
        expect(linkResolve("the 2", alias)).toBe("2000s  farm · 96");
        expect(linkCandidateAt("", 0, vocab, NONE)).toBeUndefined();
        expect(linkCandidateAt("t21", 2, vocab, NONE)?.label).toBe("T2145");
    });

    test("a buffer resolves to the armed candidate when it completes the text, else through the grammar", () => {
        expect(resolveBuffer("t21", linkCandidateAt("t21", 0, vocab, NONE), vocab)).toEqual([m("identified", { key: "T2140" })]);
        expect(resolveBuffer("t2140, 4 x 140m3", undefined, vocab)).toEqual([m("identified", { key: "T2140" }), m("counted", { n: 4n, key: "140 m³" })]);
        expect(resolveBuffer("nope", undefined, vocab)).toEqual([m("text", "nope")]);
        expect(resolveBuffer("  ", undefined, vocab)).toEqual([]);
    });
});

describe("prediction", () => {
    const predicted = { from: [], to: [m("identified", { key: "T2140" }), m("identified", { key: "T2141" }), m("counted", { n: 2n, key: "140 m³" })] } as never;
    test("the predicted members not yet in the cell, per half, never into a locked half, nothing while typing", () => {
        expect(predictedMembers(predicted, 1, [[], []], true, "", vocab).map((x) => x.type)).toEqual(["identified", "identified", "counted"]);
        // Named members withdraw the count and are never doubled.
        expect(predictedMembers(predicted, 1, [[], [m("identified", { key: "T2140" })]], true, "", vocab)).toEqual([m("identified", { key: "T2141" })]);
        expect(predictedMembers(predicted, 1, [[], []], false, "", vocab)).toEqual([]);
        expect(predictedMembers(predicted, 1, [[], []], true, "t", vocab)).toEqual([]);
        expect(predictedMembers(predicted, 0, [[], []], true, "", vocab)).toEqual([]);
        expect(predictedMembers(undefined, 1, [[], []], true, "", vocab)).toEqual([]);
    });

    test("the entry menu offers the countable abstractions; the grammar line names the kinds", () => {
        expect(linkEntryCandidates(vocab, NONE).map((c) => c.label)).toEqual(["2000s", "7000s", "G1042", "140 m³"]);
        expect(linkEntryCandidates(vocab, new Set(["2000s"])).map((c) => c.label)).toEqual(["7000s", "G1042", "140 m³"]);
        expect(grammarLine(vocab)).toBe("tank code · farm · group · capacity · N x kind · a range · TBC");
    });
});

describe("arity", () => {
    test("named counts identified once, counted by count, a range by its span; text and placeholders not at all", () => {
        expect(namedCount([m("identified", { key: "T2140" }), m("counted", { n: 3n, key: "140 m³" }), m("range", { from: "T2140", to: "T2145" }), m("text", "x"), m("placeholder", null)], vocab)).toBe(7);
    });
    test("the strip meta words", () => {
        expect(arityMeta({ n: 4, key: "140 m³" }, 3)).toBe("4 × 140 m³ implied · 3 named so far");
        expect(arityMeta({ n: 4, key: "140 m³" }, 4)).toBe("4 × 140 m³ implied · 4 named");
        expect(arityMeta({ n: 4, key: "140 m³" }, 5)).toBe("4 × 140 m³ implied · 5 named — more than the volume needs");
        expect(arityMeta({ n: 4, key: "140 m³" }, 0)).toBe("");
        expect(arityMeta(undefined, 3)).toBe("");
    });
});
