/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Find state's matching (#1245, `Flowchart Builder Spec.md` §7.1): the states
 * a query finds, in East's order of their keys — bare text a key's start or a
 * label's words, in any case; a quoted key that key alone; a range the keys in
 * it — and the line each state reads as in the search's list.
 */

import { describe, expect, test } from "vitest";
import { parseKeyInput } from "@elaraai/east-ui-components";
import { StringType, toEastTypeValue } from "@elaraai/east";
import { findStates, stateLine, type FindableState } from "./find.js";

const STATES: readonly FindableState[] = [
    { key: "SRD", label: "Sorted" },
    { key: "ARV", label: "Arrived" },
    { key: "CH*", label: "Sort chutes" },
    { key: "LDD", label: undefined },
    { key: "SCN", label: "Scanned" },
];

/** The keys a typed query finds, as the search's box parses it. */
function found(text: string): string[] {
    const parsed = parseKeyInput(toEastTypeValue(StringType), text);
    if (parsed.kind !== "query") throw new Error(`"${text}" is a hint: ${parsed.hint}`);
    return findStates(STATES, parsed.query).map((s) => s.key);
}

describe("find state (#1245)", () => {
    test("bare text finds a state whose key starts with it, in any case, in its keys' order", () => {
        expect(found("s")).toEqual(["CH*", "SCN", "SRD"]);
        expect(found("SC")).toEqual(["SCN"]);
        expect(found("ld")).toEqual(["LDD"]);
        // A key holding the text past its start is not found by it.
        expect(found("dd")).toEqual([]);
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

    test("text no key starts with and no label holds finds nothing", () => {
        expect(found("zz")).toEqual([]);
    });

    test("a state reads as its key, then its label when it has one", () => {
        expect(STATES.map(stateLine)).toEqual(["SRD · Sorted", "ARV · Arrived", "CH* · Sort chutes", "LDD", "SCN · Scanned"]);
    });
});
