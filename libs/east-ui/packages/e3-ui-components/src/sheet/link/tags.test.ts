/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Sheet's modules load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * A set cell as tags (east-workspace#1741): the tags a phone's tags editor
 * holds, the members and the cell they make — a held member kept whole, a new
 * tag read as typing it in the cell reads it — and what it suggests.
 */

import { describe, expect, test } from "vitest";
import { none, variant } from "@elaraai/east";
import { indexColumns } from "../model.js";
import { SHEET_WORDS } from "../words.js";
import { linkVocabulary, narrowVocabulary } from "./grammar.js";
import { linkEditCtx } from "./context.js";
import type { LinkHalves } from "./sides.js";
import { setCellOf, setMembers, setMembersOf, setSuggestions, setTags } from "./tags.js";
import type { SheetCellValue, SheetMemberValue, SheetRegisterMemberValue } from "../values.js";

const certificate = (key: string, label = key): SheetRegisterMemberValue =>
    ({ key, label, kind: "certificate", aliases: [], meta: none, parent: none, tone: none }) as SheetRegisterMemberValue;
const CERTIFICATES = [certificate("Forklift"), certificate("Confined space"), certificate("First aid"), certificate("Working at height"), certificate("WAH-2", "Working at height 2")];
const column = indexColumns([{
    key: "certificates", header: "Certificates", sub: none, width: none,
    kind: variant("set", { register: "certificates", members: [], multiple: none, store: variant("asTyped", null) }),
    dataType: null, payloadType: null, editable: true, fill: [], detailCell: none,
}] as never).list[0]!;
const vocab = linkVocabulary(column, CERTIFICATES);
/** A set's halves: the destination, which it holds, alone. */
const SET: LinkHalves = { from: { live: false, lock: "" }, to: { live: true, lock: "" }, isIn: false, sides: "to" };

const identified = (key: string): SheetMemberValue => variant("identified", { key });
const text = (t: string): SheetMemberValue => variant("text", t);
const counted = (n: bigint, key: string): SheetMemberValue => variant("counted", { n, key });
const setCell = (members: SheetMemberValue[]): SheetCellValue => variant("Link", { from: [], to: members });

/** The set cell's link editor context, as the Sheet builds it: offered the members `allowed` names, else every one. */
function ctxOf(cell: SheetCellValue | undefined, allowed?: ReadonlySet<string>) {
    return linkEditCtx({
        vocab, offer: allowed !== undefined ? narrowVocabulary(vocab, allowed) : vocab, current: cell?.type === "Link" ? cell.value : undefined,
        halves: SET, predicted: () => undefined, driverName: undefined, words: SHEET_WORDS,
    });
}

describe("a set cell as tags (east-workspace#1741)", () => {
    test("its tags are its members as their chips print them, in order — a counted member and a text one among them; none for a cell with no link", () => {
        const cell = setCell([identified("Forklift"), counted(2n, "First aid"), text("Welding")]);
        expect(setTags(setMembers(cell))).toEqual(["Forklift", "2 × First aid", "Welding"]);
        expect(setTags(setMembers(undefined))).toEqual([]);
        expect(setTags(setMembers(variant("Null", null)))).toEqual([]);
    });

    test("a tag the cell held keeps its member whole; one taken away takes its member with it", () => {
        const cell = setCell([identified("Forklift"), counted(2n, "First aid"), text("Welding")]);
        const held = setMembers(cell);
        expect(setMembersOf(["Forklift", "2 × First aid", "Welding"], held, ctxOf(cell))).toEqual(held);
        expect(setMembersOf(["2 × First aid"], held, ctxOf(cell))).toEqual([counted(2n, "First aid")]);
        expect(setMembersOf(["Welding", "Forklift"], held, ctxOf(cell))).toEqual([text("Welding"), identified("Forklift")]);
    });

    test("a new tag is read as typing it in the cell reads it: the armed candidate where it completes the words, a key by itself, else the words as typed", () => {
        const cell = setCell([identified("Forklift")]);
        const ctx = ctxOf(cell);
        expect(setMembersOf(["Forklift", "first"], setMembers(cell), ctx)).toEqual([identified("Forklift"), identified("First aid")]);
        expect(setMembersOf(["Forklift", "confined space"], setMembers(cell), ctx)).toEqual([identified("Forklift"), identified("Confined space")]);
        expect(setMembersOf(["Forklift", "Welding"], setMembers(cell), ctx)).toEqual([identified("Forklift"), text("Welding")]);
        // A member is typed by its key, in any case, as in the cell — never by a label that is no key or alias of its own,
        // which is why its tags editor suggests it by key.
        expect(setMembersOf(["wah-2"], [], ctx)).toEqual([identified("WAH-2")]);
        expect(setMembersOf(["Working at height 2"], [], ctx)).toEqual([text("Working at height 2")]);
    });

    test("a candidate is never a member the tags before it name: `w` completes the first free one", () => {
        expect(setMembersOf(["Working at height", "w"], [], ctxOf(undefined))).toEqual([identified("Working at height"), identified("WAH-2")]);
    });

    test("typed words resolve against the whole register, past the members the row is offered", () => {
        const ctx = ctxOf(undefined, new Set(["Forklift"]));
        expect(setMembersOf(["Working at height"], [], ctx)).toEqual([identified("Working at height")]);
    });

    test("the cell its tags make: the set's half, beside what the other half holds — the blank cell once neither holds any", () => {
        const cell = setCell([identified("Forklift"), identified("Confined space")]);
        expect(setCellOf(["Confined space", "first"], cell, ctxOf(cell))).toEqual(setCell([identified("Confined space"), identified("First aid")]));
        expect(setCellOf([], cell, ctxOf(cell))).toBeNull();
        const both: SheetCellValue = variant("Link", { from: [identified("Forklift")], to: [identified("First aid")] });
        expect(setCellOf([], both, ctxOf(both))).toEqual(variant("Link", { from: [identified("Forklift")], to: [] }));
    });

    test("it suggests the members the row is offered that the cell does not hold, by key, in the register's order", () => {
        const cell = setCell([identified("Forklift")]);
        expect(setSuggestions(ctxOf(cell), setMembers(cell))).toEqual(["Confined space", "First aid", "Working at height", "WAH-2"]);
        expect(setSuggestions(ctxOf(cell, new Set(["WAH-2", "Forklift", "First aid"])), setMembers(cell))).toEqual(["WAH-2", "First aid"]);
        expect(setSuggestions(ctxOf(undefined), [])).toHaveLength(CERTIFICATES.length);
    });
});
