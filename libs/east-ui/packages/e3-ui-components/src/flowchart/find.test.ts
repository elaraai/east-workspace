/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the flowchart's modules load east-ui-components'
 * entry, which needs one as it loads.
 */

/**
 * Find state over the states the canvas draws (#1502, #1504): what a query
 * finds among them — a key's start, a quoted key, a range, and bare text in a
 * label — leaving out those the record's matches list; and how a found state
 * reads.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { parseKeyInput } from "@elaraai/east-ui-components";
import { StringType, toEastTypeValue } from "@elaraai/east";
import { drawnMatches, foundLine, type FindableState } from "./find.js";
import { words } from "./rows.test-utils.js";

const STATES: readonly FindableState[] = [
    { key: "SRD", label: "Sorted", dimmed: false },
    { key: "ARV", label: "Arrived", dimmed: false },
    { key: "CH*", label: "Sort chutes", dimmed: false },
    { key: "LDD", label: undefined, dimmed: false },
    { key: "SCN", label: "Scanned", dimmed: true },
];

/**
 * The keys a query finds among the drawn states.
 *
 * @param text - What is typed
 * @param listed - Whether the record's matches list a state already
 * @returns The keys found, in key order
 */
function found(text: string, listed: (key: string) => boolean = () => false): string[] {
    const parsed = parseKeyInput(toEastTypeValue(StringType), text);
    if (parsed.kind !== "query") throw new Error(`"${text}" is a hint: ${parsed.hint}`);
    return drawnMatches(STATES, parsed.query, "en-US", listed).map((s) => s.key);
}

describe("find state among the states drawn", () => {
    test("bare text finds a state whose key starts with it as e3 finds a key — in the key's own case — in its keys' order, one drawn as context among them", () => {
        expect(found("SC")).toEqual(["SCN"]);
        expect(found("LD")).toEqual(["LDD"]);
        expect(found("ld")).toEqual([]);
        // A key holding the text past its start is not found by it.
        expect(found("DD")).toEqual([]);
    });

    test("bare text finds a state whose label holds it, in any case", () => {
        expect(found("sort")).toEqual(["CH*", "SRD"]);
        expect(found("chutes")).toEqual(["CH*"]);
        expect(found("ED")).toEqual(["ARV", "SCN", "SRD"]);
    });

    test("a quoted key finds that state alone, and nothing else that starts with it", () => {
        expect(found('"SRD"')).toEqual(["SRD"]);
        expect(found('"SR"')).toEqual([]);
    });

    test("a range finds the keys in it, half open", () => {
        expect(found("ARV..LDD")).toEqual(["ARV", "CH*"]);
        expect(found("SCN..")).toEqual(["SCN", "SRD"]);
    });

    test("a state its key finds that the record's matches list is left to them: it is found once", () => {
        expect(found("SC", (key) => key === "SCN")).toEqual([]);
        // SCN's key is left to the record's matches; CH* is found by its label.
        expect(found("S", (key) => key === "SCN")).toEqual(["CH*", "SRD"]);
    });

    test("text no key starts with and no label holds finds nothing", () => {
        expect(found("zz")).toEqual([]);
    });

    test("a found state reads as its key, then its label where it is not its key", () => {
        const line = (key: string, label: string | undefined) => foundLine({ key, label, hidden: undefined }, words, false);
        expect(line("SRD", "Sorted")).toBe("SRD · Sorted");
        expect(line("LDD", undefined)).toBe("LDD");
        expect(line("LDD", "LDD")).toBe("LDD");
    });
});
