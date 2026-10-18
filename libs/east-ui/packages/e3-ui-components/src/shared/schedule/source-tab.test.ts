/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A Library tab over a source of a builder's rail (#1341): the cards its source
 * shows, its count, what it says when the source empties it — with that
 * source's Clear filters — and its busy pane, over a source that narrows
 * nothing, one that narrows, one it empties, one not yet resolved and one
 * resolving.
 */
import { describe, expect, test, vi } from "vitest";
import { SortedSet, StringType, compareFor, none, some, type option } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { sourceTab, type SourceShown } from "./source-tab.js";

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
        expect([t.cards.map(card => card.id), t.count]).toEqual([["a", "c"], "2 of 3"]);
        expect(t.narrowing?.empty).toEqual({ title: "No trees match the filters", description: "Change or clear the filters to see more trees." });
        t.narrowing!.onClear();
        expect(clear).toHaveBeenCalledTimes(1);
    });

    test("a source that empties it: no card, `0 of 3`, its narrowing's words", () => {
        const t = tab(shown({ keys: keys(), clear: () => {} }));
        expect([t.cards, t.count, t.narrowing?.empty.title]).toEqual([[], "0 of 3", "No trees match the filters"]);
    });

    test("a narrowing not yet resolved: neither its own words nor the narrowing's — the rail's banner speaks for it", () => {
        const t = tab(shown({ keys: keys(), ready: false, clear: () => {} }));
        expect([t.narrowing, t.empty]).toEqual([undefined, undefined]);
    });

    test("a source with no part to clear says the tab's own words, and offers no Clear filters", () => {
        const t = tab(shown({ keys: keys("a") }));
        expect([t.count, t.narrowing, t.empty]).toEqual(["1 of 3", undefined, { title: "No trees" }]);
    });

    test("a source resolving, or whose read failed: its pane busy and taking no gesture", () => {
        expect(tab(shown({ keys: keys("a"), busy: true })).pane).toEqual({ "aria-busy": true, inert: true });
    });
});
