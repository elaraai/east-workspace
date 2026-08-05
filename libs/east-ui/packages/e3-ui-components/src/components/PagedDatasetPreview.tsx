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
import { datasetGetPage } from '@elaraai/e3-api-client';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { none, printFor, some, variant, decodeBeast2For, type EastTypeValue } from '@elaraai/east';
import { ValueTree } from '@elaraai/east-ui';
import {
    EastChakraValueTree,
    type ValueTreeValue,
    type ValueTreePagedRow,
    type ValueTreePaging,
} from '@elaraai/east-ui-components';
import { StatusDisplay } from './StatusDisplay.js';
import { DownloadButton, formatSize } from './DatasetPreview.js';

/** Elements fetched per page — one remote window per scroll-ahead page. */
const PAGE_SIZE = 500;

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
        const printKey = printFor(keyType as never);
        const stringKeys = keyType.type === 'String';
        return Array.from((decoded as Map<unknown, unknown>).entries()).map(([k, v], i) => ({
            node: ValueTree.materialize(valueType, v),
            step: stringKeys ? variant('key', k as string) : variant('index', BigInt(offset + i)),
            label: stringKeys ? (k as string) : printKey(k as never),
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
}: PagedDatasetPreviewProps) {
    const queryClient = useQueryClient();
    const [pages, setPages] = useState<ReadonlyMap<number, readonly ValueTreePagedRow[]>>(new Map());
    const [totals, setTotals] = useState<{ elements: number; exact: boolean } | null>(null);
    const [loadingCount, setLoadingCount] = useState(0);
    const [error, setError] = useState<Error | null>(null);
    const inflightRef = useRef(new Set<number>());

    // A new value (content hash) invalidates every page.
    useEffect(() => {
        setPages(new Map());
        setTotals(null);
        setError(null);
        inflightRef.current.clear();
    }, [hash]);

    const loadPage = useCallback((pageIdx: number) => {
        if (inflightRef.current.has(pageIdx)) return;
        inflightRef.current.add(pageIdx);
        setLoadingCount((n) => n + 1);
        const pathParts = path.split('.').filter(Boolean).map((v) => variant('field', v));
        const reqOpts = requestOptions ?? { token: null };
        queryClient.fetchQuery({
            queryKey: ['datasetPage', apiUrl, repo, workspace, path, hash, `p${pageIdx}`],
            queryFn: () => datasetGetPage(apiUrl, repo, workspace, pathParts, { offset: pageIdx * PAGE_SIZE, limit: PAGE_SIZE }, reqOpts),
            staleTime: Infinity, // pages of one content hash are immutable
        }).then((page) => {
            const decoded = decodeBeast2For(type)(page.data);
            const rows = pageRows(type, decoded, page.offset);
            setTotals({ elements: page.totalElements, exact: page.totalExact });
            setPages((prev) => new Map(prev).set(pageIdx, rows));
        }).catch((err: unknown) => {
            setError(err instanceof Error ? err : new Error(String(err)));
        }).finally(() => {
            inflightRef.current.delete(pageIdx);
            setLoadingCount((n) => n - 1);
        });
    }, [queryClient, apiUrl, repo, workspace, path, hash, requestOptions, type]);

    // First page carries the totals that size the virtual scrollbar.
    useEffect(() => {
        if (totals === null && error === null) loadPage(0);
    }, [totals, error, loadPage]);

    const onNeedRows = useCallback((startRow: number, endRow: number) => {
        const first = Math.max(0, Math.floor(startRow / PAGE_SIZE));
        const last = Math.max(first, Math.ceil(endRow / PAGE_SIZE) - 1);
        for (let p = first; p <= last; p++) {
            if (!pages.has(p)) loadPage(p);
        }
    }, [pages, loadPage]);

    const treeValue = useMemo<ValueTreeValue>(() => ({
        root: ValueTree.materialize(type, emptyOf(type)),
        onEdit: none,
        onInsert: none,
        onRemove: none,
        onTag: none,
        style: some({ height: some('100%'), maxHeight: none }),
    }) as unknown as ValueTreeValue, [type]);

    const paging = useMemo<ValueTreePaging | null>(() => (
        totals === null ? null : {
            totalRows: totals.elements,
            pageSize: PAGE_SIZE,
            pages,
            onNeedRows,
        }
    ), [totals, pages, onNeedRows]);

    if (error !== null) {
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
                    {totals.elements.toLocaleString()}{totals.exact ? '' : '+'} {itemNoun} · {formatSize(sizeBytes)}
                </Text>
                {loadingCount > 0 && <Text fontSize="xs" color="fg.muted">Loading…</Text>}
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
