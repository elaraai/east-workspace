/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What an action's form holds (`form-check.ts`) through a variant's case
 * (#1549): a field's value read and set along a path through the case the
 * variant holds — under another case, read as nothing and left as it is — and
 * a required field under a case the variant does not hold, which the form
 * does not show, never left empty. Over real East values, compared by East.
 */

import { describe, expect, test } from "vitest";
import { IntegerType, NullType, StringType, StructType, VariantType, equalFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { emptyRequired, getAt, setAt } from "./form-check.js";

// A step's finish: bare, a stain of a shade, or a paint of a colour and its coats.
const Finish = VariantType({ bare: NullType, stain: StringType, paint: StructType({ colour: StringType, coats: IntegerType }) });
const Step = StructType({ note: StringType, finish: Finish });
type StepValue = ValueTypeOf<typeof Step>;
const finishEqual = equalFor(Finish);
const PAINTED: StepValue = { note: "Doors", finish: variant("paint", { colour: "Teal", coats: 2n }) };

describe("an action's form, through a variant's case", () => {
    test("a field is read along a path through the case the variant holds; under another case, nothing", () => {
        expect(equalFor(IntegerType)(getAt(PAINTED, ["finish", "paint", "coats"]) as bigint, 2n)).toBe(true);
        expect(getAt(PAINTED, ["finish", "stain"])).toBeUndefined();
    });

    test("a field set through the case the variant holds keeps the case's other fields; through another case, the value is left as it is", () => {
        expect(finishEqual((setAt(PAINTED, ["finish", "paint", "coats"], 3n) as StepValue).finish, variant("paint", { colour: "Teal", coats: 3n }))).toBe(true);
        expect(finishEqual((setAt(PAINTED, ["finish", "stain"], "Oak") as StepValue).finish, PAINTED.finish)).toBe(true);
    });

    test("a required field under a case the variant does not hold is never left empty; under the case it holds, it is", () => {
        const specs = Fields.specs(Step);
        expect(emptyRequired(specs, { note: "Doors", finish: variant("stain", "Oak") }, null)).toBeUndefined();
        expect(emptyRequired(specs, { note: "Doors", finish: variant("paint", { colour: "Teal" }) }, null)?.path).toEqual(["finish", "paint", "coats"]);
        // No finish at all: the choice is what is left empty, never a case's field.
        expect(emptyRequired(specs, { note: "Doors" }, null)?.path).toEqual(["finish"]);
    });
});
