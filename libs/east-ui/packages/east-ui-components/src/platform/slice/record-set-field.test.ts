/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A Set field's narrowing takes one value. An index files a row under each
 * member of its Set, so two values' rows would hold a row twice: the record
 * Slice reads a Set field by exactly one value, and refuses more — a choice of
 * two, and a narrowing written whole that holds two, as a saved view's is.
 * Asked through the record arm's own operations, as a handle's methods call
 * them, so the refusal is the controller's and no control's.
 */

import { beforeEach, describe, expect, test } from "vitest";
import { SetType, StringType, StructType, equalFor, none, printFor, variant } from "@elaraai/east";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { recordArm, recordState } from "./record-arm.test-utils.js";
import { initializeStore } from "../state-runtime.js";
import { UIStore } from "../state-store.js";

const sameWhere = equalFor(RecordSliceWhereType);
const print = printFor(StringType);
/** A narrowing of the staff's skills to some, each as its `.east` literal. */
const skilled = (...skills: string[]) => recordState({ where: new Map([["skills", variant("values", skills.map(skill => print(skill)))]]), preset: none, resolution: none }).where;

/** The staff, each holding a Set of skills, which the Slice offers through the index that files a person under each. */
const { op, read } = recordArm(StructType({ name: StringType, skills: SetType(StringType) }), {
    fields: [{ fieldId: "skills", label: "Skills", kind: "string", optional: false, multiple: false, set: true, values: [], format: none }],
    indexes: [{ name: "by_skill", fields: ["skills"], sets: new Set(["skills"]), structured: false, interval: none, area: none, series: none, summary: none, entries: false }],
    range: none, search: ["skills"], presets: [], scope: new Map(),
}, recordState({ where: new Map(), preset: none, resolution: none }));

describe("a record Slice — a Set field's narrowing takes one value", () => {
    beforeEach(() => { initializeStore(new UIStore()); });

    test("one value is chosen, and a second choice replaces it", () => {
        op("choose", "staff.one", "skills", [print("Forklift")]);
        expect(sameWhere(read("staff.one").where, skilled("Forklift"))).toBe(true);
        op("choose", "staff.one", "skills", [print("First aid")]);
        expect(sameWhere(read("staff.one").where, skilled("First aid"))).toBe(true);
    });

    test("two values at once are refused — by a choice, and by a narrowing written whole, as a saved view's is — and what was chosen stands", () => {
        op("choose", "staff.two", "skills", [print("Forklift")]);
        expect(() => op("choose", "staff.two", "skills", [print("Forklift"), print("First aid")])).toThrow(/Choose one value/);
        expect(() => op("write", "staff.two", recordState({ where: skilled("Forklift", "First aid"), preset: none, resolution: none }))).toThrow(/Choose one value/);
        expect(sameWhere(read("staff.two").where, skilled("Forklift"))).toBe(true);
    });

    test("one value named twice is that one value", () => {
        op("choose", "staff.twice", "skills", [print("Forklift"), print("Forklift")]);
        expect(sameWhere(read("staff.twice").where, skilled("Forklift"))).toBe(true);
    });
});
