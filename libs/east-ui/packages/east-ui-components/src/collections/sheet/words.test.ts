/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Sheet's words (#861): the message a gesture leaves is worded where it
 * shows, the renderer's own issues cross the wire in English and read back in
 * the table's words, and every pure helper speaks the words it is handed —
 * never a table of its own.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { sheetMessages, type SheetMessages } from "./messages.js";
import { ISSUE_TEXT, SESSION_TEXT, SHEET_WORDS, issueText, noticeText, rowRefText, sessionErrorText, sheetWords } from "./words.js";
import { lensCount, viewName } from "./lens.js";
import { countNoun, indexColumns } from "./model.js";
import { actualAgainst, formatWhen, whenAccepts } from "./parse/date.js";
import { cellDetail } from "./detail.js";
import { arityMeta } from "./link/arity.js";
import { existsFlag } from "./link/checks.js";
import { linkVocabulary, memberMeta } from "./link/grammar.js";
import { grammarLine, linkCandidates, linkEntryCandidates } from "./link/predict.js";
import type { SheetCellValue, SheetMemberValue, SheetRegisterMemberValue } from "./values.js";

/** The English table with every message marked `⟦` — a word without the mark did not come from the table handed in. */
const MARKED = Object.fromEntries(Object.entries(sheetMessages).map(([k, f]) =>
    [k, (p: never) => `⟦${(f as (p: never) => string)(p)}`])) as unknown as SheetMessages;
const W = sheetWords("en-US", MARKED);

const member = (key: string, kind: string, meta?: string): SheetRegisterMemberValue => ({
    key, label: key, kind, aliases: [], meta: meta !== undefined ? some(meta) : none, parent: none, tone: none,
}) as SheetRegisterMemberValue;
const MEMBERS = [member("M2140", "machine", "CNC lathe"), member("M2141", "machine", "CNC lathe"), member("M2145", "machine", "CNC lathe"), member("CNC lathe", "family", "family")];
const STATIONS = indexColumns([{
    key: "stations", header: "Work centres", sub: none, width: none,
    kind: { type: "link", value: {
        register: "stations",
        members: [
            { kind: "machine", identified: true, countable: false, resolvesTo: none, ranged: true },
            { kind: "range", identified: true, countable: false, resolvesTo: none, ranged: false },
            { kind: "family", identified: false, countable: true, resolvesTo: some("machine"), ranged: false },
        ],
        multiple: some({ forms: ["N x kind"], ops: ["x"], appliesTo: "countable" }),
        sides: none, arity: none, check: [], store: { type: "asTyped", value: null }, options: none,
    } },
    dataType: null, payloadType: null, editable: true, fill: [], detailCell: none,
}] as never).list[0]!;
const VOCAB = linkVocabulary(STATIONS, MEMBERS);
const START = indexColumns([{
    key: "start", header: "Start", sub: none, width: none,
    kind: { type: "date", value: { base: none, format: none, level: none, actual: some("$actual:start") } },
    dataType: null, payloadType: null, editable: true, fill: [], detailCell: none,
}] as never).list[0]!;
const cell = (type: string, value: unknown): SheetCellValue => variant(type, value) as SheetCellValue;
const m = (type: string, value: unknown): SheetMemberValue => variant(type, value) as SheetMemberValue;
const DAY = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("the message a gesture leaves (#861)", () => {
    test("is worded where it shows: a noun the host names, else the table's own; a row by its number", () => {
        expect(noticeText({ id: "groupsFolded", n: 2, noun: undefined, nouns: undefined }, SHEET_WORDS))
            .toBe("Folded 2 groups — the corner, ⌥ on a chevron or ⇧Space opens them");
        expect(noticeText({ id: "groupsFolded", n: 1, noun: "order", nouns: "orders" }, SHEET_WORDS))
            .toBe("Folded 1 order — the corner, ⌥ on a chevron or ⇧Space opens them");
        expect(noticeText({ id: "lockedHalf", driver: undefined }, SHEET_WORDS)).toBe("This row has no destination — kept, but flagged");
        expect(noticeText({ id: "rowFilled", n: 1, row: { line: true, number: 2, title: undefined, noun: undefined } }, SHEET_WORDS))
            .toBe("Filled 1 cell on line 2 of the group");
        expect(rowRefText({ line: true, number: 3, title: "Line 2 week 8", noun: "plan" }, SHEET_WORDS)).toBe("line 3 of Line 2 week 8");
        expect(rowRefText({ line: false, number: 12 }, SHEET_WORDS)).toBe("row 12");
    });

    test("in the table handed in, its counts in the locale", () => {
        const german = sheetWords("de-DE", {
            ...sheetMessages,
            groupNouns: () => "Gruppen",
            countNoun: ({ count, nouns }) => `${count} ${nouns}`,
            noticeGroupsFolded: ({ groups }) => `${groups} eingeklappt`,
        });
        expect(noticeText({ id: "groupsFolded", n: 2, noun: undefined, nouns: undefined }, german)).toBe("2 Gruppen eingeklappt");
        expect(noticeText({ id: "pasted", rows: 1200, cols: 3, skipped: 2 }, sheetWords("de-DE", sheetMessages)))
            .toBe("Pasted 1.200×3 from clipboard · 2 unrecognised");
        expect(noticeText({ id: "issue", where: "qty", message: ISSUE_TEXT.required }, W)).toBe("⟦qty: ⟦A value is required");
        // Words that are not the sheet's own show as written.
        expect(noticeText({ id: "text", text: "Host refused" }, W)).toBe("Host refused");
    });
});

describe("the renderer's own issues (#861)", () => {
    test("cross the wire in English, and show in the table's words; an author's show as written", () => {
        const forms = [ISSUE_TEXT.required, ISSUE_TEXT.invalid("1.5"), ISSUE_TEXT.author("incomplete"), ISSUE_TEXT.rowCheck("boom"), ISSUE_TEXT.groupCheck("bang")];
        expect(forms).toEqual(["A value is required", "Invalid input: 1.5", "Author check reports incomplete", "Row readiness failed: boom", "Group readiness failed: bang"]);
        expect(forms.map((f) => issueText(f, W))).toEqual([
            "⟦A value is required", "⟦Invalid input: 1.5", "⟦Author check reports incomplete", "⟦Row readiness failed: boom", "⟦Group readiness failed: bang",
        ]);
        expect(forms.map((f) => issueText(f, SHEET_WORDS))).toEqual(forms);
        expect(issueText("Quantity needs approval", W)).toBe("Quantity needs approval");
        expect(sessionErrorText(SESSION_TEXT.noRevision, W)).toBe(`⟦${SESSION_TEXT.noRevision}`);
        expect(sessionErrorText("Acknowledgement lost", W)).toBe("Acknowledgement lost");
    });
});

describe("every helper speaks the words it is handed (#861)", () => {
    test("the lens, a view's name, a count of groups", () => {
        expect(lensCount([true, false], [true, true], W)).toBe("⟦1 match · 1 context");
        expect(viewName("", 2, (seq) => W.m.viewName({ seq: String(seq) }))).toBe("⟦view 2");
        expect(countNoun(2, { singular: "order", plural: "orders" }, W)).toBe("⟦2 orders");
    });

    test("dates at a level, and a cell's detail", () => {
        expect(formatWhen(DAY("2026-02-18"), "week", W)).toEqual({ text: "16/02/26", suffix: "⟦wk" });
        expect(whenAccepts("day", W)).toEqual({ chip: "⟦a day", meta: "⟦22/3 · fri · +3d" });
        expect(actualAgainst(DAY("2026-02-16"), "day", DAY("2026-02-18"), W)).toEqual({ tag: "⟦+2d", tone: "late", words: "⟦2 days late" });
        const cells = new Map<string, SheetCellValue>([["start", cell("DateTime", DAY("2026-02-16"))], ["$actual:start", cell("DateTime", DAY("2026-02-18"))]]);
        const detail = cellDetail(START, cells, W)!;
        expect([...detail.chips, detail.meta, detail.title].every((s) => s.startsWith("⟦"))).toBe(true);
    });

    test("the link cell's metas, flags, candidates and grammar line", () => {
        expect(arityMeta({ n: 4, key: "CNC lathe" }, 3, W)).toBe("⟦4 × CNC lathe implied · 3 named so far");
        expect(memberMeta(m("counted", { n: 2n, key: "CNC lathe" }), VOCAB, W)).toBe("⟦unassigned");
        expect(memberMeta(m("range", { from: "M2140", to: "M2145" }), VOCAB, W)).toBe("⟦3 machines");
        expect(existsFlag(m("identified", { key: "M9999" }), VOCAB, W.m)).toBe("⟦M9999 is not in the register");
        const none_ = new Set<string>();
        expect(linkCandidates("M2140-45", VOCAB, none_, W)[0]!.meta).toBe("⟦→ 3 machines: M2140, M2141, M2145");
        expect(linkCandidates("cnc", VOCAB, none_, W).map((c) => c.meta)).toEqual(["family", "⟦enumerate · 3 members"]);
        expect(linkCandidates("tb", VOCAB, none_, W)[0]).toMatchObject({ label: "TBC", meta: "⟦to confirm" });
        expect(linkEntryCandidates(VOCAB, none_, W)[0]).toMatchObject({ label: "M2140-M2141", meta: "⟦2 machines" });
        // The grammar's own token stays as it is typed.
        expect(grammarLine(VOCAB, W)).toBe("⟦machine code · family · ⟦N x kind · ⟦a range · TBC");
    });
});
