/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<DataTaskPreview>` — preview a non-UI e3 task.
 *
 * Tabs:
 *   - **Output**: size-aware preview of the task's output dataset (delegates
 *     to `<DatasetPreview>`). Inline if small, "Download" button if oversized.
 *   - **Logs**: streamed task execution logs.
 *
 * @packageDocumentation
 */

import { memo, useState } from 'react';
import { Box, Flex, SegmentGroup } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCode, faTerminal } from '@fortawesome/free-solid-svg-icons';
import type { RequestOptions } from '@elaraai/e3-api-client';
import type { TreePath } from '@elaraai/e3-types';
import { useTaskDetails } from '../hooks/useTaskDetails.js';
import { DatasetPreview } from './DatasetPreview.js';
import { TaskLogs } from './TaskLogs.js';
import { StatusDisplay } from './StatusDisplay.js';

type ViewMode = 'output' | 'logs';

export interface DataTaskPreviewProps {
    apiUrl: string;
    repo: string;
    workspace: string;
    task: string;
    requestOptions?: RequestOptions;
    /** Initially selected tab. Default 'output'. */
    initialView?: ViewMode;
    /** Max output bytes to render inline (above → download button). Default 200KB. */
    sizeLimit?: number;
}

function treePathToString(path: TreePath): string {
    return path.map(p => p.value).join('.');
}

export const DataTaskPreview = memo(function DataTaskPreview({
    apiUrl,
    repo,
    workspace,
    task,
    requestOptions,
    initialView = 'output',
    sizeLimit,
}: DataTaskPreviewProps) {
    const [viewMode, setViewMode] = useState<ViewMode>(initialView);
    const detailsQuery = useTaskDetails(apiUrl, repo, workspace, task, {
        ...(requestOptions != null && { requestOptions }),
    });
    const outputPath = detailsQuery.data ? treePathToString(detailsQuery.data.output as TreePath) : null;

    return (
        <Box height="100%" display="flex" flexDirection="column" overflow="hidden">
            <Flex
                px={4} py={2}
                borderBottom="1px solid" borderColor="gray.200" bg="white"
                align="center" justify="flex-end" flexShrink={0}
            >
                <SegmentGroup.Root
                    size="xs"
                    value={viewMode}
                    onValueChange={(d) => setViewMode(d.value as ViewMode)}
                >
                    <SegmentGroup.Indicator />
                    <SegmentGroup.Item value="output" title="Output">
                        <SegmentGroup.ItemText>
                            <FontAwesomeIcon icon={faCode} />
                        </SegmentGroup.ItemText>
                        <SegmentGroup.ItemHiddenInput />
                    </SegmentGroup.Item>
                    <SegmentGroup.Item value="logs" title="Logs">
                        <SegmentGroup.ItemText>
                            <FontAwesomeIcon icon={faTerminal} />
                        </SegmentGroup.ItemText>
                        <SegmentGroup.ItemHiddenInput />
                    </SegmentGroup.Item>
                </SegmentGroup.Root>
            </Flex>
            <Box flex={1} overflow="hidden" minHeight={0}>
                {viewMode === 'output' ? (
                    detailsQuery.isLoading
                        ? <StatusDisplay variant="loading" title="Loading task..." />
                        : detailsQuery.error
                            ? <StatusDisplay variant="error" title="Error" message={detailsQuery.error.message} />
                            : <DatasetPreview
                                apiUrl={apiUrl}
                                repo={repo}
                                workspace={workspace}
                                path={outputPath}
                                {...(requestOptions != null && { requestOptions })}
                                {...(sizeLimit !== undefined && { sizeLimit })}
                            />
                ) : (
                    <TaskLogs
                        apiUrl={apiUrl}
                        repo={repo}
                        workspace={workspace}
                        task={task}
                        {...(requestOptions != null && { requestOptions })}
                    />
                )}
            </Box>
        </Box>
    );
});
