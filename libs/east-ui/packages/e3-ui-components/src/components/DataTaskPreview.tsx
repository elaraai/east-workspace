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
 * A host that draws the preview's controls in its own header (#1120) controls
 * the tab with `view` and `onViewChange`, passes `toolbar={false}` so the
 * preview draws no band, and controls the output's key search with `search`.
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
import { DatasetPreview, type DatasetPreviewProps } from './DatasetPreview.js';
import { TaskLogs } from './TaskLogs.js';
import { StatusDisplay } from './StatusDisplay.js';

type ViewMode = 'output' | 'logs';

export interface DataTaskPreviewProps {
    apiUrl: string;
    repo: string;
    workspace: string;
    task: string;
    requestOptions?: RequestOptions;
    /** Initially selected tab, when `view` is not given. Default 'output'. */
    initialView?: ViewMode;
    /** The tab, controlled (#1120): the preview shows it, and tells
     *  `onViewChange` of a switch rather than making it. */
    view?: ViewMode;
    /** Told the tab the preview's switch picks. */
    onViewChange?: (view: ViewMode) => void;
    /** Max output bytes to render inline (above → download button). Default 200KB. */
    sizeLimit?: number;
    /** `false` draws no band — no Output/Logs switch, and no key search, size
     *  or Download above the output (#1120). Default `true`. */
    toolbar?: boolean;
    /** The output's key search, controlled: see {@link DatasetPreviewProps.search}. */
    search?: string;
    /** Told the text of the output's own search box: see {@link DatasetPreviewProps.onSearchChange}. */
    onSearchChange?: (search: string) => void;
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
    view,
    onViewChange,
    sizeLimit,
    toolbar = true,
    search,
    onSearchChange,
}: DataTaskPreviewProps) {
    // The tab: the host's when it controls it, else the preview's own.
    const [ownView, setOwnView] = useState<ViewMode>(initialView);
    const viewMode = view ?? ownView;
    const pick = (next: ViewMode): void => {
        if (view === undefined) setOwnView(next);
        onViewChange?.(next);
    };
    const detailsQuery = useTaskDetails(apiUrl, repo, workspace, task, {
        ...(requestOptions != null && { requestOptions }),
    });
    const outputPath = detailsQuery.data ? treePathToString(detailsQuery.data.output.path) : null;
    const outputControls: Pick<DatasetPreviewProps, 'toolbar' | 'search' | 'onSearchChange'> = {
        toolbar,
        ...(search !== undefined && { search }),
        ...(onSearchChange !== undefined && { onSearchChange }),
    };

    return (
        <Box height="100%" display="flex" flexDirection="column" overflow="hidden">
            {toolbar && (
                <Flex
                    px={4} py={2}
                    borderBottom="1px solid" borderColor="border.subtle" bg="bg.surface"
                    align="center" justify="flex-end" flexShrink={0}
                >
                    <SegmentGroup.Root
                        size="xs"
                        value={viewMode}
                        onValueChange={(d) => pick(d.value as ViewMode)}
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
            )}
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
                                {...outputControls}
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
