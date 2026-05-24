/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * XLSX type definitions for East Node IO.
 *
 * Provides East type definitions for reading and writing Excel (XLSX) files,
 * representing spreadsheets as 2D arrays of literal values.
 *
 * @packageDocumentation
 */

import {
    StructType,
    OptionType,
    ArrayType,
    DictType,
    StringType,
    IntegerType,
} from "@elaraai/east";
import { LiteralValueType } from "@elaraai/east/internal";

/**
 * A single cell value in a spreadsheet.
 *
 * Can be a string, number, boolean, or null. Matches the LiteralValueType
 * which supports all primitive JavaScript values that can appear in Excel cells.
 */
export const XlsxCellType = LiteralValueType;

/**
 * A row of cells in a spreadsheet.
 *
 * Represents a single row as an array of cell values.
 */
export const XlsxRowType = ArrayType(XlsxCellType);

/**
 * A 2D array representing a complete worksheet.
 *
 * Array of rows, where each row is an array of cell values.
 * This is the main data structure for reading/writing XLSX files.
 */
export const XlsxSheetType = ArrayType(XlsxRowType);

/**
 * XLSX read options configuration.
 *
 * Controls how Excel files are parsed when reading.
 */
export const XlsxReadOptionsType = StructType({
    /**
     * Name of the sheet to read.
     * If not specified, reads the first sheet.
     */
    sheetName: OptionType(StringType),
});

/**
 * XLSX write options configuration.
 *
 * Controls how data is written to Excel files.
 */
export const XlsxWriteOptionsType = StructType({
    /**
     * Name of the sheet to create.
     * Defaults to "Sheet1" if not specified.
     */
    sheetName: OptionType(StringType),
});

/**
 * Information about sheets in an XLSX file.
 */
export const XlsxSheetInfoType = StructType({
    /** Sheet name */
    name: StringType,

    /** Number of rows (approximate) */
    rowCount: IntegerType,

    /** Number of columns (approximate) */
    columnCount: IntegerType,
});

/**
 * XLSX file metadata and sheet listing.
 */
export const XlsxInfoType = StructType({
    /** List of sheets in the workbook */
    sheets: ArrayType(XlsxSheetInfoType),
});

/**
 * A single cell value in a CSV file.
 *
 * Can be a string, number, boolean, or null. Matches the LiteralValueType
 * which supports all primitive JavaScript values that can appear in CSV cells.
 */
export const CsvCellType = LiteralValueType;

/**
 * A row of cells in a CSV file represented as a dictionary.
 *
 * Maps column names (from the header row) to cell values.
 * This allows accessing cells by name rather than index.
 */
export const CsvRowType = DictType(StringType, CsvCellType);

/**
 * CSV data as an array of rows.
 *
 * Each row is a dictionary mapping column names to values.
 * The first row of the CSV file is used as column headers.
 */
export const CsvDataType = ArrayType(CsvRowType);

/**
 * CSV read options configuration.
 *
 * Controls how CSV files are parsed when reading.
 */
export const CsvReadOptionsType = StructType({
    /**
     * Delimiter character.
     * Defaults to "," if not specified.
     */
    delimiter: OptionType(StringType),
});

/**
 * CSV write options configuration.
 *
 * Controls how data is written to CSV files.
 */
export const CsvWriteOptionsType = StructType({
    /**
     * Delimiter character.
     * Defaults to "," if not specified.
     */
    delimiter: OptionType(StringType),
});
