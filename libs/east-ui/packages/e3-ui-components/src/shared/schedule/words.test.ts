/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The schedule builders' shared words: a count and what it counts, a
 * dimming builder's words for a row its narrowing leaves out, what a line
 * says of a row that stands on one its page does not hold, and what a
 * refusal says of a kind its page's scope holds only some rows of.
 */
import { describe, expect, test } from "vitest";
import { dimmedWords, hiddenByText, notOnPageText, plural, unheldByScopeText, type DimmedWords } from "./words.js";

describe("plural — a count and what it counts", () => {
    test("one is the word itself, any other count its English plural — never the word with an s put after it: `1 gap`, `4 breaches`", () => {
        expect([0, 1, 2].map((n) => plural(n, "issue"))).toEqual(["0 issues", "1 issue", "2 issues"]);
        expect([1, 0, 3].map((n) => plural(n, "gap"))).toEqual(["1 gap", "0 gaps", "3 gaps"]);
        expect([1, 4].map((n) => plural(n, "breach"))).toEqual(["1 breach", "4 breaches"]);
        expect([1, 2].map((n) => plural(n, "duty"))).toEqual(["1 duty", "2 duties"]);
    });
});

describe("dimmedWords — a dimming builder's words, as the hidden pick's line takes them", () => {
    // A builder's message table, as the Flowchart's and the Schematic's hold their dimmed words.
    const table: DimmedWords = {
        dimmedByFilters: () => "dimmed by the rail",
        dimmedBy: ({ filters, also }) => hiddenByText(filters, also, "dimmed"),
    };

    test("the table's dimmed words stand where a line takes its hidden ones: the choices dim the row, never hide it", () => {
        const words = dimmedWords(table);
        expect(words.hiddenByFilters()).toBe("dimmed by the rail");
        expect(words.hiddenBy({ filters: ["Status: Ready"], also: [] })).toBe("dimmed by Status: Ready — picking it clears that filter");
        expect(words.hiddenBy({ filters: ["Status: Ready", "Owner: Harbour Labs"], also: ["Hall: A"] }))
            .toBe("dimmed by Status: Ready; Owner: Harbour Labs — picking it clears those filters, and Hall: A with them");
    });
});

describe("notOnPageText — a line's words for a row that stands on one its page's scope does not hold (#1621)", () => {
    test("the row itself is not on this page; what it stands on is named as the builder names it, one or several", () => {
        expect(notOnPageText([])).toBe("not on this page");
        expect(notOnPageText(["crew"])).toBe("its crew is not on this page");
        expect(notOnPageText(["lane", "arrival"])).toBe("its lane and arrival are not on this page");
    });

    test("after the choices that hide it too, which a pick still clears", () => {
        expect(notOnPageText(["crew"], hiddenByText(["Status: Ready"], [])))
            .toBe("hidden by Status: Ready — picking it clears that filter; its crew is not on this page");
    });

    test("of the page alone it names no filter and no Clear: a scope is no choice of the viewer's", () => {
        expect(notOnPageText(["crew"])).not.toMatch(/filter|clear|hidden|rail/i);
        expect(notOnPageText([])).not.toMatch(/filter|clear|hidden|rail/i);
    });
});

describe("unheldByScopeText — a refusal's words for a kind its page's scope holds only some rows of (#1621)", () => {
    test("names the page and where the edit can be made, in the kind's plural as the builder words it", () => {
        expect(unheldByScopeText("transitions")).toBe("this page holds only some transitions, and one it does not may name it — edit it where they are all held");
        expect(unheldByScopeText("ropes")).toBe("this page holds only some ropes, and one it does not may name it — edit it where they are all held");
    });

    test("names no filter and no Clear: a scope is no choice of the viewer's, and nothing on the rail clears it", () => {
        expect(unheldByScopeText("ropes")).not.toMatch(/filter|clear|rail/i);
    });
});
