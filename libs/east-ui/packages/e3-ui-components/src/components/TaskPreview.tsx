/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<TaskPreview>` — router for previewing an e3 task.
 *
 * Branches by task `kind`:
 *   - `kind === 'ui'`   → `<UITaskPreview>`
 *   - otherwise          → `<DataTaskPreview>` (output preview tabs + logs)
 *
 * @packageDocumentation
 */

import { memo } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import type { RequestOptions } from '@elaraai/e3-api-client';
import { UITaskPreview } from './UITaskPreview.js';
import { DataTaskPreview } from './DataTaskPreview.js';
import { useTaskDetails, getTaskKind } from '../hooks/useTaskDetails.js';
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
}

export const TaskPreview = memo(function TaskPreview({
    apiUrl,
    repo,
    workspace,
    task,
    requestOptions,
    bare = false,
}: TaskPreviewProps) {
    const detailsQuery = useTaskDetails(apiUrl, repo, workspace, task, {
        ...(requestOptions != null && { requestOptions }),
    });
    const kind = detailsQuery.data ? getTaskKind(detailsQuery.data) : null;

    return (
        <Box height="100%" display="flex" flexDirection="column" overflow="hidden">
            {/* The task-name header is preview chrome; a bare kiosk drops it so
                the client <App> owns the whole surface. */}
            {!bare && (
                <Flex px={4} py={2} borderBottom="1px solid" borderColor="border.subtle" bg="bg.surface" align="center" flexShrink={0}>
                    <Text fontSize="sm" fontWeight="medium" color="fg">{task}</Text>
                </Flex>
            )}
            <Box flex={1} overflow="hidden" minHeight={0}>
                {detailsQuery.isLoading
                    ? <StatusDisplay variant="loading" title="Loading task..." />
                    : detailsQuery.error
                        ? <StatusDisplay variant="error" title="Error" message={detailsQuery.error.message} />
                        : kind === 'ui'
                            ? <UITaskPreview
                                task={task}
                                bare={bare}
                                config={{ apiUrl, repo, workspace, token: requestOptions?.token ?? null }}
                            />
                            : <DataTaskPreview
                                apiUrl={apiUrl}
                                repo={repo}
                                workspace={workspace}
                                task={task}
                                {...(requestOptions != null && { requestOptions })}
                            />
                }
            </Box>
        </Box>
    );
}, (prev, next) => prev.task === next.task && prev.repo === next.repo && prev.workspace === next.workspace && prev.bare === next.bare);
