/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A part of a payload kept while each new payload's is equivalent
 * (east-workspace#1772): the same object while it is — a function too, which is
 * never called to be kept — and the new one once it is not.
 */

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { East, FunctionType, IntegerType, NullType, StringType, StructType, equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { useEquivalent } from "./equivalent.js";

afterEach(() => { cleanup(); });

/** A struct of data, as a payload carries one. */
const ShelfType = StructType({ name: StringType, count: IntegerType });
/** Who a host tells, as a payload carries it: a function, and the word it captures. */
const TellType = FunctionType([StringType], NullType);
/** Who a host tells, decoded as a payload's is: the same program each time, over the word given. */
const tellOf = East.compile(East.function([StringType], TellType, (_$, word) => East.function([StringType], NullType, ($2, _name) => {
    $2.let(word);
    return null;
})), []);

/** A probe keeping what it is given, and what each of its renders returned. */
function keeping<V>(equivalent: (a: V, b: V) => boolean) {
    const seen: V[] = [];
    function Probe({ value }: { value: V }) {
        seen.push(useEquivalent(value, equivalent));
        return null;
    }
    return { seen, Probe };
}

describe("a part of a payload, kept while equivalent (east-workspace#1772)", () => {
    test("a struct: the same object while each new one is equivalent, the new one once it is not", () => {
        const { seen, Probe } = keeping<ValueTypeOf<typeof ShelfType>>(equivalentFor(ShelfType));
        const first = { name: "orders", count: 3n };
        const { rerender } = render(<Probe value={first} />);
        rerender(<Probe value={{ name: "orders", count: 3n }} />);
        expect(seen.at(-1)).toBe(first);
        const other = { name: "orders", count: 4n };
        rerender(<Probe value={other} />);
        expect(seen.at(-1)).toBe(other);
    });

    test("a function, never called to be kept: the same program over an equal capture is the first one; over another, the new one", () => {
        const { seen, Probe } = keeping<ValueTypeOf<typeof TellType>>(equivalentFor(TellType));
        const first = tellOf("orders");
        const { rerender } = render(<Probe value={first} />);
        expect(seen.at(-1)).toBe(first);
        rerender(<Probe value={tellOf("orders")} />);
        expect(seen.at(-1)).toBe(first);
        const other = tellOf("customers");
        rerender(<Probe value={other} />);
        expect(seen.at(-1)).toBe(other);
    });
});
