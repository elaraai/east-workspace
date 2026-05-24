/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Compression platform functions for East Node IO.
 *
 * Provides functions for compressing and decompressing data using various
 * formats like gzip, zip, and tar.
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
 * await compiled("Hello, World!");  // Compressed gzip blob
 * ```
 *
 * @packageDocumentation
 */

// Export types
export * from "./types.js";

// Export platform functions and implementation
export { gzip_compress, gzip_decompress, GzipImpl } from "./gzip.js";
export { zip_compress, zip_decompress, ZipImpl } from "./zip.js";
export { tar_create, tar_extract, TarImpl } from "./tar.js";

// Import for grouped exports
import { gzip_compress, gzip_decompress, GzipImpl } from "./gzip.js";
import { zip_compress, zip_decompress, ZipImpl } from "./zip.js";
import { tar_create, tar_extract, TarImpl } from "./tar.js";
import {
    GzipLevelType,
    GzipOptionsType,
    ZipLevelType,
    ZipOptionsType,
    ZipEntryType,
    ZipEntriesType,
    ZipExtractedType,
    TarEntryType,
    TarEntriesType,
    TarExtractedType,
} from "./types.js";

/**
 * Compression platform functions grouped by compression type.
 *
 * Provides organized access to compression-specific operations for compressing
 * and decompressing data in East programs.
 *
 * @example
 * ```ts
 * import { East, BlobType, StringType } from "@elaraai/east";
 * import { Compression } from "@elaraai/east-node-io";
 *
 * const compressAndDecompress = East.function([StringType], StringType, ($, text) => {
 *     const data = $.let(text.encodeUtf8());
 *     const options = $.let({
 *         level: { tag: "some", value: 9n },
 *     });
 *
 *     const compressed = $.let(Compression.Gzip.compress(data, options));
 *     const decompressed = $.let(Compression.Gzip.decompress(compressed));
 *     const result = $.let(decompressed.decodeUtf8());
 *     return $.return(result);
 * });
 *
 * const compiled = East.compileAsync(compressAndDecompress.toIR(), Compression.Gzip.Implementation);
 * await compiled("Hello, World!");  // "Hello, World!"
 * ```
 */
export const Compression = {
    /**
     * Gzip compression operations.
     *
     * Provides functions for compressing and decompressing data using gzip (RFC 1952).
     */
    Gzip: {
        /**
         * Compresses data using gzip compression.
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
         * await compiled("Hello, World!");
         * ```
         */
        compress: gzip_compress,

        /**
         * Decompresses gzip-compressed data.
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
         * await compiled(compressedBlob);
         * ```
         */
        decompress: gzip_decompress,

        /**
         * Node.js implementation of Gzip platform functions.
         *
         * Pass this to {@link East.compileAsync} to enable gzip operations.
         */
        Implementation: GzipImpl,

        /**
         * Type definitions for Gzip operations.
         */
        Types: {
            /**
             * Compression level (0-9).
             */
            Level: GzipLevelType,

            /**
             * Gzip compression options.
             */
            Options: GzipOptionsType,
        },
    },

    /**
     * ZIP archive operations.
     *
     * Provides functions for creating and extracting ZIP archives with multiple files.
     */
    Zip: {
        /**
         * Creates a ZIP archive from a list of files.
         *
         * @example
         * ```ts
         * import { East, BlobType, StringType } from "@elaraai/east";
         * import { Compression } from "@elaraai/east-node-io";
         *
         * const createZip = East.function([StringType, StringType], BlobType, ($, file1, file2) => {
         *     const entries = $.let([
         *         { name: "file1.txt", data: file1.encodeUtf8() },
         *         { name: "file2.txt", data: file2.encodeUtf8() },
         *     ]);
         *     const options = $.let({
         *         level: { tag: "some", value: 9n },
         *     });
         *     const zipBlob = $.let(Compression.Zip.compress(entries, options));
         *     return $.return(zipBlob);
         * });
         *
         * const compiled = East.compileAsync(createZip.toIR(), Compression.Zip.Implementation);
         * await compiled("Hello", "World");
         * ```
         */
        compress: zip_compress,

        /**
         * Extracts files from a ZIP archive.
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
         * const compiled = East.compileAsync(extractZip.toIR(), Compression.Zip.Implementation);
         * await compiled(zipBlob);
         * ```
         */
        decompress: zip_decompress,

        /**
         * Node.js implementation of ZIP platform functions.
         *
         * Pass this to {@link East.compileAsync} to enable ZIP operations.
         */
        Implementation: ZipImpl,

        /**
         * Type definitions for ZIP operations.
         */
        Types: {
            /**
             * Compression level (0-9).
             */
            Level: ZipLevelType,

            /**
             * ZIP compression options.
             */
            Options: ZipOptionsType,

            /**
             * Entry in a ZIP archive.
             */
            Entry: ZipEntryType,

            /**
             * List of entries for creating a ZIP archive.
             */
            Entries: ZipEntriesType,

            /**
             * Extracted files from a ZIP archive.
             */
            Extracted: ZipExtractedType,
        },
    },

    /**
     * TAR archive operations.
     *
     * Provides functions for creating and extracting TAR archives (without compression).
     */
    Tar: {
        /**
         * Creates a TAR archive from a list of files.
         *
         * @example
         * ```ts
         * import { East, BlobType, StringType } from "@elaraai/east";
         * import { Compression } from "@elaraai/east-node-io";
         *
         * const createTar = East.function([StringType, StringType], BlobType, ($, file1, file2) => {
         *     const entries = $.let([
         *         { name: "file1.txt", data: file1.encodeUtf8() },
         *         { name: "file2.txt", data: file2.encodeUtf8() },
         *     ]);
         *     const tarBlob = $.let(Compression.Tar.create(entries));
         *     return $.return(tarBlob);
         * });
         *
         * const compiled = East.compileAsync(createTar.toIR(), Compression.Tar.Implementation);
         * await compiled("Hello", "World");
         * ```
         */
        create: tar_create,

        /**
         * Extracts files from a TAR archive.
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
         * const compiled = East.compileAsync(extractTar.toIR(), Compression.Tar.Implementation);
         * await compiled(tarBlob);
         * ```
         */
        extract: tar_extract,

        /**
         * Node.js implementation of TAR platform functions.
         *
         * Pass this to {@link East.compileAsync} to enable TAR operations.
         */
        Implementation: TarImpl,

        /**
         * Type definitions for TAR operations.
         */
        Types: {
            /**
             * Entry in a TAR archive.
             */
            Entry: TarEntryType,

            /**
             * List of entries for creating a TAR archive.
             */
            Entries: TarEntriesType,

            /**
             * Extracted files from a TAR archive.
             */
            Extracted: TarExtractedType,
        },
    },
} as const;
