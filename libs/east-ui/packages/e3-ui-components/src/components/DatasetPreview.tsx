/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<DatasetPreview>` — size-aware preview of a raw dataset value.
 *
 * Pipeline: status → fetch + decode if size < limit → render via
 * EastValueViewer; otherwise show "download" button.
 *
 * Used for inputs and other "show me this dataset's value" cases. NOT used
 * for UI tasks (those go through `<UITaskPreview>`).
 *
 * @packageDocumentation
 */

import { memo, useState } from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload } from '@fortawesome/free-solid-svg-icons';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { useDatasetStatus } from '../hooks/useDatasetStatus.js';
import { useDatasetValue, useDatasetDownload } from '../hooks/useDatasetValue.js';
import { StatusDisplay } from './StatusDisplay.js';
import { EastValueViewer } from './EastValueViewer.js';
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
            <Box flex={1} overflow="auto" p="4" minHeight={0}>
                <EastValueViewer type={status.type} value={valueQuery.data.decoded} />
            </Box>
        </Flex>
    );
});
