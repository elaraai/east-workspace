/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Library virtual entry model (#258) — the pure chunking that lets ONE
 * virtualization path cover both layouts: `libraryColumnsFor` mirrors the CSS
 * `repeat(auto-fill, minmax(220px, 1fr))` arithmetic, `libraryEntries`
 * flattens groups into `groupHead | cardRow` entries (flat layout = zero
 * heads). Pure over decoded values.
 */

import { describe, test, expect } from "vitest";
import { libraryColumnsFor, libraryEntries, type LibraryGroup, type LibraryItemValue } from "./index.js";

const item = (key: string) => ({ key } as unknown as LibraryItemValue);
const items = (n: number, prefix = "i") => Array.from({ length: n }, (_v, i) => item(`${prefix}${i}`));

describe("libraryColumnsFor — the auto-fill arithmetic", () => {
    test("narrow container clamps to one column", () => {
        expect(libraryColumnsFor(0)).toBe(1);
        expect(libraryColumnsFor(200)).toBe(1);
    });

    test("two columns exactly at 2·220 + gap + padding", () => {
        // inner = width - 32; needs inner + 12 >= 2 * 232 → width >= 484
        expect(libraryColumnsFor(483)).toBe(1);
        expect(libraryColumnsFor(484)).toBe(2);
    });

    test("wide container packs more columns", () => {
        expect(libraryColumnsFor(1000)).toBe(4);
    });
});

describe("libraryEntries — flat layout (the degenerate single '' group)", () => {
    test("no group heads; items chunk into rows of `columns`", () => {
        const groups: LibraryGroup[] = [{ label: "", summary: undefined, items: items(7) }];
        const entries = libraryEntries(groups, 3);
        expect(entries.map(e => e.kind)).toEqual(["cardRow", "cardRow", "cardRow"]);
        expect(entries.map(e => (e.kind === "cardRow" ? e.items.length : 0))).toEqual([3, 3, 1]);
    });

    test("exact multiple leaves no ragged row", () => {
        const entries = libraryEntries([{ label: "", summary: undefined, items: items(6) }], 3);
        expect(entries).toHaveLength(2);
        expect(entries.every(e => e.kind === "cardRow" && e.items.length === 3)).toBe(true);
    });

    test("columns below one clamp to one card per row", () => {
        const entries = libraryEntries([{ label: "", summary: undefined, items: items(3) }], 0);
        expect(entries).toHaveLength(3);
    });
});

describe("libraryEntries — grouped layout", () => {
    test("each labelled group contributes a head then its chunked rows, order preserved", () => {
        const groups: LibraryGroup[] = [
            { label: "EMEA", summary: "5 people", items: items(5, "e") },
            { label: "APAC", summary: undefined, items: items(2, "a") },
        ];
        const entries = libraryEntries(groups, 2);
        expect(entries.map(e => e.kind)).toEqual([
            "groupHead", "cardRow", "cardRow", "cardRow",
            "groupHead", "cardRow",
        ]);
        const head = entries[0]!;
        expect(head.kind === "groupHead" && head.label).toBe("EMEA");
        expect(head.kind === "groupHead" && head.summary).toBe("5 people");
        expect(head.kind === "groupHead" && head.count).toBe(5);
        const ragged = entries[3]!;
        expect(ragged.kind === "cardRow" && ragged.items.map(i => i.key)).toEqual(["e4"]);
    });

    test("an empty group still renders its head (zero card rows)", () => {
        const entries = libraryEntries([{ label: "Empty", summary: undefined, items: [] }], 3);
        expect(entries.map(e => e.kind)).toEqual(["groupHead"]);
    });

    test("re-chunking with a different column count preserves card order", () => {
        const groups: LibraryGroup[] = [{ label: "G", summary: undefined, items: items(5) }];
        const flatten = (columns: number) => libraryEntries(groups, columns)
            .flatMap(e => (e.kind === "cardRow" ? e.items.map(i => i.key) : []));
        expect(flatten(2)).toEqual(flatten(4));
    });
});
