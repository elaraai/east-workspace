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

import { memo, useCallback, useMemo, useState } from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { variant, some, none, encodeBeast2For, type EastTypeValue } from '@elaraai/east';
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

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function DownloadButton({ onClick, label }: { onClick: () => void; label?: string }) {
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
    const shouldFetch = hasValue && !isOversized;

    const valueQuery = useDatasetValue(apiUrl, repo, workspace, path, {
        ...(requestOptions != null && { requestOptions }),
        type: status?.type as never,
        hash: status?.hash ?? null,
        enabled: shouldFetch,
    });
    const download = useDatasetDownload(apiUrl, repo, workspace, path, requestOptions);

    // Editable path: persist a ValueTree edit back to the dataset. `applyEdit`
    // reconciles the decoded value at the reported path, then the existing
    // `useDatasetSet` writer encodes + PUTs it; invalidating the status/value
    // queries refetches the new value, which re-materializes the tree.
    const setMutation = useDatasetSet(apiUrl, repo, workspace, requestOptions);
    const queryClient = useQueryClient();
    const type = status?.type as EastTypeValue | undefined;
    const decoded = valueQuery.data?.decoded;

    const write = useCallback(async (next: unknown) => {
        if (workspace == null || path == null || type === undefined) return;
        const treePath = path.split('.').filter(Boolean).map((p) => variant('field', p));
        const data = encodeBeast2For(type as never)(next as never);
        await setMutation.mutateAsync({ path: treePath, data });
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['datasetStatus', apiUrl, repo, workspace, path] }),
            queryClient.invalidateQueries({ queryKey: ['datasetValue', apiUrl, repo, workspace, path] }),
        ]);
    }, [apiUrl, repo, workspace, path, type, setMutation, queryClient]);

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
        return { root, ...wire, style: some({ height: some('100%'), maxHeight: none }) } as unknown as ValueTreeValue;
    }, [type, decoded, editable, write]);

    if (statusQuery.isLoading) return <StatusDisplay variant="loading" title="Loading..." />;
    if (statusQuery.error) {
        const { message, details } = formatApiError(statusQuery.error);
        return <StatusDisplay variant="error" title="Error" message={message} details={details ?? formatError(statusQuery.error)} />;
    }
    if (!status) return <StatusDisplay variant="info" title="No status" />;
    if (!hasValue) return <StatusDisplay variant="info" title="No data available" message="Waiting for a value to be set" />;

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

    return (
        <Flex direction="column" height="100%" overflow="hidden">
            <Flex px={4} py={2} justify="flex-end" flexShrink={0} borderBottom="1px solid" borderColor="border.subtle">
                <Text fontSize="xs" color="fg.muted" mr={2} alignSelf="center">{formatSize(sizeBytes)}</Text>
                <DownloadButton onClick={download} />
            </Flex>
            <Box flex={1} minHeight={0} overflow="hidden">
                {treeValue !== null && <EastChakraValueTree value={treeValue} storageKey={path ?? 'value'} />}
            </Box>
        </Flex>
    );
});
