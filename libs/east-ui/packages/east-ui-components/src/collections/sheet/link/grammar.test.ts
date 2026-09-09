/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The B§4.1 member grammar as a round-trip table (Sheet Spec §5 row 4).
 */

import { describe, test, expect } from "vitest";
import { none, some } from "@elaraai/east";
import { classifyToken, linkVocabulary, parseLinkText, printLinkText, usedKeys, memberMeta, parseRange } from "./grammar.js";
import { indexColumns } from "../model.js";
import type { SheetMemberValue, SheetRegisterMemberValue } from "../values.js";

const member = (key: string, kind: string, extra: Partial<{ aliases: string[]; meta: string; parent: string; label: string }> = {}): SheetRegisterMemberValue => ({
    key, label: extra.label ?? key, kind, aliases: extra.aliases ?? [],
    meta: extra.meta !== undefined ? some(extra.meta) : none,
    parent: extra.parent !== undefined ? some(extra.parent) : none,
    tone: none,
}) as SheetRegisterMemberValue;

const MEMBERS = [
    member("T2140", "tank", { meta: "140 m³", parent: "2000s" }),
    member("T2141", "tank", { meta: "140 m³", parent: "2000s" }),
    member("T2145", "tank", { meta: "140 m³", parent: "2000s" }),
    member("T7301", "tank", { meta: "80 m³", parent: "7000s" }),
    member("2000s", "farm", { aliases: ["2000", "t2000s", "the 2000s"], meta: "farm · 96" }),
    member("Annex store", "farm", { aliases: ["annex", "the annex", "anx"], meta: "farm · 9" }),
    member("G1042", "group", { meta: "drm grp · 48" }),
    member("140 m³", "capacity", { meta: "size" }),
    member("80 m³", "capacity", { meta: "size" }),
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

describe("classify", () => {
    test.each<[string, SheetMemberValue[]]>([
        ["T2140", [m("identified", { key: "T2140" })]],
        ["t2140", [m("identified", { key: "T2140" })]],
        ["2140", [m("identified", { key: "T2140" })]],                       // bare digits try the prefix
        ["T2140-45", [m("range", { from: "T2140", to: "T2145" })]],           // short upper bound completed
        ["2140-2145", [m("range", { from: "T2140", to: "T2145" })]],
        ["2000s", [m("identified", { key: "2000s" })]],
        ["the 2000s", [m("identified", { key: "2000s" })]],
        ["annex", [m("identified", { key: "Annex store" })]],
        ["140m3", [m("identified", { key: "140 m³" })]],                     // countable by attribute
        ["140 m³", [m("identified", { key: "140 m³" })]],
        ["140000L", [m("identified", { key: "140 m³" })]],
        ["4 x 140m³", [m("counted", { n: 4n, key: "140 m³" })]],
        ["2000s × 3", [m("counted", { n: 3n, key: "2000s" })]],
        ["3*annex", [m("counted", { n: 3n, key: "Annex store" })]],
        ["4 x 140m³ tanks south", [m("counted", { n: 4n, key: "140 m³" }), m("text", "tanks south")]],   // trailing qualifier
        ["2 x T2140", [m("text", "2 x T2140")]],                              // a named member cannot be multiplied
        ["TBC", [m("placeholder", null)]],
        ["tbc", [m("placeholder", null)]],
        ["mystery", [m("text", "mystery")]],
        ["", []],
    ])("%s", (text, expected) => {
        expect(classifyToken(text, vocab)).toEqual(expected);
    });

    test("a range needs members in the span; a spaced hyphen is not a range", () => {
        expect(parseRange("T9000-9005", vocab)).toBeUndefined();
        expect(parseRange("T2140 - 45", vocab)).toBeUndefined();
        expect(parseRange("T2140-45", vocab)?.members.map((x) => x.key)).toEqual(["T2140", "T2141", "T2145"]);
    });
});

describe("halves", () => {
    test.each<[string, string[], string[]]>([
        ["T2140, the 2000s > 4 x 140m³, TBC", ["T2140", "2000s"], ["4 × 140 m³", "TBC"]],
        ["annex", [], ["Annex store"]],
        ["T2141 >", ["T2141"], []],
        ["T2140 -> T7301", ["T2140"], ["T7301"]],
        ["T2140 → T7301", ["T2140"], ["T7301"]],
        ["T2140 - T7301", ["T2140"], ["T7301"]],                              // a spaced hyphen is an arrow
        ["T2140-45 > mystery", ["T2140-T2145"], ["mystery"]],
    ])("%s", (text, from, to) => {
        const link = parseLinkText(text, vocab);
        expect(link.from.map((x) => (x.type === "range" ? `${(x.value as { from: string }).from}-${(x.value as { to: string }).to}` : x.type === "counted" ? `${(x.value as { n: bigint }).n} × ${(x.value as { key: string }).key}` : x.type === "placeholder" ? "TBC" : x.type === "text" ? x.value : (x.value as { key: string }).key))).toEqual(from);
        expect(link.to.map((x) => (x.type === "range" ? `${(x.value as { from: string }).from}-${(x.value as { to: string }).to}` : x.type === "counted" ? `${(x.value as { n: bigint }).n} × ${(x.value as { key: string }).key}` : x.type === "placeholder" ? "TBC" : x.type === "text" ? x.value : (x.value as { key: string }).key))).toEqual(to);
    });

    test("print is the planner's text — both halves, destination only, source only — and round-trips", () => {
        const both = parseLinkText("T2140, 2000s > 4 x 140 m³", vocab);
        expect(printLinkText(both)).toBe("T2140, 2000s > 4 × 140 m³");
        expect(parseLinkText(printLinkText(both), vocab)).toEqual(both);
        expect(printLinkText(parseLinkText("annex, TBC", vocab))).toBe("Annex store, TBC");
        expect(printLinkText(parseLinkText("T2141 >", vocab))).toBe("T2141 >");
        expect(printLinkText({ from: [], to: [] } as never)).toBe("");
    });
});

describe("meta and used keys", () => {
    test("chip meta comes from the register; a counted size is unassigned; a range names its span", () => {
        expect(memberMeta(m("identified", { key: "T2140" }), vocab)).toBe("140 m³");
        expect(memberMeta(m("counted", { n: 4n, key: "140 m³" }), vocab)).toBe("unassigned");
        expect(memberMeta(m("counted", { n: 2n, key: "2000s" }), vocab)).toBe("farm · 96");
        expect(memberMeta(m("range", { from: "T2140", to: "T2145" }), vocab)).toBe("3 members");
        expect(memberMeta(m("text", "x"), vocab)).toBe("");
    });

    test("a range's expansion counts as used", () => {
        const used = usedKeys([m("range", { from: "T2140", to: "T2145" }), m("counted", { n: 1n, key: "2000s" }), m("text", "z")], vocab);
        expect([...used].sort()).toEqual(["2000s", "t2140", "t2141", "t2145"]);
    });
});
