/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How the paging runtime reads what a fetch threw: which server errors no retry
 * can fix while the dataset holds the same content, which say the dataset has
 * no value, the reason a failed read throws, and how long a read that failed
 * waits before it is fetched again.
 *
 * @packageDocumentation
 */

import type { TreePath } from "@elaraai/e3-types";

import { datasetPathToString } from "../dataset-store.js";

/** Minimum gap between retries of a read whose fetch failed. */
export const RETRY_AFTER_MS = 2000;

/**
 * Server error codes that no retry can fix while the dataset holds the same
 * content: the request, or the stored value, is wrong rather than the moment.
 * A read that failed with one keeps throwing without fetching again until the
 * source moves. Anything else — a transport blip, a cold server — is fetched
 * again after {@link RETRY_AFTER_MS}.
 */
const PERMANENT_PAGE_ERRORS = new Set([
    "bad_request",
    "dataset_not_canonical",
    "dataset_not_indexed",
    "dataset_not_pageable",
    "dataset_not_searchable",
    "dataset_not_segmented",
    "index_not_found",
    "key_parse_error",
]);

/** Server error codes that say the dataset has no value, so the source has no
 *  snapshot until one lands. */
export const NO_VALUE_ERRORS = new Set(["dataset_unassigned", "dataset_null"]);

/** A caught error's server code, when it carries one. */
export function errorCode(err: unknown): string | undefined {
    const code = (err as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
}

/** Whether a caught fetch error is one no retry can fix. */
export function isPermanentPageError(err: unknown): boolean {
    const code = errorCode(err);
    return code !== undefined && PERMANENT_PAGE_ERRORS.has(code);
}

/** What a failed read throws: the server's code and message, or the error's own. */
export function failureOf(path: TreePath, err: unknown): string {
    const code = errorCode(err);
    const details = (err as { details?: unknown } | null)?.details;
    const reason = code === undefined
        ? (err instanceof Error ? err.message : String(err))
        : typeof details === "string" && details !== "" ? `${code}: ${details}` : code;
    return `Data.bindPaged: ${datasetPathToString(path)}: ${reason}`;
}
