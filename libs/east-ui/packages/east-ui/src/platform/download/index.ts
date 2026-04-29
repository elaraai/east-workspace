/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Download platform — trigger browser file downloads from East callbacks.
 *
 * - `Download.blob({ filename, mimeType, data })` — generic; accepts an
 *   `Uint8Array` payload and any MIME type.
 * - `Download.csv({ filename, headers, rows })` — convenience helper that
 *   serialises a rectangular `Array<Array<String>>` into RFC-4180-style CSV
 *   (with quoting + escaping) and triggers a `text/csv` download.
 *
 * @packageDocumentation
 */

import {
    East,
    StringType,
    NullType,
    BlobType,
    ArrayType,
    StructType,
} from "@elaraai/east";

// ============================================================================
// Download.blob input type
// ============================================================================

/**
 * Input struct for `Download.blob`.
 *
 * @property filename - The download's suggested filename (no path separators)
 * @property mimeType - Standard MIME type (`text/csv`, `application/pdf`, etc.)
 * @property data - The bytes to download as a `BlobType` (`Uint8Array`)
 */
export const DownloadBlobInputType = StructType({
    filename: StringType,
    mimeType: StringType,
    data: BlobType,
});

/** Type alias for `DownloadBlobInputType`. */
export type DownloadBlobInputType = typeof DownloadBlobInputType;

// ============================================================================
// Download.csv input type
// ============================================================================

/**
 * Input struct for `Download.csv`.
 *
 * @property filename - The download's suggested filename
 * @property headers - First row written verbatim as the CSV header
 * @property rows - Body rows; each inner array becomes one CSV record
 */
export const DownloadCsvInputType = StructType({
    filename: StringType,
    headers: ArrayType(StringType),
    rows: ArrayType(ArrayType(StringType)),
});

/** Type alias for `DownloadCsvInputType`. */
export type DownloadCsvInputType = typeof DownloadCsvInputType;

// ============================================================================
// Platform calls
// ============================================================================

const download_blob = East.platform(
    "download_blob",
    [DownloadBlobInputType],
    NullType,
    { optional: true },
);

const download_csv = East.platform(
    "download_csv",
    [DownloadCsvInputType],
    NullType,
    { optional: true },
);

/**
 * Download platform calls — trigger browser file downloads.
 *
 * @example
 * ```ts
 * import { East, NullType, ArrayType, StringType, variant } from "@elaraai/east";
 * import { Button, Download, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, ($) => {
 *     const onClick = $.const(East.function([], NullType, ($) => {
 *         $(Download.csv(East.value({
 *             filename: "scenarios.csv",
 *             headers: ["id", "name", "savings"],
 *             rows: [
 *                 ["s1", "baseline", "0"],
 *                 ["s2", "optimised", "12450"],
 *             ],
 *         }, Download.Types.CsvInput)));
 *     }));
 *     return Button.Root("Download CSV", { onClick });
 * });
 * ```
 */
export const Download = {
    /**
     * Trigger a binary-blob download.
     *
     * @param input - `{ filename, mimeType, data }`
     * @returns A platform call returning `null`
     *
     * @remarks
     * Renderer wraps the bytes in a `Blob`, creates an object URL, attaches
     * a hidden `<a download>` link, clicks it, then revokes the URL. Works
     * in any modern browser; no-op in non-browser environments.
     */
    blob: download_blob,
    /**
     * Trigger a CSV download from header + body string arrays.
     *
     * @param input - `{ filename, headers, rows }`
     * @returns A platform call returning `null`
     *
     * @remarks
     * Each cell is RFC-4180-quoted when it contains a comma, double-quote,
     * carriage return, or newline. Embedded double-quotes are doubled.
     * Lines are joined with `\r\n`. The browser is asked to open the
     * download with a `text/csv;charset=utf-8` MIME type.
     */
    csv: download_csv,
    Types: {
        /**
         * East StructType for the `Download.blob` input.
         *
         * @property filename - Suggested filename
         * @property mimeType - Standard MIME type
         * @property data - Bytes (`Uint8Array`)
         */
        BlobInput: DownloadBlobInputType,
        /**
         * East StructType for the `Download.csv` input.
         *
         * @property filename - Suggested filename
         * @property headers - Header row (one cell per column)
         * @property rows - Body rows
         */
        CsvInput: DownloadCsvInputType,
    },
} as const;
