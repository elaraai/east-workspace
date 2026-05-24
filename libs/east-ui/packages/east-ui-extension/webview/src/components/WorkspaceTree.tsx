/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Workspace navigation sidebar — bsys Sidebar / `navList` recipe.
 *
 * Renders workspaces as top-level nav items (mono uppercase, 16px icon,
 * brand-tint + 3px left-rule active state); the selected workspace expands
 * to its inputs + tasks as nested items, each carrying a `StatusIndicator`
 * (dot + word). Built on the shared `navList` slot-recipe — the same one
 * the showcase sidebar consumes — rather than a default-styled TreeView.
 *
 * @packageDocumentation
 */

import { Fragment, useMemo } from 'react';
import { Box, Flex, Text, HStack, Spinner, useSlotRecipe, type SystemStyleObject } from '@chakra-ui/react';
import { faChevronLeft } from '@fortawesome/free-solid-svg-icons';
import { useE3Context, getSelectedWorkspace } from '../context/E3Context';
import { SidebarToggle } from './SidebarToggle';
import { useWorkspaceList, useWorkspaceStatus, formatApiError } from '@elaraai/e3-ui-components';
import type { WorkspaceInfo, TaskStatusInfo, DatasetStatusInfo } from '@elaraai/e3-api-client';
import { StatusIndicator, type StatusTone } from './StatusIndicator';

function getTaskStatusTone(status: TaskStatusInfo['status']['type']): StatusTone {
    switch (status) {
        case 'up-to-date': return 'success';
        case 'ready': return 'info';
        case 'waiting': return 'warning';
        case 'in-progress': return 'info';
        case 'failed':
        case 'error': return 'danger';
        case 'stale-running': return 'warning';
        default: return 'neutral';
    }
}

function getInputStatusTone(status: DatasetStatusInfo['status']['type']): StatusTone {
    switch (status) {
        case 'up-to-date': return 'success';
        case 'stale': return 'warning';
        case 'unset': return 'neutral';
        default: return 'neutral';
    }
}

/** Per the bsys sidebar, nested sub-items indent 36px under their parent,
 *  drop the icon for an em-dash prefix, and drop the uppercase mono treatment
 *  for a quieter 11px/500 label. */
const NESTED_ITEM_OVERRIDE: SystemStyleObject = {
    paddingInlineStart: '36px',
    height: '30px',
    textTransform: 'none',
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.08em',
};

interface NestedItemProps {
    label: string;
    tone: StatusTone;
    statusLabel: string;
    active: boolean;
    itemStyle: SystemStyleObject;
    textStyle: SystemStyleObject;
    onClick: () => void;
}

function NestedItem({ label, tone, statusLabel, active, itemStyle, textStyle, onClick }: NestedItemProps) {
    return (
        <Box
            as="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            css={{ ...itemStyle, ...NESTED_ITEM_OVERRIDE }}
            title={label}
        >
            <Box as="span" css={textStyle}>— {label}</Box>
            <StatusIndicator tone={tone} label={statusLabel} hideLabel />
        </Box>
    );
}

function WorkspaceTreeContent({ workspaces }: { workspaces: WorkspaceInfo[] }) {
    const { apiUrl, selection, setSelection, toggleSidebar } = useE3Context();
    const selectedWorkspace = getSelectedWorkspace(selection);

    const recipe = useSlotRecipe({ key: 'navList' });
    const styles = recipe({ surface: 'shell' });

    const { data: status, isLoading: statusLoading } = useWorkspaceStatus(apiUrl, 'default', selectedWorkspace, undefined, {
        refetchInterval: 1000,
        staleTime: 0,
        gcTime: 0,
        structuralSharing: false,
    });

    const { inputs, tasks } = useMemo(() => {
        if (!status) return { inputs: [] as DatasetStatusInfo[], tasks: [] as TaskStatusInfo[] };
        return {
            inputs: status.datasets.filter(d => !d.isTaskOutput && d.path.startsWith('.inputs')),
            tasks: status.tasks,
        };
    }, [status]);

    return (
        <Box
            as="nav"
            css={styles.root}
        >
            {/* Section eyebrow + collapse chevron — bsys Sidebar recipe:
             *  padding 4/10/10/14 · 9.5px/0.18em eyebrow · 22px chevron. */}
            <Flex align="center" justify="space-between" pt="4px" pb="10px" pl="14px" pr="10px">
                <Box textStyle="nav.eyebrow">Workspaces</Box>
                <SidebarToggle aria-label="Collapse sidebar" onClick={toggleSidebar} icon={faChevronLeft} />
            </Flex>
            {workspaces.map(ws => {
                const expanded = selectedWorkspace === ws.name;
                const wsActive = selection.type === 'workspace' && selection.workspace === ws.name;
                return (
                    <Fragment key={ws.name}>
                        <Box
                            as="button"
                            aria-current={wsActive ? 'page' : undefined}
                            css={styles.item}
                            onClick={() => setSelection(expanded ? { type: 'none' } : { type: 'workspace', workspace: ws.name })}
                            title={ws.name}
                        >
                            <Box as="span" css={styles.itemText}>{ws.name}</Box>
                            {expanded && statusLoading && <Spinner size="xs" />}
                        </Box>

                        {expanded && (
                            <>
                                {/* Inputs and tasks are told apart by a section
                                 *  eyebrow per group (bsys group-header item type),
                                 *  not by a per-row icon. */}
                                {inputs.length > 0 && (
                                    <>
                                        <Box textStyle="nav.eyebrow" pl="24px" pt="8px" pb="4px">Inputs</Box>
                                        {inputs.map(input => (
                                            <NestedItem
                                                key={`input:${input.path}`}
                                                label={input.path.replace(/^\.inputs\./, '')}
                                                tone={getInputStatusTone(input.status.type)}
                                                statusLabel={input.status.type}
                                                active={selection.type === 'input' && selection.workspace === ws.name && selection.path === input.path}
                                                itemStyle={styles.item}
                                                textStyle={styles.itemText}
                                                onClick={() => setSelection({ type: 'input', workspace: ws.name, path: input.path })}
                                            />
                                        ))}
                                    </>
                                )}
                                {tasks.length > 0 && (
                                    <>
                                        <Box textStyle="nav.eyebrow" pl="24px" pt="8px" pb="4px">Tasks</Box>
                                        {tasks.map(task => (
                                            <NestedItem
                                                key={`task:${task.name}`}
                                                label={task.name}
                                                tone={getTaskStatusTone(task.status.type)}
                                                statusLabel={task.status.type}
                                                active={selection.type === 'task' && selection.workspace === ws.name && selection.task === task.name}
                                                itemStyle={styles.item}
                                                textStyle={styles.itemText}
                                                onClick={() => setSelection({ type: 'task', workspace: ws.name, task: task.name })}
                                            />
                                        ))}
                                    </>
                                )}
                                {!statusLoading && inputs.length === 0 && tasks.length === 0 && (
                                    <Text pl="24px" py="1" fontFamily="mono" fontSize="2xs" color="fg.subtle">
                                        No inputs or tasks
                                    </Text>
                                )}
                            </>
                        )}
                    </Fragment>
                );
            })}
        </Box>
    );
}

export function WorkspaceTree() {
    const { apiUrl } = useE3Context();
    const { data: workspaces, isLoading, error } = useWorkspaceList(apiUrl, 'default', undefined, {
        refetchInterval: 5000,
    });

    if (isLoading) {
        return (
            <Box p="3">
                <HStack>
                    <Spinner size="sm" />
                    <Text fontSize="sm">Loading workspaces…</Text>
                </HStack>
            </Box>
        );
    }

    if (error) {
        const info = formatApiError(error);
        return (
            <Box p="4">
                <Text color="fg.danger" fontSize="sm">{info.message}</Text>
                {info.details && (
                    <Text color="fg.danger" opacity={0.8} fontSize="xs" mt="1">{info.details}</Text>
                )}
            </Box>
        );
    }

    if (!workspaces || workspaces.length === 0) {
        return (
            <Box p="4">
                <Text fontSize="sm" color="fg.muted">No workspaces found</Text>
            </Box>
        );
    }

    return <WorkspaceTreeContent workspaces={workspaces} />;
}
