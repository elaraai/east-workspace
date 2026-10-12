/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * The B§4.1 member grammar as a round-trip table (Sheet Spec §5 row 4).
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { classifyToken, linkVocabulary, parseLinkText, printLinkText, usedKeys, memberMeta, parseRange } from "./grammar.js";
import { indexColumns, memberLabel } from "../model.js";
import { SHEET_WORDS } from "../words.js";
import type { SheetMemberValue, SheetRegisterMemberValue } from "../values.js";

const member = (key: string, kind: string, extra: Partial<{ aliases: string[]; meta: string; parent: string; label: string }> = {}): SheetRegisterMemberValue => ({
    key, label: extra.label ?? key, kind, aliases: extra.aliases ?? [],
    meta: extra.meta !== undefined ? some(extra.meta) : none,
    parent: extra.parent !== undefined ? some(extra.parent) : none,
    tone: none,
}) as SheetRegisterMemberValue;

const MEMBERS = [
    member("R2140", "machine", { meta: "CNC router", parent: "Bay 2" }),
    member("R2141", "machine", { meta: "CNC router", parent: "Bay 2" }),
    member("R2145", "machine", { meta: "CNC router", parent: "Bay 2" }),
    member("A7301", "machine", { meta: "assembly bench", parent: "Bay 7" }),
    member("Bay 2", "bay", { aliases: ["bay 2", "b2", "the 2 bay"], meta: "bay · 96" }),
    member("Dry-fit area", "bay", { aliases: ["dry fit", "the dry-fit area"], meta: "bay · 9" }),
    member("CNC router", "family", { aliases: ["router", "routers"], meta: "family" }),
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

describe("classify", () => {
    test.each<[string, SheetMemberValue[]]>([
        ["R2140", [m("identified", { key: "R2140" })]],
        ["r2140", [m("identified", { key: "R2140" })]],
        ["2140", [m("identified", { key: "R2140" })]],                       // bare digits try the prefix
        ["R2140-45", [m("range", { from: "R2140", to: "R2145" })]],           // short upper bound completed
        ["2140-2145", [m("range", { from: "R2140", to: "R2145" })]],
        ["Bay 2", [m("identified", { key: "Bay 2" })]],
        ["the 2 bay", [m("identified", { key: "Bay 2" })]],
        ["dry fit", [m("identified", { key: "Dry-fit area" })]],
        ["3m", [m("identified", { key: "3 m beam saw" })]],                 // countable by attribute — the spacing normalised
        ["3 M", [m("identified", { key: "3 m beam saw" })]],
        ["3  m", [m("identified", { key: "3 m beam saw" })]],
        ["4 x router", [m("counted", { n: 4n, key: "CNC router" })]],
        ["Bay 2 × 3", [m("counted", { n: 3n, key: "Bay 2" })]],
        ["3*dry fit", [m("counted", { n: 3n, key: "Dry-fit area" })]],
        ["4 x router north hall", [m("counted", { n: 4n, key: "CNC router" }), m("text", "north hall")]],   // trailing qualifier
        ["2 x R2140", [m("text", "2 x R2140")]],                              // a named member cannot be multiplied
        ["TBC", [m("placeholder", null)]],
        ["tbc", [m("placeholder", null)]],
        ["mystery", [m("text", "mystery")]],
        ["", []],
    ])("%s", (text, expected) => {
        expect(classifyToken(text, vocab)).toEqual(expected);
    });

    test("a range needs members in the span; a spaced hyphen is not a range", () => {
        expect(parseRange("X9000-9005", vocab)).toBeUndefined();
        expect(parseRange("R2140 - 45", vocab)).toBeUndefined();
        expect(parseRange("R2140-45", vocab)?.members.map((x) => x.key)).toEqual(["R2140", "R2141", "R2145"]);
    });
});

describe("halves", () => {
    test.each<[string, string[], string[]]>([
        ["R2140, the 2 bay > 4 x router, TBC", ["R2140", "Bay 2"], ["4 × CNC router", "TBC"]],
        ["dry fit", [], ["Dry-fit area"]],
        ["R2141 >", ["R2141"], []],
        ["R2140 -> A7301", ["R2140"], ["A7301"]],
        ["R2140 → A7301", ["R2140"], ["A7301"]],
        ["R2140 - A7301", ["R2140"], ["A7301"]],                              // a spaced hyphen is an arrow
        ["R2140-45 > mystery", ["R2140-R2145"], ["mystery"]],
    ])("%s", (text, from, to) => {
        const link = parseLinkText(text, vocab);
        expect(link.from.map(memberLabel)).toEqual(from);
        expect(link.to.map(memberLabel)).toEqual(to);
    });

    test("print is the planner's text — both halves, destination only, source only — and round-trips", () => {
        const both = parseLinkText("R2140, Bay 2 > 4 x router", vocab);
        expect(printLinkText(both)).toBe("R2140, Bay 2 > 4 × CNC router");
        expect(parseLinkText(printLinkText(both), vocab)).toEqual(both);
        expect(printLinkText(parseLinkText("dry fit, TBC", vocab))).toBe("Dry-fit area, TBC");
        expect(printLinkText(parseLinkText("R2141 >", vocab))).toBe("R2141 >");
        expect(printLinkText({ from: [], to: [] })).toBe("");
    });
});

describe("meta and used keys", () => {
    test("chip meta comes from the register; a counted member is unassigned; a range names its span", () => {
        expect(memberMeta(m("identified", { key: "R2140" }), vocab, SHEET_WORDS)).toBe("CNC router");
        expect(memberMeta(m("counted", { n: 4n, key: "CNC router" }), vocab, SHEET_WORDS)).toBe("unassigned");
        expect(memberMeta(m("counted", { n: 2n, key: "Bay 2" }), vocab, SHEET_WORDS)).toBe("unassigned");
        expect(memberMeta(m("counted", { n: 2n, key: "nowhere" }), vocab, SHEET_WORDS)).toBe("");
        expect(memberMeta(m("range", { from: "R2140", to: "R2145" }), vocab, SHEET_WORDS)).toBe("3 machines");
        expect(memberMeta(m("text", "x"), vocab, SHEET_WORDS)).toBe("");
    });

    test("a range's expansion counts as used", () => {
        const used = usedKeys([m("range", { from: "R2140", to: "R2145" }), m("counted", { n: 1n, key: "Bay 2" }), m("text", "z")], vocab);
        expect([...used].sort()).toEqual(["bay 2", "r2140", "r2141", "r2145"]);
    });
});
