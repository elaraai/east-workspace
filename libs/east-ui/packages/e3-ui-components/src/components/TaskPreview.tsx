/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<TaskPreview>` — router for previewing an e3 task.
 *
 * Branches by the task's `role`:
 *   - `ui`   → `<UITaskPreview>`
 *   - `data` → `<DataTaskPreview>` (output preview tabs + logs)
 *
 * A host that draws a data task's controls in its own header (#1120) passes
 * `toolbar={false}` and controls the tab (`view`, `onViewChange`) and the
 * output's key search (`search`, `onSearchChange`); the log's stream
 * (`logStream`, `onLogStreamChange`) and search (`logSearch`,
 * `onLogSearchChange`), and hears its matches (`onLogMatchesChange`); and
 * collapses and expands the value's tree, steps through the log's matches and
 * copies the log through the `controls` it makes with `usePreviewControls`
 * (#1209). They reach the data task's preview; a ui task's preview, which
 * draws no band, ignores them.
 *
 * @packageDocumentation
 */

import { memo } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { UITaskPreview } from './UITaskPreview.js';
import { DataTaskPreview, type DataTaskPreviewProps } from './DataTaskPreview.js';
import { useTaskDetails } from '../hooks/useTaskDetails.js';
import { StatusDisplay } from './StatusDisplay.js';

export interface TaskPreviewProps {
    apiUrl: string;
    repo: string;
    workspace: string;
    task: string;
    requestOptions?: RequestOptions;
    /**
     * Chromeless mode: drop the task-name header bar and, for a `ui` task,
     * render the output edge-to-edge (forwarded to {@link UITaskPreview} as
     * `bare`) — for host kiosk embedding of a deployed `<App>`. Default `false`.
     */
    bare?: boolean;
    /** A data task's tab, controlled: see {@link DataTaskPreviewProps.view}. */
    view?: DataTaskPreviewProps['view'];
    /** Told the tab a data task's switch picks. */
    onViewChange?: DataTaskPreviewProps['onViewChange'];
    /** `false` draws no band anywhere in a data task's preview (#1120,
     *  #1209): see {@link DataTaskPreviewProps.toolbar}. Default `true`. */
    toolbar?: boolean;
    /** A data task's output's key search, controlled: see {@link DataTaskPreviewProps.search}. */
    search?: string;
    /** Told the text of the output's own search box: see {@link DataTaskPreviewProps.onSearchChange}. */
    onSearchChange?: (search: string) => void;
    /** A data task's log's stream, controlled: see {@link DataTaskPreviewProps.logStream}. */
    logStream?: DataTaskPreviewProps['logStream'];
    /** Told the stream the log's tabs pick. */
    onLogStreamChange?: DataTaskPreviewProps['onLogStreamChange'];
    /** A data task's log's search, controlled: see {@link DataTaskPreviewProps.logSearch}. */
    logSearch?: string;
    /** Told the text of the log's own search box: see {@link DataTaskPreviewProps.onLogSearchChange}. */
    onLogSearchChange?: (search: string) => void;
    /** Told the log's matches: see {@link DataTaskPreviewProps.onLogMatchesChange}. */
    onLogMatchesChange?: DataTaskPreviewProps['onLogMatchesChange'];
    /** The handle a host's own controls act through: see {@link DataTaskPreviewProps.controls}. */
    controls?: DataTaskPreviewProps['controls'];
}

export const TaskPreview = memo(function TaskPreview({
    apiUrl,
    repo,
    workspace,
    task,
    requestOptions,
    bare = false,
    view,
    onViewChange,
    toolbar,
    search,
    onSearchChange,
    logStream,
    onLogStreamChange,
    logSearch,
    onLogSearchChange,
    onLogMatchesChange,
    controls,
}: TaskPreviewProps) {
    const detailsQuery = useTaskDetails(apiUrl, repo, workspace, task, {
        ...(requestOptions != null && { requestOptions }),
    });
    const isUI = detailsQuery.data?.role.type === 'ui';

    return (
        <Box height="100%" display="flex" flexDirection="column" overflow="hidden">
            {/* The task-name header is preview chrome; a bare kiosk drops it so
                the client <App> owns the whole surface. */}
            {!bare && (
                <Flex px={4} py={2} borderBottom="1px solid" borderColor="border.subtle" bg="bg.surface" align="center" flexShrink={0}>
                    <Text fontSize="body.lg" fontWeight="medium" color="fg">{task}</Text>
                </Flex>
            )}
            <Box flex={1} overflow="hidden" minHeight={0}>
                {detailsQuery.isLoading
                    ? <StatusDisplay variant="loading" title="Loading task..." />
                    : detailsQuery.error
                        ? <StatusDisplay variant="error" title="Error" message={detailsQuery.error.message} />
                        : isUI
                            ? <UITaskPreview
                                task={task}
                                bare={bare}
                                config={{
                                    apiUrl, repo, workspace, token: requestOptions?.token ?? null,
                                    ...(requestOptions?.fetch !== undefined && { fetch: requestOptions.fetch }),
                                }}
                            />
                            : <DataTaskPreview
                                apiUrl={apiUrl}
                                repo={repo}
                                workspace={workspace}
                                task={task}
                                {...(requestOptions != null && { requestOptions })}
                                {...(view !== undefined && { view })}
                                {...(onViewChange !== undefined && { onViewChange })}
                                {...(toolbar !== undefined && { toolbar })}
                                {...(search !== undefined && { search })}
                                {...(onSearchChange !== undefined && { onSearchChange })}
                                {...(logStream !== undefined && { logStream })}
                                {...(onLogStreamChange !== undefined && { onLogStreamChange })}
                                {...(logSearch !== undefined && { logSearch })}
                                {...(onLogSearchChange !== undefined && { onLogSearchChange })}
                                {...(onLogMatchesChange !== undefined && { onLogMatchesChange })}
                                {...(controls !== undefined && { controls })}
                            />
                }
            </Box>
        </Box>
    );
}, (prev, next) => prev.task === next.task && prev.apiUrl === next.apiUrl && prev.repo === next.repo
    && prev.workspace === next.workspace && prev.bare === next.bare
    // A rotated token, or another fetch, re-renders the preview, or its reads
    // keep the old one.
    && prev.requestOptions?.token === next.requestOptions?.token
    && Object.is(prev.requestOptions?.fetch, next.requestOptions?.fetch)
    // The host's controls (#1120, #1209).
    && prev.view === next.view && prev.toolbar === next.toolbar && prev.search === next.search
    && Object.is(prev.onViewChange, next.onViewChange) && Object.is(prev.onSearchChange, next.onSearchChange)
    && prev.logStream === next.logStream && prev.logSearch === next.logSearch
    && Object.is(prev.onLogStreamChange, next.onLogStreamChange) && Object.is(prev.onLogSearchChange, next.onLogSearchChange)
    && Object.is(prev.onLogMatchesChange, next.onLogMatchesChange) && Object.is(prev.controls, next.controls));
