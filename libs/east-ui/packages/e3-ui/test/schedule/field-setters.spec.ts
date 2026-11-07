/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// A row's fields written by their paths (#1390), through a variant's case too
// (#1549): a setter for every field at any depth and for every value a case
// holding data holds — never below an Option — each rebuilding what is down
// its path from the leaf up while the variant holds that case, and leaving the
// row as it was while it holds another.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    encodeBeast2For, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { fieldSetters } from "@elaraai/e3-ui/internal";

// A joinery piece: its finish bare, a stain of a shade, or a paint of a colour, its coats and its gloss — matt, or a
// sheen of a level; a spare finish, an Option; and the bench it sits on.
const Gloss = VariantType({ matt: NullType, sheen: FloatType });
const Finish = VariantType({ bare: NullType, stain: StringType, paint: StructType({ colour: StringType, coats: IntegerType, gloss: Gloss }) });
const Piece = StructType({ name: StringType, finish: Finish, spare: OptionType(Finish), site: StructType({ bench: IntegerType }) });
type PieceValue = ValueTypeOf<typeof Piece>;

const pieceEqual = equalFor(Piece);
const printPiece = printFor(Piece);
const SETTERS = fieldSetters(Piece);

const pathEqual = equalFor(ArrayType(StringType));

/** Writes a value's bytes through the setter at a path: the row it leaves. */
function write(path: readonly string[], bytes: Uint8Array, row: PieceValue): PieceValue {
    const setter = SETTERS.find((s) => pathEqual([...s.path], [...path]));
    assert.ok(setter !== undefined, `no setter at ${path.join(".")}`);
    const set = East.compile(setter.set as never, []) as (row: PieceValue, bytes: Uint8Array) => PieceValue;
    return set(row, bytes);
}

/** The rows are equal, as East compares them. */
function assertPiece(actual: PieceValue, expected: PieceValue): void {
    assert.ok(pieceEqual(actual, expected), `wrote\n${printPiece(actual)}\nexpected\n${printPiece(expected)}`);
}

const PAINTED: PieceValue = {
    name: "Door",
    finish: variant("paint", { colour: "Teal", coats: 2n, gloss: variant("sheen", 0.4) }),
    spare: some(variant("stain", "Oak")),
    site: { bench: 9n },
};
const STAINED: PieceValue = { ...PAINTED, finish: variant("stain", "Walnut") };

test("a setter for every field and every value a case holding data holds, in the row's order — none below an Option", () => {
    assert.ok(equalFor(ArrayType(ArrayType(StringType)))(SETTERS.map((s) => [...s.path]), [
        ["name"],
        ["finish"],
        // East keeps a variant's cases in name order; an empty case holds nothing to set.
        ["finish", "paint"],
        ["finish", "paint", "colour"],
        ["finish", "paint", "coats"],
        ["finish", "paint", "gloss"],
        ["finish", "paint", "gloss", "sheen"],
        ["finish", "stain"],
        ["spare"],
        ["site"],
        ["site", "bench"],
    ]));
});

test("a setter through a case rebuilds the variant while it holds that case, every other field as it was", () => {
    assertPiece(write(["finish", "paint", "coats"], encodeBeast2For(IntegerType)(3n), PAINTED), {
        ...PAINTED, finish: variant("paint", { colour: "Teal", coats: 3n, gloss: variant("sheen", 0.4) }),
    });
    // Two cases down: the paint's gloss's sheen.
    assertPiece(write(["finish", "paint", "gloss", "sheen"], encodeBeast2For(FloatType)(0.8), PAINTED), {
        ...PAINTED, finish: variant("paint", { colour: "Teal", coats: 2n, gloss: variant("sheen", 0.8) }),
    });
    assertPiece(write(["finish", "stain"], encodeBeast2For(StringType)("Oak"), STAINED), { ...STAINED, finish: variant("stain", "Oak") });
    // The variant whole, another case chosen.
    assertPiece(write(["finish"], encodeBeast2For(Finish)(variant("bare", null)), PAINTED), { ...PAINTED, finish: variant("bare", null) });
    // An Option's value is set whole, and a struct's field as before.
    assertPiece(write(["spare"], encodeBeast2For(OptionType(Finish))(none), PAINTED), { ...PAINTED, spare: none });
    assertPiece(write(["site", "bench"], encodeBeast2For(IntegerType)(10n), PAINTED), { ...PAINTED, site: { bench: 10n } });
});

test("while the variant holds another case, a setter through a case leaves the row as it was", () => {
    assertPiece(write(["finish", "paint", "coats"], encodeBeast2For(IntegerType)(3n), STAINED), STAINED);
    assertPiece(write(["finish", "stain"], encodeBeast2For(StringType)("Oak"), PAINTED), PAINTED);
    // The paint held, its gloss matt: the sheen's setter leaves it matt.
    const matt: PieceValue = { ...PAINTED, finish: variant("paint", { colour: "Teal", coats: 2n, gloss: variant("matt", null) }) };
    assertPiece(write(["finish", "paint", "gloss", "sheen"], encodeBeast2For(FloatType)(0.8), matt), matt);
});
