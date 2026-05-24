/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * XLSX platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 */
import { describeEast, Assert, NodePlatform } from "@elaraai/east-node-std";
import { East, variant } from "@elaraai/east";
import { Format } from "@elaraai/east-node-io";
import * as ex from "./xlsx.examples.js";

await describeEast("XLSX platform functions", (test) => {
    Assert.examples(test, { xlsxWrite: ex.xlsxWrite, xlsxRead: ex.xlsxRead, xlsxInfo: ex.xlsxInfo });

    test("write and read simple XLSX file", $ => {
        // Create a 2D array with LiteralValueType variants
        const data = $.let([
            [variant('String', "Name"), variant('String', "Age"), variant('String', "City")],
            [variant('String', "Alice"), variant('Float', 30), variant('String', "New York")],
            [variant('String', "Bob"), variant('Float', 25), variant('String', "London")],
            [variant('String', "Charlie"), variant('Float', 35), variant('String', "Paris")],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('some', "People"),
        });

        // Write to XLSX blob
        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        // Verify blob is non-empty
        $(Assert.greater(xlsxBlob.size(), East.value(0n)));

        // Read it back
        const readOptions = $.let({
            sheetName: variant('none', null),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        // Verify row count
        $(Assert.equal(sheet.size(), East.value(4n)));
    });

    test("read and slice rows in East code", $ => {
        const data = $.let([
            [variant('String', "Name"), variant('String', "Age")],
            [variant('String', "Alice"), variant('Float', 30)],
            [variant('String', "Bob"), variant('Float', 25)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('none', null),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        // Read all rows
        const readOptions = $.let({
            sheetName: variant('none', null),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        // Skip header row in East code
        const dataRows = $.let(sheet.slice(1n, 3n));

        // Should have 2 rows after skipping header
        $(Assert.equal(dataRows.size(), East.value(2n)));
    });

    test("get XLSX file info", $ => {
        const data = $.let([
            [variant('String', "A"), variant('String', "B"), variant('String', "C")],
            [variant('Float', 1), variant('Float', 2), variant('Float', 3)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('some', "TestSheet"),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        // Get file info
        const info = $.let(Format.XLSX.info(xlsxBlob));

        // Should have 1 sheet
        $(Assert.equal(info.sheets.size(), East.value(1n)));

        // Check first sheet name
        const firstSheet = $.let(info.sheets.get(0n));
        $(Assert.equal(firstSheet.name, East.value("TestSheet")));

        // Check row and column counts
        $(Assert.equal(firstSheet.rowCount, East.value(2n)));
        $(Assert.equal(firstSheet.columnCount, East.value(3n)));
    });

    test("handle null cells", $ => {
        const data = $.let([
            [variant('String', "A"), variant('Null', null), variant('String', "C")],
            [variant('Float', 1), variant('Float', 2), variant('Null', null)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('none', null),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        const readOptions = $.let({
            sheetName: variant('none', null),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        // Should have 2 rows
        $(Assert.equal(sheet.size(), East.value(2n)));
    });

    test("write with custom sheet name", $ => {
        const data = $.let([
            [variant('String', "X"), variant('String', "Y")],
            [variant('Float', 10), variant('Float', 20)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('some', "CustomSheet"),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        const info = $.let(Format.XLSX.info(xlsxBlob));
        const firstSheet = $.let(info.sheets.get(0n));

        $(Assert.equal(firstSheet.name, East.value("CustomSheet")));
    });

    test("read specific sheet by name", $ => {
        const data = $.let([
            [variant('String', "Data")],
            [variant('Float', 100)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('some', "Sheet1"),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        // Read by sheet name
        const readOptions = $.let({
            sheetName: variant('some', "Sheet1"),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        $(Assert.equal(sheet.size(), East.value(2n)));
    });

    test("handle Boolean values", $ => {
        const data = $.let([
            [variant('String', "IsActive"), variant('String', "Value")],
            [variant('Boolean', true), variant('Float', 1)],
            [variant('Boolean', false), variant('Float', 0)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('none', null),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        const readOptions = $.let({
            sheetName: variant('none', null),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        // Check row count
        $(Assert.equal(sheet.size(), East.value(3n)));

        // Check boolean values are preserved
        const row1 = $.let(sheet.get(1n));
        const boolCell = $.let(row1.get(0n));
        $(Assert.equal(boolCell, variant('Boolean', true)));
    });

    test("handle Integer values", $ => {
        const data = $.let([
            [variant('String', "ID"), variant('String', "Count")],
            [variant('Integer', 42n), variant('Integer', 100n)],
            [variant('Integer', -5n), variant('Integer', 0n)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('none', null),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        const readOptions = $.let({
            sheetName: variant('none', null),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        // Check row count
        $(Assert.equal(sheet.size(), East.value(3n)));

        // Check integer values are converted to Float (Excel stores all numbers as floats)
        const row1 = $.let(sheet.get(1n));
        const intCell = $.let(row1.get(0n));
        $(Assert.equal(intCell, variant('Float', 42)));
    });

    test("handle DateTime values", $ => {
        const testDate = $.let(new Date("2024-01-15T10:30:00.000Z"));
        const data = $.let([
            [variant('String', "Timestamp"), variant('String', "Event")],
            [variant('DateTime', testDate), variant('String', "Login")],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('none', null),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        const readOptions = $.let({
            sheetName: variant('none', null),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        // Check row count
        $(Assert.equal(sheet.size(), East.value(2n)));

        // Check DateTime is preserved
        const row1 = $.let(sheet.get(1n));
        const dateCell = $.let(row1.get(0n));
        $(Assert.equal(dateCell, variant('DateTime', testDate)));
    });

    test("handle mixed types in columns", $ => {
        const data = $.let([
            [variant('String', "Name"), variant('String', "Age"), variant('String', "Active"), variant('String', "Score")],
            [variant('String', "Alice"), variant('Float', 30.5), variant('Boolean', true), variant('Integer', 95n)],
            [variant('String', "Bob"), variant('Float', 25), variant('Boolean', false), variant('Null', null)],
            [variant('Null', null), variant('Float', 40.2), variant('Boolean', true), variant('Float', 88.5)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('none', null),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        const readOptions = $.let({
            sheetName: variant('none', null),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        // Check row count
        $(Assert.equal(sheet.size(), East.value(4n)));

        // Check first data row has correct types
        const row1 = $.let(sheet.get(1n));
        $(Assert.equal(row1.get(0n), variant('String', "Alice")));
        $(Assert.equal(row1.get(1n), variant('Float', 30.5)));
        $(Assert.equal(row1.get(2n), variant('Boolean', true)));
        $(Assert.equal(row1.get(3n), variant('Float', 95))); // Integer becomes Float

        // Check null handling
        const row2 = $.let(sheet.get(2n));
        $(Assert.equal(row2.get(3n), variant('Null', null)));

        const row3 = $.let(sheet.get(3n));
        $(Assert.equal(row3.get(0n), variant('Null', null)));
    });

    test("handle empty strings", $ => {
        const data = $.let([
            [variant('String', "Name"), variant('String', "Email")],
            [variant('String', "Alice"), variant('String', "alice@example.com")],
            [variant('String', "Bob"), variant('String', "")],
            [variant('String', ""), variant('String', "test@example.com")],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('none', null),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        const readOptions = $.let({
            sheetName: variant('none', null),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        // Check empty strings are preserved
        const row2 = $.let(sheet.get(2n));
        $(Assert.equal(row2.get(1n), variant('String', "")));

        const row3 = $.let(sheet.get(3n));
        $(Assert.equal(row3.get(0n), variant('String', "")));
    });

    // Error handling tests
    test("errors on non-existent sheet name", $ => {
        const data = $.let([
            [variant('String', "A"), variant('String', "B")],
            [variant('Float', 1), variant('Float', 2)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('some', "Sheet1"),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        const readOptions = $.let({
            sheetName: variant('some', "NonExistent"),
        });

        $(Assert.throws(Format.XLSX.read(xlsxBlob, readOptions), /Sheet "NonExistent" not found in workbook/));
    });

    // Large dataset test with mixed types and null values
    test("handles large dataset with multiple types and null values", $ => {
        const d1 = $.let(new Date("2024-01-15T10:30:00.000Z"));
        const d2 = $.let(new Date("2024-02-20T14:45:00.000Z"));
        const d3 = $.let(new Date("2024-03-10T08:15:00.000Z"));

        const data = $.let([
            [variant('String', "ID"), variant('String', "Name"), variant('String', "Age"), variant('String', "Score"), variant('String', "Active"), variant('String', "JoinDate")],
            [variant('Float', 1), variant('String', "Alice"), variant('Float', 30), variant('Float', 95.5), variant('Boolean', true), variant('DateTime', d1)],
            [variant('Float', 2), variant('String', "Bob"), variant('Float', 25), variant('Float', 87.3), variant('Boolean', false), variant('DateTime', d2)],
            [variant('Float', 3), variant('String', "Charlie"), variant('Null', null), variant('Float', 92.1), variant('Boolean', true), variant('Null', null)],
            [variant('Float', 4), variant('String', "Diana"), variant('Float', 35), variant('Null', null), variant('Boolean', false), variant('DateTime', d3)],
            [variant('Float', 5), variant('Null', null), variant('Float', 28), variant('Float', 88.9), variant('Boolean', true), variant('DateTime', d1)],
            [variant('Float', 6), variant('String', "Eve"), variant('Float', 42), variant('Float', 91.2), variant('Null', null), variant('DateTime', d2)],
            [variant('Float', 7), variant('String', "Frank"), variant('Float', 31), variant('Float', 85.7), variant('Boolean', false), variant('Null', null)],
            [variant('Float', 8), variant('String', "Grace"), variant('Null', null), variant('Float', 89.4), variant('Boolean', true), variant('DateTime', d3)],
            [variant('Float', 9), variant('String', "Henry"), variant('Float', 29), variant('Null', null), variant('Boolean', false), variant('DateTime', d1)],
            [variant('Float', 10), variant('Null', null), variant('Float', 33), variant('Float', 93.8), variant('Boolean', true), variant('Null', null)],
            [variant('Float', 11), variant('String', "Ivy"), variant('Float', 27), variant('Float', 86.5), variant('Boolean', false), variant('DateTime', d2)],
            [variant('Float', 12), variant('String', "Jack"), variant('Float', 38), variant('Null', null), variant('Boolean', true), variant('DateTime', d3)],
            [variant('Float', 13), variant('String', "Kate"), variant('Null', null), variant('Float', 90.2), variant('Boolean', false), variant('DateTime', d1)],
            [variant('Float', 14), variant('String', "Leo"), variant('Float', 45), variant('Float', 94.1), variant('Null', null), variant('DateTime', d2)],
            [variant('Float', 15), variant('Null', null), variant('Float', 32), variant('Float', 87.9), variant('Boolean', true), variant('Null', null)],
            [variant('Float', 16), variant('String', "Mia"), variant('Float', 26), variant('Float', 91.7), variant('Boolean', false), variant('DateTime', d3)],
            [variant('Float', 17), variant('String', "Noah"), variant('Float', 34), variant('Null', null), variant('Boolean', true), variant('DateTime', d1)],
            [variant('Float', 18), variant('String', "Olivia"), variant('Null', null), variant('Float', 88.3), variant('Boolean', false), variant('Null', null)],
            [variant('Float', 19), variant('String', "Peter"), variant('Float', 41), variant('Float', 92.6), variant('Boolean', true), variant('DateTime', d2)],
            [variant('Float', 20), variant('String', "Quinn"), variant('Float', 29), variant('Null', null), variant('Boolean', false), variant('DateTime', d3)],
        ], Format.XLSX.Types.Sheet);

        const writeOptions = $.let({
            sheetName: variant('some', "People"),
        });

        const xlsxBlob = $.let(Format.XLSX.write(data, writeOptions));

        const readOptions = $.let({
            sheetName: variant('some', "People"),
        });

        const sheet = $.let(Format.XLSX.read(xlsxBlob, readOptions));

        $(Assert.equal(sheet, data));

        // Round-trip: write again and read back
        const xlsxBlob2 = $.let(Format.XLSX.write(sheet, writeOptions));
        const sheet2 = $.let(Format.XLSX.read(xlsxBlob2, readOptions));

        $(Assert.equal(sheet2, data));
    });
}, {
    platformFns: [...Format.XLSX.Implementation, ...NodePlatform],
});
