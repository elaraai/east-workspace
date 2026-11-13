/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paging runtime's names: a bind's selector, and the tracked-channel key of
 * every read — a dataset's revision, a window, a total, a key search, a batch
 * and a narrowing's membership answers — each keyed by the revision it belongs
 * to, so one snapshot's reads are never served beside another's.
 *
 * @packageDocumentation
 */

import { sha256Hex } from "@elaraai/east";
import type { DatasetFindQuery, DatasetKeySearch } from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";

import { datasetPathToString } from "../dataset-store.js";
import type { PagedSelector, PagedRun } from "./api.js";

/** The selector a bind with no index has. */
export const NO_INDEX: PagedSelector = { index: null, join: false };

/** A selector's contribution to a channel key and a cache key. */
export function selectorKey(selector: PagedSelector): string {
    return selector.index === null ? "" : `@${selector.index}${selector.join ? "+join" : ""}`;
}

/** Tracked-channel key for a dataset's revision. Every read of the dataset
 *  tracks it, so every read re-fires when the source moves. */
export function pagedRevisionKey(workspace: string, path: TreePath): string {
    return `paged:${workspace}:${datasetPathToString(path)}#revision`;
}

/** The family a window belongs to: its dataset, the rows it serves and its
 *  revision — every window one landed window can answer for (#1217). */
export function pagedWindowFamily(workspace: string, path: TreePath, revision: string, selector: PagedSelector): string {
    return `paged:${workspace}:${datasetPathToString(path)}${selectorKey(selector)}@${revision}`;
}

/** Tracked-channel key for one window of one revision. */
export function pagedWindowKey(
    workspace: string, path: TreePath, revision: string, offset: number, limit: number, selector: PagedSelector = NO_INDEX,
): string {
    return `${pagedWindowFamily(workspace, path, revision, selector)}#${offset}+${limit}`;
}

/** Tracked-channel key for one revision's element total. */
export function pagedTotalKey(workspace: string, path: TreePath, revision: string, selector: PagedSelector = NO_INDEX): string {
    return `paged:${workspace}:${datasetPathToString(path)}${selectorKey(selector)}@${revision}#total`;
}

/** Tracked-channel key for ONE key query against one revision. Every distinct
 *  query gets its own channel: a search result is as fixed as a window. */
export function pagedSeekKey(
    workspace: string, path: TreePath, revision: string, query: DatasetFindQuery, selector: PagedSelector = NO_INDEX,
): string {
    return seekKeyIn(pagedWindowFamily(workspace, path, revision, selector), seekQueryText(query));
}

/** A search's channel key, from the family of the rows it searches and its text. */
export function seekKeyIn(family: string, text: string): string {
    return `${family}#seek:${text}`;
}

/** Encodes what a batch asks, for its digest. */
const batchText = new TextEncoder();

/**
 * What names a batch's channel: the SHA-256 of what it asks, each part's
 * length beside it so no two lists of parts read alike — a key as long however
 * much the batch asks (#1351).
 *
 * @param parts - What it asks, each in its channel text
 * @returns The digest, as hex
 */
function digestOf(parts: readonly string[]): string {
    return sha256Hex(batchText.encode(parts.map((part) => `${part.length}:${part}`).join("")));
}

/** A key query's form and literals, as a channel's key names it. */
export function seekQueryText(query: DatasetFindQuery): string {
    return "key" in query
        ? `k=${query.key}`
        : "fields" in query
            ? `f=${query.fields.join("\u0000")}|p=${query.prefix ?? ""}`
            : "prefix" in query
                ? `p=${query.prefix}`
                : `r=${(query.from ?? []).join("\u0000")}|${(query.to ?? []).join("\u0000")}`;
}

/**
 * Tracked-channel key for one batch of reads of one revision (#1351): several
 * key searches, the rows of several keys — or of those another record's runs
 * name (#1393) — or the entries of several runs, each batch named by a digest
 * of what it asks, never by its text: a batch of ten thousand searches is a
 * key as short as one of two.
 *
 * @param workspace - The workspace
 * @param path - The dataset's path
 * @param revision - The revision the batch reads
 * @param selector - The rows it reads
 * @param kind - What it reads
 * @param parts - What it asks, each in its channel text
 * @returns The key
 */
export function pagedBatchKey(
    workspace: string, path: TreePath, revision: string, selector: PagedSelector,
    kind: "seekAll" | "rows" | "joins" | "runs" | "place" | "within", parts: readonly string[],
): string {
    return `${pagedWindowFamily(workspace, path, revision, selector)}#${kind}:${digestOf(parts)}`;
}

/** The family of a narrowing's membership answers (#1349): the runs of one
 *  of a record's indexes, at one revision, named by their digest. */
export function withinFamily(workspace: string, path: TreePath, revision: string, selector: PagedSelector, runs: readonly PagedRun[]): string {
    return `${pagedWindowFamily(workspace, path, revision, selector)}#within:${digestOf(runs.map(([row, count]) => `${row}+${count}`))}`;
}

/** A key query as a batch's wire takes it: its form alone, the index and the
 *  pin being the batch's. */
export function searchOf(query: DatasetFindQuery): DatasetKeySearch {
    const { index: _index, hash: _hash, ...search } = query;
    return search as DatasetKeySearch;
}
