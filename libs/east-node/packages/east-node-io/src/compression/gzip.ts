/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Gzip compression platform functions for East Node IO.
 *
 * Provides gzip compression and decompression operations for East programs,
 * enabling efficient data compression using the gzip format (RFC 1952).
 *
 * @packageDocumentation
 */

import { East, BlobType } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import { gzip as nodeGzip, gunzip as nodeGunzip } from "node:zlib";
import { promisify } from "node:util";
import { GzipOptionsType } from "./types.js";

// Promisify zlib functions
const gzipAsync = promisify(nodeGzip);
const gunzipAsync = promisify(nodeGunzip);

/**
 * Compresses data using gzip compression.
 *
 * Applies gzip compression (RFC 1952) to binary data, producing a compressed
 * blob that can be decompressed with {@link gzip_decompress}. The compression
 * level can be controlled via options (0-9, where 0 is no compression and 9
 * is maximum compression).
 *
 * This is a platform function for the East language, enabling gzip compression
 * in East programs running on Node.js.
 *
 * @param data - Uncompressed data to compress
 * @param options - Compression options (level)
 * @returns Compressed data as gzip blob
 *
 * @throws {EastError} When compression fails due to:
 * - Invalid compression level (location: "gzip_compress")
 * - Memory allocation errors (location: "gzip_compress")
 * - Internal zlib errors (location: "gzip_compress")
 *
 * @example
 * ```ts
 * import { East, BlobType, StringType } from "@elaraai/east";
 * import { Compression } from "@elaraai/east-node-io";
 *
 * const compressText = East.function([StringType], BlobType, ($, text) => {
 *     const data = $.let(text.encodeUtf8());
 *     const options = $.let({
 *         level: { tag: "some", value: 9n },
 *     });
 *     const compressed = $.let(Compression.Gzip.compress(data, options));
 *     return $.return(compressed);
 * });
 *
 * const compiled = East.compileAsync(compressText.toIR(), Compression.Gzip.Implementation);
 * const result = await compiled("Hello, World!");  // Compressed gzip blob
 * ```
 *
 * @remarks
 * - Uses Node.js built-in zlib for compression
 * - Default compression level is 6 if not specified
 * - Level 0 stores data without compression
 * - Higher levels (7-9) provide better compression but are slower
 * - All operations are asynchronous (use East.compileAsync)
 */
export const gzip_compress = East.asyncPlatform("gzip_compress", [BlobType, GzipOptionsType], BlobType);

/**
 * Decompresses gzip-compressed data.
 *
 * Decompresses data that was compressed using gzip (RFC 1952), restoring the
 * original uncompressed data. The input must be valid gzip format.
 *
 * This is a platform function for the East language, enabling gzip decompression
 * in East programs running on Node.js.
 *
 * @param compressed - Gzip-compressed data
 * @returns Decompressed original data
 *
 * @throws {EastError} When decompression fails due to:
 * - Invalid gzip format (location: "gzip_decompress")
 * - Corrupted compressed data (location: "gzip_decompress")
 * - Memory allocation errors (location: "gzip_decompress")
 * - Internal zlib errors (location: "gzip_decompress")
 *
 * @example
 * ```ts
 * import { East, BlobType, StringType } from "@elaraai/east";
 * import { Compression } from "@elaraai/east-node-io";
 *
 * const decompressText = East.function([BlobType], StringType, ($, compressed) => {
 *     const decompressed = $.let(Compression.Gzip.decompress(compressed));
 *     const text = $.let(decompressed.decodeUtf8());
 *     return $.return(text);
 * });
 *
 * const compiled = East.compileAsync(decompressText.toIR(), Compression.Gzip.Implementation);
 * const result = await compiled(compressedBlob);  // "Hello, World!"
 * ```
 *
 * @remarks
 * - Uses Node.js built-in zlib for decompression
 * - Automatically detects gzip header and validates format
 * - All operations are asynchronous (use East.compileAsync)
 */
export const gzip_decompress = East.asyncPlatform("gzip_decompress", [BlobType], BlobType);

/**
 * Node.js implementation of Gzip platform functions.
 *
 * Pass this array to {@link East.compileAsync} to enable gzip compression operations.
 */
export const GzipImpl: PlatformFunction[] = [
    gzip_compress.implement(async (
        data: ValueTypeOf<typeof BlobType>,
        options: ValueTypeOf<typeof GzipOptionsType>
    ) => {
        try {
            // Extract compression level (default to 6)
            const level = options.level.type === "some"
                ? Number(options.level.value)
                : 6;

            // Validate level
            if (level < 0 || level > 9) {
                throw new EastError(`Invalid compression level: ${level}. Must be 0-9.`, {
                    location: [{ filename: "gzip_compress", line: 0n, column: 0n }]
                });
            }

            // Compress using zlib
            const compressed = await gzipAsync(data, { level });
            return new Uint8Array(compressed);
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`Gzip compression failed: ${err.message}`, {
                location: [{ filename: "gzip_compress", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    gzip_decompress.implement(async (
        compressed: ValueTypeOf<typeof BlobType>
    ) => {
        try {
            // Decompress using zlib
            const decompressed = await gunzipAsync(compressed);
            return new Uint8Array(decompressed);
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`Gzip decompression failed: ${err.message}`, {
                location: [{ filename: "gzip_decompress", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];
