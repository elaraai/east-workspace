/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Compression type definitions for East Node IO.
 *
 * Provides East type definitions for compression and decompression operations,
 * supporting gzip, zip, and tar formats.
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
    BlobType,
} from "@elaraai/east";

/**
 * Compression level for gzip operations (0-9).
 *
 * - 0: No compression
 * - 1-3: Fast compression
 * - 4-6: Balanced (6 is default)
 * - 7-9: Maximum compression
 */
export const GzipLevelType = IntegerType;

/**
 * Gzip compression options.
 *
 * Controls how data is compressed using gzip.
 */
export const GzipOptionsType = StructType({
    /**
     * Compression level (0-9).
     * If not specified, defaults to 6.
     */
    level: OptionType(GzipLevelType),
});

/**
 * Compression level for zip operations (0-9).
 *
 * - 0: Store only (no compression)
 * - 1-3: Fast compression
 * - 4-6: Balanced (default is typically 6)
 * - 7-9: Maximum compression
 */
export const ZipLevelType = IntegerType;

/**
 * Zip compression options.
 *
 * Controls how data is compressed when creating zip archives.
 */
export const ZipOptionsType = StructType({
    /**
     * Compression level (0-9).
     * If not specified, defaults to 6.
     */
    level: OptionType(ZipLevelType),
});

/**
 * Entry in a ZIP archive.
 *
 * Contains the file name and its uncompressed data.
 */
export const ZipEntryType = StructType({
    /**
     * Name/path of the file within the archive.
     */
    name: StringType,

    /**
     * Uncompressed file data as bytes.
     */
    data: BlobType,
});

/**
 * List of entries for creating a ZIP archive.
 */
export const ZipEntriesType = ArrayType(ZipEntryType);

/**
 * Entry in a TAR archive.
 *
 * Contains the file name and its data.
 */
export const TarEntryType = StructType({
    /**
     * Name/path of the file within the archive.
     */
    name: StringType,

    /**
     * File data as bytes.
     */
    data: BlobType,
});

/**
 * List of entries for creating a TAR archive.
 */
export const TarEntriesType = ArrayType(TarEntryType);

/**
 * Extracted files from a ZIP archive as a dictionary.
 *
 * Maps file names to their uncompressed data.
 */
export const ZipExtractedType = DictType(StringType, BlobType);

/**
 * Extracted files from a TAR archive as a dictionary.
 *
 * Maps file names to their data.
 */
export const TarExtractedType = DictType(StringType, BlobType);
