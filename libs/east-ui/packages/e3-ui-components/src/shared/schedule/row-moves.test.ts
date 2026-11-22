/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows a gesture's changes move under the keys their fields build
 * (`rowMovesOf`, east-workspace#1709), asked before the gesture is recorded —
 * what the Flowchart and the Schematic ask — by the one rule every builder
 * follows. Each row here holds a code, which its key is built from; a row
 * whose code begins `!` fails as its key is built.
 */

import { describe, expect, test } from "vitest";
import { StringType, StructType, decodeBeast2For, encodeBeast2For } from "@elaraai/east";
import type { ScheduleChange } from "./editing.js";
import { rowMovesOf } from "./row-moves.js";

const Row = StructType({ code: StringType });
const encode = encodeBeast2For(Row);
const decode = decodeBeast2For(Row);

/** A row of a code, as its record holds it. */
const row = (code: string): Uint8Array => encode({ code });

/** The racks' key: a rack's code, and none for a code that begins `!`. */
const build = (bytes: Uint8Array): string => {
    const { code } = decode(bytes);
    if (code.startsWith("!")) throw new Error(`no key for ${code}`);
    return code;
};

/** The racks build their keys; the notes build none. */
const builderOf = (kind: string) => (kind === "racks" ? build : undefined);

/** What a gesture finds: the racks stored, each under the key given. */
const foundIn = (stored: Readonly<Record<string, string>>) => (kind: string, key: string): Uint8Array | undefined =>
    (kind === "racks" && key in stored ? row(stored[key]!) : undefined);

/** A rack written whole. */
const write = (id: string, code: string): ScheduleChange => ({ kind: "racks", id, row: row(code) });

describe("the rows a gesture's changes move under the keys their fields build (east-workspace#1709)", () => {
    test("a gesture touching no kind that builds its keys moves no row, and reads none", () => {
        const unread = (): Uint8Array | undefined => { throw new Error("read"); };
        expect(rowMovesOf([{ kind: "notes", id: "n1", row: row("A") }], unread, builderOf)).toEqual([]);
    });

    test("a row whose edit changes what its key reads moves under the key it then builds; one edited to another code that builds the key it stands under, and one stored apart from its key whose edit leaves what it builds as it was, stay", () => {
        const found = foundIn({ A: "A", OLD: "C" });
        expect(rowMovesOf([write("A", "B")], found, builderOf)).toEqual([{ kind: "racks", key: "A", to: "B" }]);
        expect(rowMovesOf([write("A", "A")], found, builderOf)).toEqual([]);
        // Stored under OLD, building C before the edit and after it: an app's own key, left where it is (#1581).
        expect(rowMovesOf([write("OLD", "C")], found, builderOf)).toEqual([]);
    });

    test("the changes compose in order over the row as the gesture finds it; a row removed, and one the gesture makes, move none; and the rows moved are said in the order the gesture touches them", () => {
        const found = foundIn({ A: "A", B: "B", C: "C" });
        const moves = rowMovesOf([
            { kind: "racks", id: "B", rewrite: (bytes) => row(`${decode(bytes).code}1`) },
            { kind: "racks", id: "A", rewrite: (bytes) => row(`${decode(bytes).code}1`) },
            { kind: "racks", id: "A", rewrite: (bytes) => row(`${decode(bytes).code}2`) },
            // A rewrite that refuses, and one that fails, leave the row as the gesture found it.
            { kind: "racks", id: "C", rewrite: () => undefined },
            { kind: "racks", id: "C", rewrite: () => { throw new Error("refused"); } },
            { kind: "racks", id: "made", row: row("M"), created: true },
        ], found, builderOf);
        expect(moves).toEqual([{ kind: "racks", key: "B", to: "B1" }, { kind: "racks", key: "A", to: "A12" }]);
        expect(rowMovesOf([write("A", "Z"), { kind: "racks", id: "A", remove: true }], found, builderOf)).toEqual([]);
    });

    test("a row its key was built none of as the gesture found it moves under the key the edit gives it, as in every builder", () => {
        expect(rowMovesOf([write("OLD", "A")], foundIn({ OLD: "!" }), builderOf)).toEqual([{ kind: "racks", key: "OLD", to: "A" }]);
    });

    test("a row its key fails on as the gesture leaves it refuses the gesture, as in every builder: it is named with what building its key threw, and no row's move is said", () => {
        const refused = rowMovesOf([write("A", "B"), write("C", "!")], foundIn({ A: "A", C: "C" }), builderOf);
        expect("failed" in refused && [refused.failed.kind, refused.failed.key, refused.failed.error instanceof Error]).toEqual(["racks", "C", true]);
    });
});
