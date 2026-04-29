/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type PlatformFunction } from "@elaraai/east/internal";
import { Download } from "@elaraai/east-ui";
import { registerPlatformImplementation } from "../registry.js";

interface BlobInput {
    filename: string;
    mimeType: string;
    data: Uint8Array;
}

interface CsvInput {
    filename: string;
    headers: string[];
    rows: string[][];
}

function triggerDownload(filename: string, mimeType: string, data: Uint8Array | string): null {
    if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
        console.warn("[Download] no browser environment — skipping");
        return null;
    }
    try {
        const blob = typeof data === "string"
            ? new Blob([data], { type: mimeType })
            : new Blob([data as BlobPart], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Defer revoke so the click navigation has a chance to read the URL.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
        console.warn("[Download] trigger failed:", err);
    }
    return null;
}

/**
 * RFC-4180-style CSV cell quoting. Wraps the cell in double-quotes when it
 * contains a comma, double-quote, CR, or LF, and doubles any embedded
 * double-quotes.
 */
function csvQuote(cell: string): string {
    if (/[",\r\n]/.test(cell)) {
        return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
}

function csvSerialise(headers: string[], rows: string[][]): string {
    const lines: string[] = [headers.map(csvQuote).join(",")];
    for (const row of rows) {
        lines.push(row.map(csvQuote).join(","));
    }
    return lines.join("\r\n");
}

export const DownloadImpl: PlatformFunction[] = [
    Download.blob.implement((input: unknown) => {
        const { filename, mimeType, data } = input as BlobInput;
        return triggerDownload(filename, mimeType, data);
    }),
    Download.csv.implement((input: unknown) => {
        const { filename, headers, rows } = input as CsvInput;
        const csv = csvSerialise(headers, rows);
        return triggerDownload(filename, "text/csv;charset=utf-8", csv);
    }),
];

registerPlatformImplementation(DownloadImpl);
