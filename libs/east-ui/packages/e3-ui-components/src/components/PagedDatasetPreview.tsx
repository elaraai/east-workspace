/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<PagedDatasetPreview>` — virtual-scroll preview of a large collection
 * dataset.
 *
 * Rides the ValueTree renderer's remote-paging contract: the tree's
 * scrollbar spans the WHOLE collection, unloaded rows render as
 * placeholders, and scrolling requests the element windows that come into
 * view (fetched through the paged dataset API, one page per window, deduped
 * and cached by content hash). Used by `<DatasetPreview>` when a dataset's
 * type is pageable (Array/Set/Dict) and its value exceeds the inline display
 * limit — pageable datasets always load, they never dead-end on size.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, datasetFindKey, datasetGetPage } from '@elaraai/e3-api-client';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { none, some, variant, decodeBeast2For, type EastTypeValue } from '@elaraai/east';
import { ValueTree } from '@elaraai/east-ui';
import {
    EastChakraValueTree,
    type ValueTreeValue,
    type ValueTreePagedRow,
    type ValueTreePaging,
} from '@elaraai/east-ui-components';
import { StatusDisplay } from './StatusDisplay.js';
import { DatasetKeySearch, type DatasetKeyMatchRange, type DatasetKeyQuery } from '@elaraai/east-ui-components';
import { DownloadButton, formatSize } from './DatasetPreview.js';
import { pagingDebug } from '../debug.js';

/** Elements fetched per page — one remote window per scroll-ahead page. */
const PAGE_SIZE = 500;

/** Loaded pages retained around the current window. Materialized rows are
 *  heavy (each row's whole value becomes ValueTree node IR — wide rows run
 *  to tens of KB apiece), so unbounded retention OOMs the webview on
 *  GB-scale datasets, and re-flattening every retained page on each page
 *  arrival is what made scrolling degrade over time. Evicted pages fall
 *  back to placeholders and reload on return (raw page bytes stay in the
 *  hash-pinned query cache, so a return pays decode + materialize only). */
const MAX_RETAINED_PAGES = 8;

/** Drops loaded pages far from the window `[firstPage, lastPage]`, keeping
 *  the window itself and then the nearest pages up to the retention cap. */
export function pruneRetainedPages<T>(
    pages: ReadonlyMap<number, T>,
    firstPage: number,
    lastPage: number,
    max: number,
): ReadonlyMap<number, T> {
    if (pages.size <= max) return pages;
    const distance = (p: number): number => (p < firstPage ? firstPage - p : p > lastPage ? p - lastPage : 0);
    const keep = [...pages.keys()].sort((a, b) => distance(a) - distance(b) || a - b).slice(0, max);
    const kept = new Map<number, T>();
    for (const p of keep.sort((a, b) => a - b)) {
        kept.set(p, pages.get(p)!);
    }
    return kept;
}

export interface PagedDatasetPreviewProps {
    apiUrl: string;
    repo: string;
    workspace: string;
    /** Dotted path string, e.g. "inputs.rows". */
    path: string;
    /** The dataset's East type (an Array/Set/Dict root). */
    type: EastTypeValue;
    /** Content hash of the current value — resets pages when it changes. */
    hash: string;
    /** Stored blob size, shown alongside the totals. */
    sizeBytes: number;
    requestOptions?: RequestOptions;
    /** Triggers a whole-value download (the existing download flow). */
    onDownload: () => void | Promise<void>;
    /** Called when the server refuses the blob as un-pageable
     *  (`dataset_not_indexed` — a legacy blob predating the stored-segmented
     *  contract). The parent falls back to the inline tree so pre-index
     *  values keep rendering instead of dead-ending here. */
    onNotIndexed?: () => void;
}

/** Materializes one decoded page into the renderer's paged-row contract. */
function pageRows(type: EastTypeValue, decoded: unknown, offset: number): ValueTreePagedRow[] {
    if (type.type === 'Array') {
        const elemType = type.value as EastTypeValue;
        return (decoded as unknown[]).map((el, i) => ({
            node: ValueTree.materialize(elemType, el),
            step: variant('index', BigInt(offset + i)),
        }));
    }
    if (type.type === 'Dict') {
        const { key: keyType, value: valueType } = type.value as { key: EastTypeValue; value: EastTypeValue };
        const stringKeys = keyType.type === 'String';
        return Array.from((decoded as Map<unknown, unknown>).entries()).map(([k, v], i) => ({
            node: ValueTree.materialize(valueType, v),
            step: stringKeys ? variant('key', k as string) : variant('index', BigInt(offset + i)),
            label: stringKeys ? (k as string) : ValueTree.keyLabel(keyType, k),
        }));
    }
    const elemType = type.value as EastTypeValue;
    return Array.from((decoded as Set<unknown>).values()).map((el, i) => ({
        node: ValueTree.materialize(elemType, el),
        step: variant('index', BigInt(offset + i)),
    }));
}

/** The empty collection value of a pageable root — the paged tree's root
 *  node carries kind only; rows come from the pages. */
function emptyOf(type: EastTypeValue): unknown {
    return type.type === 'Array' ? [] : type.type === 'Dict' ? new Map() : new Set();
}

export const PagedDatasetPreview = memo(function PagedDatasetPreview({
    apiUrl,
    repo,
    workspace,
    path,
    type,
    hash,
    sizeBytes,
    requestOptions,
    onDownload,
    onNotIndexed,
}: PagedDatasetPreviewProps) {
    const queryClient = useQueryClient();
    const [pages, setPages] = useState<ReadonlyMap<number, readonly ValueTreePagedRow[]>>(new Map());
    const [totals, setTotals] = useState<{ elements: number; bytes: number } | null>(null);
    const [loadingCount, setLoadingCount] = useState(0);
    const [error, setError] = useState<Error | null>(null);
    /** Key-search jump target — the tree's controlled scrollToRow (#520). */
    const [jumpRow, setJumpRow] = useState<number | undefined>(undefined);
    const inflightRef = useRef(new Set<number>());

    // A new value (content hash) invalidates every page.
    useEffect(() => {
        pagingDebug(`reset (path=${path}, hash=${hash.slice(0, 8)})`);
        setPages(new Map());
        setTotals(null);
        setError(null);
        setJumpRow(undefined);
        inflightRef.current.clear();
    }, [path, hash]);

    const loadPage = useCallback((pageIdx: number) => {
        if (inflightRef.current.has(pageIdx)) return;
        inflightRef.current.add(pageIdx);
        setLoadingCount((n) => n + 1);
        pagingDebug(`fetch p${pageIdx} (offset=${pageIdx * PAGE_SIZE}, limit=${PAGE_SIZE}, hash=${hash.slice(0, 8)})`);
        const pathParts = path.split('.').filter(Boolean).map((v) => variant('field', v));
        const reqOpts = requestOptions ?? { token: null };
        queryClient.fetchQuery({
            queryKey: ['datasetPage', apiUrl, repo, workspace, path, hash, `p${pageIdx}`],
            // Hash-pinned: the URL is a pure function of the bytes, so any
            // HTTP cache between here and the server can hold it immutably.
            queryFn: () => datasetGetPage(apiUrl, repo, workspace, pathParts, { offset: pageIdx * PAGE_SIZE, limit: PAGE_SIZE, hash }, reqOpts),
            staleTime: Infinity, // pages of one content hash are immutable
        }).then((page) => {
            const decoded = decodeBeast2For(type)(page.data);
            const rows = pageRows(type, decoded, page.offset);
            pagingDebug(`p${pageIdx} ok: count=${page.count} rows=${rows.length} offset=${page.offset} total=${page.totalElements} segs=${page.segmentCount}`,
                rows.length > 0 ? `first=${JSON.stringify(rows[0]!.label ?? '(derived)')}` : '(empty)');
            if (page.count < PAGE_SIZE && page.offset + page.count < page.totalElements) {
                pagingDebug(`p${pageIdx} SHORT page: server clamped ${PAGE_SIZE} → ${page.count}`);
            }
            setTotals({ elements: page.totalElements, bytes: page.totalBytes });
            setPages((prev) => new Map(prev).set(pageIdx, rows));
        }).catch((err: unknown) => {
            pagingDebug(`p${pageIdx} FAILED:`, err);
            if (err instanceof ApiError && err.code === 'dataset_not_indexed') {
                // A legacy (pre-index) blob cannot page — hand back to the
                // parent, which falls back to the inline tree. The error
                // state below stays as the backstop UI if no parent handles.
                onNotIndexed?.();
            }
            setError(err instanceof Error ? err : new Error(String(err)));
        }).finally(() => {
            inflightRef.current.delete(pageIdx);
            setLoadingCount((n) => n - 1);
        });
    }, [queryClient, apiUrl, repo, workspace, path, hash, requestOptions, type, onNotIndexed]);

    // First page carries the totals that size the virtual scrollbar.
    useEffect(() => {
        if (totals === null && error === null) loadPage(0);
    }, [totals, error, loadPage]);

    const onNeedRows = useCallback((startRow: number, endRow: number) => {
        const first = Math.max(0, Math.floor(startRow / PAGE_SIZE));
        const last = Math.max(first, Math.ceil(endRow / PAGE_SIZE) - 1);
        const missing: number[] = [];
        for (let p = first; p <= last; p++) {
            if (!pages.has(p)) missing.push(p);
        }
        pagingDebug(`need rows [${startRow}, ${endRow}) → pages ${first}..${last}, missing=[${missing.join(',')}], inflight=[${[...inflightRef.current].join(',')}]`);
        // Retention: drop pages far from this window (same reference back —
        // and no re-render — while under the cap), so heap and per-arrival
        // re-flatten stay bounded however far the user roams.
        setPages((prev) => pruneRetainedPages(prev, first, last, MAX_RETAINED_PAGES));
        for (const p of missing) loadPage(p);
    }, [pages, loadPage]);

    // Key search (#520): queries resolve server-side against the segment
    // fences; results and popup windows are hash-pinned and immutable, so
    // repeated type-ahead queries are cache hits.
    const keyType = useMemo<EastTypeValue | null>(() => (
        type.type === 'Dict' ? (type.value as { key: EastTypeValue; value: EastTypeValue }).key
        : type.type === 'Set' ? type.value as EastTypeValue
        : null
    ), [type]);
    const pathParts = useMemo(() => path.split('.').filter(Boolean).map((v) => variant('field', v)), [path]);
    const onFindKey = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        const reqOpts = requestOptions ?? { token: null };
        const queryTag = JSON.stringify(query);
        const result = await queryClient.fetchQuery({
            queryKey: ['datasetFind', apiUrl, repo, workspace, path, hash, queryTag],
            queryFn: () => datasetFindKey(apiUrl, repo, workspace, pathParts, { ...query, hash }, reqOpts),
            staleTime: Infinity, // hash-pinned: one content hash, one answer
        });
        pagingDebug(`find ${queryTag}: found=${result.found} row=${result.row} count=${result.count}`);
        return result;
    }, [queryClient, apiUrl, repo, workspace, path, hash, pathParts, requestOptions]);
    const onListRange = useCallback(async (row: number, limit: number): Promise<string[]> => {
        const reqOpts = requestOptions ?? { token: null };
        const page = await queryClient.fetchQuery({
            queryKey: ['datasetPage', apiUrl, repo, workspace, path, hash, `w${row}:${limit}`],
            queryFn: () => datasetGetPage(apiUrl, repo, workspace, pathParts, { offset: row, limit, hash }, reqOpts),
            staleTime: Infinity,
        });
        const decoded = decodeBeast2For(type)(page.data);
        const stringKeys = keyType !== null && keyType.type === 'String';
        const keys = type.type === 'Dict'
            ? [...(decoded as Map<unknown, unknown>).keys()]
            : [...(decoded as Set<unknown>).values()];
        return keys.map((k) => (stringKeys ? k as string : ValueTree.keyLabel(keyType as never, k)));
    }, [queryClient, apiUrl, repo, workspace, path, hash, pathParts, requestOptions, type, keyType]);

    const treeValue = useMemo<ValueTreeValue>(() => ({
        root: ValueTree.materialize(type, emptyOf(type)),
        onEdit: none,
        onInsert: none,
        onRemove: none,
        onTag: none,
        style: some({ height: some('100%'), maxHeight: none, openDepth: none, toolbar: some(true) }),
    }) as unknown as ValueTreeValue, [type]);

    const paging = useMemo<ValueTreePaging | null>(() => (
        totals === null ? null : {
            totalRows: totals.elements,
            pageSize: PAGE_SIZE,
            pages,
            onNeedRows,
            scrollToRow: jumpRow,
        }
    ), [totals, pages, onNeedRows, jumpRow]);

    if (error !== null) {
        // The server refusing for its own safety (read cap) is not a
        // failure — show the remedy and the download escape hatch.
        if (error instanceof ApiError && error.code === 'dataset_too_large') {
            return (
                <Flex height="100%" direction="column" align="center" justify="center" gap={3} p={6}>
                    <Text fontSize="lg" color="fg.warning" fontWeight="bold">Too large to page</Text>
                    <Text color="fg.muted" fontSize="sm" textAlign="center" maxW="32rem">
                        {typeof error.details === 'string' ? error.details : 'This dataset cannot be paged server-side.'}
                    </Text>
                    <DownloadButton onClick={onDownload} label="Download value" />
                </Flex>
            );
        }
        return <StatusDisplay variant="error" title="Paged load failed" message={error.message} />;
    }
    if (paging === null || totals === null) {
        return <StatusDisplay variant="loading" title="Loading..." />;
    }

    const itemNoun = type.type === 'Dict' ? 'entries' : 'items';
    return (
        <Flex direction="column" height="100%" overflow="hidden">
            <Flex px={4} py={2} gap={2} align="center" flexShrink={0} borderBottom="1px solid" borderColor="border.subtle">
                <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                    {totals.elements.toLocaleString()} {itemNoun} · {formatSize(totals.bytes > 0 ? totals.bytes : sizeBytes)}
                </Text>
                {loadingCount > 0 && <Text fontSize="xs" color="fg.muted">Loading…</Text>}
                {keyType !== null && (
                    <DatasetKeySearch keyType={keyType} onFind={onFindKey} onListRange={onListRange}
                        onJump={setJumpRow} onClear={() => setJumpRow(undefined)} />
                )}
                <Flex flex={1} justify="flex-end">
                    <DownloadButton onClick={onDownload} />
                </Flex>
            </Flex>
            <Box flex={1} minHeight={0} overflow="hidden">
                <EastChakraValueTree value={treeValue} storageKey={`${path}:page`} paging={paging} />
            </Box>
        </Flex>
    );
}, (prev, next) => prev.path === next.path && prev.workspace === next.workspace && prev.hash === next.hash && prev.sizeBytes === next.sizeBytes);
