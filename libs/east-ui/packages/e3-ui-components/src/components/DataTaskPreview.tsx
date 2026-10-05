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
 * The bands `toolbar={false}` hides are all of the preview's — the value
 * tree's Collapse all and Expand all, and the log's tabs, search and Copy
 * too — so the host also controls the log's stream and search, hears its
 * matches, and does the rest through the `controls` it makes with
 * `usePreviewControls` (#1209).
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
import { logControlsOf, type PreviewControls } from './preview-controls.js';
import type { LogMatches } from './VirtualizedLogViewer.js';

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
    /** `false` draws no band — no Output/Logs switch; no key search, size or
     *  Download above the output (#1120), nor its tree's Collapse all and
     *  Expand all; and no tabs, search or Copy above the log, which fills the
     *  view (#1209). Default `true`. */
    toolbar?: boolean;
    /** The output's key search, controlled: see {@link DatasetPreviewProps.search}. */
    search?: string;
    /** Told the text of the output's own search box: see {@link DatasetPreviewProps.onSearchChange}. */
    onSearchChange?: (search: string) => void;
    /** The log's stream, controlled (#1209): the log's tabs show it, and tell
     *  `onLogStreamChange` of a click rather than switching. */
    logStream?: 'stdout' | 'stderr';
    /** Told the stream the log's tabs pick. */
    onLogStreamChange?: (stream: 'stdout' | 'stderr') => void;
    /** The log's search, controlled (#1209): the log draws no search box,
     *  count or chevrons of its own, marks the text's matches in any case and
     *  scrolls to the first; `''` clears. */
    logSearch?: string;
    /** Told the text of the log's own search box as it is edited, unless
     *  `logSearch` is given. */
    onLogSearchChange?: (search: string) => void;
    /** Told the log's match shown (from 0) and how many there are whenever
     *  either changes, for the host's "3/17" (#1209). */
    onLogMatchesChange?: (matches: LogMatches) => void;
    /** The handle a host's own controls act through, made with
     *  `usePreviewControls` (#1209). */
    controls?: PreviewControls;
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
    logStream,
    onLogStreamChange,
    logSearch,
    onLogSearchChange,
    onLogMatchesChange,
    controls,
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
    const outputControls: Pick<DatasetPreviewProps, 'toolbar' | 'search' | 'onSearchChange' | 'controls'> = {
        toolbar,
        ...(search !== undefined && { search }),
        ...(onSearchChange !== undefined && { onSearchChange }),
        ...(controls !== undefined && { controls }),
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
                        toolbar={toolbar}
                        stream={logStream}
                        onStreamChange={onLogStreamChange}
                        search={logSearch}
                        onSearchChange={onLogSearchChange}
                        onMatchesChange={onLogMatchesChange}
                        controlsRef={logControlsOf(controls)}
                    />
                )}
            </Box>
        </Box>
    );
});
