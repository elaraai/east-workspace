/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, StringType, variant, example } from "@elaraai/east";
import { Format } from "@elaraai/east-node-io";

export const xlsxWrite = example({
    keywords: ["xlsx", "XLSX", "write", "create", "spreadsheet"],
    description: "Write data to an XLSX blob produces non-empty output",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const data = $.let([
            [variant('String', "Name"), variant('String', "Age")],
            [variant('String', "Alice"), variant('Float', 30)],
        ], Format.XLSX.Types.Sheet);
        const options = $.let({ sheetName: variant('some', "People") });
        const blob = $.let(Format.XLSX.write(data, options));
        return blob.size().greater(0n);
    }),
    inputs: [],
    returns: true,
});

export const xlsxRead = example({
    keywords: ["xlsx", "XLSX", "read", "parse", "spreadsheet"],
    description: "Write and read back XLSX data",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const data = $.let([
            [variant('String', "Name"), variant('String', "Age")],
            [variant('String', "Alice"), variant('Float', 30)],
            [variant('String', "Bob"), variant('Float', 25)],
        ], Format.XLSX.Types.Sheet);
        const writeOptions = $.let({ sheetName: variant('none', null) });
        const blob = $.let(Format.XLSX.write(data, writeOptions));
        const readOptions = $.let({ sheetName: variant('none', null) });
        const sheet = $.let(Format.XLSX.read(blob, readOptions));
        return sheet.size();
    }),
    inputs: [],
    returns: 3n,
});

export const xlsxInfo = example({
    keywords: ["xlsx", "XLSX", "info", "metadata", "sheets"],
    description: "Get XLSX file info including sheet names and dimensions",
    fn: East.asyncFunction([], StringType, ($) => {
        const data = $.let([
            [variant('String', "A"), variant('String', "B")],
            [variant('Float', 1), variant('Float', 2)],
        ], Format.XLSX.Types.Sheet);
        const writeOptions = $.let({ sheetName: variant('some', "TestSheet") });
        const blob = $.let(Format.XLSX.write(data, writeOptions));
        const info = $.let(Format.XLSX.info(blob));
        const firstSheet = $.let(info.sheets.get(0n));
        return firstSheet.name;
    }),
    inputs: [],
    returns: "TestSheet",
});
