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
    member("M2140", "machine", { meta: "CNC lathe", parent: "Line 2" }),
    member("M2141", "machine", { meta: "CNC lathe", parent: "Line 2" }),
    member("M2145", "machine", { meta: "CNC lathe", parent: "Line 2" }),
    member("M7301", "machine", { meta: "assembly bench", parent: "Line 7" }),
    member("Line 2", "line", { aliases: ["line 2", "l2", "the 2 line"], meta: "line · 96" }),
    member("Test bay", "line", { aliases: ["bay", "the test bay"], meta: "line · 9" }),
    member("CNC lathe", "family", { aliases: ["lathe", "lathes"], meta: "family" }),
    member("120 t press", "family", { aliases: ["press", "120 t"], meta: "family" }),
];

const column = indexColumns([{
    key: "stations", header: "Work centres", sub: none, width: none,
    kind: { type: "link", value: {
        register: "stations",
        members: [
            { kind: "machine", identified: true, countable: false, resolvesTo: none },
            { kind: "range", identified: true, countable: false, resolvesTo: none },
            { kind: "line", identified: false, countable: true, resolvesTo: some("machine") },
            { kind: "family", identified: false, countable: true, resolvesTo: some("machine") },
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
        ["M2140", [m("identified", { key: "M2140" })]],
        ["m2140", [m("identified", { key: "M2140" })]],
        ["2140", [m("identified", { key: "M2140" })]],                       // bare digits try the prefix
        ["M2140-45", [m("range", { from: "M2140", to: "M2145" })]],           // short upper bound completed
        ["2140-2145", [m("range", { from: "M2140", to: "M2145" })]],
        ["Line 2", [m("identified", { key: "Line 2" })]],
        ["the 2 line", [m("identified", { key: "Line 2" })]],
        ["bay", [m("identified", { key: "Test bay" })]],
        ["120t", [m("identified", { key: "120 t press" })]],                 // countable by attribute — the spacing normalised
        ["120 T", [m("identified", { key: "120 t press" })]],
        ["120  t", [m("identified", { key: "120 t press" })]],
        ["4 x lathe", [m("counted", { n: 4n, key: "CNC lathe" })]],
        ["Line 2 × 3", [m("counted", { n: 3n, key: "Line 2" })]],
        ["3*bay", [m("counted", { n: 3n, key: "Test bay" })]],
        ["4 x lathe north hall", [m("counted", { n: 4n, key: "CNC lathe" }), m("text", "north hall")]],   // trailing qualifier
        ["2 x M2140", [m("text", "2 x M2140")]],                              // a named member cannot be multiplied
        ["TBC", [m("placeholder", null)]],
        ["tbc", [m("placeholder", null)]],
        ["mystery", [m("text", "mystery")]],
        ["", []],
    ])("%s", (text, expected) => {
        expect(classifyToken(text, vocab)).toEqual(expected);
    });

    test("a range needs members in the span; a spaced hyphen is not a range", () => {
        expect(parseRange("M9000-9005", vocab)).toBeUndefined();
        expect(parseRange("M2140 - 45", vocab)).toBeUndefined();
        expect(parseRange("M2140-45", vocab)?.members.map((x) => x.key)).toEqual(["M2140", "M2141", "M2145"]);
    });
});

describe("halves", () => {
    test.each<[string, string[], string[]]>([
        ["M2140, the 2 line > 4 x lathe, TBC", ["M2140", "Line 2"], ["4 × CNC lathe", "TBC"]],
        ["bay", [], ["Test bay"]],
        ["M2141 >", ["M2141"], []],
        ["M2140 -> M7301", ["M2140"], ["M7301"]],
        ["M2140 → M7301", ["M2140"], ["M7301"]],
        ["M2140 - M7301", ["M2140"], ["M7301"]],                              // a spaced hyphen is an arrow
        ["M2140-45 > mystery", ["M2140-M2145"], ["mystery"]],
    ])("%s", (text, from, to) => {
        const link = parseLinkText(text, vocab);
        expect(link.from.map((x) => (x.type === "range" ? `${(x.value as { from: string }).from}-${(x.value as { to: string }).to}` : x.type === "counted" ? `${(x.value as { n: bigint }).n} × ${(x.value as { key: string }).key}` : x.type === "placeholder" ? "TBC" : x.type === "text" ? x.value : (x.value as { key: string }).key))).toEqual(from);
        expect(link.to.map((x) => (x.type === "range" ? `${(x.value as { from: string }).from}-${(x.value as { to: string }).to}` : x.type === "counted" ? `${(x.value as { n: bigint }).n} × ${(x.value as { key: string }).key}` : x.type === "placeholder" ? "TBC" : x.type === "text" ? x.value : (x.value as { key: string }).key))).toEqual(to);
    });

    test("print is the planner's text — both halves, destination only, source only — and round-trips", () => {
        const both = parseLinkText("M2140, Line 2 > 4 x lathe", vocab);
        expect(printLinkText(both)).toBe("M2140, Line 2 > 4 × CNC lathe");
        expect(parseLinkText(printLinkText(both), vocab)).toEqual(both);
        expect(printLinkText(parseLinkText("bay, TBC", vocab))).toBe("Test bay, TBC");
        expect(printLinkText(parseLinkText("M2141 >", vocab))).toBe("M2141 >");
        expect(printLinkText({ from: [], to: [] } as never)).toBe("");
    });
});

describe("meta and used keys", () => {
    test("chip meta comes from the register; a counted member is unassigned; a range names its span", () => {
        expect(memberMeta(m("identified", { key: "M2140" }), vocab)).toBe("CNC lathe");
        expect(memberMeta(m("counted", { n: 4n, key: "CNC lathe" }), vocab)).toBe("unassigned");
        expect(memberMeta(m("counted", { n: 2n, key: "Line 2" }), vocab)).toBe("unassigned");
        expect(memberMeta(m("counted", { n: 2n, key: "nowhere" }), vocab)).toBe("");
        expect(memberMeta(m("range", { from: "M2140", to: "M2145" }), vocab)).toBe("3 members");
        expect(memberMeta(m("text", "x"), vocab)).toBe("");
    });

    test("a range's expansion counts as used", () => {
        const used = usedKeys([m("range", { from: "M2140", to: "M2145" }), m("counted", { n: 1n, key: "Line 2" }), m("text", "z")], vocab);
        expect([...used].sort()).toEqual(["line 2", "m2140", "m2141", "m2145"]);
    });
});
