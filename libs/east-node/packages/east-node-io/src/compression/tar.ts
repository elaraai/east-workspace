/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * TAR archive platform functions for East Node IO.
 *
 * Provides TAR archive creation and extraction operations for East programs,
 * enabling file archiving using the TAR format (without compression).
 *
 * @packageDocumentation
 */

import { East, BlobType, SortedMap } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import { pack, extract } from "tar-stream";
import { Readable } from "node:stream";
import { TarEntriesType, TarExtractedType } from "./types.js";

/**
 * Creates a TAR archive from a list of files.
 *
 * Archives multiple files into a single TAR file. Each file entry contains
 * a name (path) and its data. TAR archives are not compressed by default,
 * but can be compressed separately using gzip (creating .tar.gz files).
 *
 * This is a platform function for the East language, enabling TAR archive
 * creation in East programs running on Node.js.
 *
 * @param entries - List of files to include in the archive
 * @returns TAR archive as blob
 *
 * @throws {EastError} When archiving fails due to:
 * - Empty file name (location: "tar_create")
 * - File name too long (> 100 characters) (location: "tar_create")
 * - Memory allocation errors (location: "tar_create")
 * - Internal errors (location: "tar_create")
 *
 * @example
 * ```ts
 * import { East, BlobType, StringType } from "@elaraai/east";
 * import { Compression } from "@elaraai/east-node-io";
 *
 * const createTar = East.function([StringType, StringType], BlobType, ($, file1Content, file2Content) => {
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
 *     const tarBlob = $.let(Compression.Tar.create(entries));
 *     return $.return(tarBlob);
 * });
 *
 * const compiled = East.compile(createTar.toIR(), Compression.Tar.Implementation);
 * const result = compiled("Hello", "World");  // TAR archive blob
 * ```
 *
 * @remarks
 * - Uses POSIX ustar format (IEEE 1003.1-1988)
 * - File names are limited to 100 characters (or 256 with prefix)
 * - TAR does not include compression - use with gzip for .tar.gz
 * - File permissions default to 0644 (readable/writable by owner)
 * - Operations are asynchronous (use East.compileAsync)
 */
export const tar_create = East.asyncPlatform("tar_create", [TarEntriesType], BlobType);

/**
 * Extracts files from a TAR archive.
 *
 * Extracts all files from a TAR archive into a dictionary mapping file
 * names to their data. Supports POSIX ustar format.
 *
 * This is a platform function for the East language, enabling TAR archive
 * extraction in East programs running on Node.js.
 *
 * @param tarData - TAR archive blob
 * @returns Dictionary mapping file names to their data
 *
 * @throws {EastError} When extraction fails due to:
 * - Invalid TAR format (location: "tar_extract")
 * - Corrupted archive (location: "tar_extract")
 * - Invalid checksum (location: "tar_extract")
 * - Memory allocation errors (location: "tar_extract")
 *
 * @example
 * ```ts
 * import { East, BlobType, DictType, StringType } from "@elaraai/east";
 * import { Compression } from "@elaraai/east-node-io";
 *
 * const extractTar = East.function([BlobType], DictType(StringType, BlobType), ($, tarBlob) => {
 *     const files = $.let(Compression.Tar.extract(tarBlob));
 *     return $.return(files);
 * });
 *
 * const compiled = East.compile(extractTar.toIR(), Compression.Tar.Implementation);
 * const result = compiled(tarBlob);
 * // Map { "file1.txt" => Uint8Array, "file2.txt" => Uint8Array }
 * ```
 *
 * @remarks
 * - Supports POSIX ustar format (IEEE 1003.1-1988)
 * - Validates header checksums
 * - Skips directory entries (only extracts files)
 * - Operations are asynchronous (use East.compileAsync)
 */
export const tar_extract = East.asyncPlatform("tar_extract", [BlobType], TarExtractedType);

/**
 * Helper function to create a TAR archive using tar-stream.
 *
 * @param entries - List of file entries
 * @returns TAR archive as Uint8Array
 */
async function createTar(entries: ValueTypeOf<typeof TarEntriesType>): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        const tarPack = pack();

        // Collect chunks
        tarPack.on('data', (chunk: Buffer) => {
            chunks.push(new Uint8Array(chunk));
        });

        tarPack.on('end', () => {
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;

            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }

            resolve(result);
        });

        tarPack.on('error', (err: Error) => {
            reject(new EastError(`TAR creation failed: ${err.message}`, {
                location: [{ filename: "tar_create", line: 0n, column: 0n }],
                cause: err
            }));
        });

        // Add all entries to the archive
        for (const entry of entries) {
            const name = entry.name;
            const data = entry.data;

            if (!name || name.length === 0) {
                reject(new EastError("File name cannot be empty", {
                    location: [{ filename: "tar_create", line: 0n, column: 0n }]
                }));
                return;
            }

            // Write entry to tar stream
            const entryStream = tarPack.entry({
                name: name,
                size: data.length,
                mode: 0o644,
                mtime: new Date()
            }, (err) => {
                if (err) {
                    reject(new EastError(`Failed to add entry ${name}: ${err.message}`, {
                        location: [{ filename: "tar_create", line: 0n, column: 0n }],
                        cause: err
                    }));
                }
            });

            entryStream.write(Buffer.from(data));
            entryStream.end();
        }

        // Finalize the archive
        tarPack.finalize();
    });
}

/**
 * Helper function to extract files from a TAR archive.
 *
 * @param tarData - TAR archive data
 * @returns Map of file names to their data
 */
async function extractTar(tarData: ValueTypeOf<typeof BlobType>): Promise<Map<string, Uint8Array>> {
    return new Promise((resolve, reject) => {
        const files = new SortedMap<string, Uint8Array>();
        const tarExtract = extract();

        tarExtract.on('entry', (header, stream, next) => {
            const chunks: Uint8Array[] = [];

            stream.on('data', (chunk: Buffer) => {
                chunks.push(new Uint8Array(chunk));
            });

            stream.on('end', () => {
                // Only store files, not directories
                if (header.type === 'file') {
                    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                    const result = new Uint8Array(totalLength);
                    let offset = 0;

                    for (const chunk of chunks) {
                        result.set(chunk, offset);
                        offset += chunk.length;
                    }

                    files.set(header.name, result);
                }

                next();
            });

            stream.on('error', (err) => {
                reject(new EastError(`Failed to extract entry ${header.name}: ${err.message}`, {
                    location: [{ filename: "tar_extract", line: 0n, column: 0n }],
                    cause: err
                }));
            });

            stream.resume();
        });

        tarExtract.on('finish', () => {
            resolve(files);
        });

        tarExtract.on('error', (err) => {
            reject(new EastError(`TAR extraction failed: ${err.message}`, {
                location: [{ filename: "tar_extract", line: 0n, column: 0n }],
                cause: err
            }));
        });

        // Feed the tar data to the extractor
        const readable = Readable.from(Buffer.from(tarData));
        readable.pipe(tarExtract);
    });
}

/**
 * Node.js implementation of TAR platform functions.
 *
 * Pass this array to {@link East.compileAsync} to enable TAR archive operations.
 */
export const TarImpl: PlatformFunction[] = [
    tar_create.implement(async (entries: ValueTypeOf<typeof TarEntriesType>) => {
        try {
            return await createTar(entries);
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`TAR creation failed: ${err.message}`, {
                location: [{ filename: "tar_create", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    tar_extract.implement(async (tarData: ValueTypeOf<typeof BlobType>) => {
        try {
            return await extractTar(tarData);
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`TAR extraction failed: ${err.message}`, {
                location: [{ filename: "tar_extract", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];
