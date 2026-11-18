/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A new row's key (`mintKey`, `records.ts`): a UUID, retried while it is
 * taken — the page's `crypto.randomUUID`'s, else, on a page served over plain
 * HTTP, which has none, one drawn from the page's random bytes (#1536).
 */
import { afterEach, expect, test, vi } from "vitest";
import { BlobType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, decodeBeast2For, equalFor, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui/internal";
import { fieldChange, fieldWrite, keyFieldWrite, laneFieldWrite, mintKey } from "./records.js";

/** A version 4 UUID, as `crypto.randomUUID` prints one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("a key the page's randomUUID gives, the next one while it is taken", () => {
    const offered = ["5d2a1c3e-0b4f-4a6d-8e7c-9f1b2a3c4d5e", "8f7e6d5c-4b3a-4291-a8b7-c6d5e4f3a2b1"];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => offered.shift() as ReturnType<typeof crypto.randomUUID>);
    expect(mintKey((key) => key === "5d2a1c3e-0b4f-4a6d-8e7c-9f1b2a3c4d5e")).toBe("8f7e6d5c-4b3a-4291-a8b7-c6d5e4f3a2b1");
});

test("a page with no randomUUID: a version 4 UUID from its random bytes, never one taken", () => {
    const page = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: <T extends ArrayBufferView>(bytes: T): T => page.getRandomValues(bytes as never) as T });
    const taken = new Set<string>();
    for (let i = 0; i < 64; i++) {
        const key = mintKey((k) => taken.has(k));
        expect(key).toMatch(UUID);
        expect(taken.has(key)).toBe(false);
        taken.add(key);
    }
});

// ── A form's edit as a field write (`fieldWrite`, `fieldChange`) ──────────────

const NoteRow = StructType({ title: StringType, sheets: FloatType, press: StructType({ hall: StringType, bay: IntegerType }) });
const noteRowType = toEastTypeValue(NoteRow);
/** The row's form, as `Fields` derives it: a spec for each field, a struct's own fields each at their path. */
const noteForm = Fields.specs(NoteRow);

test("fieldWrite writes a field its form names, at any depth, as bytes at the spec's type", () => {
    // The form names the bay inside the press: a path of two steps, which the row's own top-level fields do not give.
    expect(noteForm.some((spec) => spec.path.join(".") === "press.bay")).toBe(true);
    const write = fieldWrite(noteForm, noteRowType, ["press", "bay"], 7n);
    expect(write?.path).toEqual(["press", "bay"]);
    expect(equalFor(IntegerType)(decodeBeast2For(IntegerType)(write!.value), 7n)).toBe(true);
});

test("fieldWrite writes a top-level field its form does not name at the row's own type", () => {
    const write = fieldWrite([], noteRowType, ["sheets"], 1250.5);
    expect(write?.path).toEqual(["sheets"]);
    expect(equalFor(FloatType)(decodeBeast2For(FloatType)(write!.value), 1250.5)).toBe(true);
});

test("fieldWrite writes nothing for a path no field is at", () => {
    expect(fieldWrite([], noteRowType, ["missing"], "x")).toBeUndefined();
    // A nested path with no spec of its own names no field the row's type gives a write its type by.
    expect(fieldWrite([], noteRowType, ["press", "bay"], 7n)).toBeUndefined();
});

test("fieldChange is the kind's `field` gesture over the same write", () => {
    const kind = { key: "job", fields: noteForm, editing: { entryType: noteRowType } } as unknown as Parameters<typeof fieldChange>[0];
    const change = fieldChange(kind, "J-1", ["title"], "Annual report");
    const write = fieldWrite(kind.fields, noteRowType, ["title"], "Annual report")!;
    expect(change !== undefined && "gesture" in change && change.gesture.type === "field").toBe(true);
    if (change !== undefined && "gesture" in change && change.gesture.type === "field") {
        expect([change.kind, change.id, change.gesture.value.path]).toEqual(["job", "J-1", ["title"]]);
        expect(equalFor(BlobType)(change.gesture.value.value, write.value)).toBe(true);
    }
    expect(fieldChange(kind, "J-1", ["missing"], "x")).toBeUndefined();
});

// ── A key and a lane written into the fields that hold them (#1541, U1) ──────

const Kind = VariantType({ ink_fill: NullType, wash: NullType });
const Half = VariantType({ am: NullType, pm: NullType });
const Placed = StructType({ press: StringType, kind: Kind, spare: OptionType(Kind), count: OptionType(IntegerType), half: Half, bay: StringType });
const PLACED = toEastTypeValue(Placed);

test("a key's text is written into its field as the field holds it: a String as it is, any other read back as East prints it, `some` of it in an Option", () => {
    const press = keyFieldWrite(PLACED, "press", "P03")!;
    expect(press.path).toEqual(["press"]);
    expect(decodeBeast2For(StringType)(press.value)).toBe("P03");
    const kind = keyFieldWrite(PLACED, "kind", ".ink_fill")!;
    expect(equalFor(Kind)(decodeBeast2For(Kind)(kind.value), variant("ink_fill", null))).toBe(true);
    const spare = keyFieldWrite(PLACED, "spare", ".wash")!;
    expect(equalFor(OptionType(Kind))(decodeBeast2For(OptionType(Kind))(spare.value), some(variant("wash", null)))).toBe(true);
    const count = keyFieldWrite(PLACED, "count", "7")!;
    expect(equalFor(OptionType(IntegerType))(decodeBeast2For(OptionType(IntegerType))(count.value), some(7n))).toBe(true);
    expect(equalFor(OptionType(IntegerType))(decodeBeast2For(OptionType(IntegerType))(count.value), none)).toBe(false);
});

test("a key's text no key of the field's type prints as, and a field the row lacks, write nothing", () => {
    expect(keyFieldWrite(PLACED, "kind", "ink_fill")).toBeUndefined();
    expect(keyFieldWrite(PLACED, "count", "seven")).toBeUndefined();
    expect(keyFieldWrite(PLACED, "nope", "P03")).toBeUndefined();
});

test("a lane is written into its field: a String field's text, a variant field's case of that name", () => {
    const bay = laneFieldWrite(PLACED, "bay", "North")!;
    expect(bay.path).toEqual(["bay"]);
    expect(decodeBeast2For(StringType)(bay.value)).toBe("North");
    const half = laneFieldWrite(PLACED, "half", "pm")!;
    expect(equalFor(Half)(decodeBeast2For(Half)(half.value), variant("pm", null))).toBe(true);
    // A lane that is no case of the variant, and a field the row lacks, write nothing.
    expect(laneFieldWrite(PLACED, "half", "noon")).toBeUndefined();
    expect(laneFieldWrite(PLACED, "nope", "am")).toBeUndefined();
});
