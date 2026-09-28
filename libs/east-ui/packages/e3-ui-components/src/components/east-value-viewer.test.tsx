/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The value viewer prints each primitive as East prints it — the value
 * decoded from East's own encoding, as a dataset preview holds it — so what
 * it shows is the value itself: every digit of an Integer, a Float's `.0`
 * and `-0.0`, a String quoted with its quotes escaped, a DateTime's UTC
 * instant to the millisecond.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    BlobType, BooleanType, DateTimeType, FloatType, IntegerType, NullType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, printFor, toEastTypeValue, type ValueTypeOf,
} from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { EastValueViewer } from "./EastValueViewer.js";

afterEach(cleanup);

/** One of every primitive. */
const RowType = StructType({
    n: NullType, b: BooleanType, i: IntegerType, f: FloatType, g: FloatType,
    s: StringType, t: DateTimeType, x: BlobType,
});
type Row = ValueTypeOf<typeof RowType>;

/** The row as a preview holds it: decoded from East's own encoding. */
const ROW: Row = decodeBeast2For(RowType)(encodeBeast2For(RowType)({
    n: null, b: true, i: 9007199254740993n, f: 5, g: -0,
    s: 'Berth "North"', t: new Date(Date.UTC(2026, 5, 29, 1, 30, 0, 125)), x: new Uint8Array([1, 2, 255]),
}));

/** The text shown beside a field's label. */
function shown(label: string): string {
    return screen.getByText(`${label}:`).nextElementSibling?.textContent ?? "";
}

describe("EastValueViewer", () => {
    test("each primitive prints as East prints it", () => {
        render(
            <ChakraProvider value={system}>
                <EastValueViewer type={toEastTypeValue(RowType)} value={ROW} />
            </ChakraProvider>,
        );
        expect(["n", "b", "i", "f", "g", "s", "t"].map(shown)).toEqual([
            "null", "true", "9007199254740993", "5.0", "-0.0", '"Berth \\"North\\""', "2026-06-29T01:30:00.125",
        ]);
        // …which is East's own text for each.
        expect(shown("s")).toBe(printFor(StringType)(ROW.s));
        expect(shown("t")).toBe(printFor(DateTimeType)(ROW.t));
        // A Blob shows its size, not every byte.
        expect(shown("x")).toBe("Blob[3 bytes]");
    });
});
