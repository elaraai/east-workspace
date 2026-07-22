/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<DataflowControl>` — the app-bar run/stop control for the current
 * workspace's dataflow.
 *
 * One button rather than two, because the two actions are never both
 * available: while a dataflow runs the only useful verb is "stop", and while
 * it is idle the only useful verb is "run". A disabled second button would
 * take space to say nothing.
 *
 * @packageDocumentation
 */

import { useCallback } from 'react';
import { chakra } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlay, faStop, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { useDataflowStart, useDataflowCancel, useDataflowExecution } from '@elaraai/e3-ui-components';
import { useE3Context } from '../context/E3Context';

export function DataflowControl() {
    const { apiUrl, currentWorkspace } = useE3Context();

    // Polled at the tree's cadence so the button and the task dots never
    // disagree about whether something is running.
    const { data: execution } = useDataflowExecution(
        apiUrl, 'default', currentWorkspace, undefined, undefined,
        { refetchInterval: 1000, staleTime: 0 },
    );
    const start = useDataflowStart(apiUrl, 'default', currentWorkspace);
    const cancel = useDataflowCancel(apiUrl, 'default', currentWorkspace);

    const running = execution?.status.type === 'running';
    // A request is in flight but the poll has not caught up yet: the button
    // must not offer either verb, or a double-click starts two dataflows.
    const settling = start.isPending || cancel.isPending;

    const onClick = useCallback(() => {
        if (running) cancel.mutate();
        else start.mutate(undefined);
    }, [running, start, cancel]);

    const label = settling
        ? (running ? 'Stopping dataflow…' : 'Starting dataflow…')
        : running ? 'Stop dataflow' : 'Run dataflow';

    const disabled = !currentWorkspace || settling;

    return (
        <chakra.button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={currentWorkspace ? label : 'Select a workspace to run its dataflow'}
            width="22px"
            height="22px"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            border="0"
            background="transparent"
            color={running ? 'fg.danger' : 'fg.success'}
            cursor={disabled ? 'default' : 'pointer'}
            opacity={disabled ? 0.4 : 1}
            borderRadius="{radii.sm}"
            _hover={disabled ? undefined : { background: 'bg.muted' }}
        >
            <FontAwesomeIcon
                icon={settling ? faSpinner : running ? faStop : faPlay}
                style={{ fontSize: '12px' }}
                {...(settling && { spin: true })}
            />
        </chakra.button>
    );
}
