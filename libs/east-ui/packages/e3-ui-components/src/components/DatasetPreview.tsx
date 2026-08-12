/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<DatasetPreview>` — size-aware preview of a raw dataset value.
 *
 * Pipeline: status → fetch + decode if size < limit → materialize + render as
 * an interactive `ValueTree`; otherwise show a "download" button. With
 * `editable`, leaf edits / inserts / removes / tag switches reconcile through
 * `ValueTree.applyEdit` and persist via `useDatasetSet` (for mutable inputs).
 *
 * Used for inputs and other "show me this dataset's value" cases. NOT used
 * for UI tasks (those go through `<UITaskPreview>`).
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import { useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { variant, some, none, compareFor, encodeBeast2For, parseFor, type EastTypeValue } from '@elaraai/east';
import { ValueTree } from '@elaraai/east-ui';
import {
    EastChakraValueTree,
    type ValueTreeValue,
    type ValueTreeStepValue,
    type ValueTreeLeafValue,
} from '@elaraai/east-ui-components';
import { useDatasetStatus } from '../hooks/useDatasetStatus.js';
import { useDatasetValue, useDatasetDownload } from '../hooks/useDatasetValue.js';
import { useDatasetSet } from '../hooks/datasets.js';
import { StatusDisplay } from './StatusDisplay.js';
import { DatasetKeySearch, keyRangePredicates, type DatasetKeyMatchRange, type DatasetKeyQuery } from './DatasetKeySearch.js';
import { PagedDatasetPreview } from './PagedDatasetPreview.js';
import { formatApiError, formatError } from '../errors.js';

const DEFAULT_SIZE_LIMIT = 200 * 1024; // 200KB

export interface DatasetPreviewProps {
    apiUrl: string;
    repo: string;
    workspace: string | null;
    /** Dotted path string, e.g. "inputs.threshold". */
    path: string | null;
    requestOptions?: RequestOptions;
    /** Max bytes to fetch + render inline. Above this → download button. */
    sizeLimit?: number;
    pollInterval?: number;
    /** When set, leaf edits / inserts / removes / tag switches write back to
     *  this dataset path (for mutable inputs). Task outputs stay read-only. */
    editable?: boolean;
}

/** Human-readable byte size, shared with the paged preview. */
export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Download trigger with its own in-flight state, shared with the paged preview. */
export function DownloadButton({ onClick, label }: { onClick: () => void; label?: string }) {
    const [downloading, setDownloading] = useState(false);
    const handleClick = async () => {
        setDownloading(true);
        try { await onClick(); } finally { setDownloading(false); }
    };
    return (
        <Button size="sm" variant="outline" onClick={handleClick} loading={downloading} loadingText="Downloading...">
            <FontAwesomeIcon icon={faDownload} />
            {label ?? 'Download'}
        </Button>
    );
}

export const DatasetPreview = memo(function DatasetPreview({
    apiUrl,
    repo,
    workspace,
    path,
    requestOptions,
    sizeLimit = DEFAULT_SIZE_LIMIT,
    pollInterval,
    editable = false,
}: DatasetPreviewProps) {
    const statusQuery = useDatasetStatus(apiUrl, repo, workspace, path, {
        ...(requestOptions != null && { requestOptions }),
        ...(pollInterval !== undefined && { pollInterval }),
    });
    const status = statusQuery.data;
    const hasValue = status?.refType === 'value' && status.hash !== null;
    const sizeBytes = status?.sizeBytes ?? 0;
    const isOversized = hasValue && sizeBytes > sizeLimit;
    const type = status?.type as EastTypeValue | undefined;
    // Content hash the server refused to page (`dataset_not_indexed` — a
    // legacy blob predating the stored-segmented contract). Keyed by hash so
    // a re-written (indexed) value automatically pages again.
    const [notIndexedHash, setNotIndexedHash] = useState<string | null>(null);
    // Read-only collection roots render through the paged windowed view, at
    // every size — whole-value materialization is reserved for editable
    // inputs and non-collection roots, so an entry-heavy collection can
    // never exhaust the inline materializer mid-list. Editable collections
    // keep the inline (editing) path until they outgrow the size limit, at
    // which point they page read-only like before. Legacy pre-index blobs
    // fall back to the inline tree (or the oversize download) instead of
    // dead-ending in the paged view.
    const pageable = hasValue && type !== undefined &&
        (type.type === 'Array' || type.type === 'Set' || type.type === 'Dict');
    const usePaged = pageable && (!editable || isOversized) &&
        workspace != null && path != null && status?.hash != null &&
        status.hash !== notIndexedHash;
    const shouldFetch = hasValue && !isOversized && !usePaged;

    const valueQuery = useDatasetValue(apiUrl, repo, workspace, path, {
        ...(requestOptions != null && { requestOptions }),
        type: status?.type as never,
        hash: status?.hash ?? null,
        enabled: shouldFetch,
        // An edit changes the value's content hash → a new query key. Keep the
        // current value on screen while the new one loads so an edit doesn't
        // flash the loading state (only the FIRST load has no previous value).
        queryOverrides: { placeholderData: keepPreviousData },
    });
    const download = useDatasetDownload(apiUrl, repo, workspace, path, requestOptions);

    // Editable path: persist a ValueTree edit back to the dataset. `applyEdit`
    // reconciles the decoded value at the reported path, then the existing
    // `useDatasetSet` writer encodes + PUTs it; invalidating the status/value
    // queries refetches the new value, which re-materializes the tree.
    const setMutation = useDatasetSet(apiUrl, repo, workspace, requestOptions);
    const queryClient = useQueryClient();
    const decoded = valueQuery.data?.decoded;

    const write = useCallback(async (next: unknown) => {
        if (workspace == null || path == null || type === undefined) return;
        const treePath = path.split('.').filter(Boolean).map((p) => variant('field', p));
        const data = encodeBeast2For(type as never)(next as never);
        await setMutation.mutateAsync({ path: treePath, data });
        // Refetch the status only — the new content hash it returns re-keys the
        // value query, which loads the new value (kept smooth by placeholderData
        // above). Invalidating the value query too would refetch the stale hash.
        await queryClient.invalidateQueries({ queryKey: ['datasetStatus', apiUrl, repo, workspace, path] });
    }, [apiUrl, repo, workspace, path, type, setMutation, queryClient]);

    // Inline key search (#520): the same control as the paged preview, with
    // a client-side jump over the already-decoded keys (decoded Set/Dict
    // values iterate in canonical East key order, so index = row).
    const keyType = useMemo<EastTypeValue | null>(() => (
        type === undefined ? null
        : type.type === 'Dict' ? (type.value as { key: EastTypeValue; value: EastTypeValue }).key
        : type.type === 'Set' ? type.value as EastTypeValue
        : null
    ), [type]);
    const inlineKeys = useMemo<unknown[] | null>(() => (
        decoded === undefined || type === undefined ? null
        : type.type === 'Dict' ? [...(decoded as Map<unknown, unknown>).keys()]
        : type.type === 'Set' ? [...(decoded as Set<unknown>).values()]
        : null
    ), [type, decoded]);
    const [jumpRow, setJumpRow] = useState<number | undefined>(undefined);
    useEffect(() => { setJumpRow(undefined); }, [decoded]);
    const onFindInline = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        if (inlineKeys === null || keyType === null) return { found: false, row: 0, count: 0 };
        const range = keyRangePredicates(keyType, query);
        if (range === null) {
            // Whole-key literal: an exact lookup in the sorted keys.
            const parsed = parseFor(keyType)((query as { key: string }).key);
            if (!parsed.success) return { found: false, row: 0, count: 0 };
            const cmp = compareFor(keyType);
            for (let i = 0; i < inlineKeys.length; i++) {
                const order = cmp(inlineKeys[i], parsed.value);
                if (order === 0) return { found: true, row: i, count: 1 };
                if (order > 0) return { found: false, row: i, count: 0 };
            }
            return { found: false, row: inlineKeys.length, count: 0 };
        }
        let row = inlineKeys.findIndex(range.lower);
        if (row === -1) row = inlineKeys.length;
        let count = 0;
        while (row + count < inlineKeys.length && !range.upper(inlineKeys[row + count])) count++;
        return { found: count > 0, row, count };
    }, [inlineKeys, keyType]);
    const onListInline = useCallback(async (row: number, limit: number): Promise<string[]> => {
        if (inlineKeys === null || keyType === null) return [];
        const stringKeys = keyType.type === 'String';
        return inlineKeys.slice(row, row + limit)
            .map((k) => (stringKeys ? k as string : ValueTree.keyLabel(keyType as never, k)));
    }, [inlineKeys, keyType]);

    const treeValue = useMemo<ValueTreeValue | null>(() => {
        if (type === undefined || decoded === undefined) return null;
        const root = ValueTree.materialize(type, decoded);
        const wire = editable
            ? {
                onEdit: some((p: ValueTreeStepValue[], leaf: ValueTreeLeafValue) => write(ValueTree.applyEdit(type, decoded, p, { kind: 'edit', leaf }))),
                onInsert: some((p: ValueTreeStepValue[]) => write(ValueTree.applyEdit(type, decoded, p, { kind: 'insert' }))),
                onRemove: some((p: ValueTreeStepValue[]) => write(ValueTree.applyEdit(type, decoded, p, { kind: 'remove' }))),
                onTag: some((p: ValueTreeStepValue[], tag: string) => write(ValueTree.applyEdit(type, decoded, p, { kind: 'tag', tag }))),
            }
            : { onEdit: none, onInsert: none, onRemove: none, onTag: none };
        return { root, ...wire, style: some({ height: some('100%'), maxHeight: none, openDepth: none, toolbar: some(true) }) } as unknown as ValueTreeValue;
    }, [type, decoded, editable, write]);

    if (statusQuery.isLoading) return <StatusDisplay variant="loading" title="Loading..." />;
    if (statusQuery.error) {
        const { message, details } = formatApiError(statusQuery.error);
        return <StatusDisplay variant="error" title="Error" message={message} details={details ?? formatError(statusQuery.error)} />;
    }
    if (!status) return <StatusDisplay variant="info" title="No status" />;
    if (!hasValue) return <StatusDisplay variant="info" title="No data available" message="Waiting for a value to be set" />;

    if (usePaged && type !== undefined && workspace != null && path != null && status.hash != null) {
        const pagedHash = status.hash;
        return (
            <PagedDatasetPreview
                apiUrl={apiUrl}
                repo={repo}
                workspace={workspace}
                path={path}
                type={type}
                hash={pagedHash}
                sizeBytes={sizeBytes}
                {...(requestOptions != null && { requestOptions })}
                onDownload={download}
                onNotIndexed={() => setNotIndexedHash(pagedHash)}
            />
        );
    }

    if (isOversized) {
        return (
            <Flex height="100%" direction="column" align="center" justify="center" layerStyle="banner.stale" borderRadius="0" gap={3} p={6}>
                <Text fontSize="lg" color="fg.warning" fontWeight="bold">Value too large to display</Text>
                <Text color="fg.muted" fontSize="sm">
                    The data is {formatSize(sizeBytes)}, which exceeds the {formatSize(sizeLimit)} display limit.
                </Text>
                <DownloadButton onClick={download} label="Download value" />
            </Flex>
        );
    }

    if (valueQuery.isLoading || !valueQuery.data) return <StatusDisplay variant="loading" title="Loading..." />;
    if (valueQuery.error) return <StatusDisplay variant="error" title="Decode failed" message={valueQuery.error.message} />;

    // Collection roots show their entry count beside the byte size — the
    // same header the paged view renders, so small and large datasets read
    // identically.
    const count = type === undefined || decoded === undefined ? null
        : type.type === 'Array' ? (decoded as unknown[]).length
        : type.type === 'Set' || type.type === 'Dict' ? (decoded as { size: number }).size
        : null;
    const countText = count === null ? ''
        : `${count.toLocaleString()} ${type?.type === 'Dict' ? 'entries' : 'items'} · `;

    return (
        <Flex direction="column" height="100%" overflow="hidden">
            <Flex px={4} py={2} gap={2} align="center" flexShrink={0} borderBottom="1px solid" borderColor="border.subtle">
                {keyType !== null && inlineKeys !== null && (
                    <DatasetKeySearch keyType={keyType} onFind={onFindInline} onListRange={onListInline}
                        onJump={setJumpRow} onClear={() => setJumpRow(undefined)} />
                )}
                <Flex flex={1} justify="flex-end" align="center" gap={2}>
                    <Text fontSize="xs" color="fg.muted">{countText}{formatSize(sizeBytes)}</Text>
                    <DownloadButton onClick={download} />
                </Flex>
            </Flex>
            <Box flex={1} minHeight={0} overflow="hidden">
                {treeValue !== null && <EastChakraValueTree value={treeValue} storageKey={path ?? 'value'} scrollToRow={jumpRow} />}
            </Box>
        </Flex>
    );
});
