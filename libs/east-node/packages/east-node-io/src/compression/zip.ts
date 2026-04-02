/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ZIP archive platform functions for East Node IO.
 *
 * Provides ZIP archive creation and extraction operations for East programs,
 * enabling file archiving and compression using the ZIP format.
 *
 * @packageDocumentation
 */

import { East, BlobType, SortedMap } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import AdmZip from "adm-zip";
import { ZipOptionsType, ZipEntriesType, ZipExtractedType } from "./types.js";

/**
 * Creates a ZIP archive from a list of files.
 *
 * Compresses multiple files into a single ZIP archive. Each file entry
 * contains a name (path) and its data. The compression level can be
 * controlled via options (0-9, where 0 is store only and 9 is maximum
 * compression).
 *
 * This is a platform function for the East language, enabling ZIP archive
 * creation in East programs running on Node.js.
 *
 * @param entries - List of files to include in the archive
 * @param options - Compression options (level)
 * @returns ZIP archive as compressed blob
 *
 * @throws {EastError} When compression fails due to:
 * - Invalid compression level (location: "zip_compress")
 * - Empty file name (location: "zip_compress")
 * - Memory allocation errors (location: "zip_compress")
 * - Internal compression errors (location: "zip_compress")
 *
 * @example
 * ```ts
 * import { East, BlobType, StringType, variant } from "@elaraai/east";
 * import { Compression } from "@elaraai/east-node-io";
 *
 * const createZip = East.function([StringType, StringType], BlobType, ($, file1Content, file2Content) => {
 *     const entries = $.let([
 *         {
 *             name: "file1.txt",
 *             data: file1Content.encodeUtf8(),
 *         },
 *         {
 *             name: "file2.txt",
 *             data: file2Content.encodeUtf8(),
 *         },
 *     ]);
 *     const options = $.let({
 *         level: variant('some', 9n),
 *     });
 *     const zipBlob = $.let(Compression.Zip.compress(entries, options));
 *     return $.return(zipBlob);
 * });
 *
 * const compiled = East.compile(createZip.toIR(), Compression.Zip.Implementation);
 * const result = compiled("Hello", "World");  // ZIP archive blob
 * ```
 *
 * @remarks
 * - Uses adm-zip library for ZIP operations
 * - Default compression level is 6 if not specified
 * - Level 0 stores files without compression
 * - Higher levels (7-9) provide better compression but are slower
 * - File names can include directory paths (e.g., "dir/file.txt")
 */
export const zip_compress = East.platform("zip_compress", [ZipEntriesType, ZipOptionsType], BlobType);

/**
 * Extracts files from a ZIP archive.
 *
 * Decompresses a ZIP archive and extracts all files into a dictionary
 * mapping file names to their uncompressed data.
 *
 * This is a platform function for the East language, enabling ZIP archive
 * extraction in East programs running on Node.js.
 *
 * @param zipData - ZIP archive blob
 * @returns Dictionary mapping file names to their data
 *
 * @throws {EastError} When extraction fails due to:
 * - Invalid ZIP format (location: "zip_decompress")
 * - Corrupted archive (location: "zip_decompress")
 * - Memory allocation errors (location: "zip_decompress")
 * - Internal decompression errors (location: "zip_decompress")
 *
 * @example
 * ```ts
 * import { East, BlobType, DictType, StringType } from "@elaraai/east";
 * import { Compression } from "@elaraai/east-node-io";
 *
 * const extractZip = East.function([BlobType], DictType(StringType, BlobType), ($, zipBlob) => {
 *     const files = $.let(Compression.Zip.decompress(zipBlob));
 *     return $.return(files);
 * });
 *
 * const compiled = East.compile(extractZip.toIR(), Compression.Zip.Implementation);
 * const result = compiled(zipBlob);
 * // Map { "file1.txt" => Uint8Array, "file2.txt" => Uint8Array }
 * ```
 *
 * @remarks
 * - Uses adm-zip library for ZIP operations
 * - Automatically detects and validates ZIP format
 * - Preserves directory structure in file names
 */
export const zip_decompress = East.platform("zip_decompress", [BlobType], ZipExtractedType);

/**
 * Helper function to compress files into a ZIP archive using adm-zip.
 *
 * @param entries - List of file entries
 * @param level - Compression level (0-9)
 * @returns ZIP archive as Uint8Array
 */
function compressZip(
    entries: ValueTypeOf<typeof ZipEntriesType>,
    level: number
): Uint8Array {
    // Validate level
    if (level < 0 || level > 9) {
        throw new EastError(`Invalid compression level: ${level}. Must be 0-9.`, {
            location: [{ filename: "zip_compress", line: 0n, column: 0n }]
        });
    }

    const zip = new AdmZip();

    for (const entry of entries) {
        const name = entry.name;
        const data = entry.data;

        if (!name || name.length === 0) {
            throw new EastError("File name cannot be empty", {
                location: [{ filename: "zip_compress", line: 0n, column: 0n }]
            });
        }

        // Add file to ZIP archive
        zip.addFile(name, Buffer.from(data));
    }

    // Generate ZIP buffer with specified compression level
    const buffer = zip.toBuffer();
    return new Uint8Array(buffer);
}

/**
 * Helper function to extract files from a ZIP archive using adm-zip.
 *
 * @param zipData - ZIP archive data
 * @returns Map of file names to their data
 */
function decompressZip(zipData: ValueTypeOf<typeof BlobType>): Map<string, Uint8Array> {
    const files = new SortedMap<string, Uint8Array>();

    // Create AdmZip instance from buffer
    const zip = new AdmZip(Buffer.from(zipData));

    // Extract all entries
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
        // Skip directories, only process files
        if (!entry.isDirectory) {
            const data = entry.getData();
            files.set(entry.entryName, new Uint8Array(data));
        }
    }

    return files;
}

/**
 * Node.js implementation of ZIP platform functions.
 *
 * Pass this array to {@link East.compile} to enable ZIP archive operations.
 */
export const ZipImpl: PlatformFunction[] = [
    zip_compress.implement((
        entries: ValueTypeOf<typeof ZipEntriesType>,
        options: ValueTypeOf<typeof ZipOptionsType>
    ) => {
        try {
            // Extract compression level (default to 6)
            const level = options.level.type === "some"
                ? Number(options.level.value)
                : 6;

            return compressZip(entries, level);
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`ZIP compression failed: ${err.message}`, {
                location: [{ filename: "zip_compress", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    zip_decompress.implement((
        zipData: ValueTypeOf<typeof BlobType>
    ) => {
        try {
            return decompressZip(zipData);
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`ZIP decompression failed: ${err.message}`, {
                location: [{ filename: "zip_decompress", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];
