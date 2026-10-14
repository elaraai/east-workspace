/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, type Ref } from 'react';
import { useTabs } from '@chakra-ui/react';
import { VirtualizedLogViewer, type LogMatches } from './VirtualizedLogViewer.js';
import type { LogViewerControls } from './preview-controls.js';
import { useTaskLogs as useTaskLogsHook } from '../hooks/useTaskLogsHook.js';
import type { RequestOptions } from '@elaraai/e3-api-client';

export interface TaskLogsProps {
    apiUrl: string;
    repo: string;
    workspace: string;
    task: string;
    requestOptions?: RequestOptions;
    /** The stream, controlled: the tabs show it, and a click tells
     *  `onStreamChange` rather than switching (#1209). The view's own,
     *  from `'stdout'`, when not given. */
    stream?: 'stdout' | 'stderr' | undefined;
    /** Told the stream the tabs pick. */
    onStreamChange?: ((stream: 'stdout' | 'stderr') => void) | undefined;
    /** `false` draws no band, and the log fills the view: see {@link VirtualizedLogViewer}. */
    toolbar?: boolean | undefined;
    /** The log's search, controlled: see {@link VirtualizedLogViewer}. */
    search?: string | undefined;
    /** Told the text of the view's own search box. */
    onSearchChange?: ((search: string) => void) | undefined;
    /** Told the match shown and how many there are. */
    onMatchesChange?: ((matches: LogMatches) => void) | undefined;
    /** Given the view's next and previous match and its Copy. */
    controlsRef?: Ref<LogViewerControls> | undefined;
    /** How often the log shown is polled while it changes, in milliseconds.
     *  Default 1000. */
    pollInterval?: number | undefined;
    /** The longest the log shown waits between polls while nothing changes,
     *  in milliseconds; once its execution has ended and it is read, it is
     *  polled every half minute, for another execution. Default 5000. */
    pollBackoff?: number | undefined;
}

/**
 * Renders a virtualized log viewer for a task's stdout/stderr: the stream
 * shown is polled, and the other is read when the tabs show it.
 */
export const TaskLogs = memo(function TaskLogs({
    apiUrl,
    repo,
    workspace,
    task,
    requestOptions,
    stream,
    onStreamChange,
    toolbar,
    search,
    onSearchChange,
    onMatchesChange,
    controlsRef,
    pollInterval,
    pollBackoff,
}: TaskLogsProps) {
    // The stream: the host's when it controls it, else the tabs' own.
    const tabs = useTabs({
        defaultValue: 'stdout',
        ...(stream !== undefined && { value: stream }),
        onValueChange: (details) => onStreamChange?.(details.value === 'stderr' ? 'stderr' : 'stdout'),
    });
    const shown: 'stdout' | 'stderr' = tabs.value === 'stderr' ? 'stderr' : 'stdout';

    // The stream shown alone is polled: the other's query, kept by react-query
    // under its own key, is read on from where it stopped when the tabs show
    // it again.
    const { data: log } = useTaskLogsHook(apiUrl, repo, workspace, task, shown, requestOptions, undefined, {
        ...(pollInterval !== undefined && { pollMs: pollInterval }),
        ...(pollBackoff !== undefined && { backoffMs: pollBackoff }),
    });
    const activeLogContent = useMemo(() => log?.data ?? '', [log?.data]);

    return (
        <VirtualizedLogViewer
            content={activeLogContent}
            tabs={tabs}
            toolbar={toolbar}
            search={search}
            onSearchChange={onSearchChange}
            onMatchesChange={onMatchesChange}
            controlsRef={controlsRef}
        />
    );
});
