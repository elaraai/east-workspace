/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The decision surface's constraint helpers over real East types and values:
 * the contract is read off a real judgements dataset type, and every
 * constraint is a `ValueTypeOf` of its contract, round-tripped through East's
 * own encoding as the surface holds it — so a set is East's sorted set. A
 * chip formats a payload through its contract case's East type, never its
 * JavaScript shape.
 */

import { describe, test, expect } from "vitest";
import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, RecursiveType, SetType, StringType, StructType, VariantType,
    decodeBeast2For, encodeBeast2For, isTypeValueEqual, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { DecisionConstraintType, judgementInputType } from "@elaraai/e3-ui/internal";
import { formatters } from "@elaraai/east-ui-components";

import { formatConstraint } from "./constraint-format.js";
import { constraintContractOf, type ConstraintContract } from "./contract.js";
import { leverPayloadEditable } from "./lever-editor.js";

const en = formatters("en-US");
const de = formatters("de-DE");

/** A value as the surface holds it: decoded from East's own encoding. */
function stored<T extends EastType>(type: T, value: ValueTypeOf<T>): ValueTypeOf<T> {
    return decodeBeast2For(type)(encodeBeast2For(type)(value));
}

/** The judgements dataset's type for a contract — what the surface registers. */
const judgementsOf = (contract: EastType) => toEastTypeValue(DictType(StringType, judgementInputType(contract)));

/** A contract as the chips read it: off its judgements dataset's type. */
function contractOf(contract: EastType): ConstraintContract {
    return constraintContractOf(judgementsOf(contract))!;
}

const defaults = contractOf(DecisionConstraintType);

/** 13:30 on 12 March 2026, UTC. */
const MARCH_12 = new Date(Date.UTC(2026, 2, 12, 13, 30));
/** 09:00 on 15 March 2026, UTC. */
const MARCH_15 = new Date(Date.UTC(2026, 2, 15, 9, 0));

describe("constraintContractOf", () => {
    test("reads the contract and its cases' payload types off a judgements dataset's type", () => {
        const { type, payloads } = defaults;
        expect(isTypeValueEqual(type, toEastTypeValue(DecisionConstraintType))).toBe(true);
        expect([...payloads.keys()].sort()).toEqual(["boolean", "datetime", "float", "integer", "string"]);
        expect(isTypeValueEqual(payloads.get("boolean")!, toEastTypeValue(VariantType({ is: BooleanType })))).toBe(true);
    });

    test("is undefined for a type that is not a judgements record", () => {
        expect(constraintContractOf(toEastTypeValue(DictType(StringType, IntegerType)))).toBeUndefined();
        expect(constraintContractOf(toEastTypeValue(ArrayType(StringType)))).toBeUndefined();
    });

    test("reads a recursive contract through its wrapper", () => {
        const Rule = RecursiveType(self => VariantType({ cap: FloatType, all: ArrayType(self) }));
        expect([...contractOf(Rule).payloads.keys()].sort()).toEqual(["all", "cap"]);
    });
});

describe("leverPayloadEditable", () => {
    test("an op variant over primitives, or over structs of primitives, gets an editor", () => {
        for (const lever of ["integer", "float", "datetime", "boolean"]) {
            expect(leverPayloadEditable(defaults.payloads.get(lever)), lever).toBe(true);
        }
    });

    test("an op variant with a Set payload does not — the editor has no set input", () => {
        expect(leverPayloadEditable(defaults.payloads.get("string"))).toBe(false);
    });

    test("a bare primitive and a struct of primitives do; a container does not; an unknown contract does not", () => {
        const Custom = contractOf(VariantType({
            cap: FloatType,
            blackout: StructType({ person: StringType, from: DateTimeType }),
            crews: SetType(StringType),
        }));
        expect(leverPayloadEditable(Custom.payloads.get("cap"))).toBe(true);
        expect(leverPayloadEditable(Custom.payloads.get("blackout"))).toBe(true);
        expect(leverPayloadEditable(Custom.payloads.get("crews"))).toBe(false);
        expect(leverPayloadEditable(undefined)).toBe(false);
    });
});

describe("formatConstraint — the default contract's ops, each through its East type", () => {
    const constraint = (value: ValueTypeOf<typeof DecisionConstraintType>) => stored(DecisionConstraintType, value);

    test("an Integer bound and range print as East prints an Integer", () => {
        expect(formatConstraint(constraint(variant("integer", variant("atMost", 36n))), defaults, undefined, en))
            .toEqual({ lever: "integer", op: "at most", value: "36" });
        expect(formatConstraint(constraint(variant("integer", variant("between", { min: 1n, max: 9007199254740993n }))), defaults, undefined, en))
            .toEqual({ lever: "integer", op: "between", value: "1 – 9007199254740993" });
    });

    test("a Float prints as East prints it, in the locale's decimal separator (#850)", () => {
        const floor = constraint(variant("float", variant("atLeast", 0.5)));
        expect(formatConstraint(floor, defaults, undefined, en).value).toBe("0.5");
        expect(formatConstraint(floor, defaults, undefined, de).value).toBe("0,5");
        expect(formatConstraint(constraint(variant("float", variant("eq", 36))), defaults, undefined, en).value).toBe("36.0");
    });

    test("a date prints its UTC month and day in the locale", () => {
        expect(formatConstraint(constraint(variant("datetime", variant("after", MARCH_12))), defaults, undefined, de))
            .toEqual({ lever: "datetime", op: "after", value: "12. März" });
    });

    test("a Set prints its members in the set's own order", () => {
        expect(formatConstraint(constraint(variant("string", variant("notIn", new Set(["NA", "EU", "APAC"])))), defaults, undefined, en))
            .toEqual({ lever: "string", op: "not in", value: "{APAC, EU, NA}" });
    });

    test("a Boolean prints as East prints it", () => {
        expect(formatConstraint(constraint(variant("boolean", variant("is", false))), defaults, undefined, en))
            .toEqual({ lever: "boolean", op: "is", value: "false" });
    });

    test("a lever's label comes from the decision's levers", () => {
        const cap = constraint(variant("integer", variant("atMost", 36n)));
        expect(formatConstraint(cap, defaults, [{ case: "integer", label: "Weekly hours" }], en).lever).toBe("Weekly hours");
    });
});

describe("formatConstraint — a solution's own contract", () => {
    const Blackouts = VariantType({ blackout: StructType({ person: StringType, from: DateTimeType, to: DateTimeType }) });

    test("a struct payload prints each field through its type", () => {
        const blackout = stored(Blackouts, variant("blackout", { person: "Patel", from: MARCH_12, to: MARCH_15 }));
        expect(formatConstraint(blackout, contractOf(Blackouts), undefined, en))
            .toEqual({ lever: "blackout", op: "·", value: "person Patel · from Mar 12 · to Mar 15" });
    });

    test("a payload that refers back to a recursive contract prints within the contract", () => {
        const Rule = RecursiveType(self => VariantType({ cap: FloatType, all: ArrayType(self) }));
        const rule = stored(Rule, variant("all", [variant("cap", 3.5), variant("all", [])]));
        expect(formatConstraint(rule, contractOf(Rule), undefined, en)).toEqual({ lever: "all", op: "·", value: "[.cap 3.5, .all []]" });
    });

    test("without the contract, the chip names the lever and guesses nothing", () => {
        const blackout = stored(Blackouts, variant("blackout", { person: "Patel", from: MARCH_12, to: MARCH_15 }));
        expect(formatConstraint(blackout, undefined, undefined, en)).toEqual({ lever: "blackout", op: "·", value: "" });
    });
});
