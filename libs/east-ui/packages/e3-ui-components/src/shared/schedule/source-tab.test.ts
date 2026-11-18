/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A Library tab over a source of a builder's rail (#1341): the cards its source
 * shows, its count, what it says when the source empties it — with that
 * source's Clear filters — and its busy pane, over a source that narrows
 * nothing, one that narrows, one it empties, one not yet resolved and one
 * resolving. And a tab over several sources (#1345), each card its own
 * source's.
 */
import { describe, expect, test, vi } from "vitest";
import { SortedSet, StringType, compareFor, none, some, type option } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { sourceTab, sourcesTab, type SourceShown } from "./source-tab.js";
import { shownWhole } from "./visibility.js";

const words = formatters("en-US");
const CARDS = [{ id: "a", label: "Alder" }, { id: "b", label: "Birch" }, { id: "c", label: "Cedar" }] as const;
const keys = (...ids: string[]): option<Set<string>> => some(new SortedSet(ids, compareFor(StringType)));
const tab = (shown: SourceShown) => sourceTab({ cards: CARDS, keyOf: card => card.id, shown, noun: "trees", words });
const shown = (fields: Partial<SourceShown>): SourceShown => ({ keys: none, busy: false, ready: true, clear: undefined, ...fields });

describe("a source's tab (#1341)", () => {
    test("a source that narrows nothing: every card, its count alone, its own empty words, no narrowing, an idle pane", () => {
        const t = tab(shown({ clear: () => {} }));
        expect([t.cards, t.count, t.narrowing, t.empty, t.pane]).toEqual([CARDS, 3, undefined, { title: "No trees" }, {}]);
    });

    test("a source that narrows: the cards it shows in their order, `2 of 3`, and its narrowing's words with that source's Clear filters", () => {
        const clear = vi.fn();
        const t = tab(shown({ keys: keys("c", "a"), clear }));
        expect([t.cards.map(card => card.id), t.count, t.narrowing?.emptied]).toEqual([["a", "c"], "2 of 3", false]);
        expect(t.narrowing?.empty).toEqual({ title: "No trees match the filters", description: "Change or clear the filters to see more trees." });
        t.narrowing?.onClear?.();
        expect(clear).toHaveBeenCalledTimes(1);
    });

    test("a source that empties it: no card, `0 of 3`, its narrowing's words, emptied — said above any card the source does not touch (#1342)", () => {
        const t = tab(shown({ keys: keys(), clear: () => {} }));
        expect([t.cards, t.count, t.narrowing?.empty.title, t.narrowing?.emptied]).toEqual([[], "0 of 3", "No trees match the filters", true]);
    });

    test("a narrowing not yet resolved: neither its own words nor the narrowing's — the rail's banner speaks for it", () => {
        const t = tab(shown({ keys: keys(), ready: false, clear: () => {} }));
        expect([t.narrowing, t.empty]).toEqual([undefined, undefined]);
    });

    test("a source with no part to clear says the tab's own words, and offers no Clear filters", () => {
        const t = tab(shown({ keys: keys("a") }));
        expect([t.count, t.narrowing, t.empty]).toEqual(["1 of 3", undefined, { title: "No trees" }]);
    });

    test("a source resolving, or whose read failed: its pane busy and its cards retained (#1398, CL8) — aria-disabled, never inert", () => {
        expect(tab(shown({ keys: keys("a"), busy: true })).pane).toEqual({ "aria-busy": true, "aria-disabled": true });
    });
});

describe("a source its page scopes (#1621)", () => {
    test("with no choice of the viewer's: the scope's cards, counted alone — never `2 of 3` — and no narrowing, no Clear filters", () => {
        const clear = vi.fn();
        const t = tab(shown({ keys: keys("a", "c"), chosen: false, held: some(2), clear }));
        expect([t.cards.map(card => card.id), t.count, t.narrowing, t.empty]).toEqual([["a", "c"], 2, undefined, { title: "No trees" }]);
    });

    test("a scope that holds none of the cards: the tab's own plain words, and no Clear filters, which could not clear the scope", () => {
        const t = tab(shown({ keys: keys(), chosen: false, held: some(0), clear: () => {} }));
        expect([t.cards, t.count, t.narrowing, t.empty]).toEqual([[], 0, undefined, { title: "No trees" }]);
    });

    test("a choice of the viewer's beside the scope: counted out of the cards the scope holds, and its Clear filters offered", () => {
        const clear = vi.fn();
        const t = tab(shown({ keys: keys("c"), chosen: true, held: some(2), clear }));
        expect([t.cards.map(card => card.id), t.count, t.narrowing?.emptied]).toEqual([["c"], "1 of 2", false]);
        t.narrowing?.onClear?.();
        expect(clear).toHaveBeenCalledTimes(1);
        // While the scope's own count is read, the count waits on it.
        expect(tab(shown({ keys: keys("c"), chosen: true, held: none, clear })).count).toBe("…");
    });

    test("a source counts once, however many of the tab's lists follow it: a scoped one as its page holds, any other as its cards, a card of none as itself", () => {
        const scoped = shown({ keys: keys("a"), chosen: true, held: some(2), clear: () => {} });
        // `a` shows, `b` is out of the choice, `c` follows no source: 2 of the scope's 2 and `c`.
        const t = sourcesTab({ cards: CARDS, keyOf: card => card.id, sources: [scoped, scoped], sourceOf: card => card.id === "c" ? undefined : scoped, noun: "trees", words });
        expect(t.count).toBe("2 of 3");
        // Two lists that follow one source that narrows nothing — the Sheet's lists of a source it does not follow — count its cards once.
        const narrowing = shown({ keys: keys("a"), clear: () => {} }), whole = shown({});
        const both = sourcesTab({ cards: CARDS, keyOf: card => card.id, sources: [narrowing, whole, whole], sourceOf: card => card.id === "c" ? whole : narrowing, noun: "trees", words });
        expect(both.count).toBe("2 of 3");
    });
});

describe("what a count of a source's rows is out of (#1621)", () => {
    test("the rows its page holds where a scope narrows it, none while that count is read, else every row", () => {
        expect([shownWhole({ held: some(4) }, 40), shownWhole({ held: none }, 40), shownWhole({ held: undefined }, 40), shownWhole({}, 40)]).toEqual([4, undefined, 40, 40]);
    });
});

describe("a tab over several sources (#1345)", () => {
    /** Two templates lists, each its own source, and a card no source touches. */
    const LISTED = [
        { id: "a", list: "first" }, { id: "b", list: "first" }, { id: "x", list: "second" }, { id: "y", list: "second" }, { id: "z", list: "none" },
    ] as const;
    const several = (first: SourceShown, second: SourceShown) => sourcesTab({
        cards: LISTED, keyOf: card => card.id, sources: [first, second],
        sourceOf: card => (card.list === "first" ? first : card.list === "second" ? second : undefined), noun: "templates", words,
    });

    test("each card follows its own source: a source that narrows nothing shows its every card, and so does a card of none; the count is over every card", () => {
        const t = several(shown({ keys: keys("b"), clear: () => {} }), shown({ clear: () => {} }));
        expect([t.cards.map(card => card.id), t.count, t.narrowing?.emptied]).toEqual([["b", "x", "y", "z"], "4 of 5", false]);
    });

    test("emptied when no card of a narrowing source shows, the others still showing; its Clear filters clears each narrowing source alone", () => {
        const first = vi.fn(), second = vi.fn();
        const both = several(shown({ keys: keys(), clear: first }), shown({ keys: keys(), clear: second }));
        expect([both.cards.map(card => card.id), both.count, both.narrowing?.emptied, both.narrowing?.empty.title]).toEqual([["z"], "1 of 5", true, "No templates match the filters"]);
        both.narrowing?.onClear?.();
        expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
        // One source emptied, the other narrowing nothing: emptied, the other's cards shown — and only the narrowing source clears.
        const only = vi.fn(), untouched = vi.fn();
        const one = several(shown({ keys: keys(), clear: only }), shown({ clear: untouched }));
        expect([one.cards.map(card => card.id), one.count, one.narrowing?.emptied]).toEqual([["x", "y", "z"], "3 of 5", true]);
        one.narrowing?.onClear?.();
        expect([only.mock.calls.length, untouched.mock.calls.length]).toEqual([1, 0]);
    });

    test("not emptied while any narrowing source shows a card of its own", () => {
        const t = several(shown({ keys: keys(), clear: () => {} }), shown({ keys: keys("y"), clear: () => {} }));
        expect([t.cards.map(card => card.id), t.count, t.narrowing?.emptied]).toEqual([["y", "z"], "2 of 5", false]);
    });

    test("until every narrowing source resolves an empty tab says nothing of its own; a source resolving makes the pane busy", () => {
        const t = several(shown({ keys: keys("a"), ready: false, clear: () => {} }), shown({ keys: keys("x"), clear: () => {} }));
        expect([t.empty, t.narrowing?.emptied]).toEqual([undefined, false]);
        expect(several(shown({ busy: true }), shown({})).pane).toEqual({ "aria-busy": true, "aria-disabled": true });
        expect(several(shown({}), shown({})).pane).toEqual({});
    });
});
