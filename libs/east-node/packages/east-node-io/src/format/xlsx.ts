/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * XLSX (Excel) file format platform functions for East Node IO.
 *
 * Provides functions for reading and writing Excel files (.xlsx) as 2D arrays
 * of literal values.
 *
 * @packageDocumentation
 */

import { East, BlobType, variant, match } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError, LiteralValueType } from "@elaraai/east/internal";
import * as XLSX from 'xlsx';
import {
    XlsxSheetType,
    XlsxReadOptionsType,
    XlsxWriteOptionsType,
    XlsxInfoType,
} from "./types.js";

/**
 * Reads an XLSX file and returns a 2D array of cell values.
 *
 * Parses an Excel file from a blob and extracts data as a 2D array where
 * each row is an array of cell values. Cell values are represented as
 * LiteralValueType (string, number, boolean, or null).
 *
 * This is a platform function for the East language, enabling Excel file
 * operations in East programs running on Node.js.
 *
 * @param data - XLSX file content as a blob
 * @param options - Read options (sheet name)
 * @returns 2D array of cell values (ArrayType<ArrayType<LiteralValueType>>)
 *
 * @throws {EastError} When reading fails due to:
 * - Invalid XLSX file format (location: "xlsx_read")
 * - Sheet not found (location: "xlsx_read")
 * - Corrupted file data (location: "xlsx_read")
 *
 * @example
 * ```ts
 * import { East, BlobType, IntegerType, variant } from "@elaraai/east";
 * import { Format } from "@elaraai/east-node-io";
 *
 * const countRows = East.function([BlobType], IntegerType, ($, xlsxBlob) => {
 *     const options = $.let({
 *         sheetName: variant('some', "Sheet1"),
 *     });
 *
 *     const sheet = $.let(Format.XLSX.read(xlsxBlob, options));
 *
 *     // Skip header row in East code
 *     const dataRows = $.let(sheet.slice(East.value(1n), sheet.size()));
 *
 *     return $.return(dataRows.size());
 * });
 *
 * const compiled = East.compile(countRows.toIR(), Format.XLSX.Implementation);
 * const xlsxBlob = new Uint8Array([]);
 * compiled(xlsxBlob);  // 99n (row count after skipping header)
 * ```
 *
 * @remarks
 * - All read operations are synchronous (use East.compile)
 * - Empty cells are represented as null
 * - Numbers are converted to JavaScript numbers (not bigint)
 * - Dates are converted to ISO 8601 strings
 * - Formulas are evaluated and their results are returned
 */
export const xlsx_read = East.platform("xlsx_read", [BlobType, XlsxReadOptionsType], XlsxSheetType);
/**
 * Writes a 2D array of cell values to an XLSX file.
 *
 * Creates an Excel file from a 2D array of literal values. Each nested array
 * represents a row, and each value in the row represents a cell.
 *
 * This is a platform function for the East language, enabling Excel file
 * creation in East programs running on Node.js.
 *
 * @param data - 2D array of cell values to write
 * @param options - Write options (sheet name)
 * @returns XLSX file content as a blob
 *
 * @throws {EastError} When writing fails due to:
 * - Invalid data structure (location: "xlsx_write")
 * - Unsupported cell value type (location: "xlsx_write")
 * - Memory allocation failure for large files (location: "xlsx_write")
 *
 * @example
 * ```ts
 * import { East, BlobType, variant } from "@elaraai/east";
 * import { Format } from "@elaraai/east-node-io";
 *
 * const createExcel = East.function([], BlobType, $ => {
 *     const data = $.let([
 *         [variant('String', "Name"), variant('String', "Age"), variant('String', "City")],
 *         [variant('String', "Alice"), variant('Float', 30), variant('String', "New York")],
 *         [variant('String', "Bob"), variant('Float', 25), variant('String', "London")],
 *     ]);
 *
 *     const options = $.let({
 *         sheetName: variant('some', "Employees"),
 *     });
 *
 *     return $.return(Format.XLSX.write(data, options));
 * });
 *
 * const compiled = East.compile(createExcel.toIR(), Format.XLSX.Implementation);
 * const xlsxBlob = compiled();
 * ```
 *
 * @remarks
 * - All write operations are synchronous (use East.compile)
 * - null values create empty cells
 * - Numbers are written as numeric cells
 * - Strings are written as text cells
 * - Booleans are written as boolean cells
 * - All rows should ideally have the same number of columns
 */
export const xlsx_write = East.platform("xlsx_write", [XlsxSheetType, XlsxWriteOptionsType], BlobType);

/**
 * Gets metadata about an XLSX file without reading all data.
 *
 * Returns information about sheets in the workbook including names and
 * approximate row/column counts. Useful for inspecting files before reading.
 *
 * @param data - XLSX file content as a blob
 * @returns Metadata with sheet names and sizes
 *
 * @throws {EastError} When reading fails due to:
 * - Invalid XLSX file format (location: "xlsx_info")
 * - Corrupted file data (location: "xlsx_info")
 *
 * @example
 * ```ts
 * import { East, BlobType, StringType } from "@elaraai/east";
 * import { Format } from "@elaraai/east-node-io";
 *
 * const getFirstSheetName = East.function([BlobType], StringType, ($, xlsxBlob) => {
 *     const info = $.let(Format.XLSX.info(xlsxBlob));
 *     const firstSheet = $.let(info.sheets.at(East.value(0n)));
 *     return $.return(firstSheet.name);
 * });
 *
 * const compiled = East.compile(getFirstSheetName.toIR(), Format.XLSX.Implementation);
 * const xlsxBlob = new Uint8Array([]);
 * compiled(xlsxBlob);  // "Sheet1"
 * ```
 */
export const xlsx_info = East.platform("xlsx_info", [BlobType], XlsxInfoType);

/**
 * Converts East LiteralValueType to native JavaScript value for XLSX.
 *
 * @param value - East LiteralValueType value
 * @returns Native JavaScript value
 * @internal
 */
function convertLiteralToCell(value: ValueTypeOf<typeof LiteralValueType>): any {
    return match(value, {
        Null: () => null,
        String: (v) => v,
        Integer: (v) => Number(v),  // Convert BigInt to Number for Excel
        Float: (v) => v,
        Boolean: (v) => v,
        DateTime: (v) => v,  // Keep as Date object
        Blob: (v) => v.toString(),  // Convert Blob to string representation
    });
}

/**
 * Node.js platform implementation for XLSX operations.
 *
 * Provides the runtime implementations for XLSX read/write operations.
 * Pass this to East.compile() to enable XLSX functionality.
 */
export const XlsxImpl: PlatformFunction[] = [
    xlsx_read.implement((
        data: ValueTypeOf<typeof BlobType>,
        options: ValueTypeOf<typeof XlsxReadOptionsType>
    ): ValueTypeOf<typeof XlsxSheetType> => {
        try {
            // Convert Uint8Array blob to Buffer
            const buffer = Buffer.from(data);

            // Parse the workbook with cellDates option to parse dates as Date objects
            const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

            // Determine which sheet to read
            let sheetName: string;
            if (options.sheetName?.type === 'some') {
                sheetName = options.sheetName.value;
                if (!workbook.Sheets[sheetName]) {
                    throw new EastError(`Sheet "${sheetName}" not found in workbook`, {
                        location: [{ filename: "xlsx_read", line: 0n, column: 0n }]
                    });
                }
            } else {
                // Use first sheet if no name specified
                const firstSheetName = workbook.SheetNames[0];
                if (!firstSheetName) {
                    throw new EastError('Workbook contains no sheets', {
                        location: [{ filename: "xlsx_read", line: 0n, column: 0n }]
                    });
                }
                sheetName = firstSheetName;
            }

            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) {
                throw new EastError(`Sheet "${sheetName}" not found in workbook`, {
                    location: [{ filename: "xlsx_read", line: 0n, column: 0n }]
                });
            }

            // Get the range of the worksheet
            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

            // Convert worksheet to 2D array using cell metadata
            const eastData: ValueTypeOf<typeof XlsxSheetType> = [];

            for (let R = range.s.r; R <= range.e.r; R++) {
                const row: ValueTypeOf<typeof LiteralValueType>[] = [];
                for (let C = range.s.c; C <= range.e.c; C++) {
                    const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                    const cell = worksheet[cellAddress];

                    if (!cell) {
                        // Empty cell
                        row.push(variant('Null', null));
                    } else {
                        // Use cell type metadata to determine the correct variant
                        switch (cell.t) {
                            case 'b': // Boolean
                                row.push(variant('Boolean', cell.v as boolean));
                                break;
                            case 'n': // Number
                                row.push(variant('Float', cell.v as number));
                                break;
                            case 's': // String
                                row.push(variant('String', cell.v as string));
                                break;
                            case 'd': // Date
                                row.push(variant('DateTime', cell.v as Date));
                                break;
                            case 'z': // Stub (blank)
                            case 'e': // Error
                            default:
                                row.push(variant('Null', null));
                                break;
                        }
                    }
                }
                eastData.push(row);
            }

            return eastData;
        } catch (err: any) {
            if (err instanceof EastError) {
                throw err;
            }
            throw new EastError(`Failed to read XLSX file: ${err.message}`, {
                location: [{ filename: "xlsx_read", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    xlsx_write.implement((
        data: ValueTypeOf<typeof XlsxSheetType>,
        options: ValueTypeOf<typeof XlsxWriteOptionsType>
    ): ValueTypeOf<typeof BlobType> => {
        try {
            // Convert East 2D array to native JavaScript array
            const nativeData: any[][] = data.map(row =>
                row.map(convertLiteralToCell)
            );

            // Create a new workbook and worksheet
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.aoa_to_sheet(nativeData);

            // Determine sheet name
            const sheetName = options.sheetName?.type === 'some' ? options.sheetName.value : 'Sheet1';

            // Add worksheet to workbook
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

            // Write workbook to buffer
            const buffer = XLSX.write(workbook, {
                type: 'buffer',
                bookType: 'xlsx',
            });

            // Convert Buffer to Uint8Array
            return new Uint8Array(buffer);
        } catch (err: any) {
            throw new EastError(`Failed to write XLSX file: ${err.message}`, {
                location: [{ filename: "xlsx_write", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    xlsx_info.implement((
        data: ValueTypeOf<typeof BlobType>
    ): ValueTypeOf<typeof XlsxInfoType> => {
        try {
            // Convert Uint8Array blob to Buffer
            const buffer = Buffer.from(data);

            // Parse the workbook (but don't read all data)
            const workbook = XLSX.read(buffer, { type: 'buffer', bookVBA: false });

            // Extract sheet information
            const sheets = workbook.SheetNames.map(name => {
                const worksheet = workbook.Sheets[name];
                if (!worksheet) {
                    return {
                        name,
                        rowCount: 0n,
                        columnCount: 0n,
                    };
                }
                const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

                return {
                    name,
                    rowCount: BigInt(range.e.r - range.s.r + 1),
                    columnCount: BigInt(range.e.c - range.s.c + 1),
                };
            });

            return { sheets };
        } catch (err: any) {
            throw new EastError(`Failed to read XLSX file info: ${err.message}`, {
                location: [{ filename: "xlsx_info", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];
